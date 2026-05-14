/**
 * Component barrel — public surface of the components layer.
 *
 * Import policy:
 *   Components import from stores and render hooks.
 *   Stores do NOT import from components.
 *   Transport layer does NOT import from components.
 *   Components are pure rendering — all data via stores or props.
 */

// Message rendering
export { StreamingMessage } from './message/streaming-message.js';
export { CompletedMessage } from './message/completed-message.js';
export { MessageItem } from './message/message-item.js';

// Conversation layout
export { MessageList } from './conversation/message-list.js';
export { ScrollContainer } from './conversation/scroll-container.js';

// Debug overlay (dev only — tree-shaken in prod via IS_DEV gate in App)
export { DebugOverlay } from './debug/debug-overlay.js';

// Types re-exported for consumers
export type { MessageListProps } from './conversation/message-list.js';
