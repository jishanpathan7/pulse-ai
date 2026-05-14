/**
 * Load scenarios — predefined stress test configurations.
 *
 * Each scenario has a name, description, SimulatorConfig, and optional
 * ChaosConfig. Run via StreamSimulator + ChaosEngine.
 *
 * Scenario design principles:
 *   - Start simple (singleStream) → increase complexity gradually
 *   - Isolate variables (one stressor per scenario)
 *   - Match real-world conditions (realistic token rates, conversation lengths)
 *   - Include worst-case (worstCase) for saturation testing
 *
 * All seeds are fixed → same scenario always produces identical load patterns.
 *
 * Quick reference:
 *   singleStreamNormal   1 stream, 50 tps, 200 tokens    — baseline
 *   singleStreamFast     1 stream, 150 tps, 500 tokens   — fast model
 *   concurrentStreams     3 streams, 50 tps each, 200 tok — multi-agent
 *   burstTraffic         1 stream, burst 200 tps → pause  — variable rate
 *   deepHistory          500 pre-loaded messages + stream — virtualization
 *   networkInstability   5% drop rate → replay recovery   — resilience
 *   reconnectStorm       3 forced disconnects during stream — reconnect perf
 *   worstCase            3 streams + drops + 500 messages  — full saturation
 */

import type { SimulatorConfig } from './simulator.js';
import type { ChaosConfig } from './chaos.js';

export interface LoadScenario {
  readonly name: string;
  readonly description: string;
  readonly simulator: SimulatorConfig;
  readonly chaos?: ChaosConfig;
  /** Expected duration in ms (for test timeouts). */
  readonly expectedDurationMs: number;
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

export const scenarios = {
  /**
   * Baseline: single stream at moderate rate.
   * Use to verify render pipeline is healthy before other tests.
   */
  singleStreamNormal: {
    name: 'single-stream-normal',
    description: '1 stream × 50 tps × 200 tokens. Baseline render pipeline test.',
    expectedDurationMs: 5000,
    simulator: {
      seed: 1001,
      streams: [{
        streamId: 'sim-stream-01',
        conversationId: 'sim-conv-01',
        tokenCount: 200,
        tokensPerSecond: 50,
        seed: 1001,
      }],
    },
  } satisfies LoadScenario,

  /**
   * Fast model: 150 tokens/s — saturates the RAF scheduler.
   * At 150 tps: ~2.5 tokens per 16ms frame.
   * Verifies BudgetAwareBatchStrategy kicks in if needed.
   */
  singleStreamFast: {
    name: 'single-stream-fast',
    description: '1 stream × 150 tps × 500 tokens. Saturates token queue.',
    expectedDurationMs: 5000,
    simulator: {
      seed: 2001,
      streams: [{
        streamId: 'sim-stream-fast',
        conversationId: 'sim-conv-01',
        tokenCount: 500,
        tokensPerSecond: 150,
        seed: 2001,
      }],
    },
  } satisfies LoadScenario,

  /**
   * Multi-stream: 3 concurrent streams.
   * Tests store isolation: only streaming message re-renders, not others.
   */
  concurrentStreams: {
    name: 'concurrent-streams',
    description: '3 streams × 50 tps each × 200 tokens. Tests store isolation.',
    expectedDurationMs: 6000,
    simulator: {
      seed: 3001,
      streams: [
        { streamId: 'sim-stream-a', conversationId: 'sim-conv-a', tokenCount: 200, tokensPerSecond: 50, seed: 3001 },
        { streamId: 'sim-stream-b', conversationId: 'sim-conv-b', tokenCount: 200, tokensPerSecond: 50, seed: 3002, startDelayMs: 500 },
        { streamId: 'sim-stream-c', conversationId: 'sim-conv-c', tokenCount: 200, tokensPerSecond: 50, seed: 3003, startDelayMs: 1000 },
      ],
    },
  } satisfies LoadScenario,

  /**
   * Burst traffic: alternates between 200 tps bursts and pauses.
   * Tests adaptive batch strategy response to variable load.
   * Implemented as two streams: one fast (burst) + one slow (trickle).
   */
  burstTraffic: {
    name: 'burst-traffic',
    description: 'Alternating 200 tps burst + 5 tps trickle. Tests adaptive batching.',
    expectedDurationMs: 8000,
    simulator: {
      seed: 4001,
      streams: [
        { streamId: 'sim-burst', conversationId: 'sim-conv-burst', tokenCount: 400, tokensPerSecond: 200, seed: 4001 },
        { streamId: 'sim-trickle', conversationId: 'sim-conv-trickle', tokenCount: 40, tokensPerSecond: 5, seed: 4002, startDelayMs: 500 },
      ],
    },
  } satisfies LoadScenario,

  /**
   * Network instability: 5% packet drop rate.
   * Tests gap detection + replay recovery path.
   * Requires real WS transport + ChaosEngine (not StreamSimulator).
   */
  networkInstability: {
    name: 'network-instability',
    description: '5% packet drop rate. Tests replay recovery latency.',
    expectedDurationMs: 10000,
    simulator: {
      seed: 5001,
      streams: [{
        streamId: 'sim-unstable',
        conversationId: 'sim-conv-01',
        tokenCount: 300,
        tokensPerSecond: 50,
        seed: 5001,
      }],
    },
    chaos: {
      dropRate: 0.05,
    },
  } satisfies LoadScenario,

  /**
   * Forced reconnects: disconnect every 50 messages.
   * Tests reconnect path + stream replay + state recovery.
   */
  reconnectStorm: {
    name: 'reconnect-storm',
    description: 'Forced disconnect every 50 msgs. Tests reconnect + replay.',
    expectedDurationMs: 15000,
    simulator: {
      seed: 6001,
      streams: [{
        streamId: 'sim-reconnect',
        conversationId: 'sim-conv-01',
        tokenCount: 300,
        tokensPerSecond: 30,
        seed: 6001,
      }],
    },
    chaos: {
      forceDisconnectAfter: 50,
    },
  } satisfies LoadScenario,

  /**
   * Deep history: TanStack Virtual stress test.
   * Start with 500 pre-existing messages, then add a stream.
   * Measures: virtualization ratio, scroll performance.
   * (Seed 7001: pre-populates conversationStore via direct store manipulation)
   */
  deepHistory: {
    name: 'deep-history',
    description: '500 pre-loaded messages + 1 new stream. Tests virtualization.',
    expectedDurationMs: 8000,
    simulator: {
      seed: 7001,
      streams: [{
        streamId: 'sim-deep',
        conversationId: 'sim-conv-deep',
        tokenCount: 200,
        tokensPerSecond: 50,
        seed: 7001,
        startDelayMs: 500, // Give time for pre-population
      }],
    },
  } satisfies LoadScenario,

  /**
   * Worst case: maximum concurrent stress.
   * 3 streams + 5% drops + high rate.
   * Use to find saturation point and measure grace degradation.
   */
  worstCase: {
    name: 'worst-case',
    description: '3 streams × 100 tps + 5% drops. Full saturation test.',
    expectedDurationMs: 12000,
    simulator: {
      seed: 9001,
      streams: [
        { streamId: 'sim-wc-a', conversationId: 'sim-conv-wc', tokenCount: 500, tokensPerSecond: 100, seed: 9001 },
        { streamId: 'sim-wc-b', conversationId: 'sim-conv-wc', tokenCount: 500, tokensPerSecond: 100, seed: 9002, startDelayMs: 200 },
        { streamId: 'sim-wc-c', conversationId: 'sim-conv-wc', tokenCount: 500, tokensPerSecond: 100, seed: 9003, startDelayMs: 400 },
      ],
    },
    chaos: {
      dropRate: 0.05,
      latencyMs: { mean: 20, jitter: 15 },
    },
  } satisfies LoadScenario,
} as const;

export type ScenarioName = keyof typeof scenarios;
