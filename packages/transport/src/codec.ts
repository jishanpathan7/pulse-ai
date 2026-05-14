/**
 * Transport codec — encode ClientMessage → wire string, decode wire string → ServerMessage.
 *
 * Wire format: JSON envelope `{ v: "1", msg: <message> }`
 *
 * Decoding is defensive: type guards validate the discriminant and required fields
 * before returning a typed ServerMessage. Unknown types are rejected as errors.
 *
 * Encoding never throws — ClientMessage is a discriminated union with no
 * runtime-unknown fields.
 */

import type {
  ClientMessage,
  ServerMessage,
  Envelope,
  ProtocolVersion,
} from '@pulse/types/transport';
import type { PulseError } from '@pulse/types/errors';
import { TransportErrorCode } from '@pulse/types/errors';
import type { Result } from '@pulse/utils';
import { ok, err } from '@pulse/utils';
import { PROTOCOL_VERSION as VERSION } from '@pulse/types/transport';

// ─── Encode ───────────────────────────────────────────────────────────────────

export function encode(message: ClientMessage): string {
  const envelope: Envelope<ClientMessage> = { v: VERSION, msg: message };
  return JSON.stringify(envelope);
}

// ─── Decode ───────────────────────────────────────────────────────────────────

export function decode(raw: string): Result<ServerMessage, PulseError> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return err(parseError('Invalid JSON in transport frame'));
  }

  if (!isObject(parsed)) {
    return err(parseError('Transport frame must be an object'));
  }

  // Validate envelope
  if (!hasStringField(parsed, 'v')) {
    return err(parseError('Missing protocol version field "v"'));
  }

  if (parsed['v'] !== VERSION) {
    return err(
      protocolError(
        `Unsupported protocol version: ${String(parsed['v'])}. Expected: ${VERSION}`,
      ),
    );
  }

  const msg = parsed['msg'];
  if (!isObject(msg)) {
    return err(parseError('Envelope "msg" field must be an object'));
  }

  if (!hasStringField(msg, 'type')) {
    return err(parseError('Message missing "type" discriminant'));
  }

  const type = msg['type'] as string;
  return parseServerMessage(type, msg);
}

// ─── Message Parsers ──────────────────────────────────────────────────────────

function parseServerMessage(
  type: string,
  msg: Record<string, unknown>,
): Result<ServerMessage, PulseError> {
  switch (type) {
    case 'handshake_ack':
      return parseHandshakeAck(msg);
    case 'pong':
      return parsePong(msg);
    case 'stream_start':
      return parseStreamStart(msg);
    case 'token':
      return parseToken(msg);
    case 'stream_end':
      return parseStreamEnd(msg);
    case 'stream_error':
      return parseStreamError(msg);
    case 'replay_chunk':
      return parseReplayChunk(msg);
    default:
      return err(parseError(`Unknown message type: "${type}"`));
  }
}

function parseHandshakeAck(msg: Record<string, unknown>): Result<ServerMessage, PulseError> {
  if (
    !hasStringField(msg, 'sessionId') ||
    !hasNumberField(msg, 'serverTimestamp') ||
    !hasStringField(msg, 'protocolVersion') ||
    !hasNumberField(msg, 'resumedFromSeq')
  ) {
    return err(parseError('Invalid handshake_ack: missing required fields'));
  }
  return ok({
    type: 'handshake_ack',
    sessionId: msg['sessionId'] as import('@pulse/types/transport').SessionId,
    serverTimestamp: msg['serverTimestamp'] as number,
    protocolVersion: msg['protocolVersion'] as ProtocolVersion,
    resumedFromSeq: msg['resumedFromSeq'] as import('@pulse/types/transport').SequenceNumber,
  });
}

function parsePong(msg: Record<string, unknown>): Result<ServerMessage, PulseError> {
  if (!hasNumberField(msg, 'clientTimestamp') || !hasNumberField(msg, 'serverTimestamp')) {
    return err(parseError('Invalid pong: missing required fields'));
  }
  return ok({
    type: 'pong',
    clientTimestamp: msg['clientTimestamp'] as number,
    serverTimestamp: msg['serverTimestamp'] as number,
  });
}

function parseStreamStart(msg: Record<string, unknown>): Result<ServerMessage, PulseError> {
  if (
    !hasNumberField(msg, 'seq') ||
    !hasNumberField(msg, 'timestamp') ||
    !hasStringField(msg, 'streamId') ||
    !hasStringField(msg, 'conversationId')
  ) {
    return err(parseError('Invalid stream_start: missing required fields'));
  }
  return ok({
    type: 'stream_start',
    seq: msg['seq'] as import('@pulse/types/transport').SequenceNumber,
    timestamp: msg['timestamp'] as number,
    streamId: msg['streamId'] as import('@pulse/types/transport').StreamId,
    conversationId: msg['conversationId'] as import('@pulse/types/transport').ConversationId,
  });
}

function parseToken(msg: Record<string, unknown>): Result<ServerMessage, PulseError> {
  if (
    !hasNumberField(msg, 'seq') ||
    !hasNumberField(msg, 'timestamp') ||
    !hasStringField(msg, 'streamId') ||
    !hasStringField(msg, 'token') ||
    !hasNumberField(msg, 'tokenIndex')
  ) {
    return err(parseError('Invalid token: missing required fields'));
  }
  return ok({
    type: 'token',
    seq: msg['seq'] as import('@pulse/types/transport').SequenceNumber,
    timestamp: msg['timestamp'] as number,
    streamId: msg['streamId'] as import('@pulse/types/transport').StreamId,
    token: msg['token'] as string,
    tokenIndex: msg['tokenIndex'] as number,
  });
}

function parseStreamEnd(msg: Record<string, unknown>): Result<ServerMessage, PulseError> {
  if (
    !hasNumberField(msg, 'seq') ||
    !hasNumberField(msg, 'timestamp') ||
    !hasStringField(msg, 'streamId') ||
    !hasNumberField(msg, 'totalTokens') ||
    !hasNumberField(msg, 'durationMs')
  ) {
    return err(parseError('Invalid stream_end: missing required fields'));
  }
  return ok({
    type: 'stream_end',
    seq: msg['seq'] as import('@pulse/types/transport').SequenceNumber,
    timestamp: msg['timestamp'] as number,
    streamId: msg['streamId'] as import('@pulse/types/transport').StreamId,
    totalTokens: msg['totalTokens'] as number,
    durationMs: msg['durationMs'] as number,
  });
}

function parseStreamError(msg: Record<string, unknown>): Result<ServerMessage, PulseError> {
  if (
    !hasNumberField(msg, 'seq') ||
    !hasNumberField(msg, 'timestamp') ||
    !hasStringField(msg, 'streamId') ||
    !hasStringField(msg, 'code') ||
    !hasStringField(msg, 'message') ||
    !hasBooleanField(msg, 'retryable')
  ) {
    return err(parseError('Invalid stream_error: missing required fields'));
  }
  return ok({
    type: 'stream_error',
    seq: msg['seq'] as import('@pulse/types/transport').SequenceNumber,
    timestamp: msg['timestamp'] as number,
    streamId: msg['streamId'] as import('@pulse/types/transport').StreamId,
    code: msg['code'] as string,
    message: msg['message'] as string,
    retryable: msg['retryable'] as boolean,
  });
}

function parseReplayChunk(msg: Record<string, unknown>): Result<ServerMessage, PulseError> {
  if (
    !hasNumberField(msg, 'requestFromSeq') ||
    !hasNumberField(msg, 'requestToSeq') ||
    !Array.isArray(msg['messages']) ||
    !hasBooleanField(msg, 'isLast')
  ) {
    return err(parseError('Invalid replay_chunk: missing required fields'));
  }

  const innerMessages: import('@pulse/types/transport').SequencedServerMessage[] = [];
  for (const raw of msg['messages'] as unknown[]) {
    if (!isObject(raw) || !hasStringField(raw, 'type')) {
      return err(parseError('replay_chunk contains invalid inner message'));
    }
    const innerResult = parseServerMessage(raw['type'] as string, raw);
    if (!innerResult.ok) return innerResult;
    const inner = innerResult.value;
    if (!('seq' in inner)) {
      return err(parseError('replay_chunk inner message is not sequenced'));
    }
    innerMessages.push(inner as import('@pulse/types/transport').SequencedServerMessage);
  }

  return ok({
    type: 'replay_chunk',
    requestFromSeq: msg['requestFromSeq'] as import('@pulse/types/transport').SequenceNumber,
    requestToSeq: msg['requestToSeq'] as import('@pulse/types/transport').SequenceNumber,
    messages: innerMessages,
    isLast: msg['isLast'] as boolean,
  });
}

// ─── Type Guard Utilities ─────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasStringField(obj: Record<string, unknown>, key: string): boolean {
  return key in obj && typeof obj[key] === 'string';
}

function hasNumberField(obj: Record<string, unknown>, key: string): boolean {
  return key in obj && typeof obj[key] === 'number';
}

function hasBooleanField(obj: Record<string, unknown>, key: string): boolean {
  return key in obj && typeof obj[key] === 'boolean';
}

// ─── Error Factories ──────────────────────────────────────────────────────────

function parseError(message: string): PulseError {
  return {
    domain: 'TRANSPORT',
    code: TransportErrorCode.PROTOCOL_VIOLATION,
    message,
    retryable: false,
  };
}

function protocolError(message: string): PulseError {
  return {
    domain: 'TRANSPORT',
    code: TransportErrorCode.PROTOCOL_VIOLATION,
    message,
    retryable: false,
  };
}
