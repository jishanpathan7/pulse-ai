/**
 * StreamRegistry — tracks lifecycle of active and recent streams.
 *
 * The registry is read-only from outside: consumers observe stream state
 * via onStreamChange callbacks. Only the transport layer mutates state
 * via the on*() methods.
 *
 * Supports multi-stream coordination:
 *   - Multiple streams can be active concurrently (future multi-agent scenario)
 *   - Each stream is independently tracked
 *   - Completed/errored streams are retained for TTL_MS then evicted
 *
 * Invariants:
 *   - stream_start must precede token/stream_end/stream_error for a given streamId
 *   - Token count increases monotonically per stream
 *   - Once 'completed' or 'error': status is terminal, no further transitions
 *   - 'aborted' is set externally (e.g., user cancels, transport resets)
 */

import type {
  StreamId,
  StreamState,
  ServerStreamStartMessage,
  ServerTokenMessage,
  ServerStreamEndMessage,
  ServerStreamErrorMessage,
} from '@pulse/types/transport';

const COMPLETED_STREAM_TTL_MS = 60_000;

export type StreamChangeHandler = (state: StreamState) => void;

export class StreamRegistry {
  private readonly _streams = new Map<string, StreamState>();
  private readonly _listeners = new Set<StreamChangeHandler>();
  private readonly _evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  get activeStreams(): ReadonlyArray<StreamState> {
    return Array.from(this._streams.values()).filter(
      (s) => s.status === 'streaming' || s.status === 'pending',
    );
  }

  get allStreams(): ReadonlyArray<StreamState> {
    return Array.from(this._streams.values());
  }

  getStream(streamId: StreamId): StreamState | null {
    return this._streams.get(streamId as string) ?? null;
  }

  onStreamChange(handler: StreamChangeHandler): () => void {
    this._listeners.add(handler);
    return () => {
      this._listeners.delete(handler);
    };
  }

  // ─── Mutation (transport-internal) ──────────────────────────────────────────

  onStreamStart(msg: ServerStreamStartMessage): void {
    const existing = this._streams.get(msg.streamId as string);
    if (existing !== undefined) {
      // Duplicate stream_start (e.g., from replay) — idempotent if already started
      if (existing.status === 'pending' || existing.status === 'streaming') return;
    }

    const state: StreamState = {
      streamId: msg.streamId,
      conversationId: msg.conversationId,
      status: 'streaming',
      startedAt: msg.timestamp,
      completedAt: null,
      totalTokens: 0,
      errorCode: null,
      retryable: null,
    };

    this._streams.set(msg.streamId as string, state);
    this._notify(state);
  }

  onToken(msg: ServerTokenMessage): void {
    const current = this._streams.get(msg.streamId as string);
    if (current === undefined) return; // token before stream_start (replay edge case)
    if (current.status !== 'streaming') return;

    const updated: StreamState = {
      ...current,
      totalTokens: current.totalTokens + 1,
    };

    this._streams.set(msg.streamId as string, updated);
    this._notify(updated);
  }

  onStreamEnd(msg: ServerStreamEndMessage): StreamState | null {
    const current = this._streams.get(msg.streamId as string);
    if (current === undefined) return null;
    if (current.status !== 'streaming') return current;

    const completed: StreamState = {
      ...current,
      status: 'completed',
      completedAt: msg.timestamp,
      totalTokens: msg.totalTokens,
    };

    this._streams.set(msg.streamId as string, completed);
    this._notify(completed);
    this._scheduleEviction(msg.streamId);
    return completed;
  }

  onStreamError(msg: ServerStreamErrorMessage): StreamState | null {
    const current = this._streams.get(msg.streamId as string);
    if (current === undefined) return null;
    if (current.status !== 'streaming' && current.status !== 'pending') return current;

    const errored: StreamState = {
      ...current,
      status: 'error',
      completedAt: Date.now(),
      errorCode: msg.code,
      retryable: msg.retryable,
    };

    this._streams.set(msg.streamId as string, errored);
    this._notify(errored);
    this._scheduleEviction(msg.streamId);
    return errored;
  }

  abortStream(streamId: StreamId): void {
    const current = this._streams.get(streamId as string);
    if (current === undefined) return;
    if (current.status === 'completed' || current.status === 'error') return;

    const aborted: StreamState = {
      ...current,
      status: 'aborted',
      completedAt: Date.now(),
    };

    this._streams.set(streamId as string, aborted);
    this._notify(aborted);
    this._scheduleEviction(streamId);
  }

  /** Abort all active streams — called on disconnect/reset. */
  abortAll(): void {
    for (const state of this._streams.values()) {
      if (state.status === 'streaming' || state.status === 'pending') {
        this.abortStream(state.streamId);
      }
    }
  }

  reset(): void {
    for (const timer of this._evictionTimers.values()) {
      clearTimeout(timer);
    }
    this._evictionTimers.clear();
    this._streams.clear();
    this._listeners.clear();
  }

  private _notify(state: StreamState): void {
    for (const listener of this._listeners) {
      listener(state);
    }
  }

  private _scheduleEviction(streamId: StreamId): void {
    const existing = this._evictionTimers.get(streamId as string);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      this._streams.delete(streamId as string);
      this._evictionTimers.delete(streamId as string);
    }, COMPLETED_STREAM_TTL_MS);

    this._evictionTimers.set(streamId as string, timer);
  }
}
