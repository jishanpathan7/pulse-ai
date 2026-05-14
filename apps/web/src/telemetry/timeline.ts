/**
 * PerformanceTimeline — Performance User Timing API wrapper.
 *
 * Marks and measures appear in Chrome DevTools → Performance tab → Timings lane.
 * This gives free profiler integration: record a mark, view it in the flamechart.
 *
 * Overhead:
 *   performance.mark()    ≈ 100ns (negligible)
 *   performance.measure() ≈ 1µs   (cheap)
 *   Both are no-ops in environments without Performance API.
 *
 * Mark naming convention:
 *   pulse:<domain>:<event>[:<id>]
 *   e.g., pulse:raf:start:42, pulse:stream:first_token:abc123
 *
 * Measure naming convention:
 *   pulse:<domain>:<what>
 *   e.g., pulse:raf:flush_duration, pulse:stream:ttft
 *
 * Production:
 *   disable() makes all calls no-ops. Call in production builds.
 *   Marks are ephemeral: they don't accumulate memory (browser auto-evicts).
 *
 * Chrome DevTools integration:
 *   1. Open DevTools → Performance tab
 *   2. Start recording
 *   3. Do something in Pulse AI (start a stream, scroll)
 *   4. Stop recording
 *   5. Look for "pulse:*" marks in the Timings lane
 *
 * Programmatic access:
 *   performance.getEntriesByName('pulse:raf:flush_duration') → PerformanceEntryList
 *   performance.getEntriesByType('measure') → all measures
 */

const HAS_PERF_API =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as Record<string, unknown>)['performance'] !== 'undefined' &&
  typeof performance.mark === 'function';

export class PerformanceTimeline {
  private _enabled: boolean;

  constructor(enabled: boolean = HAS_PERF_API) {
    this._enabled = enabled;
  }

  enable(): void { this._enabled = true && HAS_PERF_API; }
  disable(): void { this._enabled = false; }
  get isEnabled(): boolean { return this._enabled; }

  // ── Core ──────────────────────────────────────────────────────────────────

  mark(name: string, detail?: Record<string, unknown>): void {
    if (!this._enabled) return;
    try {
      performance.mark(name, detail !== undefined ? { detail } : undefined);
    } catch { /* ignore */ }
  }

  measure(name: string, startMark: string, endMark?: string): number {
    if (!this._enabled) return 0;
    try {
      const m = performance.measure(name, startMark, endMark);
      return m.duration;
    } catch {
      return 0;
    }
  }

  clearMarks(prefix?: string): void {
    if (!this._enabled) return;
    if (prefix !== undefined) {
      performance.getEntriesByType('mark')
        .filter((e) => e.name.startsWith(prefix))
        .forEach((e) => performance.clearMarks(e.name));
    } else {
      performance.clearMarks();
    }
  }

  clearMeasures(prefix?: string): void {
    if (!this._enabled) return;
    if (prefix !== undefined) {
      performance.getEntriesByType('measure')
        .filter((e) => e.name.startsWith(prefix))
        .forEach((e) => performance.clearMeasures(e.name));
    } else {
      performance.clearMeasures();
    }
  }

  // ── Domain-specific marks ─────────────────────────────────────────────────
  // Pre-built methods prevent string interpolation at call sites (saves allocs).

  rafFlushStart(frameIndex: number): void {
    this.mark(`pulse:raf:start:${frameIndex}`);
  }

  rafFlushEnd(frameIndex: number, tokens: number): void {
    const end = `pulse:raf:end:${frameIndex}`;
    this.mark(end, { tokens });
    this.measure('pulse:raf:flush_duration', `pulse:raf:start:${frameIndex}`, end);
  }

  streamStart(streamId: string): void {
    this.mark(`pulse:stream:start:${streamId}`);
  }

  streamFirstToken(streamId: string): void {
    const end = `pulse:stream:first_token:${streamId}`;
    this.mark(end);
    // Measure TTFT from stream_start to first token
    try {
      this.measure(`pulse:stream:ttft`, `pulse:stream:start:${streamId}`, end);
    } catch { /* start mark may not exist on replay */ }
  }

  streamEnd(streamId: string, tokenCount: number): void {
    const end = `pulse:stream:end:${streamId}`;
    this.mark(end, { tokenCount });
    try {
      this.measure(`pulse:stream:duration`, `pulse:stream:start:${streamId}`, end);
    } catch { /* ignore */ }
  }

  wsConnecting(): void {
    this.mark('pulse:ws:connecting');
  }

  wsConnected(): void {
    this.mark('pulse:ws:connected');
    try {
      this.measure('pulse:ws:connect_duration', 'pulse:ws:connecting', 'pulse:ws:connected');
    } catch { /* ignore */ }
  }

  wsReconnecting(attempt: number): void {
    this.mark(`pulse:ws:reconnecting:${attempt}`);
  }

  wsPingSent(seq: number): void {
    this.mark(`pulse:ws:ping:${seq}`);
  }

  wsPongReceived(seq: number): number {
    const end = `pulse:ws:pong:${seq}`;
    this.mark(end);
    return this.measure('pulse:ws:rtt', `pulse:ws:ping:${seq}`, end);
  }

  replayStart(fromSeq: number, toSeq: number): void {
    this.mark(`pulse:replay:start`, { fromSeq, toSeq });
  }

  replayEnd(chunksReceived: number): void {
    const end = 'pulse:replay:end';
    this.mark(end, { chunksReceived });
    try {
      this.measure('pulse:replay:duration', 'pulse:replay:start', end);
    } catch { /* ignore */ }
  }

  // ── Query helpers ─────────────────────────────────────────────────────────

  /** Get all pulse:* measure entries. Useful for test assertions. */
  getAllMeasures(): PerformanceEntryList {
    if (!HAS_PERF_API) return [];
    return performance.getEntriesByType('measure').filter((e) =>
      e.name.startsWith('pulse:'),
    );
  }

  getLastMeasure(name: string): number {
    if (!HAS_PERF_API) return 0;
    const entries = performance.getEntriesByName(name, 'measure');
    return entries[entries.length - 1]?.duration ?? 0;
  }
}
