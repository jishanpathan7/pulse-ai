/**
 * stream route — SSE proxy to AI providers (platform Anthropic or BYOK).
 *
 * POST /stream
 *   Body: { messages, model?, maxTokens?, systemPrompt?, keyId? }
 *   Response: text/event-stream
 *     data: {"type":"token","token":"..."}
 *     data: {"type":"done"}
 *     data: {"type":"error","code":"...","message":"..."}
 *
 * When keyId is provided, resolves the user's stored BYOK key and streams
 * through the appropriate ProviderAdapter. Falls back to platform Anthropic
 * key when keyId is absent.
 */

import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { authenticate } from '../middleware/authenticate.js';
import type { JwtPayload } from '../middleware/authenticate.js';
import { resolveStreamClient } from '../services/stream-resolver.js';

interface StreamBody {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  keyId?: string;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;

export async function streamRoutes(app: FastifyInstance): Promise<void> {

  app.post<{ Body: StreamBody }>('/stream', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const user = req.user as JwtPayload;
    const { messages, model, maxTokens, systemPrompt, keyId } = req.body ?? {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({ error: 'messages required' });
    }

    // Split system prompt from conversation messages
    const system = systemPrompt ?? messages.find((m) => m.role === 'system')?.content;
    const conversation = messages.filter(
      (m): m is { role: 'user' | 'assistant'; content: string } => m.role !== 'system',
    );

    if (conversation.length === 0) {
      return reply.status(400).send({ error: 'no user/assistant messages' });
    }

    // Resolve streaming backend
    const client = await resolveStreamClient(app.db, user.sub, keyId);
    if (!client) {
      return reply.status(503).send({
        error: keyId
          ? 'BYOK key not found or has been revoked'
          : 'No AI provider configured. Add an API key or configure ANTHROPIC_API_KEY.',
      });
    }

    reply.raw.writeHead(200, {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (data: object): void => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // ── BYOK path ──────────────────────────────────────────────────────────────
    if (client.type === 'byok') {
      const { adapter, rawKey, keyId: resolvedKeyId } = client;
      let totalTokens = 0;
      let errored = false;

      try {
        const eventStream = adapter.stream(rawKey, {
          messages: conversation,
          model: model ?? DEFAULT_MODEL,
          maxTokens: maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(system !== undefined ? { systemPrompt: system } : {}),
        });

        for await (const event of eventStream) {
          if (event.type === 'token') {
            send({ type: 'token', token: event.token });
          } else if (event.type === 'done') {
            totalTokens = event.totalTokens;
            send({ type: 'done' });
          } else if (event.type === 'error') {
            errored = true;
            send({ type: 'error', code: event.code, message: event.message });

            // Mark key invalid on auth failure
            if (event.code === 'auth_failed') {
              await app.db.query(
                `UPDATE user_api_keys SET is_valid = FALSE, validation_error = 'auth_failed', updated_at = NOW() WHERE id = $1`,
                [resolvedKeyId],
              );
            }
          }
        }
      } catch (e) {
        errored = true;
        app.log.error({ err: e, providerId: client.providerId }, '[stream] BYOK stream error');
        send({ type: 'error', code: 'network_error', message: 'Internal stream error' });
      } finally {
        // Update last_used_at + write audit
        try {
          await app.db.query(
            `UPDATE user_api_keys SET last_used_at = NOW() WHERE id = $1`,
            [resolvedKeyId],
          );
          await app.db.query(
            `INSERT INTO api_key_audit_log (user_id, key_id, provider_id, event, meta, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              user.sub, resolvedKeyId, client.providerId,
              errored ? 'stream_failed' : 'stream_completed',
              JSON.stringify({ totalTokens }),
              req.ip,
            ],
          );
        } catch { /* non-fatal */ }

        reply.raw.end();
      }
      return;
    }

    // ── Platform Anthropic path (unchanged) ────────────────────────────────────
    const anthropic = client.anthropic;

    try {
      const stream = anthropic.messages.stream({
        model:      model ?? DEFAULT_MODEL,
        max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(system !== undefined ? { system } : {}),
        messages:   conversation,
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          send({ type: 'token', token: event.delta.text });
        }
      }

      send({ type: 'done' });
    } catch (e) {
      const code =
        e instanceof Anthropic.APIError && e.status === 401 ? 'auth_failed'
        : e instanceof Anthropic.APIError && e.status === 429 ? 'rate_limited'
        : e instanceof Anthropic.APIError && e.status === 529 ? 'rate_limited'
        : 'model_error';

      send({ type: 'error', code, message: e instanceof Error ? e.message : 'Unknown error' });
      app.log.error({ err: e, code }, '[stream] Anthropic error');
    } finally {
      reply.raw.end();
    }
  });
}
