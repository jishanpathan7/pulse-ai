/**
 * byok-client — REST calls for BYOK key management.
 *
 * Follows conversations-client.ts pattern:
 *   - Non-throwing — returns null/false on error
 *   - credentials: 'include' (session cookie)
 *   - Never returns encrypted_key or rawKey fields
 */

const BASE = '/api';

export interface ConnectedKey {
  id: string;
  providerId: string;
  providerName: string;
  keyHint: string;
  nickname: string | null;
  isValid: boolean;
  lastValidatedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ProviderDefinition {
  id: string;
  display_name: string;
  base_url: string;
  key_prefix: string | null;
  docs_url: string | null;
  is_active: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  supportsStreaming: boolean;
}

export async function fetchProviders(): Promise<ProviderDefinition[]> {
  try {
    const res = await fetch(`${BASE}/providers`);
    if (!res.ok) return [];
    const json = await res.json() as { providers: ProviderDefinition[] };
    return json.providers;
  } catch {
    return [];
  }
}

export async function listKeys(): Promise<ConnectedKey[]> {
  try {
    const res = await fetch(`${BASE}/keys`, { credentials: 'include' });
    if (!res.ok) return [];
    const json = await res.json() as { keys: ConnectedKey[] };
    return json.keys;
  } catch {
    return [];
  }
}

export async function addKey(
  providerId: string,
  rawKey: string,
  nickname?: string,
): Promise<{ ok: true; key: ConnectedKey } | { ok: false; error: string; code?: string | undefined }> {
  try {
    const res = await fetch(`${BASE}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ providerId, rawKey, nickname }),
    });
    const json = await res.json() as { key?: ConnectedKey; error?: string; code?: string };
    if (!res.ok) {
      const result: { ok: false; error: string; code?: string | undefined } = {
        ok: false,
        error: json.error ?? 'Failed to add key',
      };
      if (json.code !== undefined) result.code = json.code;
      return result;
    }
    return { ok: true, key: json.key! };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function deleteKey(keyId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/keys/${keyId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export async function validateKey(
  keyId: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE}/keys/${keyId}/validate`, {
      method: 'POST',
      credentials: 'include',
    });
    const json = await res.json() as { valid: boolean; error?: string };
    return json;
  } catch {
    return { valid: false, error: 'network_error' };
  }
}

export async function updateKeyNickname(keyId: string, nickname: string | null): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/keys/${keyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ nickname }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchModels(
  keyId: string,
): Promise<{ models: ModelInfo[]; cachedAt: string } | null> {
  try {
    const res = await fetch(`${BASE}/keys/${keyId}/models`, { credentials: 'include' });
    if (!res.ok) return null;
    const json = await res.json() as { models: ModelInfo[]; cachedAt: string };
    return json;
  } catch {
    return null;
  }
}
