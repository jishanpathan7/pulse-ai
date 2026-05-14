/**
 * BYOKAdapter — AIProvider backed by a user's stored API key.
 *
 * Thin wrapper: injects keyId + modelId from byokStore into StreamOptions,
 * then delegates to either WsAIProvider (if connected) or AnthropicAdapter (SSE).
 *
 * The server resolves the key, decrypts it, and proxies the stream.
 * The raw key never exists in the browser after the initial POST /keys submission.
 */

import type { AIProvider, AIMessage, StreamOptions } from './provider.js';
import { AIProviderError } from './provider.js';

export class BYOKAdapter implements AIProvider {
  readonly name: string; // e.g. 'byok-anthropic'
  private readonly _keyId: string;
  private readonly _modelId: string | null;
  private readonly _delegate: AIProvider;

  constructor(params: {
    keyId: string;
    providerId: string;
    modelId?: string | null;
    delegate: AIProvider; // WsAIProvider or AnthropicAdapter
  }) {
    this._keyId = params.keyId;
    this._modelId = params.modelId ?? null;
    this._delegate = params.delegate;
    this.name = `byok-${params.providerId}`;
  }

  get isAvailable(): boolean {
    return this._delegate.isAvailable;
  }

  async *stream(
    messages: ReadonlyArray<AIMessage>,
    options?: StreamOptions,
  ): AsyncIterable<string> {
    if (!this.isAvailable) {
      throw new AIProviderError(
        'backend_unavailable',
        'No backend connection available for BYOK streaming.',
        false,
      );
    }

    const enriched: StreamOptions = {
      ...options,
      keyId: this._keyId,
      ...(this._modelId !== null ? { model: this._modelId } : {}),
    };

    yield* this._delegate.stream(messages, enriched);
  }
}
