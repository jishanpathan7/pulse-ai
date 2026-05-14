/**
 * OllamaAdapter — streams tokens from a local Ollama instance.
 *
 * Uses Ollama's OpenAI-compatible endpoint:
 *   POST http://localhost:11434/v1/chat/completions
 *   stream: true → SSE response
 *
 * No API key required. Runs entirely on localhost.
 *
 * Usage:
 *   const adapter = new OllamaAdapter({ model: 'llama3.2' });
 *   aiProviderRegistry.register('ollama', adapter);
 */

import { AIProviderError } from './provider.js';
import type { AIProvider, AIMessage, StreamOptions } from './provider.js';

export interface OllamaAdapterConfig {
  /** Ollama base URL. Default: 'http://localhost:11434' */
  readonly baseUrl?: string;
  /** Model name. Default: 'llama3.2' */
  readonly model?: string;
}

export class OllamaAdapter implements AIProvider {
  readonly name = 'ollama';
  private readonly _baseUrl: string;
  private readonly _model: string;
  private _available: boolean = false;

  constructor(config: OllamaAdapterConfig = {}) {
    this._baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this._model = config.model ?? 'llama3.2';
  }

  get isAvailable(): boolean { return this._available; }

  /** Probe Ollama. Call once on startup. */
  async probe(): Promise<boolean> {
    try {
      const res = await fetch(`${this._baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
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
        'Ollama not reachable. Ensure `ollama serve` is running.',
        false,
      );
    }

    const signal = options?.signal;

    // Build message list — prepend system prompt if provided
    const chatMessages: Array<{ role: string; content: string }> = [];
    if (options?.systemPrompt) {
      chatMessages.push({ role: 'system', content: options.systemPrompt });
    }
    for (const m of messages) {
      chatMessages.push({ role: m.role, content: m.content });
    }

    let response: Response;
    try {
      response = await fetch(`${this._baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this._model,
          messages: chatMessages,
          stream: true,
        }),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new AIProviderError('aborted', 'Stream aborted by caller');
      }
      throw new AIProviderError('network_error', `Ollama unreachable: ${String(err)}`, true);
    }

    if (!response.ok) {
      throw new AIProviderError('model_error', `Ollama HTTP ${response.status}`, response.status >= 500);
    }

    if (response.body === null) {
      throw new AIProviderError('parse_error', 'Ollama response body is null');
    }

    // Parse OpenAI-compatible SSE stream
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

          let parsed: { choices?: Array<{ delta?: { content?: string }; finish_reason?: string }> };
          try {
            parsed = JSON.parse(data) as typeof parsed;
          } catch {
            continue; // skip malformed chunks
          }

          const token = parsed.choices?.[0]?.delta?.content;
          if (token) yield token;

          if (parsed.choices?.[0]?.finish_reason === 'stop') return;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
