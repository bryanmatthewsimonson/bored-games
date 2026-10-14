/*
 * The web controller in an any-order setup (D093): the stagger of a shuffle duty's rank, the deal's settle while a
 * rival setup step is held, the deal race between two controllers of one seat, and setup mode (the setup runner's
 * controller) with the phase in the status cache. Chain Reaction, 3 seats (4 for one stagger test), against the real
 * dev relay. A controller under test runs on an injected clock and timers (`fakeTime`); the others run on the
 * platform's.
 */
import { GameSession } from '@bored-games/client';
import { finalizeEvent, KIND, type NostrEvent, parseRoot } from '@bored-games/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GameController,
  type GameControllerOptions,
  type GameStatus,
  loadOutbox,
  outboxKey,
} from '../src/game-controller.ts';
import { bytesToHex } from '../src/hex.ts';
import type { LobbyController } from '../src/lobby-controller.ts';
import { type ControllerDeps, MODULES, type PoolLike } from '../src/net.ts';
import { loadGameStatus, loadSecrets, memoryStorage, writeJson } from '../src/storage.ts';
import { fakeTime, Harness, now, type Profile, pause, recording, rnd, waitFor } from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

/** A Chain Reaction shuffle step takes seconds to prove and check, on every controller. */
const SLOW = 300_000;

/** A 3-seat Chain Reaction game started from the lobby: its root, and the seats' profiles and session keys. */
async function game3() {
  const { rootId, address, bySeat } = await h.start3('chain-reaction', [
    h.profile('a'),
    h.profile('b'),
    h.profile('c'),
  ]);
  const rootEv = (await h.query([{ ids: [rootId] }]))[0] as NostrEvent;
  const root = parseRoot(rootEv);
  const keys = root.seats.map((s) => s.session);
  return { rootId, address, rootEv, root, keys, bySeat: bySeat as [Profile, Profile, Profile] };
}

/** A 4-seat Chain Reaction game started from the lobby: its root id, the seats' session keys, and their profiles. */
async function game4() {
  const ps = ['a', 'b', 'c', 'd'].map((name) => h.profile(name));
  const [la, ...others] = ps.map((p) => h.lobby(p)) as [LobbyController, ...LobbyController[]];
  const address = await la.createTable({
    game: 'chain-reaction',
    seats: 4,
    deadline: 259200,
    invited: [],
    relays: [h.relay.url],
  });
  for (const l of others) {
    await waitFor('the open table', () => l.openTables.value.find((t) => t.address === address));
    await l.join(address);
  }
  await waitFor('a full table', () => la.table(address).value?.full);
  const rootId = await la.start(address);
  for (const l of others) await waitFor('the root', () => l.table(address).value?.root?.id === rootId);
  const root = parseRoot((await h.query([{ ids: [rootId] }]))[0] as NostrEvent);
  const bySeat = root.seats.map((s) => ps.find((p) => p.deps.signer.pubkey === s.npub) as Profile);
  return { rootId, keys: root.seats.map((s) => s.session), bySeat };
}

/** A game controller in setup mode (D093), disposed after the test. */
function setupGame(rootId: string, deps: ControllerDeps, opts: GameControllerOptions = {}): GameController {
  const c = new GameController(rootId, deps, { ...opts, mode: 'setup' });
  h.later(() => c.dispose());
  c.start();
  return c;
}

/** A session of `seat`'s own, outside any controller, at the root: for events signed by hand. */
async function seatSession(g: Awaited<ReturnType<typeof game3>>, seat: number): Promise<GameSession> {
  const p = g.bySeat[seat] as Profile;
  const [, creator, tableId] = g.root.tableAddress.split(':') as [string, string, string];
  const table = (
    await h.query([{ kinds: [KIND.table], authors: [creator], '#d': [tableId] }])
  )[0] as NostrEvent;
  const joins = await h.query([{ ids: [...g.root.joinIds] }]);
  const secrets = loadSecrets(p.name, p.deps.storage, g.address);
  if (secrets === null) throw new Error(`no secrets for seat ${seat}`);
  return GameSession.create({
    modules: MODULES,
    table,
    joins,
    root: g.rootEv,
    me: { seat, sessionSk: secrets.sessionSk, deckSecret: BigInt(`0x${bytesToHex(secrets.deckSecret)}`) },
    rootSeenAt: now(),
  });
}

/** The moves at the relay signed by `key`. */
const movesBy = (rootId: string, key: string): Promise<NostrEvent[]> =>
  h.query([{ kinds: [KIND.move], authors: [key], '#e': [rootId] }]);

/** The Shares events at the relay signed by `key`: a seat's deal, in setup. */
const sharesBy = (rootId: string, key: string): Promise<NostrEvent[]> =>
  h.query([{ kinds: [KIND.shares], authors: [key], '#e': [rootId] }]);

/** Poll the relay until `check` holds. */
async function onRelay(what: string, check: () => Promise<boolean>, ms = 120_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await pause(50);
  }
}

/** A pool that never delivers Shares events signed by `key`, on any subscription. */
function withoutShares(real: PoolLike, key: string): PoolLike {
  return {
    subscribe: (filters, onEvent, onEose, opts) =>
      real.subscribe(
        filters,
        (ev, url) => (ev.kind === KIND.shares && ev.pubkey === key ? undefined : onEvent(ev, url)),
        onEose,
        opts,
      ),
    publish: (ev, urls) => real.publish(ev, urls),
    addRelays: (urls) => real.addRelays?.(urls),
  };
}

/** A pool that runs `then` right after it hands the first move it receives to the subscriber, on any subscription. */
function afterFirstMove(real: PoolLike, then: () => void): PoolLike {
  let done = false;
  return {
    subscribe: (filters, onEvent, onEose, opts) =>
      real.subscribe(
        filters,
        (ev, url) => {
          onEvent(ev, url);
          if (done || ev.kind !== KIND.move) return;
          done = true;
          then();
        },
        onEose,
        opts,
      ),
    publish: (ev, urls) => real.publish(ev, urls),
    addRelays: (urls) => real.addRelays?.(urls),
  };
}

/**
 * Seat 2 waits at the root on a fake clock (dropping its wake timers with `dropWakes`); seat 0's app shuffles first.
 * Returns once seat 2 holds that step.
 */
async function seat0First(dropWakes = false) {
  const g = await game3();
  const c = fakeTime();
  c.dropWakes = dropWakes;
  const deps2 = { ...g.bySeat[2].deps, now: c.now, timers: c.timers };
  const g2 = h.game(g.rootId, deps2);
  await waitFor('seat 2 waiting at the root', () => g2.status.value === 'waiting', 60_000);
  h.game(g.rootId, g.bySeat[0].deps);
  await waitFor("seat 0's step", () => g2.view.value?.head.seq === 1, SLOW);
  expect(g2.status.value).toBe('waiting');
  return { ...g, c, deps2, g2 };
}

describe('The stagger of an any-order setup (D093)', () => {
  it(
    "seat 2 shuffles 45 s after seat 0's step when seat 1 is away",
    async () => {
      const { rootId, keys, c, g2 } = await seat0First();
      c.at(44);
      c.tick();
      await pause(500);
      expect(await movesBy(rootId, keys[2] as string)).toEqual([]);
      expect(g2.view.value?.head.seq).toBe(1);
      expect(g2.status.value).toBe('waiting');
      c.at(45);
      await onRelay("seat 2's step", async () => (await movesBy(rootId, keys[2] as string)).length === 1);
      await waitFor('seat 2 folded its step', () => g2.view.value?.head.seq === 2, SLOW);
    },
    SLOW,
  );

  it(
    'the wait survives a reload',
    async () => {
      const { rootId, keys, c, deps2, g2 } = await seat0First();
      c.at(30);
      g2.dispose();
      const again = h.game(rootId, deps2);
      await waitFor(
        'the reloaded controller waits',
        () => again.view.value?.head.seq === 1 && again.status.value === 'waiting',
        SLOW,
      );
      c.at(44);
      c.tick();
      await pause(500);
      expect(await movesBy(rootId, keys[2] as string)).toEqual([]);
      expect(again.status.value).toBe('waiting');
      c.at(45);
      await onRelay("seat 2's step", async () => (await movesBy(rootId, keys[2] as string)).length === 1);
    },
    SLOW,
  );

  it(
    'a late wake timer: the tick runs the duty',
    async () => {
      const { rootId, keys, c } = await seat0First(true);
      c.at(30);
      c.tick();
      await pause(500);
      c.at(45);
      await pause(500);
      // The wake never came, and no tick has run since the stagger passed.
      expect(await movesBy(rootId, keys[2] as string)).toEqual([]);
      c.at(60);
      c.tick();
      await onRelay("seat 2's step", async () => (await movesBy(rootId, keys[2] as string)).length === 1);
    },
    SLOW,
  );

  it(
    'a new head resets the wait',
    async () => {
      const { rootId, keys, bySeat, c, g2 } = await seat0First();
      c.at(20);
      // Seat 1 opens its app: it is first in line (rank 0) on seat 0's step, and shuffles at once.
      h.game(rootId, bySeat[1].deps);
      await waitFor("seat 1's step", () => (g2.view.value?.head.seq ?? 0) >= 2, SLOW);
      // Seat 2 is then the only seat left, rank 0: it shuffles with the clock still at +20 s.
      await onRelay("seat 2's step", async () => (await movesBy(rootId, keys[2] as string)).length === 1);
      expect(c.now()).toBe(c.start + 20);
    },
    SLOW,
  );

  it(
    'a new head resets the wait: at 4 seats, rank 2 on one head and rank 1 on the next',
    async () => {
      const { rootId, keys, bySeat } = await game4();
      const c = fakeTime();
      const g3 = h.game(rootId, { ...(bySeat[3] as Profile).deps, now: c.now, timers: c.timers });
      await waitFor('seat 3 waiting at the root', () => g3.status.value === 'waiting', 60_000);
      h.game(rootId, (bySeat[0] as Profile).deps);
      await waitFor("seat 0's step", () => g3.view.value?.head.seq === 1, SLOW);
      // Seat 3 is third in line on seat 0's step (rank 2): it would shuffle at +90 s.
      c.at(60);
      c.tick();
      await pause(500);
      expect(g3.status.value).toBe('waiting');
      // Seat 1 opens its app at +60 s and shuffles at once; seat 2 stays away.
      h.game(rootId, (bySeat[1] as Profile).deps);
      await waitFor("seat 1's step", () => g3.view.value?.head.seq === 2, SLOW);
      // Seat 3 is now second in line (rank 1), from when it saw seat 1's step: +105 s, not +90 s.
      for (const s of [90, 104]) {
        c.at(s);
        c.tick();
        await pause(500);
        expect(await movesBy(rootId, keys[3] as string), `at +${s} s`).toEqual([]);
        expect(g3.status.value, `at +${s} s`).toBe('waiting');
      }
      c.at(105);
      await onRelay("seat 3's step", async () => (await movesBy(rootId, keys[3] as string)).length === 1);
    },
    SLOW,
  );

  it(
    'a controller disposed as it takes in a new head arms no wake timer',
    async () => {
      const { rootId, bySeat } = await game3();
      const c = fakeTime();
      let g2: GameController | null = null;
      // Seat 2's controller is disposed the moment it has taken in seat 0's step, before its queued refresh runs.
      const pool = afterFirstMove(bySeat[2].deps.pool, () => g2?.dispose());
      g2 = h.game(rootId, { ...bySeat[2].deps, pool, now: c.now, timers: c.timers });
      await waitFor('seat 2 waiting at the root', () => g2?.status.value === 'waiting', 60_000);
      // Its wait at the root (rank 2).
      expect(c.pending()).toBe(1);
      h.game(rootId, bySeat[0].deps);
      await waitFor('the refresh after dispose', () => g2?.view.value?.head.seq === 1, SLOW);
      await pause(200);
      expect(c.pending()).toBe(0);
    },
    SLOW,
  );
});

describe('The deal of an any-order setup (D093)', () => {
  it(
    'two controllers of one seat on one storage deal once and neither shows Stuck',
    async () => {
      const { rootId, keys, bySeat } = await game3();
      const key0 = keys[0] as string;
      // Neither controller of seat 0 ever receives the other's deal from the relay: only the shared storage tells.
      const deps0 = { ...bySeat[0].deps, pool: withoutShares(bySeat[0].deps.pool, key0) };
      const twins = [h.game(rootId, deps0), h.game(rootId, deps0)] as [GameController, GameController];
      const statuses = new Set<GameStatus>();
      for (const g of twins) g.status.subscribe((s) => statuses.add(s));
      h.game(rootId, bySeat[1].deps);
      h.game(rootId, bySeat[2].deps);
      await waitFor(
        'both controllers of seat 0 past the deal, or one stuck',
        () =>
          twins.every((g) => g.view.value?.phase === 'play') || twins.some((g) => g.status.value === 'stuck'),
        SLOW,
      );
      expect(statuses.has('stuck')).toBe(false);
      expect(twins.map((g) => g.error.value)).toEqual([null, null]);
      expect(await sharesBy(rootId, key0)).toHaveLength(1);
    },
    SLOW,
  );

  it(
    'the deal waits 15 s while a rival step is held',
    async () => {
      const { rootId, address, rootEv, root, keys, bySeat } = await game3();
      const [s0, s1, s2] = bySeat;
      const g0 = h.game(rootId, s0.deps);
      const g1 = h.game(rootId, s1.deps);
      await waitFor('the first two shuffle steps', () => g1.view.value?.head.seq === 2, SLOW);
      g0.dispose();
      g1.dispose();

      // Seat 2, the last shuffler, signs two rival final steps from a separate session.
      const [, creator, tableId] = root.tableAddress.split(':') as [string, string, string];
      const table = (
        await h.query([{ kinds: [KIND.table], authors: [creator], '#d': [tableId] }])
      )[0] as NostrEvent;
      const joins = await h.query([{ ids: [...root.joinIds] }]);
      const secrets = loadSecrets(s2.name, s2.deps.storage, address);
      if (secrets === null) throw new Error('no secrets for seat 2');
      const session = GameSession.create({
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
      for (const m of await movesBy(rootId, keys[0] as string)) session.receive(m, now());
      for (const m of await movesBy(rootId, keys[1] as string)) session.receive(m, now());
      expect(session.view().head.seq).toBe(2);
      const steps = [session.buildShuffle(rnd, now()), session.buildShuffle(rnd, now())];
      for (const ev of steps) await h.pool().publish(ev);

      // Seat 0's app opens again, on a fake clock, and holds both: the deal waits for fork choice to settle.
      const c = fakeTime();
      const g = h.game(rootId, { ...s0.deps, now: c.now, timers: c.timers });
      await waitFor(
        'seat 0 holds the rival steps',
        () => g.view.value?.shuffleRivals === true && g.status.value === 'waiting',
        SLOW,
      );
      expect(g.view.value?.phase).toBe('deal');
      c.at(14);
      c.tick();
      await pause(500);
      expect(await sharesBy(rootId, keys[0] as string)).toEqual([]);
      expect(g.status.value).toBe('waiting');
      c.at(15);
      await onRelay("seat 0's deal", async () => (await sharesBy(rootId, keys[0] as string)).length === 1);
    },
    SLOW,
  );
});

describe('The setup mode (D093)', () => {
  it(
    'setup mode shuffles and deals only',
    async () => {
      // NIP-44 on: a full controller would check each seat's key backup (decrypting it), and might publish one.
      const { rootId, bySeat } = await h.start3('chain-reaction', [
        h.profile('a', { nip44: true }),
        h.profile('b', { nip44: true }),
        h.profile('c', { nip44: true }),
      ]);
      const seats = bySeat.map((p) => recording(p.deps));
      // An automatic move that plays the first legal action: a full controller would send it in play.
      const first = (): ((legal: readonly unknown[]) => unknown) => (legal) => legal[0] ?? null;
      const gs = seats.map((s) => setupGame(rootId, s.deps, { autoMove: first }));
      await waitFor('every seat in play', () => gs.every((g) => g.view.value?.phase === 'play'), SLOW);
      await waitFor('every seat settled', () =>
        gs.every((g) => g.status.value === 'waiting' || g.status.value === 'your-turn'),
      );
      expect(gs.some((g) => g.status.value === 'your-turn')).toBe(true);
      await pause(2000);
      for (const [i, s] of seats.entries()) {
        const g = gs[i] as GameController;
        expect(s.prompts, `seat ${i}`).toEqual([]);
        expect(
          s.published.filter((ev) => ev.kind !== KIND.move && ev.kind !== KIND.shares),
          `seat ${i}`,
        ).toEqual([]);
        expect(g.backup.value, `seat ${i}`).toBeNull();
        expect(g.error.value, `seat ${i}`).toBeNull();
      }
      // The three shuffle steps and the three deals: no move in play, no Secret, attestation or Resign.
      const all = await h.query([{ '#e': [rootId] }]);
      expect(all.filter((ev) => ev.kind === KIND.move)).toHaveLength(3);
      expect(all.filter((ev) => ev.kind === KIND.shares)).toHaveLength(3);
      expect(all.filter((ev) => ev.kind !== KIND.move && ev.kind !== KIND.shares)).toEqual([]);
    },
    SLOW,
  );

  it(
    'setup mode never restores keys',
    async () => {
      // NIP-44 on: each Join published a backup of the seat's game keys, which a full controller would restore.
      const { rootId, bySeat } = await h.start3('chain-reaction', [
        h.profile('a', { nip44: true }),
        h.profile('b', { nip44: true }),
        h.profile('c', { nip44: true }),
      ]);
      // Seat 0's player on a device without the game keys.
      const s0 = bySeat[0] as Profile;
      const fresh = recording(h.profile(s0.name, { store: memoryStorage(), signer: s0.deps.signer }).deps);
      const g = setupGame(rootId, fresh.deps);
      await waitFor('the game loaded', () => g.status.value === 'waiting', 60_000);
      await pause(2000);
      expect(fresh.prompts).toEqual([]);
      expect(fresh.published).toEqual([]);
      expect(g.restore.value).toBeNull();
      expect(g.recovered.value).toBeNull();
      expect(g.view.value?.mySeat).toBeNull();
      expect(await h.query([{ kinds: [KIND.move], '#e': [rootId] }])).toEqual([]);
    },
    SLOW,
  );

  it(
    'the status cache records the phase',
    async () => {
      const { rootId, bySeat } = await game3();
      const [s0, s1, s2] = bySeat;
      const phase = (p: Profile) => loadGameStatus(p.name, p.deps.storage, rootId)?.phase;
      // Seat 0 in setup mode, the others in full mode: every controller writes the phase.
      const gs = [setupGame(rootId, s0.deps), h.game(rootId, s1.deps)];
      await waitFor('the setup phase cached', () => phase(s0) === 'setup' && phase(s1) === 'setup');
      // Seat 2 is away, so the setup cannot end: still `setup`.
      await waitFor('seat 1 shuffled', () => (gs[0]?.view.value?.head.seq ?? 0) >= 2, SLOW);
      expect([phase(s0), phase(s1)]).toEqual(['setup', 'setup']);
      gs.push(h.game(rootId, s2.deps));
      await waitFor('every seat in play', () => gs.every((g) => g.view.value?.phase === 'play'), SLOW);
      await waitFor('the play phase cached', () => bySeat.every((p) => phase(p) === 'play'), 5_000);
    },
    SLOW,
  );

  it(
    'setup mode never echoes a Resign',
    async () => {
      const g = await game3();
      // Seat 0 resigns at the root, before any game action: the game is cancelled.
      const session = await seatSession(g, 0);
      await h.pool().publish(session.buildResign(rnd, now()));
      // A full controller of seat 1 would republish the Resign that counted, and send its Secret.
      const s1 = g.bySeat[1];
      const rec = recording(s1.deps);
      const g1 = setupGame(g.rootId, rec.deps);
      await waitFor('the game cancelled', () => g1.status.value === 'cancelled', 60_000);
      await pause(1000);
      expect(rec.published).toEqual([]);
      expect(loadGameStatus(s1.name, s1.deps.storage, g.rootId)?.phase).toBe('end');
    },
    SLOW,
  );

  it(
    'setup mode performs no duty once the game is in play, and caches the status a full controller would',
    async () => {
      // Bank: deckless, so in play from the start; a roll asks every other seat for its share of the dice.
      const { rootId, bySeat } = await h.start2('bank', h.profile('a'), h.profile('b'));
      const rollOf = (g: GameController) =>
        g.legal.value.find((a) => (a as { type?: string }).type === 'roll');
      const full = bySeat.map((p) => h.game(rootId, p.deps));
      const roller = await waitFor('the first roll', () =>
        full.find((g) => g.status.value === 'your-turn' && rollOf(g) !== undefined),
      );
      const other = 1 - full.indexOf(roller);
      const p = bySeat[other] as Profile;
      full[other]?.dispose();
      const rec = recording(p.deps);
      const g = setupGame(rootId, rec.deps);
      await waitFor('the game loaded', () => g.status.value === 'waiting', 60_000);
      expect(g.view.value?.phase).toBe('play');
      await roller.act(rollOf(roller));
      // This seat owes its share of the roll (a beacon duty), which a full controller sends at once.
      await waitFor('the roll', () => g.view.value?.head.seq === 1, 60_000);
      await pause(2000);
      expect(rec.published).toEqual([]);
      const key = parseRoot((await h.query([{ ids: [rootId] }]))[0] as NostrEvent).seats[other]?.session;
      expect(await movesBy(rootId, key as string)).toEqual([]);
      // The status is the one a full controller computes, `working` while a duty is due, and it is cached as such.
      expect(g.status.value).toBe('working');
      expect(loadGameStatus(p.name, p.deps.storage, rootId)).toMatchObject({
        status: 'working',
        phase: 'play',
      });
    },
    SLOW,
  );

  it(
    'setup mode neither publishes nor discards a saved event that is not setup work',
    async () => {
      const g = await game3();
      const s0 = g.bySeat[0];
      const secrets = loadSecrets(s0.name, s0.deps.storage, g.address);
      if (secrets === null) throw new Error('no secrets for seat 0');
      // Saved by the game page and never sent: a Resign, which a full controller republishes; a card reveal that does
      // not fit the game, which it discards; and a Secret the game refuses, which it marks as refused (an orphan).
      const resign = (await seatSession(g, 0)).buildResign(rnd, now());
      const junk = (kind: number) =>
        finalizeEvent(
          {
            kind,
            created_at: now(),
            tags: [
              ['e', g.rootId, '', 'root'],
              ['proto', '1'],
            ],
            content: '{}',
          },
          secrets.sessionSk,
          rnd,
        );
      const saved = {
        resign: { event: resign, confirmed: false, orphan: false },
        'share:0': { event: junk(KIND.shares), confirmed: false, orphan: false },
        secret: { event: junk(KIND.reveal), confirmed: false, orphan: false },
      };
      writeJson(s0.deps.storage, outboxKey(s0.name, g.rootId), saved);
      const rec = recording(s0.deps);
      const c = setupGame(g.rootId, rec.deps);
      await waitFor('the game loaded', () => c.status.value !== 'syncing', 60_000);
      await pause(1500);
      expect(rec.published.filter((ev) => ev.kind !== KIND.move)).toEqual([]);
      expect(c.log.value).toEqual([]);
      // Seat 0, first in line at the root, still shuffles; the saved events wait for the game page.
      await onRelay("seat 0's step", async () => (await movesBy(g.rootId, g.keys[0] as string)).length === 1);
      const after = loadOutbox(s0.deps.storage, s0.name, g.rootId);
      expect(after.get('resign')).toEqual(saved.resign);
      expect(after.get('share:0')).toEqual(saved['share:0']);
      expect(after.get('secret')).toEqual(saved.secret);
      expect(await h.query([{ kinds: [KIND.resign], '#e': [g.rootId] }])).toEqual([]);
    },
    SLOW,
  );
});

describe('New games from the lobby (D093)', () => {
  it(
    'a game started from the lobby is any-order',
    async () => {
      const { root } = await game3();
      expect(root.shuffleOrder).toBe('any');
    },
    SLOW,
  );

  it(
    'a game that reshuffles in play starts in seat order (ruling 12)',
    async () => {
      const { rootId } = await h.start2('holler', h.profile('a'), h.profile('b'));
      const rootEv = (await h.query([{ ids: [rootId] }]))[0] as NostrEvent;
      expect(parseRoot(rootEv).shuffleOrder).toBe('seat');
    },
    SLOW,
  );
});
