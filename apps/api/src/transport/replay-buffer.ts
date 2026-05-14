/**
 * ReplayBuffer — Redis-backed storage of recent messages for replay recovery.
 *
 * Storage: Redis Sorted Set, score = seq number.
 *   ZADD replay:{sessionId} {seq} {json}
 *   ZRANGEBYSCORE replay:{sessionId} {fromSeq} {toSeq}
 *   EXPIRE replay:{sessionId} {ttlSeconds}
 *
 * Why Sorted Set over List:
 *   - O(log n + k) range queries by seq number
 *   - Automatic deduplication by seq (score)
 *   - No sequential scan needed for gap ranges
 *
 * Capacity:
 *   - ZREMRANGEBYRANK trims the buffer to MAX_MESSAGES after each append
 *   - If a client's lastSeq is older than MAX_MESSAGES, replay fails gracefully
 *     and the client must reconnect with a clean state
 *
 * TTL:
 *   - Refreshed on every message append
 *   - Default: 5 minutes (sufficient for brief network interruptions)
 *   - Long conversations: a session offline >5 minutes gets a clean reconnect
 */

import type { SequenceNumber, SessionId, SequencedServerMessage } from '@pulse/types/transport';
import type { Result } from '@pulse/utils';
import { ok, err } from '@pulse/utils';
import type { PulseError } from '@pulse/types/errors';
import type { Redis } from 'ioredis';

const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const MAX_MESSAGES = 2000; // ~20 minutes of streaming at 150 tokens/min

interface StoredMessage {
  readonly seq: number;
  readonly message: SequencedServerMessage;
}

export class ReplayBuffer {
  private readonly _redis: Redis;
  private readonly _ttlSeconds: number;
  private readonly _maxMessages: number;

  constructor(
    redis: Redis,
    options: { ttlSeconds?: number; maxMessages?: number } = {},
  ) {
    this._redis = redis;
    this._ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this._maxMessages = options.maxMessages ?? MAX_MESSAGES;
  }

  private _key(sessionId: SessionId): string {
    return `replay:${sessionId as string}`;
  }

  /**
   * Append a message to the replay buffer.
   * Refreshes TTL and trims to maxMessages.
   */
  async append(
    sessionId: SessionId,
    message: SequencedServerMessage,
  ): Promise<Result<void, PulseError>> {
    const key = this._key(sessionId);
    const score = message.seq as number;
    const stored: StoredMessage = { seq: score, message };
    const value = JSON.stringify(stored);

    try {
      const pipeline = this._redis.pipeline();
      pipeline.zadd(key, score, value);
      // Keep only the most recent MAX_MESSAGES
      pipeline.zremrangebyrank(key, 0, -(this._maxMessages + 1));
      pipeline.expire(key, this._ttlSeconds);
      await pipeline.exec();
      return ok(undefined);
    } catch (e) {
      return err({
        domain: 'CACHE',
        code: 'CACHE_WRITE_ERROR',
        message: `ReplayBuffer.append failed: ${String(e)}`,
        retryable: true,
      });
    }
  }

  /**
   * Retrieve messages in the range [fromSeq, toSeq] inclusive.
   * Returns messages sorted by seq ascending.
   */
  async query(
    sessionId: SessionId,
    fromSeq: SequenceNumber,
    toSeq: SequenceNumber,
  ): Promise<Result<ReadonlyArray<SequencedServerMessage>, PulseError>> {
    const key = this._key(sessionId);

    try {
      const raw = await this._redis.zrangebyscore(
        key,
        fromSeq as number,
        toSeq as number,
      );

      const messages: SequencedServerMessage[] = [];
      for (const item of raw) {
        try {
          const stored = JSON.parse(item) as StoredMessage;
          messages.push(stored.message);
        } catch {
          // Malformed entry — skip and continue
        }
      }

      return ok(messages);
    } catch (e) {
      return err({
        domain: 'CACHE',
        code: 'CACHE_READ_ERROR',
        message: `ReplayBuffer.query failed: ${String(e)}`,
        retryable: true,
      });
    }
  }

  /**
   * Get the highest seq stored for a session.
   * Returns null if no messages buffered (fresh session).
   */
  async highestSeq(sessionId: SessionId): Promise<Result<SequenceNumber | null, PulseError>> {
    const key = this._key(sessionId);

    try {
      const result = await this._redis.zrevrangebyscore(key, '+inf', '-inf', 'LIMIT', 0, 1);
      if (result.length === 0) return ok(null);

      const stored = JSON.parse(result[0] as string) as StoredMessage;
      return ok(stored.seq as SequenceNumber);
    } catch (e) {
      return err({
        domain: 'CACHE',
        code: 'CACHE_READ_ERROR',
        message: `ReplayBuffer.highestSeq failed: ${String(e)}`,
        retryable: true,
      });
    }
  }

  /**
   * Delete all buffered messages for a session (clean logout, not reconnect).
   */
  async clear(sessionId: SessionId): Promise<Result<void, PulseError>> {
    try {
      await this._redis.del(this._key(sessionId));
      return ok(undefined);
    } catch (e) {
      return err({
        domain: 'CACHE',
        code: 'CACHE_WRITE_ERROR',
        message: `ReplayBuffer.clear failed: ${String(e)}`,
        retryable: true,
      });
    }
  }
}
