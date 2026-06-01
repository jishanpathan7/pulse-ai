/**
 * AnthropicAdapter — streams Claude tokens via the backend proxy.
 *
 * Architecture:
 *   Browser → POST /api/stream → Fastify (Phase 7) → Anthropic API
 *
 * The browser never holds an API key. The backend handles auth, rate limiting,
 * and retry logic. This adapter only deals with the SSE stream from the proxy.
 *
 * SSE format (Phase 7 backend contract):
 *   data: {"type":"token","token":"Hello"}
 *   data: {"type":"token","token":" world"}
 *   data: {"type":"done"}
 *   data: {"type":"error","code":"rate_limited","message":"..."}
 *
 * Phase 7 backend stub:
 *   The backend (apps/api) will expose POST /api/stream.
 *   Until it exists, this adapter returns isAvailable=false and throws
 *   AIProviderError('backend_unavailable') on stream() calls.
 *
 * Usage:
 *   const adapter = new AnthropicAdapter({ baseUrl: '/api' });
 *   aiProviderRegistry.register('anthropic', adapter);
 */

import { AIProviderError } from './provider.js';
import type { AIProvider, AIMessage, StreamOptions } from './provider.js';

export interface AnthropicAdapterConfig {
  /** Base URL for the backend API. Default: '/api' (Vite proxy). */
  readonly baseUrl?: string;
  /** Model ID to request from the backend. */
  readonly defaultModel?: string;
  /** Max tokens. Default: 2048. */
  readonly defaultMaxTokens?: number;
}

export class AnthropicAdapter implements AIProvider {
  readonly name = 'anthropic';
  private readonly _baseUrl: string;
  private readonly _model: string;
  private readonly _maxTokens: number;
  private _available: boolean = false;

  constructor(config: AnthropicAdapterConfig = {}) {
    this._baseUrl = config.baseUrl ?? (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
    this._model = config.defaultModel ?? 'claude-sonnet-4-6';
    this._maxTokens = config.defaultMaxTokens ?? 2048;
  }

  get isAvailable(): boolean { return this._available; }

  /** Probe the backend. Call once on app startup. */
  async probe(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this._baseUrl}/health`, { signal: controller.signal }).finally(() => clearTimeout(timer));
      this._available = res.ok;
    } catch {
      this._available = false;
    }
    return this._available;
  }

  async *stream(
    messages: ReadonlyArray<AIMessage>,
    options?: StreamOptions,
  ): AsyncIterable<string> {
    if (!this._available) {
      throw new AIProviderError(
        'backend_unavailable',
        'Backend not available. Run `pnpm dev --filter=@pulse/api` to start the API server.',
        false,
      );
    }

    const signal = options?.signal;

    let response: Response;
    try {
      response = await fetch(`${this._baseUrl}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          model: options?.model ?? this._model,
          maxTokens: options?.maxTokens ?? this._maxTokens,
          systemPrompt: options?.systemPrompt,
          ...(options?.keyId !== undefined ? { keyId: options.keyId } : {}),
        }),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new AIProviderError('aborted', 'Stream aborted by caller');
      }
      throw new AIProviderError('network_error', `Network error: ${String(err)}`, true);
    }

    if (!response.ok) {
      const code = response.status === 401 ? 'auth_failed'
        : response.status === 429 ? 'rate_limited'
        : 'model_error';
      throw new AIProviderError(code, `HTTP ${response.status}`, response.status >= 500);
    }

    if (response.body === null) {
      throw new AIProviderError('parse_error', 'Response body is null');
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;

          let parsed: { type: string; token?: string; code?: string; message?: string };
          try {
            parsed = JSON.parse(data) as typeof parsed;
          } catch {
            throw new AIProviderError('parse_error', `Failed to parse SSE data: ${data}`);
          }

          if (parsed.type === 'token' && parsed.token !== undefined) {
            yield parsed.token;
          } else if (parsed.type === 'done') {
            return;
          } else if (parsed.type === 'error') {
            throw new AIProviderError(
              (parsed.code as AIProviderError['code']) ?? 'model_error',
              parsed.message ?? 'Unknown error from backend',
            );
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
