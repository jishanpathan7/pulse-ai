import React, { useCallback } from 'react';
import { useTransportStore, selectConnectionState } from '../../store/transport-store.js';
import { useTelemetryStore, selectAggregated } from '../../store/telemetry-store.js';
import { useWorkspaceStore, selectActiveSessionId, selectSessions } from '../../workspace/workspace-store.js';
import { useAuthStore } from '../../auth/auth-store.js';
import { useUIStore } from '../../store/ui-store.js';

function WsStatusPill() {
  const state = useTransportStore(selectConnectionState);
  const agg = useTelemetryStore(selectAggregated);

  const stateClass = state === 'reconnecting' ? 'warn' : (state === 'failed' || state === 'disconnected') ? 'err' : '';
  const label = state === 'connected'
    ? agg.wsRttP50Ms > 0 ? `● ${Math.round(agg.wsRttP50Ms)}ms` : '● live'
    : state === 'reconnecting' ? '◌ reconnecting'
    : '○ offline';

  return (
    <div className={`ws-pill ${stateClass}`} title={`WebSocket: ${state}`}>
      {label}
    </div>
  );
}

export const TopNav = React.memo(function TopNav() {
  const sessions = useWorkspaceStore(selectSessions);
  const activeId = useWorkspaceStore(selectActiveSessionId);
  const activeSession = sessions.find((s) => s.id === activeId);
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const toggleMobileSidebar = useWorkspaceStore((s) => s.toggleMobileSidebar);
  const openPanel = useUIStore((s) => s.openPanel);

  const crumbs = ['Workspace', 'Production', activeSession?.title ?? 'New session'];

  const handleLogout = useCallback(() => {
    void logout();
  }, [logout]);

  return (
    <header className="topnav">
      {/* Brand — includes hamburger on mobile */}
      <div className="topnav-brand">
        <button
          className="topnav-hamburger"
          onClick={toggleMobileSidebar}
          aria-label="Toggle sidebar"
        >
          <span /><span /><span />
        </button>
        <div className="brand-mark" aria-hidden />
        <span className="brand-name">Pulse</span>
        <span className="brand-tag">AI</span>
      </div>

      {/* Breadcrumbs — hidden on mobile */}
      <nav className="topnav-crumbs" aria-label="Breadcrumb">
        {crumbs.map((crumb, i) => (
          <React.Fragment key={crumb}>
            {i > 0 && <span className="crumb-sep" aria-hidden>/</span>}
            <span className={i === crumbs.length - 1 ? 'crumb-active' : ''}>{crumb}</span>
          </React.Fragment>
        ))}
      </nav>

      {/* Actions */}
      <div className="topnav-actions">
        <div className="topnav-ws-pill">
          <WsStatusPill />
        </div>
        <div className="topnav-kbd-hint" style={{ color: 'var(--text-4)' }}>
          <span className="kbd">⌘K</span>
        </div>
        {/* API Keys — BYOK key management (prominent accent button) */}
        <button
          onClick={() => openPanel('settings')}
          title="Connect your own API key"
          aria-label="Open API key settings"
          style={{
            background: 'rgba(255,74,28,0.10)',
            border: '1px solid var(--accent)',
            borderRadius: 4,
            color: 'var(--accent)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.06em',
            padding: '4px 10px',
            cursor: 'pointer',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            transition: 'background 120ms, opacity 120ms',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,74,28,0.18)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,74,28,0.10)';
          }}
        >
          <span style={{ fontSize: 9 }}>◉</span> API Keys
        </button>
        {/* User + logout */}
        <button
          onClick={handleLogout}
          title={`Sign out${user?.email ? ` (${user.email})` : ''}`}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-4)',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.1em',
            padding: '3px 8px',
            cursor: 'pointer',
            textTransform: 'uppercase',
            transition: 'color 120ms, border-color 120ms',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-2)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-4)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
          }}
        >
          sign out
        </button>
      </div>
    </header>
  );
});

TopNav.displayName = 'TopNav';
