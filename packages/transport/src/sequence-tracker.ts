/**
 * SequenceTracker — classifies incoming seq numbers and tracks delivery progress.
 *
 * Classification results:
 *   'in_order'   — seq === expected, deliver and advance
 *   'gap'        — seq > expected, buffer and request replay
 *   'duplicate'  — seq < expected, drop (already delivered)
 *   'control'    — seq === 0 (CONTROL_SEQ), bypass sequencing
 *
 * The tracker does NOT buffer messages — that is SequenceBuffer's job.
 * The tracker does NOT send replay requests — that is ReplayCoordinator's job.
 *
 * Invariants:
 *   - lastDelivered increases monotonically (never decreases)
 *   - expectedSeq === lastDelivered + 1 (always)
 *   - reset() is only called on a completely new session (not reconnect)
 */

import { type SequenceNumber, CONTROL_SEQ } from '@pulse/types/transport';
import { toSeq } from './sequence.js';

export type ClassifyResult =
  | { readonly kind: 'in_order'; readonly seq: SequenceNumber }
  | { readonly kind: 'gap'; readonly expectedSeq: SequenceNumber; readonly receivedSeq: SequenceNumber; readonly gapSize: number }
  | { readonly kind: 'duplicate'; readonly seq: SequenceNumber }
  | { readonly kind: 'control' };

export class SequenceTracker {
  private _lastDelivered: number = 0;

  get lastDelivered(): SequenceNumber {
    return toSeq(this._lastDelivered);
  }

  get expectedSeq(): SequenceNumber {
    return toSeq(this._lastDelivered + 1);
  }

  classify(seq: SequenceNumber): ClassifyResult {
    const n = seq as number;

    // seq=0: control message, bypass tracking
    if (n === (CONTROL_SEQ as number)) {
      return { kind: 'control' };
    }

    const expected = this._lastDelivered + 1;

    if (n === expected) {
      return { kind: 'in_order', seq };
    }

    if (n > expected) {
      return {
        kind: 'gap',
        expectedSeq: toSeq(expected),
        receivedSeq: seq,
        gapSize: n - expected,
      };
    }

    // n < expected: already delivered
    return { kind: 'duplicate', seq };
  }

  /**
   * Record that a message with this seq was successfully delivered.
   * Must only be called after classify returns 'in_order'.
   */
  markDelivered(seq: SequenceNumber): void {
    const n = seq as number;
    if (n !== this._lastDelivered + 1) {
      throw new Error(
        `SequenceTracker.markDelivered: expected ${this._lastDelivered + 1}, got ${n}. ` +
          `Call classify first and only call markDelivered on 'in_order' results.`,
      );
    }
    this._lastDelivered = n;
  }

  /**
   * Advance by a contiguous batch (used when draining replay buffer).
   * seq must equal expectedSeq at call time.
   */
  markDeliveredBatch(seqs: ReadonlyArray<SequenceNumber>): void {
    for (const seq of seqs) {
      this.markDelivered(seq);
    }
  }

  /**
   * Full reset — only on new session (not reconnect).
   * On reconnect, the tracker retains its position so the server knows
   * what to replay.
   */
  reset(): void {
    this._lastDelivered = 0;
  }
}
