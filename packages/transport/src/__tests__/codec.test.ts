import { describe, it, expect } from 'vitest';
import { decode, encode } from '../codec';

const frame = (msg: unknown, v: unknown = '1'): string => JSON.stringify({ v, msg });

describe('codec.decode', () => {
  it('decodes handshake_ack', () => {
    const r = decode(
      frame({
        type: 'handshake_ack',
        sessionId: 's1',
        serverTimestamp: 10,
        protocolVersion: '1',
        resumedFromSeq: 4,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        type: 'handshake_ack',
        sessionId: 's1',
        serverTimestamp: 10,
        protocolVersion: '1',
        resumedFromSeq: 4,
      });
    }
  });

  it('decodes stream_start, token, stream_end, stream_error', () => {
    const msgs = [
      { type: 'stream_start', seq: 1, timestamp: 1, streamId: 'st', conversationId: 'c' },
      { type: 'token', seq: 2, timestamp: 2, streamId: 'st', token: 'hi', tokenIndex: 0 },
      { type: 'stream_end', seq: 3, timestamp: 3, streamId: 'st', totalTokens: 1, durationMs: 2 },
      {
        type: 'stream_error',
        seq: 4,
        timestamp: 4,
        streamId: 'st',
        code: 'X',
        message: 'boom',
        retryable: true,
      },
    ];
    for (const m of msgs) {
      const r = decode(frame(m));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toEqual(m);
    }
  });

  it('decodes replay_chunk with sequenced inner messages', () => {
    const inner = { type: 'token', seq: 5, timestamp: 5, streamId: 'st', token: 'a', tokenIndex: 3 };
    const r = decode(
      frame({ type: 'replay_chunk', requestFromSeq: 5, requestToSeq: 5, messages: [inner], isLast: true }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === 'replay_chunk') {
      expect(r.value.messages).toEqual([inner]);
      expect(r.value.requestFromSeq).toBe(5);
      expect(r.value.isLast).toBe(true);
    }
  });

  it('rejects replay_chunk containing an unsequenced inner message', () => {
    const r = decode(
      frame({
        type: 'replay_chunk',
        requestFromSeq: 1,
        requestToSeq: 1,
        messages: [{ type: 'pong', clientTimestamp: 1, serverTimestamp: 2 }],
        isLast: true,
      }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects invalid JSON, wrong version, unknown type, missing fields', () => {
    expect(decode('{not json').ok).toBe(false);
    expect(decode(frame({ type: 'pong', clientTimestamp: 1, serverTimestamp: 2 }, '2')).ok).toBe(false);
    expect(decode(frame({ type: 'nope' })).ok).toBe(false);
    expect(decode(frame({ type: 'token', seq: 1, streamId: 'st' })).ok).toBe(false);
    expect(decode(frame({ type: 'token', seq: '1', timestamp: 1, streamId: 'st', token: 'a', tokenIndex: 0 })).ok).toBe(false);
  });

  it('encode wraps message in a v1 envelope', () => {
    const out = JSON.parse(encode({ type: 'ping', clientTimestamp: 7 } as never)) as Record<string, unknown>;
    expect(out['v']).toBe('1');
    expect(out['msg']).toEqual({ type: 'ping', clientTimestamp: 7 });
  });
});
