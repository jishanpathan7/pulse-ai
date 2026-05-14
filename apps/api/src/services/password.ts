/**
 * password.ts — scrypt-based password hashing.
 *
 * Uses Node built-in crypto.scrypt — no external dep.
 * Format: "scrypt$N$r$p$salt$hash" (all base64url encoded)
 *
 * Parameters (OWASP 2024 recommended):
 *   N = 131072 (2^17), r = 8, p = 1, keylen = 64 bytes
 */

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 131_072; // CPU/memory cost
const r = 8;       // block size
const p = 1;       // parallelism
const KEYLEN = 64; // output bytes
const SALT_BYTES = 32;

// maxmem: N * r * 128 bytes + headroom. Default Node limit is 32MB; N=131072 needs ~128MB.
const SCRYPT_MAXMEM = 256 * 1024 * 1024; // 256MB

function scryptAsync(
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { ...options, maxmem: SCRYPT_MAXMEM }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, KEYLEN, { N, r, p });
  return [
    'scrypt',
    N,
    r,
    p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, costN, costR, costP, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64 as string, 'base64url');
  const expected = Buffer.from(hashB64 as string, 'base64url');

  try {
    const actual = await scryptAsync(password, salt, KEYLEN, {
      N: parseInt(costN as string, 10),
      r: parseInt(costR as string, 10),
      p: parseInt(costP as string, 10),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
