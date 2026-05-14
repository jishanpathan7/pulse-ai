/**
 * conversations routes
 *
 * POST   /conversations                  — create new conversation
 * GET    /conversations                  — list user's conversations (newest first, pinned first)
 * GET    /conversations/:id/messages     — load full message history
 * POST   /conversations/:id/messages     — bulk-save messages (used by browser-side AI providers)
 * PATCH  /conversations/:id              — rename title and/or toggle pinned
 * DELETE /conversations/:id              — soft-delete
 *
 * All routes require authentication (pulse_access cookie or Bearer token).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import type { JwtPayload } from '../middleware/authenticate.js';

const CreateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
});

const SaveMessagesSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(200_000),
    token_count: z.number().int().nonnegative().optional(),
  })).min(1).max(100),
});

const PatchConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  pinned: z.boolean().optional(),
});

export async function conversationRoutes(app: FastifyInstance): Promise<void> {

  // ── Create conversation ────────────────────────────────────────────────────

  app.post('/conversations', { preHandler: authenticate }, async (req, reply) => {
    const user = req.user as JwtPayload;
    const parsed = CreateConversationSchema.safeParse(req.body);
    const title = (parsed.success ? parsed.data.title : undefined) ?? 'New session';

    const { rows } = await app.db.query<{ id: string; title: string; created_at: Date; pinned: boolean }>(
      `INSERT INTO conversations (user_id, title)
       VALUES ($1, $2)
       RETURNING id, title, created_at, pinned`,
      [user.sub, title],
    );

    const conv = rows[0];
    if (!conv) return reply.status(500).send({ error: 'Failed to create conversation' });
    return reply.status(201).send({ conversation: conv });
  });

  // ── List conversations ─────────────────────────────────────────────────────

  app.get('/conversations', { preHandler: authenticate }, async (req, reply) => {
    const user = req.user as JwtPayload;

    const { rows } = await app.db.query<{
      id: string; title: string; created_at: Date; message_count: string; pinned: boolean;
    }>(
      `SELECT c.id, c.title, c.created_at, c.pinned,
              COUNT(m.id)::text AS message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.user_id = $1
         AND c.deleted_at IS NULL
       GROUP BY c.id
       ORDER BY c.pinned DESC, c.created_at DESC
       LIMIT 50`,
      [user.sub],
    );

    return reply.send({ conversations: rows });
  });

  // ── Get messages ───────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/conversations/:id/messages',
    { preHandler: authenticate },
    async (req, reply) => {
      const user = req.user as JwtPayload;
      const { id } = req.params;

      const { rows: conv } = await app.db.query<{ id: string }>(
        'SELECT id FROM conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [id, user.sub],
      );
      if (conv.length === 0) return reply.status(404).send({ error: 'Conversation not found' });

      const { rows } = await app.db.query<{
        id: string; role: string; content: string;
        token_count: number; created_at: Date; completed_at: Date | null;
      }>(
        `SELECT id, role, content, token_count, created_at, completed_at
         FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [id],
      );

      return reply.send({ messages: rows });
    },
  );

  // ── Save messages (browser-side AI providers: Ollama, Demo, SSE) ──────────
  // WS path saves server-side in ai-stream-handler. All other providers POST
  // here after each turn so history survives refresh/session-switch.

  app.post<{ Params: { id: string } }>(
    '/conversations/:id/messages',
    { preHandler: authenticate, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = req.user as JwtPayload;
      const { id } = req.params;

      const parsed = SaveMessagesSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', issues: parsed.error.issues });

      // Upsert conversation (ensures row exists even if created only on frontend)
      await app.db.query(
        `INSERT INTO conversations (id, user_id, title)
         VALUES ($1, $2, 'New session')
         ON CONFLICT (id) DO NOTHING`,
        [id, user.sub],
      );

      // Verify ownership
      const { rows: conv } = await app.db.query<{ id: string }>(
        'SELECT id FROM conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [id, user.sub],
      );
      if (conv.length === 0) return reply.status(404).send({ error: 'Conversation not found' });

      // Insert messages in order
      for (const msg of parsed.data.messages) {
        await app.db.query(
          `INSERT INTO messages (conversation_id, role, content, token_count, completed_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [id, msg.role, msg.content, msg.token_count ?? 0],
        );
      }

      return reply.status(201).send({ ok: true, count: parsed.data.messages.length });
    },
  );

  // ── Patch conversation (rename / pin) ──────────────────────────────────────

  app.patch<{ Params: { id: string } }>(
    '/conversations/:id',
    { preHandler: authenticate },
    async (req, reply) => {
      const user = req.user as JwtPayload;
      const { id } = req.params;
      const parsed = PatchConversationSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid body' });

      const { title, pinned } = parsed.data;
      if (title === undefined && pinned === undefined) {
        return reply.status(400).send({ error: 'Provide title or pinned' });
      }

      // Build SET clause dynamically
      const setClauses: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [id, user.sub];
      if (title !== undefined) { values.push(title); setClauses.push(`title = $${values.length}`); }
      if (pinned !== undefined) { values.push(pinned); setClauses.push(`pinned = $${values.length}`); }

      const { rows } = await app.db.query<{ id: string; title: string; pinned: boolean }>(
        `UPDATE conversations
         SET ${setClauses.join(', ')}
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING id, title, pinned`,
        values,
      );

      if (rows.length === 0) return reply.status(404).send({ error: 'Conversation not found' });
      return reply.send({ conversation: rows[0] });
    },
  );

  // ── Delete conversation (soft) ─────────────────────────────────────────────

  app.delete<{ Params: { id: string } }>(
    '/conversations/:id',
    { preHandler: authenticate },
    async (req, reply) => {
      const user = req.user as JwtPayload;
      const { id } = req.params;

      const { rowCount } = await app.db.query(
        `UPDATE conversations
         SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [id, user.sub],
      );

      if (rowCount === 0) return reply.status(404).send({ error: 'Conversation not found' });
      return reply.status(204).send();
    },
  );
}
