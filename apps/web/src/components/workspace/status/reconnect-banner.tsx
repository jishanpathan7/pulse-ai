import React from 'react';
import { useTransportStore, selectConnectionState, selectLastError } from '../../../store/transport-store.js';

const selectReconnectCount = (s: { metrics: { reconnectCount: number } }) => s.metrics.reconnectCount;

export const ReconnectBanner = React.memo(function ReconnectBanner() {
  const state = useTransportStore(selectConnectionState);
  const reconnectCount = useTransportStore(selectReconnectCount);
  const lastError = useTransportStore(selectLastError);

  if (state !== 'connecting' && state !== 'reconnecting' && state !== 'failed') return null;

  const isFailed = state === 'failed';
  const isReconnecting = state === 'reconnecting';

  const bannerClass = isFailed ? 'banner err' : 'banner recon';

  return (
    <div role="status" aria-live="polite" className={bannerClass}>
      <div className="left">
        <span aria-hidden style={{
          display: 'inline-block',
          animation: !isFailed ? 'spin 1s linear infinite' : undefined,
        }}>
          {isFailed ? '✕' : '⟳'}
        </span>
        <span>
          {isFailed
            ? 'Connection failed'
            : isReconnecting
            ? 'Connection lost — reconnecting'
            : 'Establishing connection'}
        </span>
        {reconnectCount > 0 && (
          <span style={{ opacity: 0.7 }}>attempt {reconnectCount}</span>
        )}
      </div>
      <div className="right">
        {lastError !== null && (
          <span style={{ color: 'var(--text-4)', fontSize: 10 }}>{lastError.code}</span>
        )}
        {!isFailed && (
          <span aria-hidden style={{ display: 'flex', gap: 3 }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{
                width: 4, height: 4,
                background: 'currentColor', opacity: 0.3,
                animation: `reconnect-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
              }} />
            ))}
          </span>
        )}
        {isFailed && (
          <button onClick={() => window.location.reload()}>Reload</button>
        )}
      </div>
    </div>
  );
});

ReconnectBanner.displayName = 'ReconnectBanner';
