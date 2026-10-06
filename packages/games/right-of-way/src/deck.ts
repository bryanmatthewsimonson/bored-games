/*
 * The one encrypted packet Right of Way plays with (deck id `rail`, docs/games/right-of-way/RULES.md, "Online play"),
 * in contiguous groups that are shuffled independently (DeckSpec.partitions):
 * - `freight`: the 110 freight cards. Card `f` (0–109) is colour `floor(f / 12)` for f < 96 (red, orange, yellow,
 *   green, blue, purple, white, black) and an Engine for f >= 96.
 * - `spare-1` … `spare-4`: four shuffled index decks of 110 cards. A reshuffle of n discards uses the next unused
 *   one: its card v < n stands for the v-th discard (in ascending card order), and a card v >= n is skipped. The
 *   order of the members is a uniform random order of the discards, which is exactly a fair reshuffle, and a
 *   skipped card says nothing about the others (C15). Four is a margin: 4000 fuzzed games never needed more than
 *   three (five seats), so a game that would need a fifth is a platform limit (RULES.md "Platform rules").
 * - `charters`: the 30 charters, card `CHARTER_OFFSET + t` for charter t.
 * Card ids are packet ids: a group's cards are numbered from its offset, as the partitioned shuffle deals them.
 */

export const DECK_ID = 'rail';
export const FREIGHT_SIZE = 110;
export const ENGINE = 8;
export const COLOR_COUNT = 8;
export const SPARE_SIZES: readonly number[] = [110, 110, 110, 110];
export const CHARTER_COUNT = 30;

export interface Group {
  readonly id: string;
  readonly offset: number;
  readonly size: number;
}

/** Groups in packet order: freight, the spares, the charters. Group index 0 is freight; 1..SPARES are spares. */
export const GROUPS: readonly Group[] = (() => {
  const out: Group[] = [];
  let offset = 0;
  const add = (id: string, size: number): void => {
    out.push({ id, offset, size });
    offset += size;
  };
  add('freight', FREIGHT_SIZE);
  for (const [i, size] of SPARE_SIZES.entries()) add(`spare-${i + 1}`, size);
  add('charters', CHARTER_COUNT);
  return out;
})();

export const CHARTER_GROUP = GROUPS.length - 1;
export const CHARTER_OFFSET = (GROUPS[CHARTER_GROUP] as Group).offset;
export const DECK_SIZE = CHARTER_OFFSET + CHARTER_COUNT;

/** The group index holding packet position (or card) `n`, or -1 outside the packet. */
export function groupOf(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) return -1;
  return GROUPS.findIndex((g) => n >= g.offset && n < g.offset + g.size);
}

/** A freight card's colour index: 0–7, or ENGINE. */
export function freightColor(f: number): number {
  return f >= COLOR_COUNT * 12 ? ENGINE : Math.floor(f / 12);
}

/** The charter index (0–29) of a charter card id, or -1. */
export function charterOf(card: number): number {
  return groupOf(card) === CHARTER_GROUP ? card - CHARTER_OFFSET : -1;
}
