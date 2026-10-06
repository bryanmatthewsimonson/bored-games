import type { DeckSpec, GameModule, Learn } from '@bored-games/game-kit';
import { DECK_ID, DECK_SIZE, GROUPS } from './deck.ts';
import {
  applyAction,
  canReshuffle,
  DEFAULT_RULES,
  knownTo,
  learnCard,
  legalActions,
  parseAction,
  pendingOf,
  pileCount,
  setupGame,
  standingsOf,
  validateRules,
  viewOf,
} from './engine.ts';
import { checkInvariants } from './invariants.ts';
import type { RowEvent, RowRules, RowState } from './types.ts';

export const RIGHT_OF_WAY_ID = 'right-of-way';
export const RIGHT_OF_WAY_VERSION = '0.1.0';

/**
 * The packet (deck.ts): one deck in independently shuffled groups. `promptShares` is the owner's exception to D050
 * for this game (D066), as for Luster: the other seats' open apps release card shares at once.
 */
export const RAIL_DECK: DeckSpec = {
  id: DECK_ID,
  size: DECK_SIZE,
  promptShares: true,
  partitions: GROUPS.map((g) => ({ id: g.id, size: g.size })),
};

/** The hidden cards an action shows: a paid card drawn blind, or a skipped reshuffle card (C19, C15). */
export function revealsOf(s: RowState, raw: unknown): Learn[] {
  const a = parseAction(raw);
  if (a === null) return [];
  if (a.type === 'sift')
    return a.card !== null && s.sift !== null ? [{ deck: DECK_ID, pos: s.sift.pos, card: a.card }] : [];
  if (a.type !== 'claim') return [];
  const hand = s.players[a.actor]?.hand ?? [];
  return a.pay.flatMap(([pos, card]) =>
    hand.some((h) => h.pos === pos && !h.open) ? [{ deck: DECK_ID, pos, card }] : [],
  );
}

export const rightOfWay: GameModule<RowState, RowEvent, RowRules> = {
  id: RIGHT_OF_WAY_ID,
  version: RIGHT_OF_WAY_VERSION,
  defaultRules: () => DEFAULT_RULES,
  validateRules,
  seatRange: () => ({ min: 2, max: 5 }),
  decks: () => [RAIL_DECK],
  setup: setupGame,
  pending: pendingOf,
  legalActions,
  apply: applyAction,
  learn: learnCard,
  knownTo,
  view: viewOf,
  outcome: (s) => s.result,
  standings: standingsOf,
  dealt: (s) => s.dealt,
  revealsOf,
  invariants: checkInvariants,
  // Public refills and reshuffles during play need their own Resign review first (D052), as Luster's do.
  resignAllowed: () => false,
  coverage: (s, events) => {
    const tags = events.map((e) => `move:${e.action.type}`);
    for (const e of events) {
      if (e.action.type === 'sift') tags.push(e.action.card === null ? 'sift:keep' : 'sift:skip');
      if (
        e.action.type === 'charters' &&
        s.players.some((p) => p.offered.some((c) => s.dealt.filter((d) => d.pos === c.pos).length > 1))
      )
        tags.push('charters:redealt');
    }
    if (s.epochs.length > 0) tags.push(`reshuffles:${s.epochs.length}`);
    // The pile is empty and no spare deck is large enough for the discards (RULES.md "Platform rules").
    if (pileCount(s.pile) === 0 && s.discards.length > 0 && !canReshuffle(s)) tags.push('pile:stuck');
    if (s.wipes > 0) tags.push('yard:wipe');
    return tags;
  },
};
