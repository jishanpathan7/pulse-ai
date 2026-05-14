/**
 * stream-resolver.ts — resolves which streaming backend to use per request.
 *
 * Returns:
 *   { type: 'platform', anthropic }  — use server-level Anthropic key
 *   { type: 'byok', adapter, rawKey, providerId, keyId } — use user's BYOK key
 *   null — no backend available (caller should 503)
 *
 * Security invariants:
 *   - decryptApiKey result (rawKey) is returned in the StreamClient object but
 *     must NOT be serialised in any HTTP response or log by the caller.
 *   - Ownership check enforced in SQL with AND user_id = $userId.
 *   - Revocation is checked per-request (no caching of decrypted keys).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import { decryptApiKey } from './key-encryption.js';
import { providerRegistry } from './providers/registry.js';
import type { ProviderAdapter } from './providers/types.js';
import { env } from '../env.js';

// Singleton platform client (null when ANTHROPIC_API_KEY not configured)
const platformAnthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

export type StreamClient =
  | { type: 'platform'; anthropic: Anthropic }
  | { type: 'byok'; adapter: ProviderAdapter; rawKey: string; providerId: string; keyId: string };

/**
 * Resolve which streaming client to use.
 *
 * @param db      Postgres pool
 * @param userId  Authenticated user ID
 * @param keyId   Optional BYOK key ID from request body
 *
 * When keyId is provided:
 *   - Fetches and verifies key ownership in one query
 *   - Decrypts key
 *   - Returns byok client
 *
 * When keyId is absent:
 *   - Falls back to platform Anthropic key (if configured)
 *   - Returns null if neither is available
 */
export async function resolveStreamClient(
  db: Pool,
  userId: string,
  keyId?: string | undefined,
): Promise<StreamClient | null> {
  if (keyId) {
    const result = await db.query<{
      encrypted_key: string;
      provider_id: string;
      is_valid: boolean;
    }>(
      `SELECT encrypted_key, provider_id, is_valid
         FROM user_api_keys
        WHERE id = $1
          AND user_id = $2
          AND revoked_at IS NULL`,
      [keyId, userId],
    );

    if (result.rowCount === 0) {
      return null; // Key not found or not owned by user → caller returns 404/503
    }

    const row = result.rows[0]!;

    if (!row.is_valid) {
      return null; // Key previously marked invalid
    }

    const adapter = providerRegistry.get(row.provider_id);
    if (!adapter) {
      return null; // Provider not registered (shouldn't happen with seeded data)
    }

    const rawKey = decryptApiKey(row.encrypted_key);
    return { type: 'byok', adapter, rawKey, providerId: row.provider_id, keyId };
  }

  // No keyId — fall back to platform key
  if (platformAnthropic) {
    return { type: 'platform', anthropic: platformAnthropic };
  }

  return null;
}
