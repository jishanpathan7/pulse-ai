import React from 'react';
import { useTransportStore, selectConnectionState } from '../../../store/transport-store.js';
import { useStreamStore, selectStreamCount } from '../../../store/stream-store.js';
import { useTelemetryStore, selectAggregated, selectAvgFrameTime } from '../../../store/telemetry-store.js';
import { useWorkspaceStore, selectDockPanel } from '../../../workspace/workspace-store.js';

// ─── Left: connection ─────────────────────────────────────────────────────────

function ConnectionSegment() {
  const state = useTransportStore(selectConnectionState);
  const agg = useTelemetryStore(selectAggregated);

  const dotColor =
    state === 'connected'    ? 'var(--green)' :
    state === 'reconnecting' ? 'var(--yellow)' :
    state === 'failed'       ? 'var(--red)' :
                               'var(--border-3)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 12 }}>
      <span aria-hidden style={{ width: 6, height: 6, background: dotColor, flexShrink: 0 }} />
      <span style={{ color: dotColor }}>{state}</span>
      {state === 'connected' && agg.wsRttP50Ms > 0 && (
        <>
          <span style={{ color: 'var(--border-3)' }}>·</span>
          <span style={{ color: 'var(--text-4)' }}>{Math.round(agg.wsRttP50Ms)}ms</span>
        </>
      )}
      {state === 'connected' && agg.reconnectCount > 0 && (
        <>
          <span style={{ color: 'var(--border-3)' }}>·</span>
          <span style={{ color: 'var(--yellow)' }}>{agg.reconnectCount} reconnect{agg.reconnectCount !== 1 ? 's' : ''}</span>
        </>
      )}
    </div>
  );
}

// ─── Center: streams + fps ────────────────────────────────────────────────────

function StreamSegment() {
  const streamCount = useStreamStore(selectStreamCount);
  const avgFrameMs = useTelemetryStore(selectAvgFrameTime);
  const fps = avgFrameMs > 0 ? Math.min(Math.round(1000 / avgFrameMs), 144) : 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      {streamCount > 0 && (
        <>
          <span aria-hidden style={{ width: 6, height: 6, background: 'var(--accent)', flexShrink: 0, animation: 'status-pulse 1s ease-in-out infinite' }} />
          <span style={{ color: 'var(--accent)' }}>{streamCount} stream{streamCount !== 1 ? 's' : ''}</span>
          <span style={{ color: 'var(--border-3)' }}>·</span>
        </>
      )}
      {fps > 0 && (
        <span style={{ color: fps >= 55 ? 'var(--green)' : fps >= 30 ? 'var(--yellow)' : 'var(--red)' }}>
          {fps} fps
        </span>
      )}
    </div>
  );
}

// ─── Right: dock toggles ──────────────────────────────────────────────────────

function DockButtons() {
  const dockPanel = useWorkspaceStore(selectDockPanel);
  const toggleDockPanel = useWorkspaceStore((s) => s.toggleDockPanel);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0, marginLeft: 'auto', height: '100%' }}>
      {(['benchmark', 'telemetry', 'chaos'] as const).map((id) => {
        const labels: Record<string, string> = { benchmark: 'Bench', telemetry: 'Telemetry', chaos: 'Chaos' };
        const active = dockPanel === id;
        return (
          <button
            key={id}
            onClick={() => toggleDockPanel(id)}
            aria-pressed={active}
            title={`Toggle ${id}`}
            style={{
              height: '100%',
              padding: '0 12px',
              background: active ? 'var(--accent-soft)' : 'transparent',
              border: 'none',
              borderLeft: '1px solid var(--border)',
              color: active ? 'var(--accent)' : 'var(--text-4)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'all 100ms ease-out',
            }}
          >
            {labels[id]}
          </button>
        );
      })}
    </div>
  );
}

// ─── SystemStatusBar ──────────────────────────────────────────────────────────

export const SystemStatusBar = React.memo(function SystemStatusBar() {
  return (
    <footer
      className="statusbar"
      role="contentinfo"
      aria-label="System status"
      style={{ display: 'flex', justifyContent: 'space-between' }}
    >
      <ConnectionSegment />
      <StreamSegment />
      <DockButtons />
    </footer>
  );
});

SystemStatusBar.displayName = 'SystemStatusBar';
