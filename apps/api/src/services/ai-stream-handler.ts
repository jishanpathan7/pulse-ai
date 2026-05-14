/**
 * aiStreamHandler — streams Anthropic tokens over an active WebSocket session.
 *
 * Responsibilities:
 *   - Save user message + upsert conversation in DB before starting stream
 *   - Call Anthropic SDK with the given messages
 *   - Stamp each outgoing message with a sequence number (SequenceAuthority)
 *   - Send via ConnectionManager to the active WS connection
 *   - Buffer every sequenced message in ReplayBuffer (enables replay on reconnect)
 *   - Save completed assistant message to DB after stream_end
 *
 * Cancellation:
 *   The caller passes an AbortSignal. On abort, the for-await loop breaks and
 *   a stream_error(aborted) message is sent. The Anthropic SDK respects the signal.
 *
 * Error handling:
 *   All errors are caught; stream_error is always sent before function returns.
 *   The caller should not throw after calling this function.
 */

import Anthropic from '@anthropic-ai/sdk';
import type pg from 'pg';
import type {
  SessionId, StreamId, ConversationId, SequenceNumber,
  ServerStreamStartMessage, ServerTokenMessage, ServerStreamEndMessage, ServerStreamErrorMessage,
} from '@pulse/types/transport';

// Distributive Omit — preserves union discriminant unlike plain Omit<Union, K>
type RawSequenced =
  | Omit<ServerStreamStartMessage, 'seq' | 'timestamp'>
  | Omit<ServerTokenMessage, 'seq' | 'timestamp'>
  | Omit<ServerStreamEndMessage, 'seq' | 'timestamp'>
  | Omit<ServerStreamErrorMessage, 'seq' | 'timestamp'>;

import type { SequenceAuthority } from '../transport/sequence-authority.js';
import type { ConnectionManager } from '../transport/connection-manager.js';
import type { ReplayBuffer } from '../transport/replay-buffer.js';
import type { SessionStore } from '../transport/session-store.js';
import { resolveStreamClient } from './stream-resolver.js';

export interface StreamRequest {
  sessionId: SessionId;
  streamId: StreamId;
  conversationId: ConversationId;
  userId: string;
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  model?: string | undefined;
  maxTokens?: number | undefined;
  systemPrompt?: string | undefined;
  /** BYOK: user_api_keys.id to use instead of platform key */
  keyId?: string | undefined;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function ensureConversation(
  db: pg.Pool,
  conversationId: string,
  userId: string,
): Promise<void> {
  // Upsert: create if not exists, owned by this user. Idempotent.
  await db.query(
    `INSERT INTO conversations (id, user_id, title)
     VALUES ($1, $2, 'New session')
     ON CONFLICT (id) DO NOTHING`,
    [conversationId, userId],
  );
}

async function saveMessage(
  db: pg.Pool,
  opts: {
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    tokenCount?: number;
    completedAt?: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO messages (conversation_id, role, content, token_count, completed_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      opts.conversationId,
      opts.role,
      opts.content,
      opts.tokenCount ?? 0,
      opts.completedAt ?? null,
    ],
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleAiStream(
  req: StreamRequest,
  deps: {
    authority: SequenceAuthority;
    connections: ConnectionManager;
    replay: ReplayBuffer;
    sessions: SessionStore;
    db: pg.Pool;
    signal?: AbortSignal | undefined;
  },
): Promise<void> {
  const { sessionId, streamId, conversationId, userId, messages, model, maxTokens, systemPrompt, keyId } = req;
  const { authority, connections, replay, sessions, db, signal } = deps;
  const startedAt = Date.now();

  /** Stamp + send + buffer one sequenced message. */
  async function dispatch(raw: RawSequenced): Promise<void> {
    const msg = authority.stamp(raw as Parameters<typeof authority.stamp>[0]) as import('@pulse/types/transport').SequencedServerMessage;
    const data = JSON.stringify(msg);
    connections.send(sessionId, data);
    await replay.append(sessionId, msg);
    await sessions.updateLastSeq(sessionId, msg.seq as SequenceNumber);
  }

  const system = systemPrompt;
  const conversation = messages as Array<{ role: 'user' | 'assistant'; content: string }>;

  // Ensure conversation row exists
  await ensureConversation(db, conversationId as string, userId);

  // Save the newest user message (last in array)
  const lastMsg = conversation[conversation.length - 1];
  if (lastMsg !== undefined && lastMsg.role === 'user') {
    await saveMessage(db, {
      conversationId: conversationId as string,
      role: 'user',
      content: lastMsg.content,
      completedAt: new Date(),
    });
  }

  // stream_start
  await dispatch({ type: 'stream_start', streamId, conversationId });

  let tokenIndex = 0;
  const assembledTokens: string[] = [];

  // Resolve which backend to use (BYOK or platform)
  const client = await resolveStreamClient(db, userId, keyId);

  if (!client) {
    await dispatch({
      type: 'stream_error',
      streamId,
      code: 'auth_failed',
      message: keyId
        ? 'BYOK key not found or has been revoked'
        : 'No AI provider configured on this server',
      retryable: false,
    });
    return;
  }

  // ── BYOK path ──────────────────────────────────────────────────────────────
  if (client.type === 'byok') {
    const { adapter, rawKey, keyId: resolvedKeyId, providerId } = client;
    let errored = false;

    try {
      const eventStream = adapter.stream(rawKey, {
        messages: conversation,
        model: model ?? DEFAULT_MODEL,
        maxTokens: maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(system !== undefined ? { systemPrompt: system } : {}),
        ...(signal !== undefined ? { signal } : {}),
      });

      for await (const event of eventStream) {
        if (signal?.aborted) break;

        if (event.type === 'token') {
          assembledTokens.push(event.token);
          await dispatch({ type: 'token', streamId, token: event.token, tokenIndex: tokenIndex++ });
        } else if (event.type === 'error') {
          errored = true;
          await dispatch({ type: 'stream_error', streamId, code: event.code, message: event.message, retryable: event.code === 'rate_limited' });
          if (event.code === 'auth_failed') {
            await db.query(
              `UPDATE user_api_keys SET is_valid = FALSE, validation_error = 'auth_failed', updated_at = NOW() WHERE id = $1`,
              [resolvedKeyId],
            );
          }
          return;
        }
      }

      if (signal?.aborted) {
        errored = true;
        await dispatch({ type: 'stream_error', streamId, code: 'aborted', message: 'Stream cancelled by client', retryable: false });
        return;
      }

      // Save assistant message
      const fullContent = assembledTokens.join('');
      if (fullContent.length > 0) {
        await saveMessage(db, { conversationId: conversationId as string, role: 'assistant', content: fullContent, tokenCount: tokenIndex, completedAt: new Date() });
      }

      await dispatch({ type: 'stream_end', streamId, totalTokens: tokenIndex, durationMs: Date.now() - startedAt });
    } catch (e) {
      errored = true;
      await dispatch({ type: 'stream_error', streamId, code: 'network_error', message: 'BYOK stream error', retryable: false });
    } finally {
      try {
        await db.query(`UPDATE user_api_keys SET last_used_at = NOW() WHERE id = $1`, [resolvedKeyId]);
        await db.query(
          `INSERT INTO api_key_audit_log (user_id, key_id, provider_id, event, meta) VALUES ($1,$2,$3,$4,$5)`,
          [userId, resolvedKeyId, providerId, errored ? 'stream_failed' : 'stream_completed', JSON.stringify({ totalTokens: tokenIndex })],
        );
      } catch { /* non-fatal */ }
    }
    return;
  }

  // ── Platform Anthropic path ────────────────────────────────────────────────
  const anthropicClient = client.anthropic;

  try {
    const stream = anthropicClient.messages.stream({
      model: model ?? DEFAULT_MODEL,
      max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(system !== undefined ? { system } : {}),
      messages: conversation,
    });

    if (signal !== undefined) {
      signal.addEventListener('abort', () => stream.controller.abort(), { once: true });
    }

    for await (const event of stream) {
      if (signal?.aborted) break;

      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        assembledTokens.push(event.delta.text);
        await dispatch({ type: 'token', streamId, token: event.delta.text, tokenIndex: tokenIndex++ });
      }
    }

    if (signal?.aborted) {
      await dispatch({ type: 'stream_error', streamId, code: 'aborted', message: 'Stream cancelled by client', retryable: false });
      return;
    }

    const fullContent = assembledTokens.join('');
    if (fullContent.length > 0) {
      await saveMessage(db, { conversationId: conversationId as string, role: 'assistant', content: fullContent, tokenCount: tokenIndex, completedAt: new Date() });
    }

    await dispatch({ type: 'stream_end', streamId, totalTokens: tokenIndex, durationMs: Date.now() - startedAt });
  } catch (e) {
    const code =
      e instanceof Anthropic.APIError && e.status === 401 ? 'auth_failed'
      : e instanceof Anthropic.APIError && e.status === 429 ? 'rate_limited'
      : e instanceof Anthropic.APIError && e.status === 529 ? 'rate_limited'
      : 'model_error';

    await dispatch({ type: 'stream_error', streamId, code, message: e instanceof Error ? e.message : 'Unknown error', retryable: code === 'rate_limited' });
  }
}
