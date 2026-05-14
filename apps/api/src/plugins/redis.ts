/**
 * redis plugin — wires an ioredis client onto the Fastify instance.
 *
 * Usage:  await registerRedis(app, env.REDIS_URL, options)
 * Access: app.redis.get(key) / app.redis.set(key, val)
 *
 * Connectivity is tested at startup. The client auto-reconnects on
 * transient failures — Redis is treated as ephemeral (no data loss risk).
 *
 * Graceful shutdown: client.quit() on onClose hook.
 */

import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';

// ─── Type augmentation ────────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyInstance {
    redis: InstanceType<typeof Redis>;
  }
}

// ─── Options ──────────────────────────────────────────────────────────────────

interface RedisOptions {
  keyPrefix?: string;
  connectTimeoutMs?: number;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function registerRedis(
  app: FastifyInstance,
  redisUrl: string,
  options: RedisOptions = {},
): Promise<void> {
  const client = new Redis(redisUrl, {
    keyPrefix: options.keyPrefix ?? 'pulse:',
    connectTimeout: options.connectTimeoutMs ?? 5_000,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  // Fail fast
  try {
    await client.connect();
    await client.ping();
    app.log.info('[redis] Connected');
  } catch (e) {
    client.disconnect();
    throw new Error(`[redis] Failed to connect: ${String(e)}`);
  }

  client.on('error', (err: unknown) => {
    app.log.error({ err }, '[redis] Client error');
  });

  client.on('reconnecting', () => {
    app.log.warn('[redis] Reconnecting…');
  });

  app.decorate('redis', client);

  app.addHook('onClose', async () => {
    app.log.info('[redis] Closing connection…');
    await client.quit();
    app.log.info('[redis] Connection closed');
  });
}
