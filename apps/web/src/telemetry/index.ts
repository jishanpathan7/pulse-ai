/**
 * Telemetry subsystem — singleton initialization and public API.
 *
 * Creates and wires:
 *   MetricsCollector → MetricsBatcher → [ConsoleSink, StoreSink, RemoteSink?]
 *   PerformanceTimeline — direct Performance API access
 *   BudgetEnforcer — budget checking against collector
 *
 * Instrumentation objects (exported for use in other modules):
 *   renderInstrumentation  — wire to RenderPipeline frame callback
 *   streamInstrumentation  — wire to RenderPipeline message handler
 *   transportInstrumentation — wire to WsTransportClient state/message handlers
 *   virtualInstrumentation — wire to useVirtualizedMessages hook
 *
 * Boot:
 *   Call telemetry.start() once in main.tsx (before transport.connect()).
 *   Call telemetry.stop() on app teardown.
 *
 * Tree-shaking:
 *   In production builds, replace ConsoleSink with NullSink.
 *   PerformanceTimeline.disable() makes marks no-ops.
 *   The MetricsCollector still runs (minimal overhead) — only sink fan-out
 *   is eliminated. This preserves metrics for StoreSink (debug overlay).
 *
 * Singleton pattern rationale:
 *   Instrumentation modules need a stable reference to share the same
 *   collector/batcher. Module-level singleton is appropriate here because:
 *   - There's one app instance per browser tab
 *   - Metrics are global (not per-component)
 *   - Tests can call reset() between runs
 */

import { MetricsCollector } from './collector.js';
import { MetricsBatcher } from './batcher.js';
import { ConsoleSink, StoreSink, NullSink } from './sinks.js';
import { PerformanceTimeline } from './timeline.js';
import { BudgetEnforcer } from './budget.js';
import { RenderInstrumentation } from './instrumentation/render.js';
import { StreamInstrumentation } from './instrumentation/stream.js';
import { TransportInstrumentation } from './instrumentation/transport.js';
import { VirtualInstrumentation } from './instrumentation/virtual.js';

// ─── Build environment check ──────────────────────────────────────────────────

const IS_DEV = typeof process !== 'undefined'
  ? process.env['NODE_ENV'] !== 'production'
  : true;

// ─── Subsystem construction ───────────────────────────────────────────────────

const collector = new MetricsCollector();

const batcher = new MetricsBatcher(collector, {
  intervalMs: 1000,
  mode: 'auto',
});

// Sinks — dev gets console output, prod gets NullSink for console
if (IS_DEV) {
  batcher.addSink(new ConsoleSink({ minCountToLog: 2 }));
} else {
  batcher.addSink(new NullSink());
}

// StoreSink always active — powers the debug overlay
batcher.addSink(new StoreSink());

const timeline = new PerformanceTimeline(IS_DEV);
const budget = new BudgetEnforcer(collector, IS_DEV);

// ─── Instrumentation objects ──────────────────────────────────────────────────

export const renderInstrumentation = new RenderInstrumentation(collector, budget, timeline);
export const streamInstrumentation = new StreamInstrumentation(collector, budget, timeline);
export const transportInstrumentation = new TransportInstrumentation(collector, budget, timeline);
export const virtualInstrumentation = new VirtualInstrumentation(collector, budget, timeline);

// ─── Telemetry lifecycle ──────────────────────────────────────────────────────

export const telemetry = {
  start(): void {
    batcher.start();
  },

  stop(): void {
    batcher.flush(); // final flush before stop
    batcher.stop();
  },

  /** Immediate flush — useful for tests and page-hide events. */
  flush(): void {
    batcher.flush();
  },

  /** Reset all metrics — for test teardown. */
  reset(): void {
    collector.resetAll();
    renderInstrumentation.reset();
  },

  /** Disable expensive operations under load. */
  throttle(): void {
    timeline.disable();
    collector.disable();
  },

  resume(): void {
    timeline.enable();
    collector.enable();
  },

  get isRunning(): boolean { return batcher.isRunning; },
  get flushCount(): number { return batcher.flushCount; },

  // Expose for testing/debugging
  _collector: collector,
  _batcher: batcher,
  _timeline: timeline,
  _budget: budget,
} as const;

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { MetricsCollector } from './collector.js';
export { MetricsBatcher } from './batcher.js';
export { PerformanceTimeline } from './timeline.js';
export { BudgetEnforcer, BUDGETS } from './budget.js';
export { StreamSimulator } from './stress/simulator.js';
export { ChaosEngine } from './stress/chaos.js';
export { scenarios } from './stress/scenarios.js';
export type { LoadScenario, ScenarioName } from './stress/scenarios.js';
export type { Sampler } from './samplers.js';
export {
  AlwaysSampler,
  NeverSampler,
  RateSampler,
  AdaptiveSampler,
  RoundRobinSampler,
} from './samplers.js';
export { Metric } from './collector.js';
export type { MetricsSnapshot, MetricAggregation } from './collector.js';
