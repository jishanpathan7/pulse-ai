/**
 * Store barrel — single import point for all Zustand stores.
 *
 * Import pattern in components:
 *   import { useStreamStore, selectStreamContent } from '@/store';
 *
 * Non-React code (pipeline, scheduler) imports store hooks directly:
 *   import { useStreamStore } from '../store/stream-store.js';
 *   useStreamStore.getState().commitTokenBatch(batches);
 */

// Stores
export { useTransportStore } from './transport-store.js';
export { useStreamStore } from './stream-store.js';
export { useConversationStore } from './conversation-store.js';
export { useUIStore } from './ui-store.js';
export { useTelemetryStore } from './telemetry-store.js';

// Transport selectors
export {
  selectConnectionState,
  selectIsConnected,
  selectIsReconnecting,
  selectLastPingMs,
  selectLastError,
} from './transport-store.js';

// Stream selectors
export {
  selectStreamContent,
  selectStreamStatus,
  selectActiveStreamIds,
  selectStreamCount,
} from './stream-store.js';

// Conversation selectors
export {
  selectConversation,
  selectActiveConversation,
  selectMessages,
  selectMessageCount,
  selectConversationCount,
} from './conversation-store.js';

// UI selectors
export {
  selectScrollAnchor,
  selectShouldAutoScroll,
  selectShouldShowScrollButton,
  selectIsPanelOpen,
  selectIsMobile,
} from './ui-store.js';

// Telemetry selectors
export {
  selectRenderMetrics,
  selectDroppedFrames,
  selectAvgFrameTime,
  selectRecentErrors,
  selectTotalErrors,
} from './telemetry-store.js';
