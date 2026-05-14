# ADR-0004: TanStack Virtual for Message List

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

A conversation can contain thousands of messages. Mounting all as DOM nodes
causes severe performance degradation: initial paint latency, scrolling jank,
and high memory pressure. Messages are variable height (short replies vs
multi-paragraph responses with code blocks).

## Decision

Use `@tanstack/react-virtual` for message list virtualization.

## Rationale

TanStack Virtual:
- Handles variable-height items via `ResizeObserver`-based dynamic measurement
- Zero dependencies beyond React
- Headless — no imposed DOM structure or CSS
- `overscan` prop controls prefetch buffer (set to 3 for smooth scroll)
- Maintained, TypeScript-first, well-benchmarked

The headless design is critical: we need full control over item DOM structure
for streaming token rendering. Libraries that prescribe item markup fight
with incremental update patterns.

Dynamic measurement via `measureElement` callback integrates cleanly with
React's reconciliation — no manual size bookkeeping needed.

## Consequences

**Positive:** DOM node count stays bounded (~30-50 rendered at a time regardless
of conversation length). Scrolling stays at 60fps with 10k+ messages.

**Negative:** Must handle scroll-to-bottom logic manually. New streaming messages
at bottom require scroll lock logic: auto-scroll when at bottom, pause when user
scrolls up, resume on explicit scroll-to-bottom action.

**Neutral:** Requires `ResizeObserver` — available in all target browsers.

## Alternatives Considered

### react-window / react-virtualized
Rejected: fixed-height assumption. Variable-height messages require significant
workarounds. Not headless — imposes DOM structure.

### No virtualization
Rejected: measurably degrades at 500+ messages. Unacceptable for production.
