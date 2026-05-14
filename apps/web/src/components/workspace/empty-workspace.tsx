import React from 'react';
import { useWorkspaceStore } from '../../workspace/workspace-store.js';
import { useTransportStore, selectConnectionState } from '../../store/transport-store.js';
import { useUIStore } from '../../store/ui-store.js';

// ─── Starter cell ─────────────────────────────────────────────────────────────

function StarterCell({ n, title, desc, kbd, accent, onClick }: {
  n: string; title: string; desc: string; kbd: string; accent?: boolean; onClick?: () => void;
}) {
  return (
    <div
      className="cell"
      style={accent ? { background: 'rgba(255,74,28,0.04)' } : undefined}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
      <div className="cell-num" style={accent ? { color: 'var(--accent)' } : undefined}>{n}</div>
      <div className="cell-title">{title}</div>
      <div className="cell-desc">{desc}</div>
      <div className="cell-foot">
        <span>{accent ? 'free-form' : 'preset'}</span>
        <span className="kbd" style={accent ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>{kbd}</span>
      </div>
    </div>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="shortcut-row">
      <span>{label}</span>
      <span className="keys">
        {keys.length
          ? keys.map((k, i) => <span key={i} className="kbd">{k}</span>)
          : <span style={{ color: 'var(--text-4)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>—</span>}
      </span>
    </div>
  );
}

function RecentRow({ nm, meta, accent }: { nm: string; meta: string; accent?: boolean }) {
  return (
    <div className="recent-row">
      <span className="nm" style={accent ? { color: 'var(--accent)' } : undefined}>{nm}</span>
      <span className="mt">{meta}</span>
    </div>
  );
}

function Probe({ ok, label, val }: { ok: boolean; label: string; val: string }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '12px 1fr auto', gap: 10,
      padding: '6px 0', borderBottom: '1px dashed var(--border)',
      fontFamily: 'var(--font-mono)', fontSize: 10.5, alignItems: 'center',
    }}>
      <span style={{ color: ok ? 'var(--green)' : 'var(--red)', fontSize: 9 }}>{ok ? '✓' : '×'}</span>
      <span style={{ color: 'var(--text-2)', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ color: 'var(--text-3)' }}>{val}</span>
    </div>
  );
}

// ─── EmptyWorkspace ───────────────────────────────────────────────────────────

export function EmptyWorkspace() {
  const toggleDockPanel = useWorkspaceStore((s) => s.toggleDockPanel);
  const connState = useTransportStore(selectConnectionState);
  const openPanel = useUIStore((s) => s.openPanel);

  const send = (prompt: string) =>
    window.dispatchEvent(new CustomEvent('pulse:send-message', { detail: { content: prompt }, bubbles: true }));

  const focusInput = () =>
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]')?.focus();

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--bg)' }}>
      {/* ── Hero ── */}
      <div className="empty-hero">
        <div className="t-label" style={{ marginBottom: 22 }}>
          <span style={{ color: 'var(--accent)' }}>● Pulse AI Workspace</span>
          <span style={{ marginLeft: 14, color: 'var(--text-4)' }}>
            Claude · 200k context · realtime streaming
          </span>
        </div>
        <h1>
          A workspace built for <span className="em">realtime</span> reasoning.
        </h1>
        <p>
          Stream tokens at 60fps, watch render commits in real time, replay
          any sequence from offset zero. Your context, latency budget, and
          render pipeline — all in the same frame.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
          <button style={BTN_PRIMARY} onClick={focusInput}>↵ Start a session</button>
          <button style={BTN_ACCENT} onClick={() => openPanel('settings')}>◉ Connect API Key</button>
          <button style={BTN_GHOST} onClick={() => toggleDockPanel('telemetry')}>📊 Diagnostics</button>
          <button style={BTN_GHOST} onClick={() => toggleDockPanel('chaos')}>⚡ Chaos panel</button>
        </div>
        <div className="dotgrid" style={{
          position: 'absolute', right: -40, top: -40, width: 360, height: 240,
          opacity: 0.5, pointerEvents: 'none',
          maskImage: 'radial-gradient(circle, black 30%, transparent 70%)',
        }} />
      </div>

      {/* ── Starter workflows ── */}
      <div style={{ padding: '22px 28px 0' }}>
        <div className="section-head">
          <h3>Starter workflows</h3>
          <span className="meta">⌘1–5 to launch</span>
        </div>
      </div>
      <div className="empty-grid">
        <StarterCell n="01" title="Audit a streaming pipeline"
          desc="Profile token decode, append, render, and commit stages — annotated with budget thresholds."
          kbd="⌘1"
          onClick={() => send('Walk me through auditing a streaming token pipeline. Profile each stage: decode, append, render, commit — with budget thresholds.')} />
        <StarterCell n="02" title="Trace a websocket reconnect"
          desc="Replay the last reconnect storm, attach backoff schedule, isolate cause from server logs."
          kbd="⌘2"
          onClick={() => send('Explain how WebSocket reconnect logic works with exponential backoff. How do I trace and replay a reconnect storm?')} />
        <StarterCell n="03" title="Diff a frontend regression"
          desc="Compare two deploys' frame-time histograms; surface the components that drifted."
          kbd="⌘3"
          onClick={() => send('How do I diff two frontend deploy snapshots to find which components caused a frame-time regression?')} />
      </div>
      <div className="empty-grid">
        <StarterCell n="04" title="Design a backpressure policy"
          desc="Generate buffer + flush + drop policies for streaming; validate against a sample distribution."
          kbd="⌘4"
          onClick={() => send('Design a backpressure policy for a token streaming system: buffer, flush, and drop strategies with validation.')} />
        <StarterCell n="05" title="Write an SLA postmortem"
          desc="Pull metrics from the last incident, draft a structured postmortem with action items."
          kbd="⌘5"
          onClick={() => send('Help me write a structured SLA postmortem. What sections should it cover and how should I frame action items?')} />
        <StarterCell n="—" title="Free-form session"
          desc="Empty canvas. Slash-command capable. Streams over websocket with full diagnostics."
          kbd="↵" accent onClick={focusInput} />
      </div>

      {/* ── Shortcuts + slash commands ── */}
      <div className="empty-shortcuts">
        <div>
          <div className="section-head"><h3>Keyboard</h3><span className="meta">essentials</span></div>
          <ShortcutRow label="Cancel generation"        keys={['Esc']} />
          <ShortcutRow label="Jump to latest token"     keys={['J']} />
          <ShortcutRow label="Toggle diagnostics"       keys={['⌘', 'D']} />
          <ShortcutRow label="Profile last response"    keys={['⌘', '⇧', 'P']} />
          <ShortcutRow label="Open chaos panel"         keys={['⌘', '⇧', 'C']} />
          <ShortcutRow label="Run benchmark"            keys={['⌘', '⇧', 'B']} />
        </div>
        <div>
          <div className="section-head"><h3>Slash commands</h3><span className="meta">available</span></div>
          <ShortcutRow label="/profile — frame-commit profiler"   keys={[]} />
          <ShortcutRow label="/replay — replay from offset"       keys={[]} />
          <ShortcutRow label="/snapshot — telemetry to clipboard" keys={[]} />
          <ShortcutRow label="/diff — compare two responses"      keys={[]} />
          <ShortcutRow label="/trace — open trace viewer"         keys={[]} />
          <ShortcutRow label="/benchmark — run stress scenarios"  keys={[]} />
        </div>
      </div>

      {/* ── Recents + status ── */}
      <div className="empty-recents">
        <div>
          <div className="section-head"><h3>Recent sessions</h3><span className="meta">today</span></div>
          <RecentRow nm="No sessions yet" meta="—" />
        </div>
        <div>
          <div className="section-head"><h3>Status</h3><span className="meta">live</span></div>
          <Probe ok={connState === 'connected' || connState === 'idle'} label="WebSocket" val={connState} />
          <Probe ok label="Render pipeline" val="ready" />
          <Probe ok label="Token stream"    val="ready" />
          <Probe ok label="Diagnostics"     val="online" />
        </div>
      </div>
    </div>
  );
}

const BTN_PRIMARY: React.CSSProperties = {
  background: 'var(--accent)', color: '#1A1918',
  fontFamily: 'var(--font-mono)', fontSize: 11,
  letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 500,
  border: 0, padding: '10px 16px', cursor: 'pointer',
};
const BTN_GHOST: React.CSSProperties = {
  background: 'transparent', color: 'var(--text-2)',
  fontFamily: 'var(--font-mono)', fontSize: 11,
  letterSpacing: '0.18em', textTransform: 'uppercase',
  border: '1px solid var(--border-2)', padding: '10px 16px', cursor: 'pointer',
};
const BTN_ACCENT: React.CSSProperties = {
  background: 'rgba(255,74,28,0.10)', color: 'var(--accent)',
  fontFamily: 'var(--font-mono)', fontSize: 11,
  letterSpacing: '0.18em', textTransform: 'uppercase',
  border: '1px solid var(--accent)', padding: '10px 16px', cursor: 'pointer',
};
