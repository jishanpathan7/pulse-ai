/**
 * TransportPanel — WebSocket transport and replay metrics.
 */

import React from 'react';
import { useTelemetryStore, selectAggregated } from '../../../store/telemetry-store.js';
import { useTransportStore } from '../../../store/transport-store.js';

const selectConnectionState = (s: { connectionState: string }) => s.connectionState;

const STATE_COLOR: Record<string, string> = {
  connected:    'var(--green)',
  connecting:   'var(--yellow)',
  reconnecting: 'var(--yellow)',
  disconnected: 'var(--red)',
  failed:       'var(--red)',
  idle:         'var(--text-4)',
};

const STATE_DOT: Record<string, string> = {
  connected:    'var(--green)',
  connecting:   'var(--yellow)',
  reconnecting: 'var(--yellow)',
  disconnected: 'var(--red)',
  failed:       'var(--red)',
  idle:         'var(--text-4)',
};

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, marginBottom: 5 }}>
      <span style={{ color: 'var(--text-4)', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ color: warn ? 'var(--yellow)' : 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />;
}

function LatencyGauge({ valueMs, label, warnMs = 200 }: { valueMs: number; label: string; warnMs?: number }) {
  const color = valueMs === 0 ? 'var(--text-4)' : valueMs > warnMs ? 'var(--yellow)' : 'var(--green)';
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {valueMs > 0 ? `${valueMs.toFixed(0)}` : '—'}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-4)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );
}

export const TransportPanel = React.memo(function TransportPanel() {
  const agg = useTelemetryStore(selectAggregated);
  const connState = useTransportStore(selectConnectionState);
  const stateColor = STATE_COLOR[connState] ?? 'var(--text-4)';
  const dotColor = STATE_DOT[connState] ?? 'var(--text-4)';

  return (
    <section>
      {/* State badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-4)' }}>WebSocket</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, display: 'inline-block', boxShadow: connState === 'connected' ? `0 0 6px ${dotColor}` : 'none' }} aria-hidden />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: stateColor, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{connState}</span>
        </div>
      </div>

      {/* RTT gauges */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
        <LatencyGauge valueMs={agg.wsRttP50Ms} label="RTT p50 ms" warnMs={150} />
        <LatencyGauge valueMs={agg.wsRttP95Ms} label="RTT p95 ms" warnMs={200} />
      </div>

      <Row label="connect time" value={`${agg.connectDurationMs.toFixed(0)}ms`} />
      <Row label="reconnects" value={String(agg.reconnectCount)} warn={agg.reconnectCount > 0} />

      <Divider />

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 6 }}>Replay</div>
      <Row label="chunks replayed" value={String(agg.replayCount)} />
      <Row label="replay p95" value={`${agg.replayDurationP95Ms.toFixed(0)}ms`} warn={agg.replayDurationP95Ms > 1000} />
      <Row label="gap size p95" value={String(Math.round(agg.replayGapSizeP95))} />
    </section>
  );
});
