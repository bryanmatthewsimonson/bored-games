import { deepFreeze } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { DECK_ID } from '../../src/deck.ts';
import { claimOptions } from '../../src/engine.ts';
import { rightOfWay } from '../../src/module.ts';
import { ROUTE_POINTS } from '../../src/scoring.ts';
import type { RowAction, RowState } from '../../src/types.ts';
import { act, card, orderWith, refused, started, withHand } from '../helpers.ts';

// R03 (index 2): Ashgrove–Emberdune, 3, green (colour 3). R01 (index 0): 3, unmarked. R05 (index 4): a twin, 3.
const R03 = 2;
const R01 = 0;
const R05 = 4;
const GREEN = 3;

const pairs = (s: RowState, cards: readonly number[]): [number, number][] =>
  cards.map((c) => [(s.order as number[]).indexOf(c), c] as [number, number]).sort((a, b) => a[0] - b[0]);

const claimsOf = (s: RowState, route: number, side = 0): Extract<RowAction, { type: 'claim' }>[] =>
  claimOptions(s, s.turn).filter(
    (a): a is Extract<RowAction, { type: 'claim' }> =>
      a.type === 'claim' && a.route === route && a.side === side,
  );

/** Seat 0 to play, holding `cards`. */
const holding = (cards: readonly number[], seats = 2): RowState =>
  withHand(started(seats, orderWith()), 0, cards);

describe('laying track', () => {
  it('C19 payment: the route length in one colour (the route colour, or any on unmarked), Engines wild', () => {
    const greens = [card(GREEN, 0), card(GREEN, 1), card(GREEN, 2)];
    const s = holding([...greens, card(8, 0), card(8, 1), card(8, 2), card(0, 0), card(0, 1)]);
    // R03 (green): 3 green, 2 green + 1 Engine, 1 green + 2 Engines, or 3 Engines; each with the lowest cards.
    const options = claimsOf(s, R03);
    expect(options).toHaveLength(4);
    expect(options.map((a) => a.pay)).toContainEqual(pairs(s, greens));
    expect(options.map((a) => a.pay)).toContainEqual(pairs(s, [card(8, 0), card(8, 1), card(8, 2)]));
    // Unmarked R01: also red (2 red + 1 Engine, 1 red + 2 Engines).
    expect(claimsOf(s, R01).map((a) => a.pay)).toContainEqual(pairs(s, [card(0, 0), card(0, 1), card(8, 0)]));
    // Wrong colour, mixed colours, too few cards, a card not held: refused.
    const claim = (cards: readonly number[], route = R03) =>
      refused(s, { type: 'claim', actor: 0, route, side: 0, pay: pairs(s, cards) });
    expect(claim([card(0, 0), card(0, 1), card(8, 0)])).toMatch(/route colour/);
    expect(claim([card(0, 0), card(GREEN, 0), card(8, 0)], R01)).toMatch(/one colour/);
    expect(claim([card(GREEN, 0), card(GREEN, 1)])).toMatch(/as many cards/);
    expect(claim([card(GREEN, 0), card(GREEN, 1), card(5, 5)])).toMatch(/not in hand/);
    // One accepted encoding: not the lowest Engines.
    expect(claim([card(GREEN, 0), card(GREEN, 1), card(8, 2)])).toMatch(/lowest/);
    expect(claim(greens)).toBeNull();
  });

  it('C20 a route longer than the track left cannot be claimed', () => {
    const s = holding([card(GREEN, 0), card(GREEN, 1), card(GREEN, 2)]);
    const short = deepFreeze({ ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, track: 2 } : p)) });
    expect(claimsOf(short, R03)).toEqual([]);
    expect(
      refused(short, {
        type: 'claim',
        actor: 0,
        route: R03,
        side: 0,
        pay: pairs(s, [card(GREEN, 0), card(GREEN, 1), card(GREEN, 2)]),
      }),
    ).toMatch(/Not enough track/);
  });

  it('C21 route points are scored at once: 1, 2, 4, 7, 10, 15', () => {
    expect(ROUTE_POINTS.slice(1)).toEqual([1, 2, 4, 7, 10, 15]);
    const s = holding([card(GREEN, 0), card(GREEN, 1), card(GREEN, 2)]);
    const t = act(s, claimsOf(s, R03)[0]);
    expect(t.players[0]?.points).toBe(4);
    expect(t.players[0]?.track).toBe(42);
    expect(rightOfWay.standings(t)).toEqual([4, 0]);
  });

  it('C22 paid cards go face up to the discards; blind cards are revealed by the claim', () => {
    const s = started(
      2,
      orderWith([
        [0, card(GREEN, 0)],
        [1, card(GREEN, 1)],
        [2, card(GREEN, 2)],
      ]),
    );
    const claim = claimsOf(s, R03)[0] as Extract<RowAction, { type: 'claim' }>;
    expect(rightOfWay.revealsOf(s, claim)).toEqual(
      claim.pay.map(([pos, c]) => ({ deck: DECK_ID, pos, card: c })),
    );
    const t = act(s, claim);
    expect(t.discards).toEqual([card(GREEN, 0), card(GREEN, 1), card(GREEN, 2)]);
    // A card taken from the yard is already public: the claim does not reveal it again.
    const open = deepFreeze({
      ...s,
      players: s.players.map((p, i) =>
        i === 0 ? { ...p, hand: p.hand.map((h) => (h.pos === 0 ? { ...h, open: true } : h)) } : p,
      ),
    });
    expect(rightOfWay.revealsOf(open, claim).map((l) => l.pos)).toEqual([1, 2]);
  });

  it('C23 a route need not join other track; one route per turn', () => {
    const s = holding([card(GREEN, 0), card(GREEN, 1), card(GREEN, 2), card(0, 0), card(0, 1), card(0, 2)]);
    const t = act(s, claimsOf(s, R03)[0]);
    expect(t.turn).toBe(1);
    expect(t.phase).toBe('turn');
    expect(
      refused(t, {
        type: 'claim',
        actor: 0,
        route: R01,
        side: 0,
        pay: pairs(s, [card(0, 0), card(0, 1), card(0, 2)]),
      }),
    ).toMatch(/not your decision/);
  });

  it('C24 twins with 4–5 seats: different seats may share a twin, one seat never holds both sides', () => {
    // R05 sides: blue (4), black (7).
    const s = withHand(started(4, orderWith()), 0, [
      card(4, 0),
      card(4, 1),
      card(4, 2),
      card(7, 0),
      card(7, 1),
      card(7, 2),
    ]);
    const t = act(s, claimsOf(s, R05, 0)[0]);
    expect(t.routes[R05]).toEqual([0, null]);
    const back = deepFreeze({ ...t, turn: 0 });
    expect(claimsOf(back, R05, 1)).toEqual([]);
    const other = withHand(deepFreeze({ ...t }), t.turn, [card(7, 3), card(7, 4), card(7, 5)]);
    expect(claimsOf(other, R05, 1)).toHaveLength(1);
  });

  it('C25 twins with 2–3 seats: once a side is taken, the other is closed', () => {
    for (const seats of [2, 3]) {
      const s = withHand(started(seats, orderWith()), 0, [card(4, 0), card(4, 1), card(4, 2)]);
      const t = act(s, claimsOf(s, R05, 0)[0]);
      const other = withHand(t, t.turn, [card(7, 0), card(7, 1), card(7, 2)]);
      expect(claimsOf(other, R05, 1)).toEqual([]);
    }
  });

  it('C26 a taken or closed side cannot be laid on', () => {
    const s = holding([card(GREEN, 0), card(GREEN, 1), card(GREEN, 2)]);
    const t = act(s, claimsOf(s, R03)[0]);
    const again = withHand(t, t.turn, [card(GREEN, 3), card(GREEN, 4), card(GREEN, 5)]);
    expect(claimsOf(again, R03)).toEqual([]);
    expect(
      refused(again, {
        type: 'claim',
        actor: again.turn,
        route: R03,
        side: 0,
        pay: pairs(again, [card(GREEN, 3), card(GREEN, 4), card(GREEN, 5)]),
      }),
    ).toMatch(/taken or closed/);
  });
});
