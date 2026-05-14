/**
 * TogetherAdapter — ProviderAdapter for Together AI.
 * Together AI is OpenAI-compatible.
 */

import type { ProviderAdapter, ModelInfo, ProviderStreamRequest, StreamEvent } from './types.js';
import { parseOpenAICompatSSE } from './grok-adapter.js';

const BASE_URL = 'https://api.together.xyz/v1';

async function togetherFetch(path: string, rawKey: string, options?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${rawKey}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

export class TogetherAdapter implements ProviderAdapter {
  readonly providerId = 'together';

  async validate(rawKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await togetherFetch('/models', rawKey);
      if (res.status === 401 || res.status === 403) return { valid: false, error: 'auth_failed' };
      if (res.status === 429) return { valid: true };
      if (!res.ok) return { valid: false, error: 'network_error' };
      return { valid: true };
    } catch {
      return { valid: false, error: 'network_error' };
    }
  }

  async listModels(rawKey: string): Promise<ModelInfo[]> {
    const res = await togetherFetch('/models', rawKey);
    if (!res.ok) throw new Error(`Together AI models fetch failed: ${res.status}`);

    const data = await res.json() as Array<{
      id: string;
      display_name?: string;
      context_length?: number;
      type?: string;
    }>;

    return data
      .filter((m) => m.type === 'chat' || m.type === 'language')
      .slice(0, 40)
      .map((m) => ({
        id: m.id,
        name: m.display_name ?? m.id,
        contextWindow: m.context_length ?? 8_192,
        maxOutput: 4_096,
        supportsStreaming: true,
      }));
  }

  async *stream(rawKey: string, request: ProviderStreamRequest): AsyncIterable<StreamEvent> {
    const { messages, model, maxTokens, systemPrompt, signal } = request;

    const body = {
      model: model ?? 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      max_tokens: maxTokens ?? 4096,
      stream: true,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    };

    let res: Response;
    try {
      res = await togetherFetch('/chat/completions', rawKey, { method: 'POST', body: JSON.stringify(body), signal: signal ?? null });
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        yield { type: 'error', code: 'aborted', message: 'Stream aborted' };
        return;
      }
      yield { type: 'error', code: 'network_error', message: 'Failed to reach Together AI API' };
      return;
    }

    if (!res.ok) {
      const code =
        res.status === 401 || res.status === 403 ? 'auth_failed' as const :
        res.status === 429 ? 'rate_limited' as const : 'network_error' as const;
      yield { type: 'error', code, message: `Together AI error: ${res.status}` };
      return;
    }

    yield* parseOpenAICompatSSE(res.body!, signal);
  }
}
