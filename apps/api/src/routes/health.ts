/**
 * health routes
 *
 * GET /health  — liveness probe. Returns 200 if server process is alive.
 *               Does NOT check DB/Redis (fast, used by load balancer keep-alive).
 *
 * GET /ready   — readiness probe. Checks DB + Redis connectivity.
 *               Returns 503 if either is down. Used by orchestrators to
 *               hold traffic until dependencies are healthy.
 */

import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // ── Liveness ──────────────────────────────────────────────────────────────

  app.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            ok:  { type: 'boolean' },
            ts:  { type: 'number' },
            env: { type: 'string' },
          },
        },
      },
    },
  }, async (_req, reply) => {
    return reply.send({
      ok: true,
      ts: Date.now(),
      env: process.env['NODE_ENV'] ?? 'unknown',
    });
  });

  // ── Readiness ─────────────────────────────────────────────────────────────

  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    // Postgres
    const pgStart = Date.now();
    try {
      await app.db.query('SELECT 1');
      checks['postgres'] = { ok: true, latencyMs: Date.now() - pgStart };
    } catch (e) {
      checks['postgres'] = { ok: false, error: String(e) };
    }

    // Redis
    const redisStart = Date.now();
    try {
      await app.redis.ping();
      checks['redis'] = { ok: true, latencyMs: Date.now() - redisStart };
    } catch (e) {
      checks['redis'] = { ok: false, error: String(e) };
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    const status = allOk ? 200 : 503;

    return reply.status(status).send({
      ok: allOk,
      ts: Date.now(),
      checks,
    });
  });
}
