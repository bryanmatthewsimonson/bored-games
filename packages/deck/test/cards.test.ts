import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { cardOf, cardPoint, cardTable } from '../src/cards.ts';
import { encodePoint } from '../src/encoding.ts';
import { G, generators, h2c, msm, q } from '../src/group.ts';

const Point = secp256k1.Point;

describe('group constants', () => {
  it('G is the secp256k1 base point and q its order', () => {
    expect(G.equals(Point.BASE)).toBe(true);
    expect(q).toBe(Point.Fn.ORDER);
  });
});

describe('h2c', () => {
  it('is deterministic, label-sensitive and never the identity', () => {
    expect(h2c('x').equals(h2c('x'))).toBe(true);
    expect(h2c('x').equals(h2c('y'))).toBe(false);
    expect(h2c('x').is0()).toBe(false);
    expect(h2c('x') instanceof Point).toBe(true);
  });

  it('pinned vector: h2c("gen:h") (guards the label and DST)', () => {
    expect(encodePoint(h2c('gen:h'))).toBe('AsBnDlyTVYMBswGmZ6TaR84t3v6Tq3FzN-wMx4oY_8oN');
  });
});

describe('generators', () => {
  it('h and hs are distinct from each other and from G', () => {
    const { h, hs } = generators(5);
    expect(hs).toHaveLength(5);
    const all = [G, h, ...hs].map(encodePoint);
    expect(new Set(all).size).toBe(7);
  });

  it('uses the one-based labels gen:h and gen:<i>', () => {
    const { h, hs } = generators(3);
    expect(h.equals(h2c('gen:h'))).toBe(true);
    expect(hs[0]?.equals(h2c('gen:1'))).toBe(true);
    expect(hs[2]?.equals(h2c('gen:3'))).toBe(true);
  });

  it('extends lazily and keeps earlier values stable', () => {
    const small = generators(2).hs.map(encodePoint);
    const big = generators(10).hs.map(encodePoint);
    expect(big.slice(0, 2)).toEqual(small);
    expect(generators(0).hs).toEqual([]);
  });

  it('returns a copy, so callers cannot corrupt the cache', () => {
    const a = generators(3);
    a.hs.length = 0;
    a.hs.push(G);
    expect(generators(3).hs).toHaveLength(3);
    expect(generators(3).hs[0]?.equals(h2c('gen:1'))).toBe(true);
  });

  it('rejects invalid sizes', () => {
    for (const n of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => generators(n)).toThrow(RangeError);
    }
  });
});

describe('msm', () => {
  const P = G.multiply(5n);
  const Q = G.multiply(11n);

  it('matches naive multiplication, including a zero scalar', () => {
    expect(msm([P, Q], [2n, 0n]).equals(P.multiply(2n))).toBe(true);
    expect(msm([P, Q], [3n, 4n]).equals(P.multiply(3n).add(Q.multiply(4n)))).toBe(true);
    expect(msm([P, Q], [q - 1n, 1n]).equals(P.negate().add(Q))).toBe(true);
  });

  it('accepts identity points', () => {
    expect(msm([Point.ZERO, Q], [7n, 2n]).equals(Q.multiply(2n))).toBe(true);
    expect(msm([Point.ZERO, Point.ZERO], [7n, 2n]).is0()).toBe(true);
  });

  it('gives the identity for the empty list and for all-zero scalars', () => {
    expect(msm([], []).is0()).toBe(true);
    expect(msm([P, Q], [0n, 0n]).is0()).toBe(true);
  });

  it('rejects mismatched lengths and out-of-range scalars', () => {
    expect(() => msm([P], [1n, 2n])).toThrow(RangeError);
    expect(() => msm([P, Q], [1n])).toThrow(RangeError);
    expect(() => msm([P], [q])).toThrow(RangeError);
    expect(() => msm([P], [-1n])).toThrow(RangeError);
  });
});

describe('cardPoint and cardTable', () => {
  it('cardPoint is stable and equals h2c("card:<deck>:<m>")', () => {
    expect(cardPoint('tiles', 0).equals(cardPoint('tiles', 0))).toBe(true);
    expect(cardPoint('tiles', 0).equals(h2c('card:tiles:0'))).toBe(true);
  });

  it('is domain separated by deck id', () => {
    expect(cardPoint('tiles', 0).equals(cardPoint('other', 0))).toBe(false);
  });

  it('all 108 tiles card points are distinct and none is the identity', () => {
    const pts = Array.from({ length: 108 }, (_, m) => cardPoint('tiles', m));
    expect(pts.every((p) => !p.is0())).toBe(true);
    expect(new Set(pts.map(encodePoint)).size).toBe(108);
  });

  it('rejects invalid card indexes and deck ids', () => {
    for (const m of [-1, 0.5, Number.NaN, 2 ** 53]) expect(() => cardPoint('tiles', m)).toThrow(RangeError);
    expect(() => cardPoint('', 0)).toThrow(RangeError);
    expect(() => cardPoint('a:b', 0)).toThrow(RangeError);
  });

  it('cardOf finds a card by its point', () => {
    const table = cardTable('tiles', 108);
    expect(table.size).toBe(108);
    expect(cardOf(table, cardPoint('tiles', 37))).toBe(37);
    expect(cardOf(table, cardPoint('tiles', 0))).toBe(0);
    expect(cardOf(table, cardPoint('tiles', 107))).toBe(107);
  });

  it('cardOf gives null for a point outside the table, another deck, or the identity', () => {
    const table = cardTable('tiles', 108);
    expect(cardOf(table, cardPoint('tiles', 108))).toBeNull();
    expect(cardOf(table, cardPoint('other', 3))).toBeNull();
    expect(cardOf(table, G)).toBeNull();
    expect(cardOf(table, Point.ZERO)).toBeNull();
  });

  it('cardTable rejects an invalid size and accepts an empty deck', () => {
    expect(cardTable('tiles', 0).size).toBe(0);
    expect(() => cardTable('tiles', -1)).toThrow(RangeError);
    expect(() => cardTable('tiles', 1.5)).toThrow(RangeError);
  });
});
