# Subsystem Boundaries

Each subsystem owns a specific concern. Cross-subsystem communication is explicit
and typed. No subsystem reaches into another's internals.

---

## 1. Transport Subsystem (Phase 2)

**Owner:** `apps/web/src/transport/`, `@pulse/transport`

**Concern:** WebSocket lifecycle, sequence tracking, replay recovery, heartbeat.

**Inputs:** WebSocket events (open, message, close, error)
**Outputs:** Typed `ServerMessage` events to subscribers, `ConnectionState` changes

**Rules:**
- Never calls `setState` or interacts with Zustand directly
- Emits events; the store layer subscribes
- All side effects (reconnect timers, RAF) managed internally

---

## 2. State Subsystem (Phase 3)

**Owner:** `apps/web/src/store/`

**Concern:** Application state. Single source of truth for connection state,
stream state, conversation data, UI state.

**Inputs:** Transport events, user actions
**Outputs:** Reactive store state read by components

**Rules:**
- Stores never import from each other (use selectors at consumption point)
- No DOM refs, no scheduling, no I/O
- All async actions return `Result<T, E>` — never throw across store boundaries

---

## 3. Render Subsystem (Phase 4)

**Owner:** `apps/web/src/render/`

**Concern:** rAF batching, virtual list integration, streaming token display.

**Inputs:** Token events from store, viewport dimensions
**Outputs:** DOM mutations, scroll state

**Rules:**
- Token queue is a plain array outside React state
- RAF scheduler is a singleton per stream instance
- No business logic — pure rendering concerns

---

## 4. API Server (Phase 5)

**Owner:** `apps/api/src/`

**Concern:** HTTP + WebSocket server, request validation, infrastructure wiring.

**Subsections:**
- `plugins/` — infrastructure (DB, Redis, auth, telemetry)
- `routes/` — request handlers
- `ws/` — WebSocket session management, sequence authority

**Rules:**
- Route handlers are thin — delegate to service modules (Phase 6+)
- Plugins use Fastify decorators; no global singletons
- All WebSocket handlers are typed against `@pulse/types/transport`

---

## 5. AI Stream Proxy (Phase 6)

**Owner:** `apps/api/src/services/stream/`

**Concern:** Proxy AI provider stream → sequence-numbered WebSocket messages.

**Rules:**
- Backpressure: if WebSocket send buffer full, pause upstream read
- Every token assigned a sequence number before send + Redis persist
- Error → `ServerStreamErrorMessage` with `retryable` flag

---

## 6. Telemetry Subsystem (Phase 8)

**Owner:** `@pulse/telemetry`, bootstrapped in `apps/api/src/main.ts` and `apps/web/src/main.tsx`

**Concern:** OTEL traces, metrics, structured events.

**Rules:**
- Feature code calls `getTracer()` / `getMeter()` — never imports OTEL SDK directly
- SDK initialized once at startup; never re-initialized
- Sampling config is environment-controlled, not code-controlled
