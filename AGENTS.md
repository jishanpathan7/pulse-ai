# Pulse AI — Engineering Reference

Production-grade realtime AI workspace platform. Realtime token streaming,
sequence-based replay recovery, rAF-batched rendering, virtualized message list.

## Stack

| Layer | Technology |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | React 19 + Vite + TypeScript |
| State | Zustand (selector-based subscriptions) |
| Virtualization | TanStack Virtual (variable-height) |
| Styling | Tailwind v4 + shadcn/ui |
| Transport | Raw WebSocket API (browser) + `ws` (server) |
| Backend | Fastify v5 |
| Database | PostgreSQL (raw `pg` driver — no ORM) |
| Cache/PubSub | Redis (`ioredis`) |
| Logger | pino |
| Telemetry | OpenTelemetry SDK |
| Testing | Vitest |

## Monorepo Layout

```
pulse-ai/
├── apps/
│   ├── web/              React + Vite frontend
│   └── api/              Fastify backend
├── packages/
│   ├── types/            @pulse/types — shared contracts (NO deps)
│   ├── utils/            @pulse/utils — pure utilities (NO deps)
│   ├── transport/        @pulse/transport — WS interfaces + sequence primitives
│   ├── telemetry/        @pulse/telemetry — OTEL interfaces
│   ├── logger/           @pulse/logger — structured logger interface
│   ├── ui/               @pulse/ui — shadcn/ui components (NO business logic)
│   ├── tsconfig/         @pulse/tsconfig — shared TS configs
│   └── eslint-config/    @pulse/eslint-config — shared ESLint flat configs
├── docs/
│   ├── adr/              Architecture Decision Records
│   ├── architecture/     System design docs
│   ├── conventions/      Engineering conventions
│   └── runbooks/         Operational runbooks
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example
```

## Implementation Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation — monorepo, configs, shared types, docs | ✅ Done |
| 2 | Transport — state machine, seq tracking, replay recovery, backoff, heartbeat, server infra | ✅ Done |
| 3 | Rendering pipeline — RAF scheduler, stream buffer, snapshots, 5 Zustand stores, scroll FSM | ✅ Done |
| 4 | React rendering — TanStack Virtual impl, streaming component, scroll container | ✅ Done |
| 5 | Observability — two-tier telemetry, metrics pipeline, stress testing, debug overlay | ✅ Done |
| 6 | Workspace Integration — streaming markdown, workspace layout, replay/reconnect UX, chaos panel, sidebar | ✅ Done |
| 7 | AI Integration — provider abstraction, DemoAdapter, AnthropicAdapter, StreamInjector, BenchmarkRunner, error boundaries | ✅ Done |
| 8 | Backend Core — Fastify bootstrap, DB pool, Redis, health | ⬜ |
| 9 | AI Backend — stream proxy, token pipeline, WS handler | ⬜ |
| 9 | Auth — authentication, session management, rate limiting | ⬜ |
| 10 | Telemetry — OTEL traces, metrics, structured events | ⬜ |
| 11 | Production — load testing, tuning, deployment | ⬜ |

## Critical Invariants

**Never break these:**

1. **One RAF pending max.** Token queue batching requires exactly one
   `requestAnimationFrame` scheduled at a time. Multiple concurrent RAFs
   cause duplicate renders.

2. **Server is sequence authority.** Client never generates sequence numbers.
   seq=0 reserved for control messages.

3. **`@pulse/ui` has no runtime deps on `@pulse/transport` or stores.**
   UI components are pure presentation. All data via props.

4. **No `setState` in WS `onmessage`.** Always via rAF queue → store.

5. **All cross-boundary failures return `Result<T, E>`.** Never throw
   across subsystem boundaries.

6. **`no-cycle` ESLint rule enforced.** Circular package imports = build failure.

## Common Commands

```bash
pnpm install              # install all workspace deps
pnpm dev                  # start all apps in dev mode (turbo)
pnpm build                # build all packages and apps
pnpm typecheck            # typecheck across entire monorepo
pnpm lint                 # lint across entire monorepo
pnpm format               # format all files with prettier
pnpm test                 # run all tests

# Scoped (faster in development)
turbo run dev --filter=@pulse/web
turbo run typecheck --filter=@pulse/api
turbo run test --filter=@pulse/utils
```

## Adding a shadcn Component

```bash
cd packages/ui
pnpm dlx shadcn@latest add <component>
```

## Adding a New Package

1. Create `packages/<name>/package.json` with name `@pulse/<name>`
2. Create `packages/<name>/tsconfig.json` extending the appropriate base
3. Add `{ "path": "packages/<name>" }` to root `tsconfig.json` references
4. Add `"@pulse/<name>": "workspace:*"` to consuming packages

## ADR Process

New architectural decisions → new ADR in `docs/adr/`.
Use `docs/adr/template.md`. Number sequentially.
Status: `Proposed` → reviewed → `Accepted` or `Rejected`.
Superseded ADRs update status and link to successor.

## Key Docs

- [Architecture Overview](docs/architecture/overview.md)
- [Subsystem Boundaries](docs/architecture/subsystems.md)
- [Data Flow Diagrams](docs/architecture/data-flow.md)
- [Engineering Conventions](docs/conventions/engineering.md)
- [TypeScript Conventions](docs/conventions/typescript.md)
- [Git Conventions](docs/conventions/git.md)
- [ADR Index](docs/adr/)
