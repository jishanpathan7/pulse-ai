# ADR-0011: requestAnimationFrame Pipeline Architecture

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

AI token streams arrive at 50-150 tokens/second. The browser displays at
60 frames/second (16ms per frame). Without coordination:

- 150 tokens/s → 150 `setState` calls/s
- React schedules 150 render cycles/s
- React's render + commit overhead: ~2-5ms each
- Total render cost: 300-750ms/s of main thread time → constant jank

Additionally, multiple tokens may arrive between frames. Rendering each
individually is redundant — the user can only see one frame every 16ms.

## Decision

Implement a two-stage token pipeline:

**Stage 1 (synchronous, sub-ms):** Tokens land in `StreamBufferManager` — a
plain mutable Map outside React state. No React involvement.

**Stage 2 (per-frame, async):** `RAFScheduler` fires on `requestAnimationFrame`,
drains the buffer atomically, groups by stream, calls ONE `setState` per stream.

Invariant: `_rafId !== null` means a RAF is pending. `_scheduleFlush()`
is idempotent — additional calls when `_rafId !== null` are no-ops.

## Rationale

The RAF loop naturally aligns rendering with the browser's paint cycle.
Tokens accumulate between frames and are committed in a single batch.

At 60fps: each frame has ≤16ms of budget. One `setState` per active stream per
frame means React runs once per frame for the streaming component. Even at
150 tokens/second (2-3 tokens/frame), the cost is:
- 60 `setState` calls/second (not 150)
- 60 React render cycles/second (not 150)
- Savings: ~60% reduction in React rendering CPU

The `flushNow()` escape hatch handles `stream_end` — we need the final snapshot
before navigating away or cleaning up.

## Consequences

**Positive:** Stable 60fps rendering regardless of token rate. React only
renders when the browser is about to paint. Tokens can burst without causing
frame drops.

**Negative:** One frame of latency (≤16ms) between token receipt and pixel.
Users never notice — 16ms is below human perception threshold for text streaming.

**Neutral:** `requestAnimationFrame` is browser-only. Tests must mock it
(or use `flushNow()` in the test environment).

## Alternatives Considered

### `unstable_batchedUpdates`
Superseded by React 18's automatic batching. But automatic batching only batches
within a single event handler — WebSocket events fire independently.

### `setTimeout(fn, 0)` throttling
Fires at 0ms but does not align with browser paint cycles. Can fire between
frames, causing wasted renders that never appear to the user.

### Debounce tokens at transport layer
Rejected: introduces unpredictable latency. A 32ms debounce would cause visible
"chunky" streaming at low token rates.
