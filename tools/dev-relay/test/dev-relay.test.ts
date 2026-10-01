import { finalizeEvent, getPublicKey, type NostrEvent } from '@bored-games/protocol';
import { type Filter, RelayPool } from '@bored-games/relay';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDevRelay } from '../src/server.ts';

const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const skA = new Uint8Array(32).fill(1);
const skB = new Uint8Array(32).fill(2);
const pkA = getPublicKey(skA);

let seq = 0;
function ev(
  opts: { sk?: Uint8Array; kind?: number; created_at?: number; tags?: string[][]; content?: string } = {},
) {
  return finalizeEvent(
    {
      kind: opts.kind ?? 7452,
      created_at: opts.created_at ?? 1000 + seq,
      tags: opts.tags ?? [],
      content: opts.content ?? `c${seq++}`,
    },
    opts.sk ?? skA,
    rnd,
  );
}

let relay: Awaited<ReturnType<typeof startDevRelay>>;
const pools: RelayPool[] = [];
const newPool = () => {
  const p = new RelayPool([relay.url], { WebSocket });
  pools.push(p);
  return p;
};

beforeEach(async () => {
  relay = await startDevRelay({ port: 0 });
});
afterEach(async () => {
  for (const p of pools.splice(0)) p.close();
  await relay.close();
});

/** Run a REQ and collect stored events up to EOSE. */
function query(pool: RelayPool, ...filters: Filter[]): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const got: NostrEvent[] = [];
    const unsub = pool.subscribe(
      filters,
      (e) => got.push(e),
      () => {
        unsub();
        resolve(got);
      },
    );
  });
}

describe('dev relay', () => {
  it('reports a ws:// url with the bound port', () => {
    expect(relay.url).toMatch(/^ws:\/\/localhost:\d+$/);
  });

  it('stores a published event and returns it on a query', async () => {
    const pool = newPool();
    const e = ev();
    expect(await pool.publish(e)).toEqual([{ url: relay.url, ok: true, message: '' }]);
    expect(await query(newPool(), { ids: [e.id] })).toEqual([e]);
  });

  it('answers a duplicate publish with ok true and keeps one copy', async () => {
    const pool = newPool();
    const e = ev();
    await pool.publish(e);
    const [again] = await pool.publish(e);
    expect(again?.ok).toBe(true);
    expect(await query(pool, { kinds: [7452] })).toEqual([e]);
  });

  it('rejects an invalid signature and an oversized event', async () => {
    const pool = newPool();
    const good = ev();
    const bad = { ...good, content: 'tampered' };
    const [r1] = await pool.publish(bad);
    expect(r1?.ok).toBe(false);
    expect(r1?.message).toMatch(/^invalid:/);
    const big = ev({ content: 'x'.repeat(262_144) });
    const [r2] = await pool.publish(big);
    expect(r2?.ok).toBe(false);
    expect(r2?.message).toMatch(/^invalid:/);
    expect(await query(pool, {})).toEqual([]);
  });

  it('delivers live events to an open subscription after EOSE', async () => {
    const sub = newPool();
    const pub = newPool();
    const old = ev();
    await pub.publish(old);
    const got: string[] = [];
    let eose = false;
    const done = new Promise<void>((resolve) => {
      sub.subscribe(
        [{ kinds: [7452] }],
        (e) => {
          got.push(e.id);
          if (e.id === live.id) resolve();
        },
        () => {
          eose = true;
        },
      );
    });
    const live = ev();
    await new Promise((r) => setTimeout(r, 100));
    expect(eose).toBe(true);
    expect(got).toEqual([old.id]);
    await pub.publish(live);
    await done;
    expect(got).toEqual([old.id, live.id]);
  });

  it('stops live delivery after CLOSE', async () => {
    const sub = newPool();
    const pub = newPool();
    const got: string[] = [];
    const unsub = sub.subscribe([{}], (e) => got.push(e.id));
    await new Promise((r) => setTimeout(r, 100));
    const first = ev();
    await pub.publish(first);
    await new Promise((r) => setTimeout(r, 100));
    unsub();
    await new Promise((r) => setTimeout(r, 100));
    await pub.publish(ev());
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toEqual([first.id]);
  });

  it('keeps the latest addressable event per (pubkey, kind, d)', async () => {
    const pool = newPool();
    const v1 = ev({ kind: 37450, created_at: 100, tags: [['d', 't1']], content: 'v1' });
    const v2 = ev({ kind: 37450, created_at: 200, tags: [['d', 't1']], content: 'v2' });
    const other = ev({ kind: 37450, created_at: 50, tags: [['d', 't2']], content: 'other' });
    const otherAuthor = ev({ sk: skB, kind: 37450, created_at: 50, tags: [['d', 't1']], content: 'b' });
    await pool.publish(v1);
    await pool.publish(other);
    await pool.publish(otherAuthor);
    const [r2] = await pool.publish(v2);
    expect(r2?.ok).toBe(true);
    const stored = await query(pool, { kinds: [37450] });
    expect(stored.map((e) => e.content).sort()).toEqual(['b', 'other', 'v2']);
    // An older version arriving late is not stored.
    const [late] = await pool.publish(v1);
    expect(late?.ok).toBe(false);
    expect(late?.message).toMatch(/^replaced:/);
    expect(
      (await query(pool, { kinds: [37450], authors: [pkA], '#d': ['t1'] })).map((e) => e.content),
    ).toEqual(['v2']);
  });

  it('breaks an addressable tie on created_at by keeping the lowest id', async () => {
    const a = ev({ kind: 37450, created_at: 100, tags: [['d', 'x']], content: 'a' });
    const b = ev({ kind: 37450, created_at: 100, tags: [['d', 'x']], content: 'b' });
    const [low, high] = a.id < b.id ? [a, b] : [b, a];
    for (const order of [
      [low, high],
      [high, low],
    ]) {
      const r = await startDevRelay({ port: 0 });
      const p = new RelayPool([r.url], { WebSocket });
      pools.push(p);
      for (const e of order) await p.publish(e);
      expect(await query(p, { kinds: [37450] })).toEqual([low]);
      p.close();
      await r.close();
    }
  });

  it('treats a missing d tag as the empty identifier', async () => {
    const pool = newPool();
    await pool.publish(ev({ kind: 37450, created_at: 1, content: 'one' }));
    await pool.publish(ev({ kind: 37450, created_at: 2, tags: [['d', '']], content: 'two' }));
    expect((await query(pool, { kinds: [37450] })).map((e) => e.content)).toEqual(['two']);
  });

  it('does not replace regular kinds', async () => {
    const pool = newPool();
    await pool.publish(ev({ kind: 7452, created_at: 1 }));
    await pool.publish(ev({ kind: 7452, created_at: 2 }));
    expect(await query(pool, { kinds: [7452] })).toHaveLength(2);
  });

  describe('filters', () => {
    async function seed() {
      const pool = newPool();
      const root = 'a'.repeat(64);
      const e1 = ev({ kind: 7452, created_at: 100, tags: [['e', root]] });
      const e2 = ev({
        kind: 7453,
        created_at: 200,
        tags: [
          ['e', root],
          ['p', pkA],
        ],
      });
      const e3 = ev({ sk: skB, kind: 7452, created_at: 300, tags: [['e', 'b'.repeat(64)]] });
      const e4 = ev({
        kind: 37450,
        created_at: 400,
        tags: [
          ['d', 'tbl'],
          ['a', `37450:${pkA}:tbl`],
        ],
      });
      for (const e of [e1, e2, e3, e4]) await pool.publish(e);
      return { pool, root, e1, e2, e3, e4 };
    }
    const ids = (es: NostrEvent[]) => es.map((e) => e.id);

    it('matches ids, kinds and authors', async () => {
      const { pool, e1, e2, e3, e4 } = await seed();
      expect(ids(await query(pool, { ids: [e2.id, e3.id] }))).toEqual([e3.id, e2.id]);
      expect(ids(await query(pool, { kinds: [7452] }))).toEqual([e3.id, e1.id]);
      expect(ids(await query(pool, { authors: [getPublicKey(skB)] }))).toEqual([e3.id]);
      expect(ids(await query(pool, { authors: [pkA], kinds: [7452, 37450] }))).toEqual([e4.id, e1.id]);
    });

    it('matches #e, #a, #d and #p tags', async () => {
      const { pool, root, e1, e2, e4 } = await seed();
      expect(ids(await query(pool, { '#e': [root] }))).toEqual([e2.id, e1.id]);
      expect(ids(await query(pool, { '#a': [`37450:${pkA}:tbl`] }))).toEqual([e4.id]);
      expect(ids(await query(pool, { '#d': ['tbl'] }))).toEqual([e4.id]);
      expect(ids(await query(pool, { '#p': [pkA] }))).toEqual([e2.id]);
      expect(ids(await query(pool, { '#e': ['c'.repeat(64)] }))).toEqual([]);
    });

    it('matches since (inclusive), until (inclusive) and limit (newest first)', async () => {
      const { pool, e1, e2, e3, e4 } = await seed();
      expect(ids(await query(pool, { since: 200 }))).toEqual([e4.id, e3.id, e2.id]);
      expect(ids(await query(pool, { until: 200 }))).toEqual([e2.id, e1.id]);
      expect(ids(await query(pool, { since: 200, until: 300 }))).toEqual([e3.id, e2.id]);
      expect(ids(await query(pool, { limit: 2 }))).toEqual([e4.id, e3.id]);
      expect(ids(await query(pool, { limit: 0 }))).toEqual([]);
    });

    it('ORs several filters and sends each event once', async () => {
      const { pool, e1, e2, e3 } = await seed();
      const got = await query(pool, { kinds: [7452] }, { ids: [e1.id, e2.id] });
      expect(ids(got).sort()).toEqual([e1.id, e2.id, e3.id].sort());
    });

    it('applies filters to live events too', async () => {
      const sub = newPool();
      const pub = newPool();
      const got: string[] = [];
      sub.subscribe([{ kinds: [7453] }], (e) => got.push(e.id));
      await new Promise((r) => setTimeout(r, 100));
      const miss = ev({ kind: 7452 });
      const hit = ev({ kind: 7453 });
      await pub.publish(miss);
      await pub.publish(hit);
      await new Promise((r) => setTimeout(r, 100));
      expect(got).toEqual([hit.id]);
    });
  });

  it('survives garbage frames and answers a malformed REQ with CLOSED', async () => {
    const ws = new WebSocket(relay.url);
    const frames: unknown[] = [];
    ws.onmessage = (m) => frames.push(JSON.parse(String(m.data)));
    await new Promise((r) => {
      ws.onopen = r;
    });
    ws.send('not json');
    ws.send(JSON.stringify({ a: 1 }));
    ws.send(JSON.stringify(['EVENT', { nope: true }]));
    ws.send(JSON.stringify(['REQ', 's1', { kinds: 'bad' }]));
    ws.send(JSON.stringify(['REQ', 's2', {}]));
    await new Promise((r) => setTimeout(r, 150));
    ws.close();
    expect(frames[0]).toEqual(['OK', '', false, expect.stringMatching(/^invalid:/)]);
    expect(frames[1]).toEqual(['CLOSED', 's1', expect.stringMatching(/^invalid:/)]);
    expect(frames[2]).toEqual(['EOSE', 's2']);
  });
});
