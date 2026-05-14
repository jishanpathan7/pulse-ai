/**
 * Immutable snapshot factories.
 *
 * All snapshots are created via these factories, not via object literals.
 * Object.freeze() enforces runtime immutability (catches mutation in dev).
 * TypeScript `readonly` enforces compile-time immutability.
 *
 * Snapshot identity:
 *   Two snapshots with the same content are NOT the same reference.
 *   Use === for reference equality (to detect if content changed between renders).
 *   React relies on this: if a component receives the same snapshot reference,
 *   it can skip re-render (via memo/PureComponent).
 *
 * Snapshot lifecycle:
 *   1. stream_start → createActiveStream() → lives in streamStore
 *   2. Each RAF flush → updateActiveStream() → new object, same reference key
 *   3. stream_end → createMessageSnapshot() → frozen, moves to conversationStore
 *   4. conversationStore.addMessage() → createConversationSnapshot() → frozen
 */

import type { StreamId, ConversationId } from '@pulse/types/transport';
import type {
  MessageId,
  MessageRole,
  MessageSnapshot,
  ConversationSnapshot,
  ActiveStreamSnapshot,
} from '@pulse/types/render';
import { randomId } from './utils.js';

// ─── Active Stream Snapshot ───────────────────────────────────────────────────

export function createActiveStream(params: {
  streamId: StreamId;
  conversationId: ConversationId;
  messageId: MessageId;
  startedAt: number;
}): ActiveStreamSnapshot {
  return Object.freeze({
    streamId: params.streamId,
    conversationId: params.conversationId,
    messageId: params.messageId,
    content: '',
    tokenCount: 0,
    startedAt: params.startedAt,
    lastTokenAt: null,
    status: 'streaming',
    errorCode: null,
  } satisfies ActiveStreamSnapshot);
}

export function appendTokens(
  snapshot: ActiveStreamSnapshot,
  tokenDelta: string,
  newTokenCount: number,
  flushedAt: number,
): ActiveStreamSnapshot {
  return Object.freeze({
    ...snapshot,
    content: snapshot.content + tokenDelta,
    tokenCount: snapshot.tokenCount + newTokenCount,
    lastTokenAt: flushedAt,
  } satisfies ActiveStreamSnapshot);
}

export function markFinalizing(snapshot: ActiveStreamSnapshot): ActiveStreamSnapshot {
  return Object.freeze({
    ...snapshot,
    status: 'finalizing',
  } satisfies ActiveStreamSnapshot);
}

export function markStreamError(
  snapshot: ActiveStreamSnapshot,
  errorCode: string,
): ActiveStreamSnapshot {
  return Object.freeze({
    ...snapshot,
    status: 'error',
    errorCode,
  } satisfies ActiveStreamSnapshot);
}

// ─── Message Snapshot ─────────────────────────────────────────────────────────

export function createMessageSnapshot(params: {
  id?: MessageId;
  conversationId: ConversationId;
  role: MessageRole;
  content: string;
  streamId: StreamId | null;
  createdAt: number;
  completedAt: number | null;
  tokenCount: number;
  errorCode: string | null;
}): MessageSnapshot {
  return Object.freeze({
    id: params.id ?? (randomId() as MessageId),
    conversationId: params.conversationId,
    role: params.role,
    content: params.content,
    status: params.errorCode !== null ? 'error' : params.completedAt !== null ? 'complete' : 'pending',
    streamId: params.streamId,
    createdAt: params.createdAt,
    completedAt: params.completedAt,
    tokenCount: params.tokenCount,
    errorCode: params.errorCode,
  } satisfies MessageSnapshot);
}

/** Promote a completed ActiveStreamSnapshot to a frozen MessageSnapshot. */
export function snapshotFromActiveStream(
  stream: ActiveStreamSnapshot,
  completedAt: number,
): MessageSnapshot {
  return createMessageSnapshot({
    id: stream.messageId,
    conversationId: stream.conversationId,
    role: 'assistant',
    content: stream.content,
    streamId: stream.streamId,
    createdAt: stream.startedAt,
    completedAt,
    tokenCount: stream.tokenCount,
    errorCode: stream.errorCode,
  });
}

// ─── Conversation Snapshot ────────────────────────────────────────────────────

export function createConversationSnapshot(params: {
  id: ConversationId;
  messages: ReadonlyArray<MessageSnapshot>;
  updatedAt: number;
}): ConversationSnapshot {
  return Object.freeze({
    id: params.id,
    messages: Object.freeze([...params.messages]) as ReadonlyArray<MessageSnapshot>,
    updatedAt: params.updatedAt,
    messageCount: params.messages.length,
  } satisfies ConversationSnapshot);
}

export function appendMessage(
  conversation: ConversationSnapshot,
  message: MessageSnapshot,
): ConversationSnapshot {
  return createConversationSnapshot({
    id: conversation.id,
    messages: [...conversation.messages, message],
    updatedAt: Date.now(),
  });
}

export function replaceMessage(
  conversation: ConversationSnapshot,
  message: MessageSnapshot,
): ConversationSnapshot {
  const messages = conversation.messages.map((m: MessageSnapshot) =>
    m.id === message.id ? message : m,
  );
  return createConversationSnapshot({
    id: conversation.id,
    messages,
    updatedAt: Date.now(),
  });
}
