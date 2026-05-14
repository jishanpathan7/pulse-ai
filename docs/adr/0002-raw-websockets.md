# ADR-0002: Raw WebSockets Over Socket.io

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

The primary communication channel is real-time token streaming from server to
client. Latency at each layer directly affects perceived response speed.
The platform requires: ordered delivery guarantees, custom sequence tracking,
and full control over reconnection behavior to support sequence-based replay
recovery.

## Decision

Use the browser WebSocket API and the Node.js `ws` library directly.
No Socket.io, no abstraction layers between the application and the WebSocket frame.

## Rationale

Socket.io adds:
- HTTP long-polling fallback (unnecessary — we target modern browsers)
- Engine.io framing overhead on every message
- Its own namespace/room abstraction (we build our own session model)
- Custom reconnection logic that conflicts with our sequence-based recovery

Raw WebSockets give us:
- Zero framing overhead beyond the WS spec
- Full control over reconnection timing and sequence tracking
- Binary frame support (needed for future audio streaming)
- Simpler mental model: one WebSocket = one sequenced message stream

Latency impact: Socket.io adds ~2-5ms per message in CPU overhead at 1k msg/s
from additional parsing and event routing.

## Consequences

**Positive:** Lower message latency. Full control over reconnection and
sequence recovery. No third-party reconnection logic to fight.

**Negative:** Must implement our own reconnection, heartbeat, and message
framing. More code to own and test.

**Neutral:** `@fastify/websocket` wraps `ws` natively — no friction on server side.

## Alternatives Considered

### Socket.io
Rejected: framing overhead, opaque reconnection logic conflicts with custom
sequence tracking, HTTP polling fallback is dead weight.

### SSE (Server-Sent Events) for streaming
Rejected: unidirectional — cannot send client acknowledgements or replay requests
over the same channel. Would require separate HTTP channel for client→server.
