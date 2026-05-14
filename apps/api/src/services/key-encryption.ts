/**
 * key-encryption.ts — AES-256-GCM encryption for user API keys.
 *
 * Blob format: base64(iv[12] || ciphertext[N] || authTag[16])
 *
 * Security invariants:
 *   - Per-key random IV (never reused).
 *   - GCM auth tag verification on decrypt — catches tampering before key is used.
 *   - `decryptApiKey` must never be called in response-path code that serialises output.
 *   - Raw key is never logged; Fastify serializer redacts known field names (see main.ts).
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { env } from '../env.js';

const IV_BYTES = 12;    // 96-bit IV — recommended for GCM
const TAG_BYTES = 16;   // 128-bit auth tag
const ALGORITHM = 'aes-256-gcm' as const;

// ─── Master key ───────────────────────────────────────────────────────────────

let _masterKey: Buffer | null = null;

export function getMasterKey(): Buffer {
  if (_masterKey) return _masterKey;

  if (!env.ENCRYPTION_KEY) {
    if (env.NODE_ENV === 'production') {
      // env.ts refine should have caught this, but be defensive
      throw new Error('ENCRYPTION_KEY is required in production');
    }
    // Dev fallback — fixed 32-byte key, logged clearly as insecure
    console.warn(
      '[key-encryption] ENCRYPTION_KEY not set — using insecure dev fallback. ' +
        'Generate a real key: openssl rand -base64 32',
    );
    _masterKey = Buffer.alloc(32, 0); // all-zero key for dev
    return _masterKey;
  }

  const decoded = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (decoded.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${decoded.length}). ` +
        'Generate with: openssl rand -base64 32',
    );
  }

  _masterKey = decoded;
  return _masterKey;
}

// ─── Encrypt ──────────────────────────────────────────────────────────────────

export function encryptApiKey(rawKey: string): { blob: string } {
  const masterKey = getMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);

  const ciphertext = Buffer.concat([cipher.update(rawKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Concatenate: iv || ciphertext || authTag
  const blob = Buffer.concat([iv, ciphertext, tag]).toString('base64');
  return { blob };
}

// ─── Decrypt ──────────────────────────────────────────────────────────────────

export function decryptApiKey(blob: string): string {
  const masterKey = getMasterKey();
  const buf = Buffer.from(blob, 'base64');

  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('Encrypted key blob is too short — corrupted data');
  }

  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(tag);

  // GCM auth tag verification — throws if blob was tampered with
  const rawKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return rawKey;
}

// ─── Key hint ─────────────────────────────────────────────────────────────────

/** Returns the last 4 characters of the raw key for display ("...XXXX"). */
export function deriveKeyHint(rawKey: string): string {
  return rawKey.slice(-4);
}

// ─── Reset (test only) ───────────────────────────────────────────────────────

/** Clears cached master key. Used in tests to swap keys between test cases. */
export function _resetMasterKeyForTest(): void {
  _masterKey = null;
}
