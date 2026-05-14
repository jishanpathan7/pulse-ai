# ADR-0014: TanStack Virtual for Message List

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-30 |

## Context

A conversation can grow to hundreds or thousands of messages. Rendering all
DOM nodes simultaneously causes three problems:

1. **Initial render cost:** mounting 500+ React components takes hundreds of ms
2. **Memory pressure:** each completed message keeps a DOM subtree alive
3. **Streaming message growth:** the streaming message's ResizeObserver fires
   every 16ms — if 500 siblings are mounted, layout is expensive

Additionally, the streaming message grows in height every RAF flush. The scroll
container must auto-scroll smoothly to track new tokens.

## Decision

Use `@tanstack/react-virtual` (`useVirtualizer`) for the message list.
Integrate with the scroll anchor FSM from Phase 3.

### Virtual list composition

```
allItems = [...conversation.messages, ...activeStreamsForConversation]
```

Each item has a stable key = `messageId`. This key is shared between the
`ActiveStreamSnapshot` (in-progress) and the `MessageSnapshot` (completed).

When a stream finalizes:
- `streamStore` removes it → `streamCount` decreases
- `conversationStore` adds the message → `messages.length` increases
- TanStack Virtual sees: same key, same index, new type
- The list item updates **in place** — no layout shift

### Re-render isolation

`useVirtualizedMessages` subscribes to:
- `selectMessages(conversationId)` — changes only on message add (low frequency)
- `selectStreamCount` — changes only on stream start/end (very low frequency)

Token flushes (60×/s) do NOT trigger `MessageList` re-renders.
`StreamingMessage` subscribes to `streamStore` directly with primitive selectors.

### Height estimation and measurement

```
estimateSize(index) = BASE_HEIGHT + ceil(content.length / 80) * PX_PER_LINE
```

TanStack Virtual's built-in `ResizeObserver` re-measures elements as they
grow (streaming message height changes per frame). The `measureElement` config
function returns `el.getBoundingClientRect().height`.

### Auto-scroll

Auto-scroll uses `useLayoutEffect` in `useVirtualizedMessages`:

```typescript
useLayoutEffect(() => {
  if (!shouldAutoScroll) return;
  el.scrollTop = el.scrollHeight;
}, [shouldAutoScroll, totalHeight, itemCount]);
```

`useLayoutEffect` fires synchronously after DOM mutations but before paint.
Setting `scrollTop` here ensures the scroll position is correct before the
browser composites the frame. This avoids the one-frame flash of old position
that `useEffect` would cause.

### BudgetAwareBatchStrategy upgrade

`RenderPipeline` starts with `NormalBatchStrategy` (always flush).
After 60 observed frames, if P95 frame time exceeds 14ms, it upgrades to
`BudgetAwareBatchStrategy`. This strategy skips token flushes under budget
pressure when the pending token count is below the urgency threshold (30).

The upgrade is one-way per session. Budget relief is handled by the strategy's
per-flush decisions, not by downgrading.

## Rationale

**TanStack Virtual over alternatives:**
- `react-window` and `react-virtualized` require fixed item sizes. The streaming
  message grows dynamically, making variable-height essential.
- TanStack Virtual has first-class variable-height support via `measureElement`
  and a built-in ResizeObserver integration.
- TanStack Virtual v3 is headless — no CSS opinion, works with any layout.

**`useLayoutEffect` over `useEffect` for auto-scroll:**
`useEffect` fires after paint — the user would see one frame with the old scroll
position before it corrects. `useLayoutEffect` fires before paint, eliminating
the flicker. The cost is that it runs synchronously, but setting `scrollTop` is
a cheap DOM mutation (no reflow triggered).

**`messageId` as virtual key:**
If we used array index as key, the transition from streaming to completed would
appear as a deletion + insertion at the same index — TanStack Virtual would
unmount/remount the DOM node, causing height flickering. Using `messageId`
makes the transition an in-place update to the same virtual slot.

## Consequences

**Positive:**
- Message list renders ~10 DOM nodes regardless of conversation length
- Layout cost of streaming message growth is isolated to that one element
- Auto-scroll tracks streaming tokens without per-token scroll calls
- `BudgetAwareBatchStrategy` activates only when actually needed

**Negative:**
- Height estimation is approximate; ResizeObserver corrections cause small
  position jumps when scrolling past un-measured items
- `useLayoutEffect` is SSR-incompatible (not a concern — Pulse AI is a SPA)
- TanStack Virtual adds ~10KB to the bundle (acceptable)

**Neutral:**
- Markdown rendering (Phase 6+) will change estimated heights. The ResizeObserver
  correction path handles this without code changes.
