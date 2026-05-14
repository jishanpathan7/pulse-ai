import React, { useEffect, useRef, useState } from 'react';
import { useTelemetryStore, selectAggregated } from '../../../store/telemetry-store.js';
import { useTransportStore, selectIsConnected } from '../../../store/transport-store.js';

const REPLAY_ACTIVE_WINDOW_MS = 3_000;

export const ReplayIndicator = React.memo(function ReplayIndicator() {
  const agg = useTelemetryStore(selectAggregated);
  const isConnected = useTransportStore(selectIsConnected);

  const lastReplayCountRef = useRef(0);
  const lastSeenAtRef = useRef(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isConnected) { setVisible(false); lastReplayCountRef.current = 0; return; }
    if (agg.replayCount > lastReplayCountRef.current) {
      lastReplayCountRef.current = agg.replayCount;
      lastSeenAtRef.current = Date.now();
      setVisible(true);
    } else if (visible && Date.now() - lastSeenAtRef.current > REPLAY_ACTIVE_WINDOW_MS) {
      setVisible(false);
    }
  }, [agg.replayCount, agg.capturedAt, isConnected, visible]);

  if (!visible) return null;

  return (
    <div role="status" aria-label="Replaying missed messages" className="banner warn">
      <div className="left">
        {/* Animated progress bar */}
        <div style={{ width: 80, height: 2, background: 'rgba(255,234,38,0.15)', position: 'relative', overflow: 'hidden' }}>
          <div aria-hidden style={{
            position: 'absolute', inset: 0, width: '60%',
            background: 'var(--yellow)',
            animation: 'replay-progress 1.5s ease-in-out infinite',
          }} />
        </div>
        <span>Gap recovery</span>
        <span style={{ opacity: 0.6 }}>{agg.replayCount} chunk{agg.replayCount !== 1 ? 's' : ''}</span>
      </div>
      <div className="right">
        {agg.replayDurationP95Ms > 0 && (
          <span style={{ opacity: 0.6 }}>p95 {Math.round(agg.replayDurationP95Ms)}ms</span>
        )}
      </div>
    </div>
  );
});

ReplayIndicator.displayName = 'ReplayIndicator';
