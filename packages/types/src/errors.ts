/**
 * Structured error types for Pulse AI.
 *
 * All errors carry a machine-readable code for programmatic handling.
 * Do not use generic Error for cross-boundary errors.
 */

export type ErrorDomain =
  | 'TRANSPORT'
  | 'STREAM'
  | 'AUTH'
  | 'API'
  | 'DATABASE'
  | 'CACHE'
  | 'RENDER';

export interface PulseError {
  readonly domain: ErrorDomain;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly context?: Record<string, unknown>;
}

// ─── Transport Errors ─────────────────────────────────────────────────────────

export const TransportErrorCode = {
  CONNECTION_REFUSED: 'TRANSPORT_CONNECTION_REFUSED',
  HANDSHAKE_TIMEOUT: 'TRANSPORT_HANDSHAKE_TIMEOUT',
  SEQUENCE_GAP: 'TRANSPORT_SEQUENCE_GAP',
  REPLAY_FAILED: 'TRANSPORT_REPLAY_FAILED',
  MAX_RECONNECTS_EXCEEDED: 'TRANSPORT_MAX_RECONNECTS_EXCEEDED',
  MESSAGE_TOO_LARGE: 'TRANSPORT_MESSAGE_TOO_LARGE',
  PROTOCOL_VIOLATION: 'TRANSPORT_PROTOCOL_VIOLATION',
} as const;

export type TransportErrorCode = (typeof TransportErrorCode)[keyof typeof TransportErrorCode];

// ─── Stream Errors ────────────────────────────────────────────────────────────

export const StreamErrorCode = {
  PROVIDER_ERROR: 'STREAM_PROVIDER_ERROR',
  RATE_LIMITED: 'STREAM_RATE_LIMITED',
  CONTEXT_EXCEEDED: 'STREAM_CONTEXT_EXCEEDED',
  TIMEOUT: 'STREAM_TIMEOUT',
  ABORTED: 'STREAM_ABORTED',
} as const;

export type StreamErrorCode = (typeof StreamErrorCode)[keyof typeof StreamErrorCode];

// ─── API Errors ───────────────────────────────────────────────────────────────

export const ApiErrorCode = {
  VALIDATION_ERROR: 'API_VALIDATION_ERROR',
  NOT_FOUND: 'API_NOT_FOUND',
  UNAUTHORIZED: 'API_UNAUTHORIZED',
  FORBIDDEN: 'API_FORBIDDEN',
  RATE_LIMITED: 'API_RATE_LIMITED',
  INTERNAL: 'API_INTERNAL',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
