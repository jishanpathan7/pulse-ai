# ADR-0003: Zustand for Frontend State Management

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

Frontend state includes: WebSocket connection state, active streaming sessions,
token buffers, conversation history, and UI state. Streaming produces state
updates at up to 60+ tokens/second. State management must support selective
re-subscription (only components that care about token X re-render on token X).

## Decision

Use Zustand for all application state. No Redux, no Context API for
performance-sensitive state.

## Rationale

Zustand's selector-based subscription model maps directly to our performance
requirements:
- Token buffer store: only the active message renderer subscribes
- Connection store: only the transport status indicator subscribes
- Conversation store: list components subscribe, stream components do not

React Context forces all consumers of a context to re-render on any change.
At 60+ tokens/second this would cause the entire app to re-render every ~16ms.

Redux adds indirection (actions → reducers → selectors) that provides auditing
value but adds latency in the hot path. For streaming token ingestion the hot
path must be minimal.

Zustand's `subscribeWithSelector` middleware enables the exact subscription
granularity needed without custom memoization overhead.

## Consequences

**Positive:** Surgical re-renders. Token streaming triggers only the active
message renderer. Connection state change triggers only transport UI.

**Negative:** Less opinionated — discipline required to keep stores clean.
No built-in devtools as rich as Redux DevTools (Zustand has basic devtools).

## Alternatives Considered

### Redux Toolkit
Rejected: action dispatch overhead unacceptable in the streaming hot path.
RTK Query is unnecessary complexity for a WebSocket-first app.

### React Context + useReducer
Rejected: no selector granularity — any context value change re-renders all
context consumers. Fatal for streaming performance.

### Jotai
Strong alternative. Atom-based granularity matches our needs.
Zustand chosen for simpler store-level organization and larger ecosystem.
