import { describe, expect, it } from 'vitest';
import { randomIndex } from '../src/random.ts';
import { seededRandom } from './util.ts';

describe('randomIndex', () => {
  it('stays within [0, k)', () => {
    const rnd = seededRandom('ri-range');
    for (const k of [1, 2, 3, 7, 52, 1000, 2 ** 31, 2 ** 32]) {
      for (let i = 0; i < 50; i++) {
        const v = randomIndex(rnd, k);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(k);
      }
    }
  });

  it('is reproducible under a seeded source and varies across draws', () => {
    const a = seededRandom('ri-repro');
    const b = seededRandom('ri-repro');
    const xs = Array.from({ length: 40 }, () => randomIndex(a, 1000));
    const ys = Array.from({ length: 40 }, () => randomIndex(b, 1000));
    expect(xs).toEqual(ys);
    expect(new Set(xs).size).toBeGreaterThan(10);
  });

  it('covers every value of a small range', () => {
    const rnd = seededRandom('ri-cover');
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(randomIndex(rnd, 5));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('rejects draws in the biased tail and redraws', () => {
    // k = 3: the limit is floor(2^32 / 3) * 3 = 4294967295, so 0xffffffff is rejected.
    const draws = [Uint8Array.of(255, 255, 255, 255), Uint8Array.of(0, 0, 0, 7)];
    let calls = 0;
    const rnd = (n: number): Uint8Array => {
      expect(n).toBe(4);
      return draws[calls++] as Uint8Array;
    };
    expect(randomIndex(rnd, 3)).toBe(7 % 3);
    expect(calls).toBe(2);
  });

  it('accepts the largest unbiased draw', () => {
    const rnd = () => Uint8Array.of(255, 255, 255, 254);
    expect(randomIndex(rnd, 3)).toBe(0xfffffffe % 3);
  });

  it('is a plain u32 for k = 2^32 and never rejects', () => {
    expect(randomIndex(() => Uint8Array.of(255, 255, 255, 255), 2 ** 32)).toBe(0xffffffff);
  });

  it('validates k and the byte source', () => {
    const rnd = seededRandom('ri-bad');
    for (const k of [0, -1, 1.5, Number.NaN, 2 ** 32 + 1, Number.POSITIVE_INFINITY]) {
      expect(() => randomIndex(rnd, k)).toThrow(RangeError);
    }
    expect(() => randomIndex(() => new Uint8Array(3), 5)).toThrow(RangeError);
  });
});
