/*
 * The lobby and game controllers end to end in Node: the real dev relay, real relay pools over Node's
 * WebSocket, local signers and memory stores, one per profile. Shuffle proofs make these tests slow.
 */
import type { ChainReactionState } from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import type { SessionView } from '@bored-games/client';
import { type DevRelay, startDevRelay } from '@bored-games/dev-relay';
import {
  finalizeEvent,
  getPublicKey,
  type Hex,
  KIND,
  type NostrEvent,
  tableTemplate,
} from '@bored-games/protocol';
import type { Filter } from '@bored-games/relay';
import { RelayPool } from '@bored-games/relay';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { platformTimers } from '../src/clock.ts';
import { GameController, loadOutbox, loadSeen, loadTable } from '../src/game-controller.ts';
import { handTiles } from '../src/games/chain-reaction/model.ts';
import type { Signer } from '../src/identity.ts';
import { LobbyController, OTHER_KEY_TABLE } from '../src/lobby-controller.ts';
import { type ControllerDeps, MODULES, type PoolLike } from '../src/net.ts';
import { timedOutSeats, timeoutExplanation } from '../src/screens/game.tsx';
import {
  type KeyValueStore,
  loadGameStatus,
  loadSecrets,
  loadTableList,
  loadTableOwners,
  memoryStorage,
  saveSecrets,
} from '../src/storage.ts';

const rnd = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const now = (): number => Math.floor(Date.now() / 1000);

function localSigner(): Signer {
  const sk = rnd(32);
  return { kind: 'local', pubkey: getPublicKey(sk), sign: async (t) => finalizeEvent(t, sk, rnd) };
}

/**
 * A signer that records what it signs and can be held, like a NIP-07 prompt left open: while held, every
 * signature waits until `open()`.
 */
function gatedSigner() {
  const inner = localSigner();
  const signed: NostrEvent[] = [];
  let gate: Promise<void> | null = null;
  let release = (): void => {};
  const signer: Signer = {
    ...inner,
    sign: async (t) => {
      if (gate !== null) await gate;
      const ev = await inner.sign(t);
      signed.push(ev);
      return ev;
    },
  };
  return {
    signer,
    signed,
    hold: () => {
      gate = new Promise((r) => (release = r));
    },
    open: () => {
      gate = null;
      release();
    },
  };
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

function game(rootId: string, deps: ControllerDeps, opts: { gamePage?: number } = {}): GameController {
  const c = new GameController(rootId, deps, opts);
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
async function startGame(
  a: Profile,
  b: Profile,
  c: Profile,
): Promise<{ rootId: string; address: string; bySeat: Profile[] }> {
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
  return { rootId, address, bySeat };
}

/** Every stored event matching `filters`, from a fresh pool. */
function query(...filters: Filter[]): Promise<NostrEvent[]> {
  const p = newPool();
  return new Promise((resolve) => {
    const got: NostrEvent[] = [];
    let stop = (): void => {};
    stop = p.subscribe(
      filters,
      (ev) => got.push(ev),
      () => {
        stop();
        resolve(got);
      },
    );
  });
}

/** A pool that delivers `extra` to every subscription asking for Tables, before the relay's own events. */
function forgingPool(real: PoolLike, extra: () => NostrEvent[]): PoolLike {
  return {
    publish: (ev, urls) => real.publish(ev, urls),
    subscribe: (filters, onEvent, onEose, opts) => {
      if (filters.some((f) => f.kinds?.includes(KIND.table)))
        queueMicrotask(() => {
          for (const ev of extra()) onEvent(ev, 'ws://forged.test');
        });
      return real.subscribe(filters, onEvent, onEose, opts);
    },
  };
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

  it('shares one in-flight join and one in-flight start between concurrent callers', async () => {
    const ga = gatedSigner();
    const gb = gatedSigner();
    const [a, b, c] = [
      profile('a', memoryStorage(), ga.signer),
      profile('b', memoryStorage(), gb.signer),
      profile('c'),
    ];
    const la = lobby(a);
    const lb = lobby(b);
    const lc = lobby(c);
    const address = await la.createTable({ seats: 3, deadline: 259200, invited: [], relays: [relay.url] });

    // A double click on Join while the signer prompt is open.
    await waitFor('the open table', () => lb.openTables.value.some((t) => t.address === address));
    gb.hold();
    const j1 = lb.join(address);
    const j2 = lb.join(address);
    expect(j2).toBe(j1);
    gb.open();
    await Promise.all([j1, j2]);
    expect(gb.signed.filter((e) => e.kind === KIND.join)).toHaveLength(1);

    await waitFor('the open table', () => lc.openTables.value.some((t) => t.address === address));
    await lc.join(address);
    await waitFor('a full table', () => la.table(address).value?.full);

    // A double click on Start while the signer prompt is open.
    ga.hold();
    const s1 = la.start(address);
    const s2 = la.start(address);
    expect(s2).toBe(s1);
    ga.open();
    const [r1, r2] = await Promise.all([s1, s2]);
    expect(r2).toBe(r1);
    expect(ga.signed.filter((e) => e.kind === KIND.root)).toHaveLength(1);
    expect(await query({ kinds: [KIND.root], '#a': [address] })).toHaveLength(1);
    expect(await query({ kinds: [KIND.join], '#a': [address] })).toHaveLength(3);
  });
  it('starts with an explicit seat list chosen among more open joiners than seats', async () => {
    const [a, b, c, d] = [profile('a'), profile('b'), profile('c'), profile('d')];
    const la = lobby(a);
    const others = [b, c, d].map((p) => lobby(p));
    const address = await la.createTable({ seats: 3, deadline: 259200, invited: [], relays: [relay.url] });
    for (const l of others) {
      await waitFor('the open table', () => l.openTables.value.some((t) => t.address === address));
      await l.join(address);
    }
    const view = await waitFor('three open joiners', () => {
      const v = la.table(address).value;
      return v !== null && v.candidates.length === 4 ? v : null;
    });
    const joinOf = (p: Profile) => view.candidates.find((j) => j.npub === p.deps.signer.pubkey)?.id as Hex;
    // The fold seats at most two open joiners; the creator picks the other pair.
    const unseated = [b, c, d].filter((p) => !view.joins.some((j) => j.npub === p.deps.signer.pubkey));
    expect(unseated).toHaveLength(1);
    const picked = [unseated[0] as Profile, [b, c, d].find((p) => p !== unseated[0]) as Profile];
    await expect(la.start(address, [joinOf(a), joinOf(b)])).rejects.toThrow(/seats/);
    const rootId = await la.start(address, [joinOf(a), ...picked.map(joinOf)]);
    const root = await waitFor('the root', () => la.table(address).value?.root);
    expect(root.id).toBe(rootId);
    expect(root.seats.map((s) => s.npub)).toEqual([a, ...picked].map((p) => p.deps.signer.pubkey));
  }, 30_000);
});

describe('LobbyController and a changed player key (D041)', () => {
  it("never joins with another key's game keys: the join is refused and nothing is published", async () => {
    const store = memoryStorage();
    const a = profile('p', store);
    const la = lobby(a);
    const address = await la.createTable({ seats: 3, deadline: 259200, invited: [], relays: [relay.url] });
    const saved = loadSecrets('p', store, address);
    expect(saved?.owner).toBe(a.deps.signer.pubkey);
    expect(loadTableOwners('p', store).get(address)).toBe(a.deps.signer.pubkey);

    // The same profile, now with another key (as after an import).
    const b = profile('p', store);
    const lb = lobby(b);
    await waitFor('the table', () => lb.myTables.value.find((t) => t.address === address));
    expect(lb.myTables.value.find((t) => t.address === address)?.otherKey).toBe(true);
    expect(la.myTables.value.find((t) => t.address === address)?.otherKey).toBe(false);
    await expect(lb.join(address)).rejects.toThrow(OTHER_KEY_TABLE);
    // The other key's secrets are untouched, and only a's Join exists.
    expect(loadSecrets('p', store, address)).toEqual(saved);
    const joins = await query({ kinds: [KIND.join], '#a': [address] });
    expect(joins.map((j) => j.pubkey)).toEqual([a.deps.signer.pubkey]);
  });
});

describe('LobbyController.lobbyOf', () => {
  /** A pool that counts the subscriptions it is asked to open. */
  function countingPool(real: PoolLike): { pool: PoolLike; count: () => number } {
    let n = 0;
    return {
      pool: {
        publish: (ev, urls) => real.publish(ev, urls),
        subscribe: (...args) => {
          n++;
          return real.subscribe(...args);
        },
      },
      count: () => n,
    };
  }

  it('folds an address that is not watched after EOSE, and returns null for an unknown one', async () => {
    const [a, b] = [profile('a'), profile('b')];
    const address = await lobby(a).createTable({
      seats: 3,
      deadline: 259200,
      invited: [],
      relays: [relay.url],
    });
    // A controller that never listens: nothing is known about the table until lobbyOf asks.
    const lb = new LobbyController(b.deps);
    disposers.push(() => lb.dispose());
    expect(lb.tableEvent(address)).toBeNull();
    const view = await lb.lobbyOf(address);
    expect(view?.table.address).toBe(address);
    expect(view?.table.creator).toBe(a.deps.signer.pubkey);
    expect(view?.joins.map((j) => j.npub)).toEqual([a.deps.signer.pubkey]);
    expect(view?.root).toBeNull();

    const unknown = `37450:${'ab'.repeat(32)}:no-such-table`;
    expect(await lb.lobbyOf(unknown)).toBeNull();
    expect(await lb.lobbyOf('not an address')).toBeNull();
  }, 30_000);

  it('does not query again for a watched address', async () => {
    const [a, b] = [profile('a'), profile('b')];
    const address = await lobby(a).createTable({
      seats: 3,
      deadline: 259200,
      invited: [],
      relays: [relay.url],
    });
    const counted = countingPool(b.deps.pool);
    const lb = new LobbyController({ ...b.deps, pool: counted.pool });
    disposers.push(() => lb.dispose());
    const watched = lb.table(address);
    const followed = await waitFor('the watched table', () => watched.value);
    const before = counted.count();
    expect(before).toBeGreaterThan(0);
    const view = await lb.lobbyOf(address);
    expect(counted.count()).toBe(before);
    expect(view).toEqual(followed);
    // An address that is not watched does query.
    await lb.lobbyOf(`37450:${'cd'.repeat(32)}:other`);
    expect(counted.count()).toBe(before + 1);
  }, 30_000);
});

describe('GameController', () => {
  it('three players reach play with no input (automatic shuffle and deal); a spectator agrees', async () => {
    const { rootId, address, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    // Seat 1's storage holds a deal the session refuses (signed by a key with no seat): it becomes an orphan and
    // the deal is built anew, instead of the stale one being resent forever.
    const strayDeal = finalizeEvent(
      { kind: KIND.shares, created_at: now(), tags: [['e', rootId, '', 'root']], content: '{}' },
      rnd(32),
      rnd,
    );
    const seat1 = bySeat[1] as Profile;
    seat1.deps.storage.setItem(
      `bg:${seat1.name}:outbox:${rootId}`,
      JSON.stringify({ deal: { event: strayDeal, confirmed: false, orphan: false } }),
    );
    const players = bySeat.map((p) => game(rootId, p.deps));
    // Another tab of seat 2 saves a stray deal after this tab loaded: the deal duty commits it, the session
    // refuses it, and the duty builds a fresh deal in the same step instead of getting stuck.
    const seat2 = bySeat[2] as Profile;
    const strayDeal2 = finalizeEvent(
      { kind: KIND.shares, created_at: now(), tags: [['e', rootId, '', 'root']], content: '{}' },
      rnd(32),
      rnd,
    );
    const key2 = `bg:${seat2.name}:outbox:${rootId}`;
    const held2 = JSON.parse(seat2.deps.storage.getItem(key2) ?? '{}') as Record<string, unknown>;
    seat2.deps.storage.setItem(
      key2,
      JSON.stringify({ ...held2, deal: { event: strayDeal2, confirmed: false, orphan: false } }),
    );
    // The spectator's relays also deliver forgeries: a Table at the same `d` tag from another author, dated far
    // in the future, a Join naming another table, and a Join for this table that the root does not seat.
    const tableId = address.split(':')[2] as string;
    const forger = localSigner();
    const forged = [
      await forger.sign(
        tableTemplate(
          {
            tableId,
            game: 'chain-reaction',
            version: '0.0.0',
            seats: 2,
            deadline: 86400,
            invited: [],
            open: 1,
            relays: [relay.url],
            status: 'open',
            rules: {},
          },
          now() + 10_000_000,
        ),
      ),
      await forger.sign({
        kind: KIND.join,
        created_at: now(),
        tags: [['a', `37450:${forger.pubkey}:${tableId}`]],
        content: '{}',
      }),
      await forger.sign({ kind: KIND.join, created_at: 1, tags: [['a', address]], content: '{}' }),
    ];
    // A stranger floods the root's tag with game events: the controller asks only for the seats' events, and
    // drops any other a relay sends anyway.
    const stranger = localSigner();
    for (let i = 0; i < 20; i++) {
      await newPool().publish(
        await stranger.sign({
          kind: KIND.move,
          created_at: now() + i,
          tags: [
            ['e', rootId, '', 'root'],
            ['e', rootId, '', 'prev'],
            ['seq', '1'],
          ],
          content: '{}',
        }),
      );
    }
    const watcher = profile('watcher');
    const spectator = game(rootId, { ...watcher.deps, pool: forgingPool(watcher.deps.pool, () => forged) });

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
      const hand = handTiles(CHAIN_REACTION_THEME, v?.state as ChainReactionState, i);
      expect(hand).toHaveLength(6);
      expect(hand.every((t) => t.tile !== null)).toBe(true);
      await waitFor('a settled status', () => ['waiting', 'your-turn'].includes(g.status.value));
      // Home reads the status from a small entry the controller keeps in step with it.
      const seat = bySeat[i] as Profile;
      expect(loadGameStatus(seat.name, seat.deps.storage, rootId)).toMatchObject({
        status: g.status.value,
        seq: head?.seq,
      });
      expect(loadGameStatus(seat.name, seat.deps.storage, rootId)?.updatedAt).toBeGreaterThan(0);
    }
    expect(spectator.view.value?.mySeat).toBeNull();
    expect(spectator.table.value?.creator).toBe(bySeat[0]?.deps.signer.pubkey);
    expect(spectator.error.value).toBeNull();
    expect(spectator.status.value).toBe('waiting');
    expect(players.every((g) => g.error.value === null)).toBe(true);
    expect(players.every((g) => g.status.value !== 'stuck')).toBe(true);
    // Every event this seat built is confirmed by the relay.
    for (const [i, p] of bySeat.entries()) {
      const outbox = loadOutbox(p.deps.storage, p.name, rootId);
      expect(outbox.size).toBe(2);
      expect(outbox.get('deal')?.confirmed).toBe(true);
      expect(outbox.get('deal')?.orphan).toBe(false);
      expect([strayDeal.id, strayDeal2.id]).not.toContain(outbox.get('deal')?.event.id);
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

    // The tab reopens: same storage, a fresh pool and controller, which loads the game 2 events per page.
    const gc2 = game(rootId, { ...c.deps, pool: newPool() }, { gamePage: 2 });
    for (const g of [ga, gb, gc2])
      await waitFor('the play phase', () => g.view.value?.phase === 'play', 120_000);

    // The other seats accepted the very event that was saved, not a new one.
    expect(ga.view.value?.head).toEqual({ id: saved.event.id, seq: 3 });
    expect(gb.view.value?.head).toEqual({ id: saved.event.id, seq: 3 });
    expect(gc2.view.value?.head).toEqual({ id: saved.event.id, seq: 3 });
    expect(boardOf(gc2)).toEqual(boardOf(ga));
    expect(gc2.view.value?.mySeat).toBe(2);
    expect(
      handTiles(CHAIN_REACTION_THEME, gc2.view.value?.state as ChainReactionState, 2).every(
        (t) => t.tile !== null,
      ),
    ).toBe(true);
    await waitFor('the confirmed shuffle', () => savedMove(c, rootId, 3)?.confirmed);
    expect(savedMove(c, rootId, 3)?.event.id).toBe(saved.event.id);
  }, 240_000);

  it('recovers a seat from the game keys saved in this browser after the player key is lost (D057)', async () => {
    const { rootId, address, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const [a, b, c] = bySeat as [Profile, Profile, Profile];
    const keysOf = (p: Profile) => loadSecrets(p.deps.profile, p.deps.storage, address);
    const mine = keysOf(c);
    const other = keysOf(b);
    if (mine === null || other === null) throw new Error('no saved game keys');
    // A fresh device (or storage that lost only the player key): a new key, and seat 2's saved game keys.
    const fresh = memoryStorage();
    saveSecrets('c-new', fresh, address, mine);
    const c2 = profile('c-new', fresh);
    expect(c2.deps.signer.pubkey).not.toBe(c.deps.signer.pubkey);
    // Keys that do not match one seat: seat 2's session key with seat 1's deck secret. Nothing is recovered.
    const mixed = memoryStorage();
    saveSecrets('mixed', mixed, address, { ...mine, deckSecret: other.deckSecret });
    const d = profile('mixed', mixed);

    const ga = game(rootId, a.deps);
    const gb = game(rootId, b.deps);
    const gc = game(rootId, c2.deps);
    const gd = game(rootId, d.deps);
    for (const g of [ga, gb, gc, gd])
      await waitFor('the play phase', () => g.view.value?.phase === 'play', 120_000);
    expect(gc.recovered.value).toEqual({ seat: 2, npub: c.deps.signer.pubkey });
    expect(gc.view.value?.mySeat).toBe(2);
    expect(
      handTiles(CHAIN_REACTION_THEME, gc.view.value?.state as ChainReactionState, 2).every(
        (t) => t.tile !== null,
      ),
    ).toBe(true);
    expect(boardOf(gc)).toEqual(boardOf(ga));
    // The recovered seat shuffled and dealt with its session key, as any seat does.
    const evs = await query({ kinds: [KIND.move], '#e': [rootId] });
    const session2 = getPublicKey(mine.sessionSk);
    expect(evs.some((ev) => ev.pubkey === session2)).toBe(true);
    expect(gd.recovered.value).toBeNull();
    expect(gd.view.value?.mySeat).toBeNull();
    expect(gd.canResign.value).toBe(false);
  }, 240_000);

  it('sends exactly one move for a double submission, and a rebuilt tab signs nothing new', async () => {
    const { rootId, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const players = bySeat.map((p) => game(rootId, p.deps));
    const mover = await waitFor(
      'the first decision',
      () => players.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
      120_000,
    );
    const seat = players.indexOf(mover);
    const p = bySeat[seat] as Profile;
    expect(mover.view.value?.head.seq).toBe(3);
    const action = mover.legal.value[0];

    // Two submissions at once: the second is refused while the first is in flight.
    const results = await Promise.allSettled([mover.act(action), mover.act(action)]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    for (const g of players) await waitFor('the move everywhere', () => g.view.value?.head.seq === 4);
    const head = mover.view.value?.head;
    for (const g of players) expect(g.view.value?.head).toEqual(head);

    const moves = () => query({ kinds: [KIND.move], '#e': [rootId] });
    await waitFor('the confirmed move', () => savedMove(p, rootId, 4)?.confirmed);
    expect(await moves()).toHaveLength(4);
    const slots = [...loadOutbox(p.deps.storage, p.name, rootId).keys()];
    expect(slots.filter((k) => k.startsWith('move:4:'))).toHaveLength(1);

    // The tab reopens from the same storage: same head, nothing new signed.
    mover.dispose();
    const reopened = game(rootId, { ...p.deps, pool: newPool() });
    await waitFor(
      'the reopened tab',
      () => reopened.view.value?.head.seq === 4 && reopened.status.value !== 'syncing',
    );
    expect(reopened.view.value?.head).toEqual(head);
    await new Promise((r) => setTimeout(r, 500));
    expect(await moves()).toHaveLength(4);
    expect(
      [...loadOutbox(p.deps.storage, p.name, rootId).keys()].filter((k) => k.startsWith('move:')),
    ).toHaveLength(2);
  }, 180_000);

  it('names a stalled seat once the deadline has passed, and a timeout claim ends the game', async () => {
    const { rootId, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const players = bySeat.map((p) => game(rootId, p.deps));
    const decider = () =>
      waitFor(
        'a decision',
        () => players.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
        120_000,
      );
    // Before the first game action a claim would cancel the game; play one action first.
    const first = await decider();
    expect(timeoutExplanation(first.view.value as SessionView, 'Bo')).toMatch(/cancelled without a result/);
    await first.act(first.legal.value[0]);
    for (const g of players) await waitFor('the first action everywhere', () => g.view.value?.head.seq === 4);

    const mover = await decider();
    const stalled = players.indexOf(mover);
    const claimer = (stalled + 1) % 3;
    const waiting = players[claimer] as GameController;
    await waitFor('a settled claimer', () => waiting.status.value === 'waiting');
    expect(waiting.timeoutTarget.value).toBeNull();

    // The claimer's tab reopens with a clock past the deadline. Deadlines run on local receipt time, so the tab
    // must keep when it first saw each event: a reload that saw everything anew would restart the deadline.
    const deadline = waiting.view.value?.deadline ?? 0;
    expect(deadline).toBe(259200);
    const since = waiting.view.value?.pendingSince ?? 0;
    expect(since).toBeLessThanOrEqual(now());
    waiting.dispose();
    const p = bySeat[claimer] as Profile;
    const seen = loadSeen(p.deps.storage, p.name, rootId);
    expect(seen.has(rootId)).toBe(true);
    expect(seen.size).toBeGreaterThan(6);
    const late = game(rootId, { ...p.deps, now: () => now() + deadline + 60 });
    const target = await waitFor('a timeout target', () => late.timeoutTarget.value ?? false);
    expect(target).toBe(stalled);
    expect(late.view.value?.pendingSince).toBe(since);

    const view = late.view.value as SessionView;
    expect(timeoutExplanation(view, 'Ann')).toMatch(/Ann forfeits: the game ends now/);

    await late.claimTimeout();
    await waitFor('the end of the game', () => late.view.value?.phase === 'done');
    expect(late.error.value).toBeNull();
    expect(timedOutSeats(late.view.value)).toEqual([stalled]);
    await waitFor('the attestation sent', () => late.status.value === 'done');
    expect(late.timeoutTarget.value).toBeNull();
    expect(await query({ kinds: [KIND.timeout], '#e': [rootId] })).toHaveLength(1);
  }, 180_000);

  it('loads a started game from the saved Table after the creator republishes it', async () => {
    const { rootId, address, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const [creator, b] = bySeat as [Profile, Profile];
    const original = (
      await query({ kinds: [KIND.table], authors: [creator.deps.signer.pubkey] })
    )[0] as NostrEvent;
    const first = game(rootId, b.deps);
    await waitFor('the session', () => first.view.value !== null);
    expect(loadTable(b.deps.storage, b.name, rootId, address)?.id).toBe(original.id);
    first.dispose();

    // The creator replaces the Table with another deadline: the root no longer validates against it.
    const tags = original.tags.map((t) => (t[0] === 'deadline' ? ['deadline', '86400'] : t));
    const republished = await creator.deps.signer.sign({
      kind: KIND.table,
      created_at: original.created_at + 1,
      tags,
      content: original.content,
    });
    await newPool().publish(republished);
    // The relay keeps only the newest version of the addressable Table.
    const tables = await query({ kinds: [KIND.table], authors: [creator.deps.signer.pubkey] });
    expect(tables.map((t) => t.id)).toEqual([republished.id]);

    // A profile that saved the Table loads the game; one that did not finds no Table that fits.
    const again = game(rootId, b.deps);
    await waitFor('the session again', () => again.view.value !== null);
    expect(again.error.value).toBeNull();
    expect(again.table.value?.deadline).toBe(259200);
    const fresh = game(rootId, profile('fresh').deps);
    await waitFor('the load error', () => fresh.error.value?.startsWith('This game cannot be loaded'));
    // With the original version from another relay as well, a fresh profile tries both and loads.
    const watcher = profile('watcher');
    const other = game(rootId, { ...watcher.deps, pool: forgingPool(watcher.deps.pool, () => [original]) });
    await waitFor('the session from the older version', () => other.view.value !== null);
    expect(loadTable(watcher.deps.storage, watcher.name, rootId, address)?.id).toBe(original.id);
  }, 180_000);

  it('rejects a move while one is in flight and when nothing is loaded', async () => {
    const p = profile('solo');
    const g = new GameController('f'.repeat(64), p.deps);
    disposers.push(() => g.dispose());
    await expect(g.act({ type: 'skipPlace', actor: 0 })).rejects.toThrow(/loading/);
    g.busy.value = true;
    await expect(g.act({ type: 'skipPlace', actor: 0 })).rejects.toThrow(/already/);
  });
});
