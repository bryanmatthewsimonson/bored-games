import type { FuzzPolicy, Rng } from '@bored-games/game-kit';
import {
  type HazardAction,
  type HazardState,
  neighbors,
  PROVINCES,
  type ProvinceId,
} from '@bored-games/hazard';

/**
 * Fuzzing policies for Hazard. Test drivers only, never players. Both read only public data and their own legal
 * actions, so they play the same on the full state (`pnpm fuzz`) and on a seat's view (`pnpm sim`).
 * - general: masses its muster on its biggest border stack, attacks with that stack first, with the most dice,
 *   whenever it outnumbers the defender (the weakest target first), moves everything in, marches its biggest idle
 *   stack a step nearer the front, and cashes as soon as it may. One move in
 *   eight is a random legal one, so the rarer choices (one die, a partial move in, a single troop's march) are hit.
 * - cautious: the same, but it attacks only with twice the defender's troops, defends with one die when it may,
 *   and moves in half the troops it may.
 * Pressure plus rising set values make every game end by conquest (D015).
 */

const idx = (p: ProvinceId): number => PROVINCES.indexOf(p);

/** For each province `seat` holds, how many steps through its own provinces to one next to an enemy (0 there). */
function frontDistance(s: HazardState, seat: number): Map<ProvinceId, number> {
  const mine = PROVINCES.filter((p) => s.owner[idx(p)] === seat);
  const far = new Map<ProvinceId, number>();
  let ring = mine.filter((p) => neighbors(p).some((n) => s.owner[idx(n)] !== seat));
  for (const p of ring) far.set(p, 0);
  for (let d = 1; ring.length > 0; d++) {
    const next: ProvinceId[] = [];
    for (const p of ring)
      for (const n of neighbors(p))
        if (s.owner[idx(n)] === seat && !far.has(n)) {
          far.set(n, d);
          next.push(n);
        }
    ring = next;
  }
  return far;
}

type Of<T extends HazardAction['type']> = Extract<HazardAction, { type: T }>;
const ofType = <T extends HazardAction['type']>(all: readonly HazardAction[], type: T): Of<T>[] =>
  all.filter((a): a is Of<T> => a.type === type);

function play(s: HazardState, seat: number, legal: readonly unknown[], rng: Rng, cautious: boolean): unknown {
  const all = legal as HazardAction[];
  const troops = (p: ProvinceId): number => s.troops[idx(p)] ?? 0;
  const ownerOf = (p: ProvinceId): number => s.owner[idx(p)] ?? -1;
  const held = (who: number): number => s.owner.filter((o) => o === who).length;
  const border = (p: ProvinceId): boolean => neighbors(p).some((n) => ownerOf(n) !== seat);
  // Rolls and charters are forced: there is one legal move.
  if (all.length === 1) return all[0];
  if (!cautious && rng.int(8) === 0) return rng.pick(all);
  const cash = ofType(all, 'cash')[0];
  if (cash) return cash;
  const musters = ofType(all, 'muster').filter((a) => a.count === s.pool && border(a.province));
  if (musters.length > 0) return musters.reduce((x, y) => (troops(y.province) > troops(x.province) ? y : x));
  const odds = cautious ? 2 : 1;
  const attacks = ofType(all, 'attack').filter(
    (a) => a.dice === Math.min(3, troops(a.from) - 1) && troops(a.from) > odds * troops(a.to),
  );
  // The biggest stack first, at the weakest target next to it.
  const score = (a: Of<'attack'>): number => -100_000 * troops(a.from) + troops(a.to) + held(ownerOf(a.to));
  if (attacks.length > 0) return attacks.reduce((x, y) => (score(y) < score(x) ? y : x));
  const advance = ofType(all, 'advance');
  if (advance.length > 0) return cautious ? advance[Math.floor(advance.length / 2)] : advance.at(-1);
  const defend = ofType(all, 'defend');
  if (defend.length > 0) return cautious ? defend[0] : defend.at(-1);
  // March the biggest idle stack one step nearer the front.
  const far = frontDistance(s, seat);
  const marches = ofType(all, 'march').filter(
    (a) => a.count > 1 && (far.get(a.to) ?? 99) < (far.get(a.from) ?? 99),
  );
  if (marches.length > 0) return marches.reduce((x, y) => (y.count > x.count ? y : x));
  return all.find((a) => a.type === 'endAttack' || a.type === 'endTurn') ?? rng.pick(all);
}

export const HAZARD_POLICIES: readonly FuzzPolicy<HazardState>[] = [
  { name: 'general', choose: (s, seat, legal, rng) => play(s, seat, legal, rng, false) },
  { name: 'cautious', choose: (s, seat, legal, rng) => play(s, seat, legal, rng, true) },
];

export const HAZARD_EXPECTED_COVERAGE: readonly string[] = [
  'end:conquest',
  'move:reshuffle',
  'move:transfer',
  'move:cashDown',
];

/** `pnpm sim` tables: three days a move, as for Room for Doubt, so a whole game fits the sim's clock. */
export const HAZARD_SIM_DEADLINE = 3 * 86400;
