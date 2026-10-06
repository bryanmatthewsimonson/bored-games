import { deepFreeze } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { DECK_ID, FREIGHT_SIZE, GROUPS } from '../../src/deck.ts';
import { freightOf, pendingOf } from '../../src/engine.ts';
import { rightOfWay } from '../../src/module.ts';
import type { RowState } from '../../src/types.ts';
import {
  act,
  card,
  expectOk,
  legal,
  only,
  orderWith,
  refused,
  setup,
  started,
  withHand,
} from '../helpers.ts';

/*
 * Two seats on the identity order: seat 0 holds cards 0–3, seat 1 cards 4–7, the yard shows 8–12 (four red, one
 * orange) and the pile starts at position 13. Card 8 is the first yard card, so seat 0 starts.
 */
const two = (swaps: readonly (readonly [number, number])[] = []): RowState => started(2, orderWith(swaps));

/** The state with the freight pile emptied and `discards` waiting (focused tests; conservation not kept). */
const emptyPile = (s: RowState, discards: readonly number[]): RowState =>
  deepFreeze({ ...s, pile: { ...s.pile, next: FREIGHT_SIZE }, discards: [...discards] });

describe('drawing freight', () => {
  it('C07 one action per turn, and only from the seat to act', () => {
    const s = two();
    expect(s.turn).toBe(0);
    expect(refused(s, { type: 'blind', actor: 1 })).toMatch(/not your decision/);
    const t = act(s, { type: 'take', actor: 0, slot: 0 });
    expect(t.phase).toBe('draw');
    expect(refused(t, { type: 'charters', actor: 0 })).not.toBeNull();
    expect(legal(t).every((a) => a.type === 'take' || a.type === 'blind')).toBe(true);
  });

  it('C08 a freight draw takes two cards, from the yard or the pile in any mix', () => {
    const s = two();
    const t = act(act(s, { type: 'take', actor: 0, slot: 2 }), { type: 'blind', actor: 0 });
    expect(t.players[0]?.hand).toHaveLength(6);
    expect(t.turn).toBe(1);
    const u = act(act(t, { type: 'blind', actor: 1 }), { type: 'take', actor: 1, slot: 0 });
    expect(u.players[1]?.hand).toHaveLength(6);
    expectOk(u);
  });

  it('C09 a face-up Engine taken first is the whole draw', () => {
    const s = two([[8, card(8, 0)]]);
    const t = act(s, { type: 'take', actor: 0, slot: 0 });
    expect(t.players[0]?.hand).toHaveLength(5);
    expect(t.turn).toBe(1);
    expect(t.phase).toBe('turn');
  });

  it('C10 a face-up Engine cannot be the second card, even one just turned up', () => {
    // An Engine in slot 0, and the refill for slot 1 (position 13) is an Engine too.
    const s = two([
      [8, card(8, 0)],
      [13, card(8, 1)],
    ]);
    const t = act(s, { type: 'take', actor: 0, slot: 1 });
    expect(t.yard[1]?.card).toBe(card(8, 1));
    const takes = only(t, 'take').map((a) => a.slot);
    expect(takes).not.toContain(0);
    expect(takes).not.toContain(1);
    expect(refused(t, { type: 'take', actor: 0, slot: 0 })).toMatch(/second card/);
  });

  it('C11 an Engine drawn blind counts as one card', () => {
    const s = two([[13, card(8, 0)]]);
    const t = act(s, { type: 'blind', actor: 0 });
    expect(t.phase).toBe('draw');
    expect(t.players[0]?.hand.at(-1)?.card).toBe(card(8, 0));
    expect(legal(t).length).toBeGreaterThan(0);
  });

  it('C12 a taken yard card is replaced before the second choice', () => {
    const s = two();
    const r = rightOfWay.apply(s, { type: 'take', actor: 0, slot: 3 });
    if (!r.ok) throw new Error(r.error.message);
    expect(pendingOf(r.state)).toEqual({ type: 'reveal', deck: DECK_ID, positions: [13] });
    expect(rightOfWay.legalActions(r.state, 0)).toEqual([]);
    const t = act(s, { type: 'take', actor: 0, slot: 3 });
    expect(t.yard[3]).toEqual({ pos: 13, card: 13 });
  });

  it('C13 three Engines in the yard are wiped and five new cards turned up', () => {
    const s = setup(
      2,
      orderWith([
        [8, card(8, 0)],
        [9, card(8, 1)],
        [10, card(8, 2)],
      ]),
    );
    expect(s.discards).toEqual([96, 97, 98, 11, 12]);
    expect(s.yard.map((y) => y?.pos)).toEqual([13, 14, 15, 16, 17]);
    expect(s.wipes).toBe(1);
    expectOk(s);
  });

  it('C14 at most three wipes in a row; the yard then stays until the next action', () => {
    const engines = (from: number, k: number): [number, number][] =>
      [0, 1, 2].map((i) => [from + i, card(8, k + i)] as [number, number]);
    const s = setup(
      2,
      orderWith([...engines(8, 0), ...engines(13, 3), ...engines(18, 6), ...engines(23, 9)]),
    );
    expect(s.wipes).toBe(3);
    expect(s.yard.filter((y) => y !== null && y.card !== null && y.card >= 96)).toHaveLength(3);
    expect(s.discards).toHaveLength(15);
    expect(pendingOf(s).type).toBe('player');
    // The next player action may wipe again.
    const t = act(s, { type: 'keep', actor: s.turn, keep: [0, 1, 2] });
    expect(t.wipes).toBe(1);
    expect(t.discards).toHaveLength(20);
  });

  it('C15 an empty pile is reshuffled from the discards by a spare deck', () => {
    const base = two();
    const s = emptyPile(base, [card(2, 0), card(3, 0), card(4, 0)]);
    // A refill after a take needs a card: the discards are reshuffled, spare-1 stands for them.
    const t = act(s, { type: 'take', actor: 0, slot: 0 });
    const spare = GROUPS[1]?.offset as number;
    expect(t.epochs).toEqual([{ group: 1, list: [card(2, 0), card(3, 0), card(4, 0)] }]);
    expect(t.discards).toEqual([]);
    // Identity order: spare card v = position v; v = 0 stands for the first discard.
    expect(t.yard[0]).toEqual({ pos: spare, card: spare });
    expect(freightOf(t, spare, spare)).toBe(card(2, 0));
    expect(t.pile).toMatchObject({ group: 1, members: 3, found: 1 });
    // A skipped public card: spare position next holds a card beyond the discards.
    const skip = deepFreeze({
      ...s,
      order: orderWith([[spare, spare + 50]]),
    });
    const u = act(skip, { type: 'take', actor: 0, slot: 0 });
    expect(u.yard[0]?.pos).toBe(spare + 1);
    expect(u.dealt.some((d) => d.pos === spare && d.to === null)).toBe(true);
  });

  it('C16 with no pile and no discards: no blind draw, empty slots stay empty', () => {
    const s = emptyPile(two(), []);
    expect(only(s, 'blind')).toEqual([]);
    const t = act(s, { type: 'take', actor: 0, slot: 0 });
    expect(t.yard[0]).toBeNull();
    expect(only(t, 'take').map((a) => a.slot)).toEqual([1, 2, 3, 4]);
    // Empty slots refill at the start of a turn once the pile has cards.
    const refill = deepFreeze({ ...t, pile: { ...t.pile, next: 100 } });
    const u = act(refill, { type: 'take', actor: 0, slot: 1 });
    expect(u.phase).toBe('turn');
    expect(u.yard.every((y) => y !== null)).toBe(true);
  });

  it('C17 a draw ends with one card when no second card is legal', () => {
    // Empty pile and discards; the yard holds one red card and four Engines.
    const s = two([
      [9, card(8, 0)],
      [10, card(8, 1)],
    ]);
    const t = deepFreeze({
      ...emptyPile(s, []),
      yard: [{ pos: 8, card: 8 }, { pos: 9, card: 96 }, { pos: 10, card: 97 }, null, null],
    });
    const u = act(t, { type: 'take', actor: 0, slot: 0 });
    expect(u.players[0]?.hand).toHaveLength(5);
    expect(u.turn).toBe(1);
  });

  it('C18 there is no hand limit', () => {
    const s = withHand(
      two(),
      0,
      Array.from({ length: 40 }, (_, i) => 13 + i),
    );
    const t = act(act(s, { type: 'blind', actor: 0 }), { type: 'blind', actor: 0 });
    expect(t.players[0]?.hand).toHaveLength(42);
    expect(only(t, 'take').length + only(t, 'blind').length).toBeGreaterThan(0);
  });

  it('C40 a reshuffled card drawn blind is sifted: keep a discard, skip anything else', () => {
    const spare = GROUPS[1]?.offset as number;
    // Spare position 0 holds card 3 (a non-discard of three), position 1 holds card 1 (a discard).
    const order = orderWith([
      [spare, spare + 3],
      [spare + 1, spare + 1],
    ]);
    const s = emptyPile(deepFreeze({ ...two(), order }), [card(5, 0), card(6, 0), card(7, 0)]);
    const t = act(s, { type: 'blind', actor: 0 });
    expect(t.phase).toBe('sift');
    expect(t.dealt.at(-1)).toEqual({ deck: DECK_ID, pos: spare, to: 0 });
    expect(legal(t)).toEqual([{ type: 'sift', actor: 0, card: spare + 3 }]);
    expect(refused(t, { type: 'sift', actor: 0, card: null })).toMatch(/not a discard/);
    expect(rightOfWay.revealsOf(t, { type: 'sift', actor: 0, card: spare + 3 })).toEqual([
      { deck: DECK_ID, pos: spare, card: spare + 3 },
    ]);
    const u = act(t, { type: 'sift', actor: 0, card: spare + 3 });
    expect(u.sift).toEqual({ pos: spare + 1, card: spare + 1 });
    expect(legal(u)).toEqual([{ type: 'sift', actor: 0, card: null }]);
    expect(refused(u, { type: 'sift', actor: 0, card: spare + 1 })).toMatch(/Keep a discard/);
    expect(rightOfWay.revealsOf(u, { type: 'sift', actor: 0, card: null })).toEqual([]);
    const v = act(u, { type: 'sift', actor: 0, card: null });
    expect(v.phase).toBe('draw');
    expect(freightOf(v, spare + 1, spare + 1)).toBe(card(6, 0));
    expect(v.pile).toMatchObject({ members: 3, found: 1 });
    // Another seat's view accepts the keep without knowing the card.
    const view = rightOfWay.view(u, 1);
    expect(view.sift).toEqual({ pos: spare + 1, card: null });
    expect(rightOfWay.apply(view, { type: 'sift', actor: 0, card: null }).ok).toBe(true);
  });

  it('C42 four spare decks; with none left the discards stay put', () => {
    const s = two();
    const used = deepFreeze({
      ...emptyPile(s, [card(1, 0), card(1, 1)]),
      epochs: [1, 2, 3, 4].map((group) => ({ group, list: [] })),
      pile: { group: 4, next: (GROUPS[4]?.offset as number) + 110, members: 0, found: 0 },
    });
    expect(only(used, 'blind')).toEqual([]);
    const t = act(used, { type: 'take', actor: 0, slot: 0 });
    expect(t.yard[0]).toBeNull();
    expect(t.discards).toEqual([card(1, 0), card(1, 1)]);
  });
});
