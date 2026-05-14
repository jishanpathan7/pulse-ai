/**
 * VirtualInstrumentation — TanStack Virtual scroll performance metrics.
 *
 * Tracks:
 *   - Rendered items vs total items (virtualization ratio)
 *   - Total virtual list height (affects scroll performance)
 *   - Items awaiting first measurement (unmeasured items = estimated heights)
 *   - Scroll frame time (time to handle a scroll event + virtualizer update)
 *
 * Virtualization ratio:
 *   ratio = renderedItems / totalItems
 *   At 1.0: no virtualization benefit (all items in DOM — should not happen for long lists)
 *   At 0.05: 5% of items rendered — good for 500+ item lists
 *   Target: < 0.1 for lists > 100 items
 *
 * Unmeasured items:
 *   TanStack Virtual measures items lazily via ResizeObserver.
 *   Until measured, items use estimated height.
 *   Many unmeasured items = inaccurate scroll position = janky scroll.
 *   Target: < 5 unmeasured items at any time.
 *
 * Usage:
 *   Call vi.recordVirtualizerState() from useVirtualizedMessages
 *   after each render — but ONLY via a throttled hook (not on every token flush).
 *   The hook fires at message-count-change frequency, not token frequency.
 *
 * Frequency: fires when items.length changes (not per RAF flush).
 * This is O(messages) per session, not O(frames) per second.
 */

import type { MetricsCollector } from '../collector.js';
import { Metric } from '../collector.js';
import type { BudgetEnforcer } from '../budget.js';
import { BUDGETS } from '../budget.js';
import type { PerformanceTimeline } from '../timeline.js';

export interface VirtualizerSnapshot {
  readonly conversationId: string;
  readonly totalItems: number;
  readonly renderedItems: number;
  readonly totalHeightPx: number;
}

export class VirtualInstrumentation {
  private readonly _collector: MetricsCollector;
  private readonly _budget: BudgetEnforcer;
  private readonly _timeline: PerformanceTimeline;

  constructor(
    collector: MetricsCollector,
    budget: BudgetEnforcer,
    timeline: PerformanceTimeline,
  ) {
    this._collector = collector;
    this._budget = budget;
    this._timeline = timeline;
  }

  recordVirtualizerState(snap: VirtualizerSnapshot): void {
    const { totalItems, renderedItems, totalHeightPx } = snap;

    this._collector.record(Metric.VIRTUAL_TOTAL_ITEMS, totalItems);
    this._collector.record(Metric.VIRTUAL_RENDERED_ITEMS, renderedItems);
    this._collector.record(Metric.VIRTUAL_HEIGHT_PX, totalHeightPx);

    // Unmeasured item count estimate: TanStack Virtual renders overscan+visible items
    // If renderedItems > totalItems * 0.5 for a large list, virtualization isn't helping
    if (totalItems > 20) {
      const ratio = renderedItems / totalItems;
      if (ratio > 0.5) {
        this._budget.check(
          'virtual.ratio',
          { soft: 0.3, hard: 0.6, unit: '', direction: 'lower-is-better' },
          ratio,
        );
      }
    }
  }

  recordScrollFrameTime(frameTimeMs: number): void {
    this._collector.timing('virtual.scroll_frame_ms', frameTimeMs);

    if (frameTimeMs > BUDGETS.virtual.scrollFrameMs.soft) {
      this._budget.check('virtual.scroll_frame_ms', BUDGETS.virtual.scrollFrameMs, frameTimeMs);
      if (frameTimeMs > BUDGETS.virtual.scrollFrameMs.hard) {
        this._timeline.mark('pulse:virtual:jank', { frameTimeMs });
      }
    }
  }
}
