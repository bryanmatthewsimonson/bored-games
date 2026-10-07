import { type Rng, range, shuffle } from './prng.ts';
import type { DeckSpec } from './types.ts';

/*
 * The deck orders that a packet's shuffle rounds can produce (PROTOCOL §5.5, D076). Round 1 shuffles every
 * first-round group within itself: each partition, or the whole deck when it has none. Round 2 then shuffles each
 * `secondRound` group's positions together. Both functions take a valid deck (the session checks it).
 */

/** The first round's groups: the partitions in list order, tiling the positions, or the whole deck as one. */
function firstRound(deck: DeckSpec): readonly { readonly offset: number; readonly size: number }[] {
  if (deck.partitions === undefined) return [{ offset: 0, size: deck.size }];
  let offset = 0;
  return deck.partitions.map((g) => {
    const group = { offset, size: g.size };
    offset += g.size;
    return group;
  });
}

/**
 * A deck order `order[pos] = card` that the rounds can produce, drawn from `rng`: one `shuffle` per first-round
 * group in list order (a plain deck is exactly `shuffle(range(size), rng)`), then one more `shuffle` per
 * second-round group in list order, over the cards its positions hold.
 */
export function packetOrder(deck: DeckSpec, rng: Rng): number[] {
  const order: number[] = [];
  for (const g of firstRound(deck)) {
    order.push(
      ...shuffle(
        range(g.size).map((n) => n + g.offset),
        rng,
      ),
    );
  }
  for (const g of deck.secondRound ?? []) {
    const mixed = shuffle(
      g.positions.map((p) => order[p] as number),
      rng,
    );
    g.positions.forEach((p, i) => {
      order[p] = mixed[i] as number;
    });
  }
  return order;
}

/**
 * Whether the rounds can produce `order`, which is exactly when all of these hold:
 * - it is a permutation of `0 .. size - 1`;
 * - a position outside every second-round group holds a card of its own first-round group;
 * - each second-round group holds, from every first-round group, as many cards as it has positions in that
 *   group: round 1 puts that many of the group's cards at those positions, and round 2 only moves them around
 *   inside the second-round group.
 * Never throws: anything else, a non-array included, is false.
 */
export function packetOrderFits(deck: DeckSpec, order: readonly number[]): boolean {
  const { size } = deck;
  if (!Array.isArray(order) || order.length !== size) return false;
  const seen = new Array<boolean>(size).fill(false);
  for (const card of order) {
    if (!Number.isInteger(card) || card < 0 || card >= size || seen[card] === true) return false;
    seen[card] = true;
  }
  const rounds = firstRound(deck);
  /** The first-round group of each position (and of each card, which starts at the position of its own number). */
  const group = new Array<number>(size).fill(-1);
  rounds.forEach((g, k) => {
    for (let p = g.offset; p < g.offset + g.size; p++) group[p] = k;
  });
  /** The second-round group of each position, or -1. */
  const mix = new Array<number>(size).fill(-1);
  const groups = deck.secondRound ?? [];
  groups.forEach((g, j) => {
    for (const p of g.positions) mix[p] = j;
  });
  /** `balance[j][k]`: the cards of first-round group k that second-round group j holds, less its positions in k. */
  const balance = groups.map(() => new Array<number>(rounds.length).fill(0));
  for (let p = 0; p < size; p++) {
    const own = group[p] as number;
    const held = group[order[p] as number] as number;
    const j = mix[p] as number;
    if (j < 0) {
      if (held !== own) return false;
    } else {
      const row = balance[j] as number[];
      row[held] = (row[held] as number) + 1;
      row[own] = (row[own] as number) - 1;
    }
  }
  return balance.every((row) => row.every((n) => n === 0));
}
