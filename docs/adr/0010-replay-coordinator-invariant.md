# ADR-0010: At-Most-One-Active-Replay-Per-Connection

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

When a gap in sequence numbers is detected (seq expected=5, received=9),
the client requests a replay of messages 5-8. During this replay:

1. More messages may arrive (seq=10, seq=11, etc.) — buffered
2. Another gap may be detected within those buffered messages

Without coordination, the client would send multiple concurrent replay
requests: one for [5,8] and one for [10,12], for example. The server
processes them independently and sends overlapping chunks. The client
must then reconcile multiple in-flight replays, which is complex and
error-prone.

Burst packet loss (e.g., 200ms network hiccup) can create cascading gaps
that trigger a storm of replay requests, overwhelming the server's Redis
query capacity.

## Decision

Enforce at-most-one active replay per connection.

`ReplayCoordinator` maintains a single `active: ActiveReplay | null` slot.
When a new gap is detected while a replay is active:
- If the new gap is fully within the active range → no new request
- If the new gap extends beyond the active range → widen the active range,
  send a widened request

Only one `replay_request` message is in-flight at any time.

## Rationale

**Single replay simplifies server-side handling.**
The server's `ReplayBuffer.query(from, to)` is one sorted set range query.
Multiple concurrent requests would require the server to track per-client
replay state — avoided entirely.

**Range widening is correct.**
If active range is [5,8] and a new gap is detected at [10,12], the widened
request [5,12] returns a superset that covers both gaps. The client deduplicates
already-delivered messages from the replay chunks (already-delivered seqs
are classified as `duplicate` and dropped).

**Prevents request storms.**
Burst packet loss creating 50 gaps → one replay request for the full gap range,
not 50 individual requests. The server handles one bulk query instead of 50
point queries.

## Consequences

**Positive:** Simple server-side replay. No concurrent replay state.
Storm protection. Predictable behavior under adverse network conditions.

**Negative:** If the gap range is very large (e.g., a 30-second disconnect),
the replay query range may be wide. Mitigated by `MAX_MESSAGES` cap in
`ReplayBuffer` — if gaps are too old, replay fails with a "replay unavailable"
signal and the client reconnects clean.

**Neutral:** `complete()` must be called exactly once when `isLast=true`
is received. This is enforced by the coordinator — calling `complete()` when
no replay is active is a no-op.

## Sequence Diagram

```
Client                                    Server
  │                                          │
  │ recv seq=9, expected=5                   │
  │ GAP: [5..8]                             │
  │──── replay_request(from=5, to=8) ───────▶│
  │                                          │
  │ recv seq=10 (buffer it)                  │
  │ new gap? no — covered by active [5..8]  │
  │                                          │
  │ recv seq=12 (buffer it)                  │
  │ new gap: seq=11 not yet received         │
  │ extends active? yes: widen to [5..11]   │
  │──── replay_request(from=5, to=11) ──────▶│
  │                                          │
  │◀─── replay_chunk([5,6,7,8], isLast=F) ──│
  │◀─── replay_chunk([9,10,11], isLast=T) ──│
  │                                          │
  │ complete() called                        │
  │ drain buffer: deliver 5,6,7,8,9,10,11,12│
  │ resume normal delivery                   │
```
