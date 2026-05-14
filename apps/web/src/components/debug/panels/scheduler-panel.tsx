/**
 * SchedulerPanel — RAF scheduler and virtualization metrics.
 */

import React from 'react';
import { useTelemetryStore, selectAggregated } from '../../../store/telemetry-store.js';

function Row({ label, value, warn, accent }: { label: string; value: string; warn?: boolean; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, marginBottom: 5 }}>
      <span style={{ color: 'var(--text-4)', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ color: warn ? 'var(--yellow)' : accent ? 'var(--accent)' : 'var(--text-2)', fontVariantNumeric: 'tabular-nums', fontWeight: warn || accent ? 600 : 400 }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />;
}

function VirtRing({ rendered, total }: { rendered: number; total: number }) {
  const pct = total > 0 ? rendered / total : 0;
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={56} height={56} viewBox="0 0 56 56" aria-hidden>
        <circle cx={28} cy={28} r={r} fill="none" stroke="var(--border)" strokeWidth={3} />
        <circle
          cx={28} cy={28} r={r} fill="none"
          stroke="var(--accent)" strokeWidth={3}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 28 28)"
          style={{ transition: 'stroke-dasharray 300ms ease-out' }}
        />
        <text x={28} y={32} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fill="var(--text-2)" fontWeight={700}>
          {total > 0 ? `${Math.round(pct * 100)}%` : '—'}
        </text>
      </svg>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {rendered} / {total} rendered
      </span>
    </div>
  );
}

export const SchedulerPanel = React.memo(function SchedulerPanel() {
  const agg = useTelemetryStore(selectAggregated);

  const upgraded = agg.batchStrategyUpgrades > 0;
  const strategy = upgraded ? 'budget-aware' : 'normal';
  const strategyColor = upgraded ? 'var(--yellow)' : 'var(--green)';

  return (
    <section>
      {/* Strategy badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-4)' }}>Batch strategy</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: strategyColor, fontWeight: 600, letterSpacing: '0.06em' }}>{strategy}</span>
      </div>

      <Row label="queue depth p95" value={String(Math.round(agg.queueDepthP95))} warn={agg.queueDepthP95 > 100} />
      <Row label="flushes skipped" value={String(agg.flushesSkipped)} warn={agg.flushesSkipped > 0} />
      <Row label="strategy upgrades" value={String(agg.batchStrategyUpgrades)} warn={upgraded} />

      <Divider />

      {/* Virtualization ring */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 10 }}>Virtual list</div>
      <VirtRing rendered={agg.virtualRenderedItems} total={agg.virtualTotalItems} />

      <div style={{ marginTop: 10 }}>
        <Row label="rendered items" value={String(agg.virtualRenderedItems)} accent />
        <Row label="total items" value={String(agg.virtualTotalItems)} />
        <Row label="list height" value={`${Math.round(agg.virtualHeightPx)}px`} />
      </div>
    </section>
  );
});
