/**
 * StreamBufferManager — per-stream token accumulator.
 *
 * Lives OUTSIDE React state and OUTSIDE Zustand.
 * It is a plain mutable data structure that the RAFScheduler drains.
 *
 * Why separate from stores:
 *   Tokens arrive at 150/s. If each token triggered a Zustand update,
 *   React would schedule 150 renders/s. Instead:
 *     1. Tokens land here (no React involvement)
 *     2. RAF fires → drain → ONE Zustand update per frame per stream
 *     3. React renders once per frame
 *
 * Finalization protocol:
 *   When stream_end arrives, we can't finalize immediately because
 *   buffered tokens haven't flushed yet. Instead:
 *     1. stream_end → markForFinalization(streamId, data)
 *     2. Next RAF flush → drainTokens(streamId) → commit to streamStore
 *     3. After commit → checkFinalization(streamId) → finalize to conversationStore
 *   This guarantees ALL tokens are in the snapshot before finalization.
 *
 * Idempotency:
 *   push() after finalization is silently dropped.
 *   Replay recovery may re-deliver token messages — the seq tracker deduplicates
 *   BEFORE they reach the pipeline, so this is a belt-and-suspenders guard.
 */

import type { StreamId, ConversationId } from '@pulse/types/transport';
import type { MessageId } from '@pulse/types/render';

export interface StreamBufferEntry {
  readonly streamId: StreamId;
  readonly conversationId: ConversationId;
  readonly messageId: MessageId;
  readonly startedAt: number;
  pending: string[];
  finalized: boolean;
}

export interface StreamFinalizationData {
  readonly streamId: StreamId;
  readonly totalTokens: number;
  readonly durationMs: number;
  readonly finalizedAt: number;
  readonly isError: boolean;
  readonly errorCode: string | null;
}

export class StreamBufferManager {
  private readonly _buffers = new Map<string, StreamBufferEntry>();
  private readonly _pendingFinalizations = new Map<string, StreamFinalizationData>();

  create(
    streamId: StreamId,
    conversationId: ConversationId,
    messageId: MessageId,
  ): void {
    if (this._buffers.has(streamId as string)) return; // Idempotent
    this._buffers.set(streamId as string, {
      streamId,
      conversationId,
      messageId,
      startedAt: Date.now(),
      pending: [],
      finalized: false,
    });
  }

  push(streamId: StreamId, token: string): boolean {
    const entry = this._buffers.get(streamId as string);
    if (entry === undefined || entry.finalized) return false;
    entry.pending.push(token);
    return true;
  }

  /**
   * Drain all pending tokens for a stream, returning them as an array.
   * Resets the pending array. Caller is responsible for committing to the store.
   */
  drain(streamId: StreamId): string[] {
    const entry = this._buffers.get(streamId as string);
    if (entry === undefined || entry.pending.length === 0) return [];
    const tokens = entry.pending.splice(0);
    return tokens;
  }

  /**
   * Drain all streams that have pending tokens.
   * Returns a map of streamId → tokens.
   */
  drainAll(): ReadonlyMap<StreamId, string[]> {
    const result = new Map<StreamId, string[]>();
    for (const [, entry] of this._buffers) {
      if (entry.pending.length > 0 && !entry.finalized) {
        result.set(entry.streamId, entry.pending.splice(0));
      }
    }
    return result;
  }

  /**
   * Mark a stream for finalization after its next token flush.
   * Called on stream_end or stream_error.
   */
  markForFinalization(streamId: StreamId, data: StreamFinalizationData): void {
    const entry = this._buffers.get(streamId as string);
    if (entry === undefined) return;
    entry.finalized = true;
    this._pendingFinalizations.set(streamId as string, data);
  }

  /**
   * Check if a stream has a pending finalization.
   * Returns and removes the finalization data if present.
   * Called AFTER tokens have been committed to the store.
   */
  popFinalization(streamId: StreamId): StreamFinalizationData | null {
    const data = this._pendingFinalizations.get(streamId as string);
    if (data === undefined) return null;
    this._pendingFinalizations.delete(streamId as string);
    this._buffers.delete(streamId as string);
    return data;
  }

  getEntry(streamId: StreamId): StreamBufferEntry | null {
    return this._buffers.get(streamId as string) ?? null;
  }

  hasPendingTokens(streamId: StreamId): boolean {
    const entry = this._buffers.get(streamId as string);
    return entry !== undefined && entry.pending.length > 0;
  }

  hasAnyPending(): boolean {
    for (const entry of this._buffers.values()) {
      if (entry.pending.length > 0) return true;
    }
    return false;
  }

  activeStreamIds(): ReadonlyArray<StreamId> {
    return Array.from(this._buffers.values())
      .filter((e) => !e.finalized)
      .map((e) => e.streamId);
  }

  reset(): void {
    this._buffers.clear();
    this._pendingFinalizations.clear();
  }
}
