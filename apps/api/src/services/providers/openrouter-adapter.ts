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
      'HTTP-Referer': 'https://pulse-ai-olive.vercel.app',
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
        pricing?: { prompt?: string; completion?: string };
      }>;
    };

    const models = data.data.filter((m) => m.id);

    // Sort: free models first, then paid
    models.sort((a, b) => {
      const aFree = a.id.includes(':free') || a.pricing?.prompt === '0';
      const bFree = b.id.includes(':free') || b.pricing?.prompt === '0';
      if (aFree && !bFree) return -1;
      if (!aFree && bFree) return 1;
      return 0;
    });

    return models.slice(0, 100).map((m) => {
      const isFree = m.id.includes(':free') || m.pricing?.prompt === '0';
      return {
        id: m.id,
        name: `${isFree ? '✦ ' : ''}${m.name ?? m.id}`,
        contextWindow: m.context_length ?? 32_000,
        maxOutput: m.top_provider?.max_completion_tokens ?? 4_096,
        supportsStreaming: true,
      };
    });
  }

  async *stream(rawKey: string, request: ProviderStreamRequest): AsyncIterable<StreamEvent> {
    const { messages, model, maxTokens, systemPrompt, signal } = request;

    const body = {
      model: model ?? 'meta-llama/llama-3.1-8b-instruct:free',
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
