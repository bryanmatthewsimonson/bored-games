/*
 * The setup runner (D093): a page service that does this seat's setup shuffle and deal from any page of the app, so
 * a game no longer strands when its players never have its page open at once. It takes the oldest games first, at
 * most `SETUP_RUNNER_MAX` at once, only those whose keys are in this browser and whose setup is not over, hands a game
 * to its page while that page is open, and stops once this seat's setup work is done. Chain Reaction (3 seats) where
 * the runner shuffles and deals, Luster (2 seats, any order) and Holler (2 seats, seat order) where it only waits,
 * against the real dev relay.
 */
import { DEAL_SETTLE_S, GameSession } from '@bored-games/client';
import { KIND, type NostrEvent, parseRoot } from '@bored-games/protocol';
import type { Filter } from '@bored-games/relay';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOutbox, outboxKey, SETUP_MODE_GRACE_S } from '../src/game-controller.ts';
import { bytesToHex } from '../src/hex.ts';
import { saveRestored } from '../src/key-backup.ts';
import { lobbyFor } from '../src/lobby-hooks.ts';
import { type ControllerDeps, MODULES, type PoolLike } from '../src/net.ts';
import {
  inLine,
  SETUP_LOAD_LIMIT_S,
  SETUP_PARK_S,
  SETUP_RUNNER_MAX,
  type SetupLine,
  type SetupRunner,
  setupLineText,
  setupRunnerFor,
} from '../src/setup-runner.ts';
import {
  addToTableList,
  type GameSecrets,
  type GameStatusCache,
  gameStatusKey,
  loadGameStatus,
  loadSecrets,
  saveSecrets,
} from '../src/storage.ts';
import { fakeTime, Harness, now, type Profile, pause, recording, rnd, waitFor } from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

/** A Chain Reaction shuffle step takes seconds to prove and check, on every controller. */
const SLOW = 300_000;

/**
 * A profile's dependencies that count the game controllers built on them: a controller's first subscription asks
 * for its root by id alone (`GameController.start`) and lasts until it is disposed. `most` is the most roots followed
 * at once (a lookup of a missing parent by id counts too; the tests that read it make no moves).
 */
function tracking(deps: ControllerDeps) {
  const built = new Map<string, number>();
  const live = new Map<string, number>();
  let most = 0;
  const add = (m: Map<string, number>, id: string, by: number): void => {
    m.set(id, (m.get(id) ?? 0) + by);
  };
  const rootOf = (filters: Filter[]): string | null => {
    const [f] = filters;
    if (filters.length !== 1 || f === undefined || Object.keys(f).join() !== 'ids') return null;
    return f.ids?.length === 1 ? (f.ids[0] as string) : null;
  };
  const pool: PoolLike = {
    subscribe: (filters, onEvent, onEose, opts) => {
      const stop = deps.pool.subscribe(filters, onEvent, onEose, opts);
      const id = rootOf(filters);
      if (id === null) return stop;
      add(built, id, 1);
      add(live, id, 1);
      most = Math.max(most, [...live.values()].filter((n) => n > 0).length);
      let open = true;
      return () => {
        if (open) add(live, id, -1);
        open = false;
        stop();
      };
    },
    publish: (ev, urls) => deps.pool.publish(ev, urls),
    addRelays: (urls) => deps.pool.addRelays?.(urls),
  };
  return {
    deps: { ...deps, pool },
    /** How many controllers were built for `rootId`. */
    built: (rootId: string): number => built.get(rootId) ?? 0,
    /** How many controllers of `rootId` are live. */
    live: (rootId: string): number => live.get(rootId) ?? 0,
    /** The roots of `rootIds` with a live controller, in that order. */
    running: (rootIds: readonly string[]): string[] => rootIds.filter((id) => (live.get(id) ?? 0) > 0),
    most: (): number => most,
  };
}

/**
 * The page's setup runner on `deps` (`setupRunnerFor`), started once the page's lobby (`lobbyFor`) lists every game of
 * `roots`; both disposed after the test.
 */
async function runnerOn(deps: ControllerDeps, roots: readonly string[]): Promise<SetupRunner> {
  const lobby = lobbyFor(deps);
  const runner = setupRunnerFor(deps);
  h.later(() => {
    runner.dispose();
    lobby.dispose();
  });
  await waitFor('the lobby lists the games', () =>
    roots.every((id) => lobby.myTables.value.some((t) => t.rootId === id)),
  );
  runner.start();
  return runner;
}

/** Every line the runner shows for `rootId`, each change once. */
function linesOf(runner: SetupRunner, rootId: string): SetupLine[] {
  const seen: SetupLine[] = [];
  h.later(
    runner.lines.subscribe((m) => {
      const line = m.get(rootId);
      if (line !== undefined && JSON.stringify(line) !== JSON.stringify(seen.at(-1))) seen.push(line);
    }),
  );
  return seen;
}

/** The root of `rootId` at the relay, parsed, with the event. */
async function rootOf(rootId: string) {
  const ev = (await h.query([{ ids: [rootId] }]))[0] as NostrEvent;
  return { ev, root: parseRoot(ev) };
}

/** A session of `seat`'s own (profile `p`), outside any controller, holding the game's moves: for events by hand. */
async function seatSession(rootId: string, p: Profile, seat: number): Promise<GameSession> {
  const { ev, root } = await rootOf(rootId);
  const [, creator, tableId] = root.tableAddress.split(':') as [string, string, string];
  const table = (
    await h.query([{ kinds: [KIND.table], authors: [creator], '#d': [tableId] }])
  )[0] as NostrEvent;
  const joins = await h.query([{ ids: [...root.joinIds] }]);
  const secrets = loadSecrets(p.name, p.deps.storage, root.tableAddress);
  if (secrets === null) throw new Error(`no secrets for seat ${seat}`);
  const session = GameSession.create({
    modules: MODULES,
    table,
    joins,
    root: ev,
    me: { seat, sessionSk: secrets.sessionSk, deckSecret: BigInt(`0x${bytesToHex(secrets.deckSecret)}`) },
    rootSeenAt: now(),
  });
  const moves = await h.query([{ kinds: [KIND.move], '#e': [rootId] }]);
  for (const m of [...moves].sort((a, b) => a.created_at - b.created_at)) session.receive(m, now());
  return session;
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

/** A 3-seat Chain Reaction game started from the lobby (any order): its root id, session keys and profiles. */
async function game3() {
  const { rootId, address, bySeat } = await h.start3('chain-reaction', [
    h.profile('a'),
    h.profile('b'),
    h.profile('c'),
  ]);
  const { root } = await rootOf(rootId);
  return {
    rootId,
    address,
    keys: root.seats.map((s) => s.session),
    bySeat: bySeat as [Profile, Profile, Profile],
  };
}

/**
 * Four 2-seat games of `game` between `a` (the creator, seat 0) and `b` (seat 1), started a second apart on the
 * creator's clock (which dates the roots) so their roots' dates order them, oldest first.
 */
async function games4(game: string, a: Profile, b: Profile): Promise<string[]> {
  const c = fakeTime();
  const creator: Profile = { ...a, deps: { ...a.deps, now: c.now } };
  const roots: string[] = [];
  for (let i = 0; i < 4; i++) {
    c.at(i);
    roots.push((await h.start2(game, creator, b)).rootId);
  }
  return roots;
}

/** A pool whose subscriptions for `rootId` by id alone (a game controller's first) get nothing: it never loads. */
function withoutRoots(real: PoolLike, rootIds: readonly string[]): PoolLike {
  return {
    subscribe: (filters, onEvent, onEose, opts) => {
      const [f] = filters;
      const hidden =
        filters.length === 1 && Object.keys(f ?? {}).join() === 'ids' && rootIds.includes(f?.ids?.[0] ?? '');
      return real.subscribe(filters, (ev, url) => (hidden ? undefined : onEvent(ev, url)), onEose, opts);
    },
    publish: (ev, urls) => real.publish(ev, urls),
    addRelays: (urls) => real.addRelays?.(urls),
  };
}

/** Seat 0 (`a`) resigns the game before the first game action: it is cancelled. */
async function cancel(rootId: string, a: Profile): Promise<void> {
  const session = await seatSession(rootId, a, 0);
  await h.pool().publish(session.buildResign(rnd, now()));
}

describe('The setup runner (D093)', () => {
  it(
    'shuffles from Home',
    async () => {
      const { rootId, keys, bySeat } = await game3();
      const [s0, s1, s2] = bySeat;
      h.game(rootId, s0.deps);
      await onRelay("seat 0's step", async () => (await movesBy(rootId, keys[0] as string)).length === 1);
      // Seat 1's player is on Home: no game page, only the page's setup runner, on a clock that moves only when the
      // test moves it.
      const c = fakeTime();
      const runner = await runnerOn({ ...s1.deps, now: c.now, timers: c.timers }, [rootId]);
      const seen = linesOf(runner, rootId);
      const waiting: SetupLine = { kind: 'waiting', who: [s2.deps.signer.pubkey], what: 'shuffle' };
      // The runner holds seat 1's step for the grace: the game waits on seats 1 and 2, and the line names seat 2.
      await waitFor(
        'the runner holding its step for the grace',
        () => JSON.stringify(runner.lines.value.get(rootId)) === JSON.stringify(waiting),
        SLOW,
      );
      c.at(SETUP_MODE_GRACE_S);
      await onRelay("seat 1's step", async () => (await movesBy(rootId, keys[1] as string)).length === 1);
      await waitFor(
        'the line waits for seat 2',
        () => JSON.stringify(seen.at(-1)) === JSON.stringify(waiting),
        SLOW,
      );
      const shuffling = seen.findIndex((l) => l.kind === 'shuffling');
      expect(shuffling, JSON.stringify(seen)).toBeGreaterThanOrEqual(0);
      expect(seen.slice(shuffling + 1)).toContainEqual(waiting);
      expect(seen[shuffling]).toEqual({ kind: 'shuffling', who: [], what: 'shuffle' });
    },
    SLOW,
  );

  it(
    'skips a game whose keys are not in this browser',
    async () => {
      const { rootId, address, bySeat } = await h.start2('luster', h.profile('a'), h.profile('b'));
      const p = bySeat[1];
      // This browser lost the seat's game keys: only a restore from the player's backup could bring them back.
      const key = `bg:${p.name}:secrets:${address}`;
      const secrets = p.deps.storage.getItem(key) as string;
      p.deps.storage.removeItem(key);
      // Another browser of the same player holds game keys for the table that match no seat of the game.
      const other = h.profile(p.name, { signer: p.deps.signer });
      addToTableList(p.name, other.deps.storage, address, p.deps.signer.pubkey);
      saveSecrets(p.name, other.deps.storage, address, { sessionSk: rnd(32), deckSecret: rnd(32) });
      // Seat 1 at the root waits its turn in line (rank 1) on a clock that never moves.
      const c = fakeTime();
      const runs: {
        rec: ReturnType<typeof recording>;
        t: ReturnType<typeof tracking>;
        runner: SetupRunner;
      }[] = [];
      for (const deps of [p.deps, other.deps]) {
        const rec = recording({ ...deps, now: c.now, timers: c.timers });
        const t = tracking(rec.deps);
        runs.push({ rec, t, runner: await runnerOn(t.deps, [rootId]) });
      }
      await pause(1000);
      for (const { rec, t, runner } of runs) {
        expect(t.built(rootId)).toBe(0);
        expect(runner.lines.value.size).toBe(0);
        expect(rec.prompts).toEqual([]);
        expect(rec.published).toEqual([]);
      }
      // With the keys back in the first browser, its runner takes the game at its next look.
      p.deps.storage.setItem(key, secrets);
      c.tick();
      await waitFor('a controller in setup', () => runs[0]?.t.live(rootId) === 1);
      expect(runs[1]?.t.built(rootId)).toBe(0);
    },
    SLOW,
  );

  it(
    'skips games whose cached phase is play or end, and status done or cancelled',
    async () => {
      const { rootId, bySeat } = await h.start2('luster', h.profile('a'), h.profile('b'));
      const p = bySeat[1];
      // Seat 1 at the root waits its turn in line (rank 1) on a clock that never moves: a runner's controller shuffles
      // nothing here.
      const c = fakeTime();
      const t = tracking({ ...p.deps, now: c.now, timers: c.timers });
      const cache = (entry: Partial<GameStatusCache>): void => {
        p.deps.storage.setItem(
          gameStatusKey(p.name, rootId),
          JSON.stringify({ status: 'waiting', seq: 0, updatedAt: now(), ...entry }),
        );
      };
      cache({ phase: 'play' });
      await runnerOn(t.deps, [rootId]);
      await pause(500);
      expect(t.built(rootId)).toBe(0);
      const skipped: Partial<GameStatusCache>[] = [
        { phase: 'end' },
        { status: 'done' },
        { status: 'cancelled' },
        { status: 'done', phase: 'setup' },
      ];
      for (const entry of skipped) {
        cache(entry);
        c.tick();
        await pause(300);
        expect(t.built(rootId), JSON.stringify(entry)).toBe(0);
      }
      // A game in setup, or one this browser never opened, is taken.
      cache({ phase: 'setup' });
      c.tick();
      await waitFor('a controller in setup', () => t.live(rootId) === 1);
      expect(t.built(rootId)).toBe(1);
    },
    SLOW,
  );

  it(
    'hands a game to its page and takes it back',
    async () => {
      const { rootId, keys, bySeat } = await game3();
      const [s0, s1, s2] = bySeat;
      h.game(rootId, s0.deps);
      await onRelay("seat 0's step", async () => (await movesBy(rootId, keys[0] as string)).length === 1);
      // Seat 1's runner, on a clock that moves only when the test moves it.
      const c = fakeTime();
      const t = tracking({ ...s1.deps, now: c.now, timers: c.timers });
      const runner = await runnerOn(t.deps, [rootId]);
      const waiting: SetupLine = { kind: 'waiting', who: [s2.deps.signer.pubkey], what: 'shuffle' };
      // It holds seat 1's step for the grace (the line names seat 2), then shuffles.
      await waitFor(
        'the runner holding its step for the grace',
        () => JSON.stringify(runner.lines.value.get(rootId)) === JSON.stringify(waiting),
        SLOW,
      );
      c.at(SETUP_MODE_GRACE_S);
      await waitFor('the runner shuffling', () => runner.lines.value.get(rootId)?.kind === 'shuffling', SLOW);
      // The game's page opens mid-setup: the runner hands the game over at once.
      const release = runner.claim(rootId);
      expect(t.live(rootId)).toBe(0);
      expect(runner.lines.value.has(rootId)).toBe(false);
      const page = h.game(rootId, s1.deps);
      await waitFor("the page holds seat 1's step", () => (page.view.value?.head.seq ?? 0) >= 2, SLOW);
      await pause(1500);
      // Each move slot went out once, whichever controller built it.
      const moves = await h.query([{ kinds: [KIND.move], '#e': [rootId] }]);
      const slots = moves.map(
        (m) => `${m.pubkey}:${m.tags.find((tag) => tag[0] === 'e' && tag[3] === 'prev')?.[1]}`,
      );
      expect(new Set(slots).size).toBe(moves.length);
      expect(await movesBy(rootId, keys[1] as string)).toHaveLength(1);
      expect(t.built(rootId)).toBe(1);
      // The page closes before the setup is over: the runner takes the game back.
      page.dispose();
      release();
      await waitFor('the runner has the game again', () => t.live(rootId) === 1);
      expect(t.built(rootId)).toBe(2);
      await waitFor(
        'the line waits for seat 2',
        () => JSON.stringify(runner.lines.value.get(rootId)) === JSON.stringify(waiting),
        SLOW,
      );
    },
    SLOW,
  );

  it(
    `runs at most ${SETUP_RUNNER_MAX} at once, oldest first`,
    async () => {
      const a = h.profile('a');
      const b = h.profile('b');
      // Roots a second apart, so their dates order them.
      const roots = await games4('luster', a, b);
      // Seat 1 waits its turn in line in each game on a clock that never moves: nothing is shuffled.
      const c = fakeTime();
      const t = tracking({ ...b.deps, now: c.now, timers: c.timers });
      await runnerOn(t.deps, roots);
      await waitFor('three setup controllers', () => t.running(roots).length === 3);
      await pause(500);
      expect(t.running(roots)).toEqual(roots.slice(0, 3));
      expect(t.built(roots[3] as string)).toBe(0);
      // The oldest game is cancelled (its creator resigns before the first game action): the fourth takes its place.
      const session = await seatSession(roots[0] as string, a, 0);
      await h.pool().publish(session.buildResign(rnd, now()));
      await waitFor('the fourth game taken', () => t.running(roots).join() === roots.slice(1).join(), 60_000);
      expect(t.most()).toBe(3);
    },
    SLOW,
  );

  it(
    "stops when this seat's setup work is done",
    async () => {
      const { rootId, keys, bySeat } = await game3();
      const [s0, s1, s2] = bySeat;
      h.game(rootId, s0.deps);
      await onRelay("seat 0's step", async () => (await movesBy(rootId, keys[0] as string)).length === 1);
      // Seat 1's runner, on a clock that moves only when the test moves it.
      const c = fakeTime();
      const t = tracking({ ...s1.deps, now: c.now, timers: c.timers });
      const runner = await runnerOn(t.deps, [rootId]);
      const line = (): SetupLine | undefined => runner.lines.value.get(rootId);
      // It holds seat 1's step for the grace (the line names seat 2), then shuffles.
      const waiting: SetupLine = { kind: 'waiting', who: [s2.deps.signer.pubkey], what: 'shuffle' };
      await waitFor(
        'the runner holding its step for the grace',
        () => JSON.stringify(line()) === JSON.stringify(waiting),
        SLOW,
      );
      c.at(SETUP_MODE_GRACE_S);
      await onRelay("seat 1's step", async () => (await movesBy(rootId, keys[1] as string)).length === 1);
      // Seat 2 shuffles by hand and never deals: the setup stays in the deal.
      const session = await seatSession(rootId, s2, 2);
      await h.pool().publish(session.buildShuffle(rnd, now()));
      // The runner holds seat 1's deal for the grace, then deals.
      await waitFor('the runner holding its deal for the grace', () => line()?.what === 'deal', SLOW);
      c.at(2 * SETUP_MODE_GRACE_S);
      await onRelay(
        "seat 1's deal",
        async () => (await sharesBy(rootId, keys[1] as string)).length === 1,
        SLOW,
      );
      // Its work is done once a relay took the deal: the runner's next look (its tick) stops the run.
      await waitFor(
        'the deal confirmed',
        () => loadOutbox(s1.deps.storage, s1.name, rootId).get('deal')?.confirmed,
        SLOW,
      );
      c.tick();
      await waitFor('the runner done with the game', () => t.live(rootId) === 0, SLOW);
      expect(runner.lines.value.has(rootId)).toBe(false);
      expect(loadGameStatus(s1.name, s1.deps.storage, rootId)?.phase).toBe('setup');
      expect(loadOutbox(s1.deps.storage, s1.name, rootId).get('deal')?.confirmed).toBe(true);
      // A page opened and closed on the game does not bring it back: this seat has nothing left to do in its setup.
      runner.claim(rootId)();
      await pause(1000);
      expect(t.built(rootId)).toBe(1);
    },
    SLOW,
  );

  it(
    'stops when the game leaves its setup',
    async () => {
      const { rootId, bySeat } = await h.start2('luster', h.profile('a'), h.profile('b'));
      const [a, b] = bySeat;
      const c = fakeTime();
      const t = tracking({ ...b.deps, now: c.now, timers: c.timers });
      const runner = await runnerOn(t.deps, [rootId]);
      const waiting: SetupLine = { kind: 'waiting', who: [a.deps.signer.pubkey], what: 'shuffle' };
      await waitFor(
        'the line waits for seat 0',
        () => JSON.stringify(runner.lines.value.get(rootId)) === JSON.stringify(waiting),
      );
      // Seat 0 resigns before the first game action: the game is cancelled.
      const session = await seatSession(rootId, a, 0);
      await h.pool().publish(session.buildResign(rnd, now()));
      await waitFor('the runner done with the game', () => t.live(rootId) === 0);
      expect(runner.lines.value.has(rootId)).toBe(false);
      c.tick();
      await pause(500);
      expect(t.built(rootId)).toBe(1);
    },
    SLOW,
  );
});

describe('The setup runner and other devices (D093, ruling 20)', () => {
  it(
    'skips a game whose keys were restored from the backup',
    async () => {
      const { rootId, address, bySeat } = await h.start2('luster', h.profile('a'), h.profile('b'));
      const p = bySeat[1];
      const secrets = loadSecrets(p.name, p.deps.storage, address) as GameSecrets;
      // This browser got the seat's keys from the player's backup: the device that joined plays the seat too.
      const key = `bg:${p.name}:secrets:${address}`;
      p.deps.storage.removeItem(key);
      expect(saveRestored(p.name, p.deps.storage, address, secrets, now())).toBe(true);
      const c = fakeTime();
      const t = tracking({ ...p.deps, now: c.now, timers: c.timers });
      await runnerOn(t.deps, [rootId]);
      await pause(1000);
      expect(t.built(rootId)).toBe(0);
      // The same keys, made here at the join: taken.
      p.deps.storage.removeItem(key);
      saveSecrets(p.name, p.deps.storage, address, {
        sessionSk: secrets.sessionSk,
        deckSecret: secrets.deckSecret,
      });
      c.tick();
      await waitFor('a controller in setup', () => t.live(rootId) === 1);
    },
    SLOW,
  );

  it(
    'stops when its deal arrives from another device',
    async () => {
      const { rootId, address, keys, bySeat } = await game3();
      const [s0, s1, s2] = bySeat;
      // Seat 1's runner here, on a clock that never moves: its own duties wait out the grace for ever.
      const c = fakeTime();
      const t = tracking({ ...s1.deps, now: c.now, timers: c.timers });
      await runnerOn(t.deps, [rootId]);
      // Seat 1's game page is open on its other device, which plays the seat with the same game keys.
      h.game(rootId, s0.deps);
      h.game(rootId, h.secondDevice(s1, address).deps);
      for (const k of [0, 1])
        await onRelay(
          `seat ${k}'s step`,
          async () => (await movesBy(rootId, keys[k] as string)).length === 1,
        );
      // Seat 2 shuffles by hand and never deals: the setup stays in the deal.
      const session = await seatSession(rootId, s2, 2);
      await h.pool().publish(session.buildShuffle(rnd, now()));
      await onRelay(
        "seat 1's deal",
        async () => (await sharesBy(rootId, keys[1] as string)).length === 1,
        SLOW,
      );
      await waitFor('the runner done with the game', () => t.live(rootId) === 0, SLOW);
      expect(loadOutbox(s1.deps.storage, s1.name, rootId).get('deal')).toBeUndefined();
      expect(loadGameStatus(s1.name, s1.deps.storage, rootId)?.phase).toBe('setup');
      expect(await movesBy(rootId, keys[1] as string)).toHaveLength(1);
      expect(await sharesBy(rootId, keys[1] as string)).toHaveLength(1);
    },
    SLOW,
  );

  it(
    'does not stop while a rival step is held in the deal, and deals after the settle and the grace',
    async () => {
      const { rootId, keys, bySeat } = await game3();
      const [s0, s1, s2] = bySeat;
      const g0 = h.game(rootId, s0.deps);
      const g1 = h.game(rootId, s1.deps);
      await waitFor('the first two shuffle steps', () => g1.view.value?.head.seq === 2, SLOW);
      g0.dispose();
      g1.dispose();
      // Seat 2, the last shuffler, signs two rival final steps.
      const session = await seatSession(rootId, s2, 2);
      for (const ev of [session.buildShuffle(rnd, now()), session.buildShuffle(rnd, now())])
        await h.pool().publish(ev);
      // Seat 0's runner holds both: the deal waits for fork choice to settle, then for the grace. The game waits on
      // seat 2 alone meanwhile, and no deal of seat 0's is saved here: neither means its deal is out.
      const c = fakeTime();
      const t = tracking({ ...s0.deps, now: c.now, timers: c.timers });
      const runner = await runnerOn(t.deps, [rootId]);
      await waitFor(
        'the runner in the deal, or done with the game',
        () =>
          runner.lines.value.get(rootId)?.what === 'deal' || (t.built(rootId) > 0 && t.live(rootId) === 0),
        SLOW,
      );
      expect(t.live(rootId)).toBe(1);
      c.at(DEAL_SETTLE_S + SETUP_MODE_GRACE_S - 1);
      c.tick();
      await pause(1000);
      expect(t.live(rootId)).toBe(1);
      expect(await sharesBy(rootId, keys[0] as string)).toEqual([]);
      c.at(DEAL_SETTLE_S + SETUP_MODE_GRACE_S);
      await onRelay(
        "seat 0's deal",
        async () => (await sharesBy(rootId, keys[0] as string)).length === 1,
        SLOW,
      );
      await waitFor('the runner done with the game', () => t.live(rootId) === 0, SLOW);
    },
    SLOW,
  );
});

describe("The setup runner's last deal (D093, ruling 23)", () => {
  it(
    'sends its deal when it deals last, then stops',
    async () => {
      const { rootId, keys, bySeat } = await game3();
      const [s0, s1, s2] = bySeat;
      // Seats 0 and 1 have the game's page open: they shuffle and deal at once.
      const g0 = h.game(rootId, s0.deps);
      const g1 = h.game(rootId, s1.deps);
      await waitFor('the first two shuffle steps', () => g1.view.value?.head.seq === 2, SLOW);
      // Seat 2's player is on Home, on a clock that moves only when the test moves it.
      const c = fakeTime();
      const t = tracking({ ...s2.deps, now: c.now, timers: c.timers });
      const runner = await runnerOn(t.deps, [rootId]);
      const ownLine = (what: 'shuffle' | 'deal'): boolean => {
        const line = runner.lines.value.get(rootId);
        return line?.what === what && line.kind !== 'waiting';
      };
      await waitFor('the runner holding its shuffle for the grace', () => ownLine('shuffle'), SLOW);
      c.at(SETUP_MODE_GRACE_S);
      await onRelay(
        "seat 2's step",
        async () => (await movesBy(rootId, keys[2] as string)).length === 1,
        SLOW,
      );
      // Seats 0 and 1 deal at once, and seat 2's runner holds its deal for the grace: it deals last. Its own deal
      // completes the deal on its client, so its game is in play there before the deal has reached a relay.
      for (const k of [0, 1])
        await onRelay(
          `seat ${k}'s deal`,
          async () => (await sharesBy(rootId, keys[k] as string)).length === 1,
          SLOW,
        );
      await waitFor('the runner holding only its own deal', () => ownLine('deal'), SLOW);
      c.at(2 * SETUP_MODE_GRACE_S);
      // Built and sent within seconds of the grace: a wait this long means the deal is never sent.
      await onRelay(
        "seat 2's deal",
        async () => (await sharesBy(rootId, keys[2] as string)).length === 1,
        60_000,
      );
      for (const g of [g0, g1]) await waitFor('the game in play', () => g.view.value?.phase === 'play', SLOW);
      await waitFor(
        'the deal confirmed',
        () => loadOutbox(s2.deps.storage, s2.name, rootId).get('deal')?.confirmed,
        SLOW,
      );
      // Its work is done once the deal is out: the next look stops the run, for good.
      c.tick();
      await waitFor('the runner done with the game', () => t.live(rootId) === 0, SLOW);
      expect(runner.lines.value.has(rootId)).toBe(false);
      c.tick();
      await pause(500);
      expect(t.built(rootId)).toBe(1);
    },
    SLOW,
  );

  it(
    'takes back a game past its setup whose saved deal no relay has, and sends it',
    async () => {
      const { rootId, keys, bySeat } = await game3();
      const [s0, s1, s2] = bySeat;
      const g0 = h.game(rootId, s0.deps);
      const g1 = h.game(rootId, s1.deps);
      await waitFor('the first two shuffle steps', () => g1.view.value?.head.seq === 2, SLOW);
      // Seat 2 shuffles by hand, and seats 0 and 1 deal.
      const session = await seatSession(rootId, s2, 2);
      const step = session.buildShuffle(rnd, now());
      session.receive(step, now());
      await h.pool().publish(step);
      for (const k of [0, 1])
        await onRelay(
          `seat ${k}'s deal`,
          async () => (await sharesBy(rootId, keys[k] as string)).length === 1,
          SLOW,
        );
      // Seat 2's page closed after its deal was saved and folded in, but before a relay took it: the deal is saved
      // unconfirmed, and the status cached then says the game is in play.
      const deal = session.buildDeal(rnd, now());
      s2.deps.storage.setItem(
        outboxKey(s2.name, rootId),
        JSON.stringify({ deal: { event: deal, confirmed: false, orphan: false } }),
      );
      s2.deps.storage.setItem(
        gameStatusKey(s2.name, rootId),
        JSON.stringify({ status: 'waiting', seq: 3, updatedAt: now(), phase: 'play' }),
      );
      // A page opened later takes the game back and sends the deal.
      const c = fakeTime();
      const t = tracking({ ...s2.deps, now: c.now, timers: c.timers });
      await runnerOn(t.deps, [rootId]);
      await onRelay(
        "seat 2's saved deal",
        async () => (await sharesBy(rootId, keys[2] as string)).some((ev) => ev.id === deal.id),
        60_000,
      );
      for (const g of [g0, g1]) await waitFor('the game in play', () => g.view.value?.phase === 'play', SLOW);
      await waitFor(
        'the deal confirmed',
        () => loadOutbox(s2.deps.storage, s2.name, rootId).get('deal')?.confirmed,
        SLOW,
      );
      c.tick();
      await waitFor('the runner done with the game', () => t.live(rootId) === 0, SLOW);
      expect(t.built(rootId)).toBe(1);
    },
    SLOW,
  );
});

describe("The setup runner's slots (D093, rulings 21 and 22)", () => {
  it(
    'a game that waits on other seats does not count toward the cap',
    async () => {
      // Holler reshuffles in play, so its setup is in seat order: seat 1 owes nothing until seat 0 has shuffled.
      const a = h.profile('a');
      const b = h.profile('b');
      const roots = await games4('holler', a, b);
      const c = fakeTime();
      const t = tracking({ ...b.deps, now: c.now, timers: c.timers });
      const runner = await runnerOn(t.deps, roots);
      await waitFor('every game taken', () => t.running(roots).length === 4, 60_000);
      await waitFor('each waits for seat 0', () =>
        roots.every((id) => runner.lines.value.get(id)?.kind === 'waiting'),
      );
      expect(t.most()).toBe(4);
    },
    SLOW,
  );

  it(
    'an older game waits for a free slot: nothing running is disposed for it',
    async () => {
      const a = h.profile('a');
      const b = h.profile('b');
      const roots = await games4('luster', a, b);
      const c = fakeTime();
      const t = tracking({ ...b.deps, now: c.now, timers: c.timers });
      // The oldest game's page is open: the runner takes the three others, each owing its shuffle (rank 1).
      const release = setupRunnerFor(t.deps).claim(roots[0] as string);
      await runnerOn(t.deps, roots);
      await waitFor('the three younger games', () => t.running(roots).join() === roots.slice(1).join());
      // The page closes: the oldest game is first in line, but every slot is taken.
      release();
      c.tick();
      await pause(1000);
      expect(t.running(roots)).toEqual(roots.slice(1));
      expect(roots.map((id) => t.built(id))).toEqual([0, 1, 1, 1]);
      // A slot frees: the oldest game in line takes it.
      await cancel(roots[1] as string, a);
      await waitFor(
        'the oldest game taken',
        () => t.running(roots).join() === [roots[0], roots[2], roots[3]].join(),
        60_000,
      );
    },
    SLOW,
  );

  it(
    `a game that never loads frees its slot after ${SETUP_LOAD_LIMIT_S} s, and is parked for ${SETUP_PARK_S} s`,
    async () => {
      const a = h.profile('a');
      const b = h.profile('b');
      const roots = await games4('holler', a, b);
      // The three oldest games' roots never reach the runner's controllers (the lobby still has them).
      const c = fakeTime();
      const pool = withoutRoots(b.deps.pool, roots.slice(0, 3));
      const t = tracking({ ...b.deps, pool, now: c.now, timers: c.timers });
      await runnerOn(t.deps, roots);
      await waitFor('the three oldest', () => t.running(roots).join() === roots.slice(0, 3).join());
      c.at(SETUP_LOAD_LIMIT_S - 1);
      c.tick();
      await pause(1000);
      expect(t.running(roots)).toEqual(roots.slice(0, 3));
      c.at(SETUP_LOAD_LIMIT_S);
      await waitFor('the fourth taken', () => t.running(roots).join() === roots[3], 60_000);
      // Parked: free slots do not bring them back before their time.
      c.at(SETUP_LOAD_LIMIT_S + SETUP_PARK_S - 1);
      c.tick();
      await pause(1000);
      expect(roots.map((id) => t.built(id))).toEqual([1, 1, 1, 1]);
      c.at(SETUP_LOAD_LIMIT_S + SETUP_PARK_S);
      c.tick();
      await waitFor('the parked games taken again', () => roots.slice(0, 3).every((id) => t.built(id) === 2));
    },
    SLOW,
  );

  it('takes games in line by root date, then by root id', () => {
    const games = [
      { rootId: 'b'.repeat(64), rootAt: 5 },
      { rootId: 'c'.repeat(64), rootAt: 4 },
      { rootId: 'a'.repeat(64), rootAt: 5 },
    ];
    expect([...games].sort(inLine).map((g) => g.rootId[0])).toEqual(['c', 'a', 'b']);
  });
});

describe('setupLineText', () => {
  it('gives each line its exact copy', () => {
    const huy = 'a'.repeat(64);
    const ann = 'b'.repeat(64);
    const names = (npub: string): string => (npub === huy ? 'Huy' : npub === ann ? 'Ann' : npub);
    expect(setupLineText({ kind: 'shuffling', who: [], what: 'shuffle' }, names)).toBe(
      'Shuffling your part…',
    );
    expect(setupLineText({ kind: 'dealing', who: [], what: 'deal' }, names)).toBe('Dealing…');
    expect(setupLineText({ kind: 'waiting', who: [huy, ann], what: 'shuffle' }, names)).toBe(
      'Waiting for Huy and Ann to shuffle',
    );
    expect(setupLineText({ kind: 'waiting', who: [huy], what: 'deal' }, names)).toBe(
      'Waiting for Huy to deal',
    );
  });
});
