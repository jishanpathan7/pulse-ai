/**
 * WsAIProvider — AIProvider implementation backed by the real WebSocket transport.
 *
 * Instead of calling POST /stream (SSE), this provider:
 *   1. Sends a stream_request message over the existing WS connection
 *   2. Subscribes to incoming sequenced messages for that streamId
 *   3. Yields tokens as they arrive (with full sequence tracking + replay recovery)
 *
 * The WsTransportClient handles:
 *   - Sequence number tracking
 *   - Gap detection and replay requests
 *   - Reconnection with missed-message recovery
 *
 * Usage:
 *   const wsClient = new WsTransportClient(config);
 *   await wsClient.connect('ws://localhost:3003/ws');
 *   const provider = new WsAIProvider(wsClient);
 *   // Plug into StreamInjector — identical interface to AnthropicAdapter
 */

import type { AIProvider, AIMessage, StreamOptions } from './provider.js';
import { AIProviderError } from './provider.js';
import type { WsTransportClient } from '../transport/ws-client.js';
import type { StreamId, ConversationId, ServerMessage } from '@pulse/types/transport';
import { randomUUID } from '../utils/uuid.js';

// Simple async queue for token buffering
class TokenQueue {
  private readonly _queue: Array<{ value: string } | { error: Error } | null> = [];
  private _resolve: (() => void) | null = null;
  private _closed = false;

  push(token: string): void {
    if (this._closed) return;
    this._queue.push({ value: token });
    this._resolve?.();
    this._resolve = null;
  }

  fail(error: Error): void {
    if (this._closed) return;
    this._queue.push({ error });
    this._closed = true;
    this._resolve?.();
    this._resolve = null;
  }

  close(): void {
    if (this._closed) return;
    this._queue.push(null); // sentinel
    this._closed = true;
    this._resolve?.();
    this._resolve = null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    while (true) {
      if (this._queue.length > 0) {
        const item = this._queue.shift()!;
        if (item === null) return; // end of stream
        if ('error' in item) throw item.error;
        yield item.value;
      } else {
        // Wait for next item
        await new Promise<void>((resolve) => {
          this._resolve = resolve;
        });
      }
    }
  }
}

export class WsAIProvider implements AIProvider {
  readonly name = 'ws-anthropic';
  private readonly _transport: WsTransportClient;

  constructor(transport: WsTransportClient) {
    this._transport = transport;
  }

  get isAvailable(): boolean {
    return this._transport.state === 'connected';
  }

  async *stream(
    messages: ReadonlyArray<AIMessage>,
    options?: StreamOptions,
  ): AsyncIterable<string> {
    if (!this.isAvailable) {
      throw new AIProviderError(
        'backend_unavailable',
        'WebSocket not connected. Ensure the backend is running.',
        false,
      );
    }

    const streamId = randomUUID() as StreamId;
    const conversationId = (options?.conversationId ?? 'conv-default') as ConversationId;
    const queue = new TokenQueue();
    let targetStreamId: StreamId | null = streamId;

    // Subscribe to incoming messages — filter for this streamId
    const unsub = this._transport.onMessage((msg: ServerMessage) => {
      if (targetStreamId === null) return;

      if (msg.type === 'token' && msg.streamId === targetStreamId) {
        queue.push(msg.token);
      } else if (msg.type === 'stream_end' && msg.streamId === targetStreamId) {
        queue.close();
      } else if (msg.type === 'stream_error' && msg.streamId === targetStreamId) {
        queue.fail(
          new AIProviderError(
            (msg.code as AIProviderError['code']) ?? 'model_error',
            msg.message,
            msg.retryable,
          ),
        );
      }
    });

    // Handle abort signal
    const onAbort = (): void => {
      targetStreamId = null; // stop routing messages to queue
      this._transport.send({
        type: 'stream_cancel',
        streamId,
      });
      queue.close();
    };

    options?.signal?.addEventListener('abort', onAbort, { once: true });

    // Send the stream request
    const sendResult = this._transport.send({
      type: 'stream_request',
      streamId,
      conversationId,
      messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ...(options?.model !== undefined ? { model: options.model } : {}),
      ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      ...(options?.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
      ...(options?.keyId !== undefined ? { keyId: options.keyId } : {}),
    });

    if (!sendResult.ok) {
      unsub();
      throw new AIProviderError('network_error', `Failed to send stream request: ${sendResult.error.message}`, true);
    }

    try {
      yield* queue;
    } finally {
      unsub();
      options?.signal?.removeEventListener('abort', onAbort);
    }
  }
}
