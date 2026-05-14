/**
 * conversationStore — immutable render-ready conversation snapshots.
 *
 * Updated by: streamStore.finalizeStream() (stream completion)
 *             Direct calls for user messages (Phase 6+)
 * Read by:    Conversation list, message list, virtualized scroll container
 *
 * Update frequency: low (only on message complete or new user message).
 * Compare to streamStore which updates 60×/s during streaming —
 * this store is calm: most renders come from other stores.
 *
 * Snapshot immutability:
 *   All stored objects are Object.freeze()'d via snapshot factories.
 *   React.memo can use reference equality to bail out of re-renders.
 *   When a stream completes:
 *     - Old conversation snapshot reference → stale (React bails out on memo'd children)
 *     - New conversation snapshot reference → only the conversation list re-renders
 *     - Individual message snapshots unchanged → their memo'd components skip render
 *
 * Normalization:
 *   conversations: Record<conversationId, ConversationSnapshot>
 *   No nested mutable state — flat record of frozen snapshots.
 *
 * Active conversation:
 *   Tracked separately from conversation data.
 *   Changing active conversation doesn't mutate snapshot data.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ConversationId } from '@pulse/types/transport';
import type { MessageSnapshot, ConversationSnapshot } from '@pulse/types/render';
import {
  createConversationSnapshot,
  appendMessage,
  replaceMessage,
} from '../render/snapshot.js';

interface ConversationState {
  readonly conversations: Readonly<Record<string, ConversationSnapshot>>;
  readonly activeConversationId: ConversationId | null;
  readonly conversationCount: number;
}

interface ConversationActions {
  addMessage: (conversationId: ConversationId, message: MessageSnapshot) => void;
  updateMessage: (conversationId: ConversationId, message: MessageSnapshot) => void;
  setActiveConversation: (id: ConversationId | null) => void;
  ensureConversation: (id: ConversationId) => void;
  /** Bulk-load messages from backend (initial hydration). Overwrites existing. */
  loadMessages: (conversationId: ConversationId, messages: MessageSnapshot[]) => void;
  reset: () => void;
}

const INITIAL_STATE: ConversationState = {
  conversations: {},
  activeConversationId: null,
  conversationCount: 0,
};

export const useConversationStore = create<ConversationState & ConversationActions>()(
  subscribeWithSelector((set) => ({
    ...INITIAL_STATE,

    addMessage: (conversationId, message) => {
      set((state) => {
        const id = conversationId as string;
        const existing = state.conversations[id];
        const now = Date.now();

        const conversation =
          existing !== undefined
            ? appendMessage(existing, message)
            : createConversationSnapshot({
                id: conversationId,
                messages: [message],
                updatedAt: now,
              });

        const isNew = existing === undefined;
        return {
          conversations: { ...state.conversations, [id]: conversation },
          conversationCount: isNew
            ? state.conversationCount + 1
            : state.conversationCount,
        };
      });
    },

    updateMessage: (conversationId, message) => {
      set((state) => {
        const id = conversationId as string;
        const existing = state.conversations[id];
        if (existing === undefined) return state;

        return {
          conversations: {
            ...state.conversations,
            [id]: replaceMessage(existing, message),
          },
        };
      });
    },

    setActiveConversation: (activeConversationId) => {
      set({ activeConversationId });
    },

    loadMessages: (conversationId, messages) => {
      set((state) => {
        const id = conversationId as string;
        const conversation = createConversationSnapshot({
          id: conversationId,
          messages,
          updatedAt: Date.now(),
        });
        return {
          conversations: { ...state.conversations, [id]: conversation },
          conversationCount: id in state.conversations
            ? state.conversationCount
            : state.conversationCount + 1,
        };
      });
    },

    ensureConversation: (conversationId) => {
      set((state) => {
        const id = conversationId as string;
        if (id in state.conversations) return state;

        const conversation = createConversationSnapshot({
          id: conversationId,
          messages: [],
          updatedAt: Date.now(),
        });

        return {
          conversations: { ...state.conversations, [id]: conversation },
          conversationCount: state.conversationCount + 1,
        };
      });
    },

    reset: () => set(INITIAL_STATE),
  })),
);

// ─── Typed Selectors ──────────────────────────────────────────────────────────

export const selectConversation =
  (id: string) =>
  (s: ConversationState & ConversationActions): ConversationSnapshot | null =>
    s.conversations[id] ?? null;

export const selectActiveConversation = (
  s: ConversationState & ConversationActions,
): ConversationSnapshot | null => {
  const id = s.activeConversationId;
  if (id === null) return null;
  return s.conversations[id as string] ?? null;
};

const EMPTY_MESSAGES: ReadonlyArray<MessageSnapshot> = Object.freeze([]);

export const selectMessages =
  (conversationId: string) =>
  (s: ConversationState & ConversationActions): ReadonlyArray<MessageSnapshot> =>
    s.conversations[conversationId]?.messages ?? EMPTY_MESSAGES;

export const selectMessageCount =
  (conversationId: string) =>
  (s: ConversationState & ConversationActions): number =>
    s.conversations[conversationId]?.messageCount ?? 0;

export const selectConversationCount = (s: ConversationState & ConversationActions): number =>
  s.conversationCount;
