/**
 * Performance budget definitions and violation detection.
 *
 * Budgets are layered:
 *   soft  — degraded performance; emit warning metric
 *   hard  — unacceptable; emit error metric + console.warn in dev
 *
 * Categories:
 *   render    — RAF frame timing, batch size
 *   stream    — first-token latency, token throughput
 *   transport — WS RTT, reconnect frequency
 *   virtual   — scroll frame time, measurement lag
 *   scheduler — queue depth, flush interval
 *
 * BudgetEnforcer:
 *   Checks a value against a budget and records a violation metric
 *   if exceeded. Does NOT throw — violations are observable, not fatal.
 *
 * Usage:
 *   enforcer.check('render.frame_time_ms', frameTimeMs);
 *   // → records 'budget.violations' increment if exceeded
 *   // → emits console.warn in dev if hard limit exceeded
 */

import type { MetricsCollector } from './collector.js';
import { Metric } from './collector.js';

// ─── Budget Definitions ───────────────────────────────────────────────────────

export interface BudgetThreshold {
  readonly soft: number;
  readonly hard: number;
  readonly unit: string;
  readonly direction: 'lower-is-better' | 'higher-is-better';
}

export const BUDGETS = {
  render: {
    frameTimeMs:    { soft: 14, hard: 16, unit: 'ms',       direction: 'lower-is-better' },
    dropRatePct:    { soft: 5,  hard: 15, unit: '%',        direction: 'lower-is-better' },
    batchTokens:    { soft: 30, hard: 80, unit: 'tokens',   direction: 'lower-is-better' },
  },
  stream: {
    firstTokenP50:  { soft: 300,  hard: 1000,  unit: 'ms', direction: 'lower-is-better' },
    firstTokenP95:  { soft: 1000, hard: 3000,  unit: 'ms', direction: 'lower-is-better' },
    minThroughput:  { soft: 20,   hard: 5,     unit: 'tps', direction: 'higher-is-better' },
  },
  transport: {
    rttMs:             { soft: 100,  hard: 500,  unit: 'ms',  direction: 'lower-is-better' },
    reconnectsPerHour: { soft: 3,    hard: 10,   unit: 'n',   direction: 'lower-is-better' },
    replayDurationMs:  { soft: 2000, hard: 8000, unit: 'ms',  direction: 'lower-is-better' },
  },
  virtual: {
    scrollFrameMs:     { soft: 16,  hard: 32,  unit: 'ms', direction: 'lower-is-better' },
    unmeasuredItems:   { soft: 5,   hard: 20,  unit: 'n',  direction: 'lower-is-better' },
  },
  scheduler: {
    queueDepth:        { soft: 20,  hard: 100, unit: 'tokens', direction: 'lower-is-better' },
    flushIntervalMs:   { soft: 18,  hard: 33,  unit: 'ms',     direction: 'lower-is-better' },
  },
} as const satisfies Record<string, Record<string, BudgetThreshold>>;

export type BudgetCategory = keyof typeof BUDGETS;

// ─── Violation Record ─────────────────────────────────────────────────────────

export interface BudgetViolation {
  readonly metric: string;
  readonly actual: number;
  readonly budget: number;
  readonly severity: 'soft' | 'hard';
  readonly timestamp: number;
}

// ─── BudgetEnforcer ───────────────────────────────────────────────────────────

export class BudgetEnforcer {
  private readonly _collector: MetricsCollector;
  private readonly _isDev: boolean;
  private readonly _violations: BudgetViolation[] = [];
  private static readonly MAX_VIOLATIONS = 100;

  constructor(collector: MetricsCollector, isDev: boolean = false) {
    this._collector = collector;
    this._isDev = isDev;
  }

  /**
   * Check a value against a budget threshold.
   * Records a violation metric if exceeded.
   * Returns 'ok' | 'soft' | 'hard'.
   */
  check(metricName: string, threshold: BudgetThreshold, value: number): 'ok' | 'soft' | 'hard' {
    const { direction, soft, hard } = threshold;
    const exceeded =
      direction === 'lower-is-better'
        ? (v: number, limit: number) => v > limit
        : (v: number, limit: number) => v < limit;

    if (!exceeded(value, hard)) {
      // Check soft
      if (!exceeded(value, soft)) return 'ok';
      this._recordViolation(metricName, value, soft, 'soft');
      return 'soft';
    }

    this._recordViolation(metricName, value, hard, 'hard');
    if (this._isDev) {
      console.warn(
        `[Budget HARD] ${metricName}: ${value.toFixed(2)}${threshold.unit} > ${hard}${threshold.unit}`,
      );
    }
    return 'hard';
  }

  /**
   * Convenience: check render frame time.
   * Called on every RAF flush — must be extremely cheap.
   */
  checkFrameTime(frameTimeMs: number): 'ok' | 'soft' | 'hard' {
    return this.check('render.frame_time_ms', BUDGETS.render.frameTimeMs, frameTimeMs);
  }

  get recentViolations(): ReadonlyArray<BudgetViolation> {
    return this._violations;
  }

  get totalViolations(): number {
    return this._collector.totalCount(Metric.BUDGET_VIOLATIONS);
  }

  private _recordViolation(
    metric: string,
    actual: number,
    budget: number,
    severity: 'soft' | 'hard',
  ): void {
    this._collector.increment(Metric.BUDGET_VIOLATIONS);

    const violation: BudgetViolation = {
      metric,
      actual,
      budget,
      severity,
      timestamp: Date.now(),
    };

    if (this._violations.length >= BudgetEnforcer.MAX_VIOLATIONS) {
      this._violations.shift();
    }
    this._violations.push(violation);
  }
}
