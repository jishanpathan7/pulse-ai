/**
 * AnthropicAdapter — ProviderAdapter implementation for Anthropic Claude.
 *
 * Uses the @anthropic-ai/sdk. Model list is hardcoded (no public catalogue API).
 * Validation calls messages.create with max_tokens=1 to verify key auth.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ProviderAdapter, ModelInfo, ProviderStreamRequest, StreamEvent } from './types.js';

const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-5',      name: 'Claude Opus 4.5',      contextWindow: 200_000, maxOutput: 32_000, supportsStreaming: true },
  { id: 'claude-sonnet-4-6',    name: 'Claude Sonnet 4.6',    contextWindow: 200_000, maxOutput: 16_000, supportsStreaming: true },
  { id: 'claude-haiku-3-5',     name: 'Claude Haiku 3.5',     contextWindow: 200_000, maxOutput: 8_192,  supportsStreaming: true },
  { id: 'claude-opus-3',        name: 'Claude Opus 3',        contextWindow: 200_000, maxOutput: 4_096,  supportsStreaming: true },
  { id: 'claude-sonnet-3-7',    name: 'Claude Sonnet 3.7',    contextWindow: 200_000, maxOutput: 16_000, supportsStreaming: true },
  { id: 'claude-haiku-3',       name: 'Claude Haiku 3',       contextWindow: 200_000, maxOutput: 4_096,  supportsStreaming: true },
];

export class AnthropicAdapter implements ProviderAdapter {
  readonly providerId = 'anthropic';

  async validate(rawKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const client = new Anthropic({ apiKey: rawKey });
      // Cheapest possible call to verify auth
      await client.messages.create({
        model: 'claude-haiku-3-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return { valid: true };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        return { valid: false, error: 'auth_failed' };
      }
      if (err instanceof Anthropic.PermissionDeniedError) {
        return { valid: false, error: 'permission_denied' };
      }
      if (err instanceof Anthropic.RateLimitError) {
        // Key exists but is rate-limited — treat as valid
        return { valid: true };
      }
      return { valid: false, error: 'network_error' };
    }
  }

  async listModels(_rawKey: string): Promise<ModelInfo[]> {
    // Anthropic has no public models API — return curated list
    return ANTHROPIC_MODELS;
  }

  async *stream(rawKey: string, request: ProviderStreamRequest): AsyncIterable<StreamEvent> {
    const client = new Anthropic({ apiKey: rawKey });
    const { messages, model, maxTokens, systemPrompt, signal } = request;

    let totalTokens = 0;

    try {
      const stream = await client.messages.create(
        {
          model: model ?? 'claude-sonnet-4-6',
          max_tokens: maxTokens ?? 4096,
          ...(systemPrompt !== undefined ? { system: systemPrompt } : {}),
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        },
        { signal: signal ?? null },
      );

      for await (const event of stream) {
        if (signal?.aborted) {
          yield { type: 'error', code: 'aborted', message: 'Stream aborted by client' };
          return;
        }

        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'token', token: event.delta.text };
        } else if (event.type === 'message_delta' && event.usage) {
          totalTokens = event.usage.output_tokens;
        }
      }

      yield { type: 'done', totalTokens };
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        yield { type: 'error', code: 'aborted', message: 'Stream aborted' };
        return;
      }
      if (err instanceof Anthropic.AuthenticationError) {
        yield { type: 'error', code: 'auth_failed', message: 'Invalid or expired API key' };
        return;
      }
      if (err instanceof Anthropic.RateLimitError) {
        yield { type: 'error', code: 'rate_limited', message: 'Rate limit exceeded' };
        return;
      }
      if (err instanceof Anthropic.BadRequestError) {
        const msg = err.message ?? '';
        if (msg.includes('context')) {
          yield { type: 'error', code: 'context_too_long', message: 'Context window exceeded' };
        } else {
          yield { type: 'error', code: 'model_error', message: 'Model rejected the request' };
        }
        return;
      }
      yield { type: 'error', code: 'network_error', message: 'Failed to reach Anthropic API' };
    }
  }
}
