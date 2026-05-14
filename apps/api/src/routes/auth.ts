/**
 * auth routes
 *
 * POST /auth/register    — create account, return tokens
 * POST /auth/login       — verify credentials, return tokens
 * POST /auth/refresh     — rotate refresh token, return new token pair
 * DELETE /auth/logout    — revoke refresh token, clear cookies
 * GET  /auth/me          — return current user (protected)
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  registerUser,
  loginUser,
  refreshTokens,
  logoutUser,
} from '../services/auth.js';
import { setAuthCookies, clearAuthCookies, REFRESH_COOKIE } from '../plugins/auth.js';
import { authenticate } from '../middleware/authenticate.js';
import type { JwtPayload } from '../middleware/authenticate.js';

// ─── Input schemas ────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(64).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function authRoutes(app: FastifyInstance): Promise<void> {

  // ── Register ──────────────────────────────────────────────────────────────

  app.post('/auth/register', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', issues: parsed.error.issues });
    }

    try {
      const tokens = await registerUser(app.db, app, parsed.data);
      setAuthCookies(reply, tokens);
      return reply.status(201).send({
        message: 'Account created',
        expiresIn: tokens.expiresIn,
        // Don't return raw tokens in body — they're in httpOnly cookies.
        // Return expiresIn so client can schedule a refresh.
      });
    } catch (e: unknown) {
      const err = e as { code?: string; statusCode?: number; message: string };
      if (err.code === 'EMAIL_EXISTS') {
        return reply.status(409).send({ error: 'Email already registered', code: err.code });
      }
      app.log.error({ err }, '[auth] register error');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ── Login ─────────────────────────────────────────────────────────────────

  app.post('/auth/login', {
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', issues: parsed.error.issues });
    }

    try {
      const tokens = await loginUser(app.db, app, {
        ...parsed.data,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      });
      setAuthCookies(reply, tokens);
      return reply.send({ message: 'Logged in', expiresIn: tokens.expiresIn });
    } catch (e: unknown) {
      const err = e as { code?: string; statusCode?: number; message: string };
      if (err.code === 'INVALID_CREDENTIALS') {
        return reply.status(401).send({ error: 'Invalid email or password', code: err.code });
      }
      app.log.error({ err }, '[auth] login error');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ── Refresh ───────────────────────────────────────────────────────────────

  app.post('/auth/refresh', async (req, reply) => {
    const rawRefreshToken = req.cookies[REFRESH_COOKIE];
    if (!rawRefreshToken) {
      return reply.status(401).send({ error: 'No refresh token', code: 'MISSING_TOKEN' });
    }

    try {
      const tokens = await refreshTokens(app.db, app, rawRefreshToken);
      setAuthCookies(reply, tokens);
      return reply.send({ message: 'Tokens refreshed', expiresIn: tokens.expiresIn });
    } catch (e: unknown) {
      const err = e as { code?: string; message: string };
      clearAuthCookies(reply);
      const status = err.code === 'TOKEN_REUSE' ? 401 : 401;
      return reply.status(status).send({ error: err.message, code: err.code ?? 'AUTH_ERROR' });
    }
  });

  // ── Logout ────────────────────────────────────────────────────────────────

  app.delete('/auth/logout', async (req, reply) => {
    const rawRefreshToken = req.cookies[REFRESH_COOKIE];
    if (rawRefreshToken) {
      await logoutUser(app.db, rawRefreshToken).catch(() => undefined); // best-effort
    }
    clearAuthCookies(reply);
    return reply.send({ message: 'Logged out' });
  });

  // ── Me ────────────────────────────────────────────────────────────────────

  app.get('/auth/me', { preHandler: authenticate }, async (req, reply) => {
    const payload = req.user as JwtPayload;
    const { rows } = await app.db.query(
      'SELECT id, email, display_name, created_at FROM users WHERE id = $1',
      [payload.sub],
    );
    const user = rows[0];
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return reply.send({ user });
  });
}
