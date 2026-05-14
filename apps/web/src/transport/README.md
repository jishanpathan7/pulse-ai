# Transport Layer (Frontend)

## Component Map

```
WsTransportClient (ws-client.ts)
  │
  ├── TransportStateMachine     ownership of connection state
  │     reduce(state, event) → state  (pure function, testable)
  │     States: idle → connecting → handshaking → connected
  │             connected → reconnecting → connecting  (auto-retry)
  │             connected → disconnected  (intentional)
  │             reconnecting → failed  (exhausted)
  │
  ├── SequenceTracker           classify incoming seq numbers
  │     in_order  → deliver and advance expectedSeq
  │     gap       → buffer message, request replay
  │     duplicate → drop (idempotent)
  │     control   → bypass seq tracking (seq=0)
  │
  ├── SequenceBuffer<SequencedServerMessage>
  │     holds out-of-order messages pending gap fill
  │     drainConsecutive(fromSeq) → delivers contiguous block
  │
  ├── ReplayCoordinator         at-most-one-replay invariant
  │     requestReplay(from, to) → request | null (if covered)
  │     onChunkReceived()
  │     complete() → fires onComplete callback
  │     abort() → on reconnect
  │
  ├── ExponentialBackoff        reconnect timing
  │     full jitter: random(0, min(cap, base * 2^attempt))
  │
  ├── HeartbeatScheduler        dead-connection detection
  │     start(onSend, onTimeout)
  │     onPong(msg) → LatencyMeasurement
  │     stop()
  │
  ├── StreamRegistry            stream lifecycle tracking
  │     onStreamStart / onToken / onStreamEnd / onStreamError
  │     abortAll() → on disconnect
  │
  └── Codec
        encode(ClientMessage) → string
        decode(string) → Result<ServerMessage, PulseError>
```

## Message Flow (Happy Path)

```
WebSocket.onmessage(raw)
  │
  ▼
codec.decode(raw) → Result<ServerMessage>
  │   decode error → emitError(), return
  ▼
dispatchMessage(message)
  │
  ├── type='pong'         → heartbeat.onPong()
  ├── type='handshake_ack' → machine.transition(HANDSHAKE_ACK)
  │                           heartbeat.start()
  │                           resolve connect() promise
  ├── type='replay_chunk' → seqBuffer.push(innerMessages)
  │                           if isLast: replayCoordinator.complete()
  │                                      drainBuffer()
  │
  └── type=sequenced      → seqTracker.classify(seq)
        in_order  → markDelivered, deliverMessage, drainBuffer
        gap       → seqBuffer.push, replayCoordinator.requestReplay
        duplicate → drop
```

## Message Flow (Gap Recovery)

```
recv seq=9, expectedSeq=5
  │
  GAP DETECTED: [5..8] missing
  │
seqBuffer.push(msg_seq9)
  │
replayCoordinator.requestReplay(fromSeq=5, toSeq=8)
  │  (returns request message — only one active at a time)
  │
send(replay_request{from=5, to=8})
  │
recv replay_chunk([5,6,7,8], isLast=true)
  │
seqBuffer.push(5,6,7,8)
replayCoordinator.complete() → onReplayComplete callback
  │
drainBuffer() from expectedSeq=5
  → delivers 5,6,7,8 in order (markDelivered each)
  → expectedSeq advances to 9
  │
drainBuffer() again from expectedSeq=9
  → seqBuffer has msg_seq9 → delivers it
  → expectedSeq advances to 10
```

## Reconnect Flow

```
connection drops
  │
heartbeat.stop()
machine.transition(SOCKET_CLOSE, intentional=false)
  → state: reconnecting
replayCoordinator.abort()
seqBuffer.clear()
  │
  ← seqTracker.lastDelivered RETAINED (e.g., 42)
  │
scheduleReconnect(attempt+1)
  → backoff.nextDelayMs(attempt) ms delay
  → openSocket()
  │
socket.open → handshaking
send(handshake{clientId, lastSeq=42, protocolVersion='1'})
  │
server looks up session for clientId
server resumes from seq=43
  │
recv handshake_ack{sessionId, resumedFromSeq=42}
machine.transition(HANDSHAKE_ACK)
heartbeat.start()
  │
recv seq=43, 44, 45... → normal delivery
streaming resumes transparently
```

## Invariants (NEVER break)

1. `seqTracker.lastDelivered` is ONLY reset via `reset()` on a clean new session
2. At most one `replay_request` in-flight per connection
3. `markDelivered(seq)` only called after `classify()` returns `in_order`
4. `heartbeat.start()` only called in `handshake_ack` handler
5. `streamRegistry.abortAll()` called on every non-intentional close
6. `connectResolve` is resolved exactly once (on first handshake success or failure)
