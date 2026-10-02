/*
 * The ProfileStore against a fake pool (batching, ref counts, cache, save) and against the dev relay
 * (newest wins, unknown fields and tags kept).
 */
import { type DevRelay, startDevRelay } from '@bored-games/dev-relay';
import { finalizeEvent, getPublicKey, type NostrEvent } from '@bored-games/protocol';
import { type EoseInfo, type Filter, type PublishResult, RelayPool } from '@bored-games/relay';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Timers } from '../src/clock.ts';
import { platformTimers } from '../src/clock.ts';
import { hexToBytes } from '../src/hex.ts';
import { importSecretKey, isImportedKey, type Signer } from '../src/identity.ts';
import type { PoolLike } from '../src/net.ts';
import { PROFILE_CACHE_TTL_S } from '../src/profile-model.ts';
import { NO_RELAY_ACCEPTED_PROFILE, ProfileStore } from '../src/profiles.ts';
import { type KeyValueStore, memoryStorage, storageKey } from '../src/storage.ts';

const rnd = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

function signer(kind: Signer['kind'] = 'local'): Signer & { sk: Uint8Array } {
  const sk = rnd(32);
  return { kind, sk, pubkey: getPublicKey(sk), sign: async (t) => finalizeEvent(t, sk, rnd) };
}

function kind0(
  s: { sk: Uint8Array },
  content: object,
  created_at: number,
  tags: string[][] = [],
): NostrEvent {
  return finalizeEvent({ kind: 0, created_at, tags, content: JSON.stringify(content) }, s.sk, rnd);
}

/** A store that counts as persistent (like localStorage), unlike `memoryStorage()`. */
function diskStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}

/** Timers run by hand: `tick()` fires everything due. */
function manualTimers() {
  let jobs: { fn: () => void; live: boolean }[] = [];
  const timers: Timers = {
    later(_ms, fn) {
      const job = { fn, live: true };
      jobs.push(job);
      return () => {
        job.live = false;
      };
    },
    every() {
      return () => {};
    },
  };
  return {
    timers,
    tick() {
      const due = jobs;
      jobs = [];
      for (const j of due) if (j.live) j.fn();
    },
  };
}

interface Sub {
  filters: Filter[];
  onEvent: (ev: NostrEvent, url: string) => void;
  onEose?: (info: EoseInfo) => void;
  open: boolean;
}

function fakePool(accept = true) {
  const subs: Sub[] = [];
  const published: NostrEvent[] = [];
  const pool: PoolLike = {
    async publish(ev, urls): Promise<PublishResult[]> {
      published.push(ev);
      return (urls ?? ['wss://r.example']).map((url) => ({ url, ok: accept, message: '' }));
    },
    subscribe(filters, onEvent, onEose) {
      const sub: Sub = { filters, onEvent, ...(onEose === undefined ? {} : { onEose }), open: true };
      subs.push(sub);
      return () => {
        sub.open = false;
      };
    },
  };
  return { pool, subs, published, live: () => subs.filter((s) => s.open) };
}

const NOW = 1_800_000_000;
/** Every relay answered. */
const ANSWERED: EoseInfo = { eose: 1, relays: 1, timedOut: false };
/** Every relay failed to connect. */
const NO_ANSWER: EoseInfo = { eose: 0, relays: 1, timedOut: false };

function store(opts: { pool?: PoolLike; storage?: KeyValueStore; now?: () => number } = {}) {
  const t = manualTimers();
  const fp = fakePool();
  const s = new ProfileStore({
    pool: opts.pool ?? fp.pool,
    storage: opts.storage ?? memoryStorage(),
    profile: 'a',
    now: opts.now ?? (() => NOW),
    timers: t.timers,
  });
  return { s, t, fp };
}

describe('ProfileStore with a fake pool', () => {
  it('batches wanted pubkeys into one subscription and resubscribes only for new ones', () => {
    const { s, t, fp } = store();
    const [x, y, z] = [signer(), signer(), signer()];
    const releaseX = s.want([x.pubkey, y.pubkey]);
    s.want([y.pubkey]);
    expect(fp.subs).toHaveLength(0);
    t.tick();
    expect(fp.live()).toHaveLength(1);
    expect(fp.live()[0]?.filters).toEqual([{ kinds: [0], authors: [x.pubkey, y.pubkey].sort() }]);
    // Already followed: no new subscription.
    const again = s.want([x.pubkey]);
    t.tick();
    expect(fp.subs).toHaveLength(1);
    again();
    releaseX();
    // y is still wanted once; z is new, so the subscription is rebuilt with y and z only.
    s.want([z.pubkey]);
    t.tick();
    expect(fp.live()).toHaveLength(1);
    expect(fp.live()[0]?.filters[0]?.authors).toEqual([y.pubkey, z.pubkey].sort());
  });

  it('serves the newest version, marks pubkeys loaded at EOSE and ignores other kinds and authors', () => {
    const { s, t, fp } = store();
    const [x, y] = [signer(), signer()];
    s.want([x.pubkey, y.pubkey]);
    t.tick();
    const sub = fp.live()[0] as Sub;
    expect(s.get(x.pubkey).value).toEqual({ loaded: false, info: null });
    sub.onEvent(kind0(x, { name: 'New' }, 20), 'r');
    sub.onEvent(kind0(x, { name: 'Old' }, 10), 'r');
    sub.onEvent({ ...kind0(x, { name: 'Note' }, 30), kind: 1 }, 'r');
    sub.onEvent(kind0(signer(), { name: 'Stranger' }, 40), 'r');
    expect(s.get(x.pubkey).value.info?.name).toBe('New');
    sub.onEose?.(ANSWERED);
    expect(s.get(y.pubkey).value).toEqual({ loaded: true, info: null });
    expect(s.get(x.pubkey).value.loaded).toBe(true);
  });

  it('caches profiles under bg:<profile>:profiles and serves them first on the next page', () => {
    const storage = memoryStorage();
    const first = store({ storage });
    const x = signer();
    first.s.want([x.pubkey]);
    first.t.tick();
    first.fp.live()[0]?.onEvent(kind0(x, { display_name: 'Ann', picture: 'https://e.com/a.webp' }, 5), 'r');
    first.t.tick();
    expect(storage.getItem(storageKey('a', 'profiles'))).toContain('Ann');
    const second = store({ storage });
    expect(second.s.get(x.pubkey).value).toMatchObject({
      loaded: true,
      info: { name: 'Ann', picture: 'https://e.com/a.webp' },
    });
    const late = store({ storage, now: () => NOW + PROFILE_CACHE_TTL_S + 10 });
    expect(late.s.get(x.pubkey).value).toEqual({ loaded: false, info: null });
  });

  it('saves: merges into the newest version, keeps tags, publishes, and offers the result', async () => {
    const { s, t, fp } = store();
    const me = signer();
    const saving = s.save(me, ['wss://r.example'], { name: 'Ann', about: 'Hi', picture: null });
    const fetch = fp.live()[0] as Sub;
    expect(fetch.filters).toEqual([{ kinds: [0], authors: [me.pubkey] }]);
    fetch.onEvent(
      kind0(me, { name: 'ann', nip05: 'ann@e.com', lud16: 'ann@ln' }, NOW + 50, [['i', 'x:y', 'p']]),
      'r',
    );
    fetch.onEose?.(ANSWERED);
    const r = await saving;
    expect(r.status).toBe('saved');
    expect(fp.published).toHaveLength(1);
    const ev = fp.published[0] as NostrEvent;
    expect(ev.created_at).toBe(NOW + 51);
    expect(ev.tags).toEqual([['i', 'x:y', 'p']]);
    expect(JSON.parse(ev.content)).toEqual({
      name: 'ann',
      nip05: 'ann@e.com',
      lud16: 'ann@ln',
      display_name: 'Ann',
      about: 'Hi',
    });
    expect(s.get(me.pubkey).value.info?.name).toBe('Ann');
    t.tick();
  });

  it('asks before overwriting when no relay answered, for any key (I2)', async () => {
    for (const kind of ['local', 'nip07'] as const) {
      const { s, t, fp } = store();
      const me = signer(kind);
      // The wait runs out.
      const saving = s.save(me, ['wss://r.example'], { name: 'Ann' });
      t.tick();
      expect(await saving).toEqual({ status: 'unconfirmed', reason: 'no-answer' });
      // Every relay failed to connect: that is no answer either, not an empty one.
      const failed = s.save(me, ['wss://r.example'], { name: 'Ann' });
      fp.live().at(-1)?.onEose?.(NO_ANSWER);
      expect(await failed).toEqual({ status: 'unconfirmed', reason: 'no-answer' });
      expect(fp.published).toHaveLength(0);
      const forced = s.save(me, ['wss://r.example'], { name: 'Ann' }, { overwrite: true });
      t.tick();
      expect((await forced).status).toBe('saved');
    }
  });

  it('asks when this browser knows a newer profile than the relays returned, and never goes back in time (I2)', async () => {
    const storage = memoryStorage();
    const me = signer();
    // Last visit saw (and cached) E2.
    const first = store({ storage });
    first.s.want([me.pubkey]);
    first.t.tick();
    const e2 = kind0(me, { display_name: 'Ann', nip05: 'ann@e.com' }, NOW + 100, [['t', 'x']]);
    first.fp.live()[0]?.onEvent(e2, 'r');
    first.t.tick();

    // Today the relays only have the older E1.
    const { s, t, fp } = store({ storage });
    expect(s.get(me.pubkey).value.info?.name).toBe('Ann');
    const e1 = kind0(me, { display_name: 'Old', lud16: 'ann@ln' }, NOW + 10);
    const saving = s.save(me, ['wss://r.example'], { about: 'Hi' });
    fp.live()[0]?.onEvent(e1, 'r');
    fp.live()[0]?.onEose?.(ANSWERED);
    expect(await saving).toEqual({ status: 'unconfirmed', reason: 'newer-known' });
    // The cached profile still shows; the older event is only kept for merging.
    expect(s.get(me.pubkey).value.info?.name).toBe('Ann');
    expect(s.latestEvent(me.pubkey)?.id).toBe(e1.id);

    const forced = s.save(me, ['wss://r.example'], { about: 'Hi' }, { overwrite: true });
    fp.live().at(-1)?.onEose?.(ANSWERED);
    expect((await forced).status).toBe('saved');
    const ev = fp.published[0] as NostrEvent;
    expect(ev.created_at).toBe(NOW + 101);
    expect(JSON.parse(ev.content)).toEqual({ display_name: 'Old', lud16: 'ann@ln', about: 'Hi' });
    t.tick();
  });

  it('says when the wait ran out while some relays had answered', async () => {
    const { s, fp } = store();
    const saving = s.save(signer(), ['wss://r.example'], { name: 'Ann' });
    fp.live()[0]?.onEose?.({ eose: 1, relays: 2, timedOut: true });
    expect(await saving).toEqual({ status: 'unconfirmed', reason: 'timeout' });
    expect(fp.published).toHaveLength(0);
  });

  it('asks before creating a profile for an extension or imported key that has none here, not for a generated key (R1)', async () => {
    const storage = diskStore();
    const { s, fp } = store({ storage });
    const found = async (me: Signer) => {
      const saving = s.save(me, ['wss://r.example'], { name: 'Ann' });
      fp.live().at(-1)?.onEose?.(ANSWERED);
      return saving;
    };
    // An extension key: its profile may live on the extension user's own relays.
    expect(await found(signer('nip07'))).toEqual({ status: 'unconfirmed', reason: 'none-found' });
    // An imported key: the same.
    const sk = '44'.repeat(32);
    expect(importSecretKey('a', storage, sk, { current: 'ee'.repeat(32), now: NOW }).ok).toBe(true);
    const imported: Signer = {
      kind: 'local',
      pubkey: getPublicKey(hexToBytes(sk)),
      sign: async (t) => finalizeEvent(t, hexToBytes(sk), rnd),
    };
    expect(isImportedKey('a', storage, imported.pubkey)).toBe(true);
    expect(await found(imported)).toEqual({ status: 'unconfirmed', reason: 'none-found' });
    expect(fp.published).toHaveLength(0);
    // A key this app generated never had a profile anywhere: no question.
    const generated = signer();
    expect(isImportedKey('a', storage, generated.pubkey)).toBe(false);
    expect((await found(generated)).status).toBe('saved');
    // Confirmed, the imported key saves.
    const forced = s.save(imported, ['wss://r.example'], { name: 'Ann' }, { overwrite: true });
    fp.live().at(-1)?.onEose?.(ANSWERED);
    expect((await forced).status).toBe('saved');
  });

  it('marks pubkeys loaded only when a relay actually answered', () => {
    const { s, t, fp } = store();
    const x = signer();
    s.want([x.pubkey]);
    t.tick();
    fp.live()[0]?.onEose?.(NO_ANSWER);
    expect(s.get(x.pubkey).value).toEqual({ loaded: false, info: null });
  });

  it('throws when no relay accepts the profile', async () => {
    const fp = fakePool(false);
    const { s } = store({ pool: fp.pool });
    const saving = s.save(signer(), ['wss://r.example'], { name: 'Ann' });
    fp.live()[0]?.onEose?.(ANSWERED);
    await expect(saving).rejects.toThrow(NO_RELAY_ACCEPTED_PROFILE);
  });
});

describe('ProfileStore on the dev relay', () => {
  let relay: DevRelay;
  const pools: RelayPool[] = [];
  beforeAll(async () => {
    relay = await startDevRelay({ port: 0 });
  });
  afterAll(async () => {
    for (const p of pools) p.close();
    await relay.close();
  });
  const newStore = () => {
    const pool = new RelayPool([relay.url], { WebSocket });
    pools.push(pool);
    return {
      pool,
      store: new ProfileStore({
        pool,
        storage: memoryStorage(),
        profile: 'x',
        now: () => Math.floor(Date.now() / 1000),
        timers: platformTimers,
      }),
    };
  };

  it('newest wins, and a save keeps unknown fields and tags', async () => {
    const me = signer();
    const writer = newStore();
    const base = Math.floor(Date.now() / 1000) - 100;
    await writer.pool.publish(kind0(me, { name: 'old' }, base));
    await writer.pool.publish(
      kind0(me, { name: 'handle', nip05: 'me@e.com', banner: 'b' }, base + 10, [['t', 'x']]),
    );
    await writer.pool.publish(kind0(me, { name: 'older' }, base + 5));

    const reader = newStore();
    reader.store.want([me.pubkey]);
    await waitFor(() => reader.store.get(me.pubkey).value.loaded);
    expect(reader.store.get(me.pubkey).value.info?.name).toBe('handle');

    const r = await writer.store.save(me, [relay.url], {
      name: 'Ann',
      about: '',
      picture: 'https://e.com/p.webp',
    });
    expect(r.status).toBe('saved');
    await waitFor(() => reader.store.get(me.pubkey).value.info?.name === 'Ann');
    const latest = await newStore().store.fetchLatest(me.pubkey);
    expect(latest.complete).toBe(true);
    expect(latest.event?.tags).toEqual([['t', 'x']]);
    expect(JSON.parse(latest.event?.content ?? '')).toEqual({
      name: 'handle',
      nip05: 'me@e.com',
      banner: 'b',
      display_name: 'Ann',
      picture: 'https://e.com/p.webp',
    });
  }, 30_000);
});

async function waitFor(ok: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
