import React, { useState } from 'react';
import type { MessageSnapshot } from '@pulse/types/render';
import { StreamingMarkdown } from './streaming-markdown.js';

interface CompletedMessageProps {
  snapshot: MessageSnapshot;
}

function formatAge(ts: number | null): string {
  if (ts === null) return '';
  const delta = Math.floor((Date.now() - ts) / 1000);
  if (delta < 60) return 'just now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
}

function CompletedMessageInner({ snapshot }: CompletedMessageProps) {
  const isUser = snapshot.role === 'user';
  const isSystem = snapshot.role === 'system';
  const isError = snapshot.status === 'error';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(snapshot.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRegenerate = () => {
    window.dispatchEvent(
      new CustomEvent('pulse:regenerate', {
        detail: { upToMessageId: snapshot.id as string },
        bubbles: true,
      }),
    );
  };

  if (isSystem) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }} data-message-id={snapshot.id as string}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.1em', textTransform: 'uppercase', fontStyle: 'italic' }}>
          {snapshot.content}
        </span>
      </div>
    );
  }

  return (
    <div className="msg" data-message-id={snapshot.id as string} data-role={snapshot.role}>
      {/* Header row */}
      <div className="msg-head">
        <div className={`msg-avatar ${isUser ? 'user' : 'ai'}`} aria-hidden>
          {isUser ? 'Y' : 'P'}
        </div>
        <span className="msg-author">{isUser ? 'You' : 'Pulse'}</span>
        <span>·</span>
        <span className="msg-time">{formatAge(snapshot.completedAt)}</span>
        {!isUser && snapshot.tokenCount > 0 && (
          <>
            <span style={{ marginLeft: 'auto', color: 'var(--text-4)' }}>
              {snapshot.tokenCount} tok
            </span>
          </>
        )}
      </div>

      {/* Body */}
      <div className="msg-body">
        {isUser ? (
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-2)' }}>
            {snapshot.content}
          </p>
        ) : (
          <StreamingMarkdown content={snapshot.content} showCursor={false} />
        )}

        {isError && (
          <div role="alert" style={{
            marginTop: 8, padding: '6px 10px',
            background: 'rgba(255,90,95,0.08)', border: '1px solid rgba(255,90,95,0.25)',
            color: 'var(--red)',
            fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
          }}>
            ⚠ {snapshot.errorCode !== null ? `${snapshot.errorCode} — stream interrupted` : 'Stream interrupted'}
          </div>
        )}
      </div>

      {/* Actions */}
      {!isUser && (
        <div className="msg-actions">
          <button className="msg-action" onClick={handleCopy}>
            {copied ? '✓ copied' : '⎘ copy'}
          </button>
          <button className="msg-action" onClick={handleRegenerate}>
            ↻ regenerate
          </button>
        </div>
      )}
    </div>
  );
}

function snapshotEqual(prev: CompletedMessageProps, next: CompletedMessageProps): boolean {
  return prev.snapshot === next.snapshot;
}

export const CompletedMessage = React.memo(CompletedMessageInner, snapshotEqual);
CompletedMessage.displayName = 'CompletedMessage';
