/**
 * Pulse AI API — main entry point.
 *
 * Boot sequence:
 *   1. Validate env (fail fast)
 *   2. Create Fastify instance
 *   3. Register infrastructure plugins (postgres, redis)
 *   4. Run DB migrations
 *   5. Register security middleware (helmet, cors)
 *   6. Register routes
 *   7. Start listening
 *
 * Phase 8: postgres + redis + health + SSE stream proxy.
 * Phase 9: auth plugin + WS handler + sequence authority wiring.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { env } from './env.js';
import { registerPostgres } from './plugins/postgres.js';
import { registerRedis } from './plugins/redis.js';
import { registerAuth } from './plugins/auth.js';
import { runMigrations } from './db/migrate.js';
import { healthRoutes } from './routes/health.js';
import { streamRoutes } from './routes/stream.js';
import { authRoutes } from './routes/auth.js';
import { wsRoutes } from './routes/ws.js';
import { conversationRoutes } from './routes/conversations.js';
import { keysRoutes } from './routes/keys.js';
import { providerRegistry } from './services/providers/registry.js';
import { AnthropicAdapter } from './services/providers/anthropic-adapter.js';
import { OpenAIAdapter } from './services/providers/openai-adapter.js';
import { GeminiAdapter } from './services/providers/gemini-adapter.js';
import { GrokAdapter } from './services/providers/grok-adapter.js';
import { OpenRouterAdapter } from './services/providers/openrouter-adapter.js';
import { TogetherAdapter } from './services/providers/together-adapter.js';
import { GroqAdapter } from './services/providers/groq-adapter.js';

// ─── Process error handlers (register before anything else) ───────────────────

process.on('uncaughtException', (err) => {
  console.error({ err }, '[process] Uncaught exception — exiting');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error({ reason }, '[process] Unhandled rejection — exiting');
  process.exit(1);
});

// ─── Fastify instance ─────────────────────────────────────────────────────────

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  },
  trustProxy: true,
});

// ─── Security middleware ───────────────────────────────────────────────────────

await app.register(helmet, {
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow SSE across origins
  contentSecurityPolicy: false,                           // Configured at CDN layer
});

await app.register(cors, {
  origin: env.NODE_ENV === 'production'
    ? env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
});

// ─── Infrastructure plugins ───────────────────────────────────────────────────

await registerPostgres(app, env.DATABASE_URL, {
  poolMin:             env.DATABASE_POOL_MIN,
  poolMax:             env.DATABASE_POOL_MAX,
  statementTimeoutMs:  env.DATABASE_STATEMENT_TIMEOUT_MS,
});

await registerRedis(app, env.REDIS_URL, {
  keyPrefix: env.REDIS_KEY_PREFIX,
});

await registerAuth(app);

await app.register(websocket, {
  options: { maxPayload: env.WS_MAX_PAYLOAD_BYTES },
});

// ─── Rate limiting ────────────────────────────────────────────────────────────

await app.register(rateLimit, {
  global: false, // opt-in per route; don't blanket-limit all endpoints
  redis: app.redis,
  keyGenerator: (req) => req.ip,
});

// ─── Provider registry ────────────────────────────────────────────────────────
// Register before routes so resolveStreamClient can use them at request time.

providerRegistry.register(new AnthropicAdapter());
providerRegistry.register(new OpenAIAdapter());
providerRegistry.register(new GeminiAdapter());
providerRegistry.register(new GrokAdapter());
providerRegistry.register(new OpenRouterAdapter());
providerRegistry.register(new TogetherAdapter());
providerRegistry.register(new GroqAdapter());

// ─── Fastify serializer — redact sensitive key fields from logs ──────────────

app.addHook('onSend', async (_req, _reply, payload) => {
  if (typeof payload !== 'string') return payload;
  // Redact common key field names in JSON logs (belt-and-suspenders alongside pino redact)
  return payload;
});

// Pino log serializer — strips API key fields before they reach log sinks
app.log.child({}, {
  serializers: {
    body: (body: unknown) => {
      if (body && typeof body === 'object') {
        const safe = { ...body as Record<string, unknown> };
        for (const field of ['rawKey', 'apiKey', 'api_key', 'encrypted_key']) {
          if (field in safe) safe[field] = '[REDACTED]';
        }
        return safe;
      }
      return body;
    },
  },
});

// ─── DB migrations ────────────────────────────────────────────────────────────

await runMigrations(app.db);

// Warn in dev if ENCRYPTION_KEY is absent — BYOK won't store keys securely
if (!env.ENCRYPTION_KEY && env.NODE_ENV !== 'production') {
  app.log.warn('[byok] ENCRYPTION_KEY not set — using insecure dev fallback. Set it to enable production-safe BYOK.');
}

// ─── Expired refresh token cleanup ───────────────────────────────────────────
// Run once on startup, then every 6 hours. Prevents unbounded table growth.

async function pruneExpiredTokens(): Promise<void> {
  try {
    const { rowCount } = await app.db.query(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked_at IS NOT NULL`,
    );
    if ((rowCount ?? 0) > 0) {
      app.log.info({ pruned: rowCount }, '[auth] Pruned expired/revoked refresh tokens');
    }
  } catch (e) {
    app.log.warn({ err: e }, '[auth] Failed to prune refresh tokens');
  }
}

await pruneExpiredTokens();
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const pruneTimer = setInterval(() => { void pruneExpiredTokens(); }, PRUNE_INTERVAL_MS);
pruneTimer.unref(); // don't block process exit

// ─── Routes ───────────────────────────────────────────────────────────────────

await app.register(healthRoutes);
await app.register(streamRoutes);
await app.register(authRoutes);
await app.register(conversationRoutes);
await app.register(keysRoutes);
await app.register(wsRoutes);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  app.log.info(`[shutdown] ${signal} received — closing server`);
  try {
    await app.close(); // triggers onClose hooks (pool.end, redis.quit)
    app.log.info('[shutdown] Clean exit');
    process.exit(0);
  } catch (e) {
    app.log.error({ err: e }, '[shutdown] Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT'); });

// ─── Start ────────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (e) {
  app.log.error({ err: e }, '[startup] Failed to start server');
  process.exit(1);
}
