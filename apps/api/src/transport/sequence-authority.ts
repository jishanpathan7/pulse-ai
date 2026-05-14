/**
 * SequenceAuthority — assigns monotonically increasing sequence numbers
 * to outgoing server messages, per connection session.
 *
 * The server is the sole sequence authority. Clients never generate seq numbers.
 *
 * Design: in-memory counter per active connection.
 *   - Sequence is per-connection-session, not global
 *   - Counter starts at 1 (0 reserved for control messages)
 *   - Node.js single-threaded: no atomic ops needed
 *   - Counter is lost when connection closes — that's intentional:
 *     the Redis replay buffer is indexed by seq and survives connection close
 *
 * seq=0 is CONTROL_SEQ — assigned to handshake_ack.
 * seq≥1 is assigned to stream_start, token, stream_end, stream_error.
 */

import type { SequenceNumber, SequencedServerMessage, SessionId } from '@pulse/types/transport';
import { CONTROL_SEQ } from '@pulse/types/transport';

export class SequenceAuthority {
  private readonly _sessionId: SessionId;
  private _counter: number;

  constructor(sessionId: SessionId, resumeFrom: SequenceNumber = CONTROL_SEQ) {
    this._sessionId = sessionId;
    // Resume from lastDelivered: next seq = resumeFrom + 1
    this._counter = (resumeFrom as number) + 1;

    // Enforce minimum starting seq of 1
    if (this._counter < 1) this._counter = 1;
  }

  get sessionId(): SessionId {
    return this._sessionId;
  }

  get lastAssigned(): SequenceNumber {
    return (this._counter - 1) as SequenceNumber;
  }

  /**
   * Stamp a sequenced message with the next sequence number.
   * Returns a new message object (immutable input).
   * Advances the internal counter.
   */
  stamp<T extends Omit<SequencedServerMessage, 'seq' | 'timestamp'>>(
    message: T,
  ): T & { readonly seq: SequenceNumber; readonly timestamp: number } {
    const seq = this._counter as SequenceNumber;
    this._counter++;
    return {
      ...message,
      seq,
      timestamp: Date.now(),
    } as T & { readonly seq: SequenceNumber; readonly timestamp: number };
  }

  /**
   * Stamp control messages (handshake_ack) with seq=0.
   * Does not advance the counter.
   */
  stampControl<T extends object>(message: T): T {
    return message; // Control messages carry no seq
  }

  reset(): void {
    this._counter = 1;
  }
}

/**
 * SequenceAuthorityRegistry — manages one SequenceAuthority per active connection.
 * Keyed by sessionId. The WS handler creates an authority on session open
 * and removes it on session close.
 */
export class SequenceAuthorityRegistry {
  private readonly _authorities = new Map<string, SequenceAuthority>();

  create(sessionId: SessionId, resumeFrom?: SequenceNumber): SequenceAuthority {
    const authority = new SequenceAuthority(sessionId, resumeFrom);
    this._authorities.set(sessionId as string, authority);
    return authority;
  }

  get(sessionId: SessionId): SequenceAuthority | null {
    return this._authorities.get(sessionId as string) ?? null;
  }

  remove(sessionId: SessionId): void {
    this._authorities.delete(sessionId as string);
  }

  get size(): number {
    return this._authorities.size;
  }
}
