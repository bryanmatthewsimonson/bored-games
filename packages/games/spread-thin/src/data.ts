/*
 * The components of Spread Thin (docs/games/spread-thin/RULES.md, "Components") and the deck layout (D096). Pure
 * data: theme.ts names everything.
 */
import type { DeckSpec } from '@bored-games/game-kit';
import { CITY_COUNT } from './map.ts';
import type { SpreadRules } from './types.ts';

export const MIN_SEATS = 2;
export const MAX_SEATS = 4;
/** Actions in a turn (C06). */
export const ACTIONS_PER_TURN = 4;
/** Field cards a seat may hold (C19); the Archivist's stored card does not count. */
export const HAND_LIMIT = 7;
/** Case tokens of each strain (C21). */
export const CASES_PER_STRAIN = 24;
/** Clinics in the box (C10). */
export const CLINIC_LIMIT = 6;
/** The most cases of one strain a city holds; one more spills over (C20). */
export const MAX_CASES = 3;
/** Spillovers that lose the game (C21). */
export const SPILL_LIMIT = 8;
/** The spread-rate track (C18). */
export const SPREAD_RATES: readonly number[] = [2, 2, 2, 3, 3, 4, 4];
/** City cards a cure takes, and the Virologist's (C13). */
export const CURE_CARDS = 5;
export const VIROLOGIST_CURE_CARDS = 4;
/** Opening hand size per seat count (C03). */
export const HAND_SIZES: Readonly<Record<number, number>> = { 2: 4, 3: 3, 4: 2 };
/** The opening infection: three cities with 3 cases, three with 2, three with 1 (C04). */
export const OPENING_INFECTION: readonly number[] = [3, 3, 3, 2, 2, 2, 1, 1, 1];

/** The roles (C05), by index. */
export const ROLES = [
  'archivist',
  'coordinator',
  'paramedic',
  'engineer',
  'warden',
  'courier',
  'virologist',
] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_COUNT = ROLES.length;
export const roleIndex = (role: Role): number => ROLES.indexOf(role);

/** The relief cards (C22), by index; a relief card's field id is `RELIEF_BASE + index`. */
export const RELIEFS = ['medevac', 'warning', 'permit', 'lull', 'immunity'] as const;
export type Relief = (typeof RELIEFS)[number];
export const RELIEF_BASE = CITY_COUNT;
export const FIELD_COUNT = CITY_COUNT + RELIEFS.length;
export const reliefCard = (relief: Relief): number => RELIEF_BASE + RELIEFS.indexOf(relief);
export const isRelief = (card: number): boolean => card >= RELIEF_BASE && card < FIELD_COUNT;
export const reliefOf = (card: number): Relief | null => RELIEFS[card - RELIEF_BASE] ?? null;

/** The deck's id: `pile`, the id the client runs reshuffle epochs for (D073). */
export const DECK_ID = 'pile';
/** The stride between reshuffles' positions (PROTOCOL §5, D073): restack k deals positions 128k + i. */
export const EPOCH_STRIDE = 128;

/*
 * The deck `pile` (D096). Card ids, and the positions of the first shuffle round, run in four groups:
 * - 0–47, the spread cards: card c names city c;
 * - 48–100, the field cards: card 48 + f is field card f (a city card for f < 48, else a relief);
 * - the surges, `surges` of them;
 * - the seven role cards.
 * The second round mixes each pile of the field deck with its surge (PROTOCOL §5.5), so no position shows where a
 * surge lies. The piles depend on the opening hands, so on the seat count.
 */
export const SPREAD_BASE = 0;
export const FIELD_BASE = CITY_COUNT;
export const SURGE_BASE = FIELD_BASE + FIELD_COUNT;
export const roleBase = (rules: SpreadRules): number => SURGE_BASE + rules.surges;
export const deckSize = (rules: SpreadRules): number => roleBase(rules) + ROLE_COUNT;

/** The field-deck positions of each pile, top pile first, each holding its surge's position last (C03). */
export function pilesOf(rules: SpreadRules, seats: number): number[][] {
  const hand = (HAND_SIZES[seats] ?? 4) * seats;
  const rest = FIELD_COUNT - hand;
  const base = Math.floor(rest / rules.surges);
  const extra = rest % rules.surges;
  const out: number[][] = [];
  let next = FIELD_BASE + hand;
  for (let k = 0; k < rules.surges; k++) {
    // The larger piles go on top: the smaller ones at the bottom.
    const size = base + (k < extra ? 1 : 0);
    out.push([...Array.from({ length: size }, (_, i) => next + i), SURGE_BASE + k]);
    next += size;
  }
  return out;
}

/**
 * The deck for `rules` at `seats` seats. Without `seats` (a caller that reads only the id, size or presence of the
 * deck), the layout for two seats: only the second round's groups depend on the seat count.
 */
export function deckOf(rules: SpreadRules, seats = MIN_SEATS): DeckSpec {
  return {
    id: DECK_ID,
    size: deckSize(rules),
    partitions: [
      { id: 'spread', size: CITY_COUNT },
      { id: 'field', size: FIELD_COUNT },
      { id: 'surge', size: rules.surges },
      { id: 'roles', size: ROLE_COUNT },
    ],
    secondRound: pilesOf(rules, seats).map((positions, k) => ({ id: `pile${k + 1}`, positions })),
    promptShares: true,
  };
}
