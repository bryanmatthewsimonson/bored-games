import type { FuzzPolicy, Rng } from '@bored-games/game-kit';
import {
  CITY_COUNT,
  NEIGHBOURS,
  type SpreadAction,
  type SpreadState,
  strainOf,
} from '@bored-games/spread-thin';

/**
 * Fuzzing policies for Spread Thin. Test drivers only, never players. Both read only public data and their own legal
 * actions, so they play the same on the full state (`pnpm fuzz`) and on a seat's view (`pnpm sim`).
 * - medic: cures when it can, carries a near-complete set toward the nearest clinic, treats the worst city it stands
 *   in, gathers cards and opens clinics, plays reliefs now and then.
 * - wanderer: the same, but one move in three is a random legal one.
 * Wins, double surges and a moved clinic are rare under these policies; the catalog tests reach them.
 * Every turn draws two field cards, so every game ends: by the cures, or when the field deck runs out (D015).
 */

type Of<T extends SpreadAction['type']> = Extract<SpreadAction, { type: T }>;
const ofType = <T extends SpreadAction['type']>(all: readonly SpreadAction[], type: T): Of<T>[] =>
  all.filter((a): a is Of<T> => a.type === type);

/** Hops from `from` to every city (breadth first). */
function distances(from: number): number[] {
  const d = Array.from({ length: CITY_COUNT }, () => Number.POSITIVE_INFINITY);
  d[from] = 0;
  const queue = [from];
  while (queue.length > 0) {
    const c = queue.shift() as number;
    for (const n of NEIGHBOURS[c] ?? [])
      if ((d[n] as number) > (d[c] as number) + 1) {
        d[n] = (d[c] as number) + 1;
        queue.push(n);
      }
  }
  return d;
}

function play(s: SpreadState, seat: number, legal: readonly unknown[], rng: Rng, wild: boolean): unknown {
  const all = legal as SpreadAction[];
  if (all.length === 1) return all[0];
  if (wild && rng.int(3) === 0) return rng.pick(all);
  const cure = ofType(all, 'cure');
  if (cure.length > 0) return cure[0];
  const arrange = ofType(all, 'arrange');
  if (arrange.length > 0) return rng.pick(arrange);
  const discards = ofType(all, 'discard');
  if (discards.length > 0) {
    // Keep the strain it holds most of.
    const hand = s.hands[seat] ?? [];
    const count = (f: number) =>
      f < CITY_COUNT ? hand.filter((g) => g < CITY_COUNT && strainOf(g) === strainOf(f)).length : 9;
    return discards.reduce((x, y) => (count(y.card) < count(x.card) ? y : x));
  }
  if (all.some((a) => a.type === 'pass')) {
    const reliefs = all.filter((a) => a.type !== 'pass');
    return reliefs.length > 0 && rng.int(6) === 0 ? rng.pick(reliefs) : all.find((a) => a.type === 'pass');
  }
  const here = s.at[seat] as number;
  const hand = s.hands[seat] ?? [];
  // Gather a set: walk toward the nearest clinic while holding four or more of one strain.
  const most = Math.max(
    0,
    ...[0, 1, 2, 3].map((k) => hand.filter((f) => f < CITY_COUNT && strainOf(f) === k).length),
  );
  const moves = all.filter(
    (a): a is Of<'travel'> | Of<'shuttle'> =>
      (a.type === 'travel' || a.type === 'shuttle') && a.pawn === seat,
  );
  if (most >= 4 && !s.clinics.includes(here)) {
    const clinic = ofType(all, 'clinic').find((a) => a.remove === null);
    if (clinic && rng.int(2) === 0) return clinic;
    const d = (c: number) => Math.min(...s.clinics.map((k) => distances(c)[k] as number));
    const best = moves.reduce<(typeof moves)[number] | null>(
      (x, y) => (x === null || d(y.to) < d(x.to) ? y : x),
      null,
    );
    if (best !== null) return best;
  }
  const take = [...ofType(all, 'take'), ...ofType(all, 'give')];
  if (take.length > 0 && rng.int(2) === 0) return take[0];
  const treat = ofType(all, 'treat');
  if (treat.length > 0)
    return treat.reduce((x, y) =>
      (s.cases[here]?.[y.strain] ?? 0) > (s.cases[here]?.[x.strain] ?? 0) ? y : x,
    );
  if (rng.int(10) === 0) {
    const reliefs = all.filter((a) => ['medevac', 'warning', 'permit', 'lull', 'immunity'].includes(a.type));
    if (reliefs.length > 0) return rng.pick(reliefs);
  }
  const retrieve = ofType(all, 'retrieve');
  if (retrieve.length > 0) return retrieve[0];
  // Head for the busiest nearby city.
  const heat = (c: number) => (s.cases[c] ?? []).reduce((a, b) => a + b, 0);
  const hot = moves.filter((a) => heat(a.to) > 0);
  if (hot.length > 0) return hot.reduce((x, y) => (heat(y.to) > heat(x.to) ? y : x));
  if (moves.length > 0 && rng.int(4) > 0) return rng.pick(moves);
  return rng.pick(all.filter((a) => a.type !== 'end').length > 0 ? all.filter((a) => a.type !== 'end') : all);
}

export const SPREAD_POLICIES: readonly FuzzPolicy<SpreadState>[] = [
  { name: 'medic', choose: (s, seat, legal, rng) => play(s, seat, legal, rng, false) },
  { name: 'wanderer', choose: (s, seat, legal, rng) => play(s, seat, legal, rng, true) },
];

export const SPREAD_EXPECTED_COVERAGE: readonly string[] = [
  'restack',
  'spillover',
  'spillover:many',
  'cure',
  'stamped',
  'blocked',
  'paramedic:cleared',
  'arranged',
  'quiet',
  'retrieve',
  'discard:limit',
  'move:summon',
  'move:relocate',
  'move:medevac',
  'handed',
  'end:spillovers',
  'end:cases',
  'end:deck',
];
