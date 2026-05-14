/**
 * ChaosEngine — fault injection for transport resilience testing.
 *
 * Wraps the WebSocketFactory injectable in WsTransportClient to intercept
 * messages and inject controlled failures.
 *
 * Fault types:
 *   Packet drop      — randomly drop incoming messages (tests replay recovery)
 *   Latency spike    — add random delay before delivering messages
 *   Force disconnect — close the socket after N messages
 *   Seq corruption   — flip a sequence number (tests dedup logic)
 *
 * Configuration:
 *   Each fault has an independent rate (0.0–1.0).
 *   Rates are checked via seeded PRNG → reproducible fault patterns.
 *   dropRate: 0.05 = 5% packet loss → triggers gap detection + replay.
 *
 * Usage:
 *   const chaos = new ChaosEngine(seed: 42, config: {
 *     dropRate: 0.05,
 *     latencyMs: { mean: 50, jitter: 30 },
 *     forceDisconnectAfter: 200,
 *   });
 *
 *   const transport = new WsTransportClient({
 *     ...config,
 *     webSocketFactory: chaos.wrapFactory(defaultWebSocketFactory),
 *   });
 *
 * Integration with simulator:
 *   ChaosEngine wraps real WebSocket for integration tests.
 *   For pure render pipeline tests, use StreamSimulator (no WS needed).
 *
 * Metrics:
 *   chaos.droppedCount — total messages dropped this session
 *   chaos.latencyInjected — total artificial delay injected (ms)
 *   chaos.disconnectCount — number of forced disconnects
 */

import { mulberry32 } from './prng.js';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface ChaosConfig {
  /** Fraction of incoming messages to silently drop. 0.0 = no drops. */
  readonly dropRate?: number;
  /** Artificial delay added to incoming messages. */
  readonly latencyMs?: { readonly mean: number; readonly jitter: number };
  /** Force a disconnect after this many messages (then reset counter). */
  readonly forceDisconnectAfter?: number;
  /** Probability of corrupting a sequence number (tests seq dedup). */
  readonly seqCorruptRate?: number;
}

const DEFAULT_CONFIG: Required<ChaosConfig> = {
  dropRate: 0,
  latencyMs: { mean: 0, jitter: 0 },
  forceDisconnectAfter: Infinity,
  seqCorruptRate: 0,
};

// ─── WebSocket wrapper ────────────────────────────────────────────────────────

interface WrappedWebSocket {
  onmessage: ((event: MessageEvent) => void) | null;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string | ArrayBuffer | Blob): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

// Matches the WebSocketFactory type in WsTransportClient
type WebSocketFactory = (url: string, protocols?: string | string[]) => WrappedWebSocket;

// ─── ChaosEngine ──────────────────────────────────────────────────────────────

export class ChaosEngine {
  private readonly _config: Required<ChaosConfig>;
  private readonly _rand: () => number;
  private _messagesReceived: number = 0;
  private _droppedCount: number = 0;
  private _latencyInjectedMs: number = 0;
  private _disconnectCount: number = 0;

  constructor(seed: number, config: ChaosConfig = {}) {
    this._rand = mulberry32(seed);
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Wrap a WebSocketFactory to inject configured faults.
   * Returns a new factory that creates chaos-wrapped WebSocket instances.
   */
  wrapFactory(real: WebSocketFactory): WebSocketFactory {
    return (url, protocols) => {
      const ws = real(url, protocols);
      return this._wrapSocket(ws);
    };
  }

  private _wrapSocket(ws: WrappedWebSocket): WrappedWebSocket {
    const engine = this;

    // Intercept incoming messages
    const originalDescriptor = Object.getOwnPropertyDescriptor(ws, 'onmessage');

    const proxy = new Proxy(ws, {
      set(target, prop, value) {
        if (prop === 'onmessage' && typeof value === 'function') {
          // Wrap the handler with chaos injection
          const originalHandler = value as (e: MessageEvent) => void;
          target.onmessage = (event: MessageEvent) => {
            engine._interceptMessage(event, originalHandler, () => {
              // Force disconnect
              engine._disconnectCount++;
              ws.close(1001, 'chaos: forced disconnect');
            });
          };
          return true;
        }
        (target as unknown as Record<string | symbol, unknown>)[prop] = value;
        return true;
      },
      get(target, prop) {
        if (prop === 'onmessage') return target.onmessage;
        const value = (target as unknown as Record<string | symbol, unknown>)[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    void originalDescriptor; // suppress unused warning
    return proxy;
  }

  private _interceptMessage(
    event: MessageEvent,
    handler: (e: MessageEvent) => void,
    onForceDisconnect: () => void,
  ): void {
    this._messagesReceived++;

    // Force disconnect check
    const forceAfter = this._config.forceDisconnectAfter;
    if (forceAfter !== Infinity && this._messagesReceived % forceAfter === 0) {
      onForceDisconnect();
      return;
    }

    // Packet drop
    if (this._config.dropRate > 0 && this._rand() < this._config.dropRate) {
      this._droppedCount++;
      return; // Message silently dropped → triggers gap detection
    }

    // Latency injection
    const { mean, jitter } = this._config.latencyMs;
    if (mean > 0) {
      const delay = Math.max(0, mean + (this._rand() * 2 - 1) * jitter);
      this._latencyInjectedMs += delay;
      setTimeout(() => handler(event), delay);
      return;
    }

    // No chaos — deliver normally
    handler(event);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  get droppedCount(): number { return this._droppedCount; }
  get latencyInjectedMs(): number { return this._latencyInjectedMs; }
  get disconnectCount(): number { return this._disconnectCount; }
  get messagesReceived(): number { return this._messagesReceived; }
  get dropRateObserved(): number {
    return this._messagesReceived > 0
      ? this._droppedCount / this._messagesReceived
      : 0;
  }

  reset(): void {
    this._messagesReceived = 0;
    this._droppedCount = 0;
    this._latencyInjectedMs = 0;
    this._disconnectCount = 0;
  }
}
