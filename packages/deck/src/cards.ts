import { encodePoint, type Point } from './encoding.ts';
import { h2c } from './group.ts';

function checkIndex(m: number, what: string): void {
  if (!Number.isSafeInteger(m) || m < 0) throw new RangeError(`${what} must be a non-negative safe integer`);
}

/** The curve point standing for card `m` of deck `deckId`: `h2c('card:<deckId>:<m>')`. */
export function cardPoint(deckId: string, m: number): Point {
  if (typeof deckId !== 'string' || deckId.length === 0 || deckId.includes(':')) {
    throw new RangeError('cardPoint: deckId must be a non-empty string without ":"');
  }
  checkIndex(m, 'cardPoint: m');
  return h2c(`card:${deckId}:${m}`);
}

/** Lookup from the wire encoding of each card point to its card index. */
export function cardTable(deckId: string, size: number): Map<string, number> {
  checkIndex(size, 'cardTable: size');
  const table = new Map<string, number>();
  for (let m = 0; m < size; m++) table.set(encodePoint(cardPoint(deckId, m)), m);
  return table;
}

/** The card index for a decrypted point, or `null` when it is not a card of this table (including the identity). */
export function cardOf(table: ReadonlyMap<string, number>, P: Point): number | null {
  if (P.is0()) return null;
  return table.get(encodePoint(P)) ?? null;
}
