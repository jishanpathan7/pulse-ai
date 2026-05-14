/**
 * uiStore — layout, panel, and scroll anchor state.
 *
 * Updated by: User interactions, scroll events, layout events
 * Read by:    Layout components, scroll container, panel toggles
 *
 * Update frequency: moderate (scroll events can be frequent but are debounced).
 *
 * Scroll anchor:
 *   Uses the pure ScrollAnchorStateMachine reducer.
 *   The store holds the state; the machine provides the transition logic.
 *   Components dispatch events via dispatchScrollEvent() — never mutate directly.
 *
 * Panel state:
 *   Sidebar, settings panel, etc.
 *   Independent from conversation/stream state — panel toggling never
 *   triggers re-renders in the message list.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ScrollAnchorState } from '@pulse/types/render';
import {
  type ScrollAnchorEvent,
  INITIAL_SCROLL_STATE,
  reduceScrollAnchor,
  shouldAutoScroll,
  shouldShowScrollButton,
} from '../render/scroll-anchor.js';

export type PanelId = 'sidebar' | 'settings' | 'debug';

interface PanelState {
  readonly isOpen: boolean;
}

interface UIState {
  readonly scrollAnchor: ScrollAnchorState;
  readonly panels: Readonly<Record<PanelId, PanelState>>;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly isMobile: boolean;
}

interface UIActions {
  dispatchScrollEvent: (event: ScrollAnchorEvent) => void;
  togglePanel: (panelId: PanelId) => void;
  openPanel: (panelId: PanelId) => void;
  closePanel: (panelId: PanelId) => void;
  setViewport: (width: number, height: number) => void;
  reset: () => void;
}

const INITIAL_PANELS: Readonly<Record<PanelId, PanelState>> = {
  sidebar: { isOpen: true },
  settings: { isOpen: false },
  debug: { isOpen: false },
};

const INITIAL_STATE: UIState = {
  scrollAnchor: INITIAL_SCROLL_STATE,
  panels: INITIAL_PANELS,
  viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1024,
  viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 768,
  isMobile: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
};

export const useUIStore = create<UIState & UIActions>()(
  subscribeWithSelector((set) => ({
    ...INITIAL_STATE,

    dispatchScrollEvent: (event) => {
      set((state) => ({
        scrollAnchor: reduceScrollAnchor(state.scrollAnchor, event),
      }));
    },

    togglePanel: (panelId) => {
      set((state) => ({
        panels: {
          ...state.panels,
          [panelId]: { isOpen: !state.panels[panelId].isOpen },
        },
      }));
    },

    openPanel: (panelId) => {
      set((state) => ({
        panels: { ...state.panels, [panelId]: { isOpen: true } },
      }));
    },

    closePanel: (panelId) => {
      set((state) => ({
        panels: { ...state.panels, [panelId]: { isOpen: false } },
      }));
    },

    setViewport: (width, height) => {
      set({
        viewportWidth: width,
        viewportHeight: height,
        isMobile: width < 768,
      });
    },

    reset: () => set(INITIAL_STATE),
  })),
);

// ─── Typed Selectors ──────────────────────────────────────────────────────────

export const selectScrollAnchor = (s: UIState & UIActions): ScrollAnchorState =>
  s.scrollAnchor;

export const selectShouldAutoScroll = (s: UIState & UIActions): boolean =>
  shouldAutoScroll(s.scrollAnchor);

export const selectShouldShowScrollButton = (s: UIState & UIActions): boolean =>
  shouldShowScrollButton(s.scrollAnchor);

export const selectIsPanelOpen =
  (panelId: PanelId) =>
  (s: UIState & UIActions): boolean =>
    s.panels[panelId].isOpen;

export const selectIsMobile = (s: UIState & UIActions): boolean => s.isMobile;
