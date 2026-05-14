/**
 * telemetryStore — aggregated performance metrics for the debug overlay.
 *
 * Two data paths write to this store:
 *
 *   Path A (60Hz): RenderPipeline → recordFrame()
 *     Frame-by-frame timings for the rolling 2s window.
 *     These power the live FPS counter and frame budget bars.
 *
 *   Path B (1Hz): MetricsBatcher → StoreSink → updateAggregatedMetrics()
 *     Aggregated snapshot: p50/p95/p99 per metric, counts, rates.
 *     Powers the debug overlay panels for stream, transport, replay metrics.
 *
 * Path A writes at 60Hz but the debug overlay subscribes to specific fields
 * via primitive selectors — if the field a component reads doesn't change,
 * it bails out (React.memo + subscribeWithSelector).
 *
 * Path B writes at 1Hz. Debug overlay panels re-render at most 1Hz.
 *
 * Invariant: MetricsBatcher.StoreSink is the ONLY writer to updateAggregatedMetrics().
 * Direct writes from anywhere else violate the two-path architecture.
 *
 * Production:
 *   recordFrame() still called (cheap: array slice + percentile on 120 numbers).
 *   updateAggregatedMetrics() still called (cheap: replace one object ref).
 *   If zero components subscribe to this store: Zustand skips all notifications.
 *   Debug overlay is not mounted in production → zero render cost.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { FrameTiming, RenderMetrics } from '@pulse/types/render';
import type { PulseError } from '@pulse/types/errors';
import type { MetricsSnapshot } from '../telemetry/collector.js';
import { average, percentile } from '../render/utils.js';

const MAX_FRAME_HISTORY = 120;
const MAX_ERROR_HISTORY = 50;

// ─── Aggregated metrics shape ─────────────────────────────────────────────────
// Written by StoreSink (1Hz). One flat object for efficient reference equality.

export interface AggregatedMetrics {
  readonly capturedAt: number;
  readonly windowMs: number;

  // Render
  readonly frameTimeAvgMs: number;
  readonly frameTimeP95Ms: number;
  readonly frameTimeP99Ms: number;
  readonly droppedFrameCount: number;
  readonly batchStrategyUpgrades: number;

  // Stream
  readonly firstTokenLatencyP50Ms: number;
  readonly firstTokenLatencyP95Ms: number;
  readonly tokensPerSecond: number;
  readonly activeStreams: number;
  readonly completedStreams: number;
  readonly erroredStreams: number;

  // Transport
  readonly wsRttP50Ms: number;
  readonly wsRttP95Ms: number;
  readonly reconnectCount: number;
  readonly connectDurationMs: number;

  // Replay
  readonly replayCount: number;
  readonly replayDurationP95Ms: number;
  readonly replayGapSizeP95: number;

  // Scheduler
  readonly queueDepthP95: number;
  readonly flushesSkipped: number;

  // Virtual
  readonly virtualRenderedItems: number;
  readonly virtualTotalItems: number;
  readonly virtualHeightPx: number;

  // Budget
  readonly budgetViolations: number;
}

const ZERO_AGGREGATED: AggregatedMetrics = {
  capturedAt: 0, windowMs: 0,
  frameTimeAvgMs: 0, frameTimeP95Ms: 0, frameTimeP99Ms: 0,
  droppedFrameCount: 0, batchStrategyUpgrades: 0,
  firstTokenLatencyP50Ms: 0, firstTokenLatencyP95Ms: 0,
  tokensPerSecond: 0, activeStreams: 0, completedStreams: 0, erroredStreams: 0,
  wsRttP50Ms: 0, wsRttP95Ms: 0, reconnectCount: 0, connectDurationMs: 0,
  replayCount: 0, replayDurationP95Ms: 0, replayGapSizeP95: 0,
  queueDepthP95: 0, flushesSkipped: 0,
  virtualRenderedItems: 0, virtualTotalItems: 0, virtualHeightPx: 0,
  budgetViolations: 0,
};

// ─── State ────────────────────────────────────────────────────────────────────

interface TelemetryState {
  readonly recentFrames: ReadonlyArray<FrameTiming>;
  readonly metrics: RenderMetrics;
  readonly aggregated: AggregatedMetrics;
  readonly recentErrors: ReadonlyArray<PulseError>;
  readonly totalErrors: number;
  readonly lastAggregatedAt: number; // primitive for cheap selector
}

interface TelemetryActions {
  recordFrame: (timing: FrameTiming) => void;
  updateAggregatedMetrics: (snapshot: MetricsSnapshot) => void;
  recordTransportError: (error: PulseError) => void;
  reset: () => void;
}

const ZERO_METRICS: RenderMetrics = {
  totalFrames: 0, droppedFrames: 0, avgFrameTimeMs: 0,
  p95FrameTimeMs: 0, totalTokensRendered: 0, tokensPerSecond: 0,
  rafFlushCount: 0, lastMeasuredAt: 0,
};

const INITIAL_STATE: TelemetryState = {
  recentFrames: [],
  metrics: ZERO_METRICS,
  aggregated: ZERO_AGGREGATED,
  recentErrors: [],
  totalErrors: 0,
  lastAggregatedAt: 0,
};

// ─── Metric snapshot → AggregatedMetrics ──────────────────────────────────────

function findMetric(snapshot: MetricsSnapshot, name: string) {
  return snapshot.metrics.find((m) => m.name === name);
}

function buildAggregated(snapshot: MetricsSnapshot): AggregatedMetrics {
  const get = (name: string) => findMetric(snapshot, name);

  return {
    capturedAt: snapshot.capturedAt,
    windowMs: snapshot.windowMs,

    frameTimeAvgMs:         get('render.frame_time_ms')?.avg ?? 0,
    frameTimeP95Ms:         get('render.frame_time_ms')?.p95 ?? 0,
    frameTimeP99Ms:         get('render.frame_time_ms')?.p99 ?? 0,
    droppedFrameCount:      get('render.frame_dropped')?.count ?? 0,
    batchStrategyUpgrades:  get('render.strategy_upgrades')?.count ?? 0,

    firstTokenLatencyP50Ms: get('stream.first_token_latency_ms')?.p50 ?? 0,
    firstTokenLatencyP95Ms: get('stream.first_token_latency_ms')?.p95 ?? 0,
    tokensPerSecond:        get('stream.tokens_per_second')?.avg ?? 0,
    activeStreams:          get('stream.active_count')?.lastValue ?? 0,
    completedStreams:       get('stream.completed_count')?.count ?? 0,
    erroredStreams:         get('stream.errored_count')?.count ?? 0,

    wsRttP50Ms:             get('transport.ws_rtt_ms')?.p50 ?? 0,
    wsRttP95Ms:             get('transport.ws_rtt_ms')?.p95 ?? 0,
    reconnectCount:         get('transport.reconnect_count')?.count ?? 0,
    connectDurationMs:      get('transport.connect_duration_ms')?.avg ?? 0,

    replayCount:            get('replay.count')?.count ?? 0,
    replayDurationP95Ms:    get('replay.duration_ms')?.p95 ?? 0,
    replayGapSizeP95:       get('replay.gap_size')?.p95 ?? 0,

    queueDepthP95:          get('scheduler.queue_depth_tokens')?.p95 ?? 0,
    flushesSkipped:         get('scheduler.flush_skipped')?.count ?? 0,

    virtualRenderedItems:   get('virtual.rendered_items')?.lastValue ?? 0,
    virtualTotalItems:      get('virtual.total_items')?.lastValue ?? 0,
    virtualHeightPx:        get('virtual.total_height_px')?.lastValue ?? 0,

    budgetViolations:       get('budget.violations')?.count ?? 0,
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTelemetryStore = create<TelemetryState & TelemetryActions>()(
  subscribeWithSelector((set) => ({
    ...INITIAL_STATE,

    // Path A: 60Hz frame recording (rolling 2s window)
    recordFrame: (timing) => {
      set((state) => {
        const frames = state.recentFrames.length >= MAX_FRAME_HISTORY
          ? [...state.recentFrames.slice(1), timing]
          : [...state.recentFrames, timing];

        const durations = frames.map((f) => f.durationMs);
        const tokens = frames.map((f) => f.totalTokens);
        const droppedFrames = frames.filter((f) => f.exceededBudget).length;
        const now = Date.now();
        const elapsed = frames.length > 0 ? now - (frames[0]?.startedAt ?? now) : 1;
        const totalTokens = tokens.reduce((s, t) => s + t, 0);

        const metrics: RenderMetrics = {
          totalFrames: state.metrics.totalFrames + 1,
          droppedFrames,
          avgFrameTimeMs: average(durations),
          p95FrameTimeMs: percentile(durations, 95),
          totalTokensRendered: state.metrics.totalTokensRendered + timing.totalTokens,
          tokensPerSecond: elapsed > 0 ? (totalTokens / elapsed) * 1000 : 0,
          rafFlushCount: state.metrics.rafFlushCount + 1,
          lastMeasuredAt: now,
        };

        return { recentFrames: frames, metrics };
      });
    },

    // Path B: 1Hz aggregated snapshot from MetricsBatcher
    updateAggregatedMetrics: (snapshot) => {
      set({
        aggregated: buildAggregated(snapshot),
        lastAggregatedAt: snapshot.capturedAt,
      });
    },

    recordTransportError: (error) => {
      set((state) => ({
        recentErrors:
          state.recentErrors.length >= MAX_ERROR_HISTORY
            ? [...state.recentErrors.slice(1), error]
            : [...state.recentErrors, error],
        totalErrors: state.totalErrors + 1,
      }));
    },

    reset: () => set(INITIAL_STATE),
  })),
);

// ─── Selectors ────────────────────────────────────────────────────────────────
// All return primitives → React.memo can bail out on unchanged values.

export const selectRenderMetrics = (s: TelemetryState & TelemetryActions): RenderMetrics =>
  s.metrics;

export const selectAggregated = (s: TelemetryState & TelemetryActions): AggregatedMetrics =>
  s.aggregated;

/** Primitive: use to trigger 1Hz re-render in debug overlay panels. */
export const selectLastAggregatedAt = (s: TelemetryState & TelemetryActions): number =>
  s.lastAggregatedAt;

// Frame-level primitives (60Hz update path)
export const selectDroppedFrames = (s: TelemetryState & TelemetryActions): number =>
  s.metrics.droppedFrames;
export const selectAvgFrameTime = (s: TelemetryState & TelemetryActions): number =>
  s.metrics.avgFrameTimeMs;
export const selectP95FrameTime = (s: TelemetryState & TelemetryActions): number =>
  s.metrics.p95FrameTimeMs;
export const selectTotalFrames = (s: TelemetryState & TelemetryActions): number =>
  s.metrics.totalFrames;
export const selectTotalErrors = (s: TelemetryState & TelemetryActions): number =>
  s.totalErrors;
export const selectRecentErrors = (s: TelemetryState & TelemetryActions) =>
  s.recentErrors;
