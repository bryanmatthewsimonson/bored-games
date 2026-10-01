/*
 * The lobby and game controllers end to end in Node: the real dev relay, real relay pools over Node's
 * WebSocket, local signers and memory stores, one per profile. Shuffle proofs make these tests slow.
 */
import type { ChainReactionState } from '@bored-games/chain-reaction';
import { type DevRelay, startDevRelay } from '@bored-games/dev-relay';
import { finalizeEvent, getPublicKey, type NostrEvent } from '@bored-games/protocol';
import { RelayPool } from '@bored-games/relay';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { platformTimers } from '../src/clock.ts';
import { GameController, loadOutbox } from '../src/game-controller.ts';
import { handTiles } from '../src/games/chain-reaction/model.ts';
import type { Signer } from '../src/identity.ts';
import { LobbyController } from '../src/lobby-controller.ts';
import { type ControllerDeps, MODULES, type PoolLike } from '../src/net.ts';
import { type KeyValueStore, loadSecrets, loadTableList, memoryStorage } from '../src/storage.ts';

const rnd = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const now = (): number => Math.floor(Date.now() / 1000);

function localSigner(): Signer {
  const sk = rnd(32);
  return { kind: 'local', pubkey: getPublicKey(sk), sign: async (t) => finalizeEvent(t, sk, rnd) };
}

let relay: DevRelay;
const pools: RelayPool[] = [];
const disposers: (() => void)[] = [];

interface Profile {
  name: string;
  deps: ControllerDeps;
}

function newPool(): RelayPool {
  const p = new RelayPool([relay.url], { WebSocket });
  pools.push(p);
  return p;
}

/** A browser profile: its own key, store and pool, all on the one dev relay. */
function profile(name: string, store: KeyValueStore = memoryStorage(), signer = localSigner()): Profile {
  return {
    name,
    deps: {
      pool: newPool(),
      signer,
      storage: store,
      profile: name,
      relays: () => [relay.url],
      rnd,
      now,
      modules: MODULES,
      timers: platformTimers,
    },
  };
}

function lobby(p: Profile): LobbyController {
  const c = new LobbyController(p.deps);
  disposers.push(() => c.dispose());
  c.listen();
  return c;
}

function game(rootId: string, deps: ControllerDeps): GameController {
  const c = new GameController(rootId, deps);
  disposers.push(() => c.dispose());
  c.start();
  return c;
}

async function waitFor<T>(what: string, get: () => T | null | undefined | false, ms = 60_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== null && v !== undefined && v !== false) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Create a 3-seat table with 2 open seats, join it from two more profiles, and start it. Returns the root id
 * and the profiles in seat order (the creator first, then the joiners in the lobby's order).
 */
async function startGame(a: Profile, b: Profile, c: Profile): Promise<{ rootId: string; bySeat: Profile[] }> {
  const la = lobby(a);
  const lb = lobby(b);
  const lc = lobby(c);
  const address = await la.createTable({ seats: 3, deadline: 259200, invited: [], relays: [relay.url] });
  await waitFor('the open table', () => lb.openTables.value.find((t) => t.address === address));
  await lb.join(address);
  await waitFor('the open table', () => lc.openTables.value.find((t) => t.address === address));
  await lc.join(address);
  await waitFor('a full table', () => la.table(address).value?.full);
  const rootId = await la.start(address);
  for (const l of [lb, lc]) await waitFor('the root', () => l.table(address).value?.root?.id === rootId);
  const seats = la.table(address).value?.root?.seats.map((s) => s.npub) ?? [];
  const bySeat = seats.map((npub) => [a, b, c].find((p) => p.deps.signer.pubkey === npub) as Profile);
  return { rootId, bySeat };
}

/** The saved move with this seq, whatever head it was built on. */
const savedMove = (p: Profile, rootId: string, seq: number) =>
  [...loadOutbox(p.deps.storage, p.name, rootId).entries()].find(([slot]) =>
    slot.startsWith(`move:${seq}:`),
  )?.[1];

const boardOf = (c: GameController) => (c.view.value?.state as ChainReactionState | null)?.board ?? null;

beforeEach(async () => {
  relay = await startDevRelay({ port: 0 });
});
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  for (const p of pools.splice(0)) p.close();
  await relay.close();
});

describe('LobbyController', () => {
  it('creates, joins, joins and starts a table; every profile sees the same root', async () => {
    const [a, b, c] = [profile('a'), profile('b'), profile('c')];
    const la = lobby(a);
    const lb = lobby(b);
    const lc = lobby(c);
    const address = await la.createTable({ seats: 3, deadline: 259200, invited: [], relays: [relay.url] });
    expect(loadSecrets('a', a.deps.storage, address)).not.toBeNull();
    expect(loadTableList('a', a.deps.storage)).toEqual([address]);
    await waitFor('my table', () => la.myTables.value.find((t) => t.address === address));

    for (const [l, p] of [
      [lb, b],
      [lc, c],
    ] as const) {
      await waitFor('the open table', () => l.openTables.value.some((t) => t.address === address));
      await l.join(address);
      expect(loadSecrets(p.name, p.deps.storage, address)).not.toBeNull();
      // Joining twice signs nothing new.
      await l.join(address);
    }
    const view = await waitFor('a full table', () => {
      const v = la.table(address).value;
      return v?.full ? v : null;
    });
    // The creator holds the first seat; the joiners follow in the lobby's order.
    expect(view.joins[0]?.npub).toBe(a.deps.signer.pubkey);
    expect(view.joins.map((j) => j.npub).sort()).toEqual([a, b, c].map((p) => p.deps.signer.pubkey).sort());
    await expect(lb.start(address)).rejects.toThrow(/creator/);

    const rootId = await la.start(address);
    // Starting again republishes the same root.
    expect(await la.start(address)).toBe(rootId);
    for (const [l, p] of [
      [la, a],
      [lb, b],
      [lc, c],
    ] as const) {
      await waitFor('the root', () => l.table(address).value?.root?.id === rootId);
      expect(loadSecrets(p.name, p.deps.storage, address)?.rootId).toBe(rootId);
      await waitFor('my table with its root', () => l.myTables.value.find((t) => t.rootId === rootId));
    }
    // The table is republished as started, so it leaves the open list.
    await waitFor('the table to leave the open list', () =>
      lc.openTables.value.every((t) => t.address !== address),
    );
    expect(la.tableEvent(address)?.tags).toContainEqual(['status', 'started']);
  });
});

describe('GameController', () => {
  it('three players reach play with no input (automatic shuffle and deal); a spectator agrees', async () => {
    const { rootId, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const players = bySeat.map((p) => game(rootId, p.deps));
    const spectator = game(rootId, profile('watcher').deps);

    for (const g of [...players, spectator])
      await waitFor('the play phase', () => g.view.value?.phase === 'play', 120_000);

    const head = players[0]?.view.value?.head;
    expect(head?.seq).toBe(3);
    for (const [i, g] of players.entries()) {
      const v = g.view.value;
      expect(v?.mySeat).toBe(i);
      expect(v?.head).toEqual(head);
      expect(boardOf(g)).toEqual(boardOf(spectator));
      // Each player has learned exactly its own hand.
      const hand = handTiles(v?.state as ChainReactionState, i);
      expect(hand).toHaveLength(6);
      expect(hand.every((t) => t.tile !== null)).toBe(true);
      await waitFor('a settled status', () => ['waiting', 'your-turn'].includes(g.status.value));
    }
    expect(spectator.view.value?.mySeat).toBeNull();
    expect(spectator.status.value).toBe('waiting');
    expect(players.every((g) => g.error.value === null)).toBe(true);
    // Every event this seat built is confirmed by the relay.
    for (const [i, p] of bySeat.entries()) {
      const outbox = loadOutbox(p.deps.storage, p.name, rootId);
      expect(outbox.size).toBe(2);
      expect(outbox.get('deal')?.confirmed).toBe(true);
      // The shuffle is kept under the head it was built on.
      const prev = i === 0 ? rootId : null;
      const [slot, entry] = [...outbox.entries()].find(([k]) => k.startsWith(`move:${i + 1}:`)) ?? [];
      if (prev !== null) expect(slot).toBe(`move:1:${rootId}`);
      expect(entry?.confirmed).toBe(true);
      expect(entry?.orphan).toBe(false);
    }

    // A saved event the session refuses (here: a move on the root signed by a key with no seat) is marked an
    // orphan on reload and never republished.
    const p0 = bySeat[0] as Profile;
    const stray = finalizeEvent(
      {
        kind: 7452,
        created_at: now(),
        tags: [
          ['e', rootId, '', 'root'],
          ['e', rootId, '', 'prev'],
          ['seq', '1'],
          ['proto', '1'],
        ],
        content: '{}',
      },
      rnd(32),
      rnd,
    );
    const key = `bg:${p0.name}:outbox:${rootId}`;
    const stored = JSON.parse(p0.deps.storage.getItem(key) ?? '{}') as Record<string, unknown>;
    p0.deps.storage.setItem(
      key,
      JSON.stringify({ ...stored, [`move:1:${'0'.repeat(64)}`]: { event: stray, confirmed: false } }),
    );
    const published: string[] = [];
    const real = p0.deps.pool;
    const spy: PoolLike = {
      subscribe: (...args) => real.subscribe(...args),
      publish: (ev, urls) => {
        published.push(ev.id);
        return real.publish(ev, urls);
      },
    };
    players[0]?.dispose();
    const reopened = game(rootId, { ...p0.deps, pool: spy });
    await waitFor('the reopened tab to settle', () =>
      ['waiting', 'your-turn'].includes(reopened.status.value),
    );
    expect(reopened.view.value?.head).toEqual(head);
    expect(savedMove(p0, rootId, 1)).toBeDefined();
    expect(loadOutbox(p0.deps.storage, p0.name, rootId).get(`move:1:${'0'.repeat(64)}`)?.orphan).toBe(true);
    expect(published).not.toContain(stray.id);
  }, 180_000);

  it('a controller rebuilt from storage republishes its unsent event, never re-signs, and catches up', async () => {
    const { rootId, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const [a, b, c] = bySeat as [Profile, Profile, Profile];
    const ga = game(rootId, a.deps);
    const gb = game(rootId, b.deps);

    // Seat 2's first tab loses its connection for publishing: it builds and saves its shuffle, which no relay
    // receives.
    const real = c.deps.pool;
    const offline: PoolLike = {
      subscribe: (...args) => real.subscribe(...args),
      publish: async (ev: NostrEvent) => [{ url: relay.url, ok: false, message: `offline: ${ev.id}` }],
    };
    const gc1 = game(rootId, { ...c.deps, pool: offline });
    const saved = await waitFor('the saved shuffle', () => savedMove(c, rootId, 3), 120_000);
    expect(saved.confirmed).toBe(false);
    await waitFor('the offline notice', () => gc1.notice.value);
    expect(gc1.view.value?.head.id).toBe(saved.event.id);
    expect(ga.view.value?.head.seq).toBe(2);
    gc1.dispose();

    // The tab reopens: same storage, a fresh pool and controller.
    const gc2 = game(rootId, { ...c.deps, pool: newPool() });
    for (const g of [ga, gb, gc2])
      await waitFor('the play phase', () => g.view.value?.phase === 'play', 120_000);

    // The other seats accepted the very event that was saved, not a new one.
    expect(ga.view.value?.head).toEqual({ id: saved.event.id, seq: 3 });
    expect(gb.view.value?.head).toEqual({ id: saved.event.id, seq: 3 });
    expect(gc2.view.value?.head).toEqual({ id: saved.event.id, seq: 3 });
    expect(boardOf(gc2)).toEqual(boardOf(ga));
    expect(gc2.view.value?.mySeat).toBe(2);
    expect(handTiles(gc2.view.value?.state as ChainReactionState, 2).every((t) => t.tile !== null)).toBe(
      true,
    );
    await waitFor('the confirmed shuffle', () => savedMove(c, rootId, 3)?.confirmed);
    expect(savedMove(c, rootId, 3)?.event.id).toBe(saved.event.id);
  }, 240_000);

  it('rejects a move while one is in flight and when nothing is loaded', async () => {
    const p = profile('solo');
    const g = new GameController('f'.repeat(64), p.deps);
    disposers.push(() => g.dispose());
    await expect(g.act({ type: 'skipPlace', actor: 0 })).rejects.toThrow(/loading/);
    g.busy.value = true;
    await expect(g.act({ type: 'skipPlace', actor: 0 })).rejects.toThrow(/already/);
  });
});
