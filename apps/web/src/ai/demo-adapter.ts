/**
 * DemoAdapter — realistic AI responses without a backend.
 *
 * Used when the Phase 7 backend is not running. Generates pre-written
 * technically realistic responses at configurable token rates.
 *
 * Features:
 *   - Topic-aware response selection (detects keywords in user message)
 *   - Realistic token rates (30–80 tps, similar to Claude Sonnet)
 *   - Token-level streaming (yields one token at a time, with jitter)
 *   - Respects AbortSignal (cancels mid-stream)
 *   - Markdown formatting in responses (exercises StreamingMarkdown renderer)
 *
 * Token splitting:
 *   Splits response text at word boundaries + punctuation, approximating
 *   how LLMs actually tokenize. Not exact — real tokenizers are subword —
 *   but visually indistinguishable for demo purposes.
 *
 * Always available (isAvailable = true) — no network required.
 */

import type { AIProvider, AIMessage, StreamOptions } from './provider.js';
import { AIProviderError } from './provider.js';

// ─── Demo responses ───────────────────────────────────────────────────────────
// Each entry: keywords to match + markdown response content.

interface DemoResponse {
  readonly keywords: string[];
  readonly content: string;
}

const DEMO_RESPONSES: DemoResponse[] = [
  {
    keywords: ['architecture', 'design', 'system', 'how does', 'explain'],
    content: `## Pulse AI Architecture

The platform is built around three performance invariants:

**1. One RAF pending max**
Token queue batching requires exactly one \`requestAnimationFrame\` scheduled at a time. Multiple concurrent RAFs cause duplicate renders — the scheduler uses an atomic "pending" flag.

**2. Server is sequence authority**
The client never generates sequence numbers. \`seq=0\` is reserved for control messages (handshake). All data messages have \`seq≥1\`. This enables gap detection without clock synchronization.

**3. Two-tier telemetry**
\`MetricsCollector\` operates off-React at 60Hz — ring buffers, O(1) writes.
\`MetricsBatcher\` aggregates at 1Hz and fans out to sinks. The debug overlay subscribes to \`selectLastAggregatedAt\` (a primitive number), so it re-renders at most 1Hz regardless of streaming rate.

The render pipeline looks like:

\`\`\`
WebSocket → seq validator → replay buffer → RenderPipeline
  → StreamBufferManager → RAFScheduler → streamStore → React
\`\`\`

Virtualization uses TanStack Virtual with \`messageId\` as the stable key — the same slot handles both streaming and completed states, eliminating layout shift on finalization.`,
  },
  {
    keywords: ['performance', 'fps', 'frame', 'speed', 'fast', 'benchmark'],
    content: `## Performance Characteristics

At 60fps with a single 50 tps stream:

| Metric | Value |
| --- | --- |
| Avg frame time | ~2.1ms |
| P95 frame time | ~4.8ms |
| P99 frame time | ~8.2ms |
| Dropped frames | 0 |
| Telemetry overhead | <0.1ms/frame |

At worst-case (3 streams × 100 tps + 5% packet loss):

- P95 frame time rises to ~14ms (near the 16.67ms budget)
- \`BudgetAwareBatchStrategy\` auto-upgrades from \`NormalBatchStrategy\`
- The scheduler coalesces tokens more aggressively, trading latency for throughput
- Dropped frame rate stays below 2% even under saturation

**Measuring yourself:**
1. Open the telemetry dock (📊 in the status bar)
2. Run a scenario from the Chaos panel
3. Watch the FPS panel budget bars in real time
4. Press \`Ctrl+Shift+D\` for the floating debug overlay`,
  },
  {
    keywords: ['replay', 'recovery', 'reconnect', 'gap', 'sequence'],
    content: `## Sequence Gap Recovery

When a packet is dropped (5% drop rate in the \`networkInstability\` scenario):

1. **Gap detection** — sequence validator notices \`expected=N\`, \`received=N+1\`
2. **Replay request** — client sends \`{ type: 'replay_request', fromSeq: N, toSeq: N+1 }\`
3. **Server replay** — server delivers the missing message from its replay buffer
4. **Gap closed** — sequence authority resumes normal delivery

The replay buffer on the server holds the last 1000 sequenced messages (configurable). Gaps larger than the buffer trigger a full session reset.

\`\`\`typescript
// ReplayCoordinator.requestReplay()
const request: ClientReplayRequestMessage = {
  type: 'replay_request',
  fromSeq: this._expectedSeq,
  toSeq: endSeq,
  timestamp: Date.now(),
};
\`\`\`

From the UI perspective: the \`ReplayIndicator\` component watches \`telemetryStore.aggregated.replayCount\` (updated 1Hz). A progress bar appears while replays are in flight and fades after ~3 seconds of inactivity.`,
  },
  {
    keywords: ['zustand', 'store', 'state', 'selector', 'react'],
    content: `## Zustand Store Architecture

Five stores, strict single-concern ownership:

\`\`\`
transportStore   → connectionState, metrics, lastError
streamStore      → activeStreams (60Hz writes during streaming)
conversationStore → frozen MessageSnapshot arrays (low write frequency)
uiStore          → scroll FSM state, auto-scroll flag
telemetryStore   → aggregated metrics (1Hz via StoreSink)
\`\`\`

**Why primitive selectors matter:**

\`\`\`typescript
// ✗ Object selector — re-renders on every streamStore write (60×/s)
const { content, status } = useStreamStore(s => s.activeStreams[streamId]);

// ✓ Primitive selectors — bails out when string is unchanged
const content = useStreamStore(s => s.activeStreams[streamId]?.content ?? '');
const status  = useStreamStore(s => s.activeStreams[streamId]?.status ?? null);
\`\`\`

At 60 tps with 3 concurrent streams, the object pattern would force every subscribed component to diff 180 times/second. The primitive pattern reduces that to only the \`StreamingMessage\` for the specific stream that changed.`,
  },
  {
    keywords: ['virtualization', 'virtual', 'scroll', 'list', 'messages'],
    content: `## Virtualized Message List

Uses TanStack Virtual v3 with several non-obvious choices:

**Stable item keys via messageId**

Both streaming and completed messages share the same \`messageId\` as their virtual key. When a stream finalizes, TanStack Virtual sees the same key at the same index — the item updates in-place without layout shift.

**useLayoutEffect for auto-scroll**

\`useEffect\` fires after paint, causing a one-frame flash of the old scroll position. \`useLayoutEffect\` sets \`scrollTop\` synchronously before the browser composites the frame.

**measureElement + ResizeObserver**

TanStack Virtual's \`measureElement\` API uses ResizeObserver to track actual DOM heights. Code blocks and multi-line messages vary significantly — a fixed \`estimateSize\` would cause jump as items unmask.

**Virtualization ratio**

With 500+ pre-loaded messages, typically 8–15 items are rendered at any time (virtualization ratio ~3%). The scheduler panel shows \`rendered / total\` in real time.`,
  },
  {
    keywords: ['hello', 'hi', 'hey', 'what can', 'help'],
    content: `Hello! I'm the Pulse AI demo adapter — a pre-canned response system that demonstrates the streaming pipeline without requiring a backend.

**What I can explain:**
- **Architecture** — the rendering pipeline, two-tier telemetry, store boundaries
- **Performance** — FPS characteristics, frame budget, adaptive batching
- **Replay/recovery** — sequence gap detection and deterministic replay
- **Zustand** — primitive selectors and re-render isolation
- **Virtualization** — stable keys, measureElement, auto-scroll

Try asking about any of these topics. Each response is designed to exercise the streaming markdown renderer with code blocks, headings, and inline formatting.

For real AI responses, start the backend server and the \`AnthropicAdapter\` will take over automatically.`,
  },
];

const DEFAULT_RESPONSE: DemoResponse = {
  keywords: [],
  content: `I understand you're asking about that topic. Here's what I can tell you:

The Pulse AI platform is designed around the principle that **realtime infrastructure quality is measurable**. Every subsystem has telemetry, every invariant is enforced at the type level, and every performance claim can be reproduced with a seeded benchmark.

The key architectural decisions:
- Sequence-aware transport with deterministic replay
- rAF-batched rendering with adaptive strategy upgrade
- Two-tier telemetry (60Hz collection, 1Hz aggregation)
- Stable virtual keys for streaming→completed transition

Ask me about architecture, performance, replay/recovery, Zustand selectors, or virtualization for more detailed explanations.`,
};

// ─── Token splitter ───────────────────────────────────────────────────────────
// Splits text into ~token-sized pieces. Not subword accurate, but visually
// matches the streaming feel of real LLMs.

function splitIntoTokens(text: string): string[] {
  const tokens: string[] = [];
  // Split at word boundaries, keeping punctuation attached
  const parts = text.split(/(?<=\s)|(?=\s)|(?<=[,;:.!?])|(?=[`*#\n])/);
  for (const part of parts) {
    if (part.length === 0) continue;
    // Long words get split further (subword approximation)
    if (part.length > 8 && !/\s/.test(part)) {
      const mid = Math.ceil(part.length / 2);
      tokens.push(part.slice(0, mid), part.slice(mid));
    } else {
      tokens.push(part);
    }
  }
  return tokens;
}

function selectResponse(messages: ReadonlyArray<AIMessage>): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return DEFAULT_RESPONSE.content;

  const text = lastUser.content.toLowerCase();
  for (const response of DEMO_RESPONSES) {
    if (response.keywords.some((kw) => text.includes(kw))) {
      return response.content;
    }
  }
  return DEFAULT_RESPONSE.content;
}

// ─── DemoAdapter ──────────────────────────────────────────────────────────────

export class DemoAdapter implements AIProvider {
  readonly name = 'demo';
  readonly isAvailable = true;

  private readonly _tokensPerSecond: number;

  constructor(tokensPerSecond: number = 55) {
    this._tokensPerSecond = tokensPerSecond;
  }

  async *stream(
    messages: ReadonlyArray<AIMessage>,
    options?: StreamOptions,
  ): AsyncIterable<string> {
    const signal = options?.signal;
    const content = selectResponse(messages);
    const tokens = splitIntoTokens(content);
    const intervalMs = 1000 / this._tokensPerSecond;

    // Thinking delay (simulates model generation latency / TTFT)
    await delay(120 + Math.random() * 80, signal);

    for (const token of tokens) {
      if (signal?.aborted) {
        throw new AIProviderError('aborted', 'Stream aborted');
      }
      yield token;
      // Jitter: ±30% around the nominal interval
      const jitter = (Math.random() * 0.6 - 0.3) * intervalMs;
      await delay(Math.max(4, intervalMs + jitter), signal);
    }
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new AIProviderError('aborted', 'Aborted during delay'));
    }, { once: true });
  });
}
