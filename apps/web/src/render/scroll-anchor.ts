/**
 * ScrollAnchorStateMachine — pure reducer for scroll position management.
 *
 * Problem:
 *   Streaming tokens grow message height every 16ms.
 *   If user is at the bottom, they should auto-scroll to see new tokens.
 *   If user has scrolled up to read history, auto-scroll would be jarring.
 *
 * Solution: 3-mode state machine.
 *   bottom-locked   — auto-scroll fires on every content-grew event
 *   user-scrolled   — user is reading history; auto-scroll suspended
 *   programmatic    — transitional: "scroll to bottom" button pressed,
 *                     scroll is animating to bottom, not yet confirmed
 *
 * Transitions:
 *   SCROLL_UP      → user-scrolled  (any state)
 *   SCROLL_TO_BOT  → bottom-locked  (user scrolled back to bottom manually)
 *   LOCK_BOTTOM    → programmatic → (after CONTENT_GREW) → bottom-locked
 *   STREAM_START   → if bottom-locked: stay; if user-scrolled: stay
 *   CONTENT_GREW   → if bottom-locked: emit scroll-needed; else: no-op
 *
 * This is a pure reducer — no DOM, no refs, no React.
 * The scroll action (scrollToBottom) is performed by the calling component.
 */

import type { ScrollAnchorState, ScrollAnchorMode } from '@pulse/types/render';

// ─── Events ───────────────────────────────────────────────────────────────────

export type ScrollAnchorEvent =
  | {
      type: 'SCROLL';
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
    }
  | { type: 'LOCK_BOTTOM' } // "Scroll to bottom" button pressed
  | { type: 'STREAM_START' }
  | { type: 'CONTENT_GREW'; scrollHeight: number }
  | { type: 'RESET' };

// ─── Constants ────────────────────────────────────────────────────────────────

/** Within BOTTOM_THRESHOLD px of bottom → considered "at bottom". */
const BOTTOM_THRESHOLD = 64;

// ─── Initial State ────────────────────────────────────────────────────────────

export const INITIAL_SCROLL_STATE: ScrollAnchorState = {
  mode: 'bottom-locked',
  isAtBottom: true,
  lastScrollTop: 0,
  lastScrollHeight: 0,
  lastClientHeight: 0,
};

// ─── Pure Reducer ─────────────────────────────────────────────────────────────

export function reduceScrollAnchor(
  state: ScrollAnchorState,
  event: ScrollAnchorEvent,
): ScrollAnchorState {
  switch (event.type) {
    case 'SCROLL': {
      const { scrollTop, scrollHeight, clientHeight } = event;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const isAtBottom = distanceFromBottom <= BOTTOM_THRESHOLD;

      const mode: ScrollAnchorMode =
        isAtBottom ? 'bottom-locked' : 'user-scrolled';

      return {
        mode,
        isAtBottom,
        lastScrollTop: scrollTop,
        lastScrollHeight: scrollHeight,
        lastClientHeight: clientHeight,
      };
    }

    case 'LOCK_BOTTOM':
      return {
        ...state,
        mode: 'programmatic',
        isAtBottom: false, // Not confirmed yet — scroll animation in progress
      };

    case 'CONTENT_GREW': {
      // Only update scrollHeight tracking; actual scroll handled by component
      return {
        ...state,
        lastScrollHeight: event.scrollHeight,
      };
    }

    case 'STREAM_START':
      // Don't change mode on stream start — respect user's scroll position
      return state;

    case 'RESET':
      return INITIAL_SCROLL_STATE;
  }
}

// ─── Derived Queries ──────────────────────────────────────────────────────────

/** True when the component should perform an auto-scroll to bottom. */
export function shouldAutoScroll(state: ScrollAnchorState): boolean {
  return state.mode === 'bottom-locked' || state.mode === 'programmatic';
}

/** True when the "scroll to bottom" button should be visible. */
export function shouldShowScrollButton(state: ScrollAnchorState): boolean {
  return state.mode === 'user-scrolled';
}
