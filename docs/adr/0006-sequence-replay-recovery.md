# ADR-0006: Sequence-Based Replay Recovery

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

WebSocket connections drop unexpectedly: mobile network transitions, browser
tabs backgrounded, server restarts, load balancer timeouts. A dropped connection
during token streaming means partial messages with no recovery path. Users
must re-send their query and restart the interaction.

## Decision

Assign every server-to-client message a monotonically increasing sequence number.
Server persists recent messages in Redis for a configurable window (default: 5 minutes).
Client tracks its last-received sequence. On reconnect, client sends `lastSeq` in the
handshake. Server replays all messages from `lastSeq+1` to current.
Client detects mid-stream gaps and requests targeted replay.

## Rationale

Sequence numbers enable three recovery scenarios:

**Reconnect recovery:** Client reconnects after disconnect. Sends `lastSeq=N`.
Server replays N+1 through current. Streaming continues transparently.

**Gap detection:** Client receives seq=M, expects seq=N where N < M. Gap detected.
Buffer messages M+N, request replay of N through M-1, drain buffer in order.

**Idempotent delivery:** Server sends, gets no ack, resends. Client deduplicates
by sequence number. No duplicate tokens rendered.

Redis chosen for replay buffer: O(1) append, range queries by index, built-in TTL.
Postgres would work but adds query latency to the reconnect hot path.

## Consequences

**Positive:** Seamless recovery from transient disconnects. Users see streaming
continue rather than error. Zero data loss within the replay window.

**Negative:** Server must buffer all messages per session in Redis for the TTL window.
At 150 tokens/session-minute, a 5-minute window = 750 messages/session. Manageable.
Sequence tracking adds one integer field to every message.

**Neutral:** Client must implement gap detection logic. Not complex but must be
correct — off-by-one in sequence comparison breaks recovery.

## Sequence Authority

- Server is the sole authority for sequence numbers
- Sequence is per-connection-session, resets on new session
- seq=0 reserved for control messages (handshake, pong)
- Sequence namespace: `session:{sessionId}:seq` in Redis

## Alternatives Considered

### Timestamp-based ordering
Rejected: clock skew between server instances causes ordering ambiguity.
Sequence numbers are unambiguous.

### No replay (reconnect = restart)
Rejected: unacceptable UX. Users lose streaming progress on every network hiccup.

### Message queue (Kafka/RabbitMQ) per session
Rejected: massive operational overhead for per-session replay. Redis sorted sets
achieve the same with orders of magnitude less complexity.
