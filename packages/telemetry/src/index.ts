/**
 * Telemetry primitives.
 *
 * Consumers emit typed events via emit(). The SDK implementation
 * (OTEL exporter, buffering, sampling) is registered at app startup
 * and never imported directly by feature code.
 *
 * Implementation populated in Phase 8 (Telemetry).
 */

import type { TelemetryEventUnion } from '@pulse/types/telemetry';

export interface TelemetrySink {
  emit(event: TelemetryEventUnion): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface SpanOptions {
  readonly name: string;
  readonly attributes?: Record<string, string | number | boolean>;
}

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: 'ok' | 'error', message?: string): void;
  end(): void;
}

export interface Tracer {
  startSpan(options: SpanOptions): Span;
  withSpan<T>(options: SpanOptions, fn: (span: Span) => T): T;
}

export interface Meter {
  counter(name: string, description?: string): Counter;
  histogram(name: string, description?: string): Histogram;
  gauge(name: string, description?: string): Gauge;
}

export interface Counter {
  add(value: number, attributes?: Record<string, string>): void;
}

export interface Histogram {
  record(value: number, attributes?: Record<string, string>): void;
}

export interface Gauge {
  record(value: number, attributes?: Record<string, string>): void;
}

// Global singletons registered at app startup — never instantiated by feature code
export declare function getTracer(name: string): Tracer;
export declare function getMeter(name: string): Meter;
export declare function getSink(): TelemetrySink;
