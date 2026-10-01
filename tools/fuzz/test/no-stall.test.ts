import { fuzzGame } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { TARGETS } from '../src/index.ts';

const target = TARGETS['chain-reaction'];
if (!target) throw new Error('chain-reaction target missing');

/**
 * Seeds that stalled in the first checkpoint-1 run (game i has 3 + i % 4 seats).
 * There is no stall ending any more; a game that never ends fails the fuzzer's
 * "no termination" check instead.
 */
const STALLED = [12, 13, 48, 55, 57, 66];

describe('games always end by declaration', () => {
  it.each(STALLED)('checkpoint-1#%i, which used to stall, ends by declaration', (i) => {
    const report = fuzzGame(target.module, {
      seed: `checkpoint-1#${i}`,
      seats: 3 + (i % 4),
      rules: target.module.defaultRules(),
      policies: target.policies,
      ...(target.deckOrder ? { deckOrder: target.deckOrder } : {}),
      ...(target.checkOutcome ? { checkOutcome: target.checkOutcome } : {}),
      checkViews: false,
    });
    expect(report.failure).toBeNull();
    expect(report.outcome?.reason).toBe('declared');
  });
});
