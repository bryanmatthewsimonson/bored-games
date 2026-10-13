import {
  buildCost,
  burnOf,
  type Company,
  type CurrentAction,
  type CurrentState,
  poweredBy,
  stationOf,
  tableOf,
} from '@bored-games/current-affairs';
import type { FuzzPolicy, Rng } from '@bored-games/game-kit';

/**
 * Fuzzing policies for Current Affairs. Test drivers only, never players. Both read only public data and their own
 * legal actions, so they play the same on the full state (`pnpm fuzz`) and on a seat's view (`pnpm sim`).
 * - magnate: buys the station that adds the most capacity it can afford, bids up to a little over its number, fuels
 *   every station, wires the cheapest cities while it can power them (and one more), fires for the most cities.
 * - speculator: the same, but bids higher, wires whenever it can, and one move in five is a random legal one.
 * Wiring runs the networks up to the end count, so every game ends (D015).
 */

type Of<T extends CurrentAction['type']> = Extract<CurrentAction, { type: T }>;
const ofType = <T extends CurrentAction['type']>(all: readonly CurrentAction[], type: T): Of<T>[] =>
  all.filter((a): a is Of<T> => a.type === type);

const powersOf = (n: number): number => stationOf(n)?.powers ?? 0;
const capacity = (c: Company): number => c.stations.reduce((t, n) => t + powersOf(n), 0);

/** How much a station would add to the company's capacity, after scrapping its weakest when full. */
function gain(s: CurrentState, c: Company, n: number): number {
  const full = c.stations.length >= tableOf(s).maxStations;
  const weakest = full ? Math.min(...c.stations.map(powersOf)) : 0;
  return powersOf(n) - weakest;
}

function play(s: CurrentState, seat: number, legal: readonly unknown[], rng: Rng, bold: boolean): unknown {
  const all = legal as CurrentAction[];
  if (all.length === 1) return all[0];
  if (bold && rng.int(5) === 0) return rng.pick(all);
  const c = s.companies[seat] as Company;
  const opens = ofType(all, 'open');
  if (opens.length > 0) {
    const useful = opens.filter((a) => gain(s, c, a.station) > 0 && a.bid <= c.money - 10);
    if (useful.length === 0) return all.find((a) => a.type === 'pass') ?? opens[0];
    if (s.round > 1 && c.stations.length > 0 && capacity(c) > c.cities.length + 2 && rng.int(2) === 0)
      return all.find((a) => a.type === 'pass') ?? useful[0];
    return useful.reduce((x, y) => (gain(s, c, y.station) > gain(s, c, x.station) ? y : x));
  }
  const bids = ofType(all, 'bid');
  if (bids.length > 0 || all.some((a) => a.type === 'fold')) {
    const lot = s.lot;
    const limit = lot === null ? 0 : lot.station + (bold ? 15 : 6);
    const raise = bids[0];
    if (lot && raise && raise.amount <= limit && raise.amount <= c.money - 10 && gain(s, c, lot.station) > 0)
      return raise;
    return all.find((a) => a.type === 'fold');
  }
  const scraps = ofType(all, 'scrap');
  if (scraps.length > 0) return scraps.reduce((x, y) => (powersOf(y.station) < powersOf(x.station) ? y : x));
  const fuel = ofType(all, 'fuel');
  if (fuel.length > 0) return fuel[0];
  const builds = ofType(all, 'build');
  if (builds.length > 0 || s.phase === 'build') {
    const want = bold ? 22 : capacity(c) + 1;
    if (c.cities.length < want && builds.length > 0) {
      const cost = (a: Of<'build'>) => buildCost(s, seat, a.city) ?? Number.POSITIVE_INFINITY;
      const best = builds.reduce((x, y) => (cost(y) < cost(x) ? y : x));
      if (cost(best) <= c.money - (bold ? 0 : 15)) return best;
    }
    return all.find((a) => a.type === 'done');
  }
  const powers = ofType(all, 'power');
  if (powers.length > 0) {
    const fired = (a: Of<'power'>) => burnOf(a).burn.reduce((x, y) => x + y, 0);
    const lit = (a: Of<'power'>) => poweredBy(c, a);
    return powers.reduce((x, y) => (lit(y) > lit(x) || (lit(y) === lit(x) && fired(y) < fired(x)) ? y : x));
  }
  return rng.pick(all);
}

export const CURRENT_POLICIES: readonly FuzzPolicy<CurrentState>[] = [
  { name: 'magnate', choose: (s, seat, legal, rng) => play(s, seat, legal, rng, false) },
  { name: 'speculator', choose: (s, seat, legal, rng) => play(s, seat, legal, rng, true) },
];

export const CURRENT_EXPECTED_COVERAGE: readonly string[] = [
  'era:2',
  'era:3',
  'move:scrap',
  'move:pass',
  'market:removed',
  'stack:shuffled',
  'end:cities',
];
