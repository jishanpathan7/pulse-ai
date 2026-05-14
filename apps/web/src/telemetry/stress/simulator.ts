/**
 * StreamSimulator — synthetic token stream generator.
 *
 * Injects synthetic ServerMessages directly into the RenderPipeline,
 * bypassing the real WebSocket. Enables:
 *   - Deterministic performance benchmarks (same seed = same load)
 *   - Isolated render pipeline testing (no backend needed)
 *   - Load scenarios with precise token rates
 *   - Multi-stream concurrency testing
 *
 * Architecture:
 *   StreamSimulator creates a synthetic TransportClient that:
 *     - Calls registered onMessage handlers with synthetic messages
 *     - Drives token delivery via setInterval at configured rate
 *     - Respects stream lifecycle (start → tokens → end)
 *
 * Usage:
 *   const sim = new StreamSimulator(scenarios.singleStreamNormal);
 *   const fakeTransport = sim.createTransport();
 *   renderPipeline.connect(fakeTransport);
 *   await sim.run();
 *   renderPipeline.disconnect();
 *
 * Determinism:
 *   Token content is seeded (same seed = same tokens).
 *   Timing is seeded (same seed = same inter-token delays).
 *   Message sequence numbers are assigned sequentially.
 *
 * Note: this runs in the browser main thread.
 * High token rates (>200 tps) will compete with render work — intentional.
 * Use this to find the saturation point of the render pipeline.
 */

import type {
  ServerMessage,
  StreamId,
  ConversationId,
  SessionId,
  SequenceNumber,
  ConnectionState,
  ConnectionMetrics,
  StreamState,
} from '@pulse/types/transport';
import type {
  TransportClient,
  MessageHandler,
  StateChangeHandler,
  ErrorHandler,
  UnsubscribeFn,
} from '@pulse/transport';
import type { StreamChangeHandler } from '@pulse/transport';
import type { ClientMessage } from '@pulse/types/transport';
import type { Result } from '@pulse/utils';
import type { PulseError } from '@pulse/types/errors';
import { ok } from '@pulse/utils';
import { mulberry32, pickToken, tokenDelay } from './prng.js';
import { CONTROL_SEQ, PROTOCOL_VERSION } from '@pulse/types/transport';

// ─── Scenario config ─────────────────────────────────────────────────────────

export interface SimulatorStreamConfig {
  readonly streamId: string;
  readonly conversationId: string;
  readonly tokenCount: number;
  readonly tokensPerSecond: number;  // target rate
  readonly seed: number;
  readonly startDelayMs?: number;    // delay before first token
}

export interface SimulatorConfig {
  readonly streams: ReadonlyArray<SimulatorStreamConfig>;
  readonly seed: number;
}

export interface SimulationResult {
  readonly durationMs: number;
  readonly totalTokensDelivered: number;
  readonly streamsCompleted: number;
  readonly avgIntervalMs: number;
}

// ─── Synthetic TransportClient ────────────────────────────────────────────────

class SyntheticTransport implements TransportClient {
  private readonly _messageHandlers: Set<MessageHandler> = new Set();
  private readonly _stateHandlers: Set<StateChangeHandler> = new Set();
  private readonly _errorHandlers: Set<ErrorHandler> = new Set();
  private _seq: number = 1;
  private _state: ConnectionState = 'idle';
  private readonly _streams: Map<string, StreamState> = new Map();

  // ── TransportClient interface ──────────────────────────────────────────────

  get state(): ConnectionState { return this._state; }

  get metrics(): ConnectionMetrics {
    return {
      connectedAt: Date.now(),
      lastPingMs: null,
      reconnectCount: 0,
      messagesSent: 0,
      messagesReceived: this._seq,
      bytesReceived: 0,
      sessionId: 'sim-session' as SessionId,
      lastDeliveredSeq: (this._seq - 1) as SequenceNumber,
    };
  }

  async connect(_url: string): Promise<Result<void, PulseError>> {
    this._state = 'connecting';
    this._dispatchState('connecting');

    // Synthetic handshake — handshake_ack is a control message (no seq)
    const ack: ServerMessage = {
      type: 'handshake_ack',
      sessionId: 'sim-session' as SessionId,
      serverTimestamp: Date.now(),
      protocolVersion: PROTOCOL_VERSION,
      resumedFromSeq: CONTROL_SEQ,
    };
    this._dispatchMessage(ack);

    this._state = 'connected';
    this._dispatchState('connected');
    return ok(undefined);
  }

  disconnect(_code?: number, _reason?: string): void {
    this._state = 'disconnected';
    this._dispatchState('disconnected');
  }

  send(_message: ClientMessage): Result<void, PulseError> {
    // Simulator ignores outbound messages
    return ok(undefined);
  }

  onMessage(handler: MessageHandler): UnsubscribeFn {
    this._messageHandlers.add(handler);
    return () => this._messageHandlers.delete(handler);
  }

  onStateChange(handler: StateChangeHandler): UnsubscribeFn {
    this._stateHandlers.add(handler);
    return () => this._stateHandlers.delete(handler);
  }

  onError(handler: ErrorHandler): UnsubscribeFn {
    this._errorHandlers.add(handler);
    return () => this._errorHandlers.delete(handler);
  }

  onStream(_streamId: StreamId, _handler: StreamChangeHandler): UnsubscribeFn {
    // Simulator tracks streams internally; no per-stream subscription needed
    return () => {};
  }

  getStreams(): ReadonlyArray<StreamState> {
    return Array.from(this._streams.values());
  }

  // ── Internal injection API (called by StreamSimulator) ────────────────────

  injectMessage(msg: ServerMessage): void {
    this._dispatchMessage(msg);
  }

  nextSeq(): SequenceNumber {
    return this._seq++ as SequenceNumber;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _dispatchMessage(msg: ServerMessage): void {
    for (const h of this._messageHandlers) h(msg);
  }

  private _dispatchState(state: ConnectionState): void {
    this._state = state;
    for (const h of this._stateHandlers) h(state);
  }
}

// ─── StreamSimulator ─────────────────────────────────────────────────────────

export class StreamSimulator {
  private readonly _config: SimulatorConfig;
  private _transport: SyntheticTransport | null = null;
  private _running: boolean = false;
  private _timers: ReturnType<typeof setTimeout>[] = [];

  constructor(config: SimulatorConfig) {
    this._config = config;
  }

  createTransport(): TransportClient {
    this._transport = new SyntheticTransport();
    return this._transport;
  }

  /**
   * Run the simulation and resolve when all streams have completed.
   * Must call createTransport() first.
   */
  run(): Promise<SimulationResult> {
    if (this._transport === null) throw new Error('Call createTransport() first');
    if (this._running) throw new Error('Simulation already running');

    this._running = true;
    const startAt = performance.now();
    let totalTokens = 0;
    let streamsCompleted = 0;

    const transport = this._transport;
    const rand = mulberry32(this._config.seed);

    return new Promise((resolve) => {
      const streamPromises = this._config.streams.map((stream) => {
        return new Promise<void>((streamDone) => {
          const streamRand = mulberry32(stream.seed);
          const intervalMs = 1000 / stream.tokensPerSecond;
          const startDelay = stream.startDelayMs ?? 0;
          let tokensSent = 0;

          const start = () => {
            // Inject stream_start
            transport.injectMessage({
              type: 'stream_start',
              seq: transport.nextSeq(),
              streamId: stream.streamId as StreamId,
              conversationId: stream.conversationId as ConversationId,
              timestamp: Date.now(),
            });

            // Inject tokens at rate
            const timerId = setInterval(() => {
              if (tokensSent >= stream.tokenCount) {
                clearInterval(timerId);

                // stream_end
                transport.injectMessage({
                  type: 'stream_end',
                  seq: transport.nextSeq(),
                  streamId: stream.streamId as StreamId,
                  totalTokens: tokensSent,
                  durationMs: tokensSent * intervalMs,
                  timestamp: Date.now(),
                });

                streamsCompleted++;
                streamDone();
                return;
              }

              const token = pickToken(streamRand);
              transport.injectMessage({
                type: 'token',
                seq: transport.nextSeq(),
                streamId: stream.streamId as StreamId,
                token,
                tokenIndex: tokensSent,
                timestamp: Date.now(),
              });
              tokensSent++;
              totalTokens++;

              // Use global seed for cross-stream jitter (suppress unused var)
              void rand;
            }, tokenDelay(streamRand, intervalMs, intervalMs * 0.3));

            this._timers.push(timerId as unknown as ReturnType<typeof setTimeout>);
          };

          if (startDelay > 0) {
            const t = setTimeout(start, startDelay);
            this._timers.push(t);
          } else {
            start();
          }
        });
      });

      void Promise.all(streamPromises).then(() => {
        const durationMs = performance.now() - startAt;
        this._running = false;
        resolve({
          durationMs,
          totalTokensDelivered: totalTokens,
          streamsCompleted,
          avgIntervalMs: streamsCompleted > 0 ? durationMs / streamsCompleted : 0,
        });
      });
    });
  }

  stop(): void {
    for (const t of this._timers) clearTimeout(t as unknown as ReturnType<typeof setTimeout>);
    this._timers.length = 0;
    this._running = false;
  }

  get isRunning(): boolean { return this._running; }
}
