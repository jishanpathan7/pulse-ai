/**
 * SessionStore — Redis-backed session metadata for WebSocket connections.
 *
 * Stores per-session state so the WS handler can:
 *   - Look up lastDeliveredSeq on reconnect (for replay range)
 *   - Associate clientId → sessionId
 *   - Track session metadata for observability
 *
 * Storage: Redis Hash per session, TTL refreshed on activity.
 *   Key: session:{sessionId}
 *   Fields: clientId, lastSeq, connectedAt, lastActivityAt
 *
 * On clean disconnect: session is deleted (no replay needed).
 * On dirty disconnect: session TTL runs out naturally.
 * On reconnect: session is looked up by clientId.
 *
 * clientId → sessionId mapping stored separately:
 *   Key: session:client:{clientId}
 *   Value: sessionId (string)
 *   TTL: same as session
 */

import type { SequenceNumber, SessionId, ClientId } from '@pulse/types/transport';
import type { Result } from '@pulse/utils';
import { ok, err } from '@pulse/utils';
import type { PulseError } from '@pulse/types/errors';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 600; // 10 minutes

export interface SessionData {
  readonly sessionId: SessionId;
  readonly clientId: ClientId;
  readonly lastDeliveredSeq: SequenceNumber;
  readonly connectedAt: number;
  readonly lastActivityAt: number;
}

export class SessionStore {
  private readonly _redis: Redis;
  private readonly _ttlSeconds: number;

  constructor(redis: Redis, options: { ttlSeconds?: number } = {}) {
    this._redis = redis;
    this._ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  private _sessionKey(sessionId: SessionId): string {
    return `session:${sessionId as string}`;
  }

  private _clientKey(clientId: ClientId): string {
    return `session:client:${clientId as string}`;
  }

  /**
   * Create a new session or restore an existing one for clientId.
   * Returns the session data (existing or newly created).
   */
  async openSession(
    clientId: ClientId,
    lastSeqFromClient: SequenceNumber,
  ): Promise<Result<SessionData, PulseError>> {
    try {
      // Check if client has an existing session
      const existing = await this._restoreExisting(clientId, lastSeqFromClient);
      if (existing !== null) return ok(existing);

      // Fresh session
      const sessionId = randomUUID() as SessionId;
      const now = Date.now();
      const session: SessionData = {
        sessionId,
        clientId,
        lastDeliveredSeq: lastSeqFromClient,
        connectedAt: now,
        lastActivityAt: now,
      };

      await this._persist(session);
      return ok(session);
    } catch (e) {
      return err({
        domain: 'CACHE',
        code: 'CACHE_WRITE_ERROR',
        message: `SessionStore.openSession failed: ${String(e)}`,
        retryable: true,
      });
    }
  }

  /**
   * Update lastDeliveredSeq — called after each message sent to client.
   * Refreshes TTL.
   */
  async updateLastSeq(
    sessionId: SessionId,
    seq: SequenceNumber,
  ): Promise<Result<void, PulseError>> {
    const key = this._sessionKey(sessionId);
    try {
      const pipeline = this._redis.pipeline();
      pipeline.hset(key, 'lastDeliveredSeq', String(seq as number));
      pipeline.hset(key, 'lastActivityAt', String(Date.now()));
      pipeline.expire(key, this._ttlSeconds);
      await pipeline.exec();
      return ok(undefined);
    } catch (e) {
      return err({
        domain: 'CACHE',
        code: 'CACHE_WRITE_ERROR',
        message: `SessionStore.updateLastSeq failed: ${String(e)}`,
        retryable: true,
      });
    }
  }

  /**
   * Get session by sessionId.
   */
  async get(sessionId: SessionId): Promise<Result<SessionData | null, PulseError>> {
    try {
      const data = await this._redis.hgetall(this._sessionKey(sessionId));
      if (Object.keys(data).length === 0) return ok(null);
      return ok(this._deserialize(sessionId, data));
    } catch (e) {
      return err({
        domain: 'CACHE',
        code: 'CACHE_READ_ERROR',
        message: `SessionStore.get failed: ${String(e)}`,
        retryable: true,
      });
    }
  }

  /**
   * Clean delete — called on intentional disconnect (no reconnect expected).
   */
  async closeSession(sessionId: SessionId, clientId: ClientId): Promise<void> {
    try {
      await this._redis.del(this._sessionKey(sessionId), this._clientKey(clientId));
    } catch {
      // Best-effort cleanup — TTL handles it otherwise
    }
  }

  private async _restoreExisting(
    clientId: ClientId,
    lastSeqFromClient: SequenceNumber,
  ): Promise<SessionData | null> {
    const existingSessionId = await this._redis.get(this._clientKey(clientId));
    if (existingSessionId === null) return null;

    const sessionId = existingSessionId as SessionId;
    const data = await this._redis.hgetall(this._sessionKey(sessionId));
    if (Object.keys(data).length === 0) return null;

    const session = this._deserialize(sessionId, data);

    // Trust client's lastSeq — take the min of what client reports and what
    // we have stored (client may have acked less than we stored)
    const serverLastSeq = session.lastDeliveredSeq as number;
    const clientLastSeq = lastSeqFromClient as number;
    const resolvedSeq = Math.min(serverLastSeq, clientLastSeq) as SequenceNumber;

    const updated: SessionData = {
      ...session,
      lastDeliveredSeq: resolvedSeq,
      lastActivityAt: Date.now(),
    };

    await this._persist(updated);
    return updated;
  }

  private async _persist(session: SessionData): Promise<void> {
    const key = this._sessionKey(session.sessionId);
    const pipeline = this._redis.pipeline();
    pipeline.hset(key, {
      clientId: session.clientId as string,
      lastDeliveredSeq: String(session.lastDeliveredSeq as number),
      connectedAt: String(session.connectedAt),
      lastActivityAt: String(session.lastActivityAt),
    });
    pipeline.expire(key, this._ttlSeconds);
    pipeline.set(this._clientKey(session.clientId), session.sessionId as string, 'EX', this._ttlSeconds);
    await pipeline.exec();
  }

  private _deserialize(
    sessionId: SessionId,
    data: Record<string, string>,
  ): SessionData {
    return {
      sessionId,
      clientId: (data['clientId'] ?? '') as ClientId,
      lastDeliveredSeq: Number(data['lastDeliveredSeq'] ?? '0') as SequenceNumber,
      connectedAt: Number(data['connectedAt'] ?? '0'),
      lastActivityAt: Number(data['lastActivityAt'] ?? '0'),
    };
  }
}
