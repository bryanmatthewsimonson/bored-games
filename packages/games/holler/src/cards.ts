/** Opening deck size. Epoch positions start at multiples of `EPOCH_STRIDE`, which is past 108. */
export const DECK_SIZE = 108;
export const EPOCH_STRIDE = 128;

export type Suit = 0 | 1 | 2 | 3;

/** suit 0..3. Rank 0 once; ranks 1..9 twice (copy 0..1). */
export function numberCard(suit: number, rank: number, copy: number): number {
  return suit * 19 + (rank === 0 ? 0 : 1 + (rank - 1) * 2 + copy);
}

/** kind 0 halt, 1 swing, 2 pull. Two copies. Indices 76..99. */
export function actionCard(suit: number, kind: number, copy: number): number {
  return 76 + suit * 6 + kind * 2 + copy;
}

export function isSuit(n: unknown): n is Suit {
  return n === 0 || n === 1 || n === 2 || n === 3;
}

export function isCard(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n < DECK_SIZE && !Object.is(n, -0);
}

export interface Face {
  readonly kind: 'number' | 'halt' | 'swing' | 'pull' | 'mark' | 'levy';
  readonly suit: Suit | null;
  readonly rank: number | null;
  readonly action: 0 | 1 | 2 | null;
}

export function faceOf(card: number): Face {
  if (card >= 104) return { kind: 'levy', suit: null, rank: null, action: null };
  if (card >= 100) return { kind: 'mark', suit: null, rank: null, action: null };
  if (card >= 76) {
    const rel = card - 76;
    const suit = Math.floor(rel / 6) as Suit;
    const action = Math.floor((rel % 6) / 2) as 0 | 1 | 2;
    const kind = action === 0 ? 'halt' : action === 1 ? 'swing' : 'pull';
    return { kind, suit, rank: null, action };
  }
  const suit = Math.floor(card / 19) as Suit;
  const within = card % 19;
  const rank = within === 0 ? 0 : 1 + Math.floor((within - 1) / 2);
  return { kind: 'number', suit, rank, action: null };
}

/** Rank for a number, 20 for Halt, Swing, or Pull, 50 for Mark or Levy. */
export function pointsOf(card: number): number {
  const face = faceOf(card);
  if (face.kind === 'mark' || face.kind === 'levy') return 50;
  if (face.kind === 'number') return face.rank ?? 0;
  return 20;
}

export function bears(card: number, suit: Suit | null): boolean {
  if (suit === null) return false;
  return faceOf(card).suit === suit;
}

/** Suit, or rank against a number, or the same action kind. Mark and Levy match anything. */
export function matches(card: number, top: number, active: Suit | null): boolean {
  const face = faceOf(card);
  if (face.kind === 'mark' || face.kind === 'levy') return true;
  if (active !== null && face.suit === active) return true;
  const above = faceOf(top);
  if (face.kind === 'number' && above.kind === 'number' && face.rank === above.rank) return true;
  return face.action !== null && face.action === above.action;
}

/** Card at a live position. Opening positions read epoch 0. Later epochs use `EPOCH_STRIDE`. */
export function cardAt(orders: readonly (readonly number[] | null)[], pos: number): number | null {
  if (!Number.isSafeInteger(pos) || pos < 0) return null;
  const epoch = pos < DECK_SIZE ? 0 : Math.floor(pos / EPOCH_STRIDE);
  const index = pos < DECK_SIZE ? pos : pos % EPOCH_STRIDE;
  const order = orders[epoch];
  if (!order) return null;
  const card = order[index];
  return card === undefined ? null : card;
}

export function sameMultiset(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.slice().sort((x, y) => x - y);
  const right = b.slice().sort((x, y) => x - y);
  return left.every((card, i) => card === right[i]);
}

/** True when `cards` is exactly the identities 0..107, once each. */
export function isFullDeck(cards: readonly number[]): boolean {
  if (cards.length !== DECK_SIZE) return false;
  const seen = new Set(cards);
  if (seen.size !== DECK_SIZE) return false;
  for (let card = 0; card < DECK_SIZE; card++) if (!seen.has(card)) return false;
  return true;
}
