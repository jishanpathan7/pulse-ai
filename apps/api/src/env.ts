/**
 * env.ts — validated environment configuration.
 *
 * Fails fast at startup if required vars are missing or malformed.
 * All downstream code imports from here — never reads process.env directly.
 *
 * .env loading: manual parser walks up from cwd to find the file.
 * Production: set real env vars; the file loader is a no-op if no .env found.
 */

import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// ─── .env loader ──────────────────────────────────────────────────────────────

function findDotEnv(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return undefined;
}

function loadDotEnv(): void {
  const path = findDotEnv();
  if (!path) return;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    // Only load from file if not already set to a non-empty value
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadDotEnv();

// ─── Schema ───────────────────────────────────────────────────────────────────

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Server
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3002),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().int().min(1).default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(20),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().default(30_000),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_KEY_PREFIX: z.string().default('pulse:'),

  // WebSocket
  WS_PATH: z.string().default('/ws'),
  WS_MAX_PAYLOAD_BYTES: z.coerce.number().int().default(65_536),
  WS_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().default(30_000),
  WS_RECONNECT_BACKOFF_MAX_MS: z.coerce.number().int().default(30_000),
  WS_REPLAY_TTL_SECONDS: z.coerce.number().int().default(300),

  // Auth
  JWT_SECRET: z.string().min(32),

  // AI — optional; server starts without it (Ollama is the default browser-side provider)
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // BYOK encryption key — base64-encoded 32 bytes (AES-256-GCM master key).
  // Generate: openssl rand -base64 32
  // Optional in dev (warn at startup), required in production.
  ENCRYPTION_KEY: z.string().min(1).optional(),

  // CORS — comma-separated origins in production
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
})
  .refine(
    (data) => data.NODE_ENV !== 'production' || !!data.ENCRYPTION_KEY,
    { message: 'ENCRYPTION_KEY is required in production', path: ['ENCRYPTION_KEY'] },
  );

// ─── Parse & export ───────────────────────────────────────────────────────────

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
