import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actionCard, numberCard } from '../../src/cards.ts';
import { applyAction, resignAllowed } from '../../src/index.ts';
import { DEFAULT_RULES } from '../../src/rules.ts';
import { act, handPos, playCard, rejects, reveal, setup, starterPos } from '../helpers.ts';

function live() {
  return reveal(setup(2, { [starterPos(2)]: numberCard(0, 4, 0), [handPos(2, 0, 0)]: numberCard(0, 2, 0) }));
}

describe('encoding', () => {
  it('C49 apply rejects a resign action', () => {
    const state = live();
    rejects(state, { type: 'resign' }, 'resign');
    rejects(state, { type: 'resign', actor: 0 }, 'resign');
    expect(resignAllowed(DEFAULT_RULES, 2)).toBe(true);
    expect(resignAllowed(DEFAULT_RULES, 10)).toBe(true);
  });

  it('C50 a second encoding is rejected', () => {
    const state = live();
    const pos = handPos(2, 0, 0);
    const card = numberCard(0, 2, 0);
    rejects(state, { type: 'play', actor: 0, pos, card, holler: false }, 'shape');
    rejects(state, { type: 'play', actor: 0, pos, card, extra: 1 }, 'shape');
    rejects(state, { type: 'play', actor: 0, pos, card, suit: 1 }, 'shape');
    expect(applyAction(state, { type: 'play', actor: 0, pos, card }).ok).toBe(true);
  });

  it('C51 a seat who owes a Pull cannot answer it by playing another Pull', () => {
    const seats = 3;
    const first = actionCard(0, 2, 0);
    const second = actionCard(1, 2, 0);
    const state = playCard(
      reveal(
        setup(seats, {
          [starterPos(seats)]: numberCard(0, 4, 0),
          [handPos(seats, 0, 0)]: first,
          [handPos(seats, 1, 0)]: second,
        }),
      ),
      0,
      first,
    );
    expect(state.hands[1]?.some((slot) => slot.card === second)).toBe(true);
    expect(state.phase).toEqual({ type: 'play', seat: 2 });
    const owed = state.hands[1]?.find((slot) => slot.card === second);
    rejects(state, { type: 'play', actor: 1, pos: owed?.pos, card: second }, 'turn');
  });

  it('C52 a play from a seat that is not pending is rejected', () => {
    const state = live();
    rejects(
      state,
      { type: 'play', actor: 1, pos: handPos(2, 1, 0), card: state.hands[1]?.[0]?.card },
      'turn',
    );
  });

  it('C53 a 0 or a 7 does not move any other card', () => {
    const seats = 3;
    const zero = numberCard(0, 0, 0);
    const seven = numberCard(1, 7, 0);
    let state = reveal(
      setup(seats, {
        [starterPos(seats)]: numberCard(0, 7, 0),
        [handPos(seats, 0, 0)]: seven,
        [handPos(seats, 0, 1)]: zero,
      }),
    );
    const before = state.hands.map((hand) => hand.map((slot) => slot.pos));
    state = act(state, { type: 'play', actor: 0, pos: handPos(seats, 0, 0), card: seven }).state;
    expect(state.hands[1]?.map((slot) => slot.pos)).toEqual(before[1]);
    expect(state.hands[2]?.map((slot) => slot.pos)).toEqual(before[2]);
    expect(state.hands[0]?.some((slot) => slot.card === zero)).toBe(true);
    expect(state.hands[0]?.some((slot) => slot.card === seven)).toBe(false);
  });

  it('C57 the engine has no resign action', () => {
    expect(resignAllowed(DEFAULT_RULES, 2)).toBe(true);
    const rules = readFileSync(
      join(import.meta.dirname, '../../../../../docs/games/holler/RULES.md'),
      'utf8',
    );
    expect(rules).toContain('A table of two seats refuses Resign; that refusal belongs to the platform.');
    rejects(live(), { type: 'resign', actor: 0 }, 'resign');
  });

  it('C60 an action from outside the pending turn is rejected', () => {
    const state = live();
    rejects(state, { type: 'play', actor: 1, pos: 1, card: 1 }, 'turn');
    rejects(state, { type: 'jump', actor: 1 }, 'shape');
    rejects(state, { type: 'draw', actor: 1 }, 'turn');
  });
});
