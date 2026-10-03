import { describe, expect, it } from 'vitest';
import { bank, outcomeOf, pendingOf } from '../../src/index.ts';
import { act, bankTheRound, playRoll, rules, setup } from '../helpers.ts';

describe('rounds and the result', () => {
  it('C22 the next roller is the seat after the last actor, and the safe rolls start over', () => {
    let state = setup(3);
    state = playRoll(state, [1, 2]).state;
    state = playRoll(state, [1, 2]).state;
    state = playRoll(state, [1, 2]).state;
    expect(state.pot).toBe(9);
    state = playRoll(state, [2, 5]).state;
    expect(state.pot).toBe(0);
    expect(state.round).toBe(1);
    expect(state.roller).toBe(1);
    expect(state.rolls).toBe(0);
    expect(state.scores).toEqual([0, 0, 0]);
    state = playRoll(state, [3, 4]).state;
    expect(state.pot).toBe(70);
    expect(state.rolls).toBe(1);
  });

  it('C23 the game is over after the chosen number of rounds', () => {
    let state = setup(3, rules({ rounds: 5 }));
    for (let round = 0; round < 5; round++) {
      expect(state.phase).toBe('call');
      state = bankTheRound(state);
    }
    expect(state.phase).toBe('over');
    expect(state.round).toBe(5);
    expect(pendingOf(state)).toEqual({ type: 'over' });
    expect(state.scores).toEqual([0, 0, 0]);
    expect(outcomeOf(state)?.reason).toBe('score');
  });

  it('C24 the 30th roll banks everyone still in, unless it busts', () => {
    let state = setup(2, rules({ rounds: 5 }));
    let capped = state;
    for (let i = 0; i < 29; i++) {
      state = playRoll(state, [1, 2]).state;
    }
    expect(state.rolls).toBe(29);
    expect(state.pot).toBe(87);
    const played = playRoll(state, [1, 2]);
    capped = played.state;
    expect(played.events).toContainEqual(expect.objectContaining({ type: 'dice', capped: true, pot: 90 }));
    expect(played.events).toContainEqual({ type: 'banked', seat: 0, amount: 90, shared: false });
    expect(played.events).toContainEqual({ type: 'banked', seat: 1, amount: 90, shared: true });
    expect(played.events).toContainEqual({ type: 'round', round: 1, how: 'cap' });
    expect(capped.scores).toEqual([90, 90]);
    expect(capped.round).toBe(1);
    expect(capped.pot).toBe(0);
    expect(capped.rolls).toBe(0);
    expect(bank.coverage?.(capped, played.events)).toEqual(
      expect.arrayContaining(['round:cap', 'bank:shared']),
    );

    let bust = setup(2, rules({ rounds: 5 }));
    for (let i = 0; i < 29; i++) bust = playRoll(bust, [1, 2]).state;
    const wiped = playRoll(bust, [1, 6]);
    expect(wiped.events).toContainEqual(
      expect.objectContaining({ type: 'dice', effect: 'bust', capped: false }),
    );
    expect(wiped.events.some((event) => event.type === 'banked')).toBe(false);
    expect(wiped.state.scores).toEqual([0, 0]);
  });

  it('C25 a tie shares first place and the next score is third', () => {
    let state = setup(3, rules({ rounds: 5 }));
    state = playRoll(state, [4, 6]).state;
    state = act(state, { type: 'bank', actor: 1 }).state;
    state = act(state, { type: 'stay', actor: 2 }).state;
    state = act(state, { type: 'bank', actor: 0 }).state;
    expect(state.roller).toBe(2);
    state = playRoll(state, [1, 2]).state;
    state = playRoll(state, [1, 2]).state;
    state = playRoll(state, [1, 6]).state;
    expect(state.scores).toEqual([10, 10, 0]);
    while (state.phase !== 'over') state = bankTheRound(state);
    const outcome = outcomeOf(state);
    expect(outcome).toEqual({ places: [1, 1, 3], scores: [10, 10, 0], reason: 'score' });
  });

  it('C26 standings match the scores, the view is the whole state, and nothing is hidden', () => {
    const state = playRoll(setup(3), [4, 6]).state;
    expect(state.pot).toBe(10);
    expect(bank.standings(state)).toEqual([0, 0, 0]);
    expect(bank.view(state, 1)).toBe(state);
    expect(bank.view(state, null)).toBe(state);
    expect(bank.dealt(state)).toEqual([]);
    expect(bank.knownTo(state, 0)).toEqual([]);
    expect(bank.revealsOf(state, { type: 'bank', actor: 1 })).toEqual([]);
    expect(bank.decks(state.rules)).toEqual([]);
    const learned = bank.learn(state, { deck: 'roll', pos: 0, card: 1 });
    expect(learned.ok).toBe(false);
    if (!learned.ok) expect(learned.error.code).toBe('no-hidden');
    const over = bankTheRound(setup(2, rules({ rounds: 5 })));
    let done = over;
    while (done.phase !== 'over') done = bankTheRound(done);
    const outcome = outcomeOf(done);
    expect(outcome?.scores).toEqual([0, 0]);
    expect(bank.standings(done)).toEqual(outcome?.scores);
    const viewed = bank.setup({ rules: done.rules, seats: 2, mode: 'view', viewer: null });
    expect(viewed.ok).toBe(true);
    if (viewed.ok) expect(bank.view(viewed.value, 0)).toEqual(viewed.value);
  });

  it('C29 a bust pays nobody who is still in the round', () => {
    let state = setup(3);
    state = playRoll(state, [5, 5]).state;
    state = act(state, { type: 'bank', actor: 1 }).state;
    state = act(state, { type: 'stay', actor: 2 }).state;
    state = playRoll(toSafeBust(state), [3, 4]).state;
    expect(state.scores).toEqual([0, 10, 0]);
    expect(state.log.filter((entry) => entry.kind === 'bank')).toEqual([
      { kind: 'bank', seat: 1, amount: 10 },
    ]);
  });
});

/** Three safe resolutions, then the caller rolls the bust this helper's caller supplies. */
function toSafeBust(s: ReturnType<typeof setup>): ReturnType<typeof setup> {
  let state = s;
  while (state.rolls < 3 && state.phase !== 'over') state = playRoll(state, [1, 1]).state;
  return state;
}
