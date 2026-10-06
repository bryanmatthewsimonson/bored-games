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

it('bank: a few hundred fuzzed games keep every invariant', () => {
  const target = TARGETS.bank;
  if (!target) throw new Error('bank target missing');
  const report = fuzzBatch(target.module, {
    seed: 'vitest-smoke',
    games: 200,
    seatCounts: target.defaultSeatCounts,
    rules: target.module.defaultRules(),
    policies: target.policies,
  });
  expect(report.failures).toEqual([]);
  expect(report.games).toBe(200);
  expect(report.coverage['end:score']).toBeGreaterThan(0);
  expect(report.coverage['roll:bust']).toBeGreaterThan(0);
  expect(report.coverage['bank:shared']).toBeGreaterThan(0);
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

it('right-of-way: fuzzed games keep every invariant and end on the line', () => {
  const target = TARGETS['right-of-way'];
  if (!target) throw new Error('right-of-way target missing');
  const report = fuzzBatch(target.module, {
    seed: 'vitest-smoke',
    games: 120,
    seatCounts: target.defaultSeatCounts,
    rules: target.module.defaultRules(),
    policies: target.policies,
    ...(target.deckOrder ? { deckOrder: target.deckOrder } : {}),
  });
  expect(report.failures).toEqual([]);
  expect(report.games).toBe(120);
  expect(report.coverage['end:line']).toBe(120);
  expect(report.coverage['charters:redealt']).toBeGreaterThan(0);
  expect(report.coverage['sift:skip']).toBeGreaterThan(0);
  expect(report.coverage['pile:stuck']).toBeUndefined();
});
