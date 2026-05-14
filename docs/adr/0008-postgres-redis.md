# ADR-0008: PostgreSQL + Redis Data Layer

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

The platform needs two distinct data access patterns:
1. **Durable persistence:** conversation history, user data, audit logs
2. **High-throughput ephemeral:** session state, sequence replay buffer,
   pub/sub for multi-server WebSocket fan-out

## Decision

Use PostgreSQL for durable persistence and Redis for ephemeral high-throughput data.
No ORM — raw `pg` driver with typed query functions.

## Rationale

**PostgreSQL:** Standard choice for relational data with ACID guarantees.
Conversation history requires transactional writes (message + updated conversation).
Full-text search on message content is a first-class Postgres feature.

**No ORM:** ORMs (Prisma, Drizzle, TypeORM) add query planning overhead and
abstraction that obscures performance. At high-throughput, the difference between
an ORM-generated query and a hand-written one matters. Typed query functions in
TypeScript provide compile-time safety without the overhead. Schema migrations
handled by raw SQL migration files.

**Redis use cases:**
- Sequence replay buffer: `LPUSH` / `LRANGE` per session, TTL-based eviction
- Session state: `HSET` / `HGET`, fast reads for WebSocket handshake
- Pub/sub: `PUBLISH` / `SUBSCRIBE` for cross-server WebSocket fan-out (when horizontally scaled)
- Rate limiting: `INCR` + `EXPIRE` for sliding window counters

## Consequences

**Positive:** Each store is optimal for its access pattern. Redis replay buffer
handles reconnect in <1ms. Postgres gives full query flexibility for history.

**Negative:** Two infrastructure dependencies to operate. Must write and maintain
typed query functions instead of relying on ORM code generation.

**Neutral:** Connection pooling required for both — `pg` Pool, `ioredis` connection pool.

## Alternatives Considered

### Prisma ORM
Rejected: Prisma's query engine binary adds cold-start overhead and is a
deployment complication. Raw SQL is faster and more predictable.

### Drizzle ORM
Strong alternative — TypeScript-first, thin overhead. Revisit in Phase 5 if
hand-written queries become burdensome.

### Redis alone (no Postgres)
Rejected: Redis is not suitable for durable conversation history requiring
complex queries and long retention.
