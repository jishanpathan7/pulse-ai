# ADR-0013: Immutable Render Snapshots

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

`conversationStore` holds the authoritative message history. Components
render from this store. When new messages arrive or streams complete,
the store updates.

Without immutability:
- A component holding a reference to a message object could observe it mutate
  without React re-rendering
- `React.memo` cannot use reference equality to bail out (the reference is
  stable but the content changed)
- Debugging becomes harder (past values are overwritten)

## Decision

All values stored in `conversationStore` are created via snapshot factories
that call `Object.freeze()` on the returned object and its arrays.

```typescript
// Snapshot factory (enforces immutability)
function createMessageSnapshot(params): MessageSnapshot {
  return Object.freeze({ ...params });
}

// Conversation snapshot (freezes both object and messages array)
function createConversationSnapshot(params): ConversationSnapshot {
  return Object.freeze({
    ...params,
    messages: Object.freeze([...params.messages]),
  });
}
```

TypeScript's `readonly` fields enforce immutability at compile time.
`Object.freeze()` enforces it at runtime — mutation throws in strict mode.

## Rationale

**Reference equality as a change signal.**
When a stream completes:
1. `snapshotFromActiveStream()` creates a new frozen `MessageSnapshot`
2. `appendMessage()` creates a new frozen `ConversationSnapshot` containing it
3. The store's `conversations[id]` reference changes
4. Components subscribed to this conversation re-render exactly once
5. Components subscribed to other conversations: no re-render (their reference unchanged)

**`React.memo` reliability.**
A memoized component that receives a `MessageSnapshot` prop bails out of
re-render when the reference is stable. Since snapshots are frozen and never
mutated, a stable reference means stable content.

**`ActiveStreamSnapshot` is NOT frozen.**
`streamStore`'s `ActiveStreamSnapshot` is replaced (new object) on every RAF
flush. The old object reference becomes stale. Components must NOT hold
references to active stream snapshots beyond a single render cycle.

## Consequences

**Positive:** Predictable rendering. Reference equality is a reliable change
signal. `React.memo` works correctly. No accidental mutation bugs.

**Negative:** Every update creates new objects. At 60fps for an active stream,
`commitTokenBatch()` creates one new `ActiveStreamSnapshot` per frame per stream.
V8 handles this well (short-lived objects collected by minor GC).

**Neutral:** Developers cannot mutate snapshots. All changes must go through
store actions, which create new frozen objects.

## `ActiveStreamSnapshot` Exception

`ActiveStreamSnapshot` in `streamStore` is frozen (each RAF flush produces
a new frozen object) but it's NOT a permanent record. It's evicted when the
stream finalizes. The term "immutable" in this ADR refers specifically to
the permanent records in `conversationStore`.

The distinction:
- `conversationStore` snapshots: permanent, frozen, never replaced once added
- `streamStore` snapshots: transient, replaced per frame, evicted on finalization
