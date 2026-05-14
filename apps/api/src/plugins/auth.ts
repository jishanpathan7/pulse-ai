/**
 * auth plugin — registers @fastify/jwt and @fastify/cookie.
 *
 * Decorates app.jwt (sign/verify).
 * Cookies: httpOnly, sameSite=strict, secure in production.
 *
 * Cookie names:
 *   pulse_access   — JWT access token (15min)
 *   pulse_refresh  — refresh token (7 days)
 */

import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';

export const ACCESS_COOKIE  = 'pulse_access';
export const REFRESH_COOKIE = 'pulse_refresh';

const IS_PROD = env.NODE_ENV === 'production';

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCookie, {
    secret: env.JWT_SECRET, // signs cookie value for integrity
  });

  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: ACCESS_COOKIE,
      signed: false, // JWT is self-verifying
    },
  });

  app.log.info('[auth] JWT + cookie plugin registered');
}

/** Set both cookies on a reply. */
export function setAuthCookies(
  reply: import('fastify').FastifyReply,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const base = { httpOnly: true, sameSite: 'strict' as const, secure: IS_PROD, path: '/' };
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: 15 * 60 });
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, { ...base, maxAge: 7 * 24 * 60 * 60 });
}

/** Clear both cookies on logout. */
export function clearAuthCookies(reply: import('fastify').FastifyReply): void {
  const base = { httpOnly: true, sameSite: 'strict' as const, secure: IS_PROD, path: '/' };
  reply.setCookie(ACCESS_COOKIE, '', { ...base, maxAge: 0 });
  reply.setCookie(REFRESH_COOKIE, '', { ...base, maxAge: 0 });
}
