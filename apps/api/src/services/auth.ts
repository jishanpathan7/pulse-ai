/**
 * auth service — register, login, refresh, logout business logic.
 *
 * Tokens:
 *   Access token  — JWT, 15min, httpOnly cookie + Authorization header
 *   Refresh token — random 48 bytes (base64url), 7 days, httpOnly cookie only
 *                   stored as SHA-256 hash in refresh_tokens table
 *
 * Refresh token rotation: on every /auth/refresh, old token is revoked
 * and a new one issued. Reuse of a revoked token invalidates ALL tokens
 * for that user (token theft detection).
 */

import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { hashPassword, verifyPassword } from './password.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  password_hash: string | null;
  created_at: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const ACCESS_TOKEN_TTL_S  = 15 * 60;         // 15 minutes
export const REFRESH_TOKEN_TTL_S = 7 * 24 * 60 * 60; // 7 days

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function registerUser(
  db: pg.Pool,
  app: FastifyInstance,
  input: { email: string; password: string; displayName?: string | undefined },
): Promise<TokenPair> {
  const email = input.email.toLowerCase().trim();

  // Check for existing user
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [email],
  );
  if (existing.rows.length > 0) {
    throw Object.assign(new Error('Email already registered'), { code: 'EMAIL_EXISTS', statusCode: 409 });
  }

  const passwordHash = await hashPassword(input.password);

  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, email, display_name, created_at`,
    [email, passwordHash, input.displayName ?? null],
  );

  const user = rows[0];
  if (!user) throw new Error('Failed to create user');

  return issueTokenPair(db, app, user);
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function loginUser(
  db: pg.Pool,
  app: FastifyInstance,
  input: { email: string; password: string; userAgent?: string | undefined; ipAddress?: string | undefined },
): Promise<TokenPair> {
  const email = input.email.toLowerCase().trim();

  const { rows } = await db.query<UserRow>(
    'SELECT id, email, display_name, password_hash, created_at FROM users WHERE email = $1',
    [email],
  );

  const user = rows[0];

  // Constant-time comparison: always run verifyPassword even if user not found
  // to prevent timing-based user enumeration
  const storedHash = user?.password_hash ?? 'scrypt$0$0$0$x$x';
  const valid = await verifyPassword(input.password, storedHash);

  if (!user || !valid) {
    throw Object.assign(new Error('Invalid email or password'), { code: 'INVALID_CREDENTIALS', statusCode: 401 });
  }

  return issueTokenPair(db, app, user, {
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
  });
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

export async function refreshTokens(
  db: pg.Pool,
  app: FastifyInstance,
  rawRefreshToken: string,
): Promise<TokenPair> {
  const tokenHash = hashToken(rawRefreshToken);

  const { rows } = await db.query<{
    id: string; user_id: string; expires_at: Date; revoked_at: Date | null;
  }>(
    'SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1',
    [tokenHash],
  );

  const storedToken = rows[0];

  if (!storedToken) {
    throw Object.assign(new Error('Invalid refresh token'), { code: 'INVALID_TOKEN', statusCode: 401 });
  }

  // Token theft detection: revoked token reuse → invalidate all user tokens
  if (storedToken.revoked_at !== null) {
    await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [storedToken.user_id]);
    throw Object.assign(new Error('Refresh token reuse detected — all sessions invalidated'), {
      code: 'TOKEN_REUSE',
      statusCode: 401,
    });
  }

  if (new Date() > storedToken.expires_at) {
    await db.query('DELETE FROM refresh_tokens WHERE id = $1', [storedToken.id]);
    throw Object.assign(new Error('Refresh token expired'), { code: 'TOKEN_EXPIRED', statusCode: 401 });
  }

  // Revoke old token (rotation)
  await db.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [storedToken.id]);

  // Load user
  const { rows: userRows } = await db.query<UserRow>(
    'SELECT id, email, display_name, created_at FROM users WHERE id = $1',
    [storedToken.user_id],
  );
  const user = userRows[0];
  if (!user) throw Object.assign(new Error('User not found'), { code: 'USER_NOT_FOUND', statusCode: 401 });

  return issueTokenPair(db, app, user);
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logoutUser(
  db: pg.Pool,
  rawRefreshToken: string,
): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  await db.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1', [tokenHash]);
}

export async function logoutAllSessions(db: pg.Pool, userId: string): Promise<void> {
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}

// ─── Issue token pair ─────────────────────────────────────────────────────────

async function issueTokenPair(
  db: pg.Pool,
  app: FastifyInstance,
  user: Pick<UserRow, 'id' | 'email' | 'display_name'>,
  meta?: { userAgent?: string | undefined; ipAddress?: string | undefined },
): Promise<TokenPair> {
  // Access token — signed JWT
  const accessToken = app.jwt.sign(
    { sub: user.id, email: user.email, displayName: user.display_name },
    { expiresIn: ACCESS_TOKEN_TTL_S },
  );

  // Refresh token — random bytes, stored as hash
  const rawRefreshToken = generateRefreshToken();
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_S * 1000);

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, tokenHash, expiresAt, meta?.userAgent ?? null, meta?.ipAddress ?? null],
  );

  return { accessToken, refreshToken: rawRefreshToken, expiresIn: ACCESS_TOKEN_TTL_S };
}
