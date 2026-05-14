import { useState, useRef, useCallback } from 'react';
import { BenchmarkRunner, formatReport } from '../../benchmark/runner.js';
import type { BenchmarkReport, ScenarioResult } from '../../benchmark/runner.js';
import type { ScenarioName } from '../../telemetry/stress/scenarios.js';
import { renderPipeline } from '../../render/pipeline.js';
import { telemetry } from '../../telemetry/index.js';

const SCENARIO_LABELS: Record<ScenarioName, string> = {
  singleStreamNormal:  'Single stream — normal',
  singleStreamFast:    'Single stream — fast',
  concurrentStreams:   'Concurrent streams (×3)',
  burstTraffic:        'Burst traffic',
  networkInstability:  'Network instability',
  reconnectStorm:      'Reconnect storm',
  deepHistory:         'Deep history',
  worstCase:           'Worst case',
};

const ALL_SCENARIOS = Object.keys(SCENARIO_LABELS) as ScenarioName[];

type PanelStatus = 'idle' | 'running' | 'done';

interface RunProgress {
  completed: number;
  total: number;
  currentScenario: ScenarioName | null;
}

export function BenchmarkPanel() {
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [selected, setSelected] = useState<Set<ScenarioName>>(new Set(ALL_SCENARIOS));
  const [progress, setProgress] = useState<RunProgress>({ completed: 0, total: 0, currentScenario: null });
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const runnerRef = useRef<BenchmarkRunner | null>(null);

  const toggleScenario = useCallback((name: ScenarioName) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  const handleRun = useCallback(async () => {
    if (selected.size === 0) return;
    const scenariosToRun = ALL_SCENARIOS.filter((s) => selected.has(s));
    setStatus('running');
    setReport(null);
    setProgress({ completed: 0, total: scenariosToRun.length, currentScenario: scenariosToRun[0] ?? null });
    const runner = new BenchmarkRunner(renderPipeline, telemetry._collector);
    runnerRef.current = runner;
    try {
      const result = await runner.run(scenariosToRun, (completed, total, latest) => {
        setProgress({ completed, total, currentScenario: scenariosToRun[completed] ?? null });
        void latest;
      });
      setReport(result);
      setStatus('done');
    } catch {
      setStatus('idle');
    } finally {
      runnerRef.current = null;
    }
  }, [selected]);

  const handleAbort = useCallback(() => { runnerRef.current?.abort(); setStatus('idle'); }, []);
  const handleReset = useCallback(() => { setStatus('idle'); setReport(null); }, []);
  const handleExport = useCallback(() => { if (report) console.log(formatReport(report)); }, [report]);

  const allPassed = report?.summary.allPassed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>

      {/* Header */}
      <div className="pane-head">
        <span className="t-label">Benchmark · Runner</span>
        {status === 'done' && report !== null && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: allPassed ? 'var(--green)' : 'var(--red)' }}>
            {allPassed ? '✓ Pass' : '✗ Fail'}
          </span>
        )}
      </div>

      {status === 'idle' && (
        <IdleView selected={selected} onToggle={toggleScenario} onRun={handleRun} />
      )}
      {status === 'running' && (
        <RunningView progress={progress} onAbort={handleAbort} />
      )}
      {status === 'done' && report !== null && (
        <DoneView report={report} onReset={handleReset} onExport={handleExport} />
      )}
    </div>
  );
}

// ─── IdleView ─────────────────────────────────────────────────────────────────

function IdleView({ selected, onToggle, onRun }: {
  selected: Set<ScenarioName>; onToggle: (n: ScenarioName) => void; onRun: () => void;
}) {
  const allSelected = selected.size === ALL_SCENARIOS.length;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px 6px', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.14em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>
        Scenarios · {selected.size}/{ALL_SCENARIOS.length}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {ALL_SCENARIOS.map((name) => (
          <label key={name} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 14px',
            cursor: 'pointer',
            borderBottom: '1px solid var(--border)',
            color: selected.has(name) ? 'var(--text)' : 'var(--text-4)',
            background: selected.has(name) ? 'var(--accent-soft)' : 'transparent',
            transition: 'background 80ms',
          }}>
            <input
              type="checkbox"
              checked={selected.has(name)}
              onChange={() => onToggle(name)}
              style={{ accentColor: 'var(--accent)', flexShrink: 0 }}
            />
            <span style={{ fontSize: 11 }}>{SCENARIO_LABELS[name]}</span>
          </label>
        ))}
      </div>
      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          onClick={onRun}
          disabled={selected.size === 0}
          style={{
            width: '100%', padding: '10px 12px',
            background: selected.size === 0 ? 'var(--surface-2)' : 'var(--accent)',
            color: selected.size === 0 ? 'var(--text-4)' : '#1A1918',
            fontFamily: 'var(--font-mono)', fontSize: 10.5,
            letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 500,
            border: 0, cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          ▶ Run {allSelected ? 'All' : selected.size} scenario{selected.size !== 1 ? 's' : ''}
        </button>
        <div style={{ marginTop: 7, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', textAlign: 'center', letterSpacing: '0.08em' }}>
          Pass · p95 ≤ 14ms · drop ≤ 2%
        </div>
      </div>
    </div>
  );
}

// ─── RunningView ──────────────────────────────────────────────────────────────

function RunningView({ progress, onAbort }: { progress: RunProgress; onAbort: () => void }) {
  const pct = progress.total > 0 ? progress.completed / progress.total : 0;
  return (
    <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>Running</div>
        <div style={{ height: 2, background: 'var(--surface-3)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct * 100}%`, background: 'var(--accent)', transition: 'width 300ms ease-out' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', marginTop: 5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          <span>{progress.completed}/{progress.total} scenarios</span>
          <span>{Math.round(pct * 100)}%</span>
        </div>
      </div>

      {progress.currentScenario !== null && (
        <div style={{ padding: '8px 10px', background: 'var(--accent-soft)', border: '1px solid var(--accent-dim)', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--accent)', letterSpacing: '0.04em' }}>
          {SCENARIO_LABELS[progress.currentScenario]}
        </div>
      )}

      <button onClick={onAbort} style={{
        width: '100%', padding: '9px 12px',
        background: 'transparent', border: '1px solid var(--border-2)',
        color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 10,
        letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer',
      }}>
        ■ Abort
      </button>
    </div>
  );
}

// ─── DoneView ─────────────────────────────────────────────────────────────────

function DoneView({ report, onReset, onExport }: {
  report: BenchmarkReport; onReset: () => void; onExport: () => void;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.14em', textTransform: 'uppercase', padding: '8px 14px 6px', borderBottom: '1px solid var(--border)' }}>
        Results · {report.scenarios.length} scenarios
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {report.scenarios.map((r) => <ScenarioResultRow key={r.scenario} result={r} />)}

        {/* Summary */}
        <div style={{ margin: '8px 14px', padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>Summary</div>
          <MetricRow label="Duration"  value={`${(report.summary.totalDurationMs / 1000).toFixed(1)}s`} />
          <MetricRow label="Worst p95" value={`${report.summary.worstP95Ms.toFixed(1)}ms`}             warn={report.summary.worstP95Ms > 14} />
          <MetricRow label="Worst drop" value={`${report.summary.worstDropRate.toFixed(1)}%`}           warn={report.summary.worstDropRate > 2} />
        </div>
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={onReset} style={{ flex: 1, padding: '9px', background: 'var(--accent)', color: '#1A1918', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', border: 0, cursor: 'pointer' }}>
          ↺ Reset
        </button>
        <button onClick={onExport} title="Print full report to console" style={{ flex: 1, padding: '9px', background: 'transparent', border: '1px solid var(--border-2)', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>
          ⬇ Log
        </button>
      </div>
    </div>
  );
}

function ScenarioResultRow({ result }: { result: ScenarioResult }) {
  const p95Pass = result.p95FrameTimeMs <= 14;
  const dropPass = result.droppedFramePercent <= 2;
  const pass = p95Pass && dropPass;

  return (
    <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {SCENARIO_LABELS[result.scenario] ?? result.scenario}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: pass ? 'var(--green)' : 'var(--red)', flexShrink: 0, marginLeft: 8 }}>
          {pass ? '✓' : '✗'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <Chip label="p95" value={`${result.p95FrameTimeMs.toFixed(1)}ms`} pass={p95Pass} />
        <Chip label="drop" value={`${result.droppedFramePercent.toFixed(1)}%`} pass={dropPass} />
        <Chip label="tps" value={`${result.tokensPerSecond.toFixed(0)}`} />
      </div>
    </div>
  );
}

function Chip({ label, value, pass }: { label: string; value: string; pass?: boolean }) {
  const color = pass === undefined ? 'var(--text-3)' : pass ? 'var(--green)' : 'var(--red)';
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color, letterSpacing: '0.04em' }}>
      {label}:<span style={{ color: 'var(--text)' }}>{value}</span>
    </span>
  );
}

function MetricRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '4px 0', borderBottom: '1px dashed var(--border)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: warn ? 'var(--yellow)' : 'var(--text-2)' }}>{value}</span>
    </div>
  );
}
