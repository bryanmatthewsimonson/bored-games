/*
 * What each seat may know (RULES.md "Online play on this site"): everything is public but the deck order and a
 * face-down discovery, which only its drawer sees until the end. Pure.
 */
import type { ApplyResult, Learn } from '@bored-games/game-kit';
import { DISCOVERY_COUNT } from './data.ts';
import { DECK_ID } from './engine.ts';
import type { SticksEvent, SticksState } from './types.ts';
import { failure, int, obj } from './util.ts';

/** The state as `viewer` (a seat, or null for a spectator) may see it. */
export function viewOf(s: SticksState, viewer: number | null): SticksState {
  return {
    ...s,
    full: false,
    viewer,
    order: null,
    clans: s.clans.map((c, seat) =>
      seat === viewer ? c : { ...c, hidden: c.hidden.map((h) => (h.open ? h : { ...h, card: null })) },
    ),
  };
}

/** Every card `seat` knows privately: its face-down discoveries not yet turned up. */
export function knownTo(s: SticksState, seat: number): Learn[] {
  return (s.clans[seat]?.hidden ?? []).flatMap((h) =>
    !h.open && h.card !== null ? [{ deck: DECK_ID, pos: h.pos, card: h.card }] : [],
  );
}

/** A face-down discovery this view's seat drew. */
export function learnCard(s: SticksState, l: Learn): ApplyResult<SticksState, SticksEvent> {
  try {
    if (!obj(l)) return failure('Invalid private card.');
    const { deck, pos, card } = l as unknown as Record<string, unknown>;
    if (deck !== DECK_ID || !int(pos) || !int(card) || card >= DISCOVERY_COUNT)
      return failure('Invalid private card.');
    const viewer = s.viewer;
    if (s.full || viewer === null) return failure('Only a seat learns cards.');
    const clan = s.clans[viewer];
    const h = clan?.hidden.find((x) => x.pos === pos);
    if (!clan || !h || (h.card !== null && h.card !== card))
      return failure('That card is not one this seat drew.');
    return {
      ok: true,
      state: {
        ...s,
        clans: s.clans.map((c, i) =>
          i === viewer ? { ...c, hidden: c.hidden.map((x) => (x.pos === pos ? { ...x, card } : x)) } : c,
        ),
      },
      events: [],
    };
  } catch {
    return failure('Invalid private card.');
  }
}
