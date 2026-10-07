import { describe, expect, it } from 'vitest';
import { CORRIDOR, type Place, squareIndex } from '../../src/board.ts';
import { occupiedSquares, pendingOf } from '../../src/engine.ts';
import type { PartyId } from '../../src/ids.ts';
import { roomForDoubt } from '../../src/module.ts';
import { destinations } from '../../src/movement.ts';
import type { RfdState } from '../../src/types.ts';
import {
  act,
  answerAll,
  dismiss,
  enter,
  legal,
  only,
  refused,
  rollTo,
  started,
  submit,
  withPawns,
} from '../helpers.ts';

const ROLLS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Two faces that make `roll`. */
const facesFor = (roll: number): [number, number] => [Math.ceil(roll / 2), Math.floor(roll / 2)];

/** Seat 0 (Ashdown) walks a roll of `roll` from `from`, other pawns placed by Party; the rest stay on Entrances. */
const walking = (from: Place, roll: number, others: Partial<Record<PartyId, Place>> = {}): RfdState =>
  rollTo(withPawns(started(3), { ...others, ashdown: from }), facesFor(roll));

/** Where the pending seat may move, as the engine lists it. */
const moves = (s: RfdState): string[] => only(s, 'move').map((m) => m.to);

/**
 * The engine offers exactly the movement search's places over every pawn on the board (Task 3's cases, played
 * through `move`), each listed move is accepted, and each of `refusedTo` is refused.
 */
function expectWalk(s: RfdState, expected: readonly string[], refusedTo: readonly string[] = []): void {
  const seat = s.turn;
  const roll = (s.dice?.[0] ?? 0) + (s.dice?.[1] ?? 0);
  const party = s.players[seat]?.party as number;
  expect(moves(s)).toEqual(destinations(s.pawns[party] as Place, roll, occupiedSquares(s)).places);
  expect(moves(s)).toEqual(expected);
  for (const to of moves(s)) {
    const t = act(s, { type: 'move', actor: seat, to });
    expect(t.pawns[party]).toBe(to);
    expect(t.stage).toBe('moved');
  }
  for (const to of refusedTo) expect(refused(s, { type: 'move', actor: seat, to }), to).not.toBeNull();
}

describe('movement', () => {
  it('C08 turn shape: start, roll, walk, moved, start again; nothing is accepted out of turn', () => {
    let s = started(3);
    expect(s.stage).toBe('start');
    for (const seat of [1, 2]) expect(refused(s, { type: 'roll', actor: seat })).not.toBeNull();
    s = act(s, { type: 'roll', actor: 0 });
    expect(s.stage).toBe('roll');
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 1, decision: 'contribute' });
    for (const seat of [0, 2]) expect(refused(s, { type: 'contribute', actor: seat, id: 0 })).not.toBeNull();
    s = act(act(act(s, { type: 'contribute', actor: 1, id: 0 }), { type: 'contribute', actor: 2, id: 0 }), {
      type: 'contribute',
      actor: 0,
      id: 0,
    });
    expect(pendingOf(s)).toEqual({ type: 'beacon', id: 0 });
    expect(legal(s, 0)).toEqual([]);
    s = act(s, { type: 'rolled', actor: 'beacon', id: 0, dice: [1, 1] });
    expect(s.stage).toBe('walk');
    for (const seat of [1, 2]) expect(refused(s, { type: 'move', actor: seat, to: 'G2' })).not.toBeNull();
    s = act(s, { type: 'move', actor: 0, to: 'G2' });
    expect(s.stage).toBe('moved');
    for (const seat of [1, 2]) expect(refused(s, { type: 'endTurn', actor: seat })).not.toBeNull();
    // With no room entered there is nothing to submit: the turn ends (or an indictment would end it, C32).
    expect(legal(s).map((a) => a.type)).toEqual(['endTurn', ...Array(324).fill('indict')]);
    s = act(s, { type: 'endTurn', actor: 0 });
    expect([s.stage, s.turn, s.dice, s.entered]).toEqual(['start', 1, null, false]);
    // A turn that enters a room: movement, submission, rebuttal, then the end.
    let t = enter(started(3), 'courtroom');
    expect([t.stage, t.entered]).toEqual(['moved', true]);
    t = answerAll(submit(t, 'faulk', 'gavel'));
    expect(t.stage).toBe('answered');
    expect(act(t, { type: 'endTurn', actor: 0 }).turn).toBe(1);
  });

  it('C09 roll: two dice, faces 1 to 6, from every seat in turn; a player never sends the dice', () => {
    let s = act(started(4), { type: 'roll', actor: 0 });
    expect(s.rolls).toEqual([{ id: 0, last: 0 }]);
    expect(s.contributors).toEqual([1, 2, 3, 0]);
    // A share for another roll is refused.
    expect(refused(s, { type: 'contribute', actor: 1, id: 1 })).not.toBeNull();
    for (const seat of [1, 2, 3, 0]) {
      expect(legal(s)).toEqual([{ type: 'contribute', actor: seat, id: 0 }]);
      expect(roomForDoubt.beaconOf?.(s, legal(s)[0])).toBe(0);
      s = act(s, { type: 'contribute', actor: seat, id: 0 });
    }
    expect(pendingOf(s)).toEqual({ type: 'beacon', id: 0 });
    for (const bad of [
      { type: 'rolled', actor: 0, id: 0, dice: [3, 4] },
      { type: 'rolled', actor: 'beacon', id: 0, dice: [3, 4, 5] },
      { type: 'rolled', actor: 'beacon', id: 0, dice: [3] },
      { type: 'rolled', actor: 'beacon', id: 0, dice: [7, 1] },
      { type: 'rolled', actor: 'beacon', id: 0, dice: [0, 6] },
      { type: 'rolled', actor: 'beacon', id: 0, dice: [2.5, 3] },
      { type: 'rolled', actor: 'beacon', id: 1, dice: [3, 4] },
    ])
      expect(refused(s, bad), JSON.stringify(bad)).not.toBeNull();
    for (const dice of [
      [1, 1],
      [1, 6],
      [6, 6],
    ]) {
      const t = act(s, { type: 'rolled', actor: 'beacon', id: 0, dice });
      expect(t.dice).toEqual(dice);
      expect([t.stage, t.roll]).toEqual(['walk', null]);
    }
    // The seat after the roller starts the contributions, and the roller adds its share last.
    const two = act(rollTo(started(4), [1, 1]), { type: 'move', actor: 0, to: 'G2' });
    const next = act(act(two, { type: 'endTurn', actor: 0 }), { type: 'roll', actor: 1 });
    expect(next.contributors).toEqual([2, 3, 0, 1]);
    expect(next.rolls).toEqual([
      { id: 0, last: 0 },
      { id: 1, last: 1 },
    ]);
    // No legal list ever holds the dice.
    for (const state of [started(4), s, next])
      for (const a of legal(state)) expect(a.type).not.toBe('rolled');
  });

  it('C10 orthogonal movement: one step at a time, never diagonal', () => {
    expectWalk(walking('H1', 2), ['G2', 'H3'], ['G3', 'H2', 'G1', 'H1']);
    expectWalk(walking('H1', 3), ['G1', 'H2', 'G3', 'H4', 'courtroom'], ['G2', 'H3', 'I2']);
  });

  it('C11 occupied squares: no pawn enters or ends on a pawn, unplayed and dismissed Parties included', () => {
    // Brine is unplayed at three seats.
    expectWalk(walking('H1', 2, { brine: 'H2' }), ['G2'], ['H3', 'H2']);
    expectWalk(walking('H1', 2, { brine: 'G2' }), ['H3'], ['G2']);
    // Ashdown, dismissed, still stands in the way of Reeve.
    const out = dismiss(started(3));
    expect(out.players[0]?.dismissed).toBe(true);
    const s = rollTo(withPawns(out, { ashdown: 'H2', reeve: 'H1' }), [1, 1]);
    expect(s.turn).toBe(1);
    expectWalk(s, ['G2'], ['H3', 'H2']);
  });

  it('C12 repeated squares: no square is entered twice in a turn', () => {
    for (const roll of ROLLS) {
      const s = walking('H1', roll);
      expect(moves(s), `roll ${roll}`).not.toContain('H1');
      expect(refused(s, { type: 'move', actor: 0, to: 'H1' })).not.toBeNull();
    }
    // Four steps could return to the start, or to G2 by the long way round; only the far squares are offered.
    expect(moves(walking('H1', 4))).not.toContain('H1');
  });

  it('C13 doors: a door is one step between its doorstep and the room; the doorway is no square', () => {
    // H3 is the Courtroom's doorstep: two steps reach it, and the door is the third.
    expectWalk(walking('H1', 2), ['G2', 'H3'], ['courtroom', 'I3']);
    expect(moves(walking('H1', 3))).toContain('courtroom');
    // Out of a room by each door in turn, the doorstep being the first step.
    expectWalk(walking('courtroom', 2), ['H2', 'G3', 'H4', 'L7', 'N7', 'M8'], ['H3', 'M7', 'I3', 'M6']);
  });

  it('C14 blocked doors: a door whose doorstep holds a pawn cannot be used, in either direction', () => {
    expect(moves(walking('H1', 3, { brine: 'H3' }))).not.toContain('courtroom');
    expectWalk(walking('courtroom', 2, { brine: 'H3' }), ['L7', 'N7', 'M8'], ['H2', 'G3', 'H4']);
    // A pawn on a doorstep does not shut its own door.
    expect(moves(walking('H3', 2))).toContain('courtroom');
  });

  it('C15 room entry: entering a room ends the move, whatever part of the roll remains', () => {
    const s = walking('H1', 12);
    expect(moves(s)).toContain('courtroom');
    for (const to of moves(s)) {
      const i = squareIndex(to);
      if (i !== null) expect(CORRIDOR.has(i), to).toBe(true);
    }
    const t = act(s, { type: 'move', actor: 0, to: 'courtroom' });
    expect([t.pawns[0], t.stage, t.entered, t.dice]).toEqual(['courtroom', 'moved', true, [6, 6]]);
    expect(only(t, 'move')).toEqual([]);
    expect(only(t, 'submit')).toHaveLength(36);
    // A walk that ends on a square enters nothing.
    expect(act(s, { type: 'move', actor: 0, to: moves(s)[0] }).entered).toBe(false);
  });

  it('C16 no re-entry: a Party never enters the room it left earlier in the turn', () => {
    for (const roll of ROLLS) {
      const s = walking('courtroom', roll);
      expect(moves(s), `roll ${roll}`).not.toContain('courtroom');
      expect(refused(s, { type: 'move', actor: 0, to: 'courtroom' })).not.toBeNull();
    }
  });

  it('C17 Old Gaol Passages: from a corner room at the start, instead of rolling, to the opposite one', () => {
    for (const [from, to] of [
      ['chambers', 'store'],
      ['belfry', 'cells'],
      ['store', 'chambers'],
      ['cells', 'belfry'],
    ] as const) {
      const s = withPawns(started(3), { ashdown: from });
      expect(only(s, 'passage')).toEqual([{ type: 'passage', actor: 0 }]);
      const r = roomForDoubt.apply(s, { type: 'passage', actor: 0 });
      if (!r.ok) throw new Error(r.error.message);
      expect([r.state.pawns[0], r.state.stage, r.state.entered]).toEqual([to, 'moved', true]);
      expect(r.events).toEqual([{ type: 'moved', seat: 0, to, how: 'passage' }]);
      // It counts as having entered the room: a submission may follow.
      expect(only(r.state, 'submit')).toHaveLength(36);
      // Only at the start of the turn, instead of rolling.
      const rolled = rollTo(s, [1, 1]);
      expect(only(rolled, 'passage')).toEqual([]);
      expect(refused(rolled, { type: 'passage', actor: 0 })).not.toBeNull();
      expect(refused(r.state, { type: 'passage', actor: 0 })).not.toBeNull();
    }
    // Not from a room without a passage, nor from a square.
    for (const from of ['courtroom', 'jury', 'gallery', 'H1', 'G4']) {
      const s = withPawns(started(3), { ashdown: from });
      expect(only(s, 'passage'), from).toEqual([]);
      expect(refused(s, { type: 'passage', actor: 0 }), from).not.toBeNull();
    }
  });

  it('C18 trapped: a Party with no legal move passes it; it may still indict, or submit if it was moved', () => {
    // Walled in at G1: H1 and G2 hold pawns, and the Chambers' wall is to the west.
    const s = withPawns(started(3), { ashdown: 'G1', brine: 'H1', reeve: 'G2' });
    expect(legal(s).map((a) => a.type)).toEqual(['stay', ...Array(324).fill('indict')]);
    expect(refused(s, { type: 'roll', actor: 0 })).not.toBeNull();
    const r = roomForDoubt.apply(s, { type: 'stay', actor: 0 });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toEqual([{ type: 'moved', seat: 0, to: 'G1', how: 'stay' }]);
    expect([r.state.pawns[0], r.state.stage, r.state.entered]).toEqual(['G1', 'moved', false]);
    expect(only(r.state, 'submit')).toEqual([]);
    expect(legal(r.state).map((a) => a.type)).toEqual(['endTurn', ...Array(324).fill('indict')]);
    // A Party that can move may not stay.
    expect(refused(started(3), { type: 'stay', actor: 0 })).not.toBeNull();
    // Reeve, moved into the Courtroom by Ashdown's submission, finds both doorsteps taken: it may submit there at
    // the start of its turn, or stay; after staying it may not submit.
    let t = answerAll(submit(enter(started(3), 'courtroom'), 'reeve', 'gavel'));
    t = act(t, { type: 'endTurn', actor: 0 });
    t = withPawns(t, { brine: 'H3', crowther: 'M7' });
    expect([t.turn, t.players[1]?.summoned, t.pawns[2]]).toEqual([1, true, 'courtroom']);
    expect(legal(t).map((a) => a.type)).toEqual([
      'stay',
      ...Array(36).fill('submit'),
      ...Array(324).fill('indict'),
    ]);
    const stayed = act(t, { type: 'stay', actor: 1 });
    expect(stayed.players[1]?.summoned).toBe(false);
    expect(only(stayed, 'submit')).toEqual([]);
    expect(act(t, { type: 'submit', actor: 1, party: 'brine', exhibit: 'carafe' }).stage).toBe('rebut');
    // In a corner room with both doorsteps taken the passage is still a move, and staying the other choice.
    const corner = withPawns(started(3), { ashdown: 'chambers', brine: 'G4', crowther: 'B7' });
    expect(legal(corner).map((a) => a.type)).toEqual(['stay', 'passage', ...Array(324).fill('indict')]);
  });

  it('C19 roll shortfall: no full path and no room on the way, so the longest legal path (P4)', () => {
    const blockers = { brine: 'G4', reeve: 'H3', crowther: 'G5', faulk: 'H5' };
    const s = walking('H1', 6, blockers);
    expect(destinations('H1', 6, occupiedSquares(s))).toEqual({
      places: ['G1', 'H2', 'G3'],
      shortfall: true,
    });
    expectWalk(s, ['G1', 'H2', 'G3'], ['G2', 'H1']);
    const r = roomForDoubt.apply(s, { type: 'move', actor: 0, to: 'G3' });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toEqual([{ type: 'moved', seat: 0, to: 'G3', how: 'shortfall' }]);
    // The same squares are a full walk of 3.
    const three = walking('H1', 3, blockers);
    expectWalk(three, ['G1', 'H2', 'G3']);
    const w = roomForDoubt.apply(three, { type: 'move', actor: 0, to: 'G3' });
    expect(w.ok && w.events).toEqual([{ type: 'moved', seat: 0, to: 'G3', how: 'walk' }]);
    // Short of the roll with a room on the way, only the room is offered.
    expectWalk(walking('G3', 12, { brine: 'G2', reeve: 'G4', crowther: 'H4' }), ['courtroom'], ['H1']);
  });
});
