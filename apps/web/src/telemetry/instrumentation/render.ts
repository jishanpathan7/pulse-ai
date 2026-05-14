/**
 * RenderInstrumentation — instruments the RAF pipeline output.
 *
 * Attaches to:
 *   RAFScheduler.onFrame callback (FrameResult per flush)
 *   RenderPipeline._onFlush (batch details)
 *
 * Measures:
 *   - Frame time distribution (avg, p95, p99)
 *   - Dropped frame rate (frames > 16ms hard budget)
 *   - Tokens per frame (batch efficiency)
 *   - Active stream count per frame
 *   - Flush interval (time between RAF callbacks)
 *   - Strategy upgrade events (normal → budget-aware)
 *
 * Integration:
 *   const ri = new RenderInstrumentation(collector, budget, timeline);
 *   ri.recordFrame(result); // called inside RenderPipeline frame callback
 *
 * This is the ONLY instrumentation that runs at 60Hz.
 * Everything else runs at event frequency (stream start/end, connect, etc.)
 * or at batcher frequency (1Hz aggregated summaries).
 *
 * Performance guard:
 *   recordFrame() must complete in < 0.1ms.
 *   Budget check: two comparisons.
 *   Timeline mark: one performance.mark() call (~100ns).
 *   Collector record: one ring buffer push.
 */

import type { FrameResult } from '@pulse/types/render';
import type { MetricsCollector } from '../collector.js';
import { Metric } from '../collector.js';
import type { BudgetEnforcer } from '../budget.js';
import type { PerformanceTimeline } from '../timeline.js';

export class RenderInstrumentation {
  private readonly _collector: MetricsCollector;
  private readonly _budget: BudgetEnforcer;
  private readonly _timeline: PerformanceTimeline;
  private _lastFrameAt: number = 0;

  constructor(
    collector: MetricsCollector,
    budget: BudgetEnforcer,
    timeline: PerformanceTimeline,
  ) {
    this._collector = collector;
    this._budget = budget;
    this._timeline = timeline;
  }

  /**
   * Record the result of one RAF flush.
   * Called from RenderPipeline's frame callback — must be < 0.1ms.
   */
  recordFrame(result: FrameResult, activeStreamCount: number): void {
    // Frame time
    this._collector.timing(Metric.FRAME_TIME_MS, result.frameTimeMs);

    // Dropped frames (budget hard limit: 16ms)
    if (result.exceededBudget) {
      this._collector.increment(Metric.FRAME_DROPPED);
      this._budget.checkFrameTime(result.frameTimeMs);
    }

    // Batch stats
    this._collector.record(Metric.BATCH_TOKEN_COUNT, result.totalTokens);
    this._collector.record(Metric.BATCH_STREAM_COUNT, result.batchCount);
    this._collector.record(Metric.STREAMS_ACTIVE, activeStreamCount);

    // Flush interval (time between RAF callbacks)
    if (this._lastFrameAt > 0) {
      const interval = result.flushedAt - this._lastFrameAt;
      this._collector.timing(Metric.FLUSH_INTERVAL_MS, interval);
    }
    this._lastFrameAt = result.flushedAt;

    // Performance timeline mark (< 100ns)
    this._timeline.rafFlushEnd(result.batchCount, result.totalTokens);
  }

  recordFrameStart(frameIndex: number): void {
    this._timeline.rafFlushStart(frameIndex);
  }

  recordStrategyUpgrade(from: 'normal' | 'budget-aware', to: 'normal' | 'budget-aware'): void {
    this._collector.increment(Metric.STRATEGY_UPGRADES);
    this._timeline.mark('pulse:render:strategy_upgrade', { from, to });
  }

  recordFlushSkipped(pendingTokens: number): void {
    this._collector.increment(Metric.FLUSH_SKIPPED);
    this._collector.record(Metric.QUEUE_DEPTH_TOKENS, pendingTokens);
  }

  reset(): void {
    this._lastFrameAt = 0;
  }
}
