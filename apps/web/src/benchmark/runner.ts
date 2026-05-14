/**
 * BenchmarkRunner — automated performance measurement suite.
 *
 * Runs predefined scenarios against the render pipeline and captures
 * telemetry metrics for each. Produces structured BenchmarkReport objects
 * that can be displayed in the BenchmarkPanel or exported as JSON.
 *
 * Architecture:
 *   1. For each scenario: run StreamSimulator (existing stress infrastructure)
 *   2. Poll MetricsCollector at scenario end for per-window stats
 *   3. Wait for stable FPS (3 frames below budget) before recording
 *   4. Store result in BenchmarkReport
 *
 * The runner re-uses existing telemetry infrastructure — no new metrics paths.
 * Results reflect what you'd see in the debug overlay, just captured
 * programmatically instead of read visually.
 *
 * Chrome Performance Timeline:
 *   The runner marks performance.mark('benchmark:start:{scenario}') and
 *   performance.measure('benchmark:{scenario}') for each run.
 *   These appear in Chrome DevTools Performance tab flame charts.
 *
 * Usage:
 *   const runner = new BenchmarkRunner(renderPipeline, telemetry._collector);
 *   const report = await runner.run(['singleStreamNormal', 'worstCase']);
 *   console.log(formatReport(report));
 */

import type { RenderPipeline } from '../render/pipeline.js';
import type { MetricsCollector } from '../telemetry/collector.js';
import { StreamSimulator } from '../telemetry/stress/simulator.js';
import { scenarios } from '../telemetry/stress/scenarios.js';
import type { ScenarioName } from '../telemetry/stress/scenarios.js';
import { useTelemetryStore } from '../store/telemetry-store.js';

// ─── Report types ─────────────────────────────────────────────────────────────

export interface ScenarioResult {
  readonly scenario: ScenarioName;
  readonly durationMs: number;
  readonly framesRecorded: number;
  readonly totalTokensDelivered: number;

  // Frame timing
  readonly avgFrameTimeMs: number;
  readonly p95FrameTimeMs: number;
  readonly p99FrameTimeMs: number;
  readonly droppedFrameCount: number;
  readonly droppedFramePercent: number;
  readonly budgetViolations: number;

  // Throughput
  readonly tokensPerSecond: number;
  readonly firstTokenLatencyP50Ms: number;
  readonly firstTokenLatencyP95Ms: number;

  // Strategy
  readonly strategyUpgraded: boolean;
  readonly finalStrategy: 'normal' | 'budget-aware';

  // Scheduler
  readonly queueDepthP95: number;
  readonly flushesSkipped: number;
}

export interface BenchmarkReport {
  readonly runAt: number;
  readonly scenarios: ReadonlyArray<ScenarioResult>;
  readonly summary: {
    readonly totalDurationMs: number;
    readonly scenarioCount: number;
    readonly allPassed: boolean;  // all scenarios within budget
    readonly worstP95Ms: number;
    readonly worstDropRate: number;
  };
}

// ─── Budget thresholds ────────────────────────────────────────────────────────

const PASS_P95_MS = 14;  // P95 must be below 14ms (84% of 16.67ms budget)
const PASS_DROP_PCT = 2; // Less than 2% frames dropped

// ─── BenchmarkRunner ─────────────────────────────────────────────────────────

export class BenchmarkRunner {
  private readonly _pipeline: RenderPipeline;
  private readonly _collector: MetricsCollector;
  private _aborted = false;

  constructor(pipeline: RenderPipeline, collector: MetricsCollector) {
    this._pipeline = pipeline;
    this._collector = collector;
  }

  abort(): void { this._aborted = true; }

  async run(
    scenarioNames: ReadonlyArray<ScenarioName> = Object.keys(scenarios) as ScenarioName[],
    onProgress?: (completed: number, total: number, latest: ScenarioResult) => void,
  ): Promise<BenchmarkReport> {
    const results: ScenarioResult[] = [];
    const runAt = Date.now();
    this._aborted = false;

    for (let i = 0; i < scenarioNames.length; i++) {
      if (this._aborted) break;

      const name = scenarioNames[i]!;
      const result = await this._runScenario(name);
      results.push(result);
      onProgress?.(i + 1, scenarioNames.length, result);

      // Cool-down between scenarios (let RAF pipeline drain)
      await waitMs(300);
    }

    const worstP95 = results.reduce((m, r) => Math.max(m, r.p95FrameTimeMs), 0);
    const worstDrop = results.reduce((m, r) => Math.max(m, r.droppedFramePercent), 0);

    return {
      runAt,
      scenarios: results,
      summary: {
        totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
        scenarioCount: results.length,
        allPassed: results.every((r) => r.p95FrameTimeMs <= PASS_P95_MS && r.droppedFramePercent <= PASS_DROP_PCT),
        worstP95Ms: worstP95,
        worstDropRate: worstDrop,
      },
    };
  }

  private async _runScenario(name: ScenarioName): Promise<ScenarioResult> {
    const scenario = scenarios[name];

    // Chrome User Timing markers for flame chart
    const markStart = `benchmark:${name}:start`;
    const markEnd = `benchmark:${name}:end`;
    performance.mark(markStart);

    // Reset collector window for clean per-scenario metrics
    this._collector.resetWindow();

    const sim = new StreamSimulator(scenario.simulator);
    const transport = sim.createTransport();
    this._pipeline.connect(transport);
    await transport.connect('benchmark://');

    const simResult = await sim.run();

    performance.mark(markEnd);
    performance.measure(`benchmark:${name}`, markStart, markEnd);

    // Wait one more frame for final flush
    await waitFrame();
    this._pipeline.disconnect();

    // Capture from telemetry store (most recent 1Hz aggregate)
    const agg = useTelemetryStore.getState().aggregated;
    // And live metrics from 60Hz path
    const liveMetrics = useTelemetryStore.getState().metrics;

    const droppedPct = liveMetrics.totalFrames > 0
      ? (liveMetrics.droppedFrames / liveMetrics.totalFrames) * 100
      : 0;

    return {
      scenario: name,
      durationMs: Math.round(simResult.durationMs),
      framesRecorded: liveMetrics.totalFrames,
      totalTokensDelivered: simResult.totalTokensDelivered,

      avgFrameTimeMs: parseFloat(agg.frameTimeAvgMs.toFixed(2)),
      p95FrameTimeMs: parseFloat(agg.frameTimeP95Ms.toFixed(2)),
      p99FrameTimeMs: parseFloat(agg.frameTimeP99Ms.toFixed(2)),
      droppedFrameCount: liveMetrics.droppedFrames,
      droppedFramePercent: parseFloat(droppedPct.toFixed(1)),
      budgetViolations: agg.budgetViolations,

      tokensPerSecond: parseFloat(agg.tokensPerSecond.toFixed(1)),
      firstTokenLatencyP50Ms: agg.firstTokenLatencyP50Ms,
      firstTokenLatencyP95Ms: agg.firstTokenLatencyP95Ms,

      strategyUpgraded: agg.batchStrategyUpgrades > 0,
      finalStrategy: agg.batchStrategyUpgrades > 0 ? 'budget-aware' : 'normal',

      queueDepthP95: Math.round(agg.queueDepthP95),
      flushesSkipped: agg.flushesSkipped,
    };
  }
}

// ─── Text report formatter ────────────────────────────────────────────────────
// Produces a plain-text table suitable for README embedding or console output.

export function formatReport(report: BenchmarkReport): string {
  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║              PULSE AI — PERFORMANCE BENCHMARK                ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`Run at: ${new Date(report.runAt).toISOString()}`);
  lines.push(`Result: ${report.summary.allPassed ? '✓ ALL PASS' : '✗ FAILURES DETECTED'}`);
  lines.push('');

  for (const r of report.scenarios) {
    const budgetPct = ((r.p95FrameTimeMs / 16.67) * 100).toFixed(0);
    const p95Status = r.p95FrameTimeMs <= PASS_P95_MS ? '✓' : '✗';
    const dropStatus = r.droppedFramePercent <= PASS_DROP_PCT ? '✓' : '✗';

    lines.push(`── ${r.scenario} ──────────────────────────────`);
    lines.push(`  Duration:          ${r.durationMs}ms`);
    lines.push(`  Tokens delivered:  ${r.totalTokensDelivered}  (${r.tokensPerSecond} tps)`);
    lines.push(`  Frames recorded:   ${r.framesRecorded}`);
    lines.push('');
    lines.push(`  ${p95Status} Frame avg:      ${r.avgFrameTimeMs.toFixed(2)}ms`);
    lines.push(`  ${p95Status} Frame p95:      ${r.p95FrameTimeMs.toFixed(2)}ms  (${budgetPct}% of 16.67ms budget)`);
    lines.push(`  ${p95Status} Frame p99:      ${r.p99FrameTimeMs.toFixed(2)}ms`);
    lines.push(`  ${dropStatus} Dropped:        ${r.droppedFrameCount} frames  (${r.droppedFramePercent}%)`);
    lines.push(`     Violations:     ${r.budgetViolations}`);
    lines.push('');
    lines.push(`     TTFT p50:       ${r.firstTokenLatencyP50Ms}ms`);
    lines.push(`     TTFT p95:       ${r.firstTokenLatencyP95Ms}ms`);
    lines.push(`     Strategy:       ${r.finalStrategy}${r.strategyUpgraded ? ' (auto-upgraded)' : ''}`);
    lines.push(`     Queue p95:      ${r.queueDepthP95} tokens`);
    lines.push('');
  }

  lines.push('── Summary ───────────────────────────────────────────────────');
  lines.push(`  Total duration:  ${(report.summary.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push(`  Worst p95:       ${report.summary.worstP95Ms.toFixed(2)}ms`);
  lines.push(`  Worst drop rate: ${report.summary.worstDropRate.toFixed(1)}%`);
  lines.push(`  Pass threshold:  p95 ≤ ${PASS_P95_MS}ms, drop ≤ ${PASS_DROP_PCT}%`);
  lines.push('');

  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
