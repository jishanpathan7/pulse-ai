/**
 * useVirtualizedMessages — TanStack Virtual integration for the message list.
 *
 * Combines completed messages (conversationStore) with active streams (streamStore)
 * into a single virtual list. Re-render isolation:
 *
 *   MessageList re-renders when:
 *     - messages.length changes (stream finalized → moved to conversationStore)
 *     - streamCount changes (new stream starts or ends)
 *
 *   MessageList does NOT re-render when:
 *     - Tokens arrive (StreamingMessage subscribes to streamStore directly)
 *
 * Stable virtual keys:
 *   Both completed messages and active streams use messageId as the virtual
 *   key. When a stream finalizes, the list item transitions in-place:
 *     StreamingMessage(streamId) → CompletedMessage(snapshot)
 *   TanStack Virtual sees the same key → no layout shift.
 *
 * Height estimation:
 *   Completed messages: 80px + 20px per 100 chars (fast approximation)
 *   Active stream: estimatedItemHeight (grows via ResizeObserver → re-measure)
 *   TanStack Virtual's built-in ResizeObserver updates measured sizes automatically.
 *
 * Auto-scroll:
 *   useLayoutEffect fires after paint when totalSize or itemCount changes.
 *   If scrollAnchor mode is bottom-locked or programmatic, scroll to bottom.
 *   This gives smooth streaming follow without RAF-phase jitter.
 */

import { useRef, useMemo, useLayoutEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ConversationId } from '@pulse/types/transport';
import type { MessageSnapshot, ActiveStreamSnapshot } from '@pulse/types/render';
import { useConversationStore, selectMessages } from '../../store/conversation-store.js';
import { useStreamStore, selectStreamCount } from '../../store/stream-store.js';
import { useUIStore, selectShouldAutoScroll } from '../../store/ui-store.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VirtualizedMessagesOptions {
  readonly conversationId: ConversationId;
  readonly scrollContainerRef: React.RefObject<HTMLElement | null>;
  /** Override default height estimate (px) for completed messages. Default 100. */
  readonly estimatedItemHeight?: number;
  readonly overscan?: number;
}

export interface VirtualItem {
  readonly key: string;
  readonly index: number;
  readonly start: number;
  readonly size: number;
  readonly measureRef: (el: Element | null) => void;
}

export interface VirtualMessageItem {
  readonly type: 'message';
  readonly virtual: VirtualItem;
  readonly snapshot: MessageSnapshot;
}

export interface VirtualStreamItem {
  readonly type: 'active-stream';
  readonly virtual: VirtualItem;
  /** Snapshot at list-construction time — use useActiveStream() for live content. */
  readonly snapshot: ActiveStreamSnapshot;
}

export type VirtualListItem = VirtualMessageItem | VirtualStreamItem;

export interface VirtualizedMessagesResult {
  readonly items: ReadonlyArray<VirtualListItem>;
  readonly totalHeight: number;
  readonly scrollToBottom: () => void;
  readonly scrollToIndex: (index: number, options?: { align: 'start' | 'center' | 'end' }) => void;
  readonly isVirtualizing: boolean;
}

// ─── Height Estimation ────────────────────────────────────────────────────────

const BASE_HEIGHT = 72;   // avatar + padding
const CHARS_PER_LINE = 80;
const PX_PER_LINE = 24;

function estimateMessageHeight(content: string, base: number): number {
  const lines = Math.max(1, Math.ceil(content.length / CHARS_PER_LINE));
  return base + lines * PX_PER_LINE;
}

// ─── Raw item type (pre-virtualization) ──────────────────────────────────────

type RawItem =
  | { type: 'message'; key: string; snapshot: MessageSnapshot }
  | { type: 'active-stream'; key: string; snapshot: ActiveStreamSnapshot };

// ─── Hook Implementation ──────────────────────────────────────────────────────

export function useVirtualizedMessages(
  options: VirtualizedMessagesOptions,
): VirtualizedMessagesResult {
  const { conversationId, scrollContainerRef } = options;
  const estimatedItemHeight = options.estimatedItemHeight ?? 100;
  const overscan = options.overscan ?? 3;

  const conversationIdStr = conversationId as string;

  // ── Subscriptions ─────────────────────────────────────────────────────────

  // Low-frequency: changes only when messages are added (stream finalization)
  const messages = useConversationStore(selectMessages(conversationIdStr));

  // Primitive: changes only when streams appear/disappear (not on token flush)
  const streamCount = useStreamStore(selectStreamCount);

  // Primitive: changes only when scroll mode changes
  const shouldAutoScroll = useUIStore(selectShouldAutoScroll);

  // ── Derive raw item list ──────────────────────────────────────────────────
  // Memoize on messages + streamCount. Token flushes don't change these deps.

  const rawItems = useMemo<ReadonlyArray<RawItem>>(() => {
    const items: RawItem[] = messages.map((msg) => ({
      type: 'message',
      key: msg.id as string,
      snapshot: msg,
    }));

    if (streamCount > 0) {
      // Read active streams outside React (getState) — we only need snapshot
      // for key/metadata. StreamingMessage re-subscribes for live content.
      const allStreams = useStreamStore.getState().activeStreams;
      // Guard against the finalization race: conversationStore.addMessage fires
      // before streamCount decrements (two separate Zustand store updates).
      // Filter out any stream whose messageId already exists as a completed message.
      const completedIds = new Set(messages.map((m) => m.id as string));
      for (const stream of Object.values(allStreams)) {
        if (
          (stream.conversationId as string) === conversationIdStr &&
          !completedIds.has(stream.messageId as string)
        ) {
          items.push({
            type: 'active-stream',
            key: stream.messageId as string,
            snapshot: stream,
          });
        }
      }
    }

    return items;
  }, [messages, streamCount, conversationIdStr]);

  // ── Virtualizer ───────────────────────────────────────────────────────────

  const virtualizer = useVirtualizer({
    count: rawItems.length,
    getScrollElement: () => scrollContainerRef.current ?? null,
    estimateSize: (index) => {
      const item = rawItems[index];
      if (item === undefined) return estimatedItemHeight;
      if (item.type === 'active-stream') return estimatedItemHeight;
      return estimateMessageHeight(item.snapshot.content, BASE_HEIGHT);
    },
    overscan,
    getItemKey: (index) => rawItems[index]?.key ?? index,
    // ResizeObserver-based measurement — handles growing streaming messages
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  // ── Build output items ────────────────────────────────────────────────────

  const items = useMemo<ReadonlyArray<VirtualListItem>>(() => {
    return virtualItems.map((vi): VirtualListItem => {
      const raw = rawItems[vi.index];
      if (raw === undefined) {
        // Defensive fallback — shouldn't happen
        throw new Error(`[useVirtualizedMessages] Missing raw item at index ${vi.index}`);
      }

      const virtualItem: VirtualItem = {
        key: String(vi.key),
        index: vi.index,
        start: vi.start,
        size: vi.size,
        measureRef: virtualizer.measureElement,
      };

      if (raw.type === 'message') {
        return { type: 'message', virtual: virtualItem, snapshot: raw.snapshot };
      }
      return { type: 'active-stream', virtual: virtualItem, snapshot: raw.snapshot };
    });
  }, [virtualItems, rawItems, virtualizer.measureElement]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  // Fires after layout when total height changes (content grew) and we're bottom-locked.
  // useLayoutEffect fires synchronously after DOM mutations, before paint —
  // ensures scroll position is set before the frame is shown to the user.

  const prevTotalHeight = useRef(totalHeight);

  useLayoutEffect(() => {
    if (!shouldAutoScroll) return;
    if (!scrollContainerRef.current) return;
    if (totalHeight === prevTotalHeight.current && rawItems.length === 0) return;

    prevTotalHeight.current = totalHeight;
    const el = scrollContainerRef.current;
    el.scrollTop = el.scrollHeight;
  }, [shouldAutoScroll, totalHeight, rawItems.length, scrollContainerRef]);

  // ── scrollToBottom ────────────────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [scrollContainerRef]);

  // ── scrollToIndex ─────────────────────────────────────────────────────────

  const scrollToIndex = useCallback(
    (index: number, opts?: { align: 'start' | 'center' | 'end' }) => {
      virtualizer.scrollToIndex(index, { align: opts?.align ?? 'end' });
    },
    [virtualizer],
  );

  return {
    items,
    totalHeight,
    scrollToBottom,
    scrollToIndex,
    isVirtualizing: rawItems.length > overscan * 2,
  };
}
