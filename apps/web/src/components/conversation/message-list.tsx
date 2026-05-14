/**
 * MessageList — virtualized message list for a single conversation.
 *
 * Composition:
 *   MessageList
 *     └── ScrollContainer (scroll wiring, scroll-to-bottom button)
 *           └── Virtual list (TanStack Virtual — absolute positioned items)
 *                 └── MessageItem (routes to StreamingMessage or CompletedMessage)
 *
 * Re-render breakdown:
 *   MessageList     — re-renders when messages count OR streamCount changes
 *   ScrollContainer — re-renders when scroll button visibility changes
 *   CompletedMessage — re-renders NEVER after initial render (reference equality)
 *   StreamingMessage — re-renders 60×/s during streaming (token flush)
 *
 * Empty state:
 *   Shown when no messages and no active streams.
 *   Replaced by message content on first stream_start.
 *
 * Loading state:
 *   Not handled here — transport layer handles connection state display.
 *   MessageList renders what's in the stores; stores are populated by the
 *   transport layer.
 *
 * Accessibility:
 *   role="log" marks the list as a live region for screen readers.
 *   aria-label identifies the list to assistive technologies.
 *   aria-live="polite" — new messages announced after current speech finishes.
 */

import React, { useRef } from 'react';
import type { ConversationId } from '@pulse/types/transport';
import { useVirtualizedMessages } from '../../render/hooks/use-virtualized-messages.js';
import { useConversationStore, selectMessages } from '../../store/conversation-store.js';
import { useWorkspaceStore, selectSessions, selectActiveSessionId } from '../../workspace/workspace-store.js';
import { ScrollContainer } from './scroll-container.js';
import { MessageItem } from '../message/message-item.js';

interface MessageListProps {
  conversationId: ConversationId;
  className?: string;
  style?: React.CSSProperties;
  emptyMessage?: string;
}

function ConvHeader({ conversationId }: { conversationId: ConversationId }) {
  const messages = useConversationStore(selectMessages(conversationId));
  const sessions = useWorkspaceStore(selectSessions);
  const activeId = useWorkspaceStore(selectActiveSessionId);
  const session = sessions.find((s) => s.id === activeId);
  const title = session?.title ?? 'Session';
  const msgCount = messages.length;

  return (
    <div className="conv-head">
      <div>
        <div className="conv-title">{title}</div>
        <div className="conv-sub">
          {msgCount} message{msgCount !== 1 ? 's' : ''} · active session
        </div>
      </div>
      <div className="conv-headmeta">
        <div>Messages<br /><b>{msgCount}</b></div>
        <div>Stream<br /><b style={{ color: 'var(--green)' }}>Ready</b></div>
      </div>
    </div>
  );
}

export function MessageList({
  conversationId,
  className,
  style,
}: MessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const { items, totalHeight, scrollToBottom } = useVirtualizedMessages({
    conversationId,
    scrollContainerRef,
    overscan: 3,
  });

  return (
    <div className="conv" style={{ flex: 1, ...style }}>
      <ConvHeader conversationId={conversationId} />

      <ScrollContainer
        containerRef={scrollContainerRef}
        scrollToBottom={scrollToBottom}
        {...(className !== undefined ? { className } : {})}
        style={{ flex: 1 }}
      >
        <div
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
          aria-relevant="additions"
          className="conv-stream"
          style={{ minHeight: '100%', padding: '24px 28px' }}
        >
          <div style={{ height: `${totalHeight}px`, width: '100%', position: 'relative' }}>
            {items.map((item) => (
              <div
                key={item.virtual.key}
                data-index={item.virtual.index}
                ref={item.virtual.measureRef as React.RefCallback<HTMLDivElement>}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%',
                  transform: `translateY(${item.virtual.start}px)`,
                }}
              >
                <MessageItem item={item} />
              </div>
            ))}
          </div>
        </div>
      </ScrollContainer>
    </div>
  );
}

// scrollToIndex exposed for external use (e.g., jump-to-message)
export type { MessageListProps };
