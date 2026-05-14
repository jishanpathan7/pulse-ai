# ADR-0015: Two-Tier Telemetry Architecture

**Status:** Accepted  
**Date:** 2026-04-30  
**Deciders:** Engineering

---

## Context

Phase 5 adds comprehensive performance observability to the realtime rendering
pipeline. The challenge is collecting metrics at high frequency (60Hz from RAF
callbacks) without contributing to the frame budget pressure we are measuring.

A naïve approach — calling `setState` or writing directly to Zustand on every
frame — would cause the debug overlay to re-render at 60Hz, consuming render
budget that belongs to the streaming pipeline.

---

## Decision

**Two-tier telemetry: hot collection (60Hz) + cold aggregation (1Hz).**

### Tier 1 — MetricsCollector (hot path, off-React)

`MetricsCollector` is a plain class (not a React hook, not Zustand). It owns:
- `CircularBuffer` ring buffers per metric (512 samples)
- O(1) `record()`, `increment()`, `timing()` methods
- `snapshot()` to compute p50/p95/p99 percentiles on demand (called 1Hz)

**Zero React involvement.** Instrumentation modules call into it from:
- RAF pipeline callbacks (`renderInstrumentation.recordFrame`)
- WebSocket message handlers (`transportInstrumentation.onMessage`)
- Stream lifecycle hooks (`streamInstrumentation.onToken`)

### Tier 2 — MetricsBatcher → StoreSink (cold path, 1Hz)

`MetricsBatcher` runs a `setInterval` at 1000ms. Each tick:
1. Calls `collector.snapshot()` to aggregate the ring buffer
2. Fans out to registered sinks (`ConsoleSink`, `StoreSink`, `RemoteSink`)
3. Calls `collector.resetWindow()` to clear the per-second samples

`StoreSink` calls `useTelemetryStore.getState().updateAggregatedMetrics(snapshot)`.
This replaces a single object reference in the store — one Zustand notification,
at most once per second.

### Debug overlay subscription model

The debug overlay is gated by `IS_DEV && visible`. When visible:

- `DebugOverlayInner` subscribes to `selectLastAggregatedAt` (primitive `number`)
  via `subscribeWithSelector`. This fires at 1Hz when the batcher writes.
- Each panel (`FpsPanel`, `StreamPanel`, etc.) reads from `selectAggregated`.
  `React.memo` + primitive field reads mean a panel only re-renders if its
  specific fields changed.
- **Exception**: `FpsPanel` budget bars also subscribe to
  `selectAvgFrameTime`, `selectP95FrameTime`, `selectDroppedFrames` — these
  update at 60Hz but are primitives. `React.memo` bails out when the number
  hasn't changed, so re-renders only happen when the value actually shifts.

When the overlay is hidden (`visible = false`), `DebugOverlayInner` is unmounted.
`MetricsCollector` and `MetricsBatcher` continue running (negligible overhead),
but Zustand has zero subscribers → zero notifications → zero render cost.

---

## Consequences

### Benefits

- **Instrumentation cost < 0.1ms/frame.** `record()` is a ring-buffer write.
  Percentile computation runs once per second, not per frame.

- **Debug overlay at 1Hz.** Panels re-render as infrequently as data changes
  — not at 60Hz. Frame budget is preserved for the rendering pipeline.

- **Production overhead is minimal.** `MetricsCollector` still runs (ring
  buffer writes only). `ConsoleSink` is replaced by `NullSink`. Debug overlay
  is never mounted (`IS_DEV = false`). `StoreSink` writes go to Zustand with
  zero subscribers.

- **Decoupled from React.** `MetricsCollector` can be tested in pure Node
  without a DOM or React renderer.

- **Deterministic stress tests.** `StreamSimulator` + `ChaosEngine` use seeded
  PRNG — same seed = same load pattern = reproducible benchmark results.

### Trade-offs

- **1Hz aggregation introduces lag.** Metrics shown in the overlay are up to
  1 second stale. Acceptable for a debug overlay; not suitable for real-time
  alerting. Phase 8 (OTEL) would use sampling-based export, not polling.

- **Ring buffer caps at 512 samples.** At 60Hz, 512 samples covers ~8.5
  seconds. Percentiles reflect the rolling 8.5s window, not the lifetime of
  the session.

- **`StoreSink` bypasses the `set` updater pattern.** It calls
  `useTelemetryStore.getState().updateAggregatedMetrics()` from outside React.
  This is safe because `subscribeWithSelector` handles external writes, but
  violates the convention that all store writes come from within React. This
  is the intended exception — see the invariant comment in `telemetry-store.ts`.

---

## Alternatives Considered

### Single-tier (write to Zustand at 60Hz)

Rejected. Writing to Zustand inside the RAF callback (even with `getState()`)
notifies all subscribers synchronously. Debug overlay at 60Hz competes with
the streaming pipeline for the 16ms frame budget.

### `useRef` + polling in overlay components

Considered using a `useRef` to accumulate metrics inside components and reading
them on a timer. Rejected because it makes the metrics invisible to tests and
other non-React consumers (e.g. the `StreamSimulator`).

### Worker-based telemetry

Would fully isolate telemetry cost from the main thread. Overkill for Phase 5;
the two-tier model achieves sub-0.1ms per-frame cost without the complexity of
a MessageChannel serialization round-trip. Revisit in Phase 9 under load.

---

## Related

- ADR-0012: Store Boundaries — each store has a single writer domain
- ADR-0011: RAF Pipeline Architecture — the frame callback that calls `recordFrame`
- ADR-0005: RAF Batching — budget enforcement context
