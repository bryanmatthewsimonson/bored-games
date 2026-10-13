/*
 * Routes on the map (RULES.md C14): what a company pays to wire a new city into its network. Pure.
 */
import { CITY_COUNT, CITY_REGION, LINKS } from './map.ts';

/** Each city's neighbours as [city, cost], from LINKS. */
export const NEIGHBOURS: readonly (readonly (readonly [number, number])[])[] = (() => {
  const out: [number, number][][] = Array.from({ length: CITY_COUNT }, () => []);
  for (const [a, b, cost] of LINKS) {
    out[a]?.push([b, cost]);
    out[b]?.push([a, cost]);
  }
  return out;
})();

/** The cities of the regions in play. */
export const citiesIn = (regions: readonly number[]): number[] =>
  Array.from({ length: CITY_COUNT }, (_, c) => c).filter((c) => regions.includes(CITY_REGION[c] ?? -1));

/**
 * The cheapest line cost from any city of `from` to every city, travelling only through cities of the regions in
 * play (`inPlay[c]`); unreachable cities get Infinity. An empty `from` costs 0 everywhere in play: a company's first
 * city needs no line.
 */
export function lineCosts(from: readonly number[], inPlay: readonly boolean[]): number[] {
  const dist = Array.from({ length: CITY_COUNT }, () => Number.POSITIVE_INFINITY);
  if (from.length === 0) {
    for (let c = 0; c < CITY_COUNT; c++) if (inPlay[c]) dist[c] = 0;
    return dist;
  }
  const done = Array.from({ length: CITY_COUNT }, () => false);
  for (const c of from) dist[c] = 0;
  for (;;) {
    let best = -1;
    for (let c = 0; c < CITY_COUNT; c++)
      if (!done[c] && inPlay[c] && (dist[c] as number) < Number.POSITIVE_INFINITY)
        if (best < 0 || (dist[c] as number) < (dist[best] as number)) best = c;
    if (best < 0) return dist;
    done[best] = true;
    for (const [next, cost] of NEIGHBOURS[best] ?? []) {
      if (!inPlay[next]) continue;
      const d = (dist[best] as number) + cost;
      if (d < (dist[next] as number)) dist[next] = d;
    }
  }
}

/** Region adjacency: two regions touch when a line joins a city of each. */
export const REGION_LINKS: readonly (readonly [number, number])[] = (() => {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const [a, b] of LINKS) {
    const ra = CITY_REGION[a] as number;
    const rb = CITY_REGION[b] as number;
    if (ra === rb) continue;
    const pair: [number, number] = ra < rb ? [ra, rb] : [rb, ra];
    const key = pair.join('-');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(pair);
    }
  }
  return out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
})();

/** Every set of `k` regions that touch as one block, each ascending, in lexicographic order (C02). */
export function regionSets(k: number): number[][] {
  const out: number[][] = [];
  for (let mask = 0; mask < 1 << 6; mask++) {
    const set = [0, 1, 2, 3, 4, 5].filter((r) => (mask >> r) & 1);
    if (set.length !== k) continue;
    const reached = new Set([set[0]]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [a, b] of REGION_LINKS) {
        if (!set.includes(a) || !set.includes(b)) continue;
        if (reached.has(a) !== reached.has(b)) {
          reached.add(a);
          reached.add(b);
          grew = true;
        }
      }
    }
    if (reached.size === k) out.push(set);
  }
  return out.sort((x, y) => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
    return 0;
  });
}
