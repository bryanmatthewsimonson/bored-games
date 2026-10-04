import { describe, expect, it } from 'vitest';
import { ENGINES, engine, rules } from '../helpers.ts';

describe.each(ENGINES)('banking window: engine $version', (m) => {
  const { act, bankTheRound, playRoll, rejects, setup, toRoller } = engine(m);

  it('C04 staying changes nothing but who has passed', () => {
    const state = playRoll(setup(3), [1, 2]).state;
    const next = act(state, { type: 'stay', actor: 1 }).state;
    expect(next.pot).toBe(3);
    expect(next.scores).toEqual([0, 0, 0]);
    expect(next.inRound).toEqual([true, true, true]);
    expect(next.passed).toEqual([1]);
    expect(m.pending(next)).toMatchObject({ seat: 2 });
  });

  it('C05 banking pays the pot to that seat and leaves the pot', () => {
    const built = playRoll(setup(3), [3, 3]).state;
    expect(built.pot).toBe(6);
    const paid = act(built, { type: 'bank', actor: 1 });
    expect(paid.events).toContainEqual({ type: 'banked', seat: 1, amount: 6, shared: false });
    expect(paid.state.scores).toEqual([0, 6, 0]);
    expect(paid.state.pot).toBe(6);
    expect(paid.state.inRound[1]).toBe(false);
    expect(paid.state.banked[1]).toBe(6);
  });

  it('C06 two seats can bank the same pot', () => {
    let state = playRoll(setup(3), [3, 3]).state;
    state = act(state, { type: 'bank', actor: 1 }).state;
    const second = act(state, { type: 'bank', actor: 2 });
    expect(second.events).toContainEqual({ type: 'banked', seat: 2, amount: 6, shared: true });
    expect(second.state.scores).toEqual([0, 6, 6]);
    expect(second.state.pot).toBe(6);
    expect(m.coverage?.(second.state, second.events)).toContain('bank:shared');
  });

  it('C07 an empty pot cannot be banked', () => {
    const state = setup(3);
    rejects(state, { type: 'bank', actor: 0 }, 'illegal');
    rejects(state, { type: 'bank', actor: 1 }, 'turn');
    expect(state.scores).toEqual([0, 0, 0]);
    expect(state.inRound).toEqual([true, true, true]);
    expect(state.pot).toBe(0);
    let next = state;
    for (let i = 0; i < 3; i++) next = playRoll(next, [1, 2]).state;
    next = playRoll(next, [1, 6]).state;
    expect(next.rolls).toBe(0);
    expect(next.pot).toBe(0);
    rejects(next, { type: 'bank', actor: next.roller }, 'illegal');
    expect(m.pending(next)).toEqual({ type: 'player', seat: next.roller, decision: 'roll' });
  });

  it('C08 a seat who banked is not asked again', () => {
    let state = playRoll(setup(3), [1, 2]).state;
    state = act(state, { type: 'bank', actor: 1 }).state;
    expect(m.pending(state)).toMatchObject({ seat: 2 });
    expect(m.legalActions(state, 1)).toEqual([]);
    state = act(state, { type: 'stay', actor: 2 }).state;
    expect(m.pending(state)).toMatchObject({ seat: 0 });
    expect(m.legalActions(state, 1)).toEqual([]);
  });

  it('C09 a roller who banks hands the dice to the next seat still in', () => {
    let state = playRoll(setup(3), [1, 2]).state;
    state = act(state, { type: 'stay', actor: 1 }).state;
    state = act(state, { type: 'stay', actor: 2 }).state;
    state = act(state, { type: 'bank', actor: 0 }).state;
    expect(state.scores[0]).toBe(3);
    expect(state.pot).toBe(3);
    expect(state.inRound[0]).toBe(false);
    expect(state.roller).toBe(1);
    expect(state.phase).toBe('call');
  });

  it('C10 a seat who stayed and then becomes the roller may only roll', () => {
    let state = playRoll(setup(3), [1, 2]).state;
    state = act(state, { type: 'stay', actor: 1 }).state;
    state = act(state, { type: 'stay', actor: 2 }).state;
    state = act(state, { type: 'bank', actor: 0 }).state;
    expect(state.roller).toBe(1);
    expect(m.pending(state)).toEqual({ type: 'player', seat: 1, decision: 'roll' });
    expect(m.legalActions(state, 1)).toEqual([{ type: 'roll', actor: 1, rollId: 1 }]);
    rejects(state, { type: 'bank', actor: 1 }, 'illegal');
    rejects(state, { type: 'stay', actor: 1 }, 'illegal');
  });

  it('C11 the turn variant asks only the roller to bank or roll', () => {
    const state = setup(3, rules({ banking: 'turn' }));
    expect(m.pending(state)).toEqual({ type: 'player', seat: 0, decision: 'roll' });
    expect(m.legalActions(state, 0)).toEqual([{ type: 'roll', actor: 0, rollId: 0 }]);
    expect(m.legalActions(state, 1)).toEqual([]);
    rejects(state, { type: 'bank', actor: 0 }, 'illegal');
    rejects(state, { type: 'stay', actor: 0 }, 'illegal');
    rejects(state, { type: 'stay', actor: 1 }, 'illegal');
    const rolled = playRoll(state, [1, 2]).state;
    expect(m.pending(rolled)).toEqual({ type: 'player', seat: 0, decision: 'bank-or-roll' });
    const banked = act(rolled, { type: 'bank', actor: 0 }).state;
    expect(banked.roller).toBe(1);
    expect(m.pending(banked)).toMatchObject({ seat: 1, decision: 'bank-or-roll' });
  });

  it('C30 the roller cannot stay', () => {
    const state = toRoller(setup(3));
    expect(state.roller).toBe(0);
    rejects(state, { type: 'stay', actor: 0 }, 'illegal');
    const ended = bankTheRound(setup(2, rules({ rounds: 5 })));
    expect(ended.phase === 'call' || ended.phase === 'over').toBe(true);
  });
});
