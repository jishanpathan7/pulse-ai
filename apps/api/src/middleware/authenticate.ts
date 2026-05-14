/**
 * authenticate — preHandler hook for protected routes.
 *
 * Reads JWT from:
 *   1. Authorization: Bearer <token>  header
 *   2. pulse_access cookie (set by /auth/login)
 *
 * On success: attaches decoded payload to request.user
 * On failure: 401 Unauthorized
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

export interface JwtPayload {
  sub: string;       // userId
  email: string;
  displayName: string | null;
  iat: number;
  exp: number;
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'Unauthorized', code: 'INVALID_TOKEN' });
  }
}
