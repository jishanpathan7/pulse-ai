# Rendering Pipeline

## Component Map

```
RenderPipeline (pipeline.ts)                ← bridge: transport → render stores
  │
  ├── StreamBufferManager (stream-buffer.ts) ← token accumulator, outside React
  │     push(streamId, token)
  │     drain(streamId) → string[]
  │     markForFinalization(streamId, data)
  │     popFinalization(streamId) → data | null
  │
  ├── RAFScheduler (raf-scheduler.ts)        ← one-RAF-pending invariant
  │     enqueue(streamId, tokens[])
  │     flushNow()  ← for stream_end / teardown
  │     cancel()
  │
  ├── FrameBudgetMonitor (frame-budget.ts)   ← frame time measurement
  │     record(durationMs, batchCount, tokens)
  │     metrics → RenderMetrics
  │     isUnderSoftBudget (< 14ms avg)
  │     recentDropRate (last 10 frames)
  │
  └── AdaptiveBatchStrategy (adaptive-batch.ts)
        shouldFlush(pendingCount, monitor) → BatchDecision
        NormalBatchStrategy (default)
        BudgetAwareBatchStrategy (optional)

Snapshot Factories (snapshot.ts)
  createActiveStream()         → ActiveStreamSnapshot (frozen)
  appendTokens(snapshot, ...)  → ActiveStreamSnapshot (new frozen object)
  markFinalizing()             → ActiveStreamSnapshot
  markStreamError()            → ActiveStreamSnapshot
  snapshotFromActiveStream()   → MessageSnapshot (frozen)
  createMessageSnapshot()      → MessageSnapshot (frozen)
  createConversationSnapshot() → ConversationSnapshot (frozen)
  appendMessage()              → ConversationSnapshot (new frozen object)
  replaceMessage()             → ConversationSnapshot (new frozen object)

Scroll Anchor (scroll-anchor.ts)             ← pure FSM, no DOM
  reduceScrollAnchor(state, event) → state
  shouldAutoScroll(state) → boolean
  shouldShowScrollButton(state) → boolean

Hooks (hooks/)                               ← scaffolded, implemented Phase 4
  useVirtualizedMessages()
  useActiveStream()
  useStreamCount()

Utils (utils.ts)
  randomId()
  percentile(values, p)
  average(values)
  CircularBuffer<T>
```

## Data Flow

### Token arrival → pixel

```
WebSocket message arrives (main thread)
  ↓ ~0.1ms
TransportClient: seq validation, dedup
  ↓ ~0.2ms
RenderPipeline._onMessage()
  ↓ ~0.05ms
StreamBufferManager.push()      ← no React, no Zustand
  ↓ 0ms
RAFScheduler.enqueue()          ← idempotent if RAF pending
  ↓ (0 to 16ms wait)
requestAnimationFrame fires
  ↓ ~0.5ms
drain buffer → group by stream → build frozen batches
  ↓ ~0.5ms
streamStore.commitTokenBatch()  ← ONE Zustand setState
  ↓ ~1-2ms
React re-renders StreamingMessage component
  ↓ ~2-5ms
Browser composite + paint
  ──────────────────────────────
Total: ~4-8ms from token arrival to pixel
```

### Stream completion → snapshot

```
stream_end received (seq validated)
  ↓
markForFinalization(streamId)
drain remaining tokens → enqueue
  ↓ (next RAF)
commitTokenBatch (final tokens)
  ↓
finalizeStream(streamId):
  1. snapshotFromActiveStream() → frozen MessageSnapshot
  2. conversationStore.addMessage(conversationId, snapshot)
  3. delete activeStreams[streamId]
  ↓
conversationStore update fires → MessageList re-renders
StreamingMessage → status='gone' → returns null
CompletedMessage renders from frozen snapshot
```

## Invariants

1. **One RAF max:** `_rafId !== null` → RAF pending; `_scheduleFlush()` no-ops
2. **Atomic drain:** `splice(0)` before any downstream call; tokens pushed during flush get next frame
3. **Tokens before finalization:** `commitTokenBatch()` always runs before `_checkFinalizations()` in `_onFlush()`
4. **Snapshots are frozen:** Every `create*()` and `update*()` factory calls `Object.freeze()`
5. **streamStore evicts on finalize:** `finalizeStream()` always deletes from `activeStreams`
6. **No component imports TransportClient:** Only RenderPipeline subscribes to transport events
7. **StreamBuffer outside React:** `StreamBufferManager` holds plain arrays, never setState
8. **Replay correctness:** Same message redelivered → seq dedup in transport → same token set → identical snapshot

## Phase 4 Implementation Points

```
hooks/use-virtualized-messages.ts  → implement with @tanstack/react-virtual
hooks/use-active-stream.ts         → implement with streamStore selector
scroll-anchor.ts                   → wire to scroll container ResizeObserver
adaptive-batch.ts                  → enable BudgetAwareBatchStrategy if P95 > 14ms
```
