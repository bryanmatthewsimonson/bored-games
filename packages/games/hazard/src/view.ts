/*
 * What each seat may know (RULES.md "Online play on this site"): the map, the dice, the counts and every cashed
 * charter are public; a charter in a hand is known only to the seats that have held it (the drawer, and a conqueror
 * once the sealed share opens, D067). Pure.
 */
import type { ApplyResult, Learn } from '@bored-games/game-kit';
import { CARD_COUNT } from './cards.ts';
import { PILE_ID } from './engine.ts';
import type { HazardEvent, HazardState } from './types.ts';
import { failure, int, obj } from './util.ts';

/** The state as `viewer` (a seat, or null for a spectator) may see it. */
export function viewOf(s: HazardState, viewer: number | null): HazardState {
  return {
    ...s,
    full: false,
    viewer,
    plain: null,
    hands: s.hands.map((hand) =>
      hand.map((x) => (viewer !== null && x.holders.includes(viewer) ? x : { ...x, card: null })),
    ),
  };
}

/** Every charter `seat` knows privately: each one in a hand that it has held. */
export function knownTo(s: HazardState, seat: number): Learn[] {
  return s.hands.flatMap((hand) =>
    hand.flatMap((x) =>
      x.holders.includes(seat) && x.card !== null ? [{ deck: PILE_ID, pos: x.pos, card: x.card }] : [],
    ),
  );
}

/** A charter this view's seat has learned: it fills the slot, wherever that charter now is. */
export function learnCard(s: HazardState, l: Learn): ApplyResult<HazardState, HazardEvent> {
  try {
    if (!obj(l)) return failure('Invalid private charter.');
    const { deck, pos, card } = l as unknown as Record<string, unknown>;
    if (deck !== PILE_ID || !int(pos) || !int(card) || card >= CARD_COUNT)
      return failure('Invalid private charter.');
    const viewer = s.viewer;
    if (s.full || viewer === null) return failure('Only a seat learns charters.');
    let found = false;
    const hands = s.hands.map((hand) =>
      hand.map((x) => {
        if (x.pos !== pos || !x.holders.includes(viewer)) return x;
        found = true;
        return { ...x, card };
      }),
    );
    if (!found) return failure('That charter is not one this seat has held.');
    return { ok: true, state: { ...s, hands }, events: [] };
  } catch {
    return failure('Invalid private charter.');
  }
}
