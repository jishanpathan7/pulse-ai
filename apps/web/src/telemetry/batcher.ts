/**
 * MetricsBatcher — periodic aggregation bridge between collector and sinks.
 *
 * Runs a setInterval at `intervalMs` (default 1000ms).
 * On each tick: snapshot the collector → fan out to all sinks → reset window.
 *
 * Why interval-based and not event-driven:
 *   Event-driven (emit on every record()) → sinks called 60× /s → defeat purpose.
 *   Interval-based → sinks called 1× /s → debug overlay re-renders at 1Hz.
 *
 * Flush modes:
 *   auto   — setInterval fires every intervalMs
 *   manual — no timer; caller calls flush() explicitly (useful in tests)
 *
 * Sink fan-out:
 *   All registered sinks receive the same snapshot.
 *   Sink failures are caught and logged — one bad sink doesn't block others.
 *
 * Lifecycle:
 *   start()  — begin interval (idempotent)
 *   stop()   — clear interval (does NOT flush)
 *   flush()  — immediate snapshot + fan-out (can be called any time)
 *   destroy() — stop + remove all sinks
 */

import type { MetricsCollector, MetricsSnapshot } from './collector.js';
import type { MetricsSink } from './sinks.js';

export interface BatcherConfig {
  readonly intervalMs: number;
  readonly mode: 'auto' | 'manual';
}

const DEFAULT_CONFIG: BatcherConfig = {
  intervalMs: 1000,
  mode: 'auto',
};

export class MetricsBatcher {
  private readonly _collector: MetricsCollector;
  private readonly _sinks: MetricsSink[] = [];
  private readonly _config: BatcherConfig;
  private _timerId: ReturnType<typeof setInterval> | null = null;
  private _flushCount: number = 0;
  private _lastFlushAt: number = 0;

  constructor(collector: MetricsCollector, config: Partial<BatcherConfig> = {}) {
    this._collector = collector;
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  addSink(sink: MetricsSink): this {
    this._sinks.push(sink);
    return this;
  }

  removeSink(name: string): this {
    const idx = this._sinks.findIndex((s) => s.name === name);
    if (idx !== -1) this._sinks.splice(idx, 1);
    return this;
  }

  start(): void {
    if (this._config.mode !== 'auto') return;
    if (this._timerId !== null) return; // idempotent

    this._timerId = setInterval(() => this.flush(), this._config.intervalMs);
  }

  stop(): void {
    if (this._timerId !== null) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
  }

  flush(): MetricsSnapshot {
    const snapshot = this._collector.snapshot();
    this._collector.resetWindow();
    this._lastFlushAt = Date.now();
    this._flushCount++;

    for (const sink of this._sinks) {
      try {
        sink.receive(snapshot);
      } catch (err) {
        console.error(`[MetricsBatcher] Sink "${sink.name}" threw:`, err);
      }
    }

    return snapshot;
  }

  destroy(): void {
    this.stop();
    this._sinks.length = 0;
    this._collector.resetAll();
  }

  get flushCount(): number { return this._flushCount; }
  get lastFlushAt(): number { return this._lastFlushAt; }
  get isRunning(): boolean { return this._timerId !== null; }
}
