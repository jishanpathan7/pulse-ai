/**
 * migrate.ts — runs pending SQL migrations at startup.
 *
 * Migrations are plain .sql files in ./migrations/, sorted lexicographically.
 * Each migration runs in a transaction. Applied versions tracked in
 * schema_migrations table. Idempotent — safe to call on every boot.
 *
 * Failure aborts server startup (fail fast > silent drift).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const __dir = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dir, 'migrations');

export async function runMigrations(pool: pg.Pool): Promise<void> {
  // Bootstrap: ensure tracking table exists (idempotent)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Which migrations have already run?
  const { rows } = await pool.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC',
  );
  const applied = new Set(rows.map((r) => r.version));

  // Find pending
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending = files.filter((f) => !applied.has(f.replace('.sql', '')));

  if (pending.length === 0) {
    console.info('[migrate] No pending migrations');
    return;
  }

  for (const file of pending) {
    const version = file.replace('.sql', '');
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations(version) VALUES($1)',
        [version],
      );
      await client.query('COMMIT');
      console.info(`[migrate] ✓ Applied: ${version}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`[migrate] ✗ Failed on ${version}: ${String(e)}`);
    } finally {
      client.release();
    }
  }

  console.info(`[migrate] Done — applied ${pending.length} migration(s)`);
}
