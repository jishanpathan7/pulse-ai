# API Routes

Route modules registered after all plugins. Each file is a scoped Fastify plugin.

## Structure (Phase 5+)

```
routes/
  health.ts       GET /health — liveness + readiness checks
  ws/
    index.ts      GET /ws — WebSocket upgrade handler
    handlers/
      handshake.ts
      stream.ts
      replay.ts
  v1/
    conversations/ (Phase 6+)
    messages/      (Phase 6+)
```

## WebSocket Handler Architecture

```
/ws upgrade
  ↓
ConnectionManager.register(socket, clientId)
  ↓
SessionStore.restore(clientId) → lastSeq
  ↓
SequenceAuthority assigns session seq namespace
  ↓
Handshake ack sent
  ↓
Messages dispatched to registered handlers by type
```

## Zod Validation

All route schemas defined with Zod, converted to JSON Schema for Fastify.
Request bodies and query params validated before handlers execute.
