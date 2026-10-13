import { type FuzzPolicy, fuzzBatch, packetOrder, uniformPolicy } from '@bored-games/game-kit';
import { expect, it } from 'vitest';
import { sticksAndStones } from '../src/module.ts';
import type { SticksAction, SticksState } from '../src/types.ts';

/** A builder: buys and builds whenever it can, else a random legal move. */
const builder: FuzzPolicy<SticksState> = {
  name: 'builder',
  choose: (_s, _seat, legal, rng) => {
    const all = legal as SticksAction[];
    const buys = all.filter((a) => a.type === 'buy' || a.type === 'build');
    return buys.length > 0 && rng.int(4) > 0 ? rng.pick(buys) : rng.pick(all);
  },
};

it('fuzzed games keep every invariant, views agree, and every game ends', { timeout: 600_000 }, () => {
  const report = fuzzBatch(sticksAndStones, {
    seed: 'sticks-smoke',
    games: 6,
    seatCounts: [2, 3, 4],
    rules: sticksAndStones.defaultRules(),
    policies: [builder, uniformPolicy as FuzzPolicy<SticksState>],
    maxSteps: 20_000,
    deckOrder: packetOrder,
  });
  expect(report.failures).toEqual([]);
  expect(report.games).toBe(6);
});
