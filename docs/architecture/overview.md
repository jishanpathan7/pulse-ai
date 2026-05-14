# Architecture Overview

Pulse AI is a production-grade realtime AI workspace platform. The defining
engineering constraint is low-latency streaming: tokens must flow from the AI
provider to rendered pixels in the browser with minimal delay and no dropped
frames, even under poor network conditions.

## High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser (apps/web)                            │
│                                                                      │
│  ┌──────────────┐    ┌───────────────┐    ┌────────────────────┐   │
│  │  Transport   │    │  State Layer  │    │   Render Layer     │   │
│  │  (WS Client) │───▶│  (Zustand)    │───▶│  (rAF + Virtual)  │   │
│  │  + Seq Track │    │  Stores       │    │  TanStack Virtual  │   │
│  └──────┬───────┘    └───────────────┘    └────────────────────┘   │
│         │ WebSocket                                                  │
└─────────┼───────────────────────────────────────────────────────────┘
          │ ws://
┌─────────┼───────────────────────────────────────────────────────────┐
│         │              API Server (apps/api)                         │
│  ┌──────┴───────┐    ┌───────────────┐    ┌────────────────────┐   │
│  │  WS Handler  │    │  Session Mgr  │    │  Stream Proxy      │   │
│  │  + Seq Auth  │───▶│  + Seq Buffer │───▶│  (Phase 6)         │   │
│  └──────────────┘    └───────────────┘    └────────────────────┘   │
│         │                    │                      │               │
└─────────┼────────────────────┼──────────────────────┼──────────────┘
          │                    │                      │
    ┌─────▼─────┐       ┌──────▼──────┐      ┌───────▼──────┐
    │ PostgreSQL │       │    Redis     │      │  AI Provider │
    │  (durable) │       │  (ephemeral) │      │  (Phase 6)   │
    └───────────┘       └─────────────┘      └──────────────┘
```

## Data Flow: Token Streaming

```
AI Provider
  ↓ chunk (SSE/HTTP stream)
API: Stream Proxy unpacks tokens
  ↓
API: SequenceAuthority assigns seq number
  ↓
API: Redis LPUSH to session replay buffer
  ↓
API: WebSocket send to connected client
  ↓
Browser: TransportClient receives ServerTokenMessage
  ↓
Browser: Sequence tracker validates seq — gap? → replay request
  ↓
Browser: Token enqueued in rAF token queue (no setState yet)
  ↓
Browser: requestAnimationFrame callback fires (≤16ms)
  ↓
Browser: Queue drained → single setState call
  ↓
React re-renders active message node
  ↓
TanStack Virtual re-measures item height if needed
  ↓
Paint
```

## Subsystem Responsibilities

See [subsystems.md](./subsystems.md) for detailed boundaries.

## Package Dependency Graph

```
@pulse/types          (no deps — pure type contracts)
    ↑
@pulse/utils          (no deps — pure functions)
    ↑
@pulse/logger         (← @pulse/types)
@pulse/telemetry      (← @pulse/types)
@pulse/transport      (← @pulse/types, @pulse/utils)
    ↑
@pulse/ui             (← React, Tailwind — no @pulse/* runtime deps)
    ↑
apps/web              (← all packages)
apps/api              (← @pulse/types, utils, logger, telemetry)
```

**Rule:** No circular deps. `@pulse/ui` never imports from `@pulse/transport`
or `@pulse/telemetry`. UI is purely presentational.
