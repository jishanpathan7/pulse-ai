/**
 * GeminiAdapter — ProviderAdapter for Google Gemini.
 * Uses the generativelanguage.googleapis.com REST API.
 */

import type { ProviderAdapter, ModelInfo, ProviderStreamRequest, StreamEvent } from './types.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const GEMINI_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-pro',    name: 'Gemini 2.5 Pro',    contextWindow: 1_048_576, maxOutput: 65_536, supportsStreaming: true },
  { id: 'gemini-2.5-flash',  name: 'Gemini 2.5 Flash',  contextWindow: 1_048_576, maxOutput: 65_536, supportsStreaming: true },
  { id: 'gemini-1.5-pro',    name: 'Gemini 1.5 Pro',    contextWindow: 2_097_152, maxOutput: 8_192,  supportsStreaming: true },
  { id: 'gemini-1.5-flash',  name: 'Gemini 1.5 Flash',  contextWindow: 1_048_576, maxOutput: 8_192,  supportsStreaming: true },
];

export class GeminiAdapter implements ProviderAdapter {
  readonly providerId = 'gemini';

  async validate(rawKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await fetch(
        `${BASE_URL}/models?key=${rawKey}`,
        { method: 'GET' },
      );
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { valid: false, error: 'auth_failed' };
      }
      if (res.status === 429) return { valid: true };
      if (!res.ok) return { valid: false, error: 'network_error' };
      return { valid: true };
    } catch {
      return { valid: false, error: 'network_error' };
    }
  }

  async listModels(_rawKey: string): Promise<ModelInfo[]> {
    return GEMINI_MODELS;
  }

  async *stream(rawKey: string, request: ProviderStreamRequest): AsyncIterable<StreamEvent> {
    const { messages, model, maxTokens, systemPrompt, signal } = request;
    const modelId = model ?? 'gemini-2.5-flash';

    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens ?? 4096 },
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
    };

    let res: Response;
    try {
      res = await fetch(
        `${BASE_URL}/models/${modelId}:streamGenerateContent?alt=sse&key=${rawKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal ?? null },
      );
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        yield { type: 'error', code: 'aborted', message: 'Stream aborted' };
        return;
      }
      yield { type: 'error', code: 'network_error', message: 'Failed to reach Gemini API' };
      return;
    }

    if (!res.ok) {
      const code =
        res.status === 401 || res.status === 403 ? 'auth_failed' as const :
        res.status === 429 ? 'rate_limited' as const :
        'network_error' as const;
      yield { type: 'error', code, message: `Gemini error: ${res.status}` };
      return;
    }

    const reader = res.body!.getReader();
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
          try {
            const parsed = JSON.parse(trimmed.slice(6)) as {
              candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
              usageMetadata?: { candidatesTokenCount?: number };
            };
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) yield { type: 'token', token: text };
            if (parsed.usageMetadata?.candidatesTokenCount) {
              totalTokens = parsed.usageMetadata.candidatesTokenCount;
            }
          } catch { /* ignore */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: 'done', totalTokens };
  }
}
