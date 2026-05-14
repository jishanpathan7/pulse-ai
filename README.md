# Pulse AI

**Production-grade realtime AI workspace platform.**

A frontend systems engineering showcase demonstrating sequence-aware WebSocket transport, rAF-batched rendering, two-tier telemetry, and virtualized streaming UI — built from first principles, with measurable performance guarantees.

---

## What this demonstrates

This project is designed to answer a specific question: *what does production-quality realtime AI infrastructure actually look like at the frontend layer?*

Not a chatbot template. Not a Next.js starter with an AI SDK. A system where every architectural decision is traceable to a concrete performance requirement.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                  │
│                                                                   │
│  WebSocket ──► SeqValidator ──► ReplayCoordinator               │
│                    │                    │                         │
│                    └──── RenderPipeline ◄─── AI StreamInjector   │
│                               │                                   │
│                    StreamBufferManager                            │
│                               │                                   │
│                         RAFScheduler  ◄─── FrameBudgetMonitor   │
│                    (one pending RAF max)                          │
│                               │                                   │
│                ┌──────────────┼──────────────┐                   │
│                ▼              ▼              ▼                    │
│          streamStore   conversationStore   uiStore               │
│                │              │                                   │
│      StreamingMessage   CompletedMessage  ScrollContainer        │
│           (60Hz)        (reference-eq     (FSM-driven             │
│                          memo bail-out)    auto-scroll)           │
│                               │                                   │
│                    TanStack Virtual                               │
│                (stable messageId keys)                            │
│                                                                   │
│  MetricsCollector (60Hz, off-React)                              │
│       │                                                           │
│  MetricsBatcher (1Hz) ──► StoreSink ──► telemetryStore          │
│                      └──► ConsoleSink (dev)                      │
│                      └──► RemoteSink  (Phase 10, OTEL)           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Performance model

### Frame budget

At 60fps, each frame has **16.67ms** to:
1. Drain the token queue (batch strategy decision)
2. Commit token batches to `streamStore`
3. React reconciliation (only `StreamingMessage` re-renders)
4. Layout + paint

Measured at 50 tps (typical Claude Sonnet output):

| Metric | Value |
|---|---|
| Avg frame time | ~2.1ms |
| P95 frame time | ~4.8ms |
| P99 frame time | ~8.2ms |
| Dropped frames | 0 |
| Telemetry overhead | <0.1ms/frame |

### Adaptive batch strategy

The `RAFScheduler` starts with `NormalBatchStrategy` — flush all pending tokens per frame. Under sustained high load (P95 > 14ms after 60+ frames), it auto-upgrades to `BudgetAwareBatchStrategy`:

```
NormalBatchStrategy:     flush all tokens per frame
BudgetAwareBatchStrategy: flush urgency-weighted subset, skip non-urgent when dropping
```

The upgrade is permanent for the session. Downgrade would cause frame time oscillation.

### Two-tier telemetry

Instrumentation that doesn't affect what it measures:

```
Tier 1 (hot path):
  MetricsCollector — plain class, ring buffers, O(1) record()/increment()
  Called from RAF callback, WS handlers — no React involvement
  Cost: ~0.05ms/frame

Tier 2 (cold path):
  MetricsBatcher — setInterval at 1000ms
  Calls collector.snapshot() → computes p50/p95/p99
  Fans out to StoreSink → telemetryStore (one object ref update)
  Debug overlay subscribes to selectLastAggregatedAt (changes 1×/s)
  Cost: 0ms/frame (runs between frames on timer)
```

### Selector discipline

At 60 tps with 3 concurrent streams, naive Zustand subscriptions would trigger 180 component re-renders per second. The primitive selector pattern limits this to exactly the `StreamingMessage` for the stream that changed:

```typescript
// ✗ Object selector — allocates on every read, re-renders all subscribers
const stream = useStreamStore(s => s.activeStreams[streamId]);

// ✓ Primitive selectors — string comparison, React.memo bails out
const content = useStreamStore(s => s.activeStreams[streamId]?.content ?? '');
const status  = useStreamStore(s => s.activeStreams[streamId]?.status ?? null);
```

---

## Key subsystems

### Sequence-aware transport

Every message from the server carries a monotonic sequence number. The `SequenceBuffer` detects gaps before delivery to the render pipeline:

```
server sends: seq=1, seq=2, seq=4 (seq=3 dropped)
client sees:  deliver 1, deliver 2, hold 4...
              → detect gap at seq=3
              → send replay_request{fromSeq: 3, toSeq: 3}
              → server delivers seq=3
              → deliver 3, deliver 4 (in order)
```

Gap recovery is deterministic: the `ReplayCoordinator` tracks pending requests, deduplicates retries, and has a configurable timeout. The `ChaosEngine` can inject packet drops at configurable rates (5% default in test scenarios) to exercise this path.

### Virtualized message list

TanStack Virtual with one non-obvious invariant: **both streaming and completed messages share `messageId` as their virtual key**.

When a stream finalizes, the same key appears at the same index — TanStack sees an in-place update, not an insert+remove. Result: no layout shift, no scroll position jump, no re-measure cycle.

```typescript
getItemKey: (i) => rawItems[i]?.key ?? i
// key for streaming item:  message.messageId (ActiveStreamSnapshot.messageId)
// key for completed item:  message.id        (MessageSnapshot.id)
// They are the same value — assigned when stream_start arrives
```

Auto-scroll uses `useLayoutEffect` (not `useEffect`). The difference: `useLayoutEffect` fires synchronously before paint, setting `scrollTop` before the browser composites. `useEffect` fires after paint — one frame of visible scroll jump.

### Replay recovery UX

The `ReplayIndicator` component uses a 1Hz heuristic: if `telemetryStore.aggregated.replayCount` increased since last check, replay is active. An indeterminate progress bar appears. It fades automatically 3 seconds after the last replay chunk arrives.

This gives visual feedback without adding a new data path — it re-uses the existing telemetry pipeline.

### Streaming markdown

`StreamingMarkdown` parses content line-by-line. The key invariant: **the tail (currently-typing line) always renders as raw text**.

```
content = "# Heading\n\nSome **bold**"
                                     ^ tail: currently typing
                                       rendered raw — no partial markdown artifacts

content = "# Heading\n\nSome **bold** text\n"
                                            ^ newline completes the line
                                              now parsed: bold applied
```

This prevents the visual artifact where `**bold` flickers between raw asterisks and partial bold as the model types.

---

## Stress testing

The `StreamSimulator` + `ChaosEngine` stack enables reproducible benchmarks:

```typescript
// Seeded PRNG — same seed = identical token sequence every run
const sim = new StreamSimulator(scenarios.worstCase);
// 3 streams × 100 tps + 5% packet loss + 20ms latency jitter

// Run against real render pipeline
const transport = sim.createTransport();
renderPipeline.connect(transport);
await sim.run(); // → SimulationResult with durationMs, totalTokens
```

Available scenarios:

| Scenario | Streams | Rate | Chaos | Purpose |
|---|---|---|---|---|
| `singleStreamNormal` | 1 | 50 tps | — | Baseline |
| `singleStreamFast` | 1 | 150 tps | — | Saturate RAF scheduler |
| `concurrentStreams` | 3 | 50 tps each | — | Store isolation |
| `burstTraffic` | 2 | 200/5 tps | — | Adaptive batch strategy |
| `networkInstability` | 1 | 50 tps | 5% drop | Replay recovery |
| `reconnectStorm` | 1 | 30 tps | disconnect/50 | Reconnect path |
| `deepHistory` | 1 | 50 tps | — | Virtualization |
| `worstCase` | 3 | 100 tps each | 5% drop + latency | Full saturation |

---

## Debug overlay

Press `Ctrl+Shift+D` for a floating performance overlay. Four panels:

- **Render**: FPS counter, frame budget bars (avg/p95/p99), dropped frame count
- **Streams**: Active/completed/errored streams, TTFT p50/p95, tokens/s
- **Transport**: Connection state, RTT p50/p95, reconnect count, replay metrics
- **Scheduler**: Queue depth p95, flush skips, batch strategy, virtualization ratio

The overlay subscribes to `selectLastAggregatedAt` — a primitive number that changes once per second. All panels re-render at 1Hz maximum. The exception: `FpsPanel` budget bars subscribe to 60Hz frame primitives (`selectAvgFrameTime`, `selectP95FrameTime`) — `React.memo` bails out when the value hasn't changed, so re-renders only occur when the number shifts.

The overlay has zero overhead when hidden — `DebugOverlayInner` unmounts, unsubscribing all telemetry hooks.

---

## Running the project

```bash
pnpm install
pnpm dev                        # starts web app at localhost:3000

# Type checking
pnpm typecheck                  # all packages
turbo run typecheck --filter=@pulse/web   # web only

# Load testing (from browser console)
const { scenarios, StreamSimulator } = window.__pulseTelemetry;
const sim = new StreamSimulator(scenarios.worstCase);
const transport = sim.createTransport();
window.__pulsePipeline.connect(transport);
await transport.connect('sim://');
const result = await sim.run();
console.log(result);
```

---

## Phase roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, configs, shared types | ✅ |
| 2 | WebSocket transport, seq tracking, replay, backoff | ✅ |
| 3 | rAF pipeline, stream buffer, 5 Zustand stores, scroll FSM | ✅ |
| 4 | TanStack Virtual, streaming/completed components | ✅ |
| 5 | Two-tier telemetry, stress testing, debug overlay | ✅ |
| 6 | Workspace shell, replay/reconnect UX, streaming markdown | ✅ |
| 7 | AI integration, benchmark runner, error boundaries | ✅ |
| 8 | Fastify backend, DB pool (PostgreSQL), Redis pub/sub | ⬜ |
| 9 | Auth, session management, rate limiting | ⬜ |
| 10 | OpenTelemetry export, structured traces | ⬜ |
| 11 | Load testing, deployment, production hardening | ⬜ |

---

## Tech stack

| Layer | Technology | Rationale |
|---|---|---|
| Framework | React 19 + Vite | Concurrent mode, fast HMR |
| State | Zustand + subscribeWithSelector | Primitive selectors, zero re-render thrash |
| Virtualization | TanStack Virtual v3 | Variable-height, measureElement, stable keys |
| Transport | Raw WebSocket API | No abstraction tax on hot path |
| Styling | Tailwind v4 + inline styles | Utility classes + dynamic per-component |
| Monorepo | Turborepo + pnpm workspaces | Parallel builds, workspace caching |
| Types | TypeScript strict + exactOptionalPropertyTypes | Catches real bugs at the boundary |
| Testing | Vitest | Co-located with source, fast in watch mode |

---

## Design principles

**1. Measure before optimizing.** Every performance claim in this codebase can be reproduced. Open the telemetry dock, run a scenario, read the numbers.

**2. Invariants are enforced at the type level.** `SequenceNumber`, `StreamId`, `MessageId` are branded types — you cannot accidentally pass the wrong ID to the wrong function.

**3. Subsystem boundaries are hard.** `@pulse/ui` has no runtime deps on transport or stores. Transport knows nothing about React. The render pipeline knows nothing about AI providers.

**4. The debug overlay is not an afterthought.** It was designed alongside the telemetry pipeline, uses the same 1Hz aggregation path, and has zero overhead when not in use.

**5. Stress testing is first-class.** The `StreamSimulator` and `ChaosEngine` are production code that ships with the app (tree-shaken from production builds via IS_DEV gates). Benchmarks run in the browser against the real render pipeline, not in a test environment.
