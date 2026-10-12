/*
 * The components of Sticks & Stones (docs/games/sticks-and-stones/RULES.md, "Components"): the four goods, the 36
 * discovery cards and the 28 monument tiles, by engine id only. Every display name is in theme.ts. Pure data.
 */

/** The goods, in this order everywhere: a payment or a stock is `[wood, brick, stone, gold]`. */
export const GOODS = ['wood', 'brick', 'stone', 'gold'] as const;
export type Good = (typeof GOODS)[number];
/** What one of each good is worth: in a variable monument's points and as a divisor of a gathering roll. */
export const GOOD_VALUES: readonly number[] = [3, 4, 5, 6];
/** The divisor of a hunting roll. */
export const FOOD_DIVISOR = 2;

/** The culture symbols: two cards of each. */
export const SYMBOLS = [
  'writing',
  'medicine',
  'pottery',
  'art',
  'music',
  'weaving',
  'calendar',
  'transport',
] as const;
export type CultureSymbol = (typeof SYMBOLS)[number];

/** The four figures of the multiplier cards: each scores its figures times one quantity. */
export const FIGURES = ['farmer', 'toolmaker', 'builder', 'shaman'] as const;
export type Figure = (typeof FIGURES)[number];

/** A discovery's immediate effect (the top of the card). */
export type Effect =
  /** Roll a die per player; from the buyer on, each player takes one (RULES.md "Gifts of the dice"). */
  | { readonly type: 'dice' }
  | { readonly type: 'food'; readonly n: number }
  /** `n` of one good. */
  | { readonly type: 'goods'; readonly good: number; readonly n: number }
  /** Roll two dice for one good, as a gathering with two people; tools may be added. */
  | { readonly type: 'roll'; readonly good: number }
  | { readonly type: 'points'; readonly n: number }
  /** A tool of this value that is used once and then gone. */
  | { readonly type: 'oneUse'; readonly n: number }
  /** One step on the tool ladder, as at the toolmaker. */
  | { readonly type: 'tool' }
  /** One step on the harvest track, as at the field. */
  | { readonly type: 'field' }
  /** Two goods of the buyer's choice, taken now or at a later decision of theirs. */
  | { readonly type: 'choose' }
  /** The top card of the pile, face down: it scores at the end but has no effect. */
  | { readonly type: 'extra' };

/** A discovery's scoring part (the bottom of the card). */
export type Bottom =
  | { readonly kind: 'culture'; readonly symbol: number }
  | { readonly kind: 'figure'; readonly figure: number; readonly count: number };

export interface Discovery {
  readonly top: Effect;
  readonly bottom: Bottom;
}

const culture = (symbol: number, top: Effect): Discovery => ({ top, bottom: { kind: 'culture', symbol } });
const figure = (fig: number, count: number, top: Effect): Discovery => ({
  top,
  bottom: { kind: 'figure', figure: fig, count },
});
const DICE: Effect = { type: 'dice' };
const food = (n: number): Effect => ({ type: 'food', n });
const goods = (good: number, n: number): Effect => ({ type: 'goods', good, n });

/** The 36 discoveries, cards 0–35 of the deck (RULES.md C03). Goods: 0 wood, 1 brick, 2 stone, 3 gold. */
export const DISCOVERIES: readonly Discovery[] = [
  // Culture: two cards per symbol.
  culture(0, { type: 'extra' }),
  culture(0, DICE),
  culture(1, food(5)),
  culture(1, { type: 'choose' }),
  culture(2, food(7)),
  culture(2, DICE),
  culture(3, { type: 'roll', good: 3 }),
  culture(3, { type: 'tool' }),
  culture(4, { type: 'points', n: 3 }),
  culture(4, { type: 'points', n: 3 }),
  culture(5, food(1)),
  culture(5, food(3)),
  culture(6, { type: 'field' }),
  culture(6, DICE),
  culture(7, goods(2, 2)),
  culture(7, DICE),
  // Farmers (7 figures).
  figure(0, 1, { type: 'field' }),
  figure(0, 1, goods(2, 1)),
  figure(0, 1, DICE),
  figure(0, 2, food(3)),
  figure(0, 2, DICE),
  // Toolmakers (8 figures).
  figure(1, 1, { type: 'oneUse', n: 4 }),
  figure(1, 1, { type: 'oneUse', n: 3 }),
  figure(1, 2, { type: 'oneUse', n: 2 }),
  figure(1, 2, DICE),
  figure(1, 2, DICE),
  // Builders (9 figures).
  figure(2, 1, food(4)),
  figure(2, 1, DICE),
  figure(2, 2, food(2)),
  figure(2, 2, DICE),
  figure(2, 3, { type: 'points', n: 3 }),
  // Shamans (7 figures).
  figure(3, 1, goods(3, 1)),
  figure(3, 1, goods(2, 1)),
  figure(3, 1, { type: 'roll', good: 2 }),
  figure(3, 2, goods(1, 1)),
  figure(3, 2, { type: 'roll', good: 0 }),
];

/** A monument's price. */
export type Monument =
  /** Exactly these goods; it scores their value. */
  | { readonly kind: 'fixed'; readonly cost: readonly number[] }
  /** `count` goods of exactly `kinds` different kinds, chosen by the builder; it scores their value. */
  | { readonly kind: 'kinds'; readonly count: number; readonly kinds: number }
  /** One to seven goods of any kinds; it scores their value. */
  | { readonly kind: 'any' };

const fixed = (cost: readonly number[]): Monument => ({ kind: 'fixed', cost });
const kinds = (count: number, k: number): Monument => ({ kind: 'kinds', count, kinds: k });

/** The 28 monuments, cards 36–63 of the deck as monument 0–27 (RULES.md C04). */
export const MONUMENTS: readonly Monument[] = [
  fixed([2, 1, 0, 0]),
  fixed([2, 0, 1, 0]),
  fixed([1, 2, 0, 0]),
  fixed([2, 0, 0, 1]),
  fixed([0, 2, 1, 0]),
  fixed([1, 0, 2, 0]),
  fixed([0, 1, 2, 0]),
  fixed([0, 2, 0, 1]),
  fixed([0, 0, 2, 1]),
  fixed([1, 1, 1, 0]),
  fixed([1, 1, 1, 0]),
  fixed([1, 1, 0, 1]),
  fixed([1, 1, 0, 1]),
  fixed([1, 0, 1, 1]),
  fixed([1, 0, 1, 1]),
  fixed([0, 1, 1, 1]),
  fixed([0, 1, 1, 1]),
  kinds(4, 1),
  kinds(4, 2),
  kinds(4, 3),
  kinds(4, 4),
  kinds(5, 1),
  kinds(5, 2),
  kinds(5, 3),
  kinds(5, 4),
  { kind: 'any' },
  { kind: 'any' },
  { kind: 'any' },
];

export const DISCOVERY_COUNT = 36;
export const MONUMENT_COUNT = 28;
/** Tiles in each monument stack; a game uses one stack per player. */
export const STACK_SIZE = 7;
/** The deck: positions 0–35 hold the discoveries, 36–63 the monuments, each group shuffled on its own. */
export const DECK_SIZE = DISCOVERY_COUNT + MONUMENT_COUNT;
export const DISPLAY_SLOTS = 4;

/** The value of a payment of goods. */
export const goodsValue = (pay: readonly number[]): number =>
  pay.reduce((n, k, i) => n + k * (GOOD_VALUES[i] ?? 0), 0);

/** Whether `card` (a deck card number) is a discovery. */
export const isDiscovery = (card: number): boolean => card >= 0 && card < DISCOVERY_COUNT;

/** The monument of a deck card number (36–63), or undefined. */
export const monumentOf = (card: number): Monument | undefined =>
  card >= DISCOVERY_COUNT ? MONUMENTS[card - DISCOVERY_COUNT] : undefined;

/** Every payment that buys `m` from `stock` (goods held), each `[wood, brick, stone, gold]`, in a fixed order. */
export function monumentPayments(m: Monument, stock: readonly number[]): number[][] {
  if (m.kind === 'fixed') return m.cost.every((n, i) => n <= (stock[i] ?? 0)) ? [[...m.cost]] : [];
  const out: number[][] = [];
  const sizes = m.kind === 'any' ? [1, 2, 3, 4, 5, 6, 7] : [m.count];
  for (const size of sizes)
    for (const pay of vectors(stock, size))
      if (m.kind === 'any' || pay.filter((n) => n > 0).length === m.kinds) out.push(pay);
  return out;
}

/** Every `[w, b, s, g]` with each entry at most `stock`'s and the given total, in lexicographic order. */
export function vectors(stock: readonly number[], total: number): number[][] {
  const out: number[][] = [];
  const visit = (i: number, left: number, xs: number[]): void => {
    if (i === 3) {
      if (left <= (stock[3] ?? 0)) out.push([...xs, left]);
      return;
    }
    for (let n = 0; n <= Math.min(stock[i] ?? 0, left); n++) visit(i + 1, left - n, [...xs, n]);
  };
  if (total >= 0) visit(0, total, []);
  return out;
}

/** The points of a monument bought with `pay` (a valid payment). */
export const monumentPoints = (pay: readonly number[]): number => goodsValue(pay);
