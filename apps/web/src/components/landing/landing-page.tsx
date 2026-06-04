import React from 'react';

// ─── LandingPage ──────────────────────────────────────────────────────────────

interface LandingPageProps {
  onEnterWorkspace: () => void;
}

const PROVIDERS = [
  { name: 'Anthropic', tag: 'Claude 3.7 · 200k ctx' },
  { name: 'OpenAI', tag: 'GPT-4o · o3' },
  { name: 'Google Gemini', tag: '2.5 Pro · Flash' },
  { name: 'xAI Grok', tag: 'Grok-3 · Beta' },
  { name: 'OpenRouter', tag: '300+ models · free tier' },
  { name: 'Groq', tag: 'LPU · ultra-fast inference' },
  { name: 'Together AI', tag: 'Open models · fine-tunes' },
];

const FEATURES = [
  {
    n: '01',
    title: 'Bring your own key',
    desc: 'Connect any provider — Anthropic, OpenAI, Gemini, Grok, OpenRouter, Together AI, Groq. Keys are encrypted at rest with AES-256-GCM, decrypted server-side per request, and never exposed to the browser after submission.',
    tag: 'Security',
  },
  {
    n: '02',
    title: 'Token streaming at 60fps',
    desc: 'Tokens are batched using requestAnimationFrame — not rendered per-token. The UI commits once per frame regardless of model speed. No jank on fast models. No stutter on long responses.',
    tag: 'Performance',
  },
  {
    n: '03',
    title: 'Zero-loss reconnect',
    desc: 'Every server message carries a monotonic sequence number. If your connection drops mid-stream, the client reconnects and the server replays from the exact token offset. No output lost. No restart required.',
    tag: 'Reliability',
  },
  {
    n: '04',
    title: 'Live telemetry rail',
    desc: 'WebSocket latency p50/p95, render FPS, frame commit time, dropped frames — all live alongside the conversation. Engineers can see what their streaming pipeline is doing in real time.',
    tag: 'Observability',
  },
];

export function LandingPage({ onEnterWorkspace }: LandingPageProps) {
  return (
    <div style={{
      overflowY: 'auto', overflowX: 'hidden',
      display: 'flex', flexDirection: 'column',
      minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
    }}>

      {/* ── Nav ── */}
      <header style={{
        height: 56, borderBottom: '1px solid var(--border)',
        display: 'grid', gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center', padding: '0 32px', flexShrink: 0,
        position: 'sticky', top: 0,
        background: 'rgba(14,14,13,0.92)', backdropFilter: 'blur(8px)', zIndex: 10,
      }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="brand-mark" style={{ width: 22, height: 22 }} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 19, letterSpacing: '-0.02em' }}>Pulse</span>
          <span className="brand-tag">AI</span>
        </div>

        <nav style={{
          justifySelf: 'center', display: 'flex', gap: 28,
          fontFamily: 'var(--font-mono)', fontSize: 11,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-3)',
        }}>
          {[
            { label: 'Providers', id: 'providers' },
            { label: 'Features', id: 'features' },
            { label: 'How it works', id: 'how-it-works' },
          ].map(({ label, id }) => (
            <span
              key={id}
              style={{ cursor: 'pointer', transition: 'color 120ms' }}
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}
            >
              {label}
            </span>
          ))}
        </nav>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span
            onClick={onEnterWorkspace}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)',
              letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
            }}
          >
            Sign in
          </span>
          <button onClick={onEnterWorkspace} style={BTN_ACCENT}>
            Get started ↗
          </button>
        </div>
      </header>

      {/* ── Hero ── */}
      <section style={{
        padding: '80px 64px 72px',
        borderBottom: '1px solid var(--border)',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div className="t-label" style={{ marginBottom: 20, color: 'var(--accent)' }}>
            ● Realtime AI workspace · BYOK · 7 providers
          </div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontWeight: 200,
            fontSize: 72, lineHeight: 0.96, letterSpacing: '-0.04em',
            margin: 0,
          }}>
            Chat with any AI.<br />
            <span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>See every frame.</span>
          </h1>
          <p style={{
            fontSize: 16, lineHeight: '27px', color: 'var(--text-2)',
            maxWidth: 500, margin: '28px 0 0',
          }}>
            Connect your own API keys from Anthropic, OpenAI, Gemini, Grok, or any provider. Tokens stream at 60fps with live telemetry. Dropped connections resume from the exact offset. No token ever lost.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 36, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={onEnterWorkspace} style={BTN_ACCENT_LG}>
              Start free — no card needed
            </button>
            <button onClick={onEnterWorkspace} style={BTN_OUTLINE_LG}>
              Sign in ↗
            </button>
          </div>
          <div style={{
            marginTop: 40, display: 'flex', gap: 28, flexWrap: 'wrap',
            fontFamily: 'var(--font-mono)', fontSize: 10.5,
            letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-4)',
          }}>
            <span>✓ Keys encrypted AES-256-GCM</span>
            <span>✓ Zero-loss reconnect</span>
            <span>✓ 7 providers</span>
          </div>
        </div>

        {/* Preview tile */}
        <div className="shell" style={{ alignSelf: 'start', marginTop: 4 }}>
          <div style={{ background: 'var(--surface)', padding: 0 }}>
            <div style={{
              height: 30, borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 14px',
              fontFamily: 'var(--font-mono)', fontSize: 9.5,
              letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-4)',
            }}>
              <span>Pulse AI · live preview</span>
              <span style={{ color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                Connected · 38ms
              </span>
            </div>
            <div style={{ padding: 20 }}>
              {/* User message */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ width: 20, height: 20, background: 'var(--surface-2)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)' }}>Y</div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>You · just now</span>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: '21px' }}>
                  Explain WebSocket replay recovery in streaming AI systems.
                </p>
              </div>

              {/* AI response */}
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ width: 20, height: 20, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 8, color: '#fff' }}>P</div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Pulse · streaming</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase', background: 'rgba(255,74,28,0.1)', padding: '1px 5px', border: '1px solid rgba(255,74,28,0.2)' }}>▶ live</span>
                </div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: '21px', color: 'var(--text)' }}>
                  When a WebSocket drops mid-stream, naive implementations restart from zero — losing all buffered tokens.{' '}
                  <strong style={{ color: 'var(--text)' }}>Pulse assigns a monotonic sequence number</strong> to every server message. On reconnect, the client sends its last seen sequence and the server replays the gap from a Redis buffer
                  <span style={{
                    display: 'inline-block', width: 2, height: '1em',
                    background: 'var(--accent)', verticalAlign: 'text-bottom',
                    marginLeft: 2, animation: 'pulse-cursor 1s step-end infinite',
                  }} />
                </p>
              </div>

              {/* Metrics */}
              <div style={{
                marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)',
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
                fontFamily: 'var(--font-mono)',
              }}>
                {[
                  { label: 'tok/s', val: '52.3', ok: true },
                  { label: 'ws p50', val: '38ms', ok: true },
                  { label: 'fps', val: '60', ok: true },
                  { label: 'dropped', val: '0', ok: true },
                ].map(({ label, val, ok }) => (
                  <div key={label}>
                    <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 15, color: ok ? 'var(--green)' : 'var(--red)', fontWeight: 400 }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="dotgrid" style={{
          position: 'absolute', right: -60, bottom: -60, width: 400, height: 300,
          opacity: 0.35, pointerEvents: 'none',
          maskImage: 'radial-gradient(circle, black 30%, transparent 75%)',
        }} />
      </section>

      {/* ── Providers strip ── */}
      <section id="providers" style={{ borderBottom: '1px solid var(--border)', padding: '32px 64px' }}>
        <div className="t-label" style={{ marginBottom: 20 }}>
          Connect your key from any provider
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
          {PROVIDERS.map(({ name, tag }) => (
            <div key={name} style={{ background: 'var(--surface)', padding: '16px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>{name}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-4)', letterSpacing: '0.06em' }}>{tag}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.1em' }}>
          Keys encrypted AES-256-GCM · decrypted server-side per request · never stored in plaintext · never logged
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" style={{ padding: '64px 64px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ marginBottom: 44 }}>
          <div className="t-label" style={{ marginBottom: 14 }}>What you get</div>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontWeight: 200,
            fontSize: 52, letterSpacing: '-0.035em', margin: 0, lineHeight: 1.02,
          }}>
            Built for the moment<br />
            <span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>after the demo.</span>
          </h2>
          <p style={{ fontSize: 15, lineHeight: '25px', color: 'var(--text-2)', maxWidth: 560, marginTop: 16 }}>
            Most AI chat tools are built for demos. Pulse is built for when the product is live, users are waiting, and something is wrong. Every feature exists to help you understand what's happening.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
          {FEATURES.map(({ n, title, desc, tag }) => (
            <div key={n} style={{ background: 'var(--surface)', padding: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em', color: 'var(--accent)' }}>{n}</span>
                <span className="t-label">{tag}</span>
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 500, margin: '0 0 10px', letterSpacing: '-0.01em' }}>{title}</h3>
              <p style={{ fontSize: 13.5, lineHeight: '22px', color: 'var(--text-3)', margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" style={{ padding: '64px 64px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ marginBottom: 40 }}>
          <div className="t-label" style={{ marginBottom: 14 }}>How it works</div>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontWeight: 200,
            fontSize: 48, letterSpacing: '-0.035em', margin: 0, lineHeight: 1.02,
          }}>
            Three steps to your<br />
            <span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>first stream.</span>
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
          {[
            { n: '01', title: 'Create account', desc: 'Sign up with email. No credit card. No OAuth dependency. Your data stays yours.' },
            { n: '02', title: 'Connect a key', desc: 'Open API Keys in the nav. Paste your provider key. It\'s encrypted immediately — you\'ll never see it again in the UI.' },
            { n: '03', title: 'Start chatting', desc: 'Pick a model, send a message. Watch tokens stream in at 60fps. Open Telemetry to see frame timing live.' },
          ].map(({ n, title, desc }) => (
            <div key={n} style={{ background: 'var(--bg)', padding: 28 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 300, color: 'var(--border-2)', marginBottom: 16, letterSpacing: '-0.02em' }}>{n}</div>
              <h3 style={{ fontSize: 18, fontWeight: 500, margin: '0 0 10px' }}>{title}</h3>
              <p style={{ fontSize: 13.5, lineHeight: '22px', color: 'var(--text-3)', margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: '80px 64px', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 64, alignItems: 'center' }}>
        <div>
          <div className="t-label" style={{ marginBottom: 18 }}>Get started today</div>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontWeight: 200,
            fontSize: 48, letterSpacing: '-0.035em', lineHeight: 1.08, margin: 0,
          }}>
            Your API key.<br />
            Your models.<br />
            <span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Full visibility.</span>
          </h2>
          <p style={{ fontSize: 15, lineHeight: '25px', color: 'var(--text-2)', margin: '20px 0 0', maxWidth: 440 }}>
            Free to use. Connect any AI provider. Tokens stream at 60fps with live telemetry and zero-loss reconnect built in.
          </p>
        </div>

        <div className="shell">
          <div style={{ background: 'var(--surface)', padding: 28 }}>
            <h3 style={{ fontSize: 20, fontWeight: 500, margin: '0 0 8px' }}>Free forever</h3>
            <p style={{ fontSize: 13, lineHeight: '21px', color: 'var(--text-2)', margin: '0 0 20px' }}>
              No credit card. No usage limits. Just connect your own API keys and start streaming.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={onEnterWorkspace} style={{ ...BTN_ACCENT_LG, padding: '13px 16px', width: '100%', fontSize: 12 }}>
                Create free account ↗
              </button>
              <button onClick={onEnterWorkspace} style={{ ...BTN_OUTLINE_LG, padding: '13px 16px', width: '100%', fontSize: 12 }}>
                Sign in to existing account
              </button>
            </div>
            <div style={{
              marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column', gap: 6,
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.08em',
            }}>
              {['✓ Keys encrypted AES-256-GCM', '✓ 7 AI providers supported', '✓ 60fps token streaming', '✓ Zero-loss reconnect'].map((f) => (
                <span key={f}>{f}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        padding: '24px 64px',
        display: 'grid', gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center', gap: 32,
        fontFamily: 'var(--font-mono)', fontSize: 10,
        color: 'var(--text-4)', letterSpacing: '0.12em', textTransform: 'uppercase',
      }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-3)' }}>
          <div className="brand-mark" style={{ width: 16, height: 16 }} />
          Pulse AI
        </div>
        <div style={{ justifySelf: 'center', display: 'flex', gap: 22 }}>
          <a href="https://github.com/jishanpathan7/pulse-ai" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer' }}>GitHub</a>
          <span style={{ cursor: 'pointer' }}>Privacy</span>
          <a href="mailto:jishanpatel78@gmail.com" style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer' }}>Contact</a>
        </div>
        <div>Built with TypeScript · Fastify · React 19</div>
      </footer>
    </div>
  );
}

// ─── Button styles ────────────────────────────────────────────────────────────

const BTN_ACCENT: React.CSSProperties = {
  background: 'var(--accent)', color: '#1A1918',
  fontFamily: 'var(--font-mono)', fontSize: 10.5,
  letterSpacing: '0.14em', textTransform: 'uppercase',
  border: 0, padding: '9px 14px', cursor: 'pointer', fontWeight: 500,
};
const BTN_ACCENT_LG: React.CSSProperties = {
  background: 'var(--accent)', color: '#1A1918',
  fontFamily: 'var(--font-mono)', fontSize: 11,
  letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600,
  border: 0, padding: '13px 20px', cursor: 'pointer',
};
const BTN_OUTLINE_LG: React.CSSProperties = {
  background: 'transparent', color: 'var(--text)',
  fontFamily: 'var(--font-mono)', fontSize: 11,
  letterSpacing: '0.14em', textTransform: 'uppercase',
  border: '1px solid var(--border-2)', padding: '13px 20px', cursor: 'pointer',
};
