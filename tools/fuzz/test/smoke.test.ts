import { fuzzBatch } from '@bored-games/game-kit';
import { expect, it } from 'vitest';
import { TARGETS } from '../src/index.ts';

it('tilestock: a few hundred fuzzed games keep every invariant', () => {
  const target = TARGETS.tilestock;
  if (!target) throw new Error('tilestock target missing');
  const report = fuzzBatch(target.module, {
    seed: 'vitest-smoke',
    games: 150,
    seatCounts: target.defaultSeatCounts,
    rules: target.module.defaultRules(),
    policies: target.policies,
    ...(target.deckOrder ? { deckOrder: target.deckOrder } : {}),
  });
  expect(report.failures).toEqual([]);
  expect(report.games).toBe(150);
  expect(report.coverage['end:declared']).toBeGreaterThan(0);
  expect(report.coverage['merger:3way']).toBeGreaterThan(0);
});
