import { catalogProblems } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { actionCard, numberCard } from '../../src/cards.ts';
import { DEFAULT_RULES, HOLLER_CATALOG, holler, setupGame, validateRules } from '../../src/index.ts';
import { act, deck, handPos, reveal, setup, starterPos } from '../helpers.ts';

describe('setup', () => {
  it('C01 setup deals 7 to each seat round-robin and reveals one starter', () => {
    const state = setup(3);
    expect(state.hands.map((hand) => hand.map((slot) => slot.pos))).toEqual([
      [0, 3, 6, 9, 12, 15, 18],
      [1, 4, 7, 10, 13, 16, 19],
      [2, 5, 8, 11, 14, 17, 20],
    ]);
    expect(state.phase).toEqual({ type: 'reveal', kind: 'starter', positions: [21] });
    expect(state.draw[0]).toBe(22);
    expect(state.draw).toHaveLength(108 - 22);
    expect(state.dealt).toHaveLength(22);
    expect(state.discard).toEqual([]);
    const opened = reveal(state);
    expect(opened.discard).toHaveLength(1);
    expect(opened.phase).toMatchObject({ type: 'play', seat: 0 });
  });

  it('C02 seat range is 2 to 10', () => {
    expect(holler.seatRange(DEFAULT_RULES)).toEqual({ min: 2, max: 10 });
    const pile = deck();
    const low = setupGame({ rules: DEFAULT_RULES, seats: 1, mode: 'full', deckOrders: { pile } });
    const high = setupGame({ rules: DEFAULT_RULES, seats: 11, mode: 'full', deckOrders: { pile } });
    expect(low.ok).toBe(false);
    expect(high.ok).toBe(false);
    if (!low.ok) expect(low.error.code).toBe('seats');
    if (!high.ok) expect(high.error.code).toBe('seats');
    expect(setup(2).seats).toBe(2);
    expect(setup(10).seats).toBe(10);
  });

  it('C03 a starter Levy is set aside and the next card is turned', () => {
    const seats = 2;
    const levy = starterPos(seats);
    const next = levy + 1;
    const placed = { [levy]: 104, [next]: numberCard(0, 3, 0) };
    const dealt = setup(seats, placed);
    const turned = act(dealt, {
      type: 'reveal',
      actor: 'deck',
      deck: 'pile',
      pos: levy,
      card: 104,
    });
    expect(turned.events).toContainEqual({ type: 'round', round: 0, starter: 'levy' });
    expect(turned.state.buried).toEqual([levy]);
    expect(turned.state.discard).toEqual([]);
    expect(turned.state.draw.includes(next)).toBe(false);
    expect(turned.state.phase).toEqual({ type: 'reveal', kind: 'starter', positions: [next] });
    expect(turned.state.epoch).toBe(0);
    const landed = reveal(turned.state);
    expect(landed.discard).toEqual([{ pos: next, card: numberCard(0, 3, 0) }]);
    expect(landed.buried).toEqual([levy]);
  });

  it('C04 a starter Halt skips seat 0', () => {
    const seats = 3;
    const pos = starterPos(seats);
    const halt = actionCard(0, 0, 0);
    const state = reveal(setup(seats, { [pos]: halt }));
    expect(state.discard).toEqual([{ pos, card: halt }]);
    expect(state.direction).toBe(1);
    expect(state.phase).toEqual({ type: 'play', seat: 1 });
  });

  it('C05 a starter Swing at 3 or more seats reverses', () => {
    const seats = 4;
    const pos = starterPos(seats);
    const swing = actionCard(0, 1, 0);
    const state = reveal(setup(seats, { [pos]: swing }));
    expect(state.direction).toBe(-1);
    expect(state.phase).toEqual({ type: 'play', seat: 3 });
  });

  it('C06 a starter Mark asks seat 0 to name the suit', () => {
    const seats = 3;
    const pos = starterPos(seats);
    let state = reveal(setup(seats, { [pos]: 100, [handPos(seats, 0, 0)]: numberCard(1, 1, 0) }));
    expect(state.activeSuit).toBeNull();
    expect(state.phase).toEqual({ type: 'name', seat: 0 });
    state = act(state, { type: 'name', actor: 0, suit: 1 }).state;
    expect(state.activeSuit).toBe(1);
    expect(state.phase).toEqual({ type: 'play', seat: 0 });
    state = act(state, {
      type: 'play',
      actor: 0,
      pos: handPos(seats, 0, 0),
      card: numberCard(1, 1, 0),
    }).state;
    expect(state.discard[state.discard.length - 1]?.card).toBe(numberCard(1, 1, 0));
  });

  it('the catalog entry matches the module', () => {
    expect(catalogProblems(HOLLER_CATALOG, holler)).toEqual([]);
    const extra = validateRules({ rulesVersion: 1, seats: 4 });
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.error.code).toBe('rules');
  });
});
