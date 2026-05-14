/**
 * Transport state machine — pure reducer pattern.
 *
 * The machine owns no timers, no sockets, no I/O.
 * All side effects live outside; callers react to state transitions.
 *
 * Invariants:
 *   - idle is the only entry state
 *   - failed and disconnected are terminal (no exit transitions)
 *   - reconnecting.attempt tracks total attempts across the lifetime
 *   - connected.sessionId is immutable for the duration of that connected state
 */

import type { ConnectionState, SessionId } from '@pulse/types/transport';

// ─── Internal Rich States ──────────────────────────────────────────────────────

export type MachineState =
  | { readonly status: 'idle' }
  | { readonly status: 'connecting'; readonly attempt: number }
  | { readonly status: 'handshaking'; readonly attempt: number }
  | {
      readonly status: 'connected';
      readonly sessionId: SessionId;
      readonly connectedAt: number;
      readonly attempt: number;
    }
  | {
      readonly status: 'reconnecting';
      readonly attempt: number;
      readonly lastSessionId: SessionId | null;
    }
  | { readonly status: 'disconnected'; readonly reason: string }
  | { readonly status: 'failed'; readonly attempt: number };

// ─── Events ───────────────────────────────────────────────────────────────────

export type MachineEvent =
  | { readonly type: 'CONNECT' }
  | { readonly type: 'SOCKET_OPEN' }
  | { readonly type: 'HANDSHAKE_ACK'; readonly sessionId: SessionId }
  | { readonly type: 'HANDSHAKE_TIMEOUT' }
  | { readonly type: 'SOCKET_CLOSE'; readonly intentional: boolean; readonly code: number }
  | { readonly type: 'SOCKET_ERROR' }
  | { readonly type: 'RETRY' }
  | { readonly type: 'EXHAUSTED' }
  | { readonly type: 'DISCONNECT' };

// ─── Pure Reducer ─────────────────────────────────────────────────────────────

export function reduce(state: MachineState, event: MachineEvent): MachineState {
  switch (state.status) {
    case 'idle':
      if (event.type === 'CONNECT') {
        return { status: 'connecting', attempt: 0 };
      }
      break;

    case 'connecting':
      if (event.type === 'SOCKET_OPEN') {
        return { status: 'handshaking', attempt: state.attempt };
      }
      if (event.type === 'SOCKET_CLOSE' || event.type === 'SOCKET_ERROR') {
        return { status: 'reconnecting', attempt: state.attempt, lastSessionId: null };
      }
      if (event.type === 'EXHAUSTED') {
        return { status: 'failed', attempt: state.attempt };
      }
      if (event.type === 'DISCONNECT') {
        return { status: 'disconnected', reason: 'user-initiated' };
      }
      break;

    case 'handshaking':
      if (event.type === 'HANDSHAKE_ACK') {
        return {
          status: 'connected',
          sessionId: event.sessionId,
          connectedAt: Date.now(),
          attempt: state.attempt,
        };
      }
      if (event.type === 'HANDSHAKE_TIMEOUT' || event.type === 'SOCKET_CLOSE') {
        return {
          status: 'reconnecting',
          attempt: state.attempt + 1,
          lastSessionId: null,
        };
      }
      if (event.type === 'SOCKET_ERROR') {
        return {
          status: 'reconnecting',
          attempt: state.attempt + 1,
          lastSessionId: null,
        };
      }
      if (event.type === 'EXHAUSTED') {
        return { status: 'failed', attempt: state.attempt };
      }
      if (event.type === 'DISCONNECT') {
        return { status: 'disconnected', reason: 'user-initiated' };
      }
      break;

    case 'connected':
      if (event.type === 'SOCKET_CLOSE') {
        if (event.intentional) {
          return { status: 'disconnected', reason: `close-${event.code}` };
        }
        return {
          status: 'reconnecting',
          attempt: 0,
          lastSessionId: state.sessionId,
        };
      }
      if (event.type === 'SOCKET_ERROR') {
        return {
          status: 'reconnecting',
          attempt: 0,
          lastSessionId: state.sessionId,
        };
      }
      if (event.type === 'DISCONNECT') {
        return { status: 'disconnected', reason: 'user-initiated' };
      }
      break;

    case 'reconnecting':
      if (event.type === 'RETRY') {
        return { status: 'connecting', attempt: state.attempt };
      }
      if (event.type === 'EXHAUSTED') {
        return { status: 'failed', attempt: state.attempt };
      }
      if (event.type === 'DISCONNECT') {
        return { status: 'disconnected', reason: 'user-initiated' };
      }
      break;

    // Terminal states — no transitions out
    case 'failed':
    case 'disconnected':
      break;
  }

  return state; // Unhandled event in current state — no transition
}

// ─── State Machine Class ──────────────────────────────────────────────────────

export type StateListener = (state: MachineState, prev: MachineState) => void;

export class TransportStateMachine {
  private _state: MachineState = { status: 'idle' };
  private readonly _listeners = new Set<StateListener>();

  get current(): MachineState {
    return this._state;
  }

  get connectionState(): ConnectionState {
    return this._state.status;
  }

  transition(event: MachineEvent): MachineState {
    const prev = this._state;
    const next = reduce(prev, event);
    if (next !== prev) {
      this._state = next;
      for (const listener of this._listeners) {
        listener(next, prev);
      }
    }
    return next;
  }

  onTransition(listener: StateListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /** True if the machine is in a state where messages can be sent. */
  canSend(): boolean {
    return this._state.status === 'connected';
  }

  /** Last session ID, available across reconnects until a clean disconnect. */
  lastSessionId(): SessionId | null {
    switch (this._state.status) {
      case 'connected':
        return this._state.sessionId;
      case 'reconnecting':
        return this._state.lastSessionId;
      default:
        return null;
    }
  }

  reset(): void {
    this._state = { status: 'idle' };
    this._listeners.clear();
  }
}
