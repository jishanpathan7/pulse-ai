/**
 * WebSocket transport message contracts.
 *
 * Sequence model:
 *   - seq=0 reserved: control messages (handshake_ack)
 *   - seq≥1: data messages (stream_start, token, stream_end, stream_error)
 *   - Monotonically increasing per connection-session
 *   - Gaps trigger client-side replay request
 *   - Server is the sole sequence authority
 *
 * Message taxonomy:
 *   SequencedServerMessage  — participate in seq tracking
 *   ControlServerMessage    — delivered immediately, bypass seq tracking
 */

// ─── Branded ID Types ─────────────────────────────────────────────────────────

export type SequenceNumber = number & { readonly _brand: 'SequenceNumber' };
export type StreamId = string & { readonly _brand: 'StreamId' };
export type ClientId = string & { readonly _brand: 'ClientId' };
export type SessionId = string & { readonly _brand: 'SessionId' };
export type ConversationId = string & { readonly _brand: 'ConversationId' };

// ─── Sequence ─────────────────────────────────────────────────────────────────

export interface Sequenced {
  readonly seq: SequenceNumber;
  readonly timestamp: number;
}

export const CONTROL_SEQ = 0 as SequenceNumber;

// ─── Protocol Envelope ────────────────────────────────────────────────────────

export const PROTOCOL_VERSION = '1' as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

export interface Envelope<T> {
  readonly v: ProtocolVersion;
  readonly msg: T;
}

// ─── Client → Server ──────────────────────────────────────────────────────────

export interface ClientHandshakeMessage {
  readonly type: 'handshake';
  readonly clientId: ClientId;
  readonly lastSeq: SequenceNumber;
  readonly protocolVersion: ProtocolVersion;
}

export interface ClientPingMessage {
  readonly type: 'ping';
  readonly clientTimestamp: number;
}

export interface ClientReplayRequestMessage {
  readonly type: 'replay_request';
  readonly fromSeq: SequenceNumber;
  readonly toSeq: SequenceNumber;
}

export interface ClientAckMessage {
  readonly type: 'ack';
  readonly seq: SequenceNumber;
}

export interface ClientStreamRequestMessage {
  readonly type: 'stream_request';
  readonly streamId: StreamId;
  readonly conversationId: ConversationId;
  readonly messages: ReadonlyArray<{ readonly role: 'user' | 'assistant'; readonly content: string }>;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
  /** BYOK: ID of the user_api_keys row to use for this stream. Omit for platform key. */
  readonly keyId?: string;
}

export interface ClientStreamCancelMessage {
  readonly type: 'stream_cancel';
  readonly streamId: StreamId;
}

export type ClientMessage =
  | ClientHandshakeMessage
  | ClientPingMessage
  | ClientReplayRequestMessage
  | ClientAckMessage
  | ClientStreamRequestMessage
  | ClientStreamCancelMessage;

// ─── Server → Client: Control (no sequence tracking) ─────────────────────────

export interface ServerHandshakeAckMessage {
  readonly type: 'handshake_ack';
  readonly sessionId: SessionId;
  readonly serverTimestamp: number;
  readonly protocolVersion: ProtocolVersion;
  readonly resumedFromSeq: SequenceNumber;
}

export interface ServerPongMessage {
  readonly type: 'pong';
  readonly clientTimestamp: number;
  readonly serverTimestamp: number;
}

/** Out-of-band replay response — not sequenced, delivered immediately. */
export interface ServerReplayChunkMessage {
  readonly type: 'replay_chunk';
  readonly requestFromSeq: SequenceNumber;
  readonly requestToSeq: SequenceNumber;
  readonly messages: ReadonlyArray<SequencedServerMessage>;
  readonly isLast: boolean;
}

export type ControlServerMessage =
  | ServerHandshakeAckMessage
  | ServerPongMessage
  | ServerReplayChunkMessage;

// ─── Server → Client: Sequenced (participate in seq tracking) ────────────────

export interface ServerStreamStartMessage extends Sequenced {
  readonly type: 'stream_start';
  readonly streamId: StreamId;
  readonly conversationId: ConversationId;
}

export interface ServerTokenMessage extends Sequenced {
  readonly type: 'token';
  readonly streamId: StreamId;
  readonly token: string;
  readonly tokenIndex: number;
}

export interface ServerStreamEndMessage extends Sequenced {
  readonly type: 'stream_end';
  readonly streamId: StreamId;
  readonly totalTokens: number;
  readonly durationMs: number;
}

export interface ServerStreamErrorMessage extends Sequenced {
  readonly type: 'stream_error';
  readonly streamId: StreamId;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type SequencedServerMessage =
  | ServerStreamStartMessage
  | ServerTokenMessage
  | ServerStreamEndMessage
  | ServerStreamErrorMessage;

export type ServerMessage = ControlServerMessage | SequencedServerMessage;

// ─── Stream Lifecycle ─────────────────────────────────────────────────────────

export type StreamLifecycleStatus =
  | 'pending'
  | 'streaming'
  | 'completed'
  | 'error'
  | 'aborted';

export interface StreamState {
  readonly streamId: StreamId;
  readonly conversationId: ConversationId;
  readonly status: StreamLifecycleStatus;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly totalTokens: number;
  readonly errorCode: string | null;
  readonly retryable: boolean | null;
}

// ─── Connection State ─────────────────────────────────────────────────────────

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export interface ConnectionMetrics {
  readonly connectedAt: number | null;
  readonly lastPingMs: number | null;
  readonly reconnectCount: number;
  readonly messagesSent: number;
  readonly messagesReceived: number;
  readonly bytesReceived: number;
  readonly sessionId: SessionId | null;
  readonly lastDeliveredSeq: SequenceNumber;
}
