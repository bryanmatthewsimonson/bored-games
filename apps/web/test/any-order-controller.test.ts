/*
 * The web controller in an any-order setup (D093): the stagger of a shuffle duty's rank, the deal's settle while a
 * rival setup step is held, and the deal race between two controllers of one seat. Chain Reaction, 3 seats, against
 * the real dev relay. A controller under test runs on an injected clock and timers (`fakeTime`); the others run on
 * the platform's.
 */
import { GameSession } from '@bored-games/client';
import { KIND, type NostrEvent, parseRoot } from '@bored-games/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { platformTimers, type Timers } from '../src/clock.ts';
import type { GameController, GameStatus } from '../src/game-controller.ts';
import { bytesToHex } from '../src/hex.ts';
import { MODULES, type PoolLike } from '../src/net.ts';
import { loadSecrets } from '../src/storage.ts';
import { Harness, now, type Profile, pause, rnd, waitFor } from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

/** A Chain Reaction shuffle step takes seconds to prove and check, on every controller. */
const SLOW = 300_000;

/**
 * An injected clock (Unix s) from `start`, and timers: `later` runs a wait under a second (a yield) on the platform's
 * timers and holds a longer one (a wake, or the check before signing's cap) until `at` brings the clock to its time,
 * or drops it while `dropWakes` is set. `every` (the 30 s tick) never fires by itself: the test calls `tick`.
 */
function fakeTime(start = now()) {
  const wakes: { at: number; fn: () => void; live: boolean }[] = [];
  const ticks: { fn: () => void; live: boolean }[] = [];
  const c = {
    start,
    t: start,
    dropWakes: false,
    now: (): number => c.t,
    timers: {
      later(ms: number, fn: () => void): () => void {
        if (ms < 1000) return platformTimers.later(ms, fn);
        const w = { at: c.t + ms / 1000, fn, live: true };
        if (!c.dropWakes) wakes.push(w);
        return () => {
          w.live = false;
        };
      },
      every(_ms: number, fn: () => void): () => void {
        const e = { fn, live: true };
        ticks.push(e);
        return () => {
          e.live = false;
        };
      },
    } satisfies Timers,
    /** Set the clock to `start + s` and fire the held timers due by then. */
    at(s: number): void {
      c.t = start + s;
      for (const w of wakes.splice(0)) {
        if (!w.live) continue;
        if (w.at <= c.t) w.fn();
        else wakes.push(w);
      }
    },
    /** The 30 s tick of every live controller on this clock. */
    tick(): void {
      for (const e of ticks) if (e.live) e.fn();
    },
  };
  return c;
}

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
      c.at(15);
      await onRelay("seat 0's deal", async () => (await sharesBy(rootId, keys[0] as string)).length === 1);
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
