import React, { useCallback, useState } from 'react';
import { scenarios } from '../../telemetry/stress/scenarios.js';
import type { LoadScenario } from '../../telemetry/stress/scenarios.js';
import {
  useWorkspaceStore,
  selectSimulationRunning,
  selectSimulationScenario,
  selectSimulationProgress,
} from '../../workspace/workspace-store.js';
import type { ScenarioName } from '../../telemetry/stress/scenarios.js';

export interface RunSimulationEvent extends CustomEvent {
  detail: { scenario: ScenarioName };
}

const SCENARIO_NAMES = Object.keys(scenarios) as ScenarioName[];

const ScenarioCard = React.memo(function ScenarioCard({
  name, selected, onSelect,
}: { name: ScenarioName; selected: boolean; onSelect: (n: ScenarioName) => void }) {
  const scenario = scenarios[name];
  const hasChaos = (scenario as LoadScenario).chaos !== undefined;

  return (
    <button
      onClick={() => onSelect(name)}
      aria-pressed={selected}
      style={{
        width: '100%',
        padding: '9px 12px',
        background: selected ? 'var(--accent-soft)' : 'transparent',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        borderLeft: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
        color: selected ? 'var(--text)' : 'var(--text-3)',
        textAlign: 'left',
        cursor: 'pointer',
        marginBottom: 3,
        transition: 'all 80ms ease-out',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em', color: selected ? 'var(--text)' : 'var(--text-2)' }}>
          {scenario.name}
        </span>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {hasChaos && (
            <span style={{ fontSize: 9, padding: '1px 5px', background: 'rgba(255,74,28,0.08)', border: '1px solid var(--accent-dim)', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              chaos
            </span>
          )}
          <span style={{ fontSize: 9, padding: '1px 5px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
            {Math.round(scenario.expectedDurationMs / 1000)}s
          </span>
        </div>
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-4)', lineHeight: 1.4, fontFamily: 'var(--font-body)' }}>
        {scenario.description}
      </p>
    </button>
  );
});

function Detail({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '5px 0', borderBottom: '1px dashed var(--border)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
      <span style={{ color: 'var(--text-3)', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ color: warn ? 'var(--yellow)' : 'var(--text-2)' }}>{value}</span>
    </div>
  );
}

export const ChaosPanel = React.memo(function ChaosPanel() {
  const [selectedScenario, setSelectedScenario] = useState<ScenarioName>('singleStreamNormal');
  const running = useWorkspaceStore(selectSimulationRunning);
  const activeScenario = useWorkspaceStore(selectSimulationScenario);
  const progress = useWorkspaceStore(selectSimulationProgress);

  const handleRun = useCallback(() => {
    window.dispatchEvent(new CustomEvent('pulse:run-simulation', {
      detail: { scenario: selectedScenario }, bubbles: true,
    }) as RunSimulationEvent);
  }, [selectedScenario]);

  const handleStop = useCallback(() => {
    window.dispatchEvent(new CustomEvent('pulse:stop-simulation', { bubbles: true }));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* Header */}
      <div className="pane-head">
        <span className="t-label">Chaos · Simulation</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          StreamSimulator
        </span>
      </div>

      {/* Running state */}
      {running && (
        <div style={{ padding: '12px 14px', background: 'rgba(255,74,28,0.04)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 3 }}>Running</div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.04em' }}>
                {activeScenario ?? 'simulation'}
              </span>
            </div>
            <button onClick={handleStop} style={{ padding: '4px 10px', background: 'transparent', border: '1px solid var(--border-2)', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>
              Stop
            </button>
          </div>
          <div style={{ height: 2, background: 'var(--surface-3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress * 100}%`, background: 'var(--accent)', transition: 'width 200ms ease-out' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', marginTop: 5, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            <span>progress</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
        </div>
      )}

      {!running && (
        <>
          {/* Scenario picker */}
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
              Select scenario
            </div>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {SCENARIO_NAMES.map((name) => (
                <ScenarioCard key={name} name={name} selected={name === selectedScenario} onSelect={setSelectedScenario} />
              ))}
            </div>
          </div>

          {/* Selected detail */}
          {(() => {
            const s = scenarios[selectedScenario] as LoadScenario;
            return (
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>Config</div>
                <Detail label="streams" value={String(s.simulator.streams.length)} />
                <Detail label="duration" value={`~${Math.round(s.expectedDurationMs / 1000)}s`} />
                {s.chaos?.dropRate !== undefined && (
                  <Detail label="drop rate" value={`${(s.chaos.dropRate * 100).toFixed(0)}%`} warn />
                )}
                {s.chaos?.forceDisconnectAfter !== undefined && (
                  <Detail label="disconnect after" value={`${s.chaos.forceDisconnectAfter} msgs`} warn />
                )}
                {s.chaos?.latencyMs !== undefined && (
                  <Detail label="latency" value={`${s.chaos.latencyMs.mean}ms ± ${s.chaos.latencyMs.jitter}ms`} warn />
                )}
              </div>
            );
          })()}

          {/* Run button */}
          <div style={{ padding: '12px 14px' }}>
            <button onClick={handleRun} style={{
              width: '100%', padding: '10px 12px',
              background: 'var(--accent)', color: '#1A1918',
              fontFamily: 'var(--font-mono)', fontSize: 10.5,
              letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 500,
              border: 0, cursor: 'pointer',
            }}>
              ▶ Run simulation
            </button>
            <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', textAlign: 'center', letterSpacing: '0.08em' }}>
              Injects synthetic traffic into render pipeline
            </div>
          </div>
        </>
      )}
    </div>
  );
});

ChaosPanel.displayName = 'ChaosPanel';
