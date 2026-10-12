import { describe, expect, it } from 'vitest';
import { DISCOVERIES, FIGURES, goodsValue, MONUMENTS, monumentPayments, SYMBOLS } from '../../src/data.ts';
import { DECK_ID, DEFAULT_RULES, pendingOf, setupGame } from '../../src/engine.ts';
import { fresh, orderWith, revealAll, started } from '../helpers.ts';

describe('setup', () => {
  it('C01 two to four players start with five people, twelve food, no harvest, no tools, and a stack each', () => {
    for (const seats of [1, 5]) {
      const r = setupGame({
        rules: DEFAULT_RULES,
        seats,
        mode: 'full',
        deckOrders: { [DECK_ID]: orderWith() },
      });
      expect(r.ok).toBe(false);
    }
    const s0 = fresh(3);
    expect(pendingOf(s0)).toEqual({ type: 'reveal', deck: DECK_ID, positions: [0, 1, 2, 3, 36, 43, 50] });
    const s = revealAll(s0);
    for (const c of s.clans) {
      expect([c.people, c.food, c.field, c.tools.length, c.score]).toEqual([5, 12, 0, 0, 0]);
      expect(c.goods).toEqual([0, 0, 0, 0]);
    }
    expect(s.display.map((d) => d?.card)).toEqual([0, 1, 2, 3]);
    expect(s.stacks).toEqual([
      { built: 0, top: 36 },
      { built: 0, top: 43 },
      { built: 0, top: 50 },
    ]);
    expect(s.home).toEqual([5, 5, 5]);
    expect(s.next).toBe(4);
    expect(s.dealt.map((d) => [d.pos, d.to])).toEqual([0, 1, 2, 3, 36, 43, 50].map((p) => [p, null]));
    expect(started(2).stacks).toHaveLength(2);
    expect(started(4).stacks).toHaveLength(4);
  });

  it('C02 the first card of the opening display, counted round the table, names the first player', () => {
    const s = started(4, orderWith([7]));
    expect(s.first).toBe(3);
    expect(s.turn).toBe(3);
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 3, decision: 'place' });
    expect(started(3, orderWith([7])).first).toBe(1);
    expect(started(2, orderWith([7])).first).toBe(1);
    // A view must not take the first player from a card at another slot.
    expect(fresh(2).first).toBeNull();
  });

  it('C03 the 36 discoveries: 16 culture cards, two per symbol, and 20 figure cards', () => {
    expect(DISCOVERIES).toHaveLength(36);
    const culture = DISCOVERIES.filter((d) => d.bottom.kind === 'culture');
    expect(culture).toHaveLength(16);
    for (let sym = 0; sym < SYMBOLS.length; sym++)
      expect(culture.filter((d) => d.bottom.kind === 'culture' && d.bottom.symbol === sym)).toHaveLength(2);
    const figures = FIGURES.map((_, f) =>
      DISCOVERIES.reduce(
        (n, d) => n + (d.bottom.kind === 'figure' && d.bottom.figure === f ? d.bottom.count : 0),
        0,
      ),
    );
    expect(figures).toEqual([7, 8, 9, 7]);
    const tops = (t: string) => DISCOVERIES.filter((d) => d.top.type === t).length;
    expect([tops('dice'), tops('food'), tops('goods'), tops('roll'), tops('points'), tops('oneUse')]).toEqual(
      [10, 7, 5, 3, 3, 3],
    );
    expect([tops('tool'), tops('field'), tops('choose'), tops('extra')]).toEqual([1, 2, 1, 1]);
    const foods = DISCOVERIES.flatMap((d) => (d.top.type === 'food' ? [d.top.n] : [])).sort();
    expect(foods).toEqual([1, 2, 3, 3, 4, 5, 7]);
  });

  it('C04 the 28 monuments: 17 at a fixed price, 8 by count and kinds, 3 of one to seven goods', () => {
    expect(MONUMENTS).toHaveLength(28);
    const fixed = MONUMENTS.flatMap((m) => (m.kind === 'fixed' ? [m.cost] : []));
    expect(fixed).toHaveLength(17);
    expect(fixed.map(goodsValue).reduce((a, b) => a + b, 0)).toBe(222);
    expect(fixed.map(goodsValue).slice(0, 9)).toEqual([10, 11, 11, 12, 13, 13, 14, 14, 16]);
    expect(
      MONUMENTS.filter((m) => m.kind === 'kinds').map((m) => (m.kind === 'kinds' ? [m.count, m.kinds] : [])),
    ).toEqual([
      [4, 1],
      [4, 2],
      [4, 3],
      [4, 4],
      [5, 1],
      [5, 2],
      [5, 3],
      [5, 4],
    ]);
    expect(MONUMENTS.filter((m) => m.kind === 'any')).toHaveLength(3);
    // The point ranges of the kinds monuments, from all their payments out of plenty.
    const plenty = [9, 9, 9, 9];
    const range = (i: number) => {
      const v = monumentPayments(MONUMENTS[i] as never, plenty).map(goodsValue);
      return [Math.min(...v), Math.max(...v)];
    };
    expect([17, 18, 19, 20, 21, 22, 23, 24].map(range)).toEqual([
      [12, 24],
      [13, 23],
      [15, 21],
      [18, 18],
      [15, 30],
      [16, 29],
      [18, 27],
      [21, 24],
    ]);
    expect(range(25)).toEqual([3, 42]);
  });
});
