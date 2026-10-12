import { fuzzBatch } from '@bored-games/game-kit';
import { expect, it } from 'vitest';
import { TARGETS } from '../src/index.ts';

/*
 * Hazard (D088): fuzzed three-seat games, views checked, all ending by conquest, with captured charters re-dealt.
 * Bigger tables, and the reshuffle and cash-down coverage, are the CLI's (`pnpm fuzz --game hazard`): late sets pay
 * hundreds of troops and battles of hundreds take as many rolls, too long for every run of the suite.
 */
it('hazard: fuzzed games keep every invariant and all end by conquest', { timeout: 600_000 }, () => {
  const target = TARGETS.hazard;
  if (!target) throw new Error('hazard target missing');
  const report = fuzzBatch(target.module, {
    seed: 'vitest-smoke',
    games: 4,
    seatCounts: [3],
    rules: target.module.defaultRules(),
    policies: target.policies,
    ...(target.maxSteps !== undefined ? { maxSteps: target.maxSteps } : {}),
  });
  expect(report.failures).toEqual([]);
  expect(report.games).toBe(4);
  expect(report.coverage['end:conquest']).toBeGreaterThanOrEqual(4);
  expect(report.coverage['move:transfer']).toBeGreaterThan(0);
});

it('hazard: the CLI gives its games a longer step limit', () => {
  expect(TARGETS.hazard?.maxSteps).toBe(150_000);
  expect(TARGETS.hazard?.simDeadline).toBe(3 * 86400);
});
