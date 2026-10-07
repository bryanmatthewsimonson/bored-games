import { describe, expect, it } from 'vitest';
import { actionCard, numberCard } from '../../src/cards.ts';
import { applyAction, legalActionsOf, viewFor } from '../../src/index.ts';
import { handPos, playCard, reveal, setup, starterPos } from '../helpers.ts';

function opened(seats: number, placed: Record<number, number>) {
  return reveal(setup(seats, { [starterPos(seats)]: numberCard(0, 5, 0), ...placed }));
}

describe('matching', () => {
  it('C07 a number matches by suit', () => {
    const card = numberCard(0, 9, 0);
    const state = opened(2, { [handPos(2, 0, 0)]: card });
    const next = playCard(state, 0, card);
    expect(next.discard.at(-1)?.card).toBe(card);
    expect(next.activeSuit).toBe(0);
  });

  it('C08 a number matches by rank', () => {
    const card = numberCard(1, 5, 0);
    const next = playCard(opened(2, { [handPos(2, 0, 0)]: card }), 0, card);
    expect(next.activeSuit).toBe(1);
  });

  it('C09 an action matches by kind across suits', () => {
    const first = actionCard(0, 2, 0);
    const second = actionCard(1, 2, 0);
    const seats = 3;
    let state = opened(seats, {
      [handPos(seats, 0, 0)]: first,
      [handPos(seats, 2, 0)]: second,
    });
    state = playCard(state, 0, first);
    expect(state.hands[1]).toHaveLength(9);
    expect(state.phase).toEqual({ type: 'play', seat: 2 });
    state = playCard(state, 2, second);
    expect(state.discard.at(-1)?.card).toBe(second);
  });

  it('C10 an action matches by suit', () => {
    const halt = actionCard(0, 0, 0);
    expect(playCard(opened(2, { [handPos(2, 0, 0)]: halt }), 0, halt).activeSuit).toBe(0);
  });

  it('C11 a Mark may be played on anything and names the suit', () => {
    const next = playCard(opened(2, { [handPos(2, 0, 0)]: 100 }), 0, 100, { suit: 2 });
    expect(next.activeSuit).toBe(2);
    expect(next.discard.at(-1)?.card).toBe(100);
  });

  it('C12 a Levy may be played when the hand has none of the active suit', () => {
    const hand = [104, 2, 1, 3, 4, 6, 7].map((rank, index) => (index === 0 ? 104 : numberCard(1, rank, 0)));
    const placed: Record<number, number> = {};
    hand.forEach((card, index) => {
      placed[handPos(2, 0, index)] = card;
    });
    const next = playCard(opened(2, placed), 0, 104, { suit: 1 });
    expect(next.phase).toMatchObject({ type: 'levy', player: 0, prior: 0, named: 1, blind: false });
  });

  it('C13 a Levy is illegal when the hand has a card of the active suit', () => {
    const state = opened(2, {
      [handPos(2, 0, 0)]: 104,
      [handPos(2, 0, 1)]: numberCard(0, 2, 0),
    });
    expect(legalActionsOf(state, 0).some((action) => (action as { card?: number }).card === 104)).toBe(false);
    const denied = applyAction(state, { type: 'play', actor: 0, pos: handPos(2, 0, 0), card: 104, suit: 1 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('illegal');
  });

  it('C14 a Mark in hand does not block a Levy', () => {
    const hand = [
      104,
      100,
      numberCard(1, 1, 0),
      numberCard(1, 2, 0),
      numberCard(1, 3, 0),
      numberCard(1, 4, 0),
      numberCard(1, 6, 0),
    ];
    const placed: Record<number, number> = {};
    hand.forEach((card, index) => {
      placed[handPos(2, 0, index)] = card;
    });
    expect(playCard(opened(2, placed), 0, 104, { suit: 3 }).phase.type).toBe('levy');
  });

  it('C15 an off-suit card of the same rank does not block a Levy', () => {
    const hand = [
      104,
      numberCard(2, 5, 0),
      numberCard(2, 1, 0),
      numberCard(2, 2, 0),
      numberCard(2, 3, 0),
      numberCard(2, 4, 0),
      numberCard(2, 6, 0),
    ];
    const placed: Record<number, number> = {};
    hand.forEach((card, index) => {
      placed[handPos(2, 0, index)] = card;
    });
    expect(playCard(opened(2, placed), 0, 104, { suit: 1 }).phase.type).toBe('levy');
  });

  it('C16 a view that cannot see the hand accepts a well-formed Levy', () => {
    const full = opened(2, {
      [handPos(2, 0, 0)]: 104,
      [handPos(2, 0, 1)]: numberCard(1, 4, 0),
    });
    const play = { type: 'play' as const, actor: 0, pos: handPos(2, 0, 0), card: 104, suit: 2 as const };
    const hidden = viewFor(full, 1);
    expect(hidden.hands[0]?.every((slot) => slot.card === null)).toBe(true);
    const accepted = applyAction(hidden, play);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.state.phase).toMatchObject({ type: 'levy', blind: true });

    const partial = viewFor(full, 1);
    const hand = (partial.hands[0] ?? []).map((slot, index) =>
      index === 1 ? { ...slot, card: numberCard(0, 2, 0) } : slot,
    );
    const blocked = applyAction({ ...partial, hands: [hand, partial.hands[1] ?? []] }, play);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('illegal');
  });
});
