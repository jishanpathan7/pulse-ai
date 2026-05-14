import React from 'react';

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <div style={{ height: 32 }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 100, h = 32;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const linePath = `M ${pts.join(' L ')}`;
  const areaPath = `M 0,${h} L ${pts.join(' L ')} L ${w},${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="spark" aria-hidden>
      <path d={areaPath} fill="var(--accent)" opacity={0.08} />
      <path d={linePath} stroke="var(--accent)" fill="none" strokeWidth={1.2} />
    </svg>
  );
}

function Pillar({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div style={{ background: 'var(--surface)', padding: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em', color: 'var(--accent)' }}>{n}</span>
        <span className="t-label">primitive</span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 200, fontSize: 26, letterSpacing: '-0.025em', lineHeight: 1.05 }}>{t}</div>
      <div style={{ fontSize: 13, lineHeight: 21, color: 'var(--text-3)' }}>{d}</div>
    </div>
  );
}

function FlowStep({ n, stage, title, desc, link, accent }: {
  n: string; stage: string; title: string; desc: string; link: string; accent?: boolean;
}) {
  return (
    <div style={{
      padding: 22, borderRight: '1px solid var(--border)',
      background: accent ? 'rgba(255,74,28,0.04)' : 'transparent',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: accent ? 'var(--accent)' : 'var(--text-4)', letterSpacing: '0.18em' }}>{n}</span>
        <span className="t-label">{stage}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 200, fontSize: 19, letterSpacing: '-0.02em', marginTop: 2 }}>{title}</div>
      <div style={{ fontSize: 12.5, lineHeight: 19, color: 'var(--text-3)' }}>{desc}</div>
      <div style={{ marginTop: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: accent ? 'var(--accent)' : 'var(--text-4)', letterSpacing: '0.14em', textTransform: 'uppercase', paddingTop: 10 }}>
        {link}
      </div>
    </div>
  );
}

function FlowMeta({ s, l, warn }: { s: string; l: string; warn?: boolean }) {
  return (
    <div style={{ padding: '2px 22px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ color: warn ? 'var(--yellow)' : 'var(--text-3)' }}>{s}</span>
      <span>{l}</span>
    </div>
  );
}

function PipeRow({ n, lbl, desc, budget, accent }: {
  n: string; lbl: string; desc: string; budget: string; accent?: boolean;
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '34px 100px 1fr auto',
      alignItems: 'center', gap: 14,
      padding: '14px 18px',
      borderBottom: '1px solid var(--border)',
      background: accent ? 'rgba(255,74,28,0.04)' : 'transparent',
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: accent ? 'var(--accent)' : 'var(--text-3)', letterSpacing: '-0.01em' }}>{n}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{lbl}</span>
      <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{desc}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: accent ? 'var(--accent)' : 'var(--text-2)' }}>{budget}</span>
    </div>
  );
}

// ─── LandingPage ──────────────────────────────────────────────────────────────

interface LandingPageProps {
  onEnterWorkspace: () => void;
}

export function LandingPage({ onEnterWorkspace }: LandingPageProps) {
  return (
    <div style={{ overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>

      {/* ── Nav ── */}
      <header style={{
        height: 56, borderBottom: '1px solid var(--border)',
        display: 'grid', gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center', padding: '0 32px', flexShrink: 0,
        position: 'sticky', top: 0,
        background: 'rgba(14,14,13,0.92)', backdropFilter: 'blur(8px)', zIndex: 10,
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="brand-mark" style={{ width: 24, height: 24 }} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 19, letterSpacing: '-0.02em' }}>Pulse</span>
          <span className="brand-tag" style={{ marginLeft: 4 }}>v3.14</span>
        </div>
        <nav style={{
          justifySelf: 'center',
          display: 'flex', gap: 32,
          fontFamily: 'var(--font-mono)', fontSize: 11,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-3)',
        }}>
          {['Platform', 'Streaming', 'Telemetry', 'Pricing', 'Docs', 'Changelog'].map((item) => (
            <span key={item} style={{ cursor: 'pointer' }}>{item}</span>
          ))}
        </nav>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>Sign in</span>
          <button onClick={onEnterWorkspace} style={BTN_ACCENT}>Open workspace ↗</button>
        </div>
      </header>

      {/* ── Hero ── */}
      <section style={{
        padding: '72px 64px 56px',
        borderBottom: '1px solid var(--border)',
        display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 48,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div className="t-label" style={{ marginBottom: 22, color: 'var(--accent)' }}>● Realtime AI · enterprise grade · ws + sse</div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontWeight: 200,
            fontSize: 84, lineHeight: 0.96, letterSpacing: '-0.045em',
            margin: 0, maxWidth: 720,
          }}>
            Streaming intelligence,<br />
            <span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>committed</span> at 60fps.
          </h1>
          <p style={{ fontSize: 16, lineHeight: '26px', color: 'var(--text-2)', maxWidth: 520, margin: '24px 0 0' }}>
            Pulse is the workspace operators use when latency, reliability, and rendering performance are part of the conversation. Open a websocket. Stream a thought. Observe every token, every commit, every reconnect — in the same frame.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 32, flexWrap: 'wrap' }}>
            <button onClick={onEnterWorkspace} style={BTN_ACCENT_LG}>Start free · 14 days</button>
            <button onClick={onEnterWorkspace} style={BTN_OUTLINE_LG}>↗ Live demo</button>
            <button style={BTN_GHOST_SM}>Read the architecture brief →</button>
          </div>

          {/* trust strip */}
          <div style={{ marginTop: 56 }}>
            <div className="t-label" style={{ marginBottom: 14 }}>Trusted by infra &amp; AI teams at</div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14,
              fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 16,
              color: 'var(--text-3)', letterSpacing: '-0.01em',
            }}>
              {['Halcyon', 'Northbeam', 'Causeway', 'Tessellate', 'Klaxon AI'].map((name, i, arr) => (
                <span key={name} style={i < arr.length - 1 ? { paddingRight: 14, borderRight: '1px solid var(--border)' } : undefined}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* hero preview tile */}
        <div className="shell" style={{ alignSelf: 'start', marginTop: 8 }}>
          <div style={{ background: 'var(--surface)', padding: 0 }}>
            <div style={{
              height: 28, borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 12px',
              fontFamily: 'var(--font-mono)', fontSize: 9.5,
              letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-4)',
            }}>
              <span>pulse · live preview</span>
              <span><span className="ws-dot" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />Live · 38ms</span>
            </div>
            <div style={{ padding: 18 }}>
              <div className="t-label" style={{ marginBottom: 6 }}>Pulse · claude-3.7 · streaming</div>
              <div style={{ fontSize: 14, lineHeight: '22px', color: 'var(--text)' }}>
                <p style={{ margin: '0 0 10px' }}>
                  {['The ', 'commit ', 'budget ', 'is ', '16ms. ', 'Coalesce ', 'tokens ', 'per ', 'animation ', 'frame, ', 'memoize ', 'sealed ', 'blocks, ', 'and ', 'anchor'].map((tok, i) => (
                    <span key={i} className="tok" style={{ animationDelay: `${i * 0.06}s` }}>{tok}</span>
                  ))}
                  <span className="stream-cursor" />
                </p>
              </div>
              <div style={{
                marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)',
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em',
              }}>
                {[
                  { label: 'tok/s', val: '47.3' },
                  { label: 'ws p99', val: '84ms' },
                  { label: 'commit', val: '8.2ms' },
                  { label: 'fps', val: '59.8' },
                ].map(({ label, val }) => (
                  <div key={label}>
                    <div style={{ color: 'var(--text-4)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{label}</div>
                    <span style={{ color: 'var(--text)', fontSize: 14 }}>{val}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>
                <Spark values={[38, 42, 36, 40, 44, 39, 35, 41, 47, 43, 38, 36, 40, 42, 39, 41, 38, 36, 40, 44]} />
              </div>
            </div>
          </div>
        </div>

        {/* dot grid ornament */}
        <div className="dotgrid" style={{
          position: 'absolute', right: -80, bottom: -60, width: 480, height: 320,
          opacity: 0.4, pointerEvents: 'none',
          maskImage: 'radial-gradient(circle, black 30%, transparent 75%)',
        }} />
      </section>

      {/* ── Metrics strip ── */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: '1px solid var(--border)' }}>
        {[
          { v: '38ms',   l: 'p50 stream latency', s: 'across 14 regions' },
          { v: '99.97%', l: 'uptime',             s: 'last 90 days' },
          { v: '2.8B',   l: 'tokens streamed',    s: 'this month' },
          { v: '16ms',   l: 'frame budget',       s: 'enforced · 99.87%' },
          { v: '<600',   l: 'reconnect ms',       s: 'p95 recovery' },
        ].map(({ v, l, s }, i, arr) => (
          <div key={l} style={{ padding: '24px 22px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, letterSpacing: '-0.02em', color: 'var(--text)', fontWeight: 400 }}>{v}</div>
            <div className="t-label" style={{ marginTop: 6 }}>{l}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', marginTop: 4, letterSpacing: '0.08em' }}>{s}</div>
          </div>
        ))}
      </section>

      {/* ── Three pillars ── */}
      <section style={{ padding: '56px 64px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, marginBottom: 40, alignItems: 'end' }}>
          <div>
            <div className="t-label" style={{ marginBottom: 14 }}>What you get</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 200, fontSize: 48, letterSpacing: '-0.035em', margin: 0, lineHeight: 1.02 }}>
              Three primitives.<br />One <span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>frame budget.</span>
            </h2>
          </div>
          <p style={{ fontSize: 14.5, lineHeight: '24px', color: 'var(--text-2)', margin: 0, maxWidth: 480 }}>
            Pulse isn't a chatbot wrapper — it's an operator's surface for streaming AI. Every component is built around three primitives that show up in every screen.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
          <Pillar n="01" t="Streaming surface" d="Token-by-token rendering with raf-coalesced commits, sealed-block memoization, and stable scroll anchoring. Cancel mid-stream without losing buffered tokens." />
          <Pillar n="02" t="Telemetry rail" d="Live FPS, websocket latency, throughput, render commits, queue depth, and dropped frames — wired to your code with four performance.mark calls." />
          <Pillar n="03" t="Resilience layer" d="Resumable streams, exponential reconnect, retry queues, and SSE fallback. Sessions resume from the exact token offset, no lost output." />
        </div>
      </section>

      {/* ── User flow ── */}
      <section style={{ padding: '56px 64px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: 36 }}>
          <div>
            <div className="t-label" style={{ marginBottom: 14 }}>The flow</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 200, fontSize: 48, letterSpacing: '-0.035em', margin: 0, lineHeight: 1 }}>
              From cold start to <span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>committed token</span>.
            </h2>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            5 stages · ~12s end-to-end
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0, border: '1px solid var(--border)' }}>
          <FlowStep n="01" stage="Onboard"  title="Empty workspace"   desc="Land in a workspace primed with starter workflows, slash commands, and recent sessions. Everything is one keystroke away." link="→ screen 05" />
          <FlowStep n="02" stage="Compose"  title="Open a session"    desc="Slash-command capable composer. Pick the model, attach context, watch the websocket connect in <100ms." link="→ screen 01" accent />
          <FlowStep n="03" stage="Stream"   title="Token-by-token"    desc="Animated cursor, queue indicators, lifecycle states. Cancel without losing buffered output. Anchored scroll holds your read position." link="→ screen 02" />
          <FlowStep n="04" stage="Observe"  title="Telemetry expanded" desc="Open the diagnostics rail full-screen. FPS, p99 latency, commit timing, throughput — all wired to live event log." link="→ screen 03" />
          <FlowStep n="05" stage="Recover"  title="Resilient by default" desc="Connection drops mid-stream? Pulse buffers, reconnects with exponential backoff, and resumes from the exact token offset." link="→ screen 04" />
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
          marginTop: 12, gap: 0,
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)',
          letterSpacing: '0.14em', textTransform: 'uppercase',
        }}>
          <FlowMeta s="00:00"  l="cold" />
          <FlowMeta s="00:02"  l="ws.open" />
          <FlowMeta s="00:03"  l="first byte" />
          <FlowMeta s="00:09"  l="finalized" />
          <FlowMeta s="ad-hoc" l="failure path" warn />
        </div>
      </section>

      {/* ── Architecture brief ── */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: '56px 56px 56px 64px', borderRight: '1px solid var(--border)' }}>
          <div className="t-label" style={{ marginBottom: 14 }}>Architecture brief</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 200, fontSize: 40, letterSpacing: '-0.035em', margin: '0 0 18px', lineHeight: 1.02 }}>
            Engineered for the four-stage pipeline.
          </h2>
          <p style={{ fontSize: 14, lineHeight: '23px', color: 'var(--text-2)', margin: '0 0 24px', maxWidth: 480 }}>
            Every streaming AI surface has the same four stages. Pulse instruments each one with a{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '1px 5px' }}>performance.mark</code>{' '}
            and surfaces the cost in the diagnostics rail.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--border)' }}>
            <PipeRow n="1" lbl="Decode" desc="parseSSEChunk · UTF-8 boundary safe" budget="0.3ms" />
            <PipeRow n="2" lbl="Append" desc="ref-backed buffer · raf flush"       budget="0.1ms" />
            <PipeRow n="3" lbl="Render" desc="memoized blocks · tail re-parse"     budget="6.0ms" />
            <PipeRow n="4" lbl="Commit" desc="React.memo · custom equality"        budget="2.2ms" accent />
          </div>
        </div>

        {/* SVG pipeline schematic */}
        <div style={{ padding: '56px 64px 56px 56px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="t-label" style={{ marginBottom: 18 }}>Stream pipeline · live</div>
          <svg viewBox="0 0 540 320" style={{ width: '100%', height: 'auto', display: 'block' }}>
            {[
              { x: 0,   y: 50,  w: 110, h: 64, l1: 'CLIENT',      l2: 'wss://api.pulse.ai' },
              { x: 150, y: 30,  w: 110, h: 50, l1: 'WS GATEWAY',  l2: 'permessage-deflate' },
              { x: 150, y: 100, w: 110, h: 50, l1: 'SSE FALLBACK', l2: 'auto-promote' },
              { x: 300, y: 65,  w: 110, h: 64, l1: 'INFERENCE',   l2: 'claude-3.7 · 200k' },
              { x: 0,   y: 200, w: 110, h: 50, l1: 'BUFFER',      l2: 'ref · raf flush' },
              { x: 150, y: 200, w: 110, h: 50, l1: 'MEMO BLOCKS', l2: 'sealed · keyed' },
              { x: 300, y: 200, w: 110, h: 50, l1: 'COMMIT',      l2: 'React.memo' },
              { x: 440, y: 110, w: 96,  h: 100, l1: 'TELEMETRY',  l2: 'ring buffer · 60s', accent: true },
            ].map((b, i) => (
              <g key={i}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={b.accent ? 'rgba(255,74,28,0.08)' : 'var(--surface)'} stroke={b.accent ? 'var(--accent)' : 'var(--border-2)'} strokeWidth="1" />
                <text x={b.x + 10} y={b.y + 18} fontFamily="var(--font-mono)" fontSize="9" fill={b.accent ? '#FF4A1C' : '#8E8A82'} letterSpacing="1.4">{b.l1}</text>
                <text x={b.x + 10} y={b.y + 34} fontFamily="var(--font-mono)" fontSize="10" fill="#FDFDFB">{b.l2}</text>
                {b.accent && (
                  <>
                    <text x={b.x + 10} y={b.y + 58} fontFamily="var(--font-mono)" fontSize="9" fill="#8E8A82" letterSpacing="1.4">FPS · p99 · COMMIT</text>
                    <text x={b.x + 10} y={b.y + 76} fontFamily="var(--font-mono)" fontSize="9" fill="#8E8A82" letterSpacing="1.4">DROPPED · QUEUE</text>
                  </>
                )}
              </g>
            ))}
            {([
              ['M110,82 L150,55', true],
              ['M110,82 L150,125', false],
              ['M260,55 L300,90', true],
              ['M260,125 L300,108', false],
              ['M355,129 L355,200', true],
              ['M300,225 L260,225', true],
              ['M150,225 L110,225', true],
              ['M55,200 L55,114', true],
              ['M410,97 L440,140', false],
              ['M410,225 L440,200', false],
            ] as [string, boolean][]).map(([d, solid], i) => (
              <path key={i} d={d} stroke={solid ? 'var(--accent)' : 'var(--border-3)'} strokeWidth="1" fill="none" strokeDasharray={solid ? undefined : '3 3'} markerEnd="url(#arr)" />
            ))}
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
              </marker>
            </defs>
          </svg>
          <div style={{ marginTop: 18, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'flex', gap: 18 }}>
            <span><span style={{ display: 'inline-block', width: 12, height: 1, background: 'var(--accent)', verticalAlign: 'middle', marginRight: 6 }} />primary path</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 1, background: 'var(--border-3)', borderTop: '1px dashed var(--border-3)', verticalAlign: 'middle', marginRight: 6 }} />fallback / observe</span>
          </div>
        </div>
      </section>

      {/* ── Quote + CTA ── */}
      <section style={{ padding: '72px 64px', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 56, alignItems: 'center' }}>
        <div>
          <div className="t-label" style={{ marginBottom: 18 }}>Field notes</div>
          <p style={{
            fontFamily: 'var(--font-display)', fontWeight: 200, fontSize: 40,
            lineHeight: 1.12, letterSpacing: '-0.025em', margin: '0 0 24px', color: 'var(--text)', maxWidth: 720,
          }}>
            "We replaced three internal dashboards with Pulse. The day a region went down, we caught it in the telemetry rail before our paging system caught it — and the streams resumed from offset. No lost work."
          </p>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em' }}>
            <div style={{ width: 32, height: 32, border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)', flexShrink: 0 }}>MD</div>
            <div>
              <div style={{ color: 'var(--text)' }}>Marisol Daviau</div>
              <div style={{ color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.14em', fontSize: 10, marginTop: 2 }}>Staff infra · Halcyon</div>
            </div>
          </div>
        </div>
        <div className="shell">
          <div style={{ background: 'var(--surface)', padding: 28 }}>
            <div className="t-label" style={{ marginBottom: 12 }}>Get started</div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 200, fontSize: 28, letterSpacing: '-0.025em', margin: '0 0 12px' }}>Ship a streaming surface this week.</h3>
            <p style={{ fontSize: 13, lineHeight: '21px', color: 'var(--text-2)', margin: '0 0 20px' }}>
              14-day trial. No card. Connect your model endpoint, drop in our React adapter, and you're streaming with full telemetry in under an hour.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={onEnterWorkspace} style={{ ...BTN_ACCENT_LG, padding: 12, width: '100%' }}>Open workspace ↗</button>
              <button style={{ ...BTN_OUTLINE_LG, padding: 12, width: '100%' }}>Talk to engineering</button>
            </div>
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-4)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              <span>SOC2 · Type II</span>
              <span>SLA · 99.95%</span>
              <span>14 regions</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        padding: '24px 64px',
        display: 'grid', gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)',
        letterSpacing: '0.14em', textTransform: 'uppercase', gap: 32,
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', color: 'var(--text-3)' }}>
          <div className="brand-mark" style={{ width: 16, height: 16 }} />
          Pulse · v3.14.2
        </div>
        <div style={{ justifySelf: 'center', display: 'flex', gap: 24 }}>
          {['Platform', 'Streaming', 'Telemetry', 'Pricing', 'Status', 'Docs', 'Privacy'].map((item) => (
            <span key={item} style={{ cursor: 'pointer' }}>{item}</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span><span className="ws-dot" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />All systems · 38ms</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Shared button styles ─────────────────────────────────────────────────────

const BTN_ACCENT: React.CSSProperties = {
  background: 'var(--accent)', color: '#1A1918',
  fontFamily: 'var(--font-mono)', fontSize: 10.5,
  letterSpacing: '0.18em', textTransform: 'uppercase',
  border: 0, padding: '9px 14px', cursor: 'pointer',
};
const BTN_ACCENT_LG: React.CSSProperties = {
  background: 'var(--accent)', color: '#1A1918',
  fontFamily: 'var(--font-mono)', fontSize: 11,
  letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 500,
  border: 0, padding: '12px 18px', cursor: 'pointer',
};
const BTN_OUTLINE_LG: React.CSSProperties = {
  background: 'transparent', color: 'var(--text)',
  fontFamily: 'var(--font-mono)', fontSize: 11,
  letterSpacing: '0.18em', textTransform: 'uppercase',
  border: '1px solid var(--border-2)', padding: '12px 18px', cursor: 'pointer',
};
const BTN_GHOST_SM: React.CSSProperties = {
  background: 'transparent', color: 'var(--text-3)',
  fontFamily: 'var(--font-mono)', fontSize: 11,
  letterSpacing: '0.18em', textTransform: 'uppercase',
  border: 0, padding: '12px 8px', cursor: 'pointer',
};
