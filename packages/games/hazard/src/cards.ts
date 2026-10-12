/*
 * The charters (RULES.md "Charters"): cards 0–41 show the province of the same index in PROVINCES, each with one of
 * three kinds, fourteen of each; cards 42 and 43 are Crowns, which stand for any kind. Pure.
 */
import { PROVINCES, type ProvinceId } from './map.ts';

export const CARD_COUNT = 44;

export type CharterKind = 'spear' | 'horse' | 'cannon' | 'crown';

const KINDS: readonly CharterKind[] = ['spear', 'horse', 'cannon'];

export const kindOf = (card: number): CharterKind =>
  card < PROVINCES.length ? (KINDS[card % 3] as CharterKind) : 'crown';

/** The province a charter shows, or null for a Crown. */
export const provinceOfCard = (card: number): ProvinceId | null => PROVINCES[card] ?? null;

/** Three alike, one of each, or any two with a Crown (Crowns stand for any kind). */
export function isSet(cards: readonly number[]): boolean {
  if (cards.length !== 3 || new Set(cards).size !== 3) return false;
  if (cards.some((c) => !Number.isSafeInteger(c) || c < 0 || c >= CARD_COUNT)) return false;
  const kinds = cards.map(kindOf).filter((k) => k !== 'crown');
  if (kinds.length < 3) return true;
  const distinct = new Set(kinds).size;
  return distinct === 1 || distinct === 3;
}

/** The troops a set pays when `cashed` sets have been cashed before it, by anyone: 4, 6, 8, 10, 12, 15, 20, 25… */
export function setValue(cashed: number): number {
  const early = [4, 6, 8, 10, 12, 15];
  return early[cashed] ?? 15 + 5 * (cashed - 5);
}
