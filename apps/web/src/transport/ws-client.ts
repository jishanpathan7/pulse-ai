/**
 * WsTransportClient — concrete browser WebSocket implementation of TransportClient.
 *
 * Wires together all transport subsystem components:
 *   TransportStateMachine  → owns connection state
 *   SequenceTracker        → classifies incoming seq numbers
 *   SequenceBuffer         → holds out-of-order messages
 *   ReplayCoordinator      → at-most-one-replay-in-flight
 *   ExponentialBackoff     → reconnect timing
 *   HeartbeatScheduler     → dead-connection detection
 *   StreamRegistry         → stream lifecycle tracking
 *   Codec                  → encode/decode transport frames
 *
 * Message delivery guarantee (post-handshake):
 *   Every ServerMessage handler receives messages in sequence order,
 *   without gaps, without duplicates, whether original or replayed.
 *
 * Threading model:
 *   All WebSocket callbacks are on the main thread.
 *   No worker, no shared state, no concurrent mutation.
 *   This class is NOT thread-safe (not required in browser context).
 *
 * Testability:
 *   Pass wsFactory to inject a mock WebSocket implementation.
 */

import type {
  ClientMessage,
  ServerMessage,
  SequencedServerMessage,
  ConnectionState,
  ConnectionMetrics,
  StreamState,
  StreamId,
  SequenceNumber,
} from '@pulse/types/transport';
import { PROTOCOL_VERSION, CONTROL_SEQ } from '@pulse/types/transport';
import type { PulseError } from '@pulse/types/errors';
import { TransportErrorCode } from '@pulse/types/errors';
import type { Result } from '@pulse/utils';
import { ok, err } from '@pulse/utils';
import { assertNever } from '@pulse/utils';

import type {
  TransportClient,
  TransportConfig,
  MessageHandler,
  StateChangeHandler,
  ErrorHandler,
  UnsubscribeFn,
} from '@pulse/transport';
import {
  TransportStateMachine,
  SequenceTracker,
  SequenceBuffer,
  ReplayCoordinator,
  ExponentialBackoff,
  HeartbeatScheduler,
  StreamRegistry,
  encode,
  decode,
  DEFAULT_BACKOFF_CONFIG,
} from '@pulse/transport';
import type { StreamChangeHandler } from '@pulse/transport';
import { toSeq } from '@pulse/transport';

// ─── WebSocket Factory ────────────────────────────────────────────────────────

export type WebSocketFactory = (url: string) => WebSocket;

const defaultWsFactory: WebSocketFactory = (url) => new WebSocket(url);

// ─── WsTransportClient ────────────────────────────────────────────────────────

export class WsTransportClient implements TransportClient {
  private readonly _config: TransportConfig;
  private readonly _wsFactory: WebSocketFactory;

  // Subsystem components
  private readonly _machine: TransportStateMachine;
  private readonly _seqTracker: SequenceTracker;
  private readonly _seqBuffer: SequenceBuffer<SequencedServerMessage>;
  private readonly _replayCoordinator: ReplayCoordinator;
  private readonly _backoff: ExponentialBackoff;
  private readonly _heartbeat: HeartbeatScheduler;
  private readonly _streamRegistry: StreamRegistry;

  // Connection state
  private _socket: WebSocket | null = null;
  private _connectUrl: string = '';
  private _intentionalClose: boolean = false;
  private _metrics: Mutable<ConnectionMetrics>;

  // Pending connect() promise resolver
  private _connectResolve: ((result: Result<void, PulseError>) => void) | null = null;

  // Handshake timeout handle
  private _handshakeTimeout: ReturnType<typeof setTimeout> | null = null;

  // External event subscribers
  private readonly _messageHandlers = new Set<MessageHandler>();
  private readonly _stateHandlers = new Set<StateChangeHandler>();
  private readonly _errorHandlers = new Set<ErrorHandler>();

  constructor(config: TransportConfig, wsFactory: WebSocketFactory = defaultWsFactory) {
    this._config = config;
    this._wsFactory = wsFactory;

    this._machine = new TransportStateMachine();
    this._seqTracker = new SequenceTracker();
    this._seqBuffer = new SequenceBuffer<SequencedServerMessage>();
    this._replayCoordinator = new ReplayCoordinator((fromSeq, toSeq) => {
      this._onReplayComplete(fromSeq, toSeq);
    });
    this._backoff = new ExponentialBackoff(DEFAULT_BACKOFF_CONFIG);
    this._heartbeat = new HeartbeatScheduler({
      intervalMs: config.heartbeatIntervalMs,
      maxMissedPongs: config.maxMissedPongs,
    });
    this._streamRegistry = new StreamRegistry();

    this._metrics = {
      connectedAt: null,
      lastPingMs: null,
      reconnectCount: 0,
      messagesSent: 0,
      messagesReceived: 0,
      bytesReceived: 0,
      sessionId: null,
      lastDeliveredSeq: CONTROL_SEQ,
    };

    // Propagate state transitions to external handlers
    this._machine.onTransition((next) => {
      const externalState = next.status as ConnectionState;
      for (const handler of this._stateHandlers) {
        handler(externalState);
      }
    });
  }

  // ─── TransportClient Interface ───────────────────────────────────────────────

  get state(): ConnectionState {
    return this._machine.connectionState;
  }

  get metrics(): ConnectionMetrics {
    return { ...this._metrics } as ConnectionMetrics;
  }

  async connect(url: string): Promise<Result<void, PulseError>> {
    this._connectUrl = url;
    this._intentionalClose = false;

    if (
      this._machine.current.status !== 'idle' &&
      this._machine.current.status !== 'disconnected' &&
      this._machine.current.status !== 'failed'
    ) {
      return err({
        domain: 'TRANSPORT',
        code: TransportErrorCode.PROTOCOL_VIOLATION,
        message: `Cannot connect from state: ${this._machine.current.status}`,
        retryable: false,
      });
    }

    return new Promise<Result<void, PulseError>>((resolve) => {
      this._connectResolve = resolve;
      this._machine.transition({ type: 'CONNECT' });
      this._openSocket(0);
    });
  }

  disconnect(code: number = 1000, reason: string = 'client-initiated'): void {
    this._intentionalClose = true;
    this._heartbeat.stop();
    this._clearHandshakeTimeout();
    this._replayCoordinator.abort();
    this._streamRegistry.abortAll();

    if (this._socket !== null && this._socket.readyState === WebSocket.OPEN) {
      this._socket.close(code, reason);
    }

    this._machine.transition({ type: 'DISCONNECT' });
    this._connectResolve?.(
      err({
        domain: 'TRANSPORT',
        code: 'TRANSPORT_CONNECTION_REFUSED',
        message: 'Disconnected before connection was established',
        retryable: false,
      }),
    );
    this._connectResolve = null;
  }

  send(message: ClientMessage): Result<void, PulseError> {
    if (!this._machine.canSend()) {
      return err({
        domain: 'TRANSPORT',
        code: TransportErrorCode.PROTOCOL_VIOLATION,
        message: `Cannot send in state: ${this._machine.current.status}`,
        retryable: true,
      });
    }

    const socket = this._socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return err({
        domain: 'TRANSPORT',
        code: TransportErrorCode.PROTOCOL_VIOLATION,
        message: 'Socket is not open',
        retryable: true,
      });
    }

    const encoded = encode(message);

    if (encoded.length > this._config.maxPayloadBytes) {
      return err({
        domain: 'TRANSPORT',
        code: TransportErrorCode.MESSAGE_TOO_LARGE,
        message: `Message size ${encoded.length} exceeds limit ${this._config.maxPayloadBytes}`,
        retryable: false,
      });
    }

    socket.send(encoded);
    this._metrics.messagesSent++;
    return ok(undefined);
  }

  onMessage(handler: MessageHandler): UnsubscribeFn {
    this._messageHandlers.add(handler);
    return () => {
      this._messageHandlers.delete(handler);
    };
  }

  onStateChange(handler: StateChangeHandler): UnsubscribeFn {
    this._stateHandlers.add(handler);
    return () => {
      this._stateHandlers.delete(handler);
    };
  }

  onError(handler: ErrorHandler): UnsubscribeFn {
    this._errorHandlers.add(handler);
    return () => {
      this._errorHandlers.delete(handler);
    };
  }

  onStream(streamId: StreamId, handler: StreamChangeHandler): UnsubscribeFn {
    return this._streamRegistry.onStreamChange((state) => {
      if (state.streamId === streamId) handler(state);
    });
  }

  getStreams(): ReadonlyArray<StreamState> {
    return this._streamRegistry.allStreams;
  }

  // ─── Socket Lifecycle ────────────────────────────────────────────────────────

  private _openSocket(attempt: number): void {
    const socket = this._wsFactory(this._connectUrl);
    this._socket = socket;

    socket.onopen = () => {
      this._machine.transition({ type: 'SOCKET_OPEN' });
      this._sendHandshake();
      this._startHandshakeTimeout();
    };

    socket.onmessage = (ev: MessageEvent<string>) => {
      this._onRawMessage(ev.data);
    };

    socket.onclose = (ev: CloseEvent) => {
      this._onSocketClose(ev.code, ev.wasClean, attempt);
    };

    socket.onerror = () => {
      // onerror always precedes onclose — handle reconnect in onclose
      this._machine.transition({ type: 'SOCKET_ERROR' });
    };
  }

  private _sendHandshake(): void {
    const lastDeliveredSeq = this._seqTracker.lastDelivered;
    this.send({
      type: 'handshake',
      clientId: this._config.clientId,
      lastSeq: lastDeliveredSeq,
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  private _startHandshakeTimeout(): void {
    this._clearHandshakeTimeout();
    this._handshakeTimeout = setTimeout(() => {
      if (this._machine.current.status === 'handshaking') {
        this._machine.transition({ type: 'HANDSHAKE_TIMEOUT' });
        this._socket?.close(4000, 'handshake-timeout');
      }
    }, this._config.handshakeTimeoutMs);
  }

  private _clearHandshakeTimeout(): void {
    if (this._handshakeTimeout !== null) {
      clearTimeout(this._handshakeTimeout);
      this._handshakeTimeout = null;
    }
  }

  private _onSocketClose(code: number, wasClean: boolean, attempt: number): void {
    this._clearHandshakeTimeout();
    this._heartbeat.stop();

    const intentional = this._intentionalClose || wasClean;

    this._machine.transition({ type: 'SOCKET_CLOSE', intentional, code });

    if (!intentional) {
      this._scheduleReconnect(attempt + 1);
    }
  }

  private _scheduleReconnect(attempt: number): void {
    const maxAttempts = this._config.maxReconnectAttempts;

    if (attempt > maxAttempts) {
      this._machine.transition({ type: 'EXHAUSTED' });
      this._connectResolve?.(
        err({
          domain: 'TRANSPORT',
          code: TransportErrorCode.MAX_RECONNECTS_EXCEEDED,
          message: `Max reconnect attempts (${maxAttempts}) exceeded`,
          retryable: false,
        }),
      );
      this._connectResolve = null;
      return;
    }

    this._metrics.reconnectCount++;
    // ReplayCoordinator abort preserves lastSeq — gaps will re-request on next connect
    this._replayCoordinator.abort();
    this._seqBuffer.clear();

    const delayMs = this._backoff.nextDelayMs(attempt - 1);

    this._machine.transition({ type: 'RETRY' });

    setTimeout(() => {
      if (
        this._machine.current.status === 'connecting' &&
        !this._intentionalClose
      ) {
        this._openSocket(attempt);
      }
    }, delayMs);
  }

  // ─── Message Handling ────────────────────────────────────────────────────────

  private _onRawMessage(raw: string): void {
    this._metrics.messagesReceived++;
    this._metrics.bytesReceived += raw.length;

    const result = decode(raw);
    if (!result.ok) {
      this._emitError(result.error);
      return;
    }

    const message = result.value;
    this._dispatchMessage(message);
  }

  private _dispatchMessage(message: ServerMessage): void {
    switch (message.type) {
      // ── Control messages (bypass sequencing) ──
      case 'handshake_ack':
        this._onHandshakeAck(message);
        break;

      case 'pong':
        this._heartbeat.onPong(message);
        break;

      case 'replay_chunk':
        this._onReplayChunk(message);
        break;

      // ── Sequenced messages ──
      case 'stream_start':
      case 'token':
      case 'stream_end':
      case 'stream_error':
        this._onSequencedMessage(message);
        break;

      default:
        assertNever(message);
    }
  }

  private _onHandshakeAck(
    message: import('@pulse/types/transport').ServerHandshakeAckMessage,
  ): void {
    this._clearHandshakeTimeout();
    this._machine.transition({ type: 'HANDSHAKE_ACK', sessionId: message.sessionId });

    this._metrics.connectedAt = Date.now();
    this._metrics.sessionId = message.sessionId;

    // Start keepalive
    this._heartbeat.start(
      (ping) => {
        this.send(ping);
      },
      () => {
        // Heartbeat timeout — close and reconnect
        const currentAttempt =
          this._machine.current.status === 'connected'
            ? this._machine.current.attempt
            : 0;
        this._socket?.close(4001, 'heartbeat-timeout');
        this._scheduleReconnect(currentAttempt + 1);
      },
    );

    // Resolve connect() promise on first successful handshake only
    if (this._connectResolve !== null) {
      this._connectResolve(ok(undefined));
      this._connectResolve = null;
    }

    // Notify state subscribers (already done by machine transition listener)
    for (const handler of this._messageHandlers) {
      handler(message);
    }
  }

  private _onSequencedMessage(message: SequencedServerMessage): void {
    const classification = this._seqTracker.classify(message.seq);

    switch (classification.kind) {
      case 'in_order':
        this._seqTracker.markDelivered(message.seq);
        this._deliverSequencedMessage(message);
        this._drainBuffer();
        break;

      case 'gap': {
        this._seqBuffer.push(message);
        const replayRequest = this._replayCoordinator.requestReplay(
          classification.expectedSeq,
          toSeq((message.seq as number) - 1),
        );
        if (replayRequest !== null) {
          this.send(replayRequest);
        }
        break;
      }

      case 'duplicate':
        // Already delivered — idempotent drop
        break;

      case 'control':
        // seq=0 on a sequenced message type is a protocol error
        this._emitError({
          domain: 'TRANSPORT',
          code: TransportErrorCode.PROTOCOL_VIOLATION,
          message: `Sequenced message "${message.type}" has control seq=0`,
          retryable: false,
        });
        break;
    }
  }

  private _onReplayChunk(
    chunk: import('@pulse/types/transport').ServerReplayChunkMessage,
  ): void {
    this._replayCoordinator.onChunkReceived();

    // Inject replayed messages into sequence buffer
    for (const inner of chunk.messages) {
      const classification = this._seqTracker.classify(inner.seq);
      if (classification.kind === 'in_order' || classification.kind === 'gap') {
        this._seqBuffer.push(inner);
      }
      // duplicates (already delivered) are silently dropped
    }

    if (chunk.isLast) {
      this._replayCoordinator.complete();
      // Drain happens in the ReplayCoordinator.onComplete callback (_onReplayComplete)
    }
  }

  private _onReplayComplete(_fromSeq: SequenceNumber, _toSeq: SequenceNumber): void {
    this._drainBuffer();
  }

  private _drainBuffer(): void {
    const drained = this._seqBuffer.drainConsecutive(this._seqTracker.expectedSeq);
    for (const message of drained) {
      this._seqTracker.markDelivered(message.seq);
      this._deliverSequencedMessage(message);
    }
    // If more messages remain in buffer that are non-consecutive, they'll drain
    // after the next replay completes.
  }

  private _deliverSequencedMessage(message: SequencedServerMessage): void {
    this._metrics.lastDeliveredSeq = message.seq;

    // Update stream registry
    switch (message.type) {
      case 'stream_start':
        this._streamRegistry.onStreamStart(message);
        break;
      case 'token':
        this._streamRegistry.onToken(message);
        break;
      case 'stream_end':
        this._streamRegistry.onStreamEnd(message);
        break;
      case 'stream_error':
        this._streamRegistry.onStreamError(message);
        break;
    }

    // Deliver to external message handlers
    for (const handler of this._messageHandlers) {
      handler(message);
    }
  }

  // ─── Error Propagation ───────────────────────────────────────────────────────

  private _emitError(error: PulseError): void {
    for (const handler of this._errorHandlers) {
      handler(error);
    }
  }
}

// ─── Mutable Metrics Helper ──────────────────────────────────────────────────

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
