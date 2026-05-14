/**
 * Rendering pipeline type contracts.
 *
 * These types cross the boundary from transport → rendering.
 * All snapshot types are deeply readonly — mutation is a compile error.
 *
 * Taxonomy:
 *   MessageSnapshot         — immutable, committed to conversationStore on stream completion
 *   ActiveStreamSnapshot    — mutable per-frame, lives in streamStore during streaming
 *   TokenFlushBatch         — output of one RAF flush for one stream
 *   FrameResult             — metadata for one RAF flush cycle
 */

import type { StreamId, ConversationId } from './transport.js';

// ─── Branded IDs ──────────────────────────────────────────────────────────────

export type MessageId = string & { readonly _brand: 'MessageId' };

// ─── Message Roles & Status ───────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

// ─── Immutable Snapshots ──────────────────────────────────────────────────────

/**
 * Frozen message record — committed to conversationStore when streaming completes.
 * Never mutated after creation. All consumers can cache by reference equality.
 */
export interface MessageSnapshot {
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly role: MessageRole;
  readonly content: string;
  readonly status: MessageStatus;
  readonly streamId: StreamId | null;
  readonly createdAt: number;
  readonly completedAt: number | null;
  readonly tokenCount: number;
  readonly errorCode: string | null;
}

/**
 * Frozen conversation record — ordered list of MessageSnapshots.
 * Updated (new object) only when messages are added or updated.
 */
export interface ConversationSnapshot {
  readonly id: ConversationId;
  readonly messages: ReadonlyArray<MessageSnapshot>;
  readonly updatedAt: number;
  readonly messageCount: number;
}

// ─── Active Stream Snapshot ───────────────────────────────────────────────────

/**
 * Per-frame mutable view of an in-progress stream.
 * Lives in streamStore. Replaced (new object) on every RAF flush.
 * Never persisted — evicted when stream_end or stream_error received.
 *
 * content: accumulated token string (grows per frame)
 * The content field will be longer by the time the stream completes.
 */
export interface ActiveStreamSnapshot {
  readonly streamId: StreamId;
  readonly conversationId: ConversationId;
  readonly messageId: MessageId;
  readonly content: string;
  readonly tokenCount: number;
  readonly startedAt: number;
  readonly lastTokenAt: number | null;
  readonly status: 'streaming' | 'finalizing' | 'error';
  readonly errorCode: string | null;
}

// ─── RAF Scheduler Contracts ──────────────────────────────────────────────────

/**
 * Output of one RAF flush for one stream.
 * Immutable — created per flush, never modified after creation.
 */
export interface TokenFlushBatch {
  readonly streamId: StreamId;
  readonly tokens: ReadonlyArray<string>;
  readonly tokenDelta: string; // tokens.join('') — precomputed
  readonly batchSize: number;
  readonly flushedAt: number;
}

export interface FrameResult {
  readonly flushedAt: number;
  readonly frameTimeMs: number;
  readonly batchCount: number;
  readonly totalTokens: number;
  readonly exceededBudget: boolean;
}

// ─── Scroll Anchor ────────────────────────────────────────────────────────────

export type ScrollAnchorMode = 'bottom-locked' | 'user-scrolled' | 'programmatic';

export interface ScrollAnchorState {
  readonly mode: ScrollAnchorMode;
  readonly isAtBottom: boolean;
  readonly lastScrollTop: number;
  readonly lastScrollHeight: number;
  readonly lastClientHeight: number;
}

// ─── Render Metrics ───────────────────────────────────────────────────────────

export interface FrameTiming {
  readonly frameIndex: number;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly batchCount: number;
  readonly totalTokens: number;
  readonly exceededBudget: boolean;
}

export interface RenderMetrics {
  readonly totalFrames: number;
  readonly droppedFrames: number;
  readonly avgFrameTimeMs: number;
  readonly p95FrameTimeMs: number;
  readonly totalTokensRendered: number;
  readonly tokensPerSecond: number;
  readonly rafFlushCount: number;
  readonly lastMeasuredAt: number;
}

// ─── Adaptive Batch ───────────────────────────────────────────────────────────

export interface BatchDecision {
  readonly shouldFlush: boolean;
  readonly reason: 'normal' | 'budget-pressure' | 'stream-end' | 'force';
}
