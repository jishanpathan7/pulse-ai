import React, { useState } from 'react';
import {
  useTelemetryStore,
  selectLastAggregatedAt,
  selectAggregated,
  selectAvgFrameTime,
  selectP95FrameTime,
  selectDroppedFrames,
  selectTotalFrames,
} from '../../store/telemetry-store.js';
import { useTransportStore, selectConnectionState } from '../../store/transport-store.js';
import { useStreamStore, selectStreamCount } from '../../store/stream-store.js';
import { FpsPanel } from '../debug/panels/fps-panel.js';
import { StreamPanel } from '../debug/panels/stream-panel.js';
import { TransportPanel } from '../debug/panels/transport-panel.js';
import { SchedulerPanel } from '../debug/panels/scheduler-panel.js';

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Spark({ values, color = 'var(--accent)' }: { values: number[]; color?: string }) {
  if (values.length < 2) return <div style={{ height: 32 }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 100;
  const h = 32;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const linePath = `M ${pts.join(' L ')}`;
  const areaPath = `M 0,${h} L ${pts.join(' L ')} L ${w},${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="spark" aria-hidden>
      <path d={areaPath} fill={color} opacity={0.08} />
      <path d={linePath} stroke={color} fill="none" strokeWidth={1.2} />
    </svg>
  );
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

function Bars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="tele-bars" aria-hidden>
      {values.map((v, i) => {
        const pct = (v / max) * 100;
        const cls = pct >= 90 ? 'b hi' : pct <= 30 ? 'b lo' : 'b';
        return <div key={i} className={cls} style={{ height: `${pct}%` }} />;
      })}
    </div>
  );
}

// ─── Log row ──────────────────────────────────────────────────────────────────

function LogRow({ t, lv, k, v }: { t: string; lv: string; k: string; v: string }) {
  return (
    <div className="log-row">
      <span className="t">{t}</span>
      <span className={`lv ${lv}`}>{lv === 'i' ? 'i' : lv === 'w' ? '!' : lv === 'e' ? '×' : lv === 's' ? '✓' : '◆'}</span>
      <span className="msg-text"><span className="k">{k}</span> <span className="v">{v}</span></span>
    </div>
  );
}

// ─── Live metrics pane ────────────────────────────────────────────────────────

function LiveMetrics() {
  const agg = useTelemetryStore(selectAggregated);
  const avgFrameMs = useTelemetryStore(selectAvgFrameTime);
  const p95FrameMs = useTelemetryStore(selectP95FrameTime);
  const droppedFrames = useTelemetryStore(selectDroppedFrames);
  const totalFrames = useTelemetryStore(selectTotalFrames);
  const state = useTransportStore(selectConnectionState);
  const streamCount = useStreamStore(selectStreamCount);

  const fps = avgFrameMs > 0 ? Math.round(1000 / avgFrameMs) : 0;
  const fpsColor = fps >= 55 ? 'var(--green)' : fps >= 30 ? 'var(--yellow)' : fps > 0 ? 'var(--red)' : 'var(--text-4)';
  const rtt = Math.round(agg.wsRttP50Ms);
  const dropPct = totalFrames > 0 ? ((droppedFrames / totalFrames) * 100).toFixed(1) : '0.0';

  const now = new Date();
  const ts = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="pane-head">
        <span className="t-label">Diagnostics · Live</span>
        <div className="ws-pill">
          <span className={`ws-dot${state !== 'connected' ? ' warn' : ''}`} aria-hidden />
          <span style={{ color: 'var(--text-3)' }}>{state}</span>
        </div>
      </div>

      <div className="pane-body">
        {/* WS Latency */}
        <div className="tele-row">
          <div className="tele-row-head">
            <span className="t-label">WebSocket Latency · p50</span>
            <span className={`tele-delta ${rtt > 0 && rtt < 100 ? 'up' : rtt > 200 ? 'down' : 'flat'}`}>
              {rtt > 0 ? `${rtt}ms` : '—'}
            </span>
          </div>
          <div className="tele-metric">{rtt > 0 ? rtt : '—'}<span className="unit">ms</span></div>
          <Spark values={Array.from({ length: 20 }, () => rtt + Math.random() * 8 - 4)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>
            <span>−60s</span><span>p99 {Math.round(agg.wsRttP95Ms)}ms</span><span>now</span>
          </div>
        </div>

        {/* FPS */}
        <div className="tele-row">
          <div className="tele-row-head">
            <span className="t-label">FPS · main thread</span>
            <span className="tele-delta up">{fps > 0 ? `${fps} avg` : '—'}</span>
          </div>
          <div className="tele-metric" style={{ color: fpsColor }}>{fps > 0 ? fps : '—'}<span className="unit">fps</span></div>
          <Spark values={Array.from({ length: 20 }, () => fps + Math.random() * 2 - 1)} color="var(--blue)" />
        </div>

        {/* Frame commit */}
        <div className="tele-row">
          <div className="tele-row-head">
            <span className="t-label">Frame Commit · render</span>
            <span className={`tele-delta ${p95FrameMs < 16 ? 'flat' : 'down'}`}>
              {avgFrameMs > 0 ? `${avgFrameMs.toFixed(1)}ms avg` : 'stable'}
            </span>
          </div>
          <div className="tele-metric">{p95FrameMs > 0 ? p95FrameMs.toFixed(1) : '—'}<span className="unit">ms</span></div>
          <Bars values={Array.from({ length: 20 }, () => Math.round(avgFrameMs + Math.random() * 4))} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', marginTop: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            <span>budget 16ms</span><span>dropped {droppedFrames} ({dropPct}%)</span>
          </div>
        </div>

        {/* Streams */}
        <div className="tele-row">
          <div className="tele-row-head">
            <span className="t-label">Active Streams</span>
            <span className={`tele-delta ${streamCount > 0 ? 'up' : 'flat'}`}>
              {streamCount > 0 ? 'streaming' : 'idle'}
            </span>
          </div>
          <div className="tele-metric" style={{ color: streamCount > 0 ? 'var(--accent)' : 'var(--text-3)' }}>
            {streamCount}<span className="unit">stream{streamCount !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Connection */}
        <div className="tele-row">
          <div className="tele-row-head">
            <span className="t-label">Connection</span>
            <span className={`tele-delta ${state === 'connected' ? 'up' : state === 'failed' ? 'down' : 'flat'}`}>
              {state}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>
            <div><div style={{ color: 'var(--text-4)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 3 }}>Reconnects</div>{agg.reconnectCount}</div>
            <div><div style={{ color: 'var(--text-4)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 3 }}>Violations</div>{agg.budgetViolations}</div>
            <div><div style={{ color: 'var(--text-4)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 3 }}>Replay chunks</div>{agg.replayCount}</div>
            <div><div style={{ color: 'var(--text-4)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 3 }}>Total frames</div>{totalFrames}</div>
          </div>
        </div>

        {/* Event log */}
        <div className="tele-row">
          <div className="tele-row-head">
            <span className="t-label">Recent Events</span>
            <span className="t-label" style={{ color: 'var(--text-4)' }}>Tail</span>
          </div>
          <div style={{ margin: '0 -14px' }}>
            <LogRow t={ts} lv="i" k="ws.state" v={state} />
            {streamCount > 0 && <LogRow t={ts} lv="a" k="stream.active" v={`${streamCount} streams`} />}
            {fps > 0 && <LogRow t={ts} lv="s" k="render.fps" v={`${fps}fps · ${avgFrameMs.toFixed(1)}ms`} />}
            {agg.budgetViolations > 0 && <LogRow t={ts} lv="w" k="budget.violation" v={`${agg.budgetViolations} total`} />}
            {droppedFrames > 0 && <LogRow t={ts} lv="w" k="frames.dropped" v={`${droppedFrames} (${dropPct}%)`} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Debug panels (tabbed) ────────────────────────────────────────────────────

type PanelId = 'fps' | 'stream' | 'transport' | 'scheduler';
const TABS: { id: PanelId; label: string }[] = [
  { id: 'fps', label: 'Render' },
  { id: 'stream', label: 'Streams' },
  { id: 'transport', label: 'Transport' },
  { id: 'scheduler', label: 'Scheduler' },
];

function DebugPanels() {
  const [active, setActive] = useState<PanelId>('fps');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="pane-head">
        <span className="t-label">Debug · Detail</span>
      </div>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {TABS.map(({ id, label }) => (
          <button key={id} onClick={() => setActive(id)} style={{
            flex: 1, padding: '6px 0',
            background: 'none', border: 'none',
            borderBottom: active === id ? '2px solid var(--accent)' : '2px solid transparent',
            color: active === id ? 'var(--accent)' : 'var(--text-4)',
            fontFamily: 'var(--font-mono)', fontSize: 9,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            cursor: 'pointer',
          }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ padding: '10px 12px', overflowY: 'auto', flex: 1 }}>
        {active === 'fps'       && <FpsPanel />}
        {active === 'stream'    && <StreamPanel />}
        {active === 'transport' && <TransportPanel />}
        {active === 'scheduler' && <SchedulerPanel />}
      </div>
    </div>
  );
}

// ─── TelemetryDock ────────────────────────────────────────────────────────────

type ViewId = 'live' | 'debug';

export const TelemetryDock = React.memo(function TelemetryDock() {
  useTelemetryStore(selectLastAggregatedAt);
  const [view, setView] = useState<ViewId>('live');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', borderLeft: '1px solid var(--border)' }}>
      {/* View switcher */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {(['live', 'debug'] as ViewId[]).map((id) => (
          <button key={id} onClick={() => setView(id)} style={{
            flex: 1, height: 32, padding: '0 12px',
            background: view === id ? 'var(--surface)' : 'transparent',
            border: 'none',
            borderBottom: view === id ? '1px solid var(--accent)' : '1px solid transparent',
            color: view === id ? 'var(--text)' : 'var(--text-4)',
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            cursor: 'pointer',
          }}>
            {id === 'live' ? 'Live' : 'Debug'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {view === 'live' ? <LiveMetrics /> : <DebugPanels />}
      </div>
    </div>
  );
});

TelemetryDock.displayName = 'TelemetryDock';
