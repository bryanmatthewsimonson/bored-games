import { SHOW_DECK } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { cardOf, pendingOf } from '../../src/engine.ts';
import { roomForDoubt } from '../../src/module.ts';
import {
  act,
  dismiss,
  enter,
  legal,
  only,
  passTurn,
  posOf,
  refused,
  showCard,
  started,
  submit,
} from '../helpers.ts';

/*
 * The default deal at three seats (helpers.orderWith, the Verdict Quarrel, Clock Hand, Press Gallery):
 *   seat 0 (Ashdown): ashdown, crowther, scales, manacles, jury, store
 *   seat 1 (Reeve):   brine, faulk, reports, courtroom, robing, cells
 *   seat 2 (Faulk):   reeve, gavel, carafe, chambers, registry, belfry
 */

describe('rebuttal', () => {
  it('C26 rebuttal order: in turn order from the seat after the submitter; a dismissed seat is asked too', () => {
    // Four seats; seat 2 names the Verdict's cards in the Press Gallery, so every other seat says none.
    let s = passTurn(passTurn(started(4)));
    s = submit(enter(s, 'gallery'), 'quarrel', 'clockhand');
    const asked: number[] = [];
    for (let n = 0; n < 4 && s.stage === 'rebut'; n++) {
      const p = pendingOf(s);
      if (p.type !== 'player') throw new Error('a seat must be asked');
      expect(p.decision).toBe('rebut');
      expect(s.asking).toBe(p.seat);
      asked.push(p.seat);
      expect(legal(s)).toEqual([{ type: 'none', actor: p.seat }]);
      s = act(s, { type: 'none', actor: p.seat });
    }
    expect(asked).toEqual([3, 0, 1]);
    expect(s.submissions[0]?.passed).toEqual([3, 0, 1]);
    // Seat 0 is dismissed; when seat 1 submits, seat 0 is asked after seat 2.
    let t = submit(enter(dismiss(started(3)), 'gallery'), 'quarrel', 'clockhand');
    expect(t.asking).toBe(2);
    t = act(t, { type: 'none', actor: 2 });
    expect(pendingOf(t)).toEqual({ type: 'player', seat: 0, decision: 'rebut' });
    t = act(t, { type: 'none', actor: 0 });
    expect([t.stage, t.submissions[0]?.passed]).toEqual(['answered', [2, 0]]);
  });

  it('C27 one card: a holder shows exactly one, privately, to the submitter, and the asking stops', () => {
    // Ashdown in the Jury Room names Crowther and the Law Reports: seat 1 holds only the Law Reports.
    const s = submit(enter(started(3), 'jury'), 'crowther', 'reports');
    expect(s.asking).toBe(1);
    const marker = { type: 'show', actor: 1, pos: posOf(s, 'reports') };
    expect(legal(s)).toEqual([marker]);
    // A marker names a position, so it never reaches apply: the session sends the wire instead.
    expect(refused(s, marker)).not.toBeNull();
    expect(roomForDoubt.privateShow?.(s)).toEqual({ id: 0, from: 1, to: 0 });
    const r = roomForDoubt.apply(s, { type: 'show', actor: 1, id: 0, packet: 'opaque' });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toEqual([{ type: 'shown', seat: 1, to: 0 }]);
    expect([r.state.stage, r.state.asking, r.state.submissions[0]?.shownBy]).toEqual(['answered', null, 1]);
    expect(roomForDoubt.privateShow?.(r.state)).toBeNull();
    // Seat 2 is never asked.
    expect(r.state.submissions[0]?.passed).toEqual([]);
    expect(pendingOf(r.state)).toEqual({ type: 'player', seat: 0, decision: 'answered' });
  });

  it('C28 choice: a seat holding several of the named cards chooses which to show', () => {
    // In the Courtroom, naming Faulk and the Gavel: seat 1 holds Faulk and the Courtroom.
    const s = submit(enter(started(3), 'courtroom'), 'faulk', 'gavel');
    const faulk = posOf(s, 'faulk');
    const courtroom = posOf(s, 'courtroom');
    expect(faulk).toBeLessThan(courtroom);
    expect(legal(s)).toEqual([
      { type: 'show', actor: 1, pos: faulk },
      { type: 'show', actor: 1, pos: courtroom },
    ]);
    for (const [pos, id] of [
      [faulk, 'faulk'],
      [courtroom, 'courtroom'],
    ] as const) {
      const t = showCard(s, pos);
      expect(t.submissions[0]?.card).toBe(cardOf(id));
      expect(t.submissions[0]?.shownBy).toBe(1);
    }
  });

  it('C29 passing: a seat holding none of them says so, and the next seat is asked', () => {
    // In the Jury Room naming Reeve and the Gavel: seat 1 holds none, seat 2 holds both.
    const s = submit(enter(started(3), 'jury'), 'reeve', 'gavel');
    expect(legal(s)).toEqual([{ type: 'none', actor: 1 }]);
    const r = roomForDoubt.apply(s, { type: 'none', actor: 1 });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toEqual([{ type: 'passed', seat: 1 }]);
    expect([r.state.asking, r.state.submissions[0]?.passed]).toEqual([2, [1]]);
    expect(only(r.state, 'show').map((m) => ('pos' in m ? m.pos : null))).toEqual([
      posOf(s, 'reeve'),
      posOf(s, 'gavel'),
    ]);
    // A seat holding a named card may not say none: the full state knows its hand.
    expect(refused(r.state, { type: 'none', actor: 2 })).not.toBeNull();
    // A seat that has not yet learned its whole hand is offered nothing, so it can never answer wrongly.
    const blind = roomForDoubt.view(r.state, null);
    expect(roomForDoubt.legalActions(blind, 2)).toEqual([]);
  });

  it('C30 no rebuttal: if every other seat passes, the submission stands; end the turn or indict', () => {
    let s = submit(enter(started(3), 'gallery'), 'quarrel', 'clockhand');
    s = act(s, { type: 'none', actor: 1 });
    const r = roomForDoubt.apply(s, { type: 'none', actor: 2 });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toEqual([
      { type: 'passed', seat: 2 },
      { type: 'unrebutted', seat: 0 },
    ]);
    const t = r.state;
    expect([t.stage, t.asking, t.submissions[0]?.shownBy, t.submissions[0]?.passed]).toEqual([
      'answered',
      null,
      null,
      [1, 2],
    ]);
    expect(legal(t).map((a) => a.type)).toEqual([...Array(324).fill('indict'), 'endTurn']);
    expect(act(t, { type: 'endTurn', actor: 0 }).turn).toBe(1);
    expect(
      act(t, { type: 'indict', actor: 0, party: 'quarrel', exhibit: 'clockhand', scene: 'gallery' }).stage,
    ).toBe('verdict');
  });

  it('C31 rebuttal privacy: only the submitter learns which card was shown; everyone sees who showed one', () => {
    // Four seats: Ashdown names Brine and the Scales in the Courtroom; seat 1 (Brine) holds Brine.
    const s = submit(enter(started(4), 'courtroom'), 'brine', 'scales');
    expect(s.asking).toBe(1);
    const pos = posOf(s, 'brine');
    expect(legal(s)).toContainEqual({ type: 'show', actor: 1, pos });
    const wire = { type: 'show', actor: 1, id: 0, packet: 'opaque' };
    expect(Object.keys(wire).sort()).toEqual(['actor', 'id', 'packet', 'type']);
    const t = showCard(s, pos);
    const card = cardOf('brine');
    expect(t.submissions[0]?.card).toBe(card);
    // The submitter and the shower hold the card; the other seats and a spectator see only who showed one.
    for (const viewer of [0, 1]) expect(roomForDoubt.view(t, viewer).submissions[0]?.card).toBe(card);
    for (const viewer of [2, 3, null]) {
      const v = roomForDoubt.view(t, viewer);
      expect(v.submissions[0]).toMatchObject({ shownBy: 1, card: null });
      // Only the shower and the submitter may learn it.
      expect(roomForDoubt.learn(v, { deck: SHOW_DECK, pos: 0, card }).ok).toBe(false);
    }
    // The views of the two seats learn it after the wire, as the session delivers it.
    for (const viewer of [0, 1]) {
      const v = act(roomForDoubt.view(s, viewer), wire);
      expect(v.submissions[0]?.card).toBeNull();
      const l = roomForDoubt.learn(v, { deck: SHOW_DECK, pos: 0, card });
      expect(l.ok && l.state.submissions[0]?.card).toBe(card);
    }
    // No dealt entry, known card or event carries the position or the card.
    expect(t.dealt).toEqual(s.dealt);
    for (const seat of [0, 1, 2, 3])
      expect(roomForDoubt.knownTo(t, seat).filter((l) => l.deck === SHOW_DECK)).toEqual([]);
    const r = roomForDoubt.apply(s, wire);
    expect(r.ok && r.events).toEqual([{ type: 'shown', seat: 1, to: 0 }]);
  });
});
