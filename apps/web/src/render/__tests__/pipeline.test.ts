/**
 * RenderPipeline regression tests — token delivery and stream finalization.
 *
 * Drives the real pipeline + stores through a fake transport and a manual
 * requestAnimationFrame queue, then inspects what reached the stores.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ServerMessage } from '@pulse/types/transport';
import type { BatchStrategy } from '../adaptive-batch';
import { RenderPipeline } from '../pipeline';
import { useStreamStore } from '../../store/stream-store';
import { useConversationStore } from '../../store/conversation-store';

let rafQueue: Array<(t: number) => void> = [];
const frame = (): void => {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(performance.now());
};

let n = 0;
interface Harness {
  pipeline: RenderPipeline;
  emit: (m: Record<string, unknown>) => void;
  sid: string;
  cid: string;
  seq: () => number;
}

function setup(): Harness {
  let handler: (m: ServerMessage) => void = () => {};
  const transport = {
    onMessage: (h: (m: ServerMessage) => void) => {
      handler = h;
      return () => {};
    },
    onStateChange: () => () => {},
    onError: () => () => {},
  };
  const pipeline = new RenderPipeline();
  pipeline.connect(transport as never);
  n++;
  let s = 1;
  return {
    pipeline,
    emit: (m) => handler(m as unknown as ServerMessage),
    sid: `stream-${n}`,
    cid: `conv-${n}`,
    seq: () => s++,
  };
}

const start = (h: Harness): void =>
  h.emit({ type: 'stream_start', seq: h.seq(), timestamp: 0, streamId: h.sid, conversationId: h.cid });
const token = (h: Harness, t: string, i: number): void =>
  h.emit({ type: 'token', seq: h.seq(), timestamp: 0, streamId: h.sid, token: t, tokenIndex: i });
const end = (h: Harness, total: number): void =>
  h.emit({ type: 'stream_end', seq: h.seq(), timestamp: 0, streamId: h.sid, totalTokens: total, durationMs: 1 });
const fail = (h: Harness): void =>
  h.emit({
    type: 'stream_error',
    seq: h.seq(),
    timestamp: 0,
    streamId: h.sid,
    code: 'rate_limited',
    message: 'slow down',
    retryable: true,
  });

const finalContent = (cid: string): string[] =>
  (useConversationStore.getState().conversations[cid]?.messages ?? []).map((m) => m.content);
const active = (sid: string) => useStreamStore.getState().activeStreams[sid];

beforeEach(() => {
  rafQueue = [];
  (globalThis as Record<string, unknown>)['requestAnimationFrame'] = (cb: (t: number) => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  (globalThis as Record<string, unknown>)['cancelAnimationFrame'] = () => {};
  useStreamStore.getState().abortAllStreams();
});

afterEach(() => {
  useStreamStore.getState().abortAllStreams();
});

describe('RenderPipeline token delivery', () => {
  it('commits each token exactly once (no duplication at stream_end)', () => {
    const h = setup();
    start(h);
    ['Hel', 'lo', ' world'].forEach((t, i) => {
      token(h, t, i);
      frame();
    });
    expect(active(h.sid)?.content).toBe('Hello world');
    end(h, 3);
    frame();
    expect(finalContent(h.cid)).toEqual(['Hello world']);
    expect(active(h.sid)).toBeUndefined();
    h.pipeline.disconnect();
  });

  it('delivers tokens once when stream_end arrives before the frame fires', () => {
    const h = setup();
    start(h);
    token(h, 'a', 0);
    token(h, 'b', 1);
    end(h, 2);
    frame();
    expect(finalContent(h.cid)).toEqual(['ab']);
    h.pipeline.disconnect();
  });

  it('keeps deferred tokens in order when the batch strategy holds some back', () => {
    const h = setup();
    let allow = true;
    const strategy: BatchStrategy = {
      shouldFlush: () => ({ shouldFlush: allow, reason: allow ? 'normal' : 'budget-pressure' }),
    };
    (h.pipeline as unknown as { _batchStrategy: BatchStrategy })._batchStrategy = strategy;

    start(h);
    token(h, '1', 0);
    frame();
    allow = false;
    token(h, '2', 1); // deferred
    token(h, '3', 2); // deferred
    frame();
    expect(active(h.sid)?.content).toBe('1');
    allow = true;
    token(h, '4', 3); // flush drains 2,3,4 in order
    frame();
    expect(active(h.sid)?.content).toBe('1234');
    end(h, 4);
    frame();
    expect(finalContent(h.cid)).toEqual(['1234']);
    h.pipeline.disconnect();
  });

  it('flushes deferred tokens at stream_end', () => {
    const h = setup();
    (h.pipeline as unknown as { _batchStrategy: BatchStrategy })._batchStrategy = {
      shouldFlush: () => ({ shouldFlush: false, reason: 'budget-pressure' }),
    };
    start(h);
    token(h, 'x', 0);
    token(h, 'y', 1);
    frame();
    end(h, 2);
    frame();
    expect(finalContent(h.cid)).toEqual(['xy']);
    h.pipeline.disconnect();
  });
});

describe('RenderPipeline finalization', () => {
  it('finalizes a stream that errors before any token (does not stay streaming)', () => {
    const h = setup();
    start(h);
    expect(useStreamStore.getState().streamCount).toBe(1);
    fail(h);
    expect(active(h.sid)).toBeUndefined();
    expect(useStreamStore.getState().streamCount).toBe(0);
    expect(finalContent(h.cid)).toEqual([]); // errors are not added as assistant messages
    h.pipeline.disconnect();
  });

  it('finalizes a zero-token stream_end with an empty message', () => {
    const h = setup();
    start(h);
    end(h, 0);
    expect(active(h.sid)).toBeUndefined();
    expect(useStreamStore.getState().streamCount).toBe(0);
    expect(finalContent(h.cid)).toEqual(['']);
    h.pipeline.disconnect();
  });

  it('does not finalize before queued tokens are committed', () => {
    const h = setup();
    start(h);
    token(h, 'late', 0); // queued, frame not fired yet
    fail(h);
    expect(active(h.sid)?.status).toBe('streaming'); // still waiting on the flush
    frame();
    expect(active(h.sid)).toBeUndefined();
    expect(useStreamStore.getState().streamCount).toBe(0);
    h.pipeline.disconnect();
  });

  it('a zero-token error on one stream does not wait on another stream’s flush', () => {
    const a = setup();
    const b = setup();
    start(a);
    start(b);
    token(a, 'busy', 0); // stream A has queued work
    fail(b); // stream B has none
    expect(active(b.sid)).toBeUndefined();
    frame();
    expect(active(a.sid)?.content).toBe('busy');
    a.pipeline.disconnect();
    b.pipeline.disconnect();
  });
});
