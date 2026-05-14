/**
 * ReplayCoordinator — enforces the at-most-one-active-replay invariant.
 *
 * Only one replay request may be in-flight per connection at a time.
 * If a new gap is detected while a replay is active, the coordinator
 * widens the existing request range rather than sending a second request.
 *
 * This prevents:
 *   - Multiple interleaved replay responses that are hard to reconstruct
 *   - Request storms on burst packet loss
 *   - Server overload from overlapping replay queries
 *
 * Invariants:
 *   - At most one active replay at any time
 *   - Active replay range only grows, never shrinks
 *   - complete() must be called when server sends isLast=true
 *   - abort() resets state so a new replay can be requested
 *   - complete() emits a callback; caller is responsible for draining the buffer
 */

import type { ClientReplayRequestMessage, SequenceNumber } from '@pulse/types/transport';
import { toSeq } from './sequence.js';

export interface ActiveReplay {
  readonly fromSeq: SequenceNumber;
  readonly toSeq: SequenceNumber;
  readonly requestedAt: number;
  chunksReceived: number;
}

export type ReplayCompleteCallback = (from: SequenceNumber, to: SequenceNumber) => void;

export class ReplayCoordinator {
  private _active: ActiveReplay | null = null;
  private readonly _onComplete: ReplayCompleteCallback;
  private _totalRequested: number = 0;

  constructor(onComplete: ReplayCompleteCallback) {
    this._onComplete = onComplete;
  }

  get isActive(): boolean {
    return this._active !== null;
  }

  get active(): Readonly<ActiveReplay> | null {
    return this._active;
  }

  get totalRequested(): number {
    return this._totalRequested;
  }

  /**
   * Request replay for the range [fromSeq, toSeq].
   *
   * If a replay is already active:
   *   - Widen the range if fromSeq < active.fromSeq or toSeq > active.toSeq
   *   - Return a new request message only if the range was widened
   *   - Return null if the new gap is already covered by the active request
   *
   * If no replay is active:
   *   - Create new active replay and return the request message
   */
  requestReplay(
    fromSeq: SequenceNumber,
    endSeq: SequenceNumber,
  ): ClientReplayRequestMessage | null {
    if (this._active === null) {
      this._active = {
        fromSeq,
        toSeq: endSeq,
        requestedAt: Date.now(),
        chunksReceived: 0,
      };
      this._totalRequested++;
      return { type: 'replay_request', fromSeq, toSeq: endSeq };
    }

    // Widen existing range if needed
    const from = fromSeq as number;
    const to = endSeq as number;
    const activeFrom = this._active.fromSeq as number;
    const activeTo = this._active.toSeq as number;

    if (from >= activeFrom && to <= activeTo) {
      // Fully covered by active request — no new request needed
      return null;
    }

    const newFrom = toSeq(Math.min(from, activeFrom));
    const newTo = toSeq(Math.max(to, activeTo));

    this._active = {
      ...this._active,
      fromSeq: newFrom,
      toSeq: newTo,
    };

    this._totalRequested++;
    return { type: 'replay_request', fromSeq: newFrom, toSeq: newTo };
  }

  /**
   * Called when server sends replay_chunk with isLast=true.
   * Fires the onComplete callback and clears active state.
   */
  complete(): void {
    if (this._active === null) return;
    const { fromSeq, toSeq } = this._active;
    this._active = null;
    this._onComplete(fromSeq, toSeq);
  }

  /**
   * Record receipt of a chunk (for metrics/debugging).
   */
  onChunkReceived(): void {
    if (this._active !== null) {
      this._active = { ...this._active, chunksReceived: this._active.chunksReceived + 1 };
    }
  }

  /**
   * Abort current replay (e.g., on reconnect).
   * Caller must handle clearing the sequence buffer separately.
   */
  abort(): void {
    this._active = null;
  }

  reset(): void {
    this._active = null;
    this._totalRequested = 0;
  }
}
