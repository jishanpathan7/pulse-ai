/**
 * Telemetry event contracts — full taxonomy for Pulse AI observability.
 *
 * Naming convention: <domain>.<noun>.<verb_past>
 * e.g., ws.connection.established, stream.token.received
 *
 * Domains:
 *   ws.*        — WebSocket transport lifecycle + reliability
 *   stream.*    — AI token stream lifecycle + throughput
 *   render.*    — RAF scheduler, React render, frame budget
 *   scheduler.* — Token queue, RAF flush coordination
 *   virtual.*   — TanStack Virtual scroll performance
 *   replay.*    — Sequence replay recovery
 *   budget.*    — Performance budget violations
 *   interaction.* — User-driven events (scroll, input)
 */

// ─── Base ─────────────────────────────────────────────────────────────────────

export interface TelemetryEvent {
  readonly name: string;
  readonly timestamp: number;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly attributes: Record<string, TelemetryValue>;
}

export type TelemetryValue = string | number | boolean | null;

export type Severity = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// ─── Transport / WebSocket ────────────────────────────────────────────────────

export interface WsConnectionEstablishedEvent extends TelemetryEvent {
  readonly name: 'ws.connection.established';
  readonly attributes: {
    readonly clientId: string;
    readonly sessionId: string;
    readonly reconnectCount: number;
    readonly lastSeq: number;
    readonly connectDurationMs: number;
  };
}

export interface WsConnectionDroppedEvent extends TelemetryEvent {
  readonly name: 'ws.connection.dropped';
  readonly attributes: {
    readonly clientId: string;
    readonly sessionId: string;
    readonly closeCode: number;
    readonly reason: string;
    readonly connectedDurationMs: number;
  };
}

export interface WsReconnectAttemptedEvent extends TelemetryEvent {
  readonly name: 'ws.reconnect.attempted';
  readonly attributes: {
    readonly attempt: number;
    readonly backoffMs: number;
    readonly lastSeq: number;
  };
}

/** Measured from ping send to pong receive. */
export interface WsRttMeasuredEvent extends TelemetryEvent {
  readonly name: 'ws.rtt.measured';
  readonly attributes: {
    readonly rttMs: number;
    readonly sessionId: string;
  };
}

// ─── Replay Recovery ──────────────────────────────────────────────────────────

export interface WsReplayRequestedEvent extends TelemetryEvent {
  readonly name: 'ws.replay.requested';
  readonly attributes: {
    readonly sessionId: string;
    readonly fromSeq: number;
    readonly toSeq: number;
    readonly gapSize: number;
  };
}

export interface WsReplayCompletedEvent extends TelemetryEvent {
  readonly name: 'ws.replay.completed';
  readonly attributes: {
    readonly sessionId: string;
    readonly fromSeq: number;
    readonly toSeq: number;
    readonly chunksReceived: number;
    readonly durationMs: number;
    readonly messagesRecovered: number;
  };
}

export interface WsReplayAbortedEvent extends TelemetryEvent {
  readonly name: 'ws.replay.aborted';
  readonly attributes: {
    readonly sessionId: string;
    readonly reason: 'reconnect' | 'timeout' | 'error';
  };
}

// ─── Stream Lifecycle ────────────────────────────────────────────────────────

export interface StreamStartedEvent extends TelemetryEvent {
  readonly name: 'stream.started';
  readonly attributes: {
    readonly streamId: string;
    readonly conversationId: string;
    readonly seq: number;
  };
}

/** Latency from stream_start received to first token received. */
export interface StreamFirstTokenEvent extends TelemetryEvent {
  readonly name: 'stream.first_token.received';
  readonly attributes: {
    readonly streamId: string;
    readonly latencyMs: number;        // time from stream_start to first token
    readonly conversationId: string;
  };
}

export interface StreamCompletedEvent extends TelemetryEvent {
  readonly name: 'stream.completed';
  readonly attributes: {
    readonly streamId: string;
    readonly totalTokens: number;
    readonly durationMs: number;
    readonly tokensPerSecond: number;
    readonly firstTokenLatencyMs: number | null;
  };
}

export interface StreamErrorEvent extends TelemetryEvent {
  readonly name: 'stream.error';
  readonly attributes: {
    readonly streamId: string;
    readonly errorCode: string;
    readonly tokensBeforeError: number;
    readonly retryable: boolean;
  };
}

// ─── Render / RAF Pipeline ────────────────────────────────────────────────────

export interface RenderBatchFlushedEvent extends TelemetryEvent {
  readonly name: 'render.batch.flushed';
  readonly attributes: {
    readonly frameIndex: number;
    readonly batchCount: number;       // active streams in this flush
    readonly totalTokens: number;
    readonly flushDurationMs: number;
    readonly queueDepthAtFlush: number;
  };
}

export interface RenderFrameDroppedEvent extends TelemetryEvent {
  readonly name: 'render.frame.dropped';
  readonly attributes: {
    readonly frameIndex: number;
    readonly frameTimeMs: number;
    readonly budgetMs: number;
    readonly overrunMs: number;
  };
}

export interface RenderStrategyUpgradedEvent extends TelemetryEvent {
  readonly name: 'render.strategy.upgraded';
  readonly attributes: {
    readonly from: 'normal' | 'budget-aware';
    readonly to: 'normal' | 'budget-aware';
    readonly p95FrameTimeMs: number;
    readonly totalFramesObserved: number;
  };
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export interface SchedulerQueueDepthEvent extends TelemetryEvent {
  readonly name: 'scheduler.queue.depth';
  readonly attributes: {
    readonly pendingTokens: number;
    readonly activeStreams: number;
    readonly isFlushPending: boolean;
  };
}

export interface SchedulerFlushSkippedEvent extends TelemetryEvent {
  readonly name: 'scheduler.flush.skipped';
  readonly attributes: {
    readonly pendingTokens: number;
    readonly reason: 'budget-pressure';
    readonly p95Ms: number;
  };
}

// ─── Virtual List ─────────────────────────────────────────────────────────────

export interface VirtualScrollMeasuredEvent extends TelemetryEvent {
  readonly name: 'virtual.scroll.measured';
  readonly attributes: {
    readonly conversationId: string;
    readonly totalItems: number;
    readonly renderedItems: number;  // currently in DOM
    readonly overscan: number;
    readonly virtualizationRatio: number; // renderedItems / totalItems
    readonly totalHeightPx: number;
  };
}

export interface VirtualScrollJankEvent extends TelemetryEvent {
  readonly name: 'virtual.scroll.jank';
  readonly attributes: {
    readonly frameTimeMs: number;
    readonly itemCount: number;
  };
}

// ─── Budget Violations ────────────────────────────────────────────────────────

export interface BudgetViolationEvent extends TelemetryEvent {
  readonly name: 'budget.violated';
  readonly attributes: {
    readonly category: 'render' | 'stream' | 'transport' | 'virtual';
    readonly metric: string;
    readonly actual: number;
    readonly budget: number;
    readonly severity: 'soft' | 'hard';
  };
}

// ─── Interaction ─────────────────────────────────────────────────────────────

export interface InteractionScrollEvent extends TelemetryEvent {
  readonly name: 'interaction.scroll';
  readonly attributes: {
    readonly direction: 'up' | 'down';
    readonly anchorMode: 'bottom-locked' | 'user-scrolled' | 'programmatic';
  };
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type TelemetryEventUnion =
  | WsConnectionEstablishedEvent
  | WsConnectionDroppedEvent
  | WsReconnectAttemptedEvent
  | WsRttMeasuredEvent
  | WsReplayRequestedEvent
  | WsReplayCompletedEvent
  | WsReplayAbortedEvent
  | StreamStartedEvent
  | StreamFirstTokenEvent
  | StreamCompletedEvent
  | StreamErrorEvent
  | RenderBatchFlushedEvent
  | RenderFrameDroppedEvent
  | RenderStrategyUpgradedEvent
  | SchedulerQueueDepthEvent
  | SchedulerFlushSkippedEvent
  | VirtualScrollMeasuredEvent
  | VirtualScrollJankEvent
  | BudgetViolationEvent
  | InteractionScrollEvent;
