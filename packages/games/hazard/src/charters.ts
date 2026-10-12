/*
 * The muster and the charters: drawing, cashing a set, reshuffles and the transfer on elimination (RULES.md
 * "Muster" and "Charters"). Pure.
 */

import type { HazardAction, HazardState } from './types.ts';
import { type Applied, at, heldBy, withArray } from './util.ts';

/** Whether `seat` must cash before it may place: five or more charters at the turn's start, or over four mid-turn. */
export const mustCash = (s: HazardState, seat: number): boolean => {
  const n = s.hands[seat]?.length ?? 0;
  return s.midTurn ? n > 4 : n >= 5;
};

/** Whether this state knows every charter in `seat`'s hand. */
export const handKnown = (s: HazardState, seat: number): boolean =>
  (s.hands[seat] ?? []).every((slot) => slot.card !== null);

export function chartersLegal(s: HazardState, seat: number): HazardAction[] {
  if (s.stage !== 'muster') return [];
  // A hand with a charter not yet learned: what may be cashed, and so whether placing is allowed, is unknown.
  if (!handKnown(s, seat)) return [];
  if (mustCash(s, seat)) return [];
  const counts = [...new Set([1, s.pool])];
  return heldBy(s, seat).flatMap((province) =>
    counts.map((count): HazardAction => ({ type: 'muster', actor: seat, province, count })),
  );
}

export function applyCharters(s: HazardState, a: HazardAction): Applied | string {
  switch (a.type) {
    case 'muster': {
      if (s.stage !== 'muster' || s.turn !== a.actor) return 'It is not your turn to muster.';
      if (mustCash(s, a.actor)) return 'Cash in a set first.';
      if (a.count < 1 || a.count > s.pool) return `Place 1 to ${s.pool} troops.`;
      const i = at(a.province);
      if (s.owner[i] !== a.actor) return 'Muster troops on your own province.';
      const pool = s.pool - a.count;
      return {
        state: {
          ...s,
          troops: withArray(s.troops, i, (s.troops[i] ?? 0) + a.count),
          pool,
          stage: pool === 0 ? 'attack' : 'muster',
          midTurn: pool === 0 ? false : s.midTurn,
        },
        events: [{ type: 'mustered', seat: a.actor, province: a.province, count: a.count }],
      };
    }
    default:
      return 'Not yet.';
  }
}
