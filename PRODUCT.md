# Pulse AI — Product Overview

## What Is It

Pulse AI is a realtime AI workspace built for engineers and operators who care
about **performance, observability, and reliability** — not just getting an
answer back.

Most AI interfaces treat the chat surface as an afterthought. Tokens appear,
text renders, done. Pulse treats the streaming surface as a first-class
engineering problem: every token is tracked, every frame is measured, every
dropped connection is recovered from, and every render commit is observable
in a live diagnostics rail alongside the conversation itself.

---

## The Problem It Solves

When you build or operate AI-powered products, three things break in
production that no standard chat interface surfaces:

### 1. Rendering latency is invisible
You see tokens appear. You don't see that your render pipeline is taking 40ms
per commit — 2.5x over budget — because no one instrumented it. Frame drops,
jank, and queue backup compound silently. By the time users complain, you have
no data.

### 2. Streaming reliability is assumed, not guaranteed
WebSocket connections drop. SSE streams stall. Mobile clients switch networks
mid-session. Standard implementations lose the in-flight tokens and start
over. Users see incomplete responses. Your retry logic races with re-renders.

### 3. Debugging requires guesswork
When something is slow — is it the AI provider? The network? The WebSocket
handler? The React component tree? Standard tools give you server latency.
They don't give you decode time, append time, render time, and commit time
broken out per frame.

---

## How We Solve It

### Realtime streaming surface
Tokens stream from the AI provider via WebSocket. The browser renders them
using a **requestAnimationFrame-batched pipeline** — tokens are coalesced per
frame, not per token, keeping render commits at 60fps regardless of token
rate. A blinking cursor, animated stream chip, and lifecycle state machine
(idle → streaming → finalizing → complete) make the stream feel alive and
controlled.

### Sequence-based replay recovery
Every message from the server carries a monotonic sequence number. The client
tracks the last seen sequence. On reconnection — from any cause: network drop,
tab background, mobile sleep — the client sends its last known sequence, and
the server replays the gap from a Redis buffer. **Sessions resume from the
exact token offset. No output is lost.**

### Live telemetry rail
A built-in diagnostics panel shows — live, at 60fps — the metrics that matter:

| Metric | What it tells you |
|---|---|
| WebSocket latency (p50/p95) | Network + server overhead |
| Render FPS | Are you hitting the 16ms frame budget? |
| Frame commit time (avg/p95) | React reconciliation cost |
| Dropped frames | Where your pipeline falls over |
| Active streams | How many concurrent renders |
| Reconnect count | Connection reliability |
| Budget violations | Frames that exceeded 16ms threshold |
| Replay chunks | How often gap recovery fired |

### Chaos simulation
The Chaos Panel lets operators inject synthetic load directly into the render
pipeline: normal streams, fast streams, concurrent bursts, network instability,
reconnect storms, worst-case scenarios. No backend needed — the stress engine
generates realistic token sequences and drives the full pipeline end to end.

### Benchmark runner
Eight reproducible scenarios with pass/fail thresholds (p95 ≤ 14ms, drop rate
≤ 2%). Run before a deploy, compare against baseline, catch regressions before
users do.

---

## Who Is It For

**Primary:** Engineers building or operating AI-powered products who need to
understand and optimize their streaming pipeline.

**Secondary:** AI teams evaluating model latency and throughput characteristics
in realistic rendering conditions.

**Not for:** Casual AI chat users. Pulse is an operator's surface. It exposes
internals intentionally.

---

## User Flow

### First visit — Landing page (`/`)

User lands on the marketing page. Key information above the fold:
- Value proposition: realtime streaming with live telemetry
- Live preview tile showing a streaming response with real metrics (tok/s, ws
  p99, commit time, fps)
- Social proof: metrics strip (38ms p50, 99.97% uptime, 2.8B tokens/month)
- Three primitives: streaming surface, telemetry rail, resilience layer
- Five-stage flow diagram from cold start to committed token
- Pipeline architecture schematic (client → WS/SSE → inference → buffer →
  memo → commit → telemetry)
- CTA: "Start free · 14 days" → enters workspace

### Workspace entry (`/app`)

**If no sessions exist — Empty workspace (Screen 5)**

User sees:
- Fraunces serif headline: "A workspace built for *realtime* reasoning"
- Three CTA buttons: Start a session / Diagnostics / Chaos panel
- Six starter workflows (one-click prompts): audit a streaming pipeline, trace
  a websocket reconnect, diff a frontend regression, design a backpressure
  policy, write an SLA postmortem, free-form session
- Keyboard shortcuts reference
- Slash commands reference (`/profile`, `/replay`, `/snapshot`, `/diff`,
  `/trace`, `/benchmark`)
- Status probes: WebSocket state, render pipeline, token stream, diagnostics

### Active session — Conversation (Screen 1 + 2)

**Composing a message**

The composer bar at the bottom shows:
- Model indicator (CLAUDE), context size (128K CTX), slash command hint
- On focus: border turns accent-orange
- Typing activates send button; Shift+Enter for newline; Enter sends

**Message sent**

1. User message appears immediately with square "YOU" avatar, mono timestamp
2. WebSocket sends to backend
3. Backend streams from Anthropic API, assigns sequence numbers, relays via WS
4. Browser receives tokens, enqueues in rAF buffer
5. Per-frame: queue drains → single setState → React re-renders tail of message
6. AI message shows: orange "P" avatar, animated STREAMING chip, blinking
   cursor at insertion point, token-by-token text appearing
7. On complete: cursor disappears, STREAMING chip gone, copy/regenerate actions appear

**During streaming**
- Jump pill appears at bottom: "↓ Jump to latest [J]" — click or press J to
  scroll to bottom
- Diagnostics panel updates live: fps, ws latency, commit time, active streams
- Status bar footer: "CONNECTED · 1 STREAM"

### Right dock panels

**Diagnostics (Screen 3)**

Two views:
- **Live**: ws latency sparkline, fps gauge, frame commit bar chart, active
  streams count, connection stats, recent event log
- **Debug**: tabbed detail — Render / Streams / Transport / Scheduler panels

**Chaos panel**

- Select scenario from list (normal, fast, concurrent, burst, instability,
  reconnect storm, deep history, worst case)
- Config preview: stream count, duration, chaos params (drop rate, disconnect
  timing, latency jitter)
- Run → synthetic traffic flows through full pipeline
- Progress bar, stop button
- Status bar reflects simulation state

**Benchmark panel**

- Checklist of scenarios (all selected by default)
- Run → sequential execution, progress tracking, current scenario highlighted
- Results: per-scenario p95/drop/tps with pass/fail indicators
- Summary: total duration, worst p95, worst drop rate
- Export: full report to console

### Connection failure — Reconnect states (Screen 4)

**Reconnecting banner** (yellow, top of conversation pane):
- Animated reconnecting dots
- Attempt count and backoff schedule displayed
- Manual "Try now" button

**Failed banner** (red):
- Clear failure state with "Reconnect" CTA
- Last connected timestamp

**Gap recovery banner** (yellow, replay):
- Animated progress bar while replaying missed chunks
- Chunk count and p95 replay duration displayed

### Sidebar

- Session list grouped by date (Today / Yesterday / This week / Older)
- Active session highlighted with accent left border
- Session title + preview text
- "+ New session" button
- Footer: stream active indicator, connection status

---

## Architecture in a Line

```
Browser rAF pipeline ← WebSocket ← Fastify WS handler ← Anthropic stream
     ↕                                    ↕
  Zustand stores                    Redis replay buffer + PostgreSQL sessions
     ↕
  TanStack Virtual (virtualized message list)
     ↕
  Live telemetry (ring buffer → aggregation → UI)
```

---

## Key Engineering Constraints (Non-negotiable)

| Constraint | Reason |
|---|---|
| One RAF pending at a time | Multiple concurrent RAFs = duplicate renders |
| Server is sequence authority | Client never generates sequence numbers |
| `@pulse/ui` has no runtime deps on `@pulse/transport` | UI is pure presentation |
| No `setState` in WS `onmessage` | Always via rAF queue → store |
| All cross-boundary failures return `Result<T, E>` | Never throw across subsystems |
| No circular package imports | Enforced by ESLint `no-cycle` rule |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | React 19 + Vite + TypeScript |
| State | Zustand (selector-based subscriptions) |
| Virtualization | TanStack Virtual (variable-height) |
| Styling | Tailwind v4 + custom CSS design system |
| Transport | Raw WebSocket API (browser) + `ws` (server) |
| Backend | Fastify v5 |
| Database | PostgreSQL (raw `pg` — no ORM) |
| Cache / PubSub | Redis (`ioredis`) |
| AI Provider | Anthropic Claude (via server-side proxy) |
| Logger | pino |
| Telemetry | OpenTelemetry SDK |
| Testing | Vitest |

---

## Current Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, configs, shared types, docs | ✅ Done |
| 2 | Transport — WS state machine, seq tracking, replay, backoff | ✅ Done |
| 3 | Render pipeline — RAF scheduler, stream buffer, 5 Zustand stores | ✅ Done |
| 4 | React rendering — TanStack Virtual, streaming component, scroll | ✅ Done |
| 5 | Observability — two-tier telemetry, metrics pipeline, stress testing | ✅ Done |
| 6 | Workspace — markdown rendering, layout, reconnect UX, chaos panel | ✅ Done |
| 7 | AI integration — provider abstraction, AnthropicAdapter, StreamInjector | ✅ Done |
| 8 | Backend core — Fastify bootstrap, DB pool, Redis, health | ⬜ Next |
| 9a | Auth — JWT, sessions, rate limiting | ⬜ |
| 9b | AI backend — stream proxy, WS handler, sequence authority | ⬜ |
| 10 | Telemetry — OTEL traces, metrics, structured events | ⬜ |
| 11 | Production — load testing, deploy pipeline, infra | ⬜ |

Phases 1–7 complete. Frontend fully functional against DemoAdapter (synthetic
streaming). AnthropicAdapter wired but calls Anthropic directly from browser
(API key exposure risk — fixed in Phase 9b when server-side proxy ships).
