/**
 * byokStore — state for user-connected API keys (BYOK).
 *
 * Follows the Zustand pattern used across this codebase:
 *   - subscribeWithSelector
 *   - Primitive selector exports (not object selectors) — avoids referential churn
 *   - Non-throwing actions — errors surfaced via return values, not thrown
 *
 * State shape:
 *   keys         — list of connected keys fetched from GET /keys
 *   providers    — provider catalogue fetched from GET /providers
 *   modelsByKeyId — lazy-loaded model lists per key
 *   activeKeyId  — null = Ollama / WS / platform; set = use this BYOK key
 *   activeModelId — model to pass in requests when activeKeyId is set
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ConnectedKey, ProviderDefinition, ModelInfo } from '../api/byok-client.js';
import {
  listKeys,
  addKey as apiAddKey,
  deleteKey as apiDeleteKey,
  validateKey as apiValidateKey,
  fetchModels as apiFetchModels,
  fetchProviders,
} from '../api/byok-client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface ByokState {
  keys: ReadonlyArray<ConnectedKey>;
  providers: ReadonlyArray<ProviderDefinition>;
  keyLoadState: LoadState;
  modelsByKeyId: Readonly<Record<string, ReadonlyArray<ModelInfo>>>;
  activeKeyId: string | null;
  activeModelId: string | null;
}

interface ByokActions {
  loadKeys(): Promise<void>;
  loadProviders(): Promise<void>;
  addKey(
    providerId: string,
    rawKey: string,
    nickname?: string,
  ): Promise<{ ok: true; key: ConnectedKey } | { ok: false; error: string }>;
  deleteKey(keyId: string): Promise<boolean>;
  validateKey(keyId: string): Promise<{ valid: boolean; error?: string }>;
  loadModels(keyId: string): Promise<void>;
  setActiveKey(keyId: string | null): void;
  setActiveModel(modelId: string | null): void;
  /** Mark key invalid in local state (called on auth_failed stream error) */
  markKeyInvalid(keyId: string): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useByokStore = create<ByokState & ByokActions>()(
  subscribeWithSelector((set, get) => ({
    // ── State ──────────────────────────────────────────────────────────────
    keys: [],
    providers: [],
    keyLoadState: 'idle',
    modelsByKeyId: {},
    activeKeyId: null,
    activeModelId: null,

    // ── Actions ────────────────────────────────────────────────────────────

    async loadKeys() {
      set({ keyLoadState: 'loading' });
      const keys = await listKeys();
      set({ keys, keyLoadState: 'loaded' });
    },

    async loadProviders() {
      const providers = await fetchProviders();
      set({ providers });
    },

    async addKey(providerId, rawKey, nickname) {
      const result = await apiAddKey(providerId, rawKey, nickname);
      if (result.ok) {
        set((s) => ({ keys: [result.key, ...s.keys] }));
        return { ok: true, key: result.key };
      }
      return { ok: false, error: result.error };
    },

    async deleteKey(keyId) {
      const ok = await apiDeleteKey(keyId);
      if (ok) {
        set((s) => {
          const keys = s.keys.filter((k) => k.id !== keyId);
          // If deleted key was active, clear active selection
          const activeKeyId = s.activeKeyId === keyId ? null : s.activeKeyId;
          const activeModelId = s.activeKeyId === keyId ? null : s.activeModelId;
          return { keys, activeKeyId, activeModelId };
        });
      }
      return ok;
    },

    async validateKey(keyId) {
      const result = await apiValidateKey(keyId);
      set((s) => ({
        keys: s.keys.map((k) =>
          k.id === keyId
            ? { ...k, isValid: result.valid, lastValidatedAt: new Date().toISOString() }
            : k,
        ),
      }));
      return result;
    },

    async loadModels(keyId) {
      // Skip if already loaded
      if (get().modelsByKeyId[keyId]) return;

      const result = await apiFetchModels(keyId);
      if (result) {
        set((s) => ({
          modelsByKeyId: { ...s.modelsByKeyId, [keyId]: result.models },
        }));
      }
    },

    setActiveKey(keyId) {
      // When switching keys, clear model selection
      set({ activeKeyId: keyId, activeModelId: null });
    },

    setActiveModel(modelId) {
      set({ activeModelId: modelId });
    },

    markKeyInvalid(keyId) {
      set((s) => ({
        keys: s.keys.map((k) => (k.id === keyId ? { ...k, isValid: false } : k)),
      }));
    },
  })),
);

// ─── Selectors (primitive — no object churn) ──────────────────────────────────

export const selectByokKeys = (s: ByokState & ByokActions) => s.keys;
export const selectByokProviders = (s: ByokState & ByokActions) => s.providers;
export const selectByokKeyLoadState = (s: ByokState & ByokActions) => s.keyLoadState;
export const selectActiveKeyId = (s: ByokState & ByokActions) => s.activeKeyId;
export const selectActiveModelId = (s: ByokState & ByokActions) => s.activeModelId;
export const selectModelsByKeyId = (s: ByokState & ByokActions) => s.modelsByKeyId;
