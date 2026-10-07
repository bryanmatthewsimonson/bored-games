import { deepFreeze, range } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { luster } from '../../src/module.ts';
import type { LusterState } from '../../src/types.ts';
import { ANY, collection, holding, ORDERS, player, ready, step } from '../helpers.ts';

const reveal = (s: LusterState, pos: number, card: number) =>
  step(s, { type: 'reveal', actor: 'deck', deck: 'tier-1', pos, card });
const take = (s: LusterState) => step(s, { type: 'take', actor: s.turn, tokens: [1, 0, 0, 0, 0, 0] });
const valued = [3, 7, 11].map((card) => ({ deck: 'tier-3' as const, pos: card, card, private: false }));

describe('random starting player and rotated rounds', () => {
  it('C10 gives every seat exactly equal probability across all ordered setup-card pairs', () => {
    for (const seats of [2, 3, 4]) {
      const initial = luster.setup({ rules: luster.defaultRules(), seats, mode: 'view', viewer: null });
      if (!initial.ok) throw new Error(initial.error.message);
      const counts = Array<number>(seats).fill(0);
      for (const first of range(40))
        for (const second of range(40)) {
          if (first === second) continue;
          const s = reveal(reveal(deepFreeze(initial.value), 0, first), 1, second);
          if (s.startingSeat === null) throw new Error('Unresolved starting seat');
          counts[s.startingSeat] = (counts[s.startingSeat] ?? 0) + 1;
          expect(s.turn).toBe(s.startingSeat);
          expect(luster.legalActions(s, s.turn)).toEqual([]);
        }
      expect(counts).toEqual(Array(seats).fill((40 * 39) / seats));
      expect(initial.value.startingSeat).toBeNull();
    }
  });

  it('waits for fixed-position reveals and rejects the uneven tail in a three-player draw', () => {
    const initial = luster.setup({ rules: luster.defaultRules(), seats: 3, mode: 'view', viewer: null });
    if (!initial.ok) throw new Error(initial.error.message);
    const later = reveal(initial.value, 1, 5);
    expect(later.startingSeat).toBeNull();
    expect(reveal(later, 0, 39)).toMatchObject({ startingSeat: 2, turn: 2 });
    const first = reveal(initial.value, 0, 39);
    expect(first.startingSeat).toBeNull();
    expect(reveal(first, 1, 5)).toEqual(reveal(later, 0, 39));
  });

  it('full audit, every player and spectator derive the same starter without leaking hidden order', () => {
    const order = [39, 5, ...range(40).filter((card) => card !== 39 && card !== 5)];
    const full = luster.setup({
      rules: luster.defaultRules(),
      seats: 3,
      mode: 'full',
      deckOrders: { ...ORDERS, 'tier-1': order },
    });
    if (!full.ok) throw new Error(full.error.message);
    let state = full.value;
    const views = [0, 1, 2, null].map((viewer) => luster.view(state, viewer));
    expect(state.startingSeat).toBeNull();
    while (luster.pending(state).type === 'reveal') {
      const pending = luster.pending(state);
      if (pending.type !== 'reveal') throw new Error('Expected reveal');
      const pos = pending.positions[0];
      if (pos === undefined) throw new Error('Missing position');
      const card = state.decks[pending.deck as keyof typeof state.decks].order?.[pos];
      const action = { type: 'reveal', actor: 'deck', deck: pending.deck, pos, card };
      state = step(state, action);
      for (const [index, view] of views.entries()) {
        const next = step(view, action);
        views[index] = next;
        expect(next).toEqual(luster.view(state, view.viewer));
        expect(luster.invariants(next)).toEqual([]);
      }
    }
    expect(state).toMatchObject({ startingSeat: 2, turn: 2, round: 1 });
    expect(luster.pending(state)).toEqual({ type: 'player', seat: 2, decision: 'turn' });
    expect(luster.legalActions(state, 0)).toEqual([]);
    expect(luster.invariants(state)).toEqual([]);
  });

  it('finishes equal turns for every starting seat and every point at which fifteen is reached', () => {
    for (const seats of [2, 3, 4])
      for (const startingSeat of range(seats))
        for (const triggerOffset of range(seats)) {
          let s: LusterState = { ...ready(seats, ANY), startingSeat, turn: startingSeat };
          for (const offset of range(seats)) {
            if (offset === triggerOffset) s = player(s, s.turn, { bought: valued });
            expect(s.turn).toBe((startingSeat + offset) % seats);
            s = take(s);
            expect(s.finalRound).toBe(offset >= triggerOffset);
            expect(s.round).toBe(1);
            if (offset < seats - 1) expect(s.result).toBeNull();
          }
          expect(s.phase).toBe('over');
          expect(s.turn).toBe((startingSeat + seats - 1) % seats);
          expect(s.result?.scores[(startingSeat + triggerOffset) % seats]).toBe(15);
          for (const seat of range(seats)) expect(luster.legalActions(s, seat)).toEqual([]);
        }
  });

  it('advances round numbers only on return to the starter and completes token returns before scoring', () => {
    let s: LusterState = { ...ready(4, ANY), startingSeat: 2, turn: 2 };
    for (const offset of range(4)) {
      s = take(s);
      expect(s.round).toBe(offset === 3 ? 2 : 1);
    }
    expect(s.turn).toBe(2);
    s = player({ ...s, turn: 1 }, 1, { bought: valued });
    s = holding(s, 1, [2, 2, 2, 2, 1, 1]);
    s = take(s);
    expect(s).toMatchObject({ phase: 'return', startingSeat: 2, turn: 1, round: 2, result: null });
    s = step(s, { type: 'return', actor: 1, tokens: [1, 0, 0, 0, 0, 0] });
    expect(s).toMatchObject({ phase: 'over', startingSeat: 2, turn: 1, round: 2 });
    expect(s.result?.scores[1]).toBe(15);
  });

  it('waits for the final player’s compulsory patron choice before ending a rotated round', () => {
    let s = player({ ...ready(4, ANY), startingSeat: 2, turn: 1 }, 1, {
      bought: [...valued, ...collection([4, 4, 4, 4, 4])],
    });
    s = take(s);
    expect(s).toMatchObject({ phase: 'patron', startingSeat: 2, turn: 1, result: null });
    s = step(s, { type: 'patron', actor: 1, card: 0 });
    expect(s).toMatchObject({ phase: 'over', startingSeat: 2, turn: 1 });
    expect(s.players[1]?.patrons).toEqual([0]);
    expect(s.result?.scores[1]).toBeGreaterThanOrEqual(18);
  });
});
