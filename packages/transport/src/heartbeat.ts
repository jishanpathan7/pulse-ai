/**
 * HeartbeatScheduler — ping/pong keepalive with dead-connection detection.
 *
 * Sends a ping every intervalMs. If maxMissedPongs consecutive pongs
 * are not received, fires onTimeout (caller should close the socket).
 *
 * Latency tracking:
 *   RTT = pong.serverTimestamp - ping.clientTimestamp (one-way approximation)
 *   Accurate only when client/server clocks are in sync — use for trend
 *   monitoring, not absolute measurement.
 *
 * Invariants:
 *   - Only one active interval at a time; start() is idempotent
 *   - stop() is safe to call when not started
 *   - onPong() is a no-op if no ping is pending (e.g., unsolicited pong)
 */

import type { ClientPingMessage, ServerPongMessage } from '@pulse/types/transport';

export interface HeartbeatConfig {
  readonly intervalMs: number;
  readonly maxMissedPongs: number;
}

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  intervalMs: 30_000,
  maxMissedPongs: 2,
};

export interface LatencyMeasurement {
  readonly rttMs: number;
  readonly measuredAt: number;
}

export type SendFn = (message: ClientPingMessage) => void;
export type TimeoutFn = () => void;

export class HeartbeatScheduler {
  private readonly config: HeartbeatConfig;
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _pendingPingSentAt: number | null = null;
  private _missedPongs: number = 0;
  private _lastLatencyMs: number | null = null;
  private _onSend: SendFn | null = null;
  private _onTimeout: TimeoutFn | null = null;

  constructor(config: HeartbeatConfig = DEFAULT_HEARTBEAT_CONFIG) {
    this.config = config;
  }

  get isActive(): boolean {
    return this._intervalId !== null;
  }

  get lastLatencyMs(): number | null {
    return this._lastLatencyMs;
  }

  get missedPongs(): number {
    return this._missedPongs;
  }

  start(onSend: SendFn, onTimeout: TimeoutFn): void {
    if (this._intervalId !== null) return; // Idempotent

    this._onSend = onSend;
    this._onTimeout = onTimeout;
    this._missedPongs = 0;
    this._pendingPingSentAt = null;

    this._intervalId = setInterval(() => {
      this._tick();
    }, this.config.intervalMs);
  }

  private _tick(): void {
    if (this._pendingPingSentAt !== null) {
      // Previous ping was not answered
      this._missedPongs++;
      if (this._missedPongs >= this.config.maxMissedPongs) {
        this.stop();
        this._onTimeout?.();
        return;
      }
    }

    const clientTimestamp = Date.now();
    this._pendingPingSentAt = clientTimestamp;
    this._onSend?.({ type: 'ping', clientTimestamp });
  }

  onPong(message: ServerPongMessage): LatencyMeasurement | null {
    if (this._pendingPingSentAt === null) return null;

    const rttMs = message.serverTimestamp - this._pendingPingSentAt;
    this._lastLatencyMs = rttMs;
    this._pendingPingSentAt = null;
    this._missedPongs = 0;

    const measurement: LatencyMeasurement = { rttMs, measuredAt: Date.now() };
    return measurement;
  }

  stop(): void {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._pendingPingSentAt = null;
    this._missedPongs = 0;
    this._onSend = null;
    this._onTimeout = null;
  }

  reset(): void {
    this.stop();
    this._lastLatencyMs = null;
  }
}
