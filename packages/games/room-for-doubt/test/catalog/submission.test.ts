import { describe, expect, it } from 'vitest';
import { cardOf } from '../../src/engine.ts';
import { EXHIBITS, PARTIES } from '../../src/ids.ts';
import { roomForDoubt } from '../../src/module.ts';
import type { RfdRules } from '../../src/types.ts';
import {
  act,
  answerAll,
  dismiss,
  enter,
  legal,
  only,
  passTurn,
  refused,
  rollTo,
  started,
  submit,
  withPawns,
} from '../helpers.ts';

const RULES: readonly RfdRules[] = [{ submit: 'optional' }, { submit: 'required' }];

describe('submission', () => {
  it('C20 submission on entry: after entering a room by roll or by passage, as the rule option says', () => {
    for (const rules of RULES) {
      const byRoll = enter(started(3, undefined, rules), 'courtroom');
      const byPassage = act(withPawns(started(3, undefined, rules), { ashdown: 'chambers' }), {
        type: 'passage',
        actor: 0,
      });
      for (const s of [byRoll, byPassage]) {
        expect(only(s, 'submit')).toHaveLength(36);
        const optional = rules.submit === 'optional';
        // Optional: the turn may end without one. Required: it may not, though an indictment still may.
        expect(only(s, 'endTurn')).toEqual(optional ? [{ type: 'endTurn', actor: 0 }] : []);
        expect(refused(s, { type: 'endTurn', actor: 0 }) === null).toBe(optional);
        expect(only(s, 'indict')).toHaveLength(324);
        expect(legal(s).map((a) => a.type)).toEqual([
          ...Array(36).fill('submit'),
          ...(optional ? ['endTurn'] : []),
          ...Array(324).fill('indict'),
        ]);
        // Once the submission is answered, the turn may end under either rule.
        const t = answerAll(submit(s, 'faulk', 'gavel'));
        expect(only(t, 'endTurn')).toEqual([{ type: 'endTurn', actor: 0 }]);
      }
      // A walk that ends on a square owes no submission and offers none.
      const square = act(rollTo(started(3, undefined, rules), [1, 1]), { type: 'move', actor: 0, to: 'G2' });
      expect(only(square, 'submit')).toEqual([]);
      expect(only(square, 'endTurn')).toEqual([{ type: 'endTurn', actor: 0 }]);
      expect(refused(square, { type: 'submit', actor: 0, party: 'faulk', exhibit: 'gavel' })).not.toBeNull();
    }
    expect(roomForDoubt.validateRules({ submit: 'required' })).toEqual({
      ok: true,
      value: { submit: 'required' },
    });
    for (const bad of [{}, { submit: 'sometimes' }, { submit: 'optional', dice: 'live' }, null, 'optional'])
      expect(roomForDoubt.validateRules(bad).ok, JSON.stringify(bad)).toBe(false);
  });

  it('C21 one submission per entry: never twice without leaving and entering again, or being moved again', () => {
    let s = answerAll(submit(enter(started(3), 'courtroom'), 'ashdown', 'gavel'));
    expect(s.stage).toBe('answered');
    expect(only(s, 'submit')).toEqual([]);
    expect(refused(s, { type: 'submit', actor: 0, party: 'brine', exhibit: 'scales' })).not.toBeNull();
    // Round the table to seat 0 again: its pawn is still in the Courtroom, which it has not entered again.
    s = passTurn(passTurn(act(s, { type: 'endTurn', actor: 0 })));
    expect([s.turn, s.stage, s.pawns[0], s.players[0]?.summoned]).toEqual([0, 'start', 'courtroom', false]);
    expect(only(s, 'submit')).toEqual([]);
    expect(refused(s, { type: 'submit', actor: 0, party: 'brine', exhibit: 'scales' })).not.toBeNull();
    // Moved into the Jury Room by Reeve's submission, Ashdown may submit there at the start of its next turn.
    let t = passTurn(started(3));
    t = submit(enter(t, 'jury'), 'ashdown', 'carafe');
    expect([t.pawns[0], t.players[0]?.summoned]).toEqual(['jury', true]);
    t = passTurn(act(answerAll(t), { type: 'endTurn', actor: 1 }));
    expect([t.turn, t.stage]).toEqual([0, 'start']);
    expect(only(t, 'submit')).toHaveLength(36);
  });

  it('C22 the moved Party: it may submit in that room at the start of its next turn, or leave normally', () => {
    // Ashdown names Reeve (seat 1), who stands on its Entrance: Reeve's pawn comes into the Courtroom.
    const r = roomForDoubt.apply(enter(started(3), 'courtroom'), {
      type: 'submit',
      actor: 0,
      party: 'reeve',
      exhibit: 'gavel',
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toEqual([
      { type: 'submitted', seat: 0, party: 'reeve', exhibit: 'gavel', scene: 'courtroom', summoned: false },
    ]);
    expect(r.state.pawns[2]).toBe('courtroom');
    expect(r.state.players.map((p) => p.summoned)).toEqual([false, true, false]);
    const s = act(answerAll(r.state), { type: 'endTurn', actor: 0 });
    expect([s.turn, s.stage]).toEqual([1, 'start']);
    expect(only(s, 'submit')).toHaveLength(36);
    expect(legal(s).map((a) => a.type)).toEqual([
      'roll',
      ...Array(36).fill('submit'),
      ...Array(324).fill('indict'),
    ]);
    // It may submit at once, in the Courtroom, instead of rolling...
    const now = roomForDoubt.apply(s, { type: 'submit', actor: 1, party: 'faulk', exhibit: 'scales' });
    if (!now.ok) throw new Error(now.error.message);
    expect(now.events).toEqual([
      { type: 'submitted', seat: 1, party: 'faulk', exhibit: 'scales', scene: 'courtroom', summoned: true },
    ]);
    expect(now.state.players[1]?.summoned).toBe(false);
    expect(now.state.submissions[1]).toMatchObject({ by: 1, party: 'faulk', scene: 'courtroom' });
    // ...or leave normally: rolling clears the summons, and the walk must enter a room for another submission.
    const rolled = act(s, { type: 'roll', actor: 1 });
    expect(rolled.players[1]?.summoned).toBe(false);
    const walked = act(rollTo(s, [1, 1]), { type: 'move', actor: 1, to: 'G3' });
    expect(only(walked, 'submit')).toEqual([]);
    // A Party already in the room is not moved, and gains nothing.
    const there = submit(enter(withPawns(started(3), { faulk: 'courtroom' }), 'courtroom'), 'faulk', 'gavel');
    expect(there.pawns[4]).toBe('courtroom');
    expect(there.players.map((p) => p.summoned)).toEqual([false, false, false]);
  });

  it('C23 submission contents: any Party, any Exhibit, and the room the submitter stands in', () => {
    const s = enter(started(3), 'jury');
    expect(only(s, 'submit')).toEqual(
      PARTIES.flatMap((party) => EXHIBITS.map((exhibit) => ({ type: 'submit', actor: 0, party, exhibit }))),
    );
    const t = submit(s, 'crowther', 'manacles');
    expect(t.submissions).toEqual([
      { by: 0, party: 'crowther', exhibit: 'manacles', scene: 'jury', passed: [], shownBy: null, card: null },
    ]);
    expect([t.stage, t.asking, t.entered]).toEqual(['rebut', 1, false]);
    // The room is the one the submitter stands in, so a submission names no Scene.
    for (const bad of [
      { type: 'submit', actor: 0, party: 'crowther', exhibit: 'manacles', scene: 'jury' },
      { type: 'submit', actor: 0, party: 'crowther', exhibit: 'jury' },
      { type: 'submit', actor: 0, party: 'gavel', exhibit: 'manacles' },
      { type: 'submit', actor: 0, party: 'Crowther', exhibit: 'manacles' },
      { type: 'submit', actor: 1, party: 'crowther', exhibit: 'manacles' },
    ])
      expect(refused(s, bad), JSON.stringify(bad)).not.toBeNull();
  });

  it('C24 named items move: the pawn and the token come into the room; nothing moves that is already there', () => {
    // Four seats: Ashdown, Brine, Crowther and Faulk. The Manacles start in the Registry.
    const s = enter(started(4), 'registry');
    const t = submit(s, 'crowther', 'gavel');
    expect([t.pawns[3], t.exhibits[0]]).toEqual(['registry', 'registry']);
    expect(t.pawns.filter((_, i) => i !== 3)).toEqual(s.pawns.filter((_, i) => i !== 3));
    expect(t.exhibits.filter((_, i) => i !== 0)).toEqual(s.exhibits.filter((_, i) => i !== 0));
    // A room holds any number of pawns and tokens.
    expect(t.pawns.filter((p) => p === 'registry')).toHaveLength(2);
    expect(t.exhibits.filter((e) => e === 'registry')).toHaveLength(2);
    // Naming the submitter's own Party and an Exhibit already in the room moves nothing.
    const u = submit(s, 'ashdown', 'manacles');
    expect([u.pawns, u.exhibits]).toEqual([s.pawns, s.exhibits]);
  });

  it('C25 own cards: a submission may name cards the submitter holds', () => {
    const s = enter(started(3), 'jury');
    const mine = s.players[0]?.hand.map((h) => h.card);
    for (const id of ['crowther', 'scales', 'jury'] as const) expect(mine).toContain(cardOf(id));
    expect(only(s, 'submit')).toContainEqual({
      type: 'submit',
      actor: 0,
      party: 'crowther',
      exhibit: 'scales',
    });
    // Nobody else holds them, so the submission stands unrebutted.
    const t = answerAll(submit(s, 'crowther', 'scales'));
    expect(t.submissions[0]).toMatchObject({ passed: [1, 2], shownBy: null, card: null });
  });

  it('C40 named Parties move: played, unplayed or dismissed', () => {
    // Brine is unplayed at three seats: its pawn leaves its Entrance, and no seat is summoned.
    const s = submit(enter(started(3), 'courtroom'), 'brine', 'gavel');
    expect(s.pawns[1]).toBe('courtroom');
    expect(s.players.map((p) => p.summoned)).toEqual([false, false, false]);
    // Ashdown's seat is dismissed; Reeve still names Ashdown, whose pawn goes to the Jury Room. A dismissed seat
    // takes no turns, so it is not summoned.
    const out = dismiss(started(3));
    expect([out.turn, out.players[0]?.dismissed]).toEqual([1, true]);
    const t = submit(enter(out, 'jury'), 'ashdown', 'carafe');
    expect(t.pawns[0]).toBe('jury');
    expect(t.players[0]?.summoned).toBe(false);
  });
});
