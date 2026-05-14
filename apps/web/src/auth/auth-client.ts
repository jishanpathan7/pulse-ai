/**
 * auth-client — thin wrapper around the auth REST endpoints.
 *
 * All tokens are in httpOnly cookies — this module never handles raw tokens.
 * Success/failure determined by HTTP status and JSON response body.
 */

const BASE = '/api';

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export interface AuthError {
  error: string;
  code?: string | undefined;
}

async function post(path: string, body: object): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
}

export async function register(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ ok: true; expiresIn: number } | { ok: false; error: string; code?: string | undefined }> {
  const res = await post('/auth/register', { email, password, displayName });
  const json = await res.json() as unknown as AuthError & { expiresIn?: number };
  if (res.ok) return { ok: true, expiresIn: json.expiresIn ?? 900 };
  return { ok: false, error: json.error, ...(json.code !== undefined ? { code: json.code } : {}) };
}

export async function login(
  email: string,
  password: string,
): Promise<{ ok: true; expiresIn: number } | { ok: false; error: string; code?: string | undefined }> {
  const res = await post('/auth/login', { email, password });
  const json = await res.json() as unknown as AuthError & { expiresIn?: number };
  if (res.ok) return { ok: true, expiresIn: json.expiresIn ?? 900 };
  return { ok: false, error: json.error, ...(json.code !== undefined ? { code: json.code } : {}) };
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { method: 'DELETE', credentials: 'include' });
}

export async function getMe(): Promise<AuthUser | null> {
  const res = await fetch(`${BASE}/auth/me`, { credentials: 'include' });
  if (!res.ok) return null;
  const json = await res.json() as { user: AuthUser };
  return json.user;
}

export async function refreshTokens(): Promise<boolean> {
  const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
  return res.ok;
}
