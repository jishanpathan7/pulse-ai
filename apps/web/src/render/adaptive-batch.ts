/**
 * AdaptiveBatchStrategy — decides whether to flush or skip based on frame budget.
 *
 * Phase 3 implements measurement and decision interface.
 * Actual frame-skipping (advanced) is Phase 4 / Phase 9 optimization.
 *
 * Strategies:
 *   NormalStrategy      — always flush (default; works at up to ~60 tokens/s)
 *   BudgetAwareStrategy — skip flush if frame budget is under pressure
 *                         and token count is below the urgency threshold
 *
 * The urgency threshold ensures token bursts always flush regardless of budget:
 * if 50 tokens are pending, we flush even under budget pressure to prevent
 * visible lag.
 *
 * Decision logging feeds into telemetryStore for observability.
 */

import type { BatchDecision } from '@pulse/types/render';
import type { FrameBudgetMonitor } from './frame-budget.js';

export interface BatchStrategy {
  shouldFlush(pendingTokenCount: number, monitor: FrameBudgetMonitor): BatchDecision;
}

/** Always flush. Zero overhead. Default for production until budget pressure observed. */
export class NormalBatchStrategy implements BatchStrategy {
  shouldFlush(_pendingTokenCount: number, _monitor: FrameBudgetMonitor): BatchDecision {
    return { shouldFlush: true, reason: 'normal' };
  }
}

/**
 * Skip flush when:
 *   - Frame budget is under soft pressure (avg > 14ms)
 *   - Token count is below urgencyThreshold
 *   - Recent drop rate exceeds dropRateThreshold
 *
 * Always flush when:
 *   - Token count >= urgencyThreshold (prevents visible lag)
 *   - stream_end is pending (forceFlush=true)
 */
export class BudgetAwareBatchStrategy implements BatchStrategy {
  private readonly _urgencyThreshold: number;
  private readonly _dropRateThreshold: number;

  constructor(options: { urgencyThreshold?: number; dropRateThreshold?: number } = {}) {
    this._urgencyThreshold = options.urgencyThreshold ?? 30;
    this._dropRateThreshold = options.dropRateThreshold ?? 0.3;
  }

  shouldFlush(pendingTokenCount: number, monitor: FrameBudgetMonitor): BatchDecision {
    // High token count → always flush regardless of budget
    if (pendingTokenCount >= this._urgencyThreshold) {
      return { shouldFlush: true, reason: 'normal' };
    }

    // Budget under pressure AND drop rate high → skip
    if (!monitor.isUnderSoftBudget && monitor.recentDropRate > this._dropRateThreshold) {
      return { shouldFlush: false, reason: 'budget-pressure' };
    }

    return { shouldFlush: true, reason: 'normal' };
  }
}

/** Force flush — used for stream_end finalization. */
export const forceFlush = (): BatchDecision => ({ shouldFlush: true, reason: 'force' });

/** Default strategy exported for use in RenderPipeline. */
export const defaultBatchStrategy: BatchStrategy = new NormalBatchStrategy();
