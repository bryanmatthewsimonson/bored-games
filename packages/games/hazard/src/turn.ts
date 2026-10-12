/*
 * Turns and the end of the game (RULES.md "A turn" and "Winning"). Pure.
 */
import { REALMS } from './map.ts';
import type { HazardEvent, HazardState } from './types.ts';
import { type Applied, at, nextAlive } from './util.ts';

/** Troops `seat` musters at the start of its turn: a third of its provinces (at least 3) and its whole realms. */
export function reinforcements(s: HazardState, seat: number): number {
  const held = s.owner.filter((o) => o === seat).length;
  const realms = REALMS.filter((r) => r.provinces.every((p) => s.owner[at(p)] === seat));
  return Math.max(3, Math.floor(held / 3)) + realms.reduce((n, r) => n + r.bonus, 0);
}

/** Start `seat`'s turn: count its troops and open the muster. */
export function startTurn(s: HazardState, seat: number): Applied {
  const pool = reinforcements(s, seat);
  return {
    state: {
      ...s,
      stage: 'muster',
      turn: seat,
      pool,
      midTurn: false,
      bonusUsed: false,
      captured: false,
      battle: null,
      advance: null,
    },
    events: [{ type: 'turn', seat, troops: pool }],
  };
}

/** The turn passes to the next seat still on the map. */
export const nextTurn = (s: HazardState): Applied => startTurn(s, nextAlive(s, s.turn));

/**
 * `winner` holds the world: the game is over. Places: the winner first, then the others by how long they lasted
 * (the last one out second); seats that cashed a false set share the last places. Scores are provinces held.
 */
export function finish(s: HazardState, winner: number): Applied {
  const order = [winner, ...[...s.out].reverse()];
  const clean = order.filter((seat) => !s.fouls.includes(seat));
  const places = Array.from({ length: s.seats }, (_, seat) =>
    s.fouls.includes(seat) ? clean.length + 1 : clean.indexOf(seat) + 1,
  );
  const scores = Array.from({ length: s.seats }, (_, seat) => s.owner.filter((o) => o === seat).length);
  const events: HazardEvent[] = [{ type: 'won', seat: winner }];
  return {
    state: {
      ...s,
      stage: 'over',
      battle: null,
      advance: null,
      result: { places, scores, reason: 'conquest' },
    },
    events,
  };
}
