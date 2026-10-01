import { finalizeEvent, getPublicKey, type NostrEvent } from '@bored-games/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelayPool } from '../src/pool.ts';

/** A scripted stand-in for the platform WebSocket: tests drive it by hand. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closeCalls = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(data);
  }
  close() {
    this.closeCalls++;
    this.readyState = 3;
    this.onclose?.({});
  }
  // Test controls.
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
  frames(): unknown[][] {
    return this.sent.map((s) => JSON.parse(s) as unknown[]);
  }
}

const sockets = (url: string) => FakeSocket.instances.filter((s) => s.url === url);
const latest = (url: string) => {
  const s = sockets(url).at(-1);
  if (!s) throw new Error(`no socket for ${url}`);
  return s;
};

const A = 'ws://a.test';
const B = 'ws://b.test';

const sk = new Uint8Array(32).fill(7);
const rnd = (n: number) => new Uint8Array(n).fill(3);
function makeEvent(content = 'hi', kind = 7452, created_at = 1000): NostrEvent {
  return finalizeEvent({ kind, created_at, tags: [['e', 'x']], content }, sk, rnd);
}

function pool(urls = [A, B], backoffMs?: number[]) {
  return new RelayPool(urls, {
    WebSocket: FakeSocket,
    ...(backoffMs ? { backoffMs } : {}),
  });
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RelayPool', () => {
  it('connects to every relay and reports status', () => {
    const p = pool();
    expect(p.status()).toEqual([
      { url: A, state: 'connecting' },
      { url: B, state: 'connecting' },
    ]);
    latest(A).open();
    expect(p.status()).toEqual([
      { url: A, state: 'open' },
      { url: B, state: 'connecting' },
    ]);
    latest(B).drop();
    expect(p.status()[1]).toEqual({ url: B, state: 'closed' });
    p.close();
  });

  it('publishes to two relays and reports a per-relay result, including OK false', async () => {
    const p = pool();
    latest(A).open();
    latest(B).open();
    const ev = makeEvent();
    const frozen = structuredClone(ev);
    const result = p.publish(ev);
    expect(latest(A).frames()).toEqual([['EVENT', ev]]);
    expect(latest(B).frames()).toEqual([['EVENT', ev]]);
    latest(A).receive(['OK', ev.id, true, '']);
    latest(B).receive(['OK', ev.id, false, 'blocked: nope']);
    expect(await result).toEqual([
      { url: A, ok: true, message: '' },
      { url: B, ok: false, message: 'blocked: nope' },
    ]);
    expect(ev).toEqual(frozen);
    p.close();
  });

  it('queues an event until the socket connects, then sends the same signed event', async () => {
    const p = pool([A]);
    const ev = makeEvent();
    const result = p.publish(ev);
    expect(latest(A).sent).toEqual([]);
    latest(A).open();
    expect(latest(A).frames()).toEqual([['EVENT', ev]]);
    latest(A).receive(['OK', ev.id, true, 'saved']);
    expect(await result).toEqual([{ url: A, ok: true, message: 'saved' }]);
    p.close();
  });

  it('times out after 10 s per relay without rejecting, and other relays still succeed', async () => {
    const p = pool();
    latest(A).open();
    latest(B).open();
    const ev = makeEvent();
    const result = p.publish(ev);
    latest(A).receive(['OK', ev.id, true, '']);
    await vi.advanceTimersByTimeAsync(9999);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual([
      { url: A, ok: true, message: '' },
      { url: B, ok: false, message: 'timeout' },
    ]);
    p.close();
  });

  it('times out a relay that never connects', async () => {
    const p = pool([A]);
    const result = p.publish(makeEvent());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual([{ url: A, ok: false, message: 'timeout' }]);
    p.close();
  });

  it('resends an unacknowledged event after a reconnect', async () => {
    const p = pool([A], [100]);
    latest(A).open();
    const ev = makeEvent();
    const result = p.publish(ev);
    latest(A).drop();
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets(A)).toHaveLength(2);
    latest(A).open();
    expect(latest(A).frames()).toEqual([['EVENT', ev]]);
    latest(A).receive(['OK', ev.id, true, '']);
    expect(await result).toEqual([{ url: A, ok: true, message: '' }]);
    p.close();
  });

  it('resolves pending publishes as closed when the pool closes', async () => {
    const p = pool([A]);
    const result = p.publish(makeEvent());
    p.close();
    expect(await result).toEqual([{ url: A, ok: false, message: 'closed' }]);
  });

  it('ignores an OK for an unknown id and non-OK junk', async () => {
    const p = pool([A]);
    latest(A).open();
    const ev = makeEvent();
    const result = p.publish(ev);
    latest(A).receive(['OK', 'f'.repeat(64), false, 'other']);
    latest(A).receive('not json');
    latest(A).receive(['WHAT', 1, 2]);
    latest(A).receive({ not: 'an array' });
    latest(A).receive(['NOTICE', 'hello']);
    latest(A).receive(['OK', ev.id, true, '']);
    expect(await result).toEqual([{ url: A, ok: true, message: '' }]);
    p.close();
  });

  it('subscribes with a REQ per relay and an incrementing subscription id', () => {
    const p = pool();
    latest(A).open();
    const filter = { kinds: [7452], '#e': ['r'.repeat(64)] };
    p.subscribe([filter], () => {});
    p.subscribe([{ kinds: [7450] }, { ids: ['a'] }], () => {});
    expect(latest(A).frames()).toEqual([
      ['REQ', 'bg-1', filter],
      ['REQ', 'bg-2', { kinds: [7450] }, { ids: ['a'] }],
    ]);
    expect(latest(B).sent).toEqual([]);
    latest(B).open();
    expect(latest(B).frames()).toEqual(latest(A).frames());
    p.close();
  });

  it('deduplicates events across relays and passes the first relay url', () => {
    const p = pool();
    latest(A).open();
    latest(B).open();
    const seen: [string, string][] = [];
    p.subscribe([{ kinds: [7452] }], (ev, url) => seen.push([ev.id, url]));
    const ev = makeEvent();
    latest(A).receive(['EVENT', 'bg-1', ev]);
    latest(B).receive(['EVENT', 'bg-1', ev]);
    latest(A).receive(['EVENT', 'bg-1', ev]);
    const ev2 = makeEvent('other');
    latest(B).receive(['EVENT', 'bg-1', ev2]);
    expect(seen).toEqual([
      [ev.id, A],
      [ev2.id, B],
    ]);
    p.close();
  });

  it('drops invalid, tampered, oversized and unrelated events', () => {
    const p = pool([A]);
    latest(A).open();
    const got: NostrEvent[] = [];
    p.subscribe([{}], (ev) => got.push(ev));
    const ev = makeEvent();
    latest(A).receive(['EVENT', 'bg-1', { ...ev, content: 'tampered' }]);
    latest(A).receive(['EVENT', 'bg-1', { ...ev, sig: '0'.repeat(128) }]);
    latest(A).receive(['EVENT', 'bg-1', { id: 'nope' }]);
    latest(A).receive(['EVENT', 'bg-1', 'string']);
    latest(A).receive(['EVENT', 'bg-1']);
    latest(A).receive(['EVENT', 'bg-9', ev]);
    latest(A).receive(['EVENT', 'bg-1', makeEvent('x'.repeat(262_144))]);
    expect(got).toEqual([]);
    latest(A).receive(['EVENT', 'bg-1', ev]);
    expect(got).toEqual([ev]);
    p.close();
  });

  it('calls onEose once, after every relay has answered; a closed relay does not block it', () => {
    const p = pool();
    latest(A).open();
    latest(B).open();
    const onEose = vi.fn();
    p.subscribe([{}], () => {}, onEose);
    latest(A).receive(['EOSE', 'bg-1']);
    expect(onEose).not.toHaveBeenCalled();
    latest(B).receive(['EOSE', 'bg-1']);
    expect(onEose).toHaveBeenCalledTimes(1);
    latest(A).receive(['EOSE', 'bg-1']);
    expect(onEose).toHaveBeenCalledTimes(1);
    p.close();

    const q = pool([A, B]);
    latest(A).open();
    const onEose2 = vi.fn();
    q.subscribe([{}], () => {}, onEose2);
    latest(A).receive(['EOSE', 'bg-1']);
    expect(onEose2).not.toHaveBeenCalled();
    latest(B).drop();
    expect(onEose2).toHaveBeenCalledTimes(1);
    q.close();
  });

  it('counts a CLOSED subscription from a relay as answered', () => {
    const p = pool([A]);
    latest(A).open();
    const onEose = vi.fn();
    p.subscribe([{}], () => {}, onEose);
    latest(A).receive(['CLOSED', 'bg-1', 'auth-required: no']);
    expect(onEose).toHaveBeenCalledTimes(1);
    p.close();
  });

  it('resubscribes after a reconnect and does not repeat delivered events', async () => {
    const p = pool([A], [50, 100]);
    latest(A).open();
    const got: string[] = [];
    const onEose = vi.fn();
    p.subscribe([{ kinds: [7452] }], (ev) => got.push(ev.id), onEose);
    const ev = makeEvent();
    latest(A).receive(['EVENT', 'bg-1', ev]);
    latest(A).receive(['EOSE', 'bg-1']);
    latest(A).drop();
    expect(p.status()).toEqual([{ url: A, state: 'closed' }]);
    await vi.advanceTimersByTimeAsync(49);
    expect(sockets(A)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets(A)).toHaveLength(2);
    expect(p.status()).toEqual([{ url: A, state: 'connecting' }]);
    latest(A).open();
    expect(latest(A).frames()).toEqual([['REQ', 'bg-1', { kinds: [7452] }]]);
    latest(A).receive(['EVENT', 'bg-1', ev]);
    const ev2 = makeEvent('later');
    latest(A).receive(['EVENT', 'bg-1', ev2]);
    expect(got).toEqual([ev.id, ev2.id]);
    expect(onEose).toHaveBeenCalledTimes(1);
    p.close();
  });

  it('backs off along the schedule, capped at the last value, and resets after an open', async () => {
    const p = pool([A], [10, 20, 30]);
    const failures = async (expected: number[]) => {
      for (const ms of expected) {
        const n = sockets(A).length;
        latest(A).drop();
        await vi.advanceTimersByTimeAsync(ms - 1);
        expect(sockets(A)).toHaveLength(n);
        await vi.advanceTimersByTimeAsync(1);
        expect(sockets(A)).toHaveLength(n + 1);
      }
    };
    await failures([10, 20, 30, 30, 30]);
    latest(A).open();
    await failures([10, 20]);
    p.close();
  });

  it('uses the default backoff schedule', async () => {
    const p = pool([A]);
    for (const ms of [1000, 2000, 5000, 10_000, 30_000, 30_000]) {
      const n = sockets(A).length;
      latest(A).drop();
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(sockets(A)).toHaveLength(n);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets(A)).toHaveLength(n + 1);
    }
    p.close();
  });

  it('keeps going when the socket constructor throws', async () => {
    let calls = 0;
    class Flaky extends FakeSocket {
      constructor(url: string) {
        calls++;
        if (calls === 1) throw new Error('boom');
        super(url);
      }
    }
    const p = new RelayPool([A], { WebSocket: Flaky, backoffMs: [10] });
    expect(p.status()).toEqual([{ url: A, state: 'closed' }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(p.status()).toEqual([{ url: A, state: 'connecting' }]);
    p.close();
  });

  it('unsubscribing sends CLOSE to open relays and stops delivery', () => {
    const p = pool();
    latest(A).open();
    const got: string[] = [];
    const unsub = p.subscribe([{}], (ev) => got.push(ev.id));
    unsub();
    expect(latest(A).frames()).toEqual([
      ['REQ', 'bg-1', {}],
      ['CLOSE', 'bg-1'],
    ]);
    latest(A).receive(['EVENT', 'bg-1', makeEvent()]);
    expect(got).toEqual([]);
    unsub();
    expect(latest(A).frames()).toHaveLength(2);
    // A relay that opens later is never asked for the cancelled subscription.
    latest(B).open();
    expect(latest(B).sent).toEqual([]);
    p.close();
  });

  it('close() closes sockets, sends nothing further and does not reconnect', async () => {
    const p = pool();
    latest(A).open();
    p.subscribe([{}], () => {});
    p.close();
    expect(sockets(A)[0]?.closeCalls).toBe(1);
    expect(sockets(B)[0]?.closeCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets(A)).toHaveLength(1);
    expect(sockets(B)).toHaveLength(1);
    expect(p.status()).toEqual([
      { url: A, state: 'closed' },
      { url: B, state: 'closed' },
    ]);
    expect(await p.publish(makeEvent())).toEqual([
      { url: A, ok: false, message: 'closed' },
      { url: B, ok: false, message: 'closed' },
    ]);
  });

  it('uses getPublicKey-signed events that verify (sanity)', () => {
    expect(makeEvent().pubkey).toBe(getPublicKey(sk));
  });
});
