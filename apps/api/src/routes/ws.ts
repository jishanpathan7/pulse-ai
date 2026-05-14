/**
 * ws route — WebSocket handler for realtime token streaming.
 *
 * Protocol (client → server):
 *   1. Client connects to /ws
 *   2. Client sends: { type: 'handshake', clientId, lastSeq, protocolVersion }
 *   3. Server responds: { type: 'handshake_ack', sessionId, serverTimestamp, ... }
 *   4. If resuming: server replays messages (lastSeq+1 → latest)
 *   5. Client sends stream_request → server streams tokens via WS
 *   6. Client sends ping → server responds pong
 *   7. Client sends replay_request → server sends replay_chunk
 *   8. Client sends stream_cancel → server aborts active stream
 *
 * Server → Client (sequenced messages):
 *   stream_start, token, stream_end, stream_error
 *
 * Server → Client (control messages, no seq):
 *   handshake_ack, pong, replay_chunk
 *
 * Security:
 *   - Handshake timeout: 5s. Connection closed if no handshake received.
 *   - Max message size enforced by @fastify/websocket options (64KB default).
 *   - One active stream per session (concurrent streams not supported in Phase 9).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { env } from '../env.js';
import { authenticate } from '../middleware/authenticate.js';
import type { JwtPayload } from '../middleware/authenticate.js';
import type {
  ClientMessage,
  ClientId,
  SequenceNumber,
  StreamId,
} from '@pulse/types/transport';
import { PROTOCOL_VERSION } from '@pulse/types/transport';
import { SequenceAuthority } from '../transport/sequence-authority.js';
import { SessionStore } from '../transport/session-store.js';
import { ReplayBuffer } from '../transport/replay-buffer.js';
import { ConnectionManager } from '../transport/connection-manager.js';
import type { SessionId } from '@pulse/types/transport';
import { handleAiStream } from '../services/ai-stream-handler.js';
import type { Connection } from '../transport/connection-manager.js';

// ─── Shared singletons (alive for server lifetime) ───────────────────────────

const connections = new ConnectionManager();

// ─── Route ────────────────────────────────────────────────────────────────────

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  // Per-app singletons backed by Redis
  const sessions = new SessionStore(app.redis, {
    ttlSeconds: env.WS_REPLAY_TTL_SECONDS,
  });
  const replay = new ReplayBuffer(app.redis, {
    ttlSeconds: env.WS_REPLAY_TTL_SECONDS,
  });

  app.get('/ws', { websocket: true, preHandler: authenticate }, (socket: WebSocket, req: FastifyRequest) => {
    const jwtUser = req.user as JwtPayload;
    const userId = jwtUser.sub;

    let sessionId: SessionId | null = null;
    let authority: SequenceAuthority | null = null;
    let activeStreamController: AbortController | null = null;

    // ── Handshake timeout ────────────────────────────────────────────────────
    const HANDSHAKE_TIMEOUT_MS = 5_000;
    const handshakeTimer = setTimeout(() => {
      if (sessionId === null) {
        app.log.warn('[ws] Handshake timeout — closing connection');
        socket.close(4001, 'Handshake timeout');
      }
    }, HANDSHAKE_TIMEOUT_MS);

    // ── Send helpers ─────────────────────────────────────────────────────────

    function send(data: object): void {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(data));
      }
    }

    // ── Message handler ───────────────────────────────────────────────────────

    socket.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        app.log.warn('[ws] Unparseable message — ignoring');
        return;
      }

      switch (msg.type) {

        // ── Handshake ───────────────────────────────────────────────────────
        case 'handshake': {
          clearTimeout(handshakeTimer);

          if (msg.protocolVersion !== PROTOCOL_VERSION) {
            send({ type: 'error', code: 'PROTOCOL_MISMATCH', message: `Expected v${PROTOCOL_VERSION}` });
            socket.close(4002, 'Protocol version mismatch');
            return;
          }

          const result = await sessions.openSession(
            msg.clientId as ClientId,
            msg.lastSeq as SequenceNumber,
          );

          if (!result.ok) {
            app.log.error({ err: result.error }, '[ws] Failed to open session');
            socket.close(4003, 'Session error');
            return;
          }

          const session = result.value;
          sessionId = session.sessionId;
          authority = new SequenceAuthority(sessionId, session.lastDeliveredSeq);

          // Register connection
          const conn: Connection = {
            sessionId,
            send: (data) => send(JSON.parse(data) as object),
            close: (code, reason) => socket.close(code, reason),
            connectedAt: Date.now(),
            remoteAddress: 'ws',
          };
          connections.register(conn);

          // handshake_ack
          send({
            type: 'handshake_ack',
            sessionId,
            serverTimestamp: Date.now(),
            protocolVersion: PROTOCOL_VERSION,
            resumedFromSeq: session.lastDeliveredSeq,
          });

          app.log.info({ sessionId, clientId: msg.clientId }, '[ws] Session opened');

          // Replay missed messages if resuming
          if ((session.lastDeliveredSeq as number) > 0) {
            const highestResult = await replay.highestSeq(sessionId);
            if (highestResult.ok && highestResult.value !== null) {
              const fromSeq = ((session.lastDeliveredSeq as number) + 1) as SequenceNumber;
              const toSeq = highestResult.value;
              if ((fromSeq as number) <= (toSeq as number)) {
                const replayResult = await replay.query(sessionId, fromSeq, toSeq);
                if (replayResult.ok && replayResult.value.length > 0) {
                  send({
                    type: 'replay_chunk',
                    requestFromSeq: fromSeq,
                    requestToSeq: toSeq,
                    messages: replayResult.value,
                    isLast: true,
                  });
                  app.log.info(
                    { sessionId, fromSeq, toSeq, count: replayResult.value.length },
                    '[ws] Replayed messages on reconnect',
                  );
                }
              }
            }
          }

          break;
        }

        // ── Ping ────────────────────────────────────────────────────────────
        case 'ping': {
          send({ type: 'pong', clientTimestamp: msg.clientTimestamp, serverTimestamp: Date.now() });
          break;
        }

        // ── Stream request ──────────────────────────────────────────────────
        case 'stream_request': {
          if (sessionId === null || authority === null) {
            app.log.warn('[ws] stream_request before handshake');
            return;
          }

          // Validate messages array
          const rawMessages = msg.messages;
          if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
            send({ type: 'error', code: 'INVALID_REQUEST', message: 'messages required' });
            return;
          }
          const validRoles = new Set(['user', 'assistant']);
          const validMessages = (rawMessages as Array<{ role: string; content: string }>)
            .filter((m) => validRoles.has(m.role) && typeof m.content === 'string' && m.content.length > 0)
            .slice(0, 40); // cap at 40 messages server-side too
          if (validMessages.length === 0) {
            send({ type: 'error', code: 'INVALID_REQUEST', message: 'no valid messages' });
            return;
          }
          // Guard against absurdly large payloads (>500k chars total ≈ ~125k tokens)
          const totalChars = validMessages.reduce((sum, m) => sum + m.content.length, 0);
          if (totalChars > 500_000) {
            send({ type: 'error', code: 'PAYLOAD_TOO_LARGE', message: 'Message history too large' });
            return;
          }

          // Cancel any in-progress stream
          if (activeStreamController !== null) {
            activeStreamController.abort();
          }

          const streamController = new AbortController();
          activeStreamController = streamController;
          const currentSessionId = sessionId;
          const currentAuthority = authority;

          app.log.info({ sessionId, streamId: msg.streamId, messageCount: validMessages.length }, '[ws] Starting AI stream');

          // Run stream in background — do not await (would block message handler)
          void handleAiStream(
            {
              sessionId: currentSessionId,
              streamId: msg.streamId as StreamId,
              conversationId: msg.conversationId,
              userId,
              messages: validMessages as Array<{ role: 'user' | 'assistant'; content: string }>,
              ...(msg.model !== undefined ? { model: msg.model } : {}),
              ...(msg.maxTokens !== undefined ? { maxTokens: msg.maxTokens } : {}),
              ...(msg.systemPrompt !== undefined ? { systemPrompt: msg.systemPrompt } : {}),
              ...(msg.keyId !== undefined ? { keyId: msg.keyId } : {}),
            },
            {
              authority: currentAuthority,
              connections,
              replay,
              sessions,
              db: app.db,
              signal: streamController.signal,
            },
          ).finally(() => {
            if (activeStreamController === streamController) {
              activeStreamController = null;
            }
          });

          break;
        }

        // ── Stream cancel ───────────────────────────────────────────────────
        case 'stream_cancel': {
          if (activeStreamController !== null) {
            activeStreamController.abort();
            activeStreamController = null;
            app.log.info({ sessionId, streamId: msg.streamId }, '[ws] Stream cancelled');
          }
          break;
        }

        // ── Replay request ──────────────────────────────────────────────────
        case 'replay_request': {
          if (sessionId === null) return;

          const result = await replay.query(
            sessionId,
            msg.fromSeq as SequenceNumber,
            msg.toSeq as SequenceNumber,
          );

          if (result.ok) {
            send({
              type: 'replay_chunk',
              requestFromSeq: msg.fromSeq,
              requestToSeq: msg.toSeq,
              messages: result.value,
              isLast: true,
            });
          }
          break;
        }

        // ── Ack ─────────────────────────────────────────────────────────────
        case 'ack': {
          // Client acknowledges delivery — update lastDeliveredSeq
          if (sessionId !== null) {
            await sessions.updateLastSeq(sessionId, msg.seq as SequenceNumber);
          }
          break;
        }
      }
    });

    // ── Close handler ─────────────────────────────────────────────────────────

    socket.on('close', async (code) => {
      clearTimeout(handshakeTimer);

      // Abort any in-progress stream
      if (activeStreamController !== null) {
        activeStreamController.abort();
        activeStreamController = null;
      }

      if (sessionId !== null) {
        connections.deregister(sessionId);
        app.log.info({ sessionId, code }, '[ws] Connection closed — session preserved in Redis');
      }
    });

    socket.on('error', (err) => {
      app.log.error({ err, sessionId }, '[ws] Socket error');
    });
  });
}
