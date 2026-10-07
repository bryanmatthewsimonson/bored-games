import { describe, expect, it } from 'vitest';
import { createRng, type DeckSpec, packetOrder, packetOrderFits, range, shuffle } from '../src/index.ts';

const MIX = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11];
const partitions = [
  { id: 'a', size: 6 },
  { id: 'b', size: 6 },
];
/** Two partitions and no second round: the shuffle every partitioned game has today. */
const partitioned: DeckSpec = { id: 'cards', size: 12, partitions };
/** The same deck with a second round that mixes everything but each partition's first position (D076). */
const deck: DeckSpec = { ...partitioned, secondRound: [{ id: 'mix', positions: MIX }] };
/** Two second-round groups that each hold two positions of each partition. */
const twoMixes: DeckSpec = {
  id: 'd',
  size: 8,
  partitions: [
    { id: 'a', size: 4 },
    { id: 'b', size: 4 },
  ],
  secondRound: [
    { id: 'g1', positions: [0, 1, 4, 5] },
    { id: 'g2', positions: [2, 3, 6, 7] },
  ],
};

describe('packetOrder', () => {
  it('draws a plain deck exactly as shuffle(range(size))', () => {
    for (const seed of ['p1', 'p2', 'p3']) {
      const rng = createRng(seed);
      const rng2 = createRng(seed);
      expect(packetOrder({ id: 'x', size: 12 }, rng)).toEqual(shuffle(range(12), rng2));
      // One shuffle call and nothing else: both streams stand at the same place afterwards.
      expect(rng.int(1_000_000)).toBe(rng2.int(1_000_000));
    }
  });

  it('shuffles each partition within itself, in group order', () => {
    for (const seed of ['p1', 'p2', 'p3']) {
      const r = createRng(seed);
      const expected = [
        ...shuffle(range(6), r),
        ...shuffle(
          range(6).map((n) => n + 6),
          r,
        ),
      ];
      expect(packetOrder(partitioned, createRng(seed))).toEqual(expected);
    }
  });

  it('keeps positions outside the second round in their partition and mixes the rest', () => {
    let crossed = false;
    for (let i = 0; i < 50; i++) {
      const order = packetOrder(deck, createRng(`mix-${i}`));
      expect(order[0] as number).toBeLessThan(6);
      expect(order[6] as number).toBeGreaterThanOrEqual(6);
      const rest = MIX.map((p) => order[p] as number).sort((x, y) => x - y);
      expect(rest).toEqual(range(12).filter((c) => c !== order[0] && c !== order[6]));
      if ([7, 8, 9, 10, 11].some((p) => (order[p] as number) < 6)) crossed = true;
    }
    expect(crossed).toBe(true);
  });

  it('draws the second round after the first, one shuffle per group in list order', () => {
    for (const seed of ['q1', 'q2', 'q3']) {
      const r = createRng(seed);
      const expected = [
        ...shuffle(range(4), r),
        ...shuffle(
          range(4).map((n) => n + 4),
          r,
        ),
      ];
      for (const g of twoMixes.secondRound ?? []) {
        const mixed = shuffle(
          g.positions.map((p) => expected[p] as number),
          r,
        );
        g.positions.forEach((p, i) => {
          expected[p] = mixed[i] as number;
        });
      }
      expect(packetOrder(twoMixes, createRng(seed))).toEqual(expected);
    }
  });

  it('is a function of the deck and the stream alone', () => {
    expect(packetOrder(deck, createRng('same'))).toEqual(packetOrder(deck, createRng('same')));
    expect(packetOrder(deck, createRng('same'))).not.toEqual(packetOrder(deck, createRng('other')));
  });
});

describe('packetOrderFits', () => {
  it('says which orders a packet can produce', () => {
    for (let i = 0; i < 50; i++) {
      const rng = createRng(`fit-${i}`);
      expect(packetOrderFits(deck, packetOrder(deck, rng))).toBe(true);
      expect(packetOrderFits(partitioned, packetOrder(partitioned, rng))).toBe(true);
      expect(packetOrderFits(twoMixes, packetOrder(twoMixes, rng))).toBe(true);
      expect(packetOrderFits({ id: 'x', size: 12 }, packetOrder({ id: 'x', size: 12 }, rng))).toBe(true);
    }
    expect(packetOrderFits(deck, range(12))).toBe(true);
    // Not a permutation.
    expect(packetOrderFits(deck, Array(12).fill(0))).toBe(false);
    // A card of the second partition at position 0, and one of the first at position 6.
    expect(packetOrderFits(deck, [7, 1, 2, 3, 4, 5, 6, 0, 8, 9, 10, 11])).toBe(false);
    expect(packetOrderFits(deck, [0, 6, 2, 3, 4, 5, 1, 7, 8, 9, 10, 11])).toBe(false);
  });

  it('accepts a mix that moves cards across partitions, and only inside the second round', () => {
    // Position 0 keeps card 2 (partition a) and position 6 keeps card 9 (partition b); the rest is mixed.
    const mixed = [2, 7, 0, 8, 1, 10, 9, 3, 4, 5, 11, 6];
    expect(packetOrderFits(deck, mixed)).toBe(true);
    // Without a second round the same order is out of reach: card 7 sits at position 1, inside partition a.
    expect(packetOrderFits(partitioned, mixed)).toBe(false);
    // A plain deck takes every permutation.
    expect(packetOrderFits({ id: 'x', size: 12 }, mixed)).toBe(true);
  });

  it('holds each second-round group to the mix of partitions its positions have', () => {
    // g1 would hold all four cards of partition a: after the first round it holds two of each partition.
    expect(packetOrderFits(twoMixes, [0, 1, 4, 5, 2, 3, 6, 7])).toBe(false);
    expect(packetOrderFits(twoMixes, [0, 1, 2, 3, 4, 5, 6, 7])).toBe(true);
    // Two cards of each partition in each group, in any arrangement, is producible: g1 (positions 0, 1, 4, 5)
    // holds cards 4, 2, 0, 6 and g2 (positions 2, 3, 6, 7) holds 3, 7, 1, 5.
    expect(packetOrderFits(twoMixes, [4, 2, 3, 7, 0, 6, 1, 5])).toBe(true);
    // Swap card 0 (partition a, in g1) with card 7 (partition b, in g2): g1 now holds three cards of b.
    expect(packetOrderFits(twoMixes, [4, 2, 3, 0, 7, 6, 1, 5])).toBe(false);
  });

  it('refuses anything that is not a permutation of the deck, without throwing', () => {
    for (const order of [
      [],
      range(11),
      range(13),
      [...range(11), 11.5],
      [...range(11), -1],
      [...range(11), 12],
      [...range(11), Number.NaN],
      [...range(11), 0],
    ])
      expect(packetOrderFits(deck, order), JSON.stringify(order)).toBe(false);
    for (const bad of [null, undefined, 'abc', 12, {}])
      expect(packetOrderFits(deck, bad as unknown as number[])).toBe(false);
  });
});
