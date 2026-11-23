import { describe, it, expect } from 'vitest';
import type { SequenceNumber } from '@pulse/types/transport';
import { SequenceBuffer } from '../sequence-buffer';

const s = (n: number): SequenceNumber => n as SequenceNumber;

describe('SequenceBuffer', () => {
  it('drains only the consecutive run from fromSeq', () => {
    const buf = new SequenceBuffer<{ seq: SequenceNumber; v: string }>();
    for (const n of [5, 6, 8, 9]) buf.push({ seq: s(n), v: `m${n}` });
    expect(buf.drainConsecutive(s(5)).map((m) => m.v)).toEqual(['m5', 'm6']);
    expect(buf.size()).toBe(2);
    expect(buf.lowestPending()).toBe(8);
    expect(buf.highestPending()).toBe(9);
  });

  it('returns nothing and leaves buffer intact when fromSeq is missing', () => {
    const buf = new SequenceBuffer<{ seq: SequenceNumber }>();
    buf.push({ seq: s(8) });
    expect(buf.drainConsecutive(s(7))).toEqual([]);
    expect(buf.size()).toBe(1);
  });

  it('push is idempotent per seq (replaces existing entry)', () => {
    const buf = new SequenceBuffer<{ seq: SequenceNumber; v: string }>();
    buf.push({ seq: s(1), v: 'a' });
    buf.push({ seq: s(1), v: 'b' });
    expect(buf.size()).toBe(1);
    expect(buf.drainConsecutive(s(1))[0]?.v).toBe('b');
  });

  it('evicts lowest seq when full', () => {
    const buf = new SequenceBuffer<{ seq: SequenceNumber }>();
    for (let n = 1; n <= 1001; n++) buf.push({ seq: s(n) });
    expect(buf.size()).toBe(1000);
    expect(buf.lowestPending()).toBe(2);
  });

  it('empty buffer reports null bounds', () => {
    const buf = new SequenceBuffer<{ seq: SequenceNumber }>();
    expect(buf.hasPending()).toBe(false);
    expect(buf.lowestPending()).toBeNull();
    expect(buf.highestPending()).toBeNull();
  });
});
