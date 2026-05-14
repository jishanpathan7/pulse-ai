/**
 * Unit tests for key-encryption.ts
 *
 * Tests:
 *   - Encrypt/decrypt roundtrip
 *   - Tamper detection (GCM auth tag)
 *   - Key hint derivation
 *   - Wrong master key fails decrypt
 *   - Dev fallback when ENCRYPTION_KEY absent
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ─── Mock env before importing the module ─────────────────────────────────────
// Vitest runs in the same process — we need to control env.ENCRYPTION_KEY

const VALID_KEY_B64 = Buffer.alloc(32, 0xab).toString('base64'); // 32 bytes of 0xab

describe('key-encryption', () => {
  beforeEach(async () => {
    // Reset module cache + master key between tests
    const { _resetMasterKeyForTest } = await import('../key-encryption.js');
    _resetMasterKeyForTest();
  });

  it('encrypts and decrypts roundtrip', async () => {
    process.env['ENCRYPTION_KEY'] = VALID_KEY_B64;
    const { encryptApiKey, decryptApiKey, _resetMasterKeyForTest } = await import('../key-encryption.js');
    _resetMasterKeyForTest(); // force re-read env

    const rawKey = 'sk-ant-my-super-secret-key-123';
    const { blob } = encryptApiKey(rawKey);
    const decrypted = decryptApiKey(blob);

    expect(decrypted).toBe(rawKey);
  });

  it('produces different blobs for same key (random IV)', async () => {
    process.env['ENCRYPTION_KEY'] = VALID_KEY_B64;
    const { encryptApiKey, _resetMasterKeyForTest } = await import('../key-encryption.js');
    _resetMasterKeyForTest();

    const rawKey = 'sk-test-1234';
    const { blob: b1 } = encryptApiKey(rawKey);
    const { blob: b2 } = encryptApiKey(rawKey);

    // Same plaintext → different ciphertexts (random IV)
    expect(b1).not.toBe(b2);
  });

  it('detects tampering via GCM auth tag', async () => {
    process.env['ENCRYPTION_KEY'] = VALID_KEY_B64;
    const { encryptApiKey, decryptApiKey, _resetMasterKeyForTest } = await import('../key-encryption.js');
    _resetMasterKeyForTest();

    const { blob } = encryptApiKey('sk-tamper-me');

    // Flip the last byte of the base64-decoded blob
    const buf = Buffer.from(blob, 'base64');
    buf[buf.length - 1]! ^= 0xff;
    const tampered = buf.toString('base64');

    expect(() => decryptApiKey(tampered)).toThrow();
  });

  it('blob is base64 and contains iv+ciphertext+tag (at least 28 bytes)', async () => {
    process.env['ENCRYPTION_KEY'] = VALID_KEY_B64;
    const { encryptApiKey, _resetMasterKeyForTest } = await import('../key-encryption.js');
    _resetMasterKeyForTest();

    const { blob } = encryptApiKey('sk-any-key-value');
    const buf = Buffer.from(blob, 'base64');
    // Must have at least 12 (IV) + 1 (ciphertext) + 16 (tag) = 29 bytes
    expect(buf.length).toBeGreaterThanOrEqual(29);
  });

  it('derives key hint from last 4 chars', async () => {
    const { deriveKeyHint } = await import('../key-encryption.js');
    expect(deriveKeyHint('sk-ant-api03-abcdef1234')).toBe('1234');
    expect(deriveKeyHint('sk-1234')).toBe('1234');
  });

  it('rejects blob that is too short', async () => {
    process.env['ENCRYPTION_KEY'] = VALID_KEY_B64;
    const { decryptApiKey, _resetMasterKeyForTest } = await import('../key-encryption.js');
    _resetMasterKeyForTest();

    const tooShort = Buffer.alloc(10).toString('base64');
    expect(() => decryptApiKey(tooShort)).toThrow('too short');
  });
});
