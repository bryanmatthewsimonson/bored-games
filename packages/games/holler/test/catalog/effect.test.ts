import { describe, expect, it } from 'vitest';
import { actionCard, numberCard } from '../../src/cards.ts';
import { handPos, playCard, reveal, setup, starterPos } from '../helpers.ts';

function withCard(seats: number, seat: number, card: number) {
  return reveal(
    setup(seats, {
      [starterPos(seats)]: numberCard(0, 3, 0),
      [handPos(seats, seat, 0)]: card,
    }),
  );
}

describe('effects', () => {
  it('C31 Halt skips the next seat', () => {
    const halt = actionCard(0, 0, 0);
    const state = playCard(withCard(3, 0, halt), 0, halt);
    expect(state.direction).toBe(1);
    expect(state.phase).toEqual({ type: 'play', seat: 2 });
  });

  it('C32 Swing at 3 or more seats flips direction', () => {
    const swing = actionCard(0, 1, 0);
    const state = playCard(withCard(3, 0, swing), 0, swing);
    expect(state.direction).toBe(-1);
    expect(state.phase).toEqual({ type: 'play', seat: 2 });
  });

  it('C33 Swing at 2 seats skips and does not change direction', () => {
    const swing = actionCard(0, 1, 0);
    const before = withCard(2, 0, swing);
    const state = playCard(before, 0, swing);
    expect(state.direction).toBe(1);
    expect(state.phase).toEqual({ type: 'play', seat: 0 });
    expect(state.hands[1]).toHaveLength(7);
  });

  it('C34 Pull draws 2 for the next seat and skips them', () => {
    const pull = actionCard(0, 2, 0);
    const state = playCard(withCard(3, 0, pull), 0, pull);
    expect(state.hands[1]).toHaveLength(9);
    expect(state.phase).toEqual({ type: 'play', seat: 2 });
    expect(state.direction).toBe(1);
  });
});
