/**
 * postgres plugin — wires a pg.Pool onto the Fastify instance.
 *
 * Usage:  await registerPostgres(app, env.DATABASE_URL, options)
 * Access: app.db.query(...)  /  app.db.connect() for transactions
 *
 * The pool is tested at startup (SELECT 1). If the DB is unreachable,
 * the server fails to start — fast-fail beats silent degradation.
 *
 * Graceful shutdown: pool.end() is called via onClose hook.
 */

import pg from 'pg';
import type { FastifyInstance } from 'fastify';

const { Pool } = pg;

// ─── Type augmentation ────────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyInstance {
    db: pg.Pool;
  }
}

// ─── Options ──────────────────────────────────────────────────────────────────

interface PostgresOptions {
  poolMin?: number;
  poolMax?: number;
  statementTimeoutMs?: number;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function registerPostgres(
  app: FastifyInstance,
  databaseUrl: string,
  options: PostgresOptions = {},
): Promise<void> {
  const pool = new Pool({
    connectionString: databaseUrl,
    min: options.poolMin ?? 2,
    max: options.poolMax ?? 20,
    statement_timeout: options.statementTimeoutMs ?? 30_000,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 5_000,
  });

  // Fail fast — test connectivity before accepting traffic
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    app.log.info('[postgres] Connection pool ready');
  } catch (e) {
    await pool.end().catch(() => undefined);
    throw new Error(`[postgres] Failed to connect: ${String(e)}`);
  }

  pool.on('error', (err) => {
    app.log.error({ err }, '[postgres] Unexpected pool error');
  });

  app.decorate('db', pool);

  app.addHook('onClose', async () => {
    app.log.info('[postgres] Draining connection pool…');
    await pool.end();
    app.log.info('[postgres] Pool closed');
  });
}
