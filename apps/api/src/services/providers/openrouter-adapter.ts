/**
 * OpenRouterAdapter — ProviderAdapter for OpenRouter.
 * OpenRouter is OpenAI-compatible. Fetches full model catalogue from /models.
 */

import type { ProviderAdapter, ModelInfo, ProviderStreamRequest, StreamEvent } from './types.js';
import { parseOpenAICompatSSE } from './grok-adapter.js';

const BASE_URL = 'https://openrouter.ai/api/v1';

async function orFetch(path: string, rawKey: string, options?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${rawKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://pulse-ai.app',
      'X-Title': 'Pulse AI',
      ...options?.headers,
    },
  });
}

export class OpenRouterAdapter implements ProviderAdapter {
  readonly providerId = 'openrouter';

  async validate(rawKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await orFetch('/models', rawKey);
      if (res.status === 401 || res.status === 403) return { valid: false, error: 'auth_failed' };
      if (res.status === 429) return { valid: true };
      if (!res.ok) return { valid: false, error: 'network_error' };
      return { valid: true };
    } catch {
      return { valid: false, error: 'network_error' };
    }
  }

  async listModels(rawKey: string): Promise<ModelInfo[]> {
    const res = await orFetch('/models', rawKey);
    if (!res.ok) throw new Error(`OpenRouter models fetch failed: ${res.status}`);

    const data = await res.json() as {
      data: Array<{
        id: string;
        name?: string;
        context_length?: number;
        top_provider?: { max_completion_tokens?: number };
      }>;
    };

    return data.data
      .filter((m) => m.id && !m.id.includes(':free')) // exclude free-tier variants (tend to be rate-capped)
      .slice(0, 50)
      .map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        contextWindow: m.context_length ?? 32_000,
        maxOutput: m.top_provider?.max_completion_tokens ?? 4_096,
        supportsStreaming: true,
      }));
  }

  async *stream(rawKey: string, request: ProviderStreamRequest): AsyncIterable<StreamEvent> {
    const { messages, model, maxTokens, systemPrompt, signal } = request;

    const body = {
      model: model ?? 'openai/gpt-4o',
      max_tokens: maxTokens ?? 4096,
      stream: true,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    };

    let res: Response;
    try {
      res = await orFetch('/chat/completions', rawKey, { method: 'POST', body: JSON.stringify(body), signal: signal ?? null });
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        yield { type: 'error', code: 'aborted', message: 'Stream aborted' };
        return;
      }
      yield { type: 'error', code: 'network_error', message: 'Failed to reach OpenRouter API' };
      return;
    }

    if (!res.ok) {
      const code =
        res.status === 401 || res.status === 403 ? 'auth_failed' as const :
        res.status === 429 ? 'rate_limited' as const : 'network_error' as const;
      yield { type: 'error', code, message: `OpenRouter error: ${res.status}` };
      return;
    }

    yield* parseOpenAICompatSSE(res.body!, signal);
  }
}
