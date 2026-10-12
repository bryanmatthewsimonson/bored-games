import { describe, expect, it } from 'vitest';
import { ATLAS_KEY, ATLAS_LANES, ATLAS_ROWS, hexNeighbors } from '../src/atlas.ts';
import { LINKS, PROVINCES } from '../src/map.ts';

const key = (a: string, b: string): string => [a, b].sort().join('-');

function cells(): Map<string, string> {
  const out = new Map<string, string>();
  ATLAS_ROWS.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== '.') out.set(`${x},${y}`, ch);
    });
  });
  return out;
}

describe('the atlas grid', () => {
  it('draws every province, and only provinces', () => {
    const chars = new Set(cells().values());
    expect([...chars].map((c) => ATLAS_KEY[c]).sort()).toEqual([...PROVINCES].sort());
    expect(new Set(ATLAS_ROWS.map((r) => r.length)).size).toBe(1);
  });

  it('draws each province as one piece', () => {
    const all = cells();
    for (const ch of new Set(all.values())) {
      const mine = [...all].filter(([, c]) => c === ch).map(([k]) => k);
      const seen = new Set([mine[0]]);
      const queue = [mine[0] as string];
      while (queue.length > 0) {
        const [x, y] = (queue.pop() as string).split(',').map(Number) as [number, number];
        for (const [nx, ny] of hexNeighbors(x, y)) {
          const k = `${nx},${ny}`;
          if (all.get(k) === ch && !seen.has(k)) {
            seen.add(k);
            queue.push(k);
          }
        }
      }
      expect(seen.size, ATLAS_KEY[ch]).toBe(mine.length);
    }
  });

  it("has exactly the engine's links: land borders plus the drawn lanes", () => {
    const all = cells();
    const land = new Set<string>();
    for (const [k, ch] of all) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      for (const [nx, ny] of hexNeighbors(x, y)) {
        const other = all.get(`${nx},${ny}`);
        if (other !== undefined && other !== ch)
          land.add(key(ATLAS_KEY[ch] ?? ch, ATLAS_KEY[other] ?? other));
      }
    }
    const lanes = ATLAS_LANES.map(([a, b]) => key(a, b));
    for (const lane of lanes) expect(land.has(lane), lane).toBe(false);
    expect([...land, ...lanes].sort()).toEqual(LINKS.map(([a, b]) => key(a, b)).sort());
  });
});
