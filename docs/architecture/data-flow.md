# Data Flow Diagrams

## WebSocket Message Lifecycle

```
Server                                          Client
  │                                               │
  │──── ServerHandshakeAck (seq=0) ──────────────▶│
  │                                               │  state: connected
  │──── ServerStreamStart (seq=1) ───────────────▶│
  │                                               │  stream started
  │──── ServerToken (seq=2, token="Hello") ──────▶│
  │                                               │  enqueue → RAF
  │──── ServerToken (seq=3, token=" world") ─────▶│
  │                                               │  enqueue → RAF fires
  │                                               │  → setState once
  │                                               │  → render
  │──── [connection drops] ────────────────────────│
  │                                               │  state: reconnecting
  │                                               │  backoff(attempt=1) = 250ms
  │◀─── ClientHandshake (lastSeq=3) ──────────────│
  │                                               │
  │──── ServerHandshakeAck (seq=0) ──────────────▶│
  │──── ServerToken (seq=4, token="!") ──────────▶│
  │     [replay from seq=4 — already had 1-3]     │
  │──── ServerStreamEnd (seq=5) ─────────────────▶│
```

## Gap Detection and Recovery

```
Expected: seq=5
Received: seq=8

Gap detected: [5, 6, 7] missing

Actions:
  1. Buffer message seq=8
  2. Send ClientReplayRequest(fromSeq=5, toSeq=7)
  3. Receive ServerReplayChunk with seq=5, seq=6, seq=7
  4. Deliver 5, 6, 7 in order to store
  5. Drain buffer: deliver seq=8
  6. Resume normal delivery at seq=9
```

## Frontend State Machine

```
           connect()
              │
         ┌────▼────┐
         │connecting│
         └────┬────┘
              │ socket.open
         ┌────▼────────┐
         │ handshaking  │
         └────┬────────┘
              │ handshake_ack
         ┌────▼────┐
    ┌────│connected │◀───────────────────┐
    │    └────┬────┘                     │
    │         │ close/error              │
    │    ┌────▼──────────┐              │
    │    │ reconnecting   │              │
    │    └────┬──────────┘              │
    │         │ attempt ≤ max            │
    │         │──────────────────────────┘ (socket.open → handshaking)
    │         │ attempt > max
    │    ┌────▼────┐
    │    │  failed  │
    │    └─────────┘
    │
    │ disconnect()
    │    ┌────────────┐
    └───▶│disconnected│
         └────────────┘
```

## Redis Data Structures

```
Session replay buffer:
  Key: session:{sessionId}:replay
  Type: List (LPUSH / LRANGE)
  TTL: 300s (configurable via WS_REPLAY_TTL_SECONDS)
  Value: JSON-serialized ServerMessage

Session state:
  Key: session:{sessionId}:state
  Type: Hash
  Fields: clientId, lastSeq, connectedAt, userId
  TTL: 600s (refreshed on each message)

Rate limiting:
  Key: ratelimit:{userId}:{windowStart}
  Type: String (INCR)
  TTL: window size
```
