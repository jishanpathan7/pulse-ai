import React from 'react';
import { useStreamStore, selectStreamContent, selectStreamStatus } from '../../store/stream-store.js';
import { StreamingMarkdown } from './streaming-markdown.js';
import type { StreamId } from '@pulse/types/transport';

interface StreamingMessageProps {
  streamId: StreamId;
}

export const StreamingMessage = React.memo(function StreamingMessage({ streamId }: StreamingMessageProps) {
  const sid = streamId as string;
  const content = useStreamStore(selectStreamContent(sid));
  const status = useStreamStore(selectStreamStatus(sid));

  if (status === null) return null;

  const isStreaming = status === 'streaming';

  return (
    <div
      className="msg"
      data-stream-id={sid}
      data-status={status}
      aria-label="Assistant message, streaming"
      aria-busy={isStreaming || status === 'finalizing'}
    >
      {/* Header */}
      <div className="msg-head">
        <div className="msg-avatar ai" aria-hidden>P</div>
        <span className="msg-author">Pulse</span>
        <span>·</span>
        <span className="msg-time">streaming</span>
        {isStreaming && (
          <span className="stream-chip" style={{ marginLeft: 'auto' }}>
            <span className="chip-bar" />
            <span>Streaming</span>
          </span>
        )}
      </div>

      {/* Body */}
      <div className="msg-body">
        {status === 'finalizing' && content.length === 0 ? (
          /* Thinking dots */
          <p style={{ display: 'flex', gap: 4, alignItems: 'center', height: '1.65em', margin: 0 }} aria-live="polite">
            {[0, 0.2, 0.4].map((delay, i) => (
              <span key={i} aria-hidden style={{
                display: 'inline-block', width: 5, height: 5,
                background: 'var(--accent)', opacity: 0.4,
                animation: `thinking-dot 1.2s ease-in-out ${delay}s infinite`,
              }} />
            ))}
          </p>
        ) : (
          <StreamingMarkdown content={content} showCursor={isStreaming} />
        )}

        {status === 'error' && (
          <div role="alert" style={{
            marginTop: 8, padding: '6px 10px',
            background: 'rgba(255,90,95,0.08)', border: '1px solid rgba(255,90,95,0.25)',
            color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 11,
          }}>
            ⚠ Stream interrupted — sequence gap detected. Recovery in progress.
          </div>
        )}
      </div>
    </div>
  );
});

StreamingMessage.displayName = 'StreamingMessage';
