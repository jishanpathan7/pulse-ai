/**
 * Provider abstraction types for BYOK.
 *
 * Each provider adapter implements ProviderAdapter and registers with the
 * ProviderRegistry singleton. The stream route resolves the correct adapter
 * via stream-resolver.ts — raw keys never leave the adapter boundary.
 */

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  supportsStreaming: boolean;
}

export type StreamErrorCode =
  | 'auth_failed'
  | 'rate_limited'
  | 'model_error'
  | 'context_too_long'
  | 'aborted'
  | 'network_error';

export type StreamEvent =
  | { type: 'token'; token: string }
  | { type: 'done'; totalTokens: number }
  | { type: 'error'; code: StreamErrorCode; message: string };

export interface ProviderStreamRequest {
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  model: string;
  maxTokens?: number | undefined;
  systemPrompt?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface ProviderAdapter {
  /** Provider ID matching provider_definitions.id */
  readonly providerId: string;

  /**
   * Validate a raw API key against the provider.
   * Must never throw on auth failures — returns { valid: false, error: '...' } instead.
   * Network errors may throw and will be caught by the caller.
   */
  validate(rawKey: string): Promise<{ valid: boolean; error?: string }>;

  /**
   * List available models for this key.
   * Returns a curated subset for chat/completion use.
   */
  listModels(rawKey: string): Promise<ModelInfo[]>;

  /**
   * Stream tokens from the provider.
   * Yields StreamEvent objects until done or error.
   * The raw key is never stored — it exists only in this call frame.
   */
  stream(rawKey: string, request: ProviderStreamRequest): AsyncIterable<StreamEvent>;
}
