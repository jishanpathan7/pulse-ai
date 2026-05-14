/**
 * FpsPanel — render pipeline metrics.
 */

import React from 'react';
import {
  useTelemetryStore,
  selectAggregated,
  selectAvgFrameTime,
  selectP95FrameTime,
  selectDroppedFrames,
  selectTotalFrames,
} from '../../../store/telemetry-store.js';

const BUDGET_MS = 16.67;

function BudgetBar({ valueMs, label }: { valueMs: number; label: string }) {
  const pct = Math.min(100, (valueMs / BUDGET_MS) * 100);
  const color = pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--yellow)' : 'var(--green)';
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, marginBottom: 3, color: 'var(--text-3)' }}>
        <span>{label}</span>
        <span style={{ color }}>{valueMs.toFixed(2)}ms</span>
      </div>
      <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 120ms ease-out' }} />
      </div>
    </div>
  );
}

function StatCell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: warn ? 'var(--yellow)' : 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

export const FpsPanel = React.memo(function FpsPanel() {
  const agg = useTelemetryStore(selectAggregated);
  const avgFrameMs = useTelemetryStore(selectAvgFrameTime);
  const p95FrameMs = useTelemetryStore(selectP95FrameTime);
  const droppedFrames = useTelemetryStore(selectDroppedFrames);
  const totalFrames = useTelemetryStore(selectTotalFrames);

  const fps = avgFrameMs > 0 ? Math.round(1000 / avgFrameMs) : 0;
  const dropPct = totalFrames > 0 ? ((droppedFrames / totalFrames) * 100).toFixed(1) : '0.0';
  const fpsColor = fps >= 55 ? 'var(--green)' : fps >= 30 ? 'var(--yellow)' : fps > 0 ? 'var(--red)' : 'var(--text-4)';

  return (
    <section>
      {/* Hero FPS */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-4)' }}>Main thread</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: fpsColor, fontVariantNumeric: 'tabular-nums' }}>
          {fps > 0 ? fps : '—'}<span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 400, marginLeft: 4 }}>fps</span>
        </span>
      </div>

      {/* Budget bars */}
      <div style={{ marginBottom: 10 }}>
        <BudgetBar valueMs={avgFrameMs} label="avg frame" />
        <BudgetBar valueMs={p95FrameMs} label="p95 frame" />
        <BudgetBar valueMs={agg.frameTimeP99Ms} label="p99 frame" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.1em', marginBottom: 10 }}>
        <span>budget 16.67ms</span>
        <span style={{ color: droppedFrames > 0 ? 'var(--yellow)' : 'var(--text-4)' }}>
          {droppedFrames} dropped ({dropPct}%)
        </span>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <StatCell label="Violations" value={String(agg.budgetViolations)} warn={agg.budgetViolations > 0} />
        <StatCell label="Upgrades" value={String(agg.batchStrategyUpgrades)} warn={agg.batchStrategyUpgrades > 0} />
        <StatCell label="Total frames" value={String(totalFrames)} />
        <StatCell label="Strategy" value={agg.batchStrategyUpgrades > 0 ? 'budget' : 'normal'} />
      </div>
    </section>
  );
});
