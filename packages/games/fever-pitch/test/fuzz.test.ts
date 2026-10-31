import { type FuzzPolicy, fuzzBatch, packetOrder, uniformPolicy } from '@bored-games/game-kit';
import { expect, it } from 'vitest';
import { feverPitch } from '../src/module.ts';
import type { FeverAction, FeverState } from '../src/types.ts';

/** A medic at heart: cures whenever it can, treats where it stands, passes windows, else a random legal move. */
export const healer: FuzzPolicy<FeverState> = {
  name: 'healer',
  choose: (_s, _seat, legal, rng) => {
    const all = legal as FeverAction[];
    if (rng.int(5) === 0) return rng.pick(all);
    for (const type of ['cure', 'treat', 'pass', 'arrange'] as const) {
      const some = all.filter((a) => a.type === type);
      if (some.length > 0) return some[0];
    }
    const quiet = all.filter((a) => a.type !== 'end' && a.type !== 'medevac' && a.type !== 'charter');
    return rng.pick(quiet.length > 0 ? quiet : all);
  },
};

it('fuzzed games keep every invariant, views agree, and every game ends', { timeout: 600_000 }, () => {
  for (const surges of [4, 5, 6] as const) {
    const report = fuzzBatch(feverPitch, {
      seed: `spread-smoke-${surges}`,
      games: 6,
      seatCounts: [2, 3, 4],
      rules: { rulesVersion: 1, surges },
      policies: [healer, uniformPolicy as FuzzPolicy<FeverState>],
      maxSteps: 20_000,
      deckOrder: packetOrder,
    });
    expect(report.failures).toEqual([]);
    expect(report.games).toBe(6);
  }
});
