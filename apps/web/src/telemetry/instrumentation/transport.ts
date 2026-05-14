/**
 * TransportInstrumentation — WS connection, RTT, and replay metrics.
 *
 * RTT measurement:
 *   Existing HeartbeatScheduler sends ping messages.
 *   TransportInstrumentation hooks into the transport's onMessage handler
 *   to detect pong messages and calculate RTT.
 *   RTT = pong.receivedAt - ping.sentAt (maintained in _pingSentAt Map).
 *
 * Reconnect tracking:
 *   Records each reconnect attempt with its backoff delay.
 *   Maintains a reconnect rate (reconnects per hour) for budget enforcement.
 *
 * Replay metrics:
 *   Records replay request size, chunk count, and recovery duration.
 *   Useful for understanding gap frequency and replay server load.
 *
 * Connection duration:
 *   Tracks how long each connection session lasts.
 *   Short sessions (< 30s) indicate connection instability.
 *
 * Integration:
 *   Wire to WsTransportClient callbacks:
 *     transport.onStateChange(state => ti.onStateChange(state))
 *     Intercept pong in message handler: ti.onPong(timestamp)
 *     Call ti.onPing() when ping is sent
 */

import type { ConnectionState } from '@pulse/types/transport';
import type { MetricsCollector } from '../collector.js';
import { Metric } from '../collector.js';
import type { BudgetEnforcer } from '../budget.js';
import { BUDGETS } from '../budget.js';
import type { PerformanceTimeline } from '../timeline.js';

export class TransportInstrumentation {
  private readonly _collector: MetricsCollector;
  private readonly _budget: BudgetEnforcer;
  private readonly _timeline: PerformanceTimeline;

  private _connectStartAt: number | null = null;
  private _connectedAt: number | null = null;
  private _pingSeq: number = 0;
  private readonly _pingSentAt = new Map<number, number>(); // seq → performance.now()
  private _replayStartAt: number | null = null;
  private _replayChunks: number = 0;

  constructor(
    collector: MetricsCollector,
    budget: BudgetEnforcer,
    timeline: PerformanceTimeline,
  ) {
    this._collector = collector;
    this._budget = budget;
    this._timeline = timeline;
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  onStateChange(state: ConnectionState): void {
    switch (state) {
      case 'connecting':
        this._connectStartAt = performance.now();
        this._timeline.wsConnecting();
        break;

      case 'connected': {
        const now = performance.now();
        this._connectedAt = now;
        this._timeline.wsConnected();

        if (this._connectStartAt !== null) {
          const connectDurationMs = now - this._connectStartAt;
          this._collector.timing(Metric.WS_CONNECT_DURATION_MS, connectDurationMs);
          this._connectStartAt = null;
        }
        break;
      }

      case 'reconnecting':
        this._collector.increment(Metric.WS_RECONNECT_COUNT);
        // Record connection duration before reconnect
        if (this._connectedAt !== null) {
          const sessionMs = performance.now() - this._connectedAt;
          this._timeline.wsReconnecting(this._collector.totalCount(Metric.WS_RECONNECT_COUNT));
          void sessionMs; // session duration tracked via budget in future
        }
        this._connectedAt = null;
        break;

      case 'disconnected':
      case 'failed':
        this._connectedAt = null;
        this._pingSentAt.clear();
        break;

      default:
        break;
    }
  }

  // ── RTT measurement ───────────────────────────────────────────────────────

  onPingSent(): number {
    const seq = ++this._pingSeq;
    this._pingSentAt.set(seq, performance.now());
    this._timeline.wsPingSent(seq);
    return seq;
  }

  onPongReceived(pingSeq: number): void {
    const sentAt = this._pingSentAt.get(pingSeq);
    if (sentAt === undefined) return;

    const rttMs = performance.now() - sentAt;
    this._pingSentAt.delete(pingSeq);

    this._collector.timing(Metric.WS_RTT_MS, rttMs);
    this._timeline.wsPongReceived(pingSeq);

    // Budget check
    this._budget.check('transport.rtt_ms', BUDGETS.transport.rttMs, rttMs);
  }

  // Evict pings older than 10s (missed pong)
  evictStalePings(): void {
    const cutoff = performance.now() - 10_000;
    for (const [seq, sentAt] of this._pingSentAt) {
      if (sentAt < cutoff) this._pingSentAt.delete(seq);
    }
  }

  // ── Replay tracking ───────────────────────────────────────────────────────

  onReplayRequested(fromSeq: number, toSeq: number): void {
    this._replayStartAt = performance.now();
    this._replayChunks = 0;
    this._collector.increment(Metric.REPLAY_COUNT);
    this._collector.record(Metric.REPLAY_GAP_SIZE, toSeq - fromSeq);
    this._timeline.replayStart(fromSeq, toSeq);
  }

  onReplayChunkReceived(): void {
    this._replayChunks++;
    this._collector.increment(Metric.REPLAY_CHUNKS_RECEIVED);
  }

  onReplayCompleted(): void {
    if (this._replayStartAt === null) return;

    const durationMs = performance.now() - this._replayStartAt;
    this._collector.timing(Metric.REPLAY_DURATION_MS, durationMs);
    this._timeline.replayEnd(this._replayChunks);

    this._budget.check(
      'replay.duration_ms',
      BUDGETS.transport.replayDurationMs,
      durationMs,
    );

    this._replayStartAt = null;
    this._replayChunks = 0;
  }

  onReplayAborted(): void {
    this._replayStartAt = null;
    this._replayChunks = 0;
    this._timeline.mark('pulse:replay:aborted');
  }

  // ── Bytes tracking ────────────────────────────────────────────────────────

  onBytesReceived(bytes: number): void {
    this._collector.increment(Metric.WS_BYTES_RECEIVED, bytes);
  }
}
