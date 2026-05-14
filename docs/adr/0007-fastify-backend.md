# ADR-0007: Fastify as HTTP/WebSocket Server

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

The API server handles: WebSocket upgrades, REST endpoints, health checks,
and will eventually serve AI stream proxying. Request throughput and low
serialization overhead matter — the server is on the hot path of every
streaming session.

## Decision

Use Fastify v5 as the HTTP and WebSocket server.

## Rationale

Fastify benchmarks fastest among production-grade Node.js HTTP frameworks
(~76k req/s vs Express ~16k req/s on equivalent hardware).

Key properties for this platform:
- JSON Schema-based request validation compiled to optimized validators at startup
- `@fastify/websocket` integrates `ws` with zero overhead WebSocket upgrade
- Plugin architecture enforces separation of concerns — each plugin owns one thing
- TypeScript support is first-class (type inference for route schemas)
- `fastify.inject()` enables integration testing without network I/O

The plugin encapsulation model (`fastify-plugin`) maps cleanly to our
infrastructure setup: each plugin registers a database pool, Redis client, etc.
as Fastify decorators, then routes consume them via `fastify.db`, `fastify.redis`.

## Consequences

**Positive:** High throughput baseline. Schema validation prevents malformed
requests from reaching handlers. Plugin model enforces architectural boundaries.

**Negative:** Fastify's plugin scoping model (encapsulation by default) has a
learning curve. Developers must understand when to use `fastify-plugin` to
escape scope.

**Neutral:** Fastify v5 drops CommonJS support — project is ESM-only, no conflict.

## Alternatives Considered

### Express
Rejected: ~5x lower throughput. No built-in schema validation. TypeScript
support requires additional configuration.

### Hono
Strong alternative — faster than Fastify in some benchmarks, edge-compatible.
Rejected: smaller ecosystem for WebSocket, less mature plugin library.
Revisit if edge deployment becomes a requirement.
