/**
 * transportStore — WebSocket connection state and metrics.
 *
 * Updated by: RenderPipeline._onStateChange()
 * Read by:    Connection status indicator only
 *
 * Selector discipline:
 *   Use primitive selectors to avoid object allocation on every read:
 *     const state = useTransportStore(s => s.connectionState);  ✓
 *     const { state, error } = useTransportStore(s => s);       ✗ (re-renders every write)
 *
 * Update frequency: very low (state transitions only, not per-message).
 * Subscribers: 1-2 components (status badge, reconnect overlay).
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ConnectionState, ConnectionMetrics } from '@pulse/types/transport';
import type { PulseError } from '@pulse/types/errors';
import { CONTROL_SEQ } from '@pulse/types/transport';

interface TransportState {
  readonly connectionState: ConnectionState;
  readonly metrics: ConnectionMetrics;
  readonly lastError: PulseError | null;
}

interface TransportActions {
  setConnectionState: (state: ConnectionState) => void;
  setMetrics: (metrics: ConnectionMetrics) => void;
  setLastError: (error: PulseError | null) => void;
  reset: () => void;
}

const INITIAL_METRICS: ConnectionMetrics = {
  connectedAt: null,
  lastPingMs: null,
  reconnectCount: 0,
  messagesSent: 0,
  messagesReceived: 0,
  bytesReceived: 0,
  sessionId: null,
  lastDeliveredSeq: CONTROL_SEQ,
};

const INITIAL_STATE: TransportState = {
  connectionState: 'idle',
  metrics: INITIAL_METRICS,
  lastError: null,
};

export const useTransportStore = create<TransportState & TransportActions>()(
  subscribeWithSelector((set) => ({
    ...INITIAL_STATE,

    setConnectionState: (connectionState) => set({ connectionState }),

    setMetrics: (metrics) => set({ metrics }),

    setLastError: (lastError) => set({ lastError }),

    reset: () => set(INITIAL_STATE),
  })),
);

// ─── Typed Selectors ──────────────────────────────────────────────────────────
// Export pre-built selectors for common access patterns.
// Using selectors instead of inline lambdas prevents creating new function
// references on every render.

export const selectConnectionState = (s: TransportState & TransportActions) =>
  s.connectionState;

export const selectIsConnected = (s: TransportState & TransportActions) =>
  s.connectionState === 'connected';

export const selectIsReconnecting = (s: TransportState & TransportActions) =>
  s.connectionState === 'reconnecting';

export const selectLastPingMs = (s: TransportState & TransportActions) =>
  s.metrics.lastPingMs;

export const selectLastError = (s: TransportState & TransportActions) =>
  s.lastError;
