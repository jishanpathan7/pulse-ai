/**
 * WsTransportClient regression tests — handshake must be sent while the
 * machine is in `handshaking` (before `canSend()` is true).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_TRANSPORT_CONFIG } from '@pulse/transport';
import type { ClientId } from '@pulse/types/transport';
import { WsTransportClient } from '../ws-client';

interface FakeSocket {
  readyState: number;
  sent: string[];
  send: (d: string) => void;
  close: (code?: number, reason?: string) => void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev: { code: number; wasClean: boolean }) => void) | null;
  onerror: (() => void) | null;
}

let sockets: FakeSocket[] = [];
const factory = (): FakeSocket => {
  const s: FakeSocket = {
    readyState: 1,
    sent: [],
    send: (d) => s.sent.push(d),
    close: () => {},
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  sockets.push(s);
  return s;
};

const makeClient = (): WsTransportClient =>
  new WsTransportClient(
    { ...DEFAULT_TRANSPORT_CONFIG, clientId: 'client-1' as ClientId, handshakeTimeoutMs: 1_000 },
    factory as never,
  );

const frames = (s: FakeSocket): Array<{ type: string } & Record<string, unknown>> =>
  s.sent.map((raw) => (JSON.parse(raw) as { msg: { type: string } & Record<string, unknown> }).msg);

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
  (globalThis as Record<string, unknown>)['WebSocket'] = { OPEN: 1 };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WsTransportClient handshake', () => {
  it('sends the handshake as soon as the socket opens', () => {
    const client = makeClient();
    void client.connect('ws://test');
    const socket = sockets[0]!;
    socket.onopen?.();

    expect(client.state).toBe('handshaking');
    const sent = frames(socket);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'handshake', clientId: 'client-1', protocolVersion: '1' });
  });

  it('reaches connected and resolves connect() after handshake_ack', async () => {
    const client = makeClient();
    const pending = client.connect('ws://test');
    const socket = sockets[0]!;
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        v: '1',
        msg: {
          type: 'handshake_ack',
          sessionId: 'sess-1',
          serverTimestamp: 1,
          protocolVersion: '1',
          resumedFromSeq: 0,
        },
      }),
    });

    await expect(pending).resolves.toEqual({ ok: true, value: undefined });
    expect(client.state).toBe('connected');
    client.disconnect();
  });

  it('still rejects application messages before the handshake completes', () => {
    const client = makeClient();
    void client.connect('ws://test');
    sockets[0]!.onopen?.();

    const result = client.send({ type: 'stream_cancel', streamId: 's1' } as never);
    expect(result.ok).toBe(false);
    expect(frames(sockets[0]!).map((f) => f.type)).toEqual(['handshake']);
  });

  it('reports an error instead of silently dropping the handshake when the socket is closed', () => {
    const client = makeClient();
    const errors: string[] = [];
    client.onError((e) => errors.push(e.message));
    void client.connect('ws://test');
    const socket = sockets[0]!;
    socket.readyState = 3; // CLOSED before onopen handler runs
    socket.onopen?.();

    expect(socket.sent).toHaveLength(0);
    expect(errors).toEqual(['Socket is not open']);
  });
});
