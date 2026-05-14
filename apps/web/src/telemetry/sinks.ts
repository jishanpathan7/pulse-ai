/**
 * MetricsSink — destination interfaces for aggregated metrics snapshots.
 *
 * Sink contract:
 *   - Receives one MetricsSnapshot per batcher flush (~1s intervals)
 *   - Must be synchronous and non-blocking
 *   - Failures must not propagate (swallow, log, move on)
 *
 * Sinks:
 *   ConsoleSink  — dev-only structured console output
 *   StoreSink    — writes to telemetryStore (powers debug overlay)
 *   RemoteSink   — OTEL export stub (Phase 8)
 *   NullSink     — production no-op, zero cost
 */

import type { MetricsSnapshot, MetricAggregation } from './collector.js';
import { useTelemetryStore } from '../store/telemetry-store.js';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface MetricsSink {
  readonly name: string;
  receive(snapshot: MetricsSnapshot): void;
}

// ─── ConsoleSink ──────────────────────────────────────────────────────────────

const CONSOLE_METRICS = [
  'render.frame_time_ms',
  'render.frame_dropped',
  'stream.first_token_latency_ms',
  'stream.tokens_per_second',
  'transport.ws_rtt_ms',
  'scheduler.queue_depth_tokens',
];

export class ConsoleSink implements MetricsSink {
  readonly name = 'console';
  private _minCount: number;

  constructor(options: { minCountToLog?: number } = {}) {
    this._minCount = options.minCountToLog ?? 1;
  }

  receive(snapshot: MetricsSnapshot): void {
    if (snapshot.metrics.length === 0) return;

    const relevant = snapshot.metrics.filter(
      (m) => CONSOLE_METRICS.includes(m.name) && m.count >= this._minCount,
    );
    if (relevant.length === 0) return;

    const rows: Record<string, string> = {};
    for (const m of relevant) {
      const shortName = m.name.split('.').slice(1).join('.');
      rows[shortName] = this._format(m);
    }

    console.groupCollapsed(
      `[Pulse Metrics] ${new Date(snapshot.capturedAt).toISOString().slice(11, 23)} — ${snapshot.windowMs.toFixed(0)}ms window`,
    );
    console.table(rows);
    console.groupEnd();
  }

  private _format(m: MetricAggregation): string {
    if (m.name.includes('dropped') || m.name.includes('count') || m.name.includes('violations')) {
      return `${m.count}`;
    }
    if (m.name.endsWith('_ms')) {
      return `avg=${m.avg.toFixed(1)}ms p95=${m.p95.toFixed(1)}ms`;
    }
    return `avg=${m.avg.toFixed(2)} p95=${m.p95.toFixed(2)}`;
  }
}

// ─── StoreSink ────────────────────────────────────────────────────────────────

/**
 * Writes aggregated snapshots to telemetryStore.
 * The debug overlay reads from telemetryStore — this is the only connection
 * between the hot-path collector and React rendering.
 *
 * telemetryStore.updateAggregatedMetrics() is called at batcher frequency
 * (~1Hz), NOT at metric recording frequency (60Hz). This is the key
 * re-render isolation guarantee.
 */
export class StoreSink implements MetricsSink {
  readonly name = 'store';

  receive(snapshot: MetricsSnapshot): void {
    useTelemetryStore.getState().updateAggregatedMetrics(snapshot);
  }
}

// ─── RemoteSink ───────────────────────────────────────────────────────────────

/**
 * OTEL export stub — Phase 8.
 *
 * In Phase 8: converts MetricsSnapshot → OTEL MetricDataPoints
 * and ships to a collector endpoint via OTLP/HTTP.
 *
 * For now: no-op with sampling gate.
 */
export class RemoteSink implements MetricsSink {
  readonly name = 'remote';
  private readonly _endpoint: string;
  private readonly _sampleRate: number;

  constructor(options: { endpoint: string; sampleRate?: number }) {
    this._endpoint = options.endpoint;
    this._sampleRate = options.sampleRate ?? 0.1; // 10% default in prod
  }

  receive(_snapshot: MetricsSnapshot): void {
    if (Math.random() > this._sampleRate) return;
    // Phase 8: fetch(this._endpoint, { method: 'POST', body: serialize(snapshot) })
    void this._endpoint; // suppress unused warning until Phase 8
  }
}

// ─── NullSink ────────────────────────────────────────────────────────────────

/** Zero-cost sink for production when observability is disabled. */
export class NullSink implements MetricsSink {
  readonly name = 'null';
  receive(_snapshot: MetricsSnapshot): void { /* intentional no-op */ }
}
