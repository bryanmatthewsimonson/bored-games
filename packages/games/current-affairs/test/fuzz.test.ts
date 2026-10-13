import { type FuzzPolicy, fuzzBatch, uniformPolicy } from '@bored-games/game-kit';
import { expect, it } from 'vitest';
import { currentAffairs } from '../src/module.ts';
import type { CurrentAction, CurrentState } from '../src/types.ts';

/** A builder: opens cheap, fuels up, wires whenever it can and fires everything; else a random legal move. */
export const builder: FuzzPolicy<CurrentState> = {
  name: 'builder',
  choose: (_s, _seat, legal, rng) => {
    const all = legal as CurrentAction[];
    if (rng.int(6) === 0) return rng.pick(all);
    const build = all.filter((a) => a.type === 'build');
    if (build.length > 0) return build[0];
    const fuel = all.filter((a) => a.type === 'fuel');
    if (fuel.length > 0) return fuel[0];
    const power = all.filter((a) => a.type === 'power');
    if (power.length > 0) return power.at(-1);
    const open = all.filter((a) => a.type === 'open');
    if (open.length > 0) return rng.pick(open);
    return rng.pick(all);
  },
};

it('fuzzed games keep every invariant, views agree, and every game ends', { timeout: 600_000 }, () => {
  const report = fuzzBatch(currentAffairs, {
    seed: 'current-smoke',
    games: 10,
    seatCounts: [2, 3, 4, 5, 6],
    rules: currentAffairs.defaultRules(),
    policies: [builder, uniformPolicy as FuzzPolicy<CurrentState>],
    maxSteps: 40_000,
  });
  expect(report.failures).toEqual([]);
  expect(report.games).toBe(10);
});
