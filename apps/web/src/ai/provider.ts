/**
 * AIProvider — abstraction boundary between the workspace and AI inference.
 *
 * The workspace never knows whether tokens come from:
 *   - Anthropic Claude (via backend proxy, Phase 7)
 *   - OpenAI GPT (via backend proxy)
 *   - A DemoAdapter (pre-canned realistic responses, no backend)
 *   - A StreamSimulator (synthetic benchmark load)
 *
 * Contract:
 *   stream() returns an AsyncIterable<string> of raw token strings.
 *   Each yielded string is one token (not a word or sentence boundary).
 *   The iterable completes when the model stops generating.
 *   The AbortSignal cancels the stream mid-flight (user interrupt, navigation).
 *
 * Integration with the render pipeline:
 *   StreamInjector consumes this interface and bridges tokens into the
 *   existing RenderPipeline via SyntheticTransport — tokens flow through
 *   the same RAFScheduler → streamStore → StreamingMessage path as
 *   simulated streams. The AI layer is invisible to the rendering layer.
 *
 * Error handling:
 *   Throws AIProviderError on non-recoverable failures (auth, rate limit,
 *   model error). The caller (StreamInjector) maps this to a stream_error
 *   message in the transport, triggering the existing error state in the UI.
 *
 * Phase 7+ backend contract:
 *   POST /api/stream
 *   Body: { messages: Message[], model?: string, maxTokens?: number }
 *   Response: text/event-stream with `data: {"token":"..."}` lines
 *   The AnthropicAdapter and OpenAIAdapter call this endpoint.
 *   Direct API key access never happens in the browser.
 */

export interface AIMessage {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
}

export interface StreamOptions {
  readonly signal?: AbortSignal;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
  /** Conversation identifier — passed to backend for session context. */
  readonly conversationId?: string;
  /** BYOK: user_api_keys.id to use for this stream. Omit for platform key. */
  readonly keyId?: string;
}

export interface AIProvider {
  readonly name: string;
  readonly isAvailable: boolean;

  /**
   * Stream tokens for a conversation turn.
   * Yields raw token strings as they arrive.
   * Completing without error means the model finished cleanly.
   */
  stream(
    messages: ReadonlyArray<AIMessage>,
    options?: StreamOptions,
  ): AsyncIterable<string>;
}

// ─── Error types ──────────────────────────────────────────────────────────────

export type AIErrorCode =
  | 'auth_failed'         // 401 — API key invalid or expired
  | 'rate_limited'        // 429 — too many requests
  | 'model_error'         // 500 — inference failure
  | 'context_too_long'    // 400 — token count exceeded
  | 'aborted'             // AbortSignal fired
  | 'network_error'       // fetch failed
  | 'backend_unavailable' // Phase 7 backend not running
  | 'parse_error';        // SSE/JSON parse failure

export class AIProviderError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────
// Single place to register and select providers.

export type ProviderName = 'anthropic' | 'openai' | 'demo' | 'ws-anthropic' | 'ollama';

export class AIProviderRegistry {
  private readonly _providers = new Map<ProviderName, AIProvider>();

  register(name: ProviderName, provider: AIProvider): void {
    this._providers.set(name, provider);
  }

  get(name: ProviderName): AIProvider {
    const p = this._providers.get(name);
    if (p === undefined) throw new Error(`AI provider '${name}' not registered`);
    return p;
  }

  getAvailable(): AIProvider[] {
    return Array.from(this._providers.values()).filter((p) => p.isAvailable);
  }

  hasAvailable(): boolean {
    return this.getAvailable().length > 0;
  }
}

export const aiProviderRegistry = new AIProviderRegistry();
