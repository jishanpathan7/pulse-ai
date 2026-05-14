/**
 * MetricsCollector — hot-path metrics accumulator. NOT Zustand.
 *
 * Design principle: zero React involvement.
 *   Recording a metric must be sub-microsecond.
 *   No setState, no event dispatch, no closures captured per metric.
 *
 * Two measurement modes:
 *   record(name, value)   — gauge: latest value + running stats
 *   increment(name, by)   — counter: monotonically increasing count
 *
 * Per-metric state:
 *   CircularBuffer<number> of last N samples for percentile computation
 *   Separate accumulator for count/sum (not reset on window roll, for rates)
 *
 * MetricsBatcher reads a snapshot every ~1s and writes to telemetryStore.
 * The collector resets per-window state after each batcher read.
 *
 * Tags:
 *   Optional key-value labels narrow a metric (e.g., streamId, conversationId).
 *   Tags are stored with samples for filtered aggregation.
 *   Kept minimal — tag explosion kills ring buffer efficiency.
 *
 * Thread safety: JS is single-threaded. No locks needed.
 */

import { CircularBuffer, percentile, average } from '../render/utils.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MetricSample {
  readonly value: number;
  readonly timestamp: number;
  readonly tag: string; // "" if no tag
}

export interface MetricAggregation {
  readonly name: string;
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly lastValue: number;
  readonly rate: number;    // count / windowMs
  readonly windowMs: number;
}

export interface MetricsSnapshot {
  readonly capturedAt: number;
  readonly windowMs: number;
  readonly metrics: ReadonlyArray<MetricAggregation>;
}

// ─── Internal Buffer ──────────────────────────────────────────────────────────

const SAMPLES_PER_METRIC = 120;

interface MetricState {
  samples: CircularBuffer<MetricSample>;
  totalCount: number;   // never reset — lifetime counter
  windowCount: number;  // reset after each snapshot
  windowSum: number;
  windowMin: number;
  windowMax: number;
  lastValue: number;
  windowStartMs: number;
}

function freshState(): MetricState {
  return {
    samples: new CircularBuffer<MetricSample>(SAMPLES_PER_METRIC),
    totalCount: 0,
    windowCount: 0,
    windowSum: 0,
    windowMin: Infinity,
    windowMax: -Infinity,
    lastValue: 0,
    windowStartMs: Date.now(),
  };
}

function aggregate(name: string, state: MetricState): MetricAggregation {
  const now = Date.now();
  const windowMs = now - state.windowStartMs;
  const values = state.samples.toArray().map((s) => s.value);

  return {
    name,
    count: state.windowCount,
    sum: state.windowSum,
    min: state.windowCount > 0 ? state.windowMin : 0,
    max: state.windowCount > 0 ? state.windowMax : 0,
    avg: average(values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    lastValue: state.lastValue,
    rate: windowMs > 0 ? (state.windowCount / windowMs) * 1000 : 0,
    windowMs,
  };
}

// ─── MetricsCollector ────────────────────────────────────────────────────────

export class MetricsCollector {
  private readonly _metrics = new Map<string, MetricState>();
  private _enabled: boolean = true;

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  get isEnabled(): boolean { return this._enabled; }

  /**
   * Record a gauge value.
   * Used for: frame times, latencies, queue depths, RTT.
   * tag: optional label (e.g., streamId) — keep cardinality low.
   */
  record(name: string, value: number, tag: string = ''): void {
    if (!this._enabled) return;
    const state = this._getOrCreate(name);
    const sample: MetricSample = { value, timestamp: Date.now(), tag };
    state.samples.push(sample);
    state.totalCount++;
    state.windowCount++;
    state.windowSum += value;
    if (value < state.windowMin) state.windowMin = value;
    if (value > state.windowMax) state.windowMax = value;
    state.lastValue = value;
  }

  /**
   * Increment a counter.
   * Used for: token counts, reconnect counts, error counts, dropped frames.
   */
  increment(name: string, by: number = 1): void {
    if (!this._enabled) return;
    const state = this._getOrCreate(name);
    state.totalCount += by;
    state.windowCount += by;
    state.windowSum += by;
    state.lastValue += by;
    // No sample recorded — pure counter
  }

  /**
   * Shorthand for record() with semantic clarity.
   * Used for: all duration measurements.
   */
  timing(name: string, durationMs: number, tag: string = ''): void {
    this.record(name, durationMs, tag);
  }

  /**
   * Get lifetime total for a counter metric.
   * Survives window resets.
   */
  totalCount(name: string): number {
    return this._metrics.get(name)?.totalCount ?? 0;
  }

  /**
   * Snapshot all metrics for the current window.
   * Called by MetricsBatcher on each flush interval.
   * Does NOT reset state — call resetWindow() after consuming the snapshot.
   */
  snapshot(): MetricsSnapshot {
    const now = Date.now();
    const metrics: MetricAggregation[] = [];

    for (const [name, state] of this._metrics) {
      if (state.windowCount > 0 || state.samples.size > 0) {
        metrics.push(aggregate(name, state));
      }
    }

    const windowStart = metrics.length > 0
      ? Math.min(...[...this._metrics.values()].map((s) => s.windowStartMs))
      : now;

    return {
      capturedAt: now,
      windowMs: now - windowStart,
      metrics,
    };
  }

  /**
   * Reset per-window accumulators (not lifetime counters).
   * Called by MetricsBatcher after consuming snapshot.
   */
  resetWindow(): void {
    const now = Date.now();
    for (const state of this._metrics.values()) {
      state.windowCount = 0;
      state.windowSum = 0;
      state.windowMin = Infinity;
      state.windowMax = -Infinity;
      state.windowStartMs = now;
      // Preserve: totalCount, lastValue, samples (for percentile continuity)
    }
  }

  /**
   * Full reset — clears all state including samples and lifetime counters.
   * Use for test teardown or session reset.
   */
  resetAll(): void {
    this._metrics.clear();
  }

  /** Names of all tracked metrics. */
  get metricNames(): ReadonlyArray<string> {
    return [...this._metrics.keys()];
  }

  private _getOrCreate(name: string): MetricState {
    let state = this._metrics.get(name);
    if (state === undefined) {
      state = freshState();
      this._metrics.set(name, state);
    }
    return state;
  }
}

// ─── Metric Name Constants ─────────────────────────────────────────────────────
// Central registry prevents typos in metric names.

export const Metric = {
  // Render
  FRAME_TIME_MS:          'render.frame_time_ms',
  FRAME_DROPPED:          'render.frame_dropped',
  BATCH_TOKEN_COUNT:      'render.batch_tokens',
  BATCH_STREAM_COUNT:     'render.batch_streams',
  STRATEGY_UPGRADES:      'render.strategy_upgrades',

  // Scheduler
  QUEUE_DEPTH_TOKENS:     'scheduler.queue_depth_tokens',
  QUEUE_DEPTH_STREAMS:    'scheduler.queue_depth_streams',
  FLUSH_SKIPPED:          'scheduler.flush_skipped',
  FLUSH_INTERVAL_MS:      'scheduler.flush_interval_ms',

  // Stream
  FIRST_TOKEN_LATENCY_MS: 'stream.first_token_latency_ms',
  TOKENS_PER_SECOND:      'stream.tokens_per_second',
  TOKEN_COUNT:            'stream.token_count',
  STREAM_DURATION_MS:     'stream.duration_ms',
  STREAMS_ACTIVE:         'stream.active_count',
  STREAMS_COMPLETED:      'stream.completed_count',
  STREAMS_ERRORED:        'stream.errored_count',

  // Transport
  WS_RTT_MS:              'transport.ws_rtt_ms',
  WS_RECONNECT_COUNT:     'transport.reconnect_count',
  WS_CONNECT_DURATION_MS: 'transport.connect_duration_ms',
  WS_BYTES_RECEIVED:      'transport.bytes_received',

  // Replay
  REPLAY_DURATION_MS:     'replay.duration_ms',
  REPLAY_GAP_SIZE:        'replay.gap_size',
  REPLAY_CHUNKS_RECEIVED: 'replay.chunks_received',
  REPLAY_COUNT:           'replay.count',

  // Virtual
  VIRTUAL_RENDERED_ITEMS: 'virtual.rendered_items',
  VIRTUAL_TOTAL_ITEMS:    'virtual.total_items',
  VIRTUAL_HEIGHT_PX:      'virtual.total_height_px',

  // Budget violations
  BUDGET_VIOLATIONS:      'budget.violations',
} as const;

export type MetricName = (typeof Metric)[keyof typeof Metric];
