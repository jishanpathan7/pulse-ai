import { useEffect, useState, useCallback } from 'react';
import { WorkspaceLayout } from './components/workspace/workspace-layout.js';
import { LandingPage } from './components/landing/landing-page.js';
import { AuthScreen } from './components/auth/auth-screen.js';
import { DebugOverlay } from './components/debug/debug-overlay.js';
import { useConversationStore } from './store/conversation-store.js';
import { useWorkspaceStore, selectActiveSessionId } from './workspace/workspace-store.js';
import { useAuthStore } from './auth/auth-store.js';
import { scheduleTokenRefresh, cancelTokenRefresh } from './auth/token-refresh.js';
import type { ConversationId } from '@pulse/types/transport';

const IS_DEV = import.meta.env.DEV;

function isWorkspacePath() {
  return window.location.pathname.startsWith('/app') || window.location.hash === '#app';
}

export function App() {
  const [inWorkspace, setInWorkspace] = useState(isWorkspacePath);

  const activeSessionId = useWorkspaceStore(selectActiveSessionId);
  const ensureConversation = useConversationStore((s) => s.ensureConversation);

  // Auth state
  const authStatus = useAuthStore((s) => s.status);
  const checkSession = useAuthStore((s) => s.checkSession);

  // Check auth session on mount
  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  // Start/cancel token refresh timer based on auth status
  useEffect(() => {
    if (authStatus === 'authenticated') {
      scheduleTokenRefresh();
    } else {
      cancelTokenRefresh();
    }
    return () => cancelTokenRefresh();
  }, [authStatus]);

  useEffect(() => {
    ensureConversation(activeSessionId as ConversationId);
  }, [activeSessionId, ensureConversation]);

  // Sync browser navigation (back/forward)
  useEffect(() => {
    const handlePop = () => setInWorkspace(isWorkspacePath());
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const enterWorkspace = useCallback(() => {
    window.history.pushState(null, '', '/app');
    setInWorkspace(true);
  }, []);

  // Loading — checking existing session
  if (authStatus === 'loading') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-4)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        letterSpacing: '0.08em',
      }}>
        LOADING…
      </div>
    );
  }

  // Unauthenticated — show auth screen
  if (authStatus === 'unauthenticated') {
    return <AuthScreen />;
  }

  // Authenticated — landing or workspace
  if (!inWorkspace) {
    return <LandingPage onEnterWorkspace={enterWorkspace} />;
  }

  return (
    <>
      <WorkspaceLayout />
      {IS_DEV && <DebugOverlay />}
    </>
  );
}
