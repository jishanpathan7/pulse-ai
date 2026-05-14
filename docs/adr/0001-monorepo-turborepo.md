# ADR-0001: Turborepo Monorepo

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

Pulse AI has two runtime targets (browser frontend, Node.js backend) sharing
TypeScript types, transport contracts, and telemetry definitions. Without
a monorepo, these shared types must be published as separate packages,
requiring versioning and release coordination on every contract change during
active development.

## Decision

Use Turborepo with pnpm workspaces as the monorepo build orchestrator.

## Rationale

Turborepo provides:
- Incremental builds with fine-grained task caching keyed on inputs
- Parallel task execution across packages with dependency graph awareness
- Remote caching (Vercel) for CI speed once team grows

pnpm workspaces chosen over npm/yarn workspaces for:
- Strict dependency isolation (no phantom dependencies)
- `workspace:*` protocol for internal package referencing
- Significantly faster installs via content-addressable store

## Consequences

**Positive:** Single `pnpm install` installs everything. Type changes in
`@pulse/types` propagate immediately to all consumers without publish cycle.
Turborepo task graph ensures correct build order.

**Negative:** Developers must understand workspace resolution to add new packages.
TypeScript project references require explicit `references` arrays in `tsconfig.json`.

## Alternatives Considered

### Nx
Rejected: more complex configuration overhead for a two-app system.
Nx excels at large codebases with 20+ apps/libs.

### Separate repos
Rejected: forces package publishing on every shared type change, blocking fast iteration.
