import type {
  ClientMessage,
  ServerMessage,
  ConnectionState,
  ConnectionMetrics,
  StreamState,
  StreamId,
  ClientId,
} from '@pulse/types/transport';
import type { Result } from '@pulse/utils';
import type { PulseError } from '@pulse/types/errors';
import type { StreamChangeHandler } from './stream-registry.js';

/**
 * TransportClient — the single interface consumers use for realtime communication.
 *
 * UI and state layer NEVER touch WebSocket directly.
 * All events are typed, sequenced, and replayed before reaching handlers.
 *
 * Lifecycle:
 *   1. Construct with config + clientId
 *   2. Register handlers (onMessage, onStateChange, onError, onStream)
 *   3. connect(url) — resolves when first handshake completes
 *   4. Receive messages via handlers
 *   5. Send via send()
 *   6. disconnect() — clean shutdown
 *
 * Reconnection is transparent: the client reconnects automatically after
 * unintentional disconnects, up to maxReconnectAttempts.
 */
export interface TransportClient {
  readonly state: ConnectionState;
  readonly metrics: ConnectionMetrics;

  /** Resolves on first successful handshake. Rejects never — uses Result. */
  connect(url: string): Promise<Result<void, PulseError>>;

  /** Clean shutdown. Does not trigger reconnection. */
  disconnect(code?: number, reason?: string): void;

  /**
   * Send a client message.
   * Returns Err if not connected or send buffer is full.
   */
  send(message: ClientMessage): Result<void, PulseError>;

  /**
   * Receive all server messages that have passed sequence validation.
   * Messages are delivered in order — no gaps, no duplicates.
   * Replay messages are transparent: caller cannot distinguish replayed
   * messages from original delivery.
   */
  onMessage(handler: MessageHandler): UnsubscribeFn;

  /** Fires whenever ConnectionState changes. */
  onStateChange(handler: StateChangeHandler): UnsubscribeFn;

  /** Fires on transport-level errors (parse failure, protocol violation, etc.). */
  onError(handler: ErrorHandler): UnsubscribeFn;

  /** Subscribe to stream lifecycle events for a specific stream. */
  onStream(streamId: StreamId, handler: StreamChangeHandler): UnsubscribeFn;

  /** Current state of all tracked streams. */
  getStreams(): ReadonlyArray<StreamState>;
}

export type MessageHandler = (message: ServerMessage) => void;
export type StateChangeHandler = (state: ConnectionState) => void;
export type ErrorHandler = (error: PulseError) => void;
export type UnsubscribeFn = () => void;

export interface TransportConfig {
  readonly clientId: ClientId;
  readonly maxReconnectAttempts: number;
  readonly heartbeatIntervalMs: number;
  readonly maxMissedPongs: number;
  readonly handshakeTimeoutMs: number;
  readonly maxPayloadBytes: number;
}

export const DEFAULT_TRANSPORT_CONFIG: Omit<TransportConfig, 'clientId'> = {
  maxReconnectAttempts: 10,
  heartbeatIntervalMs: 30_000,
  maxMissedPongs: 2,
  handshakeTimeoutMs: 10_000,
  maxPayloadBytes: 65_536,
};
