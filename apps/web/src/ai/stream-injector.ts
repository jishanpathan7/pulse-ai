/**
 * StreamInjector — bridges AIProvider tokens → RenderPipeline.
 *
 * Takes a token iterable from an AIProvider and injects it into the existing
 * rendering pipeline via SyntheticTransport. The pipeline is unaware of the
 * token source — AI tokens flow through the same path as simulated tokens:
 *
 *   AIProvider.stream()
 *     → StreamInjector
 *     → SyntheticTransport.injectMessage()
 *     → RenderPipeline._onMessage()
 *     → StreamBufferManager → RAFScheduler
 *     → streamStore → StreamingMessage (React)
 *
 * Lifecycle:
 *   1. inject() creates a SyntheticTransport and connects it to the pipeline
 *   2. Sends stream_start → pipeline creates the stream slot
 *   3. Streams tokens → pipeline batches via RAF
 *   4. Sends stream_end → pipeline finalizes → message moves to conversationStore
 *   5. Pipeline disconnected (transport goes idle)
 *
 * The AbortController returned by inject() lets the caller cancel streaming
 * (e.g., user presses Escape, navigates away, sends a new message).
 *
 * Error handling:
 *   On AIProviderError: sends stream_error → pipeline marks stream as errored.
 *   On abort: sends stream_error with code 'aborted' → UI shows error state briefly.
 *
 * Concurrency:
 *   Multiple inject() calls can run simultaneously (different streamIds).
 *   Each gets its own SyntheticTransport + AbortController.
 */

import type { RenderPipeline } from '../render/pipeline.js';
import type { AIProvider, AIMessage, StreamOptions } from './provider.js';
import { AIProviderError } from './provider.js';
import { StreamSimulator } from '../telemetry/stress/simulator.js';
import type { StreamId, ConversationId } from '@pulse/types/transport';
import { PROTOCOL_VERSION, CONTROL_SEQ } from '@pulse/types/transport';
import type { SessionId, SequenceNumber } from '@pulse/types/transport';

// We reuse SyntheticTransport from the simulator module. It's already a
// complete TransportClient implementation that supports injectMessage().
// Import via the module to access the internal class.
// Since SyntheticTransport is not exported, we create a minimal shim here.

import type { TransportClient } from '@pulse/transport';
import { ok } from '@pulse/utils';
import type { ClientMessage, ConnectionState, ConnectionMetrics } from '@pulse/types/transport';
import type { MessageHandler, StateChangeHandler, ErrorHandler, UnsubscribeFn } from '@pulse/transport';
import type { StreamChangeHandler } from '@pulse/transport';
import type { StreamState } from '@pulse/types/transport';

// ─── Minimal synthetic transport for AI injection ────────────────────────────
// Lighter than SyntheticTransport from simulator.ts — no simulation timing.

class AITransport implements TransportClient {
  private readonly _msgHandlers = new Set<MessageHandler>();
  private readonly _stateHandlers = new Set<StateChangeHandler>();
  private _seq = 1;
  private _state: ConnectionState = 'idle';

  get state(): ConnectionState { return this._state; }

  get metrics(): ConnectionMetrics {
    return {
      connectedAt: Date.now(), lastPingMs: null, reconnectCount: 0,
      messagesSent: 0, messagesReceived: this._seq,
      bytesReceived: 0, sessionId: 'ai-session' as SessionId,
      lastDeliveredSeq: (this._seq - 1) as SequenceNumber,
    };
  }

  async connect(_url: string) {
    this._setState('connecting');
    this._inject({
      type: 'handshake_ack',
      sessionId: 'ai-session' as SessionId,
      serverTimestamp: Date.now(),
      protocolVersion: PROTOCOL_VERSION,
      resumedFromSeq: CONTROL_SEQ,
    });
    this._setState('connected');
    return ok(undefined);
  }

  disconnect() { this._setState('disconnected'); }
  send(_m: ClientMessage) { return ok(undefined); }
  onMessage(h: MessageHandler): UnsubscribeFn { this._msgHandlers.add(h); return () => this._msgHandlers.delete(h); }
  onStateChange(h: StateChangeHandler): UnsubscribeFn { this._stateHandlers.add(h); return () => this._stateHandlers.delete(h); }
  onError(_h: ErrorHandler): UnsubscribeFn { return () => {}; }
  onStream(_id: StreamId, _h: StreamChangeHandler): UnsubscribeFn { return () => {}; }
  getStreams(): ReadonlyArray<StreamState> { return []; }

  inject(msg: Parameters<MessageHandler>[0]): void { this._inject(msg); }
  seq(): SequenceNumber { return this._seq++ as SequenceNumber; }

  private _inject(msg: Parameters<MessageHandler>[0]): void {
    for (const h of this._msgHandlers) h(msg);
  }

  private _setState(s: ConnectionState): void {
    this._state = s;
    for (const h of this._stateHandlers) h(s);
  }
}

// Keep StreamSimulator import for type reference only (not used at runtime here)
void StreamSimulator;

// ─── StreamInjector ───────────────────────────────────────────────────────────

export interface InjectionResult {
  /** Call to cancel the stream mid-flight. */
  abort: () => void;
  /** Resolves when streaming completes (or errors/aborts). */
  completion: Promise<void>;
}

export class StreamInjector {
  private readonly _pipeline: RenderPipeline;
  private readonly _provider: AIProvider;

  constructor(pipeline: RenderPipeline, provider: AIProvider) {
    this._pipeline = pipeline;
    this._provider = provider;
  }

  inject(params: {
    messages: ReadonlyArray<AIMessage>;
    streamId: StreamId;
    conversationId: ConversationId;
    options?: StreamOptions;
  }): InjectionResult {
    const controller = new AbortController();
    const transport = new AITransport();

    // Wire transport to pipeline before connecting
    this._pipeline.connect(transport);

    const completion = this._run(transport, params, controller.signal)
      .then(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
      .finally(() => {
        this._pipeline.disconnect();
      });

    return {
      abort: () => controller.abort(),
      completion,
    };
  }

  private async _run(
    transport: AITransport,
    params: {
      messages: ReadonlyArray<AIMessage>;
      streamId: StreamId;
      conversationId: ConversationId;
      options?: StreamOptions;
    },
    signal: AbortSignal,
  ): Promise<void> {
    await transport.connect('ai://');

    const { streamId, conversationId } = params;

    // stream_start
    transport.inject({
      type: 'stream_start',
      seq: transport.seq(),
      streamId,
      conversationId,
      timestamp: Date.now(),
    });

    let tokenIndex = 0;

    try {
      for await (const token of this._provider.stream(params.messages, {
        ...params.options,
        signal,
      })) {
        if (signal.aborted) break;
        transport.inject({
          type: 'token',
          seq: transport.seq(),
          streamId,
          token,
          tokenIndex: tokenIndex++,
          timestamp: Date.now(),
        });
      }

      if (signal.aborted) {
        // User cancelled — send error so pipeline finalizes cleanly
        transport.inject({
          type: 'stream_error',
          seq: transport.seq(),
          streamId,
          code: 'aborted',
          message: 'Stream cancelled by user',
          retryable: false,
          timestamp: Date.now(),
        });
      } else {
        // stream_end
        transport.inject({
          type: 'stream_end',
          seq: transport.seq(),
          streamId,
          totalTokens: tokenIndex,
          durationMs: 0,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      const code = err instanceof AIProviderError ? err.code : 'model_error';
      transport.inject({
        type: 'stream_error',
        seq: transport.seq(),
        streamId,
        code,
        message: err instanceof Error ? err.message : String(err),
        retryable: err instanceof AIProviderError ? err.retryable : false,
        timestamp: Date.now(),
      });
    }
    // Do NOT call transport.disconnect() here — it would fire _onStateChange('disconnected')
    // which aborts all active streams before pipeline.disconnect() can flush+finalize them.
    // pipeline.disconnect() in the finally block handles teardown via flushNow().
  }
}
