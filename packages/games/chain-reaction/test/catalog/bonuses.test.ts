import { describe, expect, it } from 'vitest';
import { bonusPayouts, DEFAULT_RULES } from '../../src/index.ts';
import { act, ofType, place, scenario } from '../helpers.ts';

const pay = (holdings: number[], price: number) =>
  bonusPayouts(DEFAULT_RULES, holdings, price).map((p) => [p.seat, p.amount, p.role]);

/** Merges b1 (3 tiles, $300) into s1 and returns the bonuses paid for b1. */
function mergerBonuses(b1Holdings: number[], seats = b1Holdings.length) {
  const s = scenario({
    seats,
    chains: { s1: '1A-5A', b1: '7A-9A' },
    loose: '12I 1I 6I 3G',
    hands: ['6A'],
    shares: { b1: b1Holdings, s1: [1] },
  });
  return ofType(act(s, place(s, 0, '6A')).events, 'bonusPaid').map((e) => [e.seat, e.amount, e.role]);
}

describe('bonuses', () => {
  it('C19 single majority and single minority', () => {
    expect(pay([3, 2, 0], 300)).toEqual([
      [0, 3000, 'majority'],
      [1, 1500, 'minority'],
    ]);
    expect(mergerBonuses([3, 2, 0])).toEqual(pay([3, 2, 0], 300));
  });

  it('C20 a sole holder receives both bonuses', () => {
    expect(pay([0, 4, 0], 300)).toEqual([[1, 4500, 'sole']]);
    expect(mergerBonuses([0, 4, 0])).toEqual([[1, 4500, 'sole']]);
  });

  it('C21 majority tie: bonuses are pooled, with no minority', () => {
    expect(pay([3, 3, 1], 600)).toEqual([
      [0, 4500, 'majorityTie'],
      [1, 4500, 'majorityTie'],
    ]);
  });

  it('C22 majority-tie portions round up to $100', () => {
    expect(pay([2, 2, 0], 300)).toEqual([
      [0, 2300, 'majorityTie'],
      [1, 2300, 'majorityTie'],
    ]);
    expect(mergerBonuses([2, 2, 0])).toEqual(pay([2, 2, 0], 300));
  });

  it('C23 minority tie: the minority bonus is split, rounding up', () => {
    expect(pay([5, 2, 2], 300)).toEqual([
      [0, 3000, 'majority'],
      [1, 800, 'minorityTie'],
      [2, 800, 'minorityTie'],
    ]);
  });

  it('C24 three-way minority tie', () => {
    expect(pay([4, 1, 1, 1], 200)).toEqual([
      [0, 2000, 'majority'],
      [1, 400, 'minorityTie'],
      [2, 400, 'minorityTie'],
      [3, 400, 'minorityTie'],
    ]);
  });

  it('C25 three- and four-way majority ties', () => {
    expect(pay([2, 2, 2], 300).map((p) => p[1])).toEqual([1500, 1500, 1500]);
    expect(pay([1, 1, 1, 1], 200).map((p) => p[1])).toEqual([800, 800, 800, 800]);
    expect(pay([0, 0, 0], 300)).toEqual([]);
  });
});
