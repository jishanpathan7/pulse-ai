/**
 * RAFScheduler — requestAnimationFrame-based token flush coordinator.
 *
 * Core invariants:
 *   1. At most one pending RAF at any time (_rafId !== null → RAF pending)
 *   2. _isFlushActive prevents reentrancy within a single flush
 *   3. Queue drain is atomic: full splice(0) before any downstream call
 *   4. Flush callback is synchronous: RAF fires once, drains all pending tokens
 *
 * Token batching benefit:
 *   Tokens arriving at 150/s → ~2-3 per 16ms frame.
 *   Without batching: 150 setState calls/s → 150 React renders/s (jank).
 *   With batching: 60 RAF callbacks/s → 60 setState calls/s (one per frame).
 *   Under heavy load (burst): many tokens per frame → one larger setState.
 *
 * The scheduler is framework-agnostic:
 *   It receives tokens, groups by stream, calls onFlush.
 *   The caller (RenderPipeline) decides what onFlush does (Zustand commit).
 *
 * Finalization flow:
 *   When a stream ends, all its tokens are flushed first.
 *   Then pendingFinalizations are checked AFTER token commit.
 *   This ensures the final snapshot includes ALL tokens.
 */

import type { StreamId } from '@pulse/types/transport';
import type { TokenFlushBatch, FrameResult } from '@pulse/types/render';

export type FlushCallback = (
  batches: ReadonlyArray<TokenFlushBatch>,
  result: FrameResult,
) => void;

export type FrameMonitorCallback = (result: FrameResult) => void;

interface QueueEntry {
  readonly streamId: StreamId;
  readonly tokens: string[];
}

export class RAFScheduler {
  private _queue: QueueEntry[] = [];
  private _rafId: number | null = null; // null = no pending RAF (invariant anchor)
  private _isFlushActive: boolean = false; // reentrancy guard
  private _frameIndex: number = 0;
  private readonly _onFlush: FlushCallback;
  private readonly _onFrame: FrameMonitorCallback | undefined;

  constructor(onFlush: FlushCallback, onFrame?: FrameMonitorCallback) {
    this._onFlush = onFlush;
    this._onFrame = onFrame;
  }

  get hasPendingWork(): boolean {
    return this._queue.length > 0 || this._rafId !== null;
  }

  get pendingTokenCount(): number {
    return this._queue.reduce((sum, e) => sum + e.tokens.length, 0);
  }

  /**
   * Enqueue tokens for a stream. Schedules a RAF if one is not already pending.
   * Safe to call many times per frame — only one RAF is ever scheduled.
   */
  enqueue(streamId: StreamId, tokens: ReadonlyArray<string>): void {
    if (tokens.length === 0) return;

    this._queue.push({ streamId, tokens: tokens as string[] });
    this._scheduleFlush();
  }

  /**
   * Force an immediate synchronous flush (no RAF).
   * Used when a stream_end arrives and we need the final snapshot before the
   * next frame (e.g., the conversation is navigated away before the frame fires).
   *
   * Calling this cancels any pending RAF.
   */
  flushNow(): void {
    this._cancelPending();
    if (this._queue.length > 0) {
      this._doFlush(performance.now());
    }
  }

  /**
   * Cancel any pending RAF and clear the queue.
   * Called on disconnect or pipeline teardown.
   */
  cancel(): void {
    this._cancelPending();
    this._queue = [];
    this._isFlushActive = false;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _scheduleFlush(): void {
    if (this._rafId !== null) return; // Invariant: only one pending RAF
    this._rafId = requestAnimationFrame((timestamp) => {
      this._rafId = null; // RAF no longer pending — clear before flush
      this._doFlush(timestamp);
    });
  }

  private _cancelPending(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  private _doFlush(_timestamp: number): void {
    if (this._isFlushActive) return; // Reentrancy guard
    if (this._queue.length === 0) return; // Nothing to flush

    const frameStart = performance.now();
    this._isFlushActive = true;

    // ── Atomic drain ──────────────────────────────────────────────────────────
    // splice(0) atomically removes all entries. Any tokens pushed during the
    // synchronous flush callback land in a new queue and get a fresh RAF.
    const pending = this._queue.splice(0);

    // ── Group by streamId ─────────────────────────────────────────────────────
    // Multiple enqueue calls for the same stream get collapsed into one batch.
    const byStream = new Map<string, string[]>();
    for (const entry of pending) {
      const existing = byStream.get(entry.streamId as string);
      if (existing !== undefined) {
        for (const t of entry.tokens) existing.push(t);
      } else {
        byStream.set(entry.streamId as string, [...entry.tokens]);
      }
    }

    // ── Build immutable batches ───────────────────────────────────────────────
    const flushedAt = Date.now();
    let totalTokens = 0;
    const batches: TokenFlushBatch[] = [];

    for (const [streamIdStr, tokens] of byStream) {
      const tokenDelta = tokens.join('');
      totalTokens += tokens.length;
      batches.push({
        streamId: streamIdStr as StreamId,
        tokens: Object.freeze(tokens) as ReadonlyArray<string>,
        tokenDelta,
        batchSize: tokens.length,
        flushedAt,
      });
    }

    const frameTimeMs = performance.now() - frameStart;
    const result: FrameResult = {
      flushedAt,
      frameTimeMs,
      batchCount: batches.length,
      totalTokens,
      exceededBudget: frameTimeMs > 16,
    };

    this._frameIndex++;
    this._isFlushActive = false;

    // ── Commit (synchronous, outside isFlushActive guard) ─────────────────────
    this._onFlush(Object.freeze(batches) as ReadonlyArray<TokenFlushBatch>, result);
    this._onFrame?.(result);
  }
}
