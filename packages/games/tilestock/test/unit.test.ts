import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bonusPayouts,
  compareCloseness,
  DEFAULT_RULES,
  NEIGHBORS,
  sharePrice,
  splitUp100,
  TILE_COUNT,
  tileId,
  tileIndex,
  validateRules,
} from '../src/index.ts';

describe('tiles', () => {
  it('round-trips every tile id and rejects non-ids', () => {
    for (let i = 0; i < TILE_COUNT; i++) expect(tileIndex(tileId(i))).toBe(i);
    expect(tileId(0)).toBe('1A');
    expect(tileId(107)).toBe('12I');
    for (const bad of ['0A', '13A', '1J', 'a1', '1a', ' 1A', '01A', 7, null])
      expect(tileIndex(bad)).toBeNull();
  });

  it('has symmetric orthogonal neighbors', () => {
    for (let i = 0; i < TILE_COUNT; i++) {
      for (const n of NEIGHBORS[i] ?? []) expect(NEIGHBORS[n]).toContain(i);
    }
    expect(NEIGHBORS[tileIndex('1A') as number]?.map(tileId)).toEqual(['2A', '1B']);
    expect(NEIGHBORS[tileIndex('6E') as number]?.map(tileId)).toEqual(['6D', '5E', '7E', '6F']);
  });

  it('orders closeness to 1A row-first or column-first', () => {
    const t = (id: string) => tileIndex(id) as number;
    expect(compareCloseness('rowThenColumn', t('9A'), t('1B'))).toBeLessThan(0);
    expect(compareCloseness('rowThenColumn', t('2A'), t('2B'))).toBeLessThan(0);
    expect(compareCloseness('columnThenRow', t('1B'), t('9A'))).toBeLessThan(0);
    expect(compareCloseness('columnThenRow', t('8A'), t('8C'))).toBeLessThan(0);
  });
});

describe('pricing', () => {
  it('matches the reference price table exactly', () => {
    const sizes = [2, 3, 4, 5, 6, 10, 11, 20, 21, 30, 31, 40, 41, 60];
    const expected: Record<string, number[]> = {
      b1: [200, 300, 400, 500, 600, 600, 700, 700, 800, 800, 900, 900, 1000, 1000],
      s1: [300, 400, 500, 600, 700, 700, 800, 800, 900, 900, 1000, 1000, 1100, 1100],
      p1: [400, 500, 600, 700, 800, 800, 900, 900, 1000, 1000, 1100, 1100, 1200, 1200],
    };
    for (const [id, prices] of Object.entries(expected)) {
      const c = DEFAULT_RULES.chains.findIndex((x) => x.id === id);
      expect(sizes.map((n) => sharePrice(DEFAULT_RULES, c, n))).toEqual(prices);
    }
    expect(sharePrice(DEFAULT_RULES, 0, 0)).toBe(0);
    expect(sharePrice(DEFAULT_RULES, 0, 1)).toBe(0);
  });

  it('splits round up to $100', () => {
    expect(splitUp100(1500, 2)).toBe(800);
    expect(splitUp100(4500, 2)).toBe(2300);
    expect(splitUp100(1000, 3)).toBe(400);
    expect(splitUp100(9000, 2)).toBe(4500);
    expect(splitUp100(3000, 4)).toBe(800);
  });

  it('bonus payouts: properties', () => {
    const price = fc.constantFrom(...DEFAULT_RULES.tierPrices.premium, ...DEFAULT_RULES.tierPrices.budget);
    const holdings = fc.array(fc.integer({ min: 0, max: 25 }), { minLength: 3, maxLength: 6 });
    fc.assert(
      fc.property(holdings, price, (h, p) => {
        const out = bonusPayouts(DEFAULT_RULES, h, p);
        const total = out.reduce((s, x) => s + x.amount, 0);
        for (const x of out) {
          expect(h[x.seat]).toBeGreaterThan(0);
          expect(x.amount % 100).toBe(0);
        }
        if (h.every((v) => v === 0)) expect(out).toEqual([]);
        else {
          // Never less than both bonuses, never more than rounding can add.
          expect(total).toBeGreaterThanOrEqual(15 * p);
          expect(total).toBeLessThan(15 * p + 100 * out.length);
          const top = Math.max(...h);
          for (let s = 0; s < h.length; s++) {
            if (h[s] === top) expect(out.some((x) => x.seat === s)).toBe(true);
          }
        }
      }),
    );
  });
});

describe('rules validation', () => {
  it('accepts the defaults and rejects bad configurations', () => {
    expect(validateRules(DEFAULT_RULES).ok).toBe(true);
    expect(validateRules({ ...DEFAULT_RULES, minPlayers: 2 }).ok).toBe(false);
    expect(validateRules({ ...DEFAULT_RULES, extra: true }).ok).toBe(false);
    expect(validateRules({ ...DEFAULT_RULES, startingCash: 6050 }).ok).toBe(false);
    expect(
      validateRules({
        ...DEFAULT_RULES,
        chains: [
          { id: 'b1', tier: 'budget' },
          { id: 'b1', tier: 'budget' },
        ],
      }).ok,
    ).toBe(false);
    expect(validateRules({ ...DEFAULT_RULES, stallRule: 'off' }).ok).toBe(true);
    expect(validateRules(null).ok).toBe(false);
  });
});
