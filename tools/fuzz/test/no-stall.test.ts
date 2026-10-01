import { fuzzGame } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { TARGETS } from '../src/index.ts';

const target = TARGETS.tilestock;
if (!target) throw new Error('tilestock target missing');

/** Seeds that stalled in the checkpoint-1 run (game i has 3 + i % 4 seats). */
const STALLED = [12, 13, 48, 55, 57, 66];

describe('games never stall', () => {
  it('the tilestock target reports any stalled game as a failure', () => {
    expect(target.checkOutcome?.({ places: [1, 2, 3], scores: [0, 0, 0], reason: 'stall' })).toMatch(/stall/);
    expect(target.checkOutcome?.({ places: [1, 2, 3], scores: [0, 0, 0], reason: 'declared' })).toBeNull();
  });

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
