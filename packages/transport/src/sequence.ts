import type { SequenceNumber } from '@pulse/types/transport';

/**
 * Sequence tracking for ordered delivery and gap detection.
 *
 * The server is the sequence authority. Client tracks the last seen seq
 * and detects gaps. On gap: buffer subsequent messages, request replay,
 * drain buffer once gap filled.
 */

export function toSeq(n: number): SequenceNumber {
  return n as SequenceNumber;
}

export function nextSeq(seq: SequenceNumber): SequenceNumber {
  return toSeq(seq + 1);
}

export function hasGap(expected: SequenceNumber, actual: SequenceNumber): boolean {
  return actual > expected;
}

export function gapSize(expected: SequenceNumber, actual: SequenceNumber): number {
  return actual - expected;
}

/**
 * SequenceBuffer accumulates out-of-order messages and drains
 * in-order once gaps are filled. Implementation in Phase 2.
 */
export interface SequenceBuffer<T> {
  push(seq: SequenceNumber, item: T): void;
  drain(upToSeq: SequenceNumber): ReadonlyArray<T>;
  hasPending(): boolean;
  readonly expectedSeq: SequenceNumber;
}
