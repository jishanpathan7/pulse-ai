# ADR-0012: Zustand Store Boundaries

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

Frontend state for a streaming AI workspace includes data at wildly different
update frequencies:
- Connection state: rare (5-10 transitions per session)
- Stream tokens: 60 updates/second during streaming
- Completed messages: O(conversation length) updates per session
- UI state: moderate (user interactions)
- Telemetry: 60 updates/second (debug only)

If all state lives in one Zustand store, every subscriber re-renders on
every update — including token updates at 60Hz.

## Decision

Five stores with strict single-concern ownership.

| Store | Update frequency | Subscribers |
|---|---|---|
| `transportStore` | ~5/session | Connection UI only |
| `streamStore` | 60×/s during streaming | Active stream component ONLY |
| `conversationStore` | O(messages) per session | Message list, conversation list |
| `uiStore` | User-driven | Layout components |
| `telemetryStore` | 60×/s (dev only) | Debug panel |

Each store uses `subscribeWithSelector` middleware, enabling components to
subscribe to specific slices (not the full store object).

## Rationale

**Store isolation = rerender isolation.**

The critical case: `streamStore` updates 60 times/second. With one monolithic
store, every component in the app would get a change notification 60×/s.
With separate stores, only components subscribed to `streamStore` are notified.

**Selector discipline further reduces rerenders:**

```typescript
// Bad: creates new object every store update → always re-renders
const data = useStreamStore(s => ({ content: s.activeStreams[id]?.content }));

// Good: returns primitive → React.memo can bail out
const content = useStreamStore(s => s.activeStreams[id]?.content ?? '');
```

**Cross-store communication via direct import (not events):**
`streamStore.finalizeStream()` directly calls `conversationStore.getState().addMessage()`.
No message bus, no event system. Explicit data flow.

## Consequences

**Positive:** Surgical re-renders. The 60fps token stream only re-renders the
active streaming component. All other components are unaffected.

**Negative:** Five stores require discipline. Developers must know which store
to read from. Pre-built selectors (exported from each store file) reduce this.

**Neutral:** Cross-store actions (finalize stream) require importing the target
store from the source store's module. This creates a dependency but it's explicit.

## Alternatives Considered

### Single Zustand store
Rejected: any token update triggers all subscribers. Fatal for performance.

### Jotai atoms
Strong alternative — atom granularity maps perfectly to this problem.
Zustand chosen for its simpler store-level mental model and better TypeScript
inference for actions. Revisit if store complexity grows significantly.

### Redux Toolkit
Rejected: action dispatch overhead + immutability enforcement (Immer) adds
latency in the token flush hot path. RTK is optimized for CRUD, not streaming.
