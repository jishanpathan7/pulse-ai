/**
 * StreamPanel — token streaming metrics.
 */

import React from 'react';
import { useTelemetryStore, selectAggregated } from '../../../store/telemetry-store.js';
import { useStreamStore, selectStreamCount } from '../../../store/stream-store.js';

function Row({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, marginBottom: 5, alignItems: 'baseline' }}>
      <span style={{ color: 'var(--text-4)', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ color: warn ? 'var(--yellow)' : highlight ? 'var(--accent)' : 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />;
}

function StreamBar({ label, value, max, color = 'var(--accent)' }: { label: string; value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, marginBottom: 3, color: 'var(--text-3)' }}>
        <span>{label}</span>
        <span style={{ color }}>{value}</span>
      </div>
      <div style={{ height: 2, background: 'var(--border)', borderRadius: 1 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 1, transition: 'width 200ms ease-out' }} />
      </div>
    </div>
  );
}

export const StreamPanel = React.memo(function StreamPanel() {
  const agg = useTelemetryStore(selectAggregated);
  const streamCount = useStreamStore(selectStreamCount);

  const totalStreams = agg.activeStreams + agg.completedStreams + agg.erroredStreams;

  return (
    <section>
      {/* Hero */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-4)' }}>Active</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: streamCount > 0 ? 'var(--accent)' : 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>
          {streamCount}<span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 400, marginLeft: 4 }}>stream{streamCount !== 1 ? 's' : ''}</span>
        </span>
      </div>

      {/* Stream lifecycle */}
      <StreamBar label="active" value={agg.activeStreams} max={Math.max(1, totalStreams)} color="var(--accent)" />
      <StreamBar label="completed" value={agg.completedStreams} max={Math.max(1, totalStreams)} color="var(--green)" />
      <StreamBar label="errored" value={agg.erroredStreams} max={Math.max(1, totalStreams)} color="var(--red)" />

      <Divider />

      <Row label="tokens/s" value={`${agg.tokensPerSecond.toFixed(1)} tok/s`} highlight={agg.tokensPerSecond > 0} />
      <Row label="TTFT p50" value={`${agg.firstTokenLatencyP50Ms.toFixed(0)}ms`} />
      <Row label="TTFT p95" value={`${agg.firstTokenLatencyP95Ms.toFixed(0)}ms`} warn={agg.firstTokenLatencyP95Ms > 500} />
    </section>
  );
});
