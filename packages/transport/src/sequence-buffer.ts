/**
 * SequenceBuffer — holds out-of-order messages pending gap fill.
 *
 * When a gap is detected:
 *   1. Buffer the message that revealed the gap
 *   2. Buffer any subsequent messages
 *   3. On replay complete: call drainConsecutive(expectedSeq)
 *   4. Receive all buffered messages that are now contiguous
 *
 * Invariants:
 *   - push() replaces existing entry if seq already present (idempotent)
 *   - drainConsecutive() only returns messages whose seqs form
 *     an unbroken ascending sequence starting from fromSeq
 *   - drainConsecutive() removes returned messages from the buffer
 *   - Buffer size is bounded by MAX_BUFFER_SIZE; overflow drops oldest
 */

import type { SequenceNumber } from '@pulse/types/transport';

const MAX_BUFFER_SIZE = 1000;

export interface Buffered {
  readonly seq: SequenceNumber;
}

export class SequenceBuffer<T extends Buffered> {
  private readonly _pending = new Map<number, T>();

  push(item: T): void {
    if (this._pending.size >= MAX_BUFFER_SIZE) {
      // Evict oldest (lowest seq) to stay bounded
      const oldest = Math.min(...this._pending.keys());
      this._pending.delete(oldest);
    }
    this._pending.set(item.seq as number, item);
  }

  /**
   * Drain all messages that form a consecutive sequence starting at fromSeq.
   * Stops at the first missing seq number.
   *
   * Example: buffer = [5, 6, 8, 9], fromSeq=5 → returns [5, 6], buffer = [8, 9]
   * Example: buffer = [5, 6, 8, 9], fromSeq=7 → returns [], buffer unchanged
   */
  drainConsecutive(fromSeq: SequenceNumber): ReadonlyArray<T> {
    const result: T[] = [];
    let current = fromSeq as number;

    while (this._pending.has(current)) {
      const item = this._pending.get(current);
      // biome-ignore lint — Map.get checked via .has(), item is always defined here
      this._pending.delete(current);
      result.push(item!);
      current++;
    }

    return result;
  }

  hasPending(): boolean {
    return this._pending.size > 0;
  }

  size(): number {
    return this._pending.size;
  }

  /**
   * Lowest seq number currently buffered.
   * Returns null if buffer is empty.
   */
  lowestPending(): SequenceNumber | null {
    if (this._pending.size === 0) return null;
    const lowest = Math.min(...this._pending.keys());
    return lowest as SequenceNumber;
  }

  /**
   * Highest seq number currently buffered.
   * Returns null if buffer is empty.
   */
  highestPending(): SequenceNumber | null {
    if (this._pending.size === 0) return null;
    const highest = Math.max(...this._pending.keys());
    return highest as SequenceNumber;
  }

  clear(): void {
    this._pending.clear();
  }
}
