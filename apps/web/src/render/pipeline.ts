/**
 * RenderPipeline — bridges the transport layer to the rendering stores.
 *
 * Position in the system:
 *
 *   TransportClient.onMessage(ServerMessage)
 *        │
 *   RenderPipeline._onMessage()          ← this file
 *        │
 *        ├── stream_start   → StreamBufferManager.create()
 *        │                   streamStore.startStream()
 *        │
 *        ├── token          → StreamBufferManager.push()
 *        │                   RAFScheduler.enqueue()    ← no setState yet
 *        │
 *        ├── stream_end     → StreamBufferManager.markForFinalization()
 *        │                   (tokens flush first, THEN finalize)
 *        │
 *        └── stream_error   → streamStore.errorStream()
 *
 *   RAF fires (≤1 pending) → _onFlush(batches)
 *        │
 *        ├── streamStore.commitTokenBatch(batches)     ← ONE setState per frame
 *        │
 *        └── for each batch: check finalization
 *              → streamStore.finalizeStream()
 *              → conversationStore.addMessage()        ← immutable snapshot
 *
 * Transport isolation guarantee:
 *   No component imports TransportClient.
 *   No component subscribes to onMessage.
 *   Components only read Zustand stores.
 *
 * Replay correctness:
 *   Replay-recovered messages look identical to original delivery.
 *   seq deduplication in the transport layer ensures no token is delivered twice.
 *   createActiveStream() is idempotent (stream registry guards duplicate stream_start).
 *   appendTokens() is order-dependent but delivery order is guaranteed by seq tracker.
 *
 * Initialization (in apps/web/src/main.tsx):
 *   const transport = new WsTransportClient(config);
 *   const pipeline = new RenderPipeline();
 *   pipeline.connect(transport);
 *   await transport.connect(wsUrl);
 */

import type { ServerMessage } from '@pulse/types/transport';
import type { UnsubscribeFn } from '@pulse/transport';
import type { TransportClient } from '@pulse/transport';
import type { ConnectionState } from '@pulse/types/transport';
import type { TokenFlushBatch, FrameResult } from '@pulse/types/render';

import { RAFScheduler } from './raf-scheduler.js';
import { StreamBufferManager } from './stream-buffer.js';
import { FrameBudgetMonitor } from './frame-budget.js';
import {
  NormalBatchStrategy,
  BudgetAwareBatchStrategy,
  type BatchStrategy,
} from './adaptive-batch.js';
import { randomId } from './utils.js';

// P95 threshold (ms) above which we upgrade to BudgetAwareBatchStrategy.
// 14ms = soft budget — if median frame takes this long, token batching must adapt.
const BUDGET_UPGRADE_P95_MS = 14;
// Minimum frames to observe before upgrading (avoid premature upgrade on startup).
const BUDGET_UPGRADE_MIN_FRAMES = 60;

// Store accessors — imported from store layer
// Pipeline writes to stores; components read from stores via hooks
import { useStreamStore } from '../store/stream-store.js';
import { useTransportStore } from '../store/transport-store.js';
import { useTelemetryStore } from '../store/telemetry-store.js';

import type { MessageId } from '@pulse/types/render';
import type { StreamId } from '@pulse/types/transport';

export class RenderPipeline {
  private readonly _bufferManager: StreamBufferManager;
  private readonly _scheduler: RAFScheduler;
  private readonly _frameBudget: FrameBudgetMonitor;

  /**
   * Adaptive batch strategy.
   * Starts as NormalBatchStrategy (always flush).
   * Upgrades to BudgetAwareBatchStrategy when P95 frame time exceeds soft budget.
   * Upgrade is one-way — once budget pressure detected, strategy stays aware.
   */
  private _batchStrategy: BatchStrategy = new NormalBatchStrategy();

  private _unsubscribeMessage: UnsubscribeFn | null = null;
  private _unsubscribeState: UnsubscribeFn | null = null;
  private _unsubscribeError: UnsubscribeFn | null = null;

  constructor() {
    this._bufferManager = new StreamBufferManager();
    this._frameBudget = new FrameBudgetMonitor();

    this._scheduler = new RAFScheduler(
      (batches, result) => this._onFlush(batches, result),
      (result) => {
        this._frameBudget.record(result.frameTimeMs, result.batchCount, result.totalTokens);
        useTelemetryStore.getState().recordFrame({
          frameIndex: result.batchCount,
          startedAt: result.flushedAt,
          durationMs: result.frameTimeMs,
          batchCount: result.batchCount,
          totalTokens: result.totalTokens,
          exceededBudget: result.exceededBudget,
        });
        // Check if we need to upgrade to budget-aware strategy
        this._maybeUpgradeBatchStrategy();
      },
    );
  }

  /**
   * Connect to a transport client.
   * Must be called after transport is constructed, before transport.connect().
   */
  connect(transport: TransportClient): void {
    this._unsubscribeMessage = transport.onMessage((msg) => this._onMessage(msg));
    this._unsubscribeState = transport.onStateChange((state) => this._onStateChange(state));
    this._unsubscribeError = transport.onError((error) => {
      useTelemetryStore.getState().recordTransportError(error);
    });
  }

  /**
   * Disconnect from the current transport.
   * Flushes any remaining tokens synchronously before teardown.
   */
  disconnect(): void {
    // Flush remaining tokens synchronously before teardown
    if (this._bufferManager.hasAnyPending()) {
      this._scheduler.flushNow();
    }

    this._scheduler.cancel();
    this._bufferManager.reset();

    this._unsubscribeMessage?.();
    this._unsubscribeState?.();
    this._unsubscribeError?.();
    this._unsubscribeMessage = null;
    this._unsubscribeState = null;
    this._unsubscribeError = null;
  }

  get frameBudgetMonitor(): FrameBudgetMonitor {
    return this._frameBudget;
  }

  // ─── Transport Event Handlers ─────────────────────────────────────────────

  private _onMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'stream_start': {
        const messageId = randomId() as MessageId;
        this._bufferManager.create(message.streamId, message.conversationId, messageId);
        useStreamStore.getState().startStream({
          streamId: message.streamId,
          conversationId: message.conversationId,
          messageId,
          startedAt: message.timestamp,
        });
        break;
      }

      case 'token': {
        const pushed = this._bufferManager.push(message.streamId, message.token);
        if (pushed) {
          // Check adaptive batch strategy before enqueuing
          const pending = this._scheduler.pendingTokenCount;
          const decision = this._batchStrategy.shouldFlush(pending, this._frameBudget);
          if (decision.shouldFlush) {
            this._scheduler.enqueue(message.streamId, [message.token]);
          }
          // If not flushing: token is in buffer, will be picked up next frame
        }
        break;
      }

      case 'stream_end': {
        // Mark for finalization — flush happens first on next RAF, then finalize
        this._bufferManager.markForFinalization(message.streamId, {
          streamId: message.streamId,
          totalTokens: message.totalTokens,
          durationMs: message.durationMs,
          finalizedAt: Date.now(),
          isError: false,
          errorCode: null,
        });

        // Signal that this stream needs one more flush
        const remaining = this._bufferManager.drain(message.streamId);
        if (remaining.length > 0) {
          this._scheduler.enqueue(message.streamId, remaining);
        } else {
          // No buffered tokens — trigger flush so finalization check runs
          this._scheduler.enqueue(message.streamId, []);
        }
        break;
      }

      case 'stream_error': {
        this._bufferManager.markForFinalization(message.streamId, {
          streamId: message.streamId,
          totalTokens: 0,
          durationMs: 0,
          finalizedAt: Date.now(),
          isError: true,
          errorCode: message.code,
        });

        const remaining = this._bufferManager.drain(message.streamId);
        if (remaining.length > 0) {
          this._scheduler.enqueue(message.streamId, remaining);
        } else {
          this._scheduler.enqueue(message.streamId, []);
        }
        break;
      }

      // Control messages handled by transport layer — pipeline ignores them
      case 'handshake_ack':
      case 'pong':
      case 'replay_chunk':
        break;
    }
  }

  private _onStateChange(state: ConnectionState): void {
    useTransportStore.getState().setConnectionState(state);

    if (state === 'reconnecting' || state === 'disconnected' || state === 'failed') {
      // Abort all active streams — they'll be re-started if server replays them
      useStreamStore.getState().abortAllStreams();
    }
  }

  // ─── RAF Flush Handler ───────────────────────────────────────────────────

  private _onFlush(batches: ReadonlyArray<TokenFlushBatch>, _result: FrameResult): void {
    if (batches.length === 0) {
      // Empty flush — still check for finalizations (e.g., zero-token stream_end)
      this._checkFinalizations([]);
      return;
    }

    // ONE Zustand setState for all streams in this frame
    useStreamStore.getState().commitTokenBatch(batches);

    // After token commit: check if any streams are ready to finalize
    this._checkFinalizations(batches.map((b) => b.streamId));
  }

  private _checkFinalizations(streamIds: ReadonlyArray<StreamId>): void {
    // Check all active streams for finalization (not just the flushed ones)
    // because a zero-token stream_end produces an empty flush
    for (const streamId of this._bufferManager.activeStreamIds()) {
      this._tryFinalize(streamId);
    }
    // Also check streams from this batch that may have been finalized
    for (const streamId of streamIds) {
      this._tryFinalize(streamId);
    }
  }

  private _tryFinalize(streamId: StreamId): void {
    const finData = this._bufferManager.popFinalization(streamId);
    if (finData === null) return;

    useStreamStore.getState().finalizeStream(streamId, finData);
  }

  // ─── Adaptive Strategy Upgrade ───────────────────────────────────────────

  /**
   * One-way upgrade: NormalBatchStrategy → BudgetAwareBatchStrategy.
   *
   * Conditions for upgrade:
   *   - Currently using NormalBatchStrategy (upgrade is idempotent)
   *   - At least BUDGET_UPGRADE_MIN_FRAMES observed (avoid premature upgrade)
   *   - P95 frame time exceeds soft budget (14ms)
   *
   * Once upgraded, stays BudgetAware for the session. Downgrade not implemented
   * (budget relief is handled by the strategy's flush decisions, not strategy swap).
   */
  private _maybeUpgradeBatchStrategy(): void {
    if (!(this._batchStrategy instanceof NormalBatchStrategy)) return;

    const metrics = this._frameBudget.metrics;
    if (metrics.totalFrames < BUDGET_UPGRADE_MIN_FRAMES) return;
    if (metrics.p95FrameTimeMs <= BUDGET_UPGRADE_P95_MS) return;

    this._batchStrategy = new BudgetAwareBatchStrategy({
      urgencyThreshold: 30,
      dropRateThreshold: 0.2,
    });
  }

  /** Current batch strategy — exposed for observability/testing. */
  get batchStrategyKind(): 'normal' | 'budget-aware' {
    return this._batchStrategy instanceof NormalBatchStrategy ? 'normal' : 'budget-aware';
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
// Created once in main.tsx, not inside any component.

export const renderPipeline = new RenderPipeline();
