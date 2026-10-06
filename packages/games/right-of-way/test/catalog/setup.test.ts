import { describe, expect, it } from 'vitest';
import { CHARTER_COUNT, DECK_SIZE, ENGINE, FREIGHT_SIZE, freightColor, GROUPS } from '../../src/deck.ts';
import { CHARTERS, ROUTES, TOWNS } from '../../src/map.ts';
import { rightOfWay } from '../../src/module.ts';
import { connects, TRACK } from '../../src/scoring.ts';
import { act, card, charterCard, expectOk, keepAll, legal, orderWith, refused, setup } from '../helpers.ts';

describe('setup', () => {
  it('C01 components: 110 freight cards, 30 charters, 45 track, the 85 tabled routes', () => {
    const colors = Array.from({ length: FREIGHT_SIZE }, (_, f) => freightColor(f));
    for (let c = 0; c < 8; c++) expect(colors.filter((x) => x === c)).toHaveLength(12);
    expect(colors.filter((x) => x === ENGINE)).toHaveLength(14);
    expect(CHARTERS).toHaveLength(CHARTER_COUNT);
    expect(ROUTES).toHaveLength(85);
    expect(ROUTES.filter((r) => r.sides.length === 2)).toHaveLength(22);
    expect(ROUTES.reduce((n, r) => n + r.sides.length, 0)).toBe(107);
    expect(ROUTES.reduce((n, r) => n + r.length * r.sides.length, 0)).toBe(332);
    const pairs = new Set(ROUTES.map((r) => [r.a, r.b].sort().join('-')));
    expect(pairs.size).toBe(85);
    const all = ROUTES.map((_, i) => i);
    for (let t = 1; t < TOWNS.length; t++) expect(connects(all, 0, t)).toBe(true);
    const s = setup(3);
    expect(s.players.every((p) => p.track === TRACK)).toBe(true);
    // The tabled colours, per side: 28–30 spaces each, 99 unmarked.
    const spaces = new Map<string, number>();
    for (const r of ROUTES) for (const c of r.sides) spaces.set(c, (spaces.get(c) ?? 0) + r.length);
    expect(spaces.get('gray')).toBe(99);
    for (const [c, n] of spaces) if (c !== 'gray') expect(n).toBeGreaterThanOrEqual(28);
    expect(GROUPS.map((g) => g.size)).toEqual([110, 110, 110, 110, 110, 30]);
    expect(DECK_SIZE).toBe(580);
  });

  it('C02 charter values are the shortest connections, 4–22, totalling 363', () => {
    const dist = TOWNS.map((_, a) => TOWNS.map((__, b) => (a === b ? 0 : Number.POSITIVE_INFINITY)));
    for (const r of ROUTES) {
      (dist[r.a] as number[])[r.b] = Math.min((dist[r.a] as number[])[r.b] as number, r.length);
      (dist[r.b] as number[])[r.a] = (dist[r.a] as number[])[r.b] as number;
    }
    const n = TOWNS.length;
    for (let k = 0; k < n; k++)
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const via = ((dist[i] as number[])[k] as number) + ((dist[k] as number[])[j] as number);
          if (via < ((dist[i] as number[])[j] as number)) (dist[i] as number[])[j] = via;
        }
    for (const c of CHARTERS) expect(c.value).toBe((dist[c.a] as number[])[c.b]);
    expect(Math.min(...CHARTERS.map((c) => c.value))).toBe(4);
    expect(Math.max(...CHARTERS.map((c) => c.value))).toBe(22);
    expect(CHARTERS.reduce((x, c) => x + c.value, 0)).toBe(363);
  });

  it('C03 two to five seats are accepted; one and six are rejected', () => {
    const order = { rail: orderWith() };
    for (const seats of [2, 3, 4, 5])
      expect(
        rightOfWay.setup({ rules: rightOfWay.defaultRules(), seats, mode: 'full', deckOrders: order }).ok,
      ).toBe(true);
    for (const seats of [1, 6])
      expect(
        rightOfWay.setup({ rules: rightOfWay.defaultRules(), seats, mode: 'full', deckOrders: order }).ok,
      ).toBe(false);
    expect(rightOfWay.seatRange(rightOfWay.defaultRules())).toEqual({ min: 2, max: 5 });
  });

  it('C04 the deal: 4 freight cards and 3 charters each, 5 face up, the rest in the pile', () => {
    for (const seats of [2, 3, 4, 5]) {
      const s = setup(seats);
      for (const p of s.players) {
        expect(p.hand).toHaveLength(4);
        expect(p.offered).toHaveLength(3);
      }
      expect(s.yard.every((y) => y !== null && y.card !== null)).toBe(true);
      expect(FREIGHT_SIZE - s.pile.next).toBe(110 - 4 * seats - 5);
      expect(s.charterPile).toHaveLength(CHARTER_COUNT - 3 * seats);
      expectOk(s);
    }
  });

  it('C05 first charters: keep 2 or 3, in seat order from the first player; returns go to the bottom', () => {
    const s = setup(3);
    const first = s.turn;
    expect(s.phase).toBe('keep');
    expect(legal(s).map((a) => (a.type === 'keep' ? a.keep : null))).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
      [0, 1, 2],
    ]);
    for (const keep of [[0], [], [0, 3], [1, 0], [0, 0]])
      expect(refused(s, { type: 'keep', actor: first, keep })).not.toBeNull();
    const t = act(s, { type: 'keep', actor: first, keep: [0, 2] });
    expect(t.turn).toBe((first + 1) % 3);
    expect(t.charterPile.at(-1)).toBe(s.players[first]?.offered[1]?.pos);
    expect(t.players[first]?.charters.map((c) => c.card)).toEqual([
      s.players[first]?.offered[0]?.card,
      s.players[first]?.offered[2]?.card,
    ]);
    const u = keepAll(t);
    expect(u.phase).toBe('turn');
    expect(u.turn).toBe(first);
    expect(charterCard(0)).toBe(GROUPS[5]?.offset);
  });

  it('C06 the first player comes from the setup yard: every seat equally likely', () => {
    for (const seats of [2, 3, 4, 5]) {
      const counts = new Array<number>(seats).fill(0);
      const limit = 110 - (110 % seats);
      // Every freight card as the first yard card: the seat is that card modulo the seat count, or the next slot.
      for (let f = 0; f < limit; f++) {
        const s = setup(seats, orderWith([[seats * 4, f]]));
        expect(s.startingSeat).toBe(f % seats);
        counts[f % seats] = (counts[f % seats] ?? 0) + 1;
      }
      expect(new Set(counts).size).toBe(1);
      if (limit < 110) {
        const s = setup(seats, orderWith([[seats * 4, 109]]));
        expect(s.startingSeat).toBe((s.yard[1]?.card as number) % seats);
      }
    }
    // Spectators and seats fold the same start.
    const full = setup(4, orderWith([[16, 7]]));
    expect(rightOfWay.view(full, null).startingSeat).toBe(3);
    expect(card(0)).toBe(0);
  });
});
