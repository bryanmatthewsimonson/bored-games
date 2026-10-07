/*
 * A game's automatic move (opt-in; Room for Doubt's lone none, D078 ruling 7 as amended), through real controllers
 * over the dev relay. The controller sends what the game's hook picks from the seat's legal actions as soon as the
 * decision is the seat's, at most once per head; one that fails is tried again on the next tick, never in a loop.
 * A game with no hook sends nothing by itself. Chess stands in for any game: the test's own hook plays White's
 * 1. e4. The controllers never tick by themselves here: the test calls `tick()`.
 */
import { KIND, type NostrEvent } from '@bored-games/protocol';
import type { EoseInfo } from '@bored-games/relay';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { platformTimers, type Timers } from '../src/clock.ts';
import { type AutoMove, GameController } from '../src/game-controller.ts';
import { webGame } from '../src/games/registry.ts';
import type { PoolLike } from '../src/net.ts';
import { Harness, pause, waitFor } from './net-harness.ts';

/** Timers that never tick by themselves: `later` runs as on the platform, `every` never fires. */
const NO_TICKS: Timers = { later: platformTimers.later, every: () => () => {} };

/** The test's hook: White's 1. e4, whenever it is legal. */
const playE4: AutoMove = (legal) =>
  legal.find((a) => (a as { uci?: unknown }).uci === 'e2e4' && (a as { actor?: unknown }).actor === 0) ??
  null;

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

describe('GameController automatic moves (opt-in)', () => {
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
});
