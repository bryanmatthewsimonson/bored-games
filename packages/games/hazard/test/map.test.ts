import { describe, expect, it } from 'vitest';
import { adjacent, isProvince, LINKS, neighbors, PROVINCES, provinceIndex, REALMS } from '../src/map.ts';

/** The degree sequence of the reference board's graph, sorted: the map is its twin. */
const DEGREES = [
  2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6,
  6, 6, 6, 6, 6, 6,
];

describe('the map', () => {
  it('has 42 provinces in six realms of 9, 4, 7, 6, 12 and 4, worth 5, 2, 5, 3, 7 and 2', () => {
    expect(PROVINCES).toHaveLength(42);
    expect(new Set(PROVINCES).size).toBe(42);
    expect(REALMS.map((r) => r.provinces.length)).toEqual([9, 4, 7, 6, 12, 4]);
    expect(REALMS.map((r) => r.bonus)).toEqual([5, 2, 5, 3, 7, 2]);
    expect(REALMS.flatMap((r) => r.provinces)).toEqual([...PROVINCES]);
    for (const [i, p] of PROVINCES.entries()) expect(provinceIndex(p)).toBe(i);
  });

  it('has 83 links, none doubled or looped, read the same both ways', () => {
    expect(LINKS).toHaveLength(83);
    const keys = LINKS.map(([a, b]) => [a, b].sort().join('-'));
    expect(new Set(keys).size).toBe(83);
    for (const [a, b] of LINKS) {
      expect(a).not.toBe(b);
      expect(neighbors(a)).toContain(b);
      expect(neighbors(b)).toContain(a);
      expect(adjacent(a, b) && adjacent(b, a)).toBe(true);
    }
    expect(adjacent('a1', 'e4')).toBe(true);
    expect(adjacent('a1', 'a5')).toBe(false);
  });

  it("is connected, with the reference board's degree sequence", () => {
    const seen = new Set<string>(['a1']);
    const queue = ['a1'];
    while (queue.length > 0) {
      for (const n of neighbors(queue.pop() as (typeof PROVINCES)[number]))
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
    }
    expect(seen.size).toBe(42);
    expect(PROVINCES.map((p) => neighbors(p).length).sort((x, y) => x - y)).toEqual(DEGREES);
  });

  it('recognises province ids and nothing else', () => {
    expect(isProvince('e12')).toBe(true);
    for (const x of ['e13', 'A1', '', 1, null, 'a10']) expect(isProvince(x)).toBe(false);
  });
});
