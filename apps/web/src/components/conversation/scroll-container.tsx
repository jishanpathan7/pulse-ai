/**
 * ScrollContainer — wires the scroll element to the scroll anchor state machine.
 *
 * Responsibilities:
 *   1. Observe scroll position changes → dispatch SCROLL events to uiStore
 *   2. Observe element resize (container height change) → dispatch CONTENT_GREW
 *   3. Render "scroll to bottom" button when user has scrolled up
 *   4. Expose the scroll element ref to children via scrollContainerRef
 *
 * NOT responsible for:
 *   - Auto-scroll logic (handled in useVirtualizedMessages via useLayoutEffect)
 *   - Deciding when to show the button (shouldShowScrollButton from uiStore)
 *   - Token rendering (children handle that)
 *
 * ResizeObserver:
 *   Fires when the scroll container's HEIGHT changes (new content pushed in).
 *   Dispatches CONTENT_GREW with new scrollHeight so the FSM can track it.
 *   ResizeObserver is cleaned up on unmount.
 *
 * Scroll event throttling:
 *   onScroll fires at native rate (every pixel). We dispatch to uiStore on
 *   every event — the FSM is a pure reducer so this is cheap. If profiling
 *   shows scroll events are expensive, add a passive: true + frame-throttle.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useUIStore, selectShouldShowScrollButton } from '../../store/ui-store.js';
import type { ScrollAnchorEvent } from '../../render/scroll-anchor.js';

interface ScrollContainerProps {
  /** Ref to the scrollable element — created by parent and passed to useVirtualizedMessages. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Called when "scroll to bottom" button is pressed (from useVirtualizedMessages). */
  scrollToBottom: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function ScrollContainer({
  containerRef,
  scrollToBottom,
  className,
  style,
  children,
}: ScrollContainerProps) {
  const dispatchScrollEvent = useUIStore((s) => s.dispatchScrollEvent);
  const showScrollButton = useUIStore(selectShouldShowScrollButton);

  // ── Scroll handler ────────────────────────────────────────────────────────

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const event: ScrollAnchorEvent = {
        type: 'SCROLL',
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
      dispatchScrollEvent(event);
    },
    [dispatchScrollEvent],
  );

  // ── ResizeObserver — container height change ──────────────────────────────
  // Fires when the scrollable container itself resizes (viewport resize or
  // content overflow changes its height). Dispatches CONTENT_GREW so the
  // scroll anchor FSM knows the content dimensions changed.

  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;

    const observer = new ResizeObserver(() => {
      dispatchScrollEvent({
        type: 'CONTENT_GREW',
        scrollHeight: el.scrollHeight,
      });
    });

    observer.observe(el);
    resizeObserverRef.current = observer;

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [containerRef, dispatchScrollEvent]);

  // ── Scroll to bottom button ───────────────────────────────────────────────

  const handleScrollToBottomClick = useCallback(() => {
    scrollToBottom();
    dispatchScrollEvent({ type: 'LOCK_BOTTOM' });
  }, [scrollToBottom, dispatchScrollEvent]);

  return (
    <div
      style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      {/* Scrollable area */}
      <div
        ref={containerRef}
        className={className}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          // Enable momentum scrolling on iOS
          WebkitOverflowScrolling: 'touch',
          ...style,
        }}
        onScroll={handleScroll}
      >
        {children}
      </div>

      {/* Jump-to-latest pill */}
      {showScrollButton && (
        <button
          type="button"
          onClick={handleScrollToBottomClick}
          aria-label="Scroll to bottom"
          className="jump-pill"
        >
          <span>↓ Jump to latest</span>
          <span className="kbd" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>J</span>
        </button>
      )}
    </div>
  );
}
