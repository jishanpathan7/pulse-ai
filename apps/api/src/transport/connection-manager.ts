/**
 * ConnectionManager — tracks active WebSocket connections server-side.
 *
 * Responsibilities:
 *   - Register/deregister connections by sessionId
 *   - Look up active connection for a session (for server-initiated messages)
 *   - Broadcast to multiple sessions (future: multi-agent scenario)
 *   - Connection count metrics
 *
 * This is an in-memory registry. On server restart, all connections are lost
 * and clients reconnect. Session state (lastSeq) survives via Redis.
 *
 * WebSocket send is abstracted via SendFn to:
 *   - Enable testing without real WebSocket
 *   - Isolate Fastify/ws-specific types from this module
 *   - Allow future transport swap (e.g., QUIC)
 *
 * Implementation note:
 *   Multi-server fan-out (Phase 5+) requires Redis pub/sub:
 *   a message targeted at sessionId must be routed to whichever
 *   server holds that session's WebSocket. That routing is NOT here;
 *   this class only handles local connections.
 */

import type { SessionId } from '@pulse/types/transport';
import type { Result } from '@pulse/utils';
import { ok, err } from '@pulse/utils';
import type { PulseError } from '@pulse/types/errors';

export type SendFn = (data: string) => void;
export type CloseFn = (code?: number, reason?: string) => void;

export interface Connection {
  readonly sessionId: SessionId;
  readonly send: SendFn;
  readonly close: CloseFn;
  readonly connectedAt: number;
  readonly remoteAddress: string;
}

export interface ConnectionStats {
  readonly totalConnections: number;
  readonly connectionsByAge: ReadonlyArray<{ sessionId: SessionId; ageMs: number }>;
}

export class ConnectionManager {
  private readonly _connections = new Map<string, Connection>();

  register(connection: Connection): void {
    this._connections.set(connection.sessionId as string, connection);
  }

  deregister(sessionId: SessionId): void {
    this._connections.delete(sessionId as string);
  }

  get(sessionId: SessionId): Connection | null {
    return this._connections.get(sessionId as string) ?? null;
  }

  has(sessionId: SessionId): boolean {
    return this._connections.has(sessionId as string);
  }

  /**
   * Send a message to a specific session.
   * Returns Err if session is not connected to this server.
   */
  send(sessionId: SessionId, data: string): Result<void, PulseError> {
    const conn = this._connections.get(sessionId as string);
    if (conn === undefined) {
      return err({
        domain: 'TRANSPORT',
        code: 'TRANSPORT_CONNECTION_REFUSED',
        message: `No active connection for session: ${sessionId as string}`,
        retryable: false,
      });
    }

    conn.send(data);
    return ok(undefined);
  }

  /**
   * Send a message to all active connections.
   * Used for server-wide broadcasts (e.g., maintenance notice).
   */
  broadcast(data: string): void {
    for (const conn of this._connections.values()) {
      try {
        conn.send(data);
      } catch {
        // Individual send failure should not stop broadcast
      }
    }
  }

  /**
   * Close a specific session's connection.
   * Caller is responsible for deregistering after close.
   */
  closeSession(sessionId: SessionId, code?: number, reason?: string): Result<void, PulseError> {
    const conn = this._connections.get(sessionId as string);
    if (conn === undefined) {
      return err({
        domain: 'TRANSPORT',
        code: 'TRANSPORT_CONNECTION_REFUSED',
        message: `No active connection for session: ${sessionId as string}`,
        retryable: false,
      });
    }

    conn.close(code, reason);
    return ok(undefined);
  }

  get stats(): ConnectionStats {
    const now = Date.now();
    return {
      totalConnections: this._connections.size,
      connectionsByAge: Array.from(this._connections.values()).map((c) => ({
        sessionId: c.sessionId,
        ageMs: now - c.connectedAt,
      })),
    };
  }

  get size(): number {
    return this._connections.size;
  }
}
