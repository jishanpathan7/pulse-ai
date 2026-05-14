/**
 * StreamInstrumentation — measures streaming latency and throughput.
 *
 * Key metric: first-token latency (TTFT).
 *   Start clock: stream_start received (server sends stream_start message)
 *   Stop clock:  first token received for this streamId
 *   Result: TTFT = stopTime - startTime
 *
 * Why TTFT matters:
 *   TTFT is the perceived responsiveness of the AI.
 *   Even if token throughput is high (150 tps), a 3s delay before the first
 *   token feels broken to users. This is the metric that matters most.
 *
 * Token throughput:
 *   Measured over the stream's lifetime: totalTokens / durationMs * 1000 = tps.
 *   Also tracked as a per-interval rate (tokens received in last 1s window).
 *
 * Stream lifecycle tracking:
 *   Per-stream state stored in Map<streamId, StreamTrack>.
 *   Map entries are removed when stream completes or errors.
 *   Max tracked streams: 50 (evicts oldest on overflow — shouldn't happen in practice).
 */

import type { StreamId } from '@pulse/types/transport';
import type { MetricsCollector } from '../collector.js';
import { Metric } from '../collector.js';
import type { BudgetEnforcer } from '../budget.js';
import { BUDGETS } from '../budget.js';
import type { PerformanceTimeline } from '../timeline.js';

interface StreamTrack {
  readonly streamId: StreamId;
  readonly startedAt: number;
  firstTokenAt: number | null;
  tokenCount: number;
}

const MAX_TRACKED_STREAMS = 50;

export class StreamInstrumentation {
  private readonly _collector: MetricsCollector;
  private readonly _budget: BudgetEnforcer;
  private readonly _timeline: PerformanceTimeline;
  private readonly _active = new Map<string, StreamTrack>();

  constructor(
    collector: MetricsCollector,
    budget: BudgetEnforcer,
    timeline: PerformanceTimeline,
  ) {
    this._collector = collector;
    this._budget = budget;
    this._timeline = timeline;
  }

  onStreamStart(streamId: StreamId, _conversationId: string): void {
    // Evict oldest if at capacity (shouldn't happen, but defensive)
    if (this._active.size >= MAX_TRACKED_STREAMS) {
      const first = this._active.keys().next().value;
      if (first !== undefined) this._active.delete(first);
    }

    const track: StreamTrack = {
      streamId,
      startedAt: performance.now(),
      firstTokenAt: null,
      tokenCount: 0,
    };

    this._active.set(streamId as string, track);
    this._collector.increment(Metric.STREAMS_ACTIVE);
    this._timeline.streamStart(streamId as string);
  }

  onToken(streamId: StreamId): void {
    const track = this._active.get(streamId as string);
    if (track === undefined) return;

    track.tokenCount++;
    this._collector.increment(Metric.TOKEN_COUNT, 1);

    // First token — measure TTFT
    if (track.firstTokenAt === null) {
      track.firstTokenAt = performance.now();
      const ttftMs = track.firstTokenAt - track.startedAt;

      this._collector.timing(Metric.FIRST_TOKEN_LATENCY_MS, ttftMs, streamId as string);
      this._timeline.streamFirstToken(streamId as string);

      // Budget check
      this._budget.check('stream.first_token_ms', BUDGETS.stream.firstTokenP50, ttftMs);
    }
  }

  onStreamEnd(streamId: StreamId, _totalTokens: number): void {
    const track = this._active.get(streamId as string);
    if (track === undefined) return;

    const endAt = performance.now();
    const durationMs = endAt - track.startedAt;
    const tps = durationMs > 0 ? (track.tokenCount / durationMs) * 1000 : 0;
    const ttft = track.firstTokenAt !== null ? track.firstTokenAt - track.startedAt : null;

    this._collector.timing(Metric.STREAM_DURATION_MS, durationMs, streamId as string);
    this._collector.record(Metric.TOKENS_PER_SECOND, tps, streamId as string);
    this._collector.increment(Metric.STREAMS_COMPLETED);

    this._timeline.streamEnd(streamId as string, track.tokenCount);

    // Throughput budget
    if (tps < BUDGETS.stream.minThroughput.hard) {
      this._budget.check('stream.throughput_tps', BUDGETS.stream.minThroughput, tps);
    }

    // Log ttft for completed stream aggregation
    if (ttft !== null) {
      this._collector.timing(Metric.FIRST_TOKEN_LATENCY_MS, ttft, streamId as string);
    }

    this._active.delete(streamId as string);
  }

  onStreamError(streamId: StreamId): void {
    this._collector.increment(Metric.STREAMS_ERRORED);
    this._active.delete(streamId as string);
    this._timeline.mark(`pulse:stream:error:${streamId as string}`);
  }

  get activeStreamCount(): number {
    return this._active.size;
  }

  get trackedStreamIds(): ReadonlyArray<string> {
    return [...this._active.keys()];
  }
}
