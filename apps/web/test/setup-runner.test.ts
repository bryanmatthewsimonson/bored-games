/*
 * The setup runner (D093): a page service that does this seat's setup shuffle and deal from any page of the app, so
 * a game no longer strands when its players never have its page open at once. It takes the oldest games first, at
 * most `SETUP_RUNNER_MAX` at once, only those whose keys are in this browser and whose setup is not over, hands a game
 * to its page while that page is open, and stops once this seat's setup work is done. Chain Reaction (3 seats) where
 * the runner shuffles and deals, Luster (2 seats) where it only waits, against the real dev relay.
 */
import { GameSession } from '@bored-games/client';
import { KIND, type NostrEvent, parseRoot } from '@bored-games/protocol';
import type { Filter } from '@bored-games/relay';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOutbox } from '../src/game-controller.ts';
import { bytesToHex } from '../src/hex.ts';
import { lobbyFor } from '../src/lobby-hooks.ts';
import { type ControllerDeps, MODULES, type PoolLike } from '../src/net.ts';
import {
  SETUP_RUNNER_MAX,
  type SetupLine,
  type SetupRunner,
  setupLineText,
  setupRunnerFor,
} from '../src/setup-runner.ts';
import {
  addToTableList,
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
  const { rootId, bySeat } = await h.start3('chain-reaction', [
    h.profile('a'),
    h.profile('b'),
    h.profile('c'),
  ]);
  const { root } = await rootOf(rootId);
  return { rootId, keys: root.seats.map((s) => s.session), bySeat: bySeat as [Profile, Profile, Profile] };
}

describe('The setup runner (D093)', () => {
  it(
    'shuffles from Home',
    async () => {
      const { rootId, keys, bySeat } = await game3();
      const [s0, s1, s2] = bySeat;
      h.game(rootId, s0.deps);
      await onRelay("seat 0's step", async () => (await movesBy(rootId, keys[0] as string)).length === 1);
      // Seat 1's player is on Home: no game page, only the page's setup runner.
      const runner = await runnerOn(s1.deps, [rootId]);
      const seen = linesOf(runner, rootId);
      await onRelay("seat 1's step", async () => (await movesBy(rootId, keys[1] as string)).length === 1);
      const waiting: SetupLine = { kind: 'waiting', who: [s2.deps.signer.pubkey], what: 'shuffle' };
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
      const t = tracking(s1.deps);
      const runner = await runnerOn(t.deps, [rootId]);
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
      const waiting: SetupLine = { kind: 'waiting', who: [s2.deps.signer.pubkey], what: 'shuffle' };
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
      const roots: string[] = [];
      for (let i = 0; i < 4; i++) {
        // Roots a second apart, so their dates order them.
        if (i > 0) await pause(1100);
        roots.push((await h.start2('luster', a, b)).rootId);
      }
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
      const t = tracking(s1.deps);
      const runner = await runnerOn(t.deps, [rootId]);
      await onRelay("seat 1's step", async () => (await movesBy(rootId, keys[1] as string)).length === 1);
      // Seat 2 shuffles by hand and never deals: the setup stays in the deal.
      const session = await seatSession(rootId, s2, 2);
      await h.pool().publish(session.buildShuffle(rnd, now()));
      await onRelay(
        "seat 1's deal",
        async () => (await sharesBy(rootId, keys[1] as string)).length === 1,
        SLOW,
      );
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
