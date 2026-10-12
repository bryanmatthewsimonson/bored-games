/*
 * The final count (RULES.md "The end of the game"): culture sets, figures, goods left, and the tie-break. Pure.
 */
import type { Outcome } from '@bored-games/game-kit';
import { DISCOVERIES, FIGURES, SYMBOLS } from './data.ts';
import type { Clan, SticksRules, SticksState } from './types.ts';
import { sum } from './util.ts';

export interface Tally {
  /** The score track: monuments, card points and hunger. */
  readonly track: number;
  readonly culture: number;
  /** Per figure (farmer, toolmaker, builder, shaman): figures × the quantity they count. */
  readonly figures: readonly number[];
  /** Goods left, one point each (food scores nothing). */
  readonly goods: number;
  readonly total: number;
}

/** The discoveries that count for `clan`: those taken, and the face-down ones that are known (or open). */
export function countedCards(c: Clan, publicOnly: boolean): number[] {
  return [
    ...c.cards,
    ...c.hidden.flatMap((h) => (h.card !== null && (h.open || !publicOnly) ? [h.card] : [])),
  ];
}

/** Culture points: the distinct symbols squared, then the duplicates squared or one each (C27). */
export function culturePoints(cards: readonly number[], rules: SticksRules): number {
  const counts = SYMBOLS.map(() => 0);
  for (const card of cards) {
    const b = DISCOVERIES[card]?.bottom;
    if (b?.kind === 'culture') counts[b.symbol] = (counts[b.symbol] ?? 0) + 1;
  }
  const first = counts.filter((n) => n >= 1).length;
  const second = counts.filter((n) => n >= 2).length;
  return first * first + (rules.duplicates === 'squared' ? second * second : second);
}

/** The figures of each kind on `cards`. */
export function figureCounts(cards: readonly number[]): number[] {
  const out = FIGURES.map(() => 0);
  for (const card of cards) {
    const b = DISCOVERIES[card]?.bottom;
    if (b?.kind === 'figure') out[b.figure] = (out[b.figure] ?? 0) + b.count;
  }
  return out;
}

/** What each figure counts: harvest, tool value (spares excluded), monuments, people. */
export const figureBases = (c: Clan): number[] => [c.field, sum(c.tools), c.monuments.length, c.people];

/** `clan`'s score if the game ended now. `publicOnly` leaves out face-down cards still closed (standings). */
export function tally(c: Clan, rules: SticksRules, publicOnly: boolean): Tally {
  const cards = countedCards(c, publicOnly);
  const culture = culturePoints(cards, rules);
  const bases = figureBases(c);
  const figures = figureCounts(cards).map((n, i) => n * (bases[i] ?? 0));
  const goods = sum(c.goods);
  return { track: c.score, culture, figures, goods, total: c.score + culture + sum(figures) + goods };
}

/** The tie-break: harvest plus tool value plus people (C28). */
export const tieBreak = (c: Clan): number => c.field + sum(c.tools) + c.people;

/** The result: scores, then places by score and the tie-break; still equal shares a place. */
export function outcomeOf(s: SticksState, reason: 'pile' | 'monuments'): Outcome {
  const scores = s.clans.map((c) => tally(c, s.rules, false).total);
  const ties = s.clans.map(tieBreak);
  const places = s.clans.map(
    (_, i) =>
      1 +
      s.clans.filter(
        (_, j) =>
          (scores[j] ?? 0) > (scores[i] ?? 0) || (scores[j] === scores[i] && (ties[j] ?? 0) > (ties[i] ?? 0)),
      ).length,
  );
  return { scores, places, reason };
}
