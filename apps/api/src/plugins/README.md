# Fastify Plugins

Plugins registered in order at server bootstrap. Each plugin is a standalone Fastify plugin module.

## Registration Order (Phase 5+)

1. `telemetry.ts` — OTEL SDK init, request tracing
2. `config.ts` — env config validation (zod), expose via `fastify.config`
3. `cors.ts` — `@fastify/cors`
4. `helmet.ts` — `@fastify/helmet` security headers
5. `database.ts` — PostgreSQL pool, expose via `fastify.db`
6. `redis.ts` — Redis client, expose via `fastify.redis`
7. `websocket.ts` — `@fastify/websocket` upgrade handler
8. `auth.ts` — auth middleware (Phase 7)
9. `rate-limit.ts` — per-IP and per-user rate limiting (Phase 7)

## Rules

- Each plugin uses `fastify-plugin` to avoid scope isolation when sharing decorators
- Plugins never import from each other — dependencies via Fastify decorators only
- No business logic in plugins — they wire infrastructure, not implement features
