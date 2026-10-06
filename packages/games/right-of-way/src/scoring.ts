/*
 * Scoring helpers (docs/games/right-of-way/RULES.md, "Final scoring"): route points, charter completion and the
 * longest line. Pure functions of the routes a seat owns.
 */
import { CHARTERS, ROUTES } from './map.ts';

/** Points for a route of length 1–6 (index = length). */
export const ROUTE_POINTS: readonly number[] = [0, 1, 2, 4, 7, 10, 15];
export const RIBBON_POINTS = 10;
export const TRACK = 45;

/** The route indexes `seat` owns (either side), ascending. */
export function ownedRoutes(routes: readonly (readonly (number | null)[])[], seat: number): number[] {
  return routes.flatMap((sides, i) => (sides.includes(seat) ? [i] : []));
}

/** Whether the owned routes join towns `a` and `b` (C32). */
export function connects(owned: readonly number[], a: number, b: number): boolean {
  if (a === b) return true;
  const seen = new Set<number>([a]);
  const stack = [a];
  while (stack.length > 0) {
    const t = stack.pop() as number;
    for (const i of owned) {
      const r = ROUTES[i];
      if (r === undefined) continue;
      const o = r.a === t ? r.b : r.b === t ? r.a : null;
      if (o === null || seen.has(o)) continue;
      if (o === b) return true;
      seen.add(o);
      stack.push(o);
    }
  }
  return false;
}

/** Whether charter `t` (0–29) is completed by the owned routes. */
export function charterDone(owned: readonly number[], t: number): boolean {
  const c = CHARTERS[t];
  return c !== undefined && connects(owned, c.a, c.b);
}

/**
 * The longest trail through the owned routes (C33): the largest total length of a walk that uses no route twice.
 * It may loop and pass a town more than once. A seat holds at most 45 spaces of track, so the search is small.
 */
export function longestLine(owned: readonly number[]): number {
  const edges = owned.map((i) => ROUTES[i]).filter((r) => r !== undefined);
  const used = new Array<boolean>(edges.length).fill(false);
  let best = 0;
  const walk = (town: number, length: number): void => {
    if (length > best) best = length;
    for (let k = 0; k < edges.length; k++) {
      if (used[k]) continue;
      const r = edges[k] as (typeof edges)[number];
      const o = r.a === town ? r.b : r.b === town ? r.a : null;
      if (o === null) continue;
      used[k] = true;
      walk(o, length + r.length);
      used[k] = false;
    }
  };
  const towns = new Set(edges.flatMap((r) => [r.a, r.b]));
  for (const t of towns) walk(t, 0);
  return best;
}
