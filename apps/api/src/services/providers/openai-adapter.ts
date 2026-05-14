/**
 * OpenAIAdapter — ProviderAdapter for OpenAI.
 * Uses OpenAI-compatible REST API. Fetches model list from GET /v1/models.
 */

import type { ProviderAdapter, ModelInfo, ProviderStreamRequest, StreamEvent, StreamErrorCode } from './types.js';

const BASE_URL = 'https://api.openai.com/v1';

// Chat-capable model prefixes to include from the models list
const CHAT_PREFIXES = ['gpt-4', 'gpt-3.5', 'o1', 'o3', 'o4'];

function isChatModel(id: string): boolean {
  return CHAT_PREFIXES.some((p) => id.startsWith(p)) && !id.includes('instruct') && !id.includes('vision');
}

async function openAIFetch(path: string, rawKey: string, options?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${rawKey}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly providerId = 'openai';

  async validate(rawKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await openAIFetch('/models', rawKey);
      if (res.status === 401) return { valid: false, error: 'auth_failed' };
      if (res.status === 429) return { valid: true }; // rate-limited = valid key
      if (!res.ok) return { valid: false, error: 'network_error' };
      return { valid: true };
    } catch {
      return { valid: false, error: 'network_error' };
    }
  }

  async listModels(rawKey: string): Promise<ModelInfo[]> {
    const res = await openAIFetch('/models', rawKey);
    if (!res.ok) throw new Error(`OpenAI models fetch failed: ${res.status}`);

    const data = await res.json() as { data: Array<{ id: string }> };
    const models: ModelInfo[] = [];

    for (const m of data.data) {
      if (!isChatModel(m.id)) continue;
      // Rough context windows for common models
      const ctx = m.id.startsWith('o1') ? 200_000 :
                  m.id.startsWith('gpt-4o') ? 128_000 :
                  m.id.startsWith('gpt-4') ? 128_000 : 16_385;
      models.push({ id: m.id, name: m.id, contextWindow: ctx, maxOutput: 16_384, supportsStreaming: true });
    }

    // Sort newest first (rough heuristic: longer id → newer)
    return models.sort((a, b) => b.id.localeCompare(a.id)).slice(0, 20);
  }

  async *stream(rawKey: string, request: ProviderStreamRequest): AsyncIterable<StreamEvent> {
    const { messages, model, maxTokens, systemPrompt, signal } = request;

    const body: Record<string, unknown> = {
      model: model ?? 'gpt-4o',
      max_tokens: maxTokens ?? 4096,
      stream: true,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    };

    let res: Response;
    try {
      res = await openAIFetch('/chat/completions', rawKey, {
        method: 'POST',
        body: JSON.stringify(body),
        signal: signal ?? null,
      });
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        yield { type: 'error', code: 'aborted', message: 'Stream aborted' };
        return;
      }
      yield { type: 'error', code: 'network_error', message: 'Failed to reach OpenAI API' };
      return;
    }

    if (!res.ok) {
      const code: StreamErrorCode =
        res.status === 401 ? 'auth_failed' :
        res.status === 429 ? 'rate_limited' :
        res.status === 400 ? 'model_error' : 'network_error';
      yield { type: 'error', code, message: `OpenAI error: ${res.status}` };
      return;
    }

    yield* parseOpenAISSE(res.body!, signal);
  }
}

async function* parseOpenAISSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalTokens = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        yield { type: 'error', code: 'aborted', message: 'Stream aborted' };
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          yield { type: 'done', totalTokens };
          return;
        }
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
            usage?: { completion_tokens?: number };
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { type: 'token', token: delta };
          if (parsed.usage?.completion_tokens) totalTokens = parsed.usage.completion_tokens;
        } catch {
          // Ignore malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: 'done', totalTokens };
}
