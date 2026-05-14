/**
 * keys routes — BYOK key management.
 *
 * POST   /keys                  — add + validate key, encrypt, store
 * GET    /keys                  — list active keys (masked, no encrypted_key)
 * DELETE /keys/:id              — soft-delete (set revoked_at)
 * POST   /keys/:id/validate     — re-validate key, update is_valid
 * PATCH  /keys/:id              — update nickname only
 * GET    /keys/:id/models       — list models (24h model cache)
 * GET    /providers             — public, all active provider_definitions
 *
 * Security:
 *   - All mutating key routes: preHandler authenticate
 *   - Ownership enforced in SQL with AND user_id = $userId (returns 404 if absent)
 *   - encrypted_key never returned in responses
 *   - rawKey in POST /keys body is handled inside the route, never forwarded
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import type { JwtPayload } from '../middleware/authenticate.js';
import { encryptApiKey, decryptApiKey, deriveKeyHint } from '../services/key-encryption.js';
import { providerRegistry } from '../services/providers/registry.js';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const AddKeySchema = z.object({
  providerId: z.string().min(1).max(64),
  rawKey: z.string().min(1).max(512),
  nickname: z.string().min(1).max(100).optional(),
});

const PatchKeySchema = z.object({
  nickname: z.string().min(1).max(100).nullable(),
});

// ─── DB row types ─────────────────────────────────────────────────────────────

interface KeyRow {
  id: string;
  user_id: string;
  provider_id: string;
  display_name: string;
  key_hint: string;
  nickname: string | null;
  is_valid: boolean;
  last_validated_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
}

function formatKey(row: KeyRow) {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.display_name,
    keyHint: row.key_hint,
    nickname: row.nickname,
    isValid: row.is_valid,
    lastValidatedAt: row.last_validated_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

// ─── Audit helper ─────────────────────────────────────────────────────────────

async function writeAudit(
  app: FastifyInstance,
  params: {
    userId: string;
    keyId?: string | null;
    providerId: string;
    event: string;
    meta?: Record<string, unknown>;
    ip?: string;
  },
): Promise<void> {
  try {
    await app.db.query(
      `INSERT INTO api_key_audit_log (user_id, key_id, provider_id, event, meta, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.userId,
        params.keyId ?? null,
        params.providerId,
        params.event,
        params.meta ? JSON.stringify(params.meta) : null,
        params.ip ?? null,
      ],
    );
  } catch (e) {
    app.log.warn({ err: e }, '[keys] Failed to write audit log');
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function keysRoutes(app: FastifyInstance): Promise<void> {

  // ── GET /providers — public catalogue ────────────────────────────────────────

  app.get('/providers', async (_req, reply) => {
    const { rows } = await app.db.query(
      `SELECT id, display_name, base_url, key_prefix, docs_url, is_active
         FROM provider_definitions
        WHERE is_active = TRUE
        ORDER BY display_name`,
    );
    return reply.send({ providers: rows });
  });

  // ── POST /keys — add key ──────────────────────────────────────────────────────

  app.post('/keys', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const user = req.user as JwtPayload;
    const parsed = AddKeySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { providerId, rawKey, nickname } = parsed.data;

    // Verify provider exists
    const { rows: providers } = await app.db.query(
      `SELECT id, display_name, key_prefix FROM provider_definitions WHERE id = $1 AND is_active = TRUE`,
      [providerId],
    );
    if (providers.length === 0) {
      return reply.status(422).send({ error: `Unknown provider: ${providerId}` });
    }
    const provider = providers[0] as { id: string; display_name: string; key_prefix: string | null };

    // Quick format check against known prefix
    if (provider.key_prefix && !rawKey.startsWith(provider.key_prefix)) {
      return reply.status(422).send({
        error: `Key does not match expected format for ${provider.display_name}. Expected prefix: ${provider.key_prefix}`,
      });
    }

    // Validate against provider API
    const adapter = providerRegistry.get(providerId);
    if (!adapter) {
      return reply.status(503).send({ error: 'Provider adapter not available' });
    }

    let isValid = false;
    let validationError: string | null = null;

    try {
      const result = await adapter.validate(rawKey);
      isValid = result.valid;
      validationError = result.error ?? null;
    } catch {
      validationError = 'network_error';
    }

    if (!isValid) {
      await writeAudit(app, {
        userId: user.sub, providerId,
        event: 'key_validation_failed',
        meta: { error: validationError },
        ip: req.ip,
      });
      return reply.status(422).send({
        error: 'Key validation failed',
        code: validationError ?? 'auth_failed',
      });
    }

    // Encrypt and store
    const { blob } = encryptApiKey(rawKey);
    const keyHint = deriveKeyHint(rawKey);

    // Upsert: revoke existing key for this provider first, then insert new one
    const client = await app.db.connect();
    let keyId: string;
    try {
      await client.query('BEGIN');

      // Soft-revoke any existing active key for this provider
      await client.query(
        `UPDATE user_api_keys
            SET revoked_at = NOW(), updated_at = NOW()
          WHERE user_id = $1 AND provider_id = $2 AND revoked_at IS NULL`,
        [user.sub, providerId],
      );

      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO user_api_keys
           (user_id, provider_id, encrypted_key, key_hint, nickname, is_valid, last_validated_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
         RETURNING id`,
        [user.sub, providerId, blob, keyHint, nickname ?? null],
      );

      keyId = inserted[0]!.id;
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    await writeAudit(app, { userId: user.sub, keyId, providerId, event: 'key_added', ip: req.ip });

    const { rows: keyRows } = await app.db.query<KeyRow>(
      `SELECT k.id, k.user_id, k.provider_id, p.display_name, k.key_hint, k.nickname,
              k.is_valid, k.last_validated_at, k.last_used_at, k.created_at
         FROM user_api_keys k
         JOIN provider_definitions p ON p.id = k.provider_id
        WHERE k.id = $1`,
      [keyId],
    );

    return reply.status(201).send({ key: formatKey(keyRows[0]!) });
  });

  // ── GET /keys — list active keys ──────────────────────────────────────────────

  app.get('/keys', { preHandler: authenticate }, async (req, reply) => {
    const user = req.user as JwtPayload;

    const { rows } = await app.db.query<KeyRow>(
      `SELECT k.id, k.user_id, k.provider_id, p.display_name, k.key_hint, k.nickname,
              k.is_valid, k.last_validated_at, k.last_used_at, k.created_at
         FROM user_api_keys k
         JOIN provider_definitions p ON p.id = k.provider_id
        WHERE k.user_id = $1 AND k.revoked_at IS NULL
        ORDER BY k.created_at DESC`,
      [user.sub],
    );

    return reply.send({ keys: rows.map(formatKey) });
  });

  // ── DELETE /keys/:id — soft-delete ────────────────────────────────────────────

  app.delete<{ Params: { id: string } }>('/keys/:id', { preHandler: authenticate }, async (req, reply) => {
    const user = req.user as JwtPayload;
    const { id } = req.params;

    const { rows } = await app.db.query<{ provider_id: string }>(
      `UPDATE user_api_keys
          SET revoked_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
        RETURNING provider_id`,
      [id, user.sub],
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    await writeAudit(app, { userId: user.sub, keyId: id, providerId: rows[0]!.provider_id, event: 'key_deleted', ip: req.ip });

    return reply.status(204).send();
  });

  // ── POST /keys/:id/validate — re-validate ────────────────────────────────────

  app.post<{ Params: { id: string } }>('/keys/:id/validate', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const user = req.user as JwtPayload;
    const { id } = req.params;

    const { rows } = await app.db.query<{ encrypted_key: string; provider_id: string }>(
      `SELECT encrypted_key, provider_id
         FROM user_api_keys
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [id, user.sub],
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    const row = rows[0]!;
    const adapter = providerRegistry.get(row.provider_id);
    if (!adapter) {
      return reply.status(503).send({ error: 'Provider adapter not available' });
    }

    let isValid = false;
    let validationError: string | null = null;

    try {
      const rawKey = decryptApiKey(row.encrypted_key);
      const result = await adapter.validate(rawKey);
      isValid = result.valid;
      validationError = result.error ?? null;
    } catch {
      validationError = 'decryption_error';
    }

    await app.db.query(
      `UPDATE user_api_keys
          SET is_valid = $1,
              last_validated_at = NOW(),
              validation_error = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [isValid, validationError, id],
    );

    const auditMeta = validationError ? { error: validationError } : undefined;
    await writeAudit(app, {
      userId: user.sub, keyId: id, providerId: row.provider_id,
      event: isValid ? 'key_validated' : 'key_validation_failed',
      ...(auditMeta !== undefined ? { meta: auditMeta } : {}),
      ip: req.ip,
    });

    return reply.send({ valid: isValid, error: validationError ?? undefined });
  });

  // ── PATCH /keys/:id — update nickname ────────────────────────────────────────

  app.patch<{ Params: { id: string } }>('/keys/:id', { preHandler: authenticate }, async (req, reply) => {
    const user = req.user as JwtPayload;
    const { id } = req.params;

    const parsed = PatchKeySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { nickname } = parsed.data;

    const { rows } = await app.db.query<{ id: string }>(
      `UPDATE user_api_keys
          SET nickname = $1, updated_at = NOW()
        WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL
        RETURNING id`,
      [nickname, id, user.sub],
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    return reply.send({ ok: true });
  });

  // ── GET /keys/:id/models — list models (with 24h cache) ─────────────────────

  app.get<{ Params: { id: string } }>('/keys/:id/models', {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const user = req.user as JwtPayload;
    const { id } = req.params;

    // Check key ownership
    const { rows: keyRows } = await app.db.query<{ encrypted_key: string; provider_id: string }>(
      `SELECT encrypted_key, provider_id
         FROM user_api_keys
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [id, user.sub],
    );

    if (keyRows.length === 0) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    const { provider_id: providerId, encrypted_key } = keyRows[0]!;

    // Check model cache (24h TTL)
    const { rows: cached } = await app.db.query<{ models: unknown; fetched_at: Date }>(
      `SELECT models, fetched_at
         FROM provider_model_cache
        WHERE provider_id = $1 AND user_id = $2 AND expires_at > NOW()`,
      [providerId, user.sub],
    );

    if (cached.length > 0) {
      return reply.send({ providerId, models: cached[0]!.models, cachedAt: cached[0]!.fetched_at });
    }

    // Fetch fresh from provider
    const adapter = providerRegistry.get(providerId);
    if (!adapter) {
      return reply.status(503).send({ error: 'Provider adapter not available' });
    }

    let models;
    try {
      const rawKey = decryptApiKey(encrypted_key);
      models = await adapter.listModels(rawKey);
    } catch (e) {
      app.log.warn({ err: e, providerId }, '[keys] Failed to fetch models');
      return reply.status(503).send({ error: 'Failed to fetch models from provider' });
    }

    // Upsert cache
    await app.db.query(
      `INSERT INTO provider_model_cache (provider_id, user_id, models, fetched_at, expires_at)
       VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '24 hours')
       ON CONFLICT (provider_id, user_id) DO UPDATE
         SET models = EXCLUDED.models,
             fetched_at = NOW(),
             expires_at = NOW() + INTERVAL '24 hours'`,
      [providerId, user.sub, JSON.stringify(models)],
    );

    return reply.send({ providerId, models, cachedAt: new Date() });
  });
}
