/**
 * useActiveStream — subscribe to a specific active stream's content.
 *
 * Selector pattern: primitive values only. streamStore updates 60×/s during
 * streaming — returning strings/numbers (not objects) lets React bail out
 * when the specific field hasn't changed.
 *
 * Status lifecycle:
 *   streaming  → tokens arriving, content growing
 *   finalizing → stream_end received, final tokens flushing
 *   error      → stream_error received
 *   gone       → removed from streamStore (conversationStore now has snapshot)
 *
 * When status==='gone', StreamingMessage should return null.
 * The parent VirtualListItem will still render; MessageItem switches to
 * CompletedMessage which reads from conversationStore.
 */

import { useStreamStore } from '../../store/stream-store.js';
import type { StreamId } from '@pulse/types/transport';
import type { ActiveStreamSnapshot } from '@pulse/types/render';

export interface ActiveStreamResult {
  /** Current assembled content (grows per RAF flush). */
  readonly content: string;
  readonly status: ActiveStreamSnapshot['status'] | 'gone';
  readonly tokenCount: number;
  readonly startedAt: number;
  /** True when stream has been removed from streamStore (moved to conversationStore). */
  readonly isGone: boolean;
  readonly errorCode: string | null;
}

const GONE_RESULT: ActiveStreamResult = {
  content: '',
  status: 'gone',
  tokenCount: 0,
  startedAt: 0,
  isGone: true,
  errorCode: null,
};

/**
 * Subscribe to an active stream's content.
 * Returns GONE_RESULT when stream is removed from streamStore.
 *
 * Usage:
 *   function StreamingMessage({ streamId }: { streamId: StreamId }) {
 *     const { content, status, isGone } = useActiveStream(streamId);
 *     if (isGone) return null;
 *     return <div>{content}</div>;
 *   }
 */
export function useActiveStream(streamId: StreamId): ActiveStreamResult {
  // Each field is a separate selector returning a primitive.
  // This component re-renders on each token flush, but ONLY for the specific streamId.
  const content = useStreamStore((s) => s.activeStreams[streamId as string]?.content ?? null);

  // content === null means the stream is gone from the store
  const isGone = content === null;

  const status = useStreamStore((s) =>
    isGone ? null : (s.activeStreams[streamId as string]?.status ?? null),
  );
  const tokenCount = useStreamStore((s) =>
    s.activeStreams[streamId as string]?.tokenCount ?? 0,
  );
  const startedAt = useStreamStore((s) =>
    s.activeStreams[streamId as string]?.startedAt ?? 0,
  );
  const errorCode = useStreamStore((s) =>
    s.activeStreams[streamId as string]?.errorCode ?? null,
  );

  if (isGone) return GONE_RESULT;

  return {
    content: content ?? '',
    status: status ?? 'gone',
    tokenCount,
    startedAt,
    isGone: false,
    errorCode,
  };
}

/**
 * useStreamCount — number of currently active streams.
 *
 * Primitive selector — safe at layout level without re-render concern.
 * Only re-renders when count changes (stream starts or ends), not on token flush.
 */
export function useStreamCount(): number {
  return useStreamStore((s) => s.streamCount);
}
