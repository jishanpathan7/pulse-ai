/**
 * GrokAdapter — ProviderAdapter for xAI Grok.
 * xAI uses the OpenAI-compatible API at https://api.x.ai/v1.
 * Delegates to OpenAIAdapter with a custom baseUrl.
 */

import type { ProviderAdapter, ModelInfo, ProviderStreamRequest, StreamEvent } from './types.js';

const BASE_URL = 'https://api.x.ai/v1';

const GROK_MODELS: ModelInfo[] = [
  { id: 'grok-3',        name: 'Grok 3',        contextWindow: 131_072, maxOutput: 131_072, supportsStreaming: true },
  { id: 'grok-3-fast',   name: 'Grok 3 Fast',   contextWindow: 131_072, maxOutput: 131_072, supportsStreaming: true },
  { id: 'grok-3-mini',   name: 'Grok 3 Mini',   contextWindow: 131_072, maxOutput: 131_072, supportsStreaming: true },
  { id: 'grok-2-1212',   name: 'Grok 2 (Dec)',   contextWindow: 131_072, maxOutput: 131_072, supportsStreaming: true },
  { id: 'grok-beta',     name: 'Grok Beta',      contextWindow: 131_072, maxOutput: 131_072, supportsStreaming: true },
];

async function grokFetch(path: string, rawKey: string, options?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${rawKey}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

export class GrokAdapter implements ProviderAdapter {
  readonly providerId = 'grok';

  async validate(rawKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await grokFetch('/models', rawKey);
      if (res.status === 401 || res.status === 403) return { valid: false, error: 'auth_failed' };
      if (res.status === 429) return { valid: true };
      if (!res.ok) return { valid: false, error: 'network_error' };
      return { valid: true };
    } catch {
      return { valid: false, error: 'network_error' };
    }
  }

  async listModels(_rawKey: string): Promise<ModelInfo[]> {
    return GROK_MODELS;
  }

  async *stream(rawKey: string, request: ProviderStreamRequest): AsyncIterable<StreamEvent> {
    const { messages, model, maxTokens, systemPrompt, signal } = request;

    const body = {
      model: model ?? 'grok-3-fast',
      max_tokens: maxTokens ?? 4096,
      stream: true,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    };

    let res: Response;
    try {
      res = await grokFetch('/chat/completions', rawKey, {
        method: 'POST',
        body: JSON.stringify(body),
        signal: signal ?? null,
      });
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        yield { type: 'error', code: 'aborted', message: 'Stream aborted' };
        return;
      }
      yield { type: 'error', code: 'network_error', message: 'Failed to reach xAI API' };
      return;
    }

    if (!res.ok) {
      const code =
        res.status === 401 || res.status === 403 ? 'auth_failed' as const :
        res.status === 429 ? 'rate_limited' as const :
        'network_error' as const;
      yield { type: 'error', code, message: `xAI Grok error: ${res.status}` };
      return;
    }

    yield* parseOpenAICompatSSE(res.body!, signal);
  }
}

export async function* parseOpenAICompatSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalTokens = 0;

  try {
    while (true) {
      if (signal?.aborted) { yield { type: 'error', code: 'aborted', message: 'Stream aborted' }; return; }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') { yield { type: 'done', totalTokens }; return; }
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { completion_tokens?: number };
          };
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield { type: 'token', token: content };
          if (parsed.usage?.completion_tokens) totalTokens = parsed.usage.completion_tokens;
        } catch { /* ignore */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: 'done', totalTokens };
}
