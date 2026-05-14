/**
 * Sampling strategies for telemetry event emission.
 *
 * Sampling gates expensive operations (serialization, dispatch, remote export)
 * NOT cheap operations (record/increment in MetricsCollector — those are always on).
 *
 * Use samplers to decide whether to:
 *   - Emit a TelemetryEvent to a sink
 *   - Perform a Performance.mark()
 *   - Run an expensive diagnostic computation
 *
 * Strategies:
 *   AlwaysSampler       — 100% (dev default)
 *   RateSampler         — fixed percentage (e.g., 10% for prod)
 *   AdaptiveSampler     — reduces rate under frame budget pressure
 *   NeverSampler        — 0% (zero overhead, for disabled paths)
 *   RoundRobinSampler   — every Nth event (deterministic, for stress tests)
 *
 * Composing:
 *   new CompositeSampler([new RateSampler(0.1), new AdaptiveSampler(monitor)])
 *   → samples only when BOTH accept (AND logic)
 */

import type { FrameBudgetMonitor } from '../render/frame-budget.js';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface Sampler {
  shouldSample(): boolean;
}

// ─── Implementations ──────────────────────────────────────────────────────────

/** Always sample — used in development. Zero overhead (always true). */
export class AlwaysSampler implements Sampler {
  shouldSample(): boolean { return true; }
}

/** Never sample — dead path, zero overhead. */
export class NeverSampler implements Sampler {
  shouldSample(): boolean { return false; }
}

/** Fixed sampling rate. */
export class RateSampler implements Sampler {
  private readonly _rate: number; // 0.0 to 1.0

  constructor(rate: number) {
    if (rate < 0 || rate > 1) throw new RangeError(`rate must be 0-1, got ${rate}`);
    this._rate = rate;
  }

  shouldSample(): boolean {
    return Math.random() < this._rate;
  }
}

/**
 * Every Nth event — deterministic sampling.
 * Useful in stress tests where reproducibility matters.
 */
export class RoundRobinSampler implements Sampler {
  private _counter: number = 0;
  private readonly _every: number;

  constructor(every: number) {
    this._every = every;
  }

  shouldSample(): boolean {
    this._counter++;
    return this._counter % this._every === 0;
  }

  reset(): void { this._counter = 0; }
}

/**
 * Adaptive sampler — reduces sampling rate when frame budget is under pressure.
 *
 * Normal (p95 < 14ms):  sample at fullRate
 * Pressure (p95 ≥ 14ms): sample at reducedRate
 *
 * Prevents telemetry itself from contributing to frame drops during heavy streaming.
 */
export class AdaptiveSampler implements Sampler {
  private readonly _monitor: FrameBudgetMonitor;
  private readonly _fullRate: number;
  private readonly _reducedRate: number;

  constructor(
    monitor: FrameBudgetMonitor,
    options: { fullRate?: number; reducedRate?: number } = {},
  ) {
    this._monitor = monitor;
    this._fullRate = options.fullRate ?? 1.0;
    this._reducedRate = options.reducedRate ?? 0.1;
  }

  shouldSample(): boolean {
    const rate = this._monitor.isUnderSoftBudget ? this._fullRate : this._reducedRate;
    return Math.random() < rate;
  }
}

/**
 * AND composition — all samplers must accept.
 * Use to combine rate + adaptive sampling.
 */
export class CompositeSampler implements Sampler {
  private readonly _samplers: ReadonlyArray<Sampler>;

  constructor(samplers: ReadonlyArray<Sampler>) {
    this._samplers = samplers;
  }

  shouldSample(): boolean {
    return this._samplers.every((s) => s.shouldSample());
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createDefaultSampler(isDev: boolean): Sampler {
  return isDev ? new AlwaysSampler() : new RateSampler(0.1);
}
