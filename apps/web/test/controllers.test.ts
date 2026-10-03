/*
 * The lobby and game controllers end to end in Node: the real dev relay, real relay pools over Node's
 * WebSocket, local signers and memory stores, one per profile. Shuffle proofs make these tests slow.
 */
import type { ChainReactionState } from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import { GameSession, type SessionView } from '@bored-games/client';
import { type DevRelay, startDevRelay } from '@bored-games/dev-relay';
import {
  finalizeEvent,
  getPublicKey,
  type Hex,
  KIND,
  moveTemplate,
  type NostrEvent,
  parseRoot,
  tableTemplate,
} from '@bored-games/protocol';
import type { EoseInfo, Filter } from '@bored-games/relay';
import { RelayPool } from '@bored-games/relay';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { platformTimers } from '../src/clock.ts';
import { GameController, HOLD_CAP_S, loadOutbox, loadSeen, loadTable } from '../src/game-controller.ts';
import { handTiles } from '../src/games/chain-reaction/model.ts';
import { bytesToHex } from '../src/hex.ts';
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

function newPool(urls: string[] = [relay.url], opts: { deadAfterMs?: number } = {}): RelayPool {
  const p = new RelayPool(urls, { WebSocket, ...opts });
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

/** The same player on another device: the same signer and game keys for `address`, and storage of its own. */
function secondDevice(p: Profile, address: string): Profile {
  const store = memoryStorage();
  const key = `bg:${p.name}:secrets:${address}`;
  store.setItem(key, p.deps.storage.getItem(key) as string);
  return profile(p.name, store, p.deps.signer);
}

/** A second relay of the player's that `switchable` pretends to hold: it answers only while nothing is `hidden`. */
const SILENT = 'wss://silent.test';

/**
 * A pool whose publishing can be cut off (`offline`), recording what it did publish. It pretends the player also
 * uses relay `SILENT` (give the profile `relays: () => [relay.url, SILENT]`): it answers every subscription with the
 * real relay while `hidden` is null. While `hidden` is set, a subscription opened then gets no answer from `SILENT`,
 * which is alive but silent (never dead), and the real relay lacks the `hidden` events (D056).
 */
function switchable(real: PoolLike) {
  const net = {
    offline: true,
    published: [] as string[],
    hidden: null as Set<string> | null,
    pool: {
      subscribe: (filters, onEvent, onEose, opts) => {
        const hidden = net.hidden;
        const alive = (info: EoseInfo): string[] => (info.deadUrls ?? []).filter((u) => u !== SILENT);
        return real.subscribe(
          filters,
          (ev, url) => {
            if (hidden === null || !hidden.has(ev.id)) onEvent(ev, url);
          },
          onEose &&
            ((info) =>
              onEose(
                hidden === null
                  ? { ...info, eosedUrls: [...(info.eosedUrls ?? []), SILENT], deadUrls: alive(info) }
                  : { ...info, relays: info.relays + 1, timedOut: true, deadUrls: alive(info) },
              )),
          opts,
        );
      },
      publish: async (ev: NostrEvent, urls?: readonly string[]) => {
        if (net.offline) return [{ url: relay.url, ok: false, message: 'offline' }];
        net.published.push(ev.id);
        return real.publish(ev, urls);
      },
    } as PoolLike,
  };
  return net;
}

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

    // A saved unconfirmed move that no longer fits (here: a move on the root signed by a key with no seat, where
    // the relays hold this seat's own move on the root) is discarded on reload, logged, and never published (D056).
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
    expect(loadOutbox(p0.deps.storage, p0.name, rootId).has(`move:1:${'0'.repeat(64)}`)).toBe(false);
    expect(reopened.log.value).toHaveLength(1);
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

    // Home in seat 2's own browser, after its player key was replaced: the table is another key's, but playable.
    const lc = lobby(profile(c.deps.profile, c.deps.storage));
    const entry = await waitFor('the table on Home', () =>
      lc.myTables.value.find((t) => t.address === address && t.rootId === rootId),
    );
    expect(entry.otherKey).toBe(true);
    expect(entry.savedKeys).toBe(true);
    // Under its own key it is simply mine.
    const lb = lobby(b);
    const own = await waitFor('b’s table on Home', () =>
      lb.myTables.value.find((t) => t.address === address && t.rootId === rootId),
    );
    expect(own).toMatchObject({ otherKey: false, savedKeys: false });
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

  it('publishes a saved offline move whose parent is still the head, and discards a stale one (D056)', async () => {
    const { rootId, address, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const players = bySeat.map((p) => game(rootId, p.deps));
    const phone = await waitFor(
      'the first decision',
      () => players.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
      120_000,
    );
    const p = bySeat[players.indexOf(phone)] as Profile;
    // The same player's tablet: the same keys, its own storage, and no network for publishing.
    const tablet = secondDevice(p, address);
    const net = switchable(tablet.deps.pool);
    let t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn' && t.legal.value.length > 0);
    const head1 = t.view.value?.head as { id: string; seq: number };
    await t.act(t.legal.value[0]);
    const fresh = savedMove(tablet, rootId, head1.seq + 1);
    expect(fresh?.confirmed).toBe(false);
    t.dispose();

    // Back online, the tablet reloads: the move's parent is still the head and the relays hold no other move of
    // this seat there, so it is published and every client takes it.
    net.offline = false;
    t = game(rootId, { ...tablet.deps, pool: net.pool });
    for (const g of [...players, t])
      await waitFor('the tablet move everywhere', () => g.view.value?.head.id === fresh?.event.id);
    await waitFor('the confirmed move', () => savedMove(tablet, rootId, head1.seq + 1)?.confirmed);
    expect(t.log.value).toEqual([]);
    t.dispose();

    // Offline again, the tablet saves this seat's next decision; the phone then plays that decision differently.
    net.offline = true;
    t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor(
      'the next tablet decision',
      () => t.status.value === 'your-turn' && t.legal.value.length > 0,
    );
    const head2 = t.view.value?.head as { id: string; seq: number };
    await t.act(t.legal.value[0]);
    const stale = savedMove(tablet, rootId, head2.seq + 1);
    expect(stale?.event.tags).toContainEqual(['e', head2.id, '', 'prev']);
    t.dispose();
    await waitFor(
      'the phone decision',
      () => phone.view.value?.head.id === head2.id && phone.legal.value.length > 0,
    );
    // A move with no shares or reveals carries no randomness: the same action built in the same second is the very
    // same event, and no equivocation. The phone plays a second later.
    await new Promise((r) => setTimeout(r, 1100));
    await phone.act(phone.legal.value[0]);
    for (const g of players) await waitFor('the phone move', () => g.view.value?.head.seq === head2.seq + 1);
    const moved = players[0]?.view.value?.head;

    // Weeks later the tablet comes back: its saved move is never published, but discarded and logged.
    net.offline = false;
    t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor(
      'the tablet to catch up',
      () => t.view.value?.head.id === moved?.id && t.status.value !== 'syncing',
    );
    await waitFor('the discard', () => t.log.value.length === 1);
    expect(t.log.value[0]).toMatch(/move saved on this device was never sent/);
    expect(net.published).not.toContain(stale?.event.id);
    expect(savedMove(tablet, rootId, head2.seq + 1)).toBeUndefined();
    const atSeq = (await query({ kinds: [KIND.move], '#e': [head2.id] })).filter((ev) =>
      ev.tags.some((tag) => tag[0] === 'e' && tag[1] === head2.id && tag[3] === 'prev'),
    );
    expect(atSeq.map((ev) => ev.id)).not.toContain(stale?.event.id);
    expect(atSeq).toHaveLength(1);
    for (const g of [...players, t]) expect(g.view.value?.equivocators).toEqual([]);
  }, 240_000);

  it('discards a move saved offline in an open tab once the relays show this seat played otherwise (D056)', async () => {
    const { rootId, address, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const players = bySeat.map((p) => game(rootId, p.deps));
    const phone = await waitFor(
      'the first decision',
      () => players.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
      120_000,
    );
    const seat = players.indexOf(phone);
    const p = bySeat[seat] as Profile;
    const tablet = secondDevice(p, address);
    const net = switchable(tablet.deps.pool);
    const t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn' && t.legal.value.length > 0);
    const head = t.view.value?.head as { id: string; seq: number };
    await t.act(t.legal.value[0]);
    const saved = savedMove(tablet, rootId, head.seq + 1);
    expect(saved?.confirmed).toBe(false);
    expect(t.view.value?.head.id).toBe(saved?.event.id);

    // The phone plays the same decision a second later (another event, even for a move with no shares); the open
    // tablet receives that move and, holding both, flags its own seat.
    await new Promise((r) => setTimeout(r, 1100));
    await phone.act(phone.legal.value[0]);
    await waitFor('the local flag', () => t.view.value?.equivocators.includes(seat));

    // The network comes back. Before republishing, the tablet asks the relays, finds the phone's move on the same
    // parent, discards its own, and rebuilds its session without it.
    net.offline = false;
    t.tick();
    await waitFor('the discard', () => t.log.value.length === 1);
    await waitFor('the rebuilt session', () => t.view.value?.equivocators.length === 0);
    expect(t.view.value?.head).toEqual(phone.view.value?.head);
    expect(net.published).not.toContain(saved?.event.id);
    expect(savedMove(tablet, rootId, head.seq + 1)).toBeUndefined();
    for (const g of players) expect(g.view.value?.equivocators).toEqual([]);
  }, 240_000);

  it('never discards or rebuilds a refused deal it never sent: reloads after a shuffle fork deal nothing (D056, I1)', async () => {
    const { rootId, address, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const [h, s1, e] = bySeat as [Profile, Profile, Profile];
    const hNet = switchable(h.deps.pool);
    hNet.offline = false;
    let gh = game(rootId, { ...h.deps, pool: hNet.pool });
    const g1 = game(rootId, s1.deps);
    await waitFor('the first two shuffle steps', () => g1.view.value?.head.seq === 2, 120_000);
    // H (seat 0) loses its connection for publishing; the last shuffler E (seat 2) builds two rival final steps on
    // one prev. Its higher-id step A goes out first.
    hNet.offline = true;
    const rootEv = (await query({ ids: [rootId] }))[0] as NostrEvent;
    const root = parseRoot(rootEv);
    const [, creator, tableId] = root.tableAddress.split(':') as [string, string, string];
    const table = (
      await query({ kinds: [KIND.table], authors: [creator], '#d': [tableId] })
    )[0] as NostrEvent;
    const joins = await query({ ids: [...root.joinIds] });
    const secrets = loadSecrets(e.name, e.deps.storage, address);
    if (secrets === null) throw new Error('no secrets for seat 2');
    const es = GameSession.create({
      modules: MODULES,
      table,
      joins,
      root: rootEv,
      me: {
        seat: 2,
        sessionSk: secrets.sessionSk,
        deckSecret: BigInt(`0x${bytesToHex(secrets.deckSecret)}`),
      },
      rootSeenAt: now(),
    });
    for (const m of await query({ kinds: [KIND.move], '#e': [rootId] })) es.receive(m, now());
    expect(es.view().head.seq).toBe(2);
    const [stepB, stepA] = [es.buildShuffle(rnd, now()), es.buildShuffle(rnd, now())].sort((x, y) =>
      x.id < y.id ? -1 : 1,
    ) as [NostrEvent, NostrEvent];
    await newPool().publish(stepA);
    // H deals on A, offline: its deal is saved, unconfirmed. Seat 1 deals on A and that reaches the relay.
    const dealOf = (p: Profile) => loadOutbox(p.deps.storage, p.name, rootId).get('deal');
    const hDeal = await waitFor('H saved its deal', () => dealOf(h), 120_000);
    expect(hDeal.confirmed).toBe(false);
    await waitFor('seat 1 sent its deal', () => dealOf(s1)?.confirmed, 120_000);
    gh.dispose();
    // E's lower-id step B: fork choice moves every client to deck B, where H's deal does not verify.
    await newPool().publish(stepB);
    await waitFor('seat 1 on deck B', () => g1.view.value?.head.id === stepB.id);

    // H reloads online. The relays answer without H's deal; the session refuses it on B. Before D056's fix round the
    // controller discarded it, and the next reload built a deal on B: E then held H's shares on both decks.
    hNet.offline = false;
    const hKey = root.seats[0]?.session as string;
    const hShares = () => query({ kinds: [KIND.shares], authors: [hKey], '#e': [rootId] });
    for (let reload = 0; reload < 2; reload++) {
      gh = game(rootId, { ...h.deps, pool: hNet.pool });
      await waitFor(
        'the reloaded tab',
        () => gh.view.value?.head.id === stepB.id && gh.status.value !== 'syncing',
      );
      await new Promise((r) => setTimeout(r, 1500));
      const kept = dealOf(h);
      expect(kept?.event.id).toBe(hDeal.event.id);
      expect(kept?.orphan).toBe(true);
      expect(kept?.confirmed).toBe(false);
      expect(gh.view.value?.phase).toBe('deal');
      // The shuffle equivocator is flagged, and it alone is stalled (D056, F7 (b)).
      expect(gh.view.value?.equivocators).toEqual([2]);
      if (reload === 0) {
        expect(gh.log.value).toHaveLength(1);
        expect(gh.log.value[0]).toMatch(/deal saved on this device was kept but not sent/);
        // The rival step of the fork goes out again with the kept deal (fix round 2 D).
        await waitFor('the fork echoed', () => hNet.published.includes(stepA.id));
      } else expect(gh.log.value).toEqual([]);
      gh.dispose();
    }
    expect(await hShares()).toEqual([]);
    expect(hNet.published.filter((id) => id === hDeal.event.id)).toEqual([]);
    expect(await query({ kinds: [KIND.shares], authors: [root.seats[1]?.session as string] })).toHaveLength(
      1,
    );
  }, 300_000);

  it('vets a saved move only once every relay has answered: a silent relay holds it back (D056, I2)', async () => {
    const { rootId, address, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const players = bySeat.map((p) => game(rootId, p.deps));
    const phone = await waitFor(
      'the first decision',
      () => players.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
      120_000,
    );
    const p = bySeat[players.indexOf(phone)] as Profile;
    const device = secondDevice(p, address);
    const tablet = { ...device, deps: { ...device.deps, relays: () => [relay.url, SILENT] } };
    const net = switchable(tablet.deps.pool);
    let t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn' && t.legal.value.length > 0);
    const head = t.view.value?.head as { id: string; seq: number };
    await t.act(t.legal.value[0]);
    const stale = savedMove(tablet, rootId, head.seq + 1);
    expect(stale?.confirmed).toBe(false);
    t.dispose();
    await new Promise((r) => setTimeout(r, 1100));
    await phone.act(phone.legal.value[0]);
    for (const g of players) await waitFor('the phone move', () => g.view.value?.head.seq === head.seq + 1);
    const moved = players[0]?.view.value?.head as { id: string; seq: number };

    // The tablet comes back with two relays: one answers without the phone's move, the other never answers. Its
    // head is then the move's parent and it sees no rival, but it must not publish (nor discard) on that answer.
    net.offline = false;
    net.hidden = new Set([moved.id]);
    t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the tablet loaded', () => t.view.value !== null && t.status.value !== 'syncing');
    for (let i = 0; i < 3; i++) {
      t.tick();
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(net.published).not.toContain(stale?.event.id);
    expect(t.view.value?.head.id).toBe(head.id);
    expect(savedMove(tablet, rootId, head.seq + 1)?.event.id).toBe(stale?.event.id);
    expect(t.log.value).toEqual([]);
    await expect(t.act(t.legal.value[0] ?? null)).rejects.toThrow();

    // The silent relay answers (it holds the phone's move): the next tick vets the move and discards it.
    net.hidden = null;
    t.tick();
    await waitFor('the discard', () => t.log.value.length === 1);
    expect(t.log.value[0]).toMatch(/another move of yours at that point is on the relays/);
    expect(net.published).not.toContain(stale?.event.id);
    expect(savedMove(tablet, rootId, head.seq + 1)).toBeUndefined();
    await waitFor('the tablet caught up', () => t.view.value?.head.id === moved.id);
    for (const g of [...players, t]) expect(g.view.value?.equivocators).toEqual([]);
  }, 240_000);

  it('vets a saved deal and a saved Resign that names an old head, and publishes both (D056, I3)', async () => {
    const { rootId, address, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const [s0, s1, s2] = bySeat as [Profile, Profile, Profile];
    // Seat 0 publishes its shuffle step, then loses its connection before it deals: its deal is saved, unsent.
    const net0 = switchable(s0.deps.pool);
    net0.offline = false;
    let g0 = game(rootId, { ...s0.deps, pool: net0.pool });
    await waitFor('seat 0 sent its step', () => savedMove(s0, rootId, 1)?.confirmed, 120_000);
    net0.offline = true;
    const others = [game(rootId, s1.deps), game(rootId, s2.deps)];
    const deal = await waitFor(
      'the saved deal',
      () => loadOutbox(s0.deps.storage, s0.name, rootId).get('deal'),
      120_000,
    );
    expect(deal.confirmed).toBe(false);
    g0.dispose();
    // Back online: the relays hold no other deal of seat 0's and the session accepts it, so it is published.
    net0.offline = false;
    g0 = game(rootId, { ...s0.deps, pool: net0.pool });
    const players = [g0, ...others];
    for (const g of players) await waitFor('the play phase', () => g.view.value?.phase === 'play', 120_000);
    expect(loadOutbox(s0.deps.storage, s0.name, rootId).get('deal')?.event.id).toBe(deal.event.id);
    await waitFor(
      'the confirmed deal',
      () => loadOutbox(s0.deps.storage, s0.name, rootId).get('deal')?.confirmed,
    );
    expect(g0.log.value).toEqual([]);

    // One game action, so a Resign is a loss rather than a cancel.
    const first = await waitFor(
      'the first decision',
      () => players.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
      120_000,
    );
    await first.act(first.legal.value[0]);
    for (const g of players) await waitFor('the first action', () => g.view.value?.head.seq === 4);
    const mover = await waitFor(
      'the next decision',
      () => players.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
      120_000,
    );
    // A seat that is not pending resigns on its tablet, offline: the Resign names the current head.
    const r = players.findIndex((g) => g !== mover);
    const tablet = secondDevice(bySeat[r] as Profile, address);
    const net = switchable(tablet.deps.pool);
    let t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the tablet resign button', () => t.canResign.value);
    const named = t.view.value?.head as { id: string; seq: number };
    await t.resign();
    const saved = loadOutbox(tablet.deps.storage, tablet.name, rootId).get('resign');
    expect(saved?.confirmed).toBe(false);
    expect(saved?.event.tags).toContainEqual(['e', named.id, '', 'head']);
    t.dispose();
    // Meanwhile the pending seat plays on: the head moves past the one the Resign names.
    await new Promise((res) => setTimeout(res, 1100));
    await mover.act(mover.legal.value[0]);
    for (const g of players) await waitFor('the head moved', () => g.view.value?.head.seq === named.seq + 1);

    // Back online, the tablet publishes the Resign anyway (it is this seat's only one); before the fix round it was
    // discarded, and with 3 seats the player would have forfeited on time, rated, instead of resigning, unrated.
    net.offline = false;
    t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the published Resign', () => net.published.includes(saved?.event.id as string));
    for (const g of [...players, t]) {
      await waitFor('the game ended by the Resign', () => g.view.value?.resigned.includes(r), 120_000);
      await waitFor('the result', () => g.view.value?.phase === 'done', 120_000);
      expect(g.view.value?.outcome?.unrated).toBe(true);
      expect(g.view.value?.outcome?.places[r]).toBe(3);
    }
    expect(t.log.value).toEqual([]);
  }, 300_000);

  it('leaves a dead relay out of a full answer, and offers Send anyway past the hold cap (D056, fix round 2 A)', async () => {
    const { rootId, address, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const players = bySeat.map((p) => game(rootId, p.deps));
    const phone = await waitFor(
      'the first decision',
      () => players.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
      120_000,
    );
    const p = bySeat[players.indexOf(phone)] as Profile;
    // The tablet saves this seat's decision offline.
    const tablet = secondDevice(p, address);
    const net = switchable(tablet.deps.pool);
    let t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn' && t.legal.value.length > 0);
    const head = t.view.value?.head as { id: string; seq: number };
    await t.act(t.legal.value[0]);
    const saved = savedMove(tablet, rootId, head.seq + 1);
    t.dispose();

    // Back online, with a dead relay among the player's relays: it never answers, and once the pool has found it
    // unreachable for `deadAfterMs` it no longer counts, so the move is vetted and published.
    const DEAD = 'ws://127.0.0.1:9';
    const pool = newPool([relay.url, DEAD], { deadAfterMs: 1500 });
    const online = switchable(pool);
    online.offline = false;
    t = game(rootId, { ...tablet.deps, relays: () => [relay.url, DEAD], pool: online.pool });
    // (Without the dead-relay rule it would be held for good: the dead relay never sends EOSE.)
    await waitFor('the tablet loaded', () => t.view.value !== null && t.status.value !== 'syncing');
    await new Promise((r) => setTimeout(r, 1600));
    t.tick();
    await waitFor('the published move', () => online.published.includes(saved?.event.id as string));
    for (const g of players)
      await waitFor('the move everywhere', () => g.view.value?.head.id === saved?.event.id);
    t.dispose();

    // A Resign saved offline, then a relay that stays alive but never answers: the Resign is held; past the hold cap
    // the screen offers Send anyway, which vets it on what the relays sent and publishes it.
    let skew = 0;
    const silent = switchable(tablet.deps.pool);
    const deps = { ...tablet.deps, relays: () => [relay.url, SILENT], now: () => now() + skew };
    t = game(rootId, { ...deps, pool: silent.pool });
    await waitFor('the tablet resign button', () => t.canResign.value);
    await t.resign();
    const resign = loadOutbox(tablet.deps.storage, tablet.name, rootId).get('resign');
    expect(resign?.confirmed).toBe(false);
    t.dispose();
    silent.offline = false;
    silent.hidden = new Set();
    t = game(rootId, { ...deps, pool: silent.pool });
    await waitFor('the tablet loaded again', () => t.view.value !== null && t.status.value !== 'syncing');
    t.tick();
    await new Promise((r) => setTimeout(r, 300));
    expect(silent.published).not.toContain(resign?.event.id);
    expect(t.canSendAnyway.value).toBe(false);
    skew = HOLD_CAP_S + 1;
    t.tick();
    await waitFor('Send anyway offered', () => t.canSendAnyway.value);
    t.sendAnyway();
    await waitFor('the Resign sent anyway', () => silent.published.includes(resign?.event.id as string));
    for (const g of players)
      await waitFor('the Resign everywhere', () => (g.view.value?.resigned.length ?? 0) > 0);
  }, 300_000);

  it('a junk move naming a missing parent holds a saved move only until the relays are asked for it (D056, fix round 2 B)', async () => {
    const { rootId, address, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const players = bySeat.map((p) => game(rootId, p.deps));
    const phone = await waitFor(
      'the first decision',
      () => players.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
      120_000,
    );
    const mine = players.indexOf(phone);
    const p = bySeat[mine] as Profile;
    const tablet = secondDevice(p, address);
    const net = switchable(tablet.deps.pool);
    let t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn' && t.legal.value.length > 0);
    const head = t.view.value?.head as { id: string; seq: number };
    await t.act(t.legal.value[0]);
    const saved = savedMove(tablet, rootId, head.seq + 1);
    t.dispose();
    // Another seat E publishes well-formed junk: a game action naming a random parent, five moves above the head.
    const e = (mine + 1) % 3;
    const secrets = loadSecrets(bySeat[e]?.name as string, (bySeat[e] as Profile).deps.storage, address);
    if (secrets === null) throw new Error('no secrets for E');
    const junk = finalizeEvent(
      moveTemplate(
        {
          rootId,
          prevId: bytesToHex(rnd(32)),
          seq: head.seq + 5,
          content: { type: 'action', action: { type: 'skipPlace', actor: e }, shares: [], reveals: [] },
        },
        now(),
      ),
      secrets.sessionSk,
      rnd,
    );
    await newPool().publish(junk);
    // Back online: the tablet sees a move above its head from a parent it does not hold, asks every relay for that
    // parent, gets nothing, ignores it, and publishes the saved move without waiting for ticks.
    net.offline = false;
    t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the published move', () => net.published.includes(saved?.event.id as string), 30_000);
    for (const g of players)
      await waitFor('the move everywhere', () => g.view.value?.head.id === saved?.event.id);
    expect(t.log.value).toEqual([]);
  }, 240_000);

  it('a seated device does not reveal its secret on a partial view (D056, fix round 2 F)', async () => {
    const { rootId, address, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const players = bySeat.map((p) => game(rootId, p.deps));
    const first = await waitFor(
      'the first decision',
      () => players.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
      120_000,
    );
    await first.act(first.legal.value[0]);
    for (const g of players) await waitFor('the first action', () => g.view.value?.head.seq === 4);
    // Seat x's only open device is a tablet with two relays, one silent; seat r then resigns, so every seat owes its
    // secret (D052). The tablet's view is partial: it must hold its secret back.
    const x = 0;
    const r = 1;
    players[x]?.dispose();
    const tablet = secondDevice(bySeat[x] as Profile, address);
    const net = switchable(tablet.deps.pool);
    net.offline = false;
    net.hidden = new Set();
    const t = game(rootId, { ...tablet.deps, relays: () => [relay.url, SILENT], pool: net.pool });
    await waitFor('the tablet loaded', () => t.view.value !== null && t.status.value !== 'syncing');
    await (players[r] as GameController).resign();
    await waitFor('the tablet sees the Resign', () => t.view.value?.resigned.includes(r), 60_000);
    const xKey = parseRoot((await query({ ids: [rootId] }))[0] as NostrEvent).seats[x]?.session as string;
    const reveals = () => query({ kinds: [KIND.reveal], authors: [xKey], '#e': [rootId] });
    for (let i = 0; i < 3; i++) {
      t.tick();
      await new Promise((res) => setTimeout(res, 400));
    }
    expect(await reveals()).toEqual([]);
    expect(t.view.value?.phase).toBe('end');
    // The silent relay answers: the view is full, and the secret goes.
    net.hidden = null;
    t.tick();
    await waitFor('the tablet secret published', () => t.view.value?.phase === 'done', 120_000);
    expect(await reveals()).toHaveLength(1);
  }, 300_000);

  it('discards a saved move built on a discarded one, and holds nothing after (D056, follow-up 2)', async () => {
    const { rootId, address, bySeat } = await startGame(profile('a'), profile('b'), profile('c'));
    const players = bySeat.map((p) => game(rootId, p.deps));
    const phone = await waitFor(
      'the first decision',
      () => players.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
      120_000,
    );
    const p = bySeat[players.indexOf(phone)] as Profile;
    const tablet = secondDevice(p, address);
    const net = switchable(tablet.deps.pool);
    let t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn' && t.legal.value.length > 0);
    const head = t.view.value?.head as { id: string; seq: number };
    // Offline, the tablet saves M1 (the tile) and then M2 on top of it (the end of the same turn).
    await t.act(t.legal.value[0]);
    const m1 = savedMove(tablet, rootId, head.seq + 1);
    await waitFor(
      'the second decision of the turn',
      () =>
        t.view.value?.head.id === m1?.event.id && t.status.value === 'your-turn' && t.legal.value.length > 0,
    );
    await t.act(t.legal.value[0]);
    const m2 = savedMove(tablet, rootId, head.seq + 2);
    expect(m2?.event.tags).toContainEqual(['e', m1?.event.id, '', 'prev']);
    t.dispose();
    // The phone plays that first decision otherwise.
    await new Promise((r) => setTimeout(r, 1100));
    await phone.act(phone.legal.value[0]);
    for (const g of players) await waitFor('the phone move', () => g.view.value?.head.seq === head.seq + 1);

    // On reload M1 is discarded (another move of this seat on its parent), and M2 with it: nothing waits, nothing
    // is held, and neither is ever published.
    net.offline = false;
    t = game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('both discarded', () => t.log.value.length === 2);
    expect(t.log.value[1]).toMatch(/follows a saved move that was discarded/);
    expect(savedMove(tablet, rootId, head.seq + 1)).toBeUndefined();
    expect(savedMove(tablet, rootId, head.seq + 2)).toBeUndefined();
    expect(net.published).not.toContain(m1?.event.id);
    expect(net.published).not.toContain(m2?.event.id);
    expect(t.canSendAnyway.value).toBe(false);
    for (const g of [...players, t]) expect(g.view.value?.equivocators).toEqual([]);
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
