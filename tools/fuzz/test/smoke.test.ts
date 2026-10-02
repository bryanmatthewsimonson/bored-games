import { fuzzBatch } from '@bored-games/game-kit';
import { expect, it } from 'vitest';
import { TARGETS } from '../src/index.ts';

it('chain-reaction: a few hundred fuzzed games keep every invariant', () => {
  const target = TARGETS['chain-reaction'];
  if (!target) throw new Error('chain-reaction target missing');
  const report = fuzzBatch(target.module, {
    seed: 'vitest-smoke',
    games: 150,
    seatCounts: target.defaultSeatCounts,
    rules: target.module.defaultRules(),
    policies: target.policies,
    ...(target.deckOrder ? { deckOrder: target.deckOrder } : {}),
    ...(target.checkOutcome ? { checkOutcome: target.checkOutcome } : {}),
  });
  expect(report.failures).toEqual([]);
  expect(report.games).toBe(150);
  expect(report.coverage['end:declared']).toBeGreaterThan(0);
  expect(report.coverage['merger:3way']).toBeGreaterThan(0);
});

it('chess: fuzzed games keep every invariant and all end', () => {
  const target = TARGETS.chess;
  if (!target) throw new Error('chess target missing');
  const report = fuzzBatch(target.module, {
    seed: 'vitest-smoke',
    games: 80,
    seatCounts: target.defaultSeatCounts,
    rules: target.module.defaultRules(),
    policies: target.policies,
  });
  expect(report.failures).toEqual([]);
  expect(report.games).toBe(80);
  expect(report.coverage['end:checkmate']).toBeGreaterThan(0);
  expect(report.coverage['draw:declined']).toBeGreaterThan(0);
});
