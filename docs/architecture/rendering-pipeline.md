# Rendering Pipeline Architecture

The rendering pipeline converts realtime token streams into React-rendered UI
with bounded CPU cost and stable 60fps regardless of token arrival rate.

## Full Pipeline Diagram

```
TransportClient.onMessage(ServerMessage)
        │
        ▼
RenderPipeline (src/render/pipeline.ts)
        │
        ├── stream_start ──────────────────────────────────────────────────────────┐
        │   StreamBufferManager.create(streamId, conversationId, messageId)        │
        │   streamStore.startStream()         ← 1 Zustand update                  │
        │                                                                           │
        ├── token ──────────────────────────────────────────────────────────────┐  │
        │   StreamBufferManager.push(streamId, token)  ← NO React involvement  │  │
        │   AdaptiveBatchStrategy.shouldFlush() → true → RAFScheduler.enqueue() │  │
        │                                                                        │  │
        ├── stream_end ──────────────────────────────────────────────────────────┤  │
        │   StreamBufferManager.markForFinalization(streamId)                   │  │
        │   drain remaining tokens → RAFScheduler.enqueue()                    │  │
        │                                                                        │  │
        └── stream_error ────────────────────────────────────────────────────────┘  │
            StreamBufferManager.markForFinalization(isError=true)                   │
                                                                                    │
                              ┌─────────────────────────────────────────────────────┘
                              │ (all above is synchronous, sub-ms)
                              ▼
             RAFScheduler (src/render/raf-scheduler.ts)
             ┌──────────────────────────────────────────────────────────────┐
             │ Invariant: _rafId !== null → one RAF pending                  │
             │ Multiple enqueue() calls → ONE RAF scheduled                  │
             │                                                               │
             │  requestAnimationFrame(() => {                                │
             │    _rafId = null;                                             │
             │    pending = queue.splice(0);  // atomic drain                │
             │    batches = groupByStream(pending);                          │
             │    onFlush(batches);                                          │
             │  });                                                          │
             └──────────────────────────────────────────────────────────────┘
                              │
                              ▼ (once per frame, ≤16ms)
              RenderPipeline._onFlush(batches)
                              │
                              ├── streamStore.commitTokenBatch(batches)
                              │       ONE setState for ALL streams in this frame
                              │       Each stream: new object (appendTokens)
                              │       Old reference stale → React.memo bails on other components
                              │
                              └── _checkFinalizations()
                                      for each finalized stream:
                                        streamStore.finalizeStream()
                                        conversationStore.addMessage()
                                           ← immutable frozen snapshot
```

## Re-render Isolation

```
Frame N: tokens arrive for stream_42

streamStore update:
  activeStreams = {
    stream_42: { content: "Hello wor..." }  ← NEW object
  }

Components:
  <ConversationList>    subscribed to conversationStore.conversationCount
                        → NO RE-RENDER (different store)

  <MessageList>         subscribed to conversationStore.conversations[id].messages.length
                        → NO RE-RENDER (length unchanged, stream not finished)

  <CompletedMessage>    subscribed to conversationStore.conversations[id].messages[n]
                        → NO RE-RENDER (snapshot reference unchanged)

  <StreamingMessage>    subscribed to streamStore.activeStreams['stream_42'].content
                        → RE-RENDERS ✓ (this component should update)
```

## Stream Completion Transition

```
stream_end received (seq validated, in-order delivery)
        │
        ▼
StreamBufferManager.markForFinalization(stream_42)
StreamBufferManager.drain() → last tokens → RAFScheduler.enqueue()
        │
        ▼
RAF fires:
  1. commitTokenBatch(['stream_42': lastTokens])
     → streamStore.activeStreams['stream_42'].content = fullContent
     → StreamingMessage re-renders with complete content

  2. _checkFinalizations():
     streamStore.finalizeStream('stream_42')
       → snapshot = snapshotFromActiveStream(current, completedAt)
       → conversationStore.addMessage(conversationId, snapshot)
       → delete activeStreams['stream_42']
       ▼
     conversationStore update:
       conversations[convId].messages = [...old, newFrozenSnapshot]
     ▼
     MessageList re-renders (message count increased)
     StreamingMessage re-renders with status='gone' → returns null
     CompletedMessage renders for the new snapshot

Result: seamless transition from streaming → complete with ZERO content flash
        (same messageId → stable virtual list key → no layout shift)
```

## Store Subscription Map

```
Store               │ Update frequency        │ Subscribers
────────────────────┼─────────────────────────┼────────────────────────────────
transportStore      │ ~5 state transitions     │ Status badge, reconnect overlay
streamStore         │ Up to 60×/s streaming    │ Active streaming message ONLY
conversationStore   │ On message complete      │ Message list, conversation list
uiStore             │ On user interaction      │ Layout, scroll container, panels
telemetryStore      │ Up to 60×/s (debug only) │ Debug panel (dev only)
```

## Scroll Anchor State Machine

```
                  SCROLL_UP
         ┌────────────────────────────────────────┐
         │                                        │
         ▼                                        │
   user-scrolled ◀── SCROLL (not at bottom)       │
         │                                        │
         │ LOCK_BOTTOM                             │
         ▼                                        │
   programmatic ──── SCROLL (at bottom) ──────────┤
         │                                        │
         │ (scroll animation settles)              │
         ▼                                        │
   bottom-locked ──── SCROLL (not at bottom) ─────┘
         │
         │ CONTENT_GREW → emit scroll-needed signal
         │ (component calls containerRef.current.scrollTop = scrollHeight)
```

## Virtualization Integration

```
items array (TanStack Virtual):
  [
    MessageSnapshot_0,   completed, stable reference
    MessageSnapshot_1,   completed, stable reference
    MessageSnapshot_2,   completed, stable reference
    ...
    MessageSnapshot_N,   completed, stable reference
    ActiveStreamItem,    streaming, updates every frame
  ]

TanStack Virtual renders only visible items + overscan=3.
Non-visible completed messages: DOM nodes removed, height tracked by virtual.

Dynamic height measurement:
  Completed messages: measured once via ResizeObserver on first paint
  Streaming message: ResizeObserver fires as content grows
  Virtualizer updates item size → total scroll height grows
  Scroll anchor detects height growth → if bottom-locked, auto-scroll

Item key stability:
  Completed: messageId (stable string)
  Streaming: streamId (stable for duration of stream)
  On finalization: same messageId used for completed snapshot
  → TanStack Virtual reuses the DOM element (no remount)
```

## Invariants

| # | Invariant | Enforced by |
|---|---|---|
| 1 | At most one RAF pending | `_rafId !== null` check in `_scheduleFlush()` |
| 2 | Queue drain is atomic | `splice(0)` before any downstream call |
| 3 | Tokens commit before finalization | Finalization check after `commitTokenBatch()` in `_onFlush()` |
| 4 | No component imports TransportClient | ESLint `no-restricted-imports` (Phase 4 setup) |
| 5 | Snapshots are frozen | `Object.freeze()` in all snapshot factories |
| 6 | streamStore never contains completed messages | `finalizeStream()` always removes from `activeStreams` |
| 7 | conversationStore messages are append-only during streaming | `appendMessage()` never mutates existing snapshots |
| 8 | RAF callback is reentrant-safe | `_isFlushActive` guard |
