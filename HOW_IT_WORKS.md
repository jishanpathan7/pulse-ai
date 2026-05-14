# How Pulse AI Works
### A plain-English tour for curious engineers

---

## What is this?

Pulse AI is a chat interface for Claude — but built to push the limits of how fast AI responses can appear on screen. Where most AI apps feel like waiting for a page to load, Pulse streams every token at 60 frames per second and shows you the AI thinking word by word in real time.

The interesting problems aren't the AI part (Anthropic handles that). They're about **how you get tokens from a server to pixels on a screen as fast as physics allows**, without the browser melting.

---

## The Big Picture

```
You type a message
       │
       ▼
  Browser sends it over WebSocket
       │
       ▼
  Server forwards it to Claude (Anthropic API)
       │
       ▼
  Claude streams tokens back → server → WebSocket → browser
       │
       ▼
  Browser collects tokens, batches them at 60fps
       │
       ▼
  React renders new words on screen
```

Simple enough. The hard parts are in every arrow.

---

## Five Problems Worth Understanding

### 1. The Token Firehose Problem

Claude can generate hundreds of tokens per second. A token is roughly one word fragment. If you called `setState()` in React for every single token, React would try to re-render the entire component tree hundreds of times per second. Most frames would be wasted. The browser would stutter.

**The fix:** Tokens never touch React directly. They go into a queue first.

```
Token arrives → queue
Token arrives → queue
Token arrives → queue     }  one frame = ~16ms
Token arrives → queue
                          ↓
              requestAnimationFrame fires
                          ↓
              Flush ALL queued tokens at once
                          ↓
              ONE React state update per frame
```

`requestAnimationFrame` (rAF) syncs exactly with the screen refresh rate — usually 60Hz. So instead of 400 React updates per second, you get 60. The screen can only show 60 frames per second anyway, so you lose nothing.

---

### 2. The Network Is Unreliable Problem

WebSocket connections drop. Mobile networks hiccup. What happens to a response mid-stream when the connection cuts out?

Without special handling: the response disappears or gets corrupted.

**The fix:** Every message from the server has a sequence number.

```
Server sends:  [seq=1] Hello
               [seq=2]  world
               [seq=3] , here
               [seq=4]  is my
               [seq=5]  answer.
```

The browser tracks which sequences it's seen. If the connection drops and reconnects, it tells the server: "I have everything up to seq=3." The server replays from seq=4. The user sees a seamless response as if nothing happened.

This is called **sequence-aware replay recovery**. It's the same idea railways use for dispatching trains — every event gets a number, and you can always reconstruct the full picture from any point.

---

### 3. The "Where Is Everything?" Problem

A conversation with 500 messages would be very slow if all 500 were in the DOM at once. Browsers handle maybe 50-100 complex DOM nodes smoothly. Beyond that: sluggish scrolling, slow renders, wasted memory.

**The fix:** Virtual scrolling. Only the messages you can actually see exist in the DOM.

```
Message 1  ]
Message 2  ]  visible → in the DOM
Message 3  ]
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ viewport edge
Message 4    NOT in DOM
Message 5    NOT in DOM
...
Message 498  NOT in DOM
```

When you scroll, messages enter and leave the DOM as they cross the viewport boundary. TanStack Virtual handles the math — calculating pixel positions for every item based on estimated or measured heights, even when items are different sizes.

---

### 4. The State Chaos Problem

This app has a lot of moving parts: WebSocket connection state, active streams, completed messages, UI scroll position, telemetry metrics, workspace sessions. If everything shared one big state object, any update anywhere would re-render everything everywhere.

**The fix:** Five separate Zustand stores, each owning one domain.

| Store | Owns |
|---|---|
| `transportStore` | WebSocket connection status (connected/reconnecting/failed) |
| `streamStore` | In-progress AI responses — updated 60x/sec during streaming |
| `conversationStore` | Completed messages — immutable snapshots once done |
| `uiStore` | Scroll position, scroll-to-bottom button visibility |
| `workspaceStore` | Sessions, sidebar state, which panel is open |

Each component subscribes to exactly what it needs. `StreamingMessage` watches `streamStore` for live tokens. `CompletedMessage` reads from `conversationStore` once and never re-renders again.

---

### 5. The Scroll Problem

Auto-scroll sounds simple: when new content arrives, scroll to the bottom. Except:

- What if the user deliberately scrolled up to re-read something?
- What if the user scrolled up, then sent a new message?
- What about programmatic scrolls vs. user scrolls?

**The fix:** A scroll state machine with three modes.

```
bottom-locked   → new content arrives → auto-scroll to bottom ✓
user-scrolled   → new content arrives → DON'T scroll (user is reading) ✗
programmatic    → you sent a message  → lock back to bottom ✓
```

Transitions happen on specific events: the user scrolling up switches to `user-scrolled`. Sending a new message forces `LOCK_BOTTOM`. The machine is a pure function of events — no timers, no guessing.

---

## How the Code Is Organized

```
pulse-ai/
├── apps/
│   ├── web/          Everything you see in the browser
│   │   ├── ai/       Provider adapters (Claude API, WebSocket, Demo)
│   │   ├── render/   The token pipeline (rAF scheduler, stream buffer)
│   │   ├── store/    The five Zustand stores
│   │   ├── transport/ WebSocket client with reconnect + sequence tracking
│   │   └── components/ React UI (workspace, messages, sidebar, input)
│   │
│   └── api/          The server (Fastify)
│       ├── routes/   HTTP endpoints (conversations, messages, auth)
│       └── db/       PostgreSQL queries
│
└── packages/
    ├── types/        Shared TypeScript types (zero runtime code)
    ├── transport/    Shared WebSocket protocol definitions
    └── ui/           Design system (CSS tokens, shared components)
```

The monorepo splits `web` from `api` from `packages` so each piece can be built and deployed independently. Packages like `@pulse/types` have zero runtime code — they disappear at compile time.

---

## A Message, Step by Step

Here's what happens from the moment you press Enter to the moment you see a response:

**1. You press Enter**
> `InputBar` dispatches a DOM event: `pulse:send-message`

**2. The AI controller hears it**
> `useAIController` in `workspace-layout.tsx` receives the event. It picks the best available AI provider (WebSocket → SSE fallback → Demo) and calls `injector.inject()`.

**3. Your message is added immediately**
> A "user" message snapshot is created and added to `conversationStore`. It appears on screen before the server even responds.

**4. The stream starts**
> `StreamInjector` calls the provider. The provider opens a stream. A `stream_start` event creates an entry in `streamStore` — this is the empty placeholder the AI response will fill.

**5. Tokens arrive**
> Each token goes through: `provider.stream()` → `pipeline._onMessage()` → `StreamBufferManager.push()` → `RAFScheduler.enqueue()`. Still no React update.

**6. The rAF fires**
> Every ~16ms, the RAF scheduler wakes up, grabs all buffered tokens, and calls `streamStore.commitTokenBatch()`. ONE React update. `StreamingMessage` component re-renders with new content.

**7. The stream ends**
> A `stream_end` event triggers `streamStore.finalizeStream()`. The stream snapshot becomes an immutable `MessageSnapshot` in `conversationStore`. The streaming placeholder disappears and the completed message takes its slot.

**8. Auto-title**
> If this was the first message in a new session, the first 60 characters of your message become the session title. Updated locally and saved to the server.

---

## The Server's Job

The server (`apps/api`) is intentionally thin:

- **Stores conversations and messages** in PostgreSQL so they persist across page reloads
- **Proxies requests to Anthropic** so the API key never touches the browser
- **Manages auth** (sessions, user accounts)
- **Provides a WebSocket endpoint** that sequences, queues, and relays Claude's stream

The server adds sequence numbers to every message it sends. It can replay any session from any offset. This is what makes the reconnection recovery work.

---

## What Makes This Different From a Basic Chat App

| Typical AI chat | Pulse AI |
|---|---|
| `fetch()` with streaming response | WebSocket with sequence tracking |
| `setState` per token | Token queue + rAF batching |
| Render all messages | Virtualize — only render visible messages |
| One global state object | Five domain stores, isolated subscriptions |
| Reconnect = lose your response | Reconnect = replay from last known sequence |
| Title = you set it | Title = auto-derived from first message |

---

## The Interesting Numbers

- **Rendering:** ≤ 1 rAF pending at any time (enforced invariant)
- **Token updates:** up to 60 React state updates/second (one per frame)
- **Virtualization:** DOM holds ~10-15 messages regardless of conversation length
- **Replay:** server can replay from sequence 0 (full conversation) or any offset
- **Providers:** 3 (WS → SSE → Demo), automatic fallback

---

## If You Want to Go Deeper

| Topic | File |
|---|---|
| Token batching + rAF | `apps/web/src/render/raf-scheduler.ts` |
| Sequence tracking + replay | `apps/web/src/transport/ws-client.ts` |
| Stream → store pipeline | `apps/web/src/render/pipeline.ts` |
| Virtual list logic | `apps/web/src/render/hooks/use-virtualized-messages.ts` |
| Scroll state machine | `apps/web/src/render/scroll-anchor.ts` |
| All five stores | `apps/web/src/store/` |
| Architecture decisions | `docs/adr/` |
| System design docs | `docs/architecture/` |

---

*Built to understand what production-grade real-time AI infrastructure actually looks like at the component level.*
