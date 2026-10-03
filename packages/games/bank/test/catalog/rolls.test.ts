import { describe, expect, it } from 'vitest';
import { beaconOf, contributeOrder, pendingOf } from '../../src/index.ts';
import { act, playRoll, rejects, setup, toRoller } from '../helpers.ts';

describe('rolls', () => {
  it('C12 a safe roll adds the face sum', () => {
    const state = playRoll(setup(3), [1, 2]).state;
    expect(state.pot).toBe(3);
    expect(state.rolls).toBe(1);
    expect(state.phase).toBe('call');
    expect(state.passed).toEqual([]);
  });

  it('C13 a safe seven adds 70', () => {
    const played = playRoll(setup(3), [1, 6]);
    expect(played.state.pot).toBe(70);
    expect(played.events).toContainEqual({
      type: 'dice',
      rollId: 0,
      dice: [1, 6],
      effect: 'seventy',
      pot: 70,
      capped: false,
    });
  });

  it('C14 a safe double adds the pips, and does not double', () => {
    expect(playRoll(setup(3), [1, 1]).state.pot).toBe(2);
  });

  it('C15 an unsafe roll that is not a seven or a double adds the face sum', () => {
    let state = setup(3);
    for (let i = 0; i < 3; i++) state = playRoll(state, [1, 2]).state;
    expect(state.pot).toBe(9);
    expect(state.rolls).toBe(3);
    state = playRoll(state, [1, 3]).state;
    expect(state.pot).toBe(13);
    expect(state.rolls).toBe(4);
  });

  it('C16 an unsafe double doubles the pot and does not also add the pips', () => {
    let state = setup(3);
    for (let i = 0; i < 3; i++) state = playRoll(state, [1, 2]).state;
    const played = playRoll(state, [2, 2]);
    expect(played.state.pot).toBe(18);
    expect(played.events).toContainEqual(
      expect.objectContaining({ type: 'dice', effect: 'double', pot: 18 }),
    );
  });

  it('C17 an unsafe seven busts the round and keeps what was already banked', () => {
    let state = setup(3);
    for (let i = 0; i < 3; i++) state = playRoll(state, [1, 2]).state;
    state = act(state, { type: 'bank', actor: 1 }).state;
    expect(state.scores[1]).toBe(9);
    state = playRoll(state, [2, 5]).state;
    expect(state.pot).toBe(0);
    expect(state.scores).toEqual([0, 9, 0]);
    expect(state.round).toBe(1);
    expect(state.phase).toBe('call');
  });

  it('C18 rolling commits the next id and does not change the pot', () => {
    const ready = toRoller(setup(4));
    expect(ready.pot).toBe(0);
    expect(beaconOf(ready, { type: 'roll', actor: 0, rollId: 0 })).toBe(0);
    expect(beaconOf(ready, { type: 'bank', actor: 0 })).toBeNull();
    const committed = act(ready, { type: 'roll', actor: 0, rollId: 0 }).state;
    expect(committed.pot).toBe(0);
    expect(committed.rolls).toBe(0);
    expect(committed.phase).toBe('collect');
    expect(committed.openRoll).toBe(0);
    expect(committed.nextRollId).toBe(1);
    expect(committed.schedule).toEqual([{ id: 0, last: 1 }]);
  });

  it('C19 contributions are every other seat, ending on the seat after the roller', () => {
    expect(contributeOrder(0, 4)).toEqual([2, 3, 1]);
    expect(contributeOrder(0, 2)).toEqual([1]);
    expect(contributeOrder(3, 6)).toEqual([5, 0, 1, 2, 4]);
    const state = act(toRoller(setup(4)), { type: 'roll', actor: 0, rollId: 0 }).state;
    expect(state.owe).toEqual([2, 3, 1]);
    expect(pendingOf(state)).toEqual({ type: 'player', seat: 2, decision: 'contribute' });
    const mid = act(state, { type: 'contribute', actor: 2, rollId: 0 }).state;
    expect(mid.owe).toEqual([3, 1]);
    expect(mid.pot).toBe(0);
  });

  it('C20 the wrong seat, the wrong id and a second resolution are rejected', () => {
    const ready = toRoller(setup(3));
    rejects(ready, { type: 'roll', actor: 1, rollId: 0 }, 'turn');
    rejects(ready, { type: 'roll', actor: 0, rollId: 1 }, 'illegal');
    let state = act(ready, { type: 'roll', actor: 0, rollId: 0 }).state;
    expect(state.owe[0]).toBe(2);
    rejects(state, { type: 'contribute', actor: 1, rollId: 0 }, 'turn');
    rejects(state, { type: 'contribute', actor: 2, rollId: 1 }, 'illegal');
    while (state.phase === 'collect') {
      state = act(state, { type: 'contribute', actor: state.owe[0], rollId: 0 }).state;
    }
    const resolved = act(state, { type: 'rolled', actor: 'beacon', id: 0, dice: [1, 2] }).state;
    rejects(resolved, { type: 'rolled', actor: 'beacon', id: 0, dice: [1, 2] }, 'illegal');
    rejects(state, { type: 'rolled', actor: 'beacon', id: 1, dice: [1, 2] }, 'illegal');
  });

  it('C21 faces outside 1 to 6 are rejected', () => {
    let state = act(toRoller(setup(2)), { type: 'roll', actor: 0, rollId: 0 }).state;
    state = act(state, { type: 'contribute', actor: 1, rollId: 0 }).state;
    expect(state.phase).toBe('beacon');
    rejects(state, { type: 'rolled', actor: 'beacon', id: 0, dice: [0, 1] }, 'illegal');
    rejects(state, { type: 'rolled', actor: 'beacon', id: 0, dice: [7, 1] }, 'illegal');
    rejects(state, { type: 'rolled', actor: 'beacon', id: 0, dice: [1] }, 'malformed');
    rejects(state, { type: 'rolled', actor: 'beacon', id: 0, dice: [1, 2, 3] }, 'malformed');
    rejects(state, { type: 'rolled', actor: 'beacon', id: 0, dice: [1.5, 2] }, 'malformed');
    expect(state.phase).toBe('beacon');
  });
});
