# ADR-0005: requestAnimationFrame Token Batching

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

AI token streams arrive at 50-150 tokens/second. Each token is a WebSocket
message that updates UI state. Naively calling `setState` per token causes
50-150 React render cycles per second, exceeding the 60fps budget and causing
visible jank. The browser paints at ≤60fps regardless of how many React
renders are scheduled.

## Decision

Buffer incoming tokens in a queue outside of React state. Schedule a single
`requestAnimationFrame` callback (idempotent — only one pending at a time).
On each RAF callback: drain the queue, compute the full text delta, call
`setState` once with the accumulated content.

## Rationale

RAF batching aligns React renders with the browser's paint cycle:
- Tokens arrive at 100/s → ~1-2 tokens per 16ms frame
- One `setState` per frame → one React render per frame
- React re-render cost amortized over all tokens in the frame

The invariant "at most one RAF pending" is critical: if tokens arrive faster
than one per frame, the queue accumulates and the next RAF drains all pending
tokens in one pass. No tokens are lost; renders just batch larger.

Side effect: perceived streaming speed is unchanged (text appears per-frame
at monitor refresh rate) but CPU usage drops proportionally.

## Consequences

**Positive:** CPU usage ~60-80% lower during streaming vs per-token setState.
Smooth rendering at any token rate. No dropped frames under sustained load.

**Negative:** Adds one frame of latency (≤16ms) before a token is visible.
Imperceptible to users but technically measurable.

**Neutral:** Queue management is simple — a plain `Array` with
`push` / `splice(0)` pattern. No library needed.

## Implementation Notes (Phase 4)

```
// Sketch — not final implementation
let rafId: number | null = null;
const queue: string[] = [];

function enqueue(token: string) {
  queue.push(token);
  if (rafId === null) {
    rafId = requestAnimationFrame(flush);
  }
}

function flush() {
  rafId = null;
  const tokens = queue.splice(0);
  store.getState().appendTokens(tokens);
}
```

## Alternatives Considered

### `unstable_batchedUpdates` (React 17 pattern)
Superseded by React 18's automatic batching. Less control over timing.

### Throttle with `setTimeout`
Rejected: setTimeout fires on a fixed interval regardless of paint cycle.
Tokens may render between frames (wasted renders) or miss frame boundaries.

### Web Worker message batching
Over-engineered for this use case. RAF is sufficient and simpler.
