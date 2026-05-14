/**
 * AuthScreen — login + register UI.
 *
 * Design: matches the Pulse AI design system.
 *   - Dark bg (#0E0E0D), accent orange (#FF4A1C)
 *   - Fraunces display font (brand mark)
 *   - Tabbed: login / register
 *   - Inline error display
 *   - Loading state on submit
 */

import { useState, useCallback } from 'react';
import { login, register, getMe } from '../../auth/auth-client.js';
import { useAuthStore } from '../../auth/auth-store.js';

type Mode = 'login' | 'register';

export function AuthScreen() {
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = mode === 'login'
        ? await login(email, password)
        : await register(email, password, displayName.trim() || undefined);

      if (!result.ok) {
        setError(
          result.code === 'EMAIL_EXISTS' ? 'Email already registered. Try signing in.'
          : result.code === 'INVALID_CREDENTIALS' ? 'Invalid email or password.'
          : result.error,
        );
        return;
      }

      // Fetch the user object (cookies are now set)
      const user = await getMe();
      if (user) setAuthenticated(user);
    } catch {
      setError('Connection error. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }, [mode, email, password, displayName, setAuthenticated]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      fontFamily: 'var(--font-body)',
    }}>

      {/* Brand mark */}
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
          <div className="brand-mark" aria-hidden style={{ width: 20, height: 20 }} />
          <span className="brand-name" style={{ fontSize: 20 }}>Pulse</span>
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 400,
          fontSize: 11,
          color: 'var(--text-4)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}>
          {mode === 'login' ? 'Sign in to continue' : 'Create your account'}
        </div>
      </div>

      {/* Card */}
      <div style={{
        width: '100%',
        maxWidth: 380,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '28px 28px 24px',
      }}>

        {/* Mode tabs */}
        <div style={{
          display: 'flex',
          gap: 0,
          marginBottom: 28,
          background: 'var(--bg)',
          borderRadius: 6,
          padding: 3,
        }}>
          {(['login', 'register'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); }}
              style={{
                flex: 1,
                padding: '7px 0',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                transition: 'all 120ms',
                background: mode === m ? 'var(--surface)' : 'transparent',
                color: mode === m ? 'var(--text)' : 'var(--text-3)',
                boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
              }}
            >
              {m === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>

          {/* Display name (register only) */}
          {mode === 'register' && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Display name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Optional"
                maxLength={64}
                style={inputStyle}
                autoComplete="name"
              />
            </div>
          )}

          {/* Email */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              maxLength={255}
              style={inputStyle}
              autoComplete="email"
              autoFocus
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Min 8 characters' : ''}
              required
              minLength={mode === 'register' ? 8 : 1}
              maxLength={128}
              style={inputStyle}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {/* Error */}
          {error !== null && (
            <div style={{
              marginBottom: 16,
              padding: '10px 14px',
              background: 'rgba(255, 74, 28, 0.08)',
              border: '1px solid rgba(255, 74, 28, 0.3)',
              borderRadius: 6,
              color: 'var(--accent)',
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px 0',
              background: loading ? 'var(--text-3)' : 'var(--accent)',
              color: '#1A1918',
              border: 'none',
              borderRadius: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'opacity 120ms',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading
              ? 'Please wait…'
              : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>

      {/* Footer note */}
      <div style={{
        marginTop: 24,
        color: 'var(--text-4)',
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
        textAlign: 'center',
      }}>
        Pulse AI · Realtime inference workspace
      </div>
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 120ms',
};
