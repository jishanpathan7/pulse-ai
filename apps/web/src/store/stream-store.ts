/**
 * streamStore — transient state for in-progress streams.
 *
 * Updated by: RenderPipeline._onFlush() (via commitTokenBatch)
 * Read by:    Active streaming message component ONLY
 *
 * Critical performance constraint:
 *   commitTokenBatch() is called up to 60 times/second during streaming.
 *   Only the component subscribing to the specific active stream re-renders.
 *   All other components are unaffected by token flush updates.
 *
 * Zustand selector pattern for streaming component:
 *   const content = useStreamStore(s => s.activeStreams[streamId]?.content ?? '');
 *   The selector returns a primitive (string) — React.memo can bail out.
 *
 * Lifecycle:
 *   startStream()      → creates ActiveStreamSnapshot (status: streaming)
 *   commitTokenBatch() → updates content + tokenCount per stream (status: streaming)
 *   finalizeStream()   → removes from activeStreams, calls conversationStore.addMessage()
 *   errorStream()      → marks status: error, leaves in activeStreams briefly
 *   abortAllStreams()  → clears all (on disconnect/reconnect)
 *
 * Note: activeStreams is a plain object (not Map) for Zustand selector compatibility.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { StreamId, ConversationId } from '@pulse/types/transport';
import type { MessageId, ActiveStreamSnapshot, TokenFlushBatch } from '@pulse/types/render';
import {
  createActiveStream,
  appendTokens,
  markStreamError,
  snapshotFromActiveStream,
} from '../render/snapshot.js';
import { useConversationStore } from './conversation-store.js';
import type { StreamFinalizationData } from '../render/stream-buffer.js';

interface StreamState {
  /** Active streams keyed by streamId. Plain object for selector stability. */
  readonly activeStreams: Readonly<Record<string, ActiveStreamSnapshot>>;
  readonly streamCount: number;
}

interface StreamActions {
  startStream: (params: {
    streamId: StreamId;
    conversationId: ConversationId;
    messageId: MessageId;
    startedAt: number;
  }) => void;

  commitTokenBatch: (batches: ReadonlyArray<TokenFlushBatch>) => void;

  finalizeStream: (streamId: StreamId, data: StreamFinalizationData) => void;

  errorStream: (streamId: StreamId, errorCode: string) => void;

  abortAllStreams: () => void;
}

const INITIAL_STATE: StreamState = {
  activeStreams: {},
  streamCount: 0,
};

export const useStreamStore = create<StreamState & StreamActions>()(
  subscribeWithSelector((set, get) => ({
    ...INITIAL_STATE,

    startStream: ({ streamId, conversationId, messageId, startedAt }) => {
      set((state) => {
        const id = streamId as string;
        if (id in state.activeStreams) return state; // Idempotent

        const snapshot = createActiveStream({ streamId, conversationId, messageId, startedAt });
        return {
          activeStreams: { ...state.activeStreams, [id]: snapshot },
          streamCount: state.streamCount + 1,
        };
      });
    },

    /**
     * Hot path — called up to 60×/s during streaming.
     * Creates new object (immutable update) per stream per frame.
     * Only subscribers to the specific streamId re-render.
     */
    commitTokenBatch: (batches) => {
      if (batches.length === 0) return;

      set((state) => {
        const next = { ...state.activeStreams };
        let changed = false;

        for (const batch of batches) {
          const id = batch.streamId as string;
          const current = next[id];
          if (current === undefined || current.status !== 'streaming') continue;

          next[id] = appendTokens(current, batch.tokenDelta, batch.batchSize, batch.flushedAt);
          changed = true;
        }

        return changed ? { activeStreams: next } : state;
      });
    },

    finalizeStream: (streamId, data) => {
      const state = get();
      const id = streamId as string;
      const current = state.activeStreams[id];
      if (current === undefined) return;

      const completedAt = data.finalizedAt;

      // Move to conversationStore (cross-store action via direct import)
      if (!data.isError) {
        useConversationStore.getState().addMessage(
          current.conversationId,
          snapshotFromActiveStream(current, completedAt),
        );
      }

      // Remove from active streams
      set((prev) => {
        const next = { ...prev.activeStreams };
        delete next[id];
        return { activeStreams: next, streamCount: Math.max(0, prev.streamCount - 1) };
      });
    },

    errorStream: (streamId, errorCode) => {
      set((state) => {
        const id = streamId as string;
        const current = state.activeStreams[id];
        if (current === undefined) return state;
        return {
          activeStreams: {
            ...state.activeStreams,
            [id]: markStreamError(current, errorCode),
          },
        };
      });
    },

    abortAllStreams: () => {
      set(INITIAL_STATE);
    },
  })),
);

// ─── Typed Selectors ──────────────────────────────────────────────────────────

/** Returns the content string for a specific stream. Primitive — no re-render thrash. */
export const selectStreamContent =
  (streamId: string) =>
  (s: StreamState & StreamActions): string =>
    s.activeStreams[streamId]?.content ?? '';

export const selectStreamStatus =
  (streamId: string) =>
  (s: StreamState & StreamActions): ActiveStreamSnapshot['status'] | null =>
    s.activeStreams[streamId]?.status ?? null;

export const selectActiveStreamIds = (s: StreamState & StreamActions): ReadonlyArray<string> =>
  Object.keys(s.activeStreams);

export const selectStreamCount = (s: StreamState & StreamActions): number => s.streamCount;
