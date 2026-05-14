/**
 * MessageItem — virtual list row renderer.
 *
 * Routes each VirtualListItem to the appropriate component:
 *   active-stream → StreamingMessage (subscribes to streamStore at 60×/s)
 *   message       → CompletedMessage (reads frozen snapshot, React.memo bails out)
 *
 * This component itself is NOT memoized — it's cheap (just a switch).
 * The children ARE memoized/optimized: StreamingMessage via React.memo,
 * CompletedMessage via React.memo + reference-equality comparator.
 *
 * Stream → completed transition:
 *   When a stream finalizes, the parent list re-renders:
 *     - active-stream item is removed (streamCount decreases)
 *     - message item is added (messages grows) with the SAME messageId key
 *   TanStack Virtual sees same key → same DOM node → no layout shift.
 *   This component smoothly switches from StreamingMessage to CompletedMessage.
 */

import type { VirtualListItem } from '../../render/hooks/use-virtualized-messages.js';
import { StreamingMessage } from './streaming-message.js';
import { CompletedMessage } from './completed-message.js';

interface MessageItemProps {
  item: VirtualListItem;
}

export function MessageItem({ item }: MessageItemProps) {
  if (item.type === 'active-stream') {
    return <StreamingMessage streamId={item.snapshot.streamId} />;
  }
  return <CompletedMessage snapshot={item.snapshot} />;
}
