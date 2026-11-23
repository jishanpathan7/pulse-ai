import { describe, it, expect, vi, afterEach } from 'vitest';
import type {
  ConversationId,
  SequenceNumber,
  StreamId,
  ServerStreamStartMessage,
  ServerTokenMessage,
  ServerStreamEndMessage,
  ServerStreamErrorMessage,
} from '@pulse/types/transport';
import { StreamRegistry } from '../stream-registry';

const id = 'st1' as StreamId;
const start: ServerStreamStartMessage = {
  type: 'stream_start',
  seq: 1 as SequenceNumber,
  timestamp: 100,
  streamId: id,
  conversationId: 'c1' as ConversationId,
};
const token = (seq: number): ServerTokenMessage => ({
  type: 'token',
  seq: seq as SequenceNumber,
  timestamp: 100 + seq,
  streamId: id,
  token: 'x',
  tokenIndex: seq - 2,
});
const end: ServerStreamEndMessage = {
  type: 'stream_end',
  seq: 10 as SequenceNumber,
  timestamp: 200,
  streamId: id,
  totalTokens: 2,
  durationMs: 100,
};
const error: ServerStreamErrorMessage = {
  type: 'stream_error',
  seq: 10 as SequenceNumber,
  timestamp: 200,
  streamId: id,
  code: 'E',
  message: 'boom',
  retryable: false,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('StreamRegistry', () => {
  it('tracks start → tokens → end lifecycle and notifies listeners', () => {
    const reg = new StreamRegistry();
    const seen: string[] = [];
    reg.onStreamChange((s) => seen.push(s.status));
    reg.onStreamStart(start);
    reg.onToken(token(2));
    reg.onToken(token(3));
    expect(reg.getStream(id)?.totalTokens).toBe(2);
    expect(reg.activeStreams).toHaveLength(1);
    const done = reg.onStreamEnd(end);
    expect(done?.status).toBe('completed');
    expect(done?.completedAt).toBe(200);
    expect(reg.activeStreams).toHaveLength(0);
    expect(seen).toEqual(['streaming', 'streaming', 'streaming', 'completed']);
    reg.reset();
  });

  it('ignores tokens before stream_start and duplicate stream_start', () => {
    const reg = new StreamRegistry();
    reg.onToken(token(2));
    expect(reg.getStream(id)).toBeNull();
    reg.onStreamStart(start);
    reg.onToken(token(2));
    reg.onStreamStart(start);
    expect(reg.getStream(id)?.totalTokens).toBe(1);
    reg.reset();
  });

  it('terminal states do not transition', () => {
    const reg = new StreamRegistry();
    reg.onStreamStart(start);
    reg.onStreamError(error);
    expect(reg.getStream(id)?.status).toBe('error');
    expect(reg.getStream(id)?.errorCode).toBe('E');
    reg.onToken(token(3));
    reg.onStreamEnd(end);
    reg.abortStream(id);
    expect(reg.getStream(id)?.status).toBe('error');
    reg.reset();
  });

  it('abortAll aborts active streams', () => {
    const reg = new StreamRegistry();
    reg.onStreamStart(start);
    reg.abortAll();
    expect(reg.getStream(id)?.status).toBe('aborted');
    reg.reset();
  });

  it('evicts completed streams after TTL', () => {
    vi.useFakeTimers();
    const reg = new StreamRegistry();
    reg.onStreamStart(start);
    reg.onStreamEnd(end);
    vi.advanceTimersByTime(59_999);
    expect(reg.getStream(id)).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(reg.getStream(id)).toBeNull();
  });
});
