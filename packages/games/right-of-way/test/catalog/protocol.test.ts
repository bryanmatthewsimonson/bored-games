import { deepFreeze, fuzzBatch, fuzzGame } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { rightOfWay } from '../../src/module.ts';
import { act, legal, orderWith, railOrder, started } from '../helpers.ts';

describe('protocol', () => {
  it('C37 malformed input is rejected without throwing or mutating; every listed action applies', () => {
    const s = deepFreeze(started(3, orderWith()));
    const junk: unknown[] = [
      null,
      7,
      'take',
      [],
      {},
      { type: 'take', actor: 0 },
      { type: 'take', actor: 0, slot: 1, extra: 1 },
      { type: 'take', actor: -1, slot: 0 },
      { type: 'take', actor: 0, slot: 1.5 },
      {
        type: 'claim',
        actor: 0,
        route: 2,
        side: 0,
        pay: [
          [3, 3],
          [1, 1],
          [2, 2],
        ],
      },
      { type: 'claim', actor: 0, route: 999, side: 0, pay: [] },
      { type: 'keep', actor: 0, keep: [1, 0] },
      { type: 'sift', actor: 0, card: 'x' },
      { type: 'reveal', actor: 'deck', deck: 'rail', pos: 0, card: 0 },
      { type: 'pass', actor: 0 },
      Object.defineProperty({}, 'type', {
        get() {
          throw new Error('hostile');
        },
        enumerable: true,
      }),
    ];
    for (const a of junk) {
      expect(() => rightOfWay.apply(s, a)).not.toThrow();
      expect(rightOfWay.apply(s, a).ok).toBe(false);
      expect(() => rightOfWay.revealsOf(s, a)).not.toThrow();
    }
    for (const a of legal(s)) expect(rightOfWay.apply(s, a).ok).toBe(true);
    expect(rightOfWay.validateRules({ map: 'ferrovia', extra: 1 }).ok).toBe(false);
    expect(act(s, legal(s)[0]).seq).toBeGreaterThan(s.seq);
  });

  it('C38 every view folds the same public state; private cards only through learn; reveals match the deck', () => {
    for (const seats of [2, 3, 4, 5]) {
      const r = fuzzGame(rightOfWay, {
        seed: `views-${seats}`,
        seats,
        rules: rightOfWay.defaultRules(),
        deckOrder: railOrder,
        checkViews: true,
      });
      expect(r.failure).toBeNull();
    }
  });

  it('C39 games end by declaration at every seat count', () => {
    const report = fuzzBatch(rightOfWay, {
      seed: 'ends',
      games: 40,
      seatCounts: [2, 3, 4, 5],
      rules: rightOfWay.defaultRules(),
      deckOrder: railOrder,
      checkViews: false,
    });
    expect(report.failures).toEqual([]);
    expect(report.games).toBe(40);
  });
});
