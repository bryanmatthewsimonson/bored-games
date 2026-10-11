/*
 * A game's automatic move (opt-in; Right of Way's forced sift and Room for Doubt's lone none), through real controllers
 * over the dev relay. The controller sends what the game's hook picks from the seat's legal actions as soon as the
 * decision is the seat's, at most once per head; one that fails is tried again on the next tick, never in a loop.
 * A game with no hook sends nothing by itself, and two open devices of one seat send one event between them. Chess
 * stands in for any game: the test's own hooks play 1. e4 and 1... e5. The controllers never tick by themselves
 * here: the test calls `tick()`.
 */
import { KIND, type NostrEvent } from '@bored-games/protocol';
import type { EoseInfo } from '@bored-games/relay';
import { type RowState, rightOfWay } from '@bored-games/right-of-way';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { platformTimers, type Timers } from '../src/clock.ts';
import { type AutoMove, GameController } from '../src/game-controller.ts';
import { webGame } from '../src/games/registry.ts';
import type { PoolLike } from '../src/net.ts';
import { Harness, pause, waitFor } from './net-harness.ts';

/** Timers that never tick by themselves: `later` runs as on the platform, `every` never fires. */
const NO_TICKS: Timers = { later: platformTimers.later, every: () => () => {} };

/** The test's hooks: White's 1. e4 and Black's 1... e5, whenever they are legal. */
const playing =
  (actor: number, uci: string): AutoMove =>
  (legal) =>
    legal.find((a) => (a as { uci?: unknown }).uci === uci && (a as { actor?: unknown }).actor === actor) ??
    null;
const playE4 = playing(0, 'e2e4');
const playE5 = playing(1, 'e7e5');

/**
 * A pool whose check before signing (D059 item 2: this seat's moves on the head, asked with no `limit`) can be held:
 * while `hold` is set, that query's EOSE says that no relay answered, so `act` refuses to sign. `checks` counts those
 * queries, one per attempt to send a move.
 */
function heldChecks(real: PoolLike) {
  const net = {
    hold: false,
    checks: 0,
    pool: {
      subscribe: (filters, onEvent, onEose, opts) => {
        const check = filters.some(
          (f) => f.kinds?.includes(KIND.move) === true && f.limit === undefined && f.authors?.length === 1,
        );
        if (check) net.checks++;
        const held = check && net.hold;
        return real.subscribe(
          filters,
          onEvent,
          onEose && ((info: EoseInfo) => onEose(held ? { ...info, eosedUrls: [] } : info)),
          opts,
        );
      },
      publish: (ev: NostrEvent, urls?: readonly string[]) => real.publish(ev, urls),
      addRelays: (urls: readonly string[]) => real.addRelays?.(urls),
    } as PoolLike,
  };
  return net;
}

/** A device whose uploads take `ms` to reach the relays; `moves` lists the moves it sent. */
function slowUploads(real: PoolLike, ms: number) {
  const net = {
    moves: [] as string[],
    pool: {
      subscribe: (filters, onEvent, onEose, opts) => real.subscribe(filters, onEvent, onEose, opts),
      publish: async (ev: NostrEvent, urls?: readonly string[]) => {
        if (ev.kind === KIND.move) net.moves.push(ev.id);
        await pause(ms);
        return real.publish(ev, urls);
      },
      addRelays: (urls: readonly string[]) => real.addRelays?.(urls),
    } as PoolLike,
  };
  return net;
}

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.setup();
});
afterEach(async () => {
  await h.teardown();
});

/**
 * A started 2-seat Chess game. White's controller is built with `autoMove` (the screen passes the registry's lookup)
 * over a pool whose checks can be held, and is not started yet; Black's is.
 */
async function chess(autoMove: ((game: string) => AutoMove | undefined) | undefined) {
  const { rootId, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
  const [white, black] = bySeat;
  const net = heldChecks(white.deps.pool);
  const deps = { ...white.deps, pool: net.pool, timers: NO_TICKS };
  const w = new GameController(rootId, deps, autoMove === undefined ? {} : { autoMove });
  h.later(() => w.dispose());
  const b = new GameController(rootId, { ...black.deps, timers: NO_TICKS });
  h.later(() => b.dispose());
  b.start();
  return { w, b, net };
}

/**
 * A focused Right of Way fixture at a reshuffled blind draw, using the real engine and encrypted card shares.
 * Singleton spare partitions fix the sift cards; only the first 113 positions are needed here. Card 110 is a keep,
 * 111 a skip, with one discard in the reshuffle. The skip deals position 112, so the next card can be learned too.
 * Conservation and full packet shuffles are covered by the engine/session tests and the full-game e2e.
 */
async function rightOfWaySift(card: 110 | 111) {
  const module = {
    ...rightOfWay,
    decks: () => [
      {
        id: 'rail',
        size: 113,
        promptShares: true,
        partitions: [
          ...Array.from({ length: 11 }, (_, i) => ({ id: `freight-${i}`, size: 10 })),
          ...[110, 111, 112].map((i) => ({ id: `card-${i}`, size: 1 })),
        ],
      },
    ],
    setup: (input: Parameters<typeof rightOfWay.setup>[0]) => {
      const result = rightOfWay.setup({
        rules: input.rules,
        seats: input.seats,
        mode: 'view',
        viewer: input.mode === 'view' ? input.viewer : null,
      });
      if (!result.ok) return result;
      return {
        ok: true as const,
        value: {
          ...result.value,
          dealt: [{ deck: 'rail', pos: card, to: 0 }],
          yard: [null, null, null, null, null],
          want: [],
          players: result.value.players.map((p) => ({ ...p, hand: [], offered: [] })),
          charterPile: [],
          startingSeat: 0,
          turn: 0,
          phase: 'sift' as const,
          kept: 2,
          drawn: 1,
          sift: { pos: card, card: null },
          pile: { group: 1, next: card + 1, members: 1, found: 0 },
          epochs: [{ group: 1, list: [0] }],
        },
      };
    },
  };
  const profiles = [h.profile('a'), h.profile('b')] as const;
  for (const p of profiles) p.deps.modules = new Map([[module.id, module]]);
  const game = await h.start2('right-of-way', profiles[0], profiles[1]);
  // Finish the automatic shuffle/deal/share duties before attaching the held check or the two slow devices.
  const controllers = game.bySeat.map((p) => h.game(game.rootId, { ...p.deps, timers: NO_TICKS }));
  await waitFor('the learned forced sift', () => controllers[0]?.legal.value.length === 1, 30_000);
  await waitFor('both seats in play', () => controllers.every((c) => c.view.value?.phase === 'play'));
  const head = controllers[0]?.view.value?.head;
  if (head === undefined) throw new Error('the drawer has no head');
  for (const c of controllers) c.dispose();
  // Exercise the registry hook on the fixture's first sift only; a skip leaves another forced sift at seq 1.
  const autoMove = (id: string): AutoMove | undefined => {
    const pick = webGame(id)?.autoMove;
    return (
      pick && ((legal, state, seat) => ((state as RowState).seq === 0 ? pick(legal, state, seat) : null))
    );
  };
  return { ...game, autoMove, head };
}

describe('GameController automatic moves (opt-in)', () => {
  it('retries a Right of Way forced sift only on the next tick after a failed send', async () => {
    const { rootId, bySeat, autoMove, head } = await rightOfWaySift(110);
    const [drawer, other] = bySeat;
    const net = heldChecks(drawer.deps.pool);
    net.hold = true;
    const d = new GameController(rootId, { ...drawer.deps, pool: net.pool, timers: NO_TICKS }, { autoMove });
    const o = new GameController(rootId, { ...other.deps, timers: NO_TICKS });
    for (const c of [d, o]) {
      h.later(() => c.dispose());
      c.start();
    }
    await waitFor('the forced sift', () => d.status.value === 'your-turn' && d.legal.value.length === 1);
    expect(d.legal.value).toEqual([{ type: 'sift', actor: 0, card: null }]);
    await waitFor('the failed sift', () => d.error.value?.includes('not every relay has answered'), 5000);
    expect(d.view.value?.head).toEqual(head);
    await pause(1500);
    expect(net.checks).toBe(1);
    net.hold = false;
    // Even after the relay recovers, a refresh must not retry before tick().
    await pause(500);
    expect(net.checks).toBe(1);
    d.tick();
    await waitFor('the retried sift at both seats', () =>
      [d, o].every((c) => c.view.value?.head.seq === head.seq + 1),
    );
    expect(net.checks).toBe(2);
    expect(d.error.value).toBeNull();
    d.tick();
    await pause(500);
    expect(net.checks).toBe(2);
  }, 60_000);

  it.each([110, 111] as const)(
    'two devices send one Right of Way forced sift event for card %s, with clocks a second apart',
    async (card) => {
      const { rootId, address, bySeat, autoMove, head } = await rightOfWaySift(card);
      const [drawer, other] = bySeat;
      // Load both devices before releasing the automatic move, as White's e4 does in the Chess test below.
      let armed = false;
      const lookup = (id: string): AutoMove | undefined => {
        const pick = autoMove(id);
        return pick && ((legal, state, seat) => (armed ? pick(legal, state, seat) : null));
      };
      const phoneNet = slowUploads(drawer.deps.pool, 300);
      const phone = new GameController(
        rootId,
        { ...drawer.deps, pool: phoneNet.pool, timers: NO_TICKS },
        { autoMove: lookup },
      );
      const second = h.secondDevice(drawer, address);
      const tabletNet = slowUploads(second.deps.pool, 300);
      const tablet = new GameController(
        rootId,
        {
          ...second.deps,
          modules: drawer.deps.modules,
          pool: tabletNet.pool,
          now: () => second.deps.now() + 1,
          timers: NO_TICKS,
        },
        { autoMove: lookup },
      );
      const o = new GameController(rootId, { ...other.deps, timers: NO_TICKS });
      for (const c of [phone, tablet, o]) {
        h.later(() => c.dispose());
        c.start();
      }
      await waitFor('every device loaded the sift', () =>
        [phone, tablet].every((c) => c.status.value === 'your-turn' && c.legal.value.length === 1),
      );
      armed = true;
      phone.tick();
      tablet.tick();
      await waitFor(
        'a sift from each device',
        () => phoneNet.moves.length > 0 && tabletNet.moves.length > 0,
        5000,
      );
      expect(tabletNet.moves).toEqual(phoneNet.moves);
      await waitFor('the sift at every device', () =>
        [phone, tablet, o].every((c) => c.view.value?.head.seq === head.seq + 1),
      );
      const events = await h.query([{ kinds: [KIND.move], '#e': [rootId] }]);
      const sift = events.find((ev) => ev.id === phoneNet.moves[0]);
      const parent = (await h.query([{ ids: [head.id] }]))[0];
      if (sift === undefined || parent === undefined) throw new Error('the sift or its parent is missing');
      expect(sift.created_at).toBe(parent.created_at);
      expect(JSON.parse(sift.content).action).toEqual({
        type: 'sift',
        actor: 0,
        card: card === 110 ? null : card,
      });
      await pause(1000);
      for (const c of [phone, tablet, o]) expect(c.view.value?.equivocators).toEqual([]);
    },
    60_000,
  );

  it('sends the move at once, and after a failed send tries again on the next tick, never before it', async () => {
    const { w, b, net } = await chess((game) => (game === 'chess' ? playE4 : undefined));
    // Not every relay answers the check before signing: the first send fails, as `act` does for a player.
    net.hold = true;
    w.start();
    await waitFor('the first try', () => net.checks >= 1, 20_000);
    await waitFor('the error', () => w.error.value?.includes('not every relay has answered'));
    expect(w.view.value?.head.seq).toBe(0);
    // The refreshes after the failure do not send it again: only the tick does.
    await pause(1500);
    expect(net.checks).toBe(1);
    expect(w.status.value).toBe('your-turn');
    // The next tick tries again, the relays answer now, and the move goes out.
    net.hold = false;
    w.tick();
    await waitFor('1. e4 at White', () => w.view.value?.head.seq === 1, 20_000);
    expect(net.checks).toBe(2);
    expect(w.error.value).toBeNull();
    await waitFor('1. e4 at Black', () => b.view.value?.head.seq === 1, 20_000);
    // Black's decision is Black's own: White sends nothing more, and a tick changes nothing.
    w.tick();
    await pause(500);
    expect(net.checks).toBe(2);
    expect(w.view.value?.head.seq).toBe(1);
  }, 60_000);

  it.each([
    ['the registry, which has no hook for Chess', (game: string) => webGame(game)?.autoMove],
    ['no lookup at all', undefined],
  ])(
    'sends nothing by itself for a game with no hook: %s',
    async (_name, autoMove) => {
      const { w, net } = await chess(autoMove);
      w.start();
      await waitFor("White's decision", () => w.status.value === 'your-turn' && w.legal.value.length > 0);
      await pause(1000);
      w.tick();
      await pause(500);
      expect(net.checks).toBe(0);
      expect(w.view.value?.head.seq).toBe(0);
      expect(w.status.value).toBe('your-turn');
      expect(w.error.value).toBeNull();
    },
    60_000,
  );

  it('two open devices of the seat send one event between them, with clocks a second apart', async () => {
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white, black] = bySeat;
    const autoMove = (game: string) => (game === 'chess' ? playE5 : undefined);
    const w = new GameController(rootId, { ...white.deps, timers: NO_TICKS });
    h.later(() => w.dispose());
    // Black's phone and tablet: each upload takes 300 ms, so both checks before signing are clear before either
    // move reaches the relay, and the tablet's clock is a second ahead of the phone's.
    const phoneNet = slowUploads(black.deps.pool, 300);
    const phone = new GameController(
      rootId,
      { ...black.deps, pool: phoneNet.pool, timers: NO_TICKS },
      { autoMove },
    );
    h.later(() => phone.dispose());
    const second = h.secondDevice(black, address);
    const tabletNet = slowUploads(second.deps.pool, 300);
    const tabletDeps = {
      ...second.deps,
      pool: tabletNet.pool,
      now: () => second.deps.now() + 1,
      timers: NO_TICKS,
    };
    const tablet = new GameController(rootId, tabletDeps, { autoMove });
    h.later(() => tablet.dispose());
    for (const c of [w, phone, tablet]) c.start();
    await waitFor('every device loaded', () => [w, phone, tablet].every((c) => c.status.value !== 'syncing'));
    await waitFor("White's turn", () => w.status.value === 'your-turn');
    await w.act({ type: 'move', actor: 0, uci: 'e2e4' });
    await waitFor('1... e5 at White', () => w.view.value?.head.seq === 2, 20_000);
    await waitFor(
      'a send from each device',
      () => phoneNet.moves.length > 0 && tabletNet.moves.length > 0,
      10_000,
    );
    // Dated at the head, as the automatic duties are (D063): the two devices signed one event, not two rival moves.
    expect(tabletNet.moves).toEqual(phoneNet.moves);
    await pause(1000);
    for (const c of [w, phone, tablet]) expect(c.view.value?.equivocators).toEqual([]);
  }, 60_000);
});
