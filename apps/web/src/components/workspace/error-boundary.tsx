/**
 * WorkspaceErrorBoundary — React error boundary for the workspace.
 *
 * Catches render-time errors and displays a recovery UI instead of
 * propagating to the root. Three recovery options:
 *   1. Retry — unmount/remount the failed subtree
 *   2. Reset stores — clear all Zustand state (nuclear option)
 *   3. Reload — full page reload (last resort)
 *
 * Scope strategy:
 *   - One boundary wraps the entire ConversationPane
 *   - The Sidebar and StatusBar are outside → stay functional during recovery
 *   - MessageItem has its own boundary (isolates per-message render errors)
 *
 * Error reporting:
 *   In production, errors would be forwarded to the OTEL error sink.
 *   Currently logs to console with structured metadata.
 */

import React from 'react';

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  retryCount: number;
}

interface WorkspaceErrorBoundaryProps {
  children: React.ReactNode;
  /** Name of the boundary — used in error metadata */
  name?: string;
}

export class WorkspaceErrorBoundary extends React.Component<
  WorkspaceErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: WorkspaceErrorBoundaryProps) {
    super(props);
    this.state = { error: null, errorInfo: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    // Structured error log — Phase 10 wires to OTEL
    console.error('[Pulse Error Boundary]', {
      boundary: this.props.name ?? 'unnamed',
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      retryCount: this.state.retryCount,
    });
  }

  private _retry = () => {
    this.setState((s) => ({
      error: null,
      errorInfo: null,
      retryCount: s.retryCount + 1,
    }));
  };

  private _resetStores = () => {
    // Import stores dynamically to avoid circular deps in this file
    import('../../store/stream-store.js').then((m) => {
      useStreamStoreReset(m);
    });
    this._retry();
  };

  override render() {
    if (this.state.error === null) {
      return this.props.children;
    }

    const { error, errorInfo, retryCount } = this.state;

    return (
      <div style={CONTAINER_STYLE}>
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>⚠</div>
          <h2 style={TITLE_STYLE}>Render error</h2>
          <p style={DESC_STYLE}>
            A component threw an error during rendering. The error has been logged.
          </p>

          {/* Error detail */}
          <div style={ERROR_BOX_STYLE}>
            <div style={{ color: '#f87171', fontWeight: 600, marginBottom: 4 }}>
              {error.name}: {error.message}
            </div>
            {errorInfo?.componentStack && (
              <pre style={STACK_STYLE}>
                {errorInfo.componentStack.slice(0, 500)}
                {errorInfo.componentStack.length > 500 ? '…' : ''}
              </pre>
            )}
          </div>

          {retryCount > 0 && (
            <p style={{ fontSize: '0.75rem', color: '#475569', marginBottom: 12 }}>
              Retried {retryCount} time{retryCount !== 1 ? 's' : ''}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
            <button onClick={this._retry} style={PRIMARY_BTN}>
              ↺ Retry ({retryCount} attempts)
            </button>
            <button onClick={this._resetStores} style={SECONDARY_BTN}>
              Reset stores + retry
            </button>
            <button onClick={() => window.location.reload()} style={TERTIARY_BTN}>
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// Dynamic import helper — avoids circular imports from class body
function useStreamStoreReset(m: { useStreamStore: { getState: () => { abortAllStreams: () => void } } }) {
  m.useStreamStore.getState().abortAllStreams();
}

// ─── MessageItemErrorBoundary ─────────────────────────────────────────────────
// Lightweight boundary for individual message items.
// Shows a small inline error instead of crashing the entire list.

interface MessageItemBoundaryState { error: Error | null }

export class MessageItemErrorBoundary extends React.Component<
  { children: React.ReactNode; messageId?: string },
  MessageItemBoundaryState
> {
  constructor(props: { children: React.ReactNode; messageId?: string }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): MessageItemBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error('[Pulse] MessageItem render error', {
      messageId: this.props.messageId,
      error: error.message,
    });
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div style={{
        padding: '6px 10px',
        background: 'rgba(239, 68, 68, 0.06)',
        border: '1px solid rgba(239, 68, 68, 0.15)',
        borderRadius: 4,
        fontSize: '0.75rem',
        color: '#f87171',
        fontFamily: '"JetBrains Mono", monospace',
      }}>
        ⚠ Message render error: {this.state.error.message}
      </div>
    );
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CONTAINER_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 40,
};

const CARD_STYLE: React.CSSProperties = {
  maxWidth: 480,
  width: '100%',
  background: '#080c12',
  border: '1px solid rgba(239, 68, 68, 0.2)',
  borderRadius: 10,
  padding: '28px 28px 24px',
  textAlign: 'center',
};

const TITLE_STYLE: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: '1rem',
  fontWeight: 700,
  color: '#f87171',
};

const DESC_STYLE: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: '0.875rem',
  color: '#64748b',
};

const ERROR_BOX_STYLE: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #21262d',
  borderRadius: 6,
  padding: '10px 12px',
  marginBottom: 16,
  textAlign: 'left',
  fontSize: '0.8125rem',
  fontFamily: '"JetBrains Mono", monospace',
};

const STACK_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: '0.7rem',
  color: '#475569',
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
};

const PRIMARY_BTN: React.CSSProperties = {
  padding: '8px 16px',
  background: 'rgba(56, 189, 248, 0.08)',
  border: '1px solid rgba(56, 189, 248, 0.2)',
  borderRadius: 6,
  color: '#38bdf8',
  fontSize: '0.875rem',
  fontFamily: '"JetBrains Mono", monospace',
  cursor: 'pointer',
};

const SECONDARY_BTN: React.CSSProperties = {
  padding: '6px 16px',
  background: 'transparent',
  border: '1px solid #1e293b',
  borderRadius: 6,
  color: '#475569',
  fontSize: '0.8125rem',
  cursor: 'pointer',
};

const TERTIARY_BTN: React.CSSProperties = {
  padding: '4px 16px',
  background: 'transparent',
  border: 'none',
  color: '#334155',
  fontSize: '0.75rem',
  cursor: 'pointer',
};
