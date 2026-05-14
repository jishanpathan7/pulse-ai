// ─── Interfaces & Config ──────────────────────────────────────────────────────
export type {
  TransportClient,
  TransportConfig,
  MessageHandler,
  StateChangeHandler,
  ErrorHandler,
  UnsubscribeFn,
} from './client.js';
export { DEFAULT_TRANSPORT_CONFIG } from './client.js';

// ─── State Machine ────────────────────────────────────────────────────────────
export type { MachineState, MachineEvent, StateListener } from './state-machine.js';
export { TransportStateMachine, reduce } from './state-machine.js';

// ─── Sequence Primitives ──────────────────────────────────────────────────────
export { toSeq, nextSeq, hasGap, gapSize } from './sequence.js';

// ─── Sequence Tracker ─────────────────────────────────────────────────────────
export type { ClassifyResult } from './sequence-tracker.js';
export { SequenceTracker } from './sequence-tracker.js';

// ─── Sequence Buffer ──────────────────────────────────────────────────────────
export type { Buffered } from './sequence-buffer.js';
export { SequenceBuffer } from './sequence-buffer.js';

// ─── Replay Coordinator ───────────────────────────────────────────────────────
export type { ActiveReplay, ReplayCompleteCallback } from './replay-coordinator.js';
export { ReplayCoordinator } from './replay-coordinator.js';

// ─── Backoff ──────────────────────────────────────────────────────────────────
export type { BackoffStrategy, BackoffConfig } from './backoff.js';
export {
  ExponentialBackoff,
  LinearBackoff,
  ImmediateBackoff,
  DEFAULT_BACKOFF_CONFIG,
} from './backoff.js';

// ─── Heartbeat ────────────────────────────────────────────────────────────────
export type { HeartbeatConfig, LatencyMeasurement, SendFn, TimeoutFn } from './heartbeat.js';
export { HeartbeatScheduler, DEFAULT_HEARTBEAT_CONFIG } from './heartbeat.js';

// ─── Codec ────────────────────────────────────────────────────────────────────
export { encode, decode } from './codec.js';

// ─── Stream Registry ──────────────────────────────────────────────────────────
export type { StreamChangeHandler } from './stream-registry.js';
export { StreamRegistry } from './stream-registry.js';
