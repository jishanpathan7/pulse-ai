/**
 * FrameBudgetMonitor — tracks RAF flush timings and detects budget pressure.
 *
 * The 16ms budget assumes a 60Hz display (1000ms / 60 = 16.67ms per frame).
 * React's render + commit + browser paint must all fit within this budget.
 *
 * We budget for:
 *   ~4ms  transport decoding + sequence tracking
 *   ~6ms  React render (active streaming message)
 *   ~4ms  browser composite
 *   ─────
 *   14ms  soft threshold for "budget pressure"
 *   16ms  hard threshold for "dropped frame"
 *
 * The monitor does NOT apply backpressure itself.
 * It emits data; the AdaptiveBatch strategy consumes it.
 */

import type { FrameTiming, RenderMetrics } from '@pulse/types/render';
import { CircularBuffer, average, percentile } from './utils.js';

const SOFT_BUDGET_MS = 14;
const HARD_BUDGET_MS = 16;
const SAMPLES = 120; // 2 seconds of data at 60fps

export class FrameBudgetMonitor {
  private readonly _timings: CircularBuffer<FrameTiming>;
  private _frameIndex: number = 0;
  private _droppedFrames: number = 0;
  private _totalTokens: number = 0;
  private _rafFlushCount: number = 0;
  private _firstFrameAt: number | null = null;

  constructor(samples: number = SAMPLES) {
    this._timings = new CircularBuffer<FrameTiming>(samples);
  }

  /**
   * Record the result of one RAF flush.
   * Called by RAFScheduler.onFrame callback.
   */
  record(
    durationMs: number,
    batchCount: number,
    totalTokens: number,
  ): FrameTiming {
    const now = Date.now();
    if (this._firstFrameAt === null) this._firstFrameAt = now;

    const exceeded = durationMs > HARD_BUDGET_MS;
    if (exceeded) this._droppedFrames++;

    const timing: FrameTiming = {
      frameIndex: this._frameIndex++,
      startedAt: now,
      durationMs,
      batchCount,
      totalTokens,
      exceededBudget: exceeded,
    };

    this._timings.push(timing);
    this._totalTokens += totalTokens;
    this._rafFlushCount++;

    return timing;
  }

  get metrics(): RenderMetrics {
    const timings = this._timings.toArray();
    const durations = timings.map((t) => t.durationMs);
    const elapsedMs =
      this._firstFrameAt !== null ? Date.now() - this._firstFrameAt : 1;

    return {
      totalFrames: this._frameIndex,
      droppedFrames: this._droppedFrames,
      avgFrameTimeMs: average(durations),
      p95FrameTimeMs: percentile(durations, 95),
      totalTokensRendered: this._totalTokens,
      tokensPerSecond: (this._totalTokens / elapsedMs) * 1000,
      rafFlushCount: this._rafFlushCount,
      lastMeasuredAt: Date.now(),
    };
  }

  get isUnderSoftBudget(): boolean {
    const timings = this._timings.toArray();
    if (timings.length === 0) return true;
    return average(timings.map((t) => t.durationMs)) < SOFT_BUDGET_MS;
  }

  get isUnderHardBudget(): boolean {
    const timings = this._timings.toArray();
    if (timings.length === 0) return true;
    return average(timings.map((t) => t.durationMs)) < HARD_BUDGET_MS;
  }

  /** Recent 10-frame drop rate. 0.0 = no drops, 1.0 = all frames dropped. */
  get recentDropRate(): number {
    const recent = this._timings.toArray().slice(-10);
    if (recent.length === 0) return 0;
    return recent.filter((t) => t.exceededBudget).length / recent.length;
  }

  reset(): void {
    this._timings.clear();
    this._frameIndex = 0;
    this._droppedFrames = 0;
    this._totalTokens = 0;
    this._rafFlushCount = 0;
    this._firstFrameAt = null;
  }
}
