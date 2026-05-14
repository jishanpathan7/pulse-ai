/**
 * DebugOverlay — floating performance monitor for development.
 *
 * Architecture:
 *   - Only mounts in dev (gated at call site in App; tree-shaken in prod)
 *   - Toggle: Ctrl+Shift+D
 *   - Draggable: pointer-events on header only (body is pass-through)
 *   - Re-render gate: subscribes to selectLastAggregatedAt (1Hz primitive)
 *     to trigger re-renders. Each panel then reads its own slice of selectAggregated.
 *
 * Render cost:
 *   - Overlay hidden → nothing subscribed, no renders
 *   - Overlay visible → panels re-render at most 1Hz (StoreSink write cadence)
 *   - FpsPanel budget bars update at 60Hz via separate primitive selectors
 *     (React.memo bails out when the number hasn't changed)
 *
 * Panels:
 *   FpsPanel       — frame timing, budget bars, dropped frames
 *   StreamPanel    — TTFT, tokens/s, stream counts
 *   TransportPanel — RTT, reconnects, replay metrics
 *   SchedulerPanel — queue depth, batch strategy, virtualization
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FpsPanel } from './panels/fps-panel.js';
import { StreamPanel } from './panels/stream-panel.js';
import { TransportPanel } from './panels/transport-panel.js';
import { SchedulerPanel } from './panels/scheduler-panel.js';
import { useTelemetryStore, selectLastAggregatedAt } from '../../store/telemetry-store.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type PanelId = 'fps' | 'stream' | 'transport' | 'scheduler';

const PANELS: { id: PanelId; label: string }[] = [
  { id: 'fps',       label: 'Render' },
  { id: 'stream',    label: 'Streams' },
  { id: 'transport', label: 'Transport' },
  { id: 'scheduler', label: 'Scheduler' },
];

// ─── Drag logic ───────────────────────────────────────────────────────────────

function useDrag(initialX: number, initialY: number) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return { pos, onPointerDown, onPointerMove, onPointerUp };
}

// ─── DebugOverlayInner ────────────────────────────────────────────────────────
// Separate component so the 1Hz subscription only runs when overlay is visible.

const DebugOverlayInner = React.memo(function DebugOverlayInner({
  onClose,
}: {
  onClose: () => void;
}) {
  // 1Hz gate — re-renders this component (and child panels) when batcher fires.
  // Panels that only need this cadence read selectAggregated directly.
  useTelemetryStore(selectLastAggregatedAt);

  const [activePanel, setActivePanel] = useState<PanelId>('fps');
  const { pos, onPointerDown, onPointerMove, onPointerUp } = useDrag(
    window.innerWidth - 260,
    16,
  );

  return (
    <div
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        zIndex: 9999,
        width: 240,
        background: 'rgba(10, 14, 20, 0.92)',
        border: '1px solid #1e293b',
        borderRadius: 8,
        backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        fontFamily: '"JetBrains Mono", "Fira Mono", "Cascadia Code", monospace',
        userSelect: 'none',
        color: '#e2e8f0',
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Header — drag handle */}
      <div
        onPointerDown={onPointerDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: '1px solid #1e293b',
          cursor: 'grab',
        }}
      >
        <span style={{ fontSize: 9, fontWeight: 700, color: '#38bdf8', letterSpacing: '0.1em' }}>
          ⚡ PULSE TELEMETRY
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#475569',
            cursor: 'pointer',
            fontSize: 12,
            lineHeight: 1,
            padding: 2,
          }}
          aria-label="Close debug overlay"
        >
          ✕
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e293b' }}>
        {PANELS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActivePanel(id)}
            style={{
              flex: 1,
              padding: '4px 0',
              fontSize: 9,
              fontWeight: activePanel === id ? 700 : 400,
              color: activePanel === id ? '#38bdf8' : '#475569',
              background: 'none',
              border: 'none',
              borderBottom: activePanel === id ? '2px solid #38bdf8' : '2px solid transparent',
              cursor: 'pointer',
              letterSpacing: '0.05em',
              fontFamily: 'inherit',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div style={{ padding: '10px 12px' }}>
        {activePanel === 'fps'       && <FpsPanel />}
        {activePanel === 'stream'    && <StreamPanel />}
        {activePanel === 'transport' && <TransportPanel />}
        {activePanel === 'scheduler' && <SchedulerPanel />}
      </div>

      {/* Footer */}
      <div style={{
        padding: '4px 10px',
        borderTop: '1px solid #1e293b',
        fontSize: 9,
        color: '#334155',
        textAlign: 'center',
      }}>
        Ctrl+Shift+D to hide
      </div>
    </div>
  );
});

// ─── DebugOverlay ─────────────────────────────────────────────────────────────

export function DebugOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const close = useCallback(() => setVisible(false), []);

  if (!visible) return null;
  return <DebugOverlayInner onClose={close} />;
}
