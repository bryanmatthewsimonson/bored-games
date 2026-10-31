import { describe, expect, it } from 'vitest';
import type { Role } from '../../src/data.ts';
import { reliefCard } from '../../src/data.ts';
import { legalActions, pendingOf } from '../../src/engine.ts';
import { NEIGHBOURS, START_CITY } from '../../src/map.ts';
import { act, at, cases, clean, edit, endTurn, started, withHand } from '../helpers.ts';

/** Seat 0 has `role`, seat 1 is the Courier unless `role` is; a clean board. */
const with0 = (role: Role, other: Role = role === 'courier' ? 'archivist' : 'courier', plan = {}) =>
  clean(started(2, { roles: [role, other], ...plan }));
const types = (s: ReturnType<typeof with0>, seat = 0) => new Set(legalActions(s, seat).map((a) => a.type));

describe('roles', () => {
  it('C25 the Archivist stores one discarded relief; played from the role card it leaves the game', () => {
    let s = edit(with0('archivist'), { discard: [reliefCard('lull'), 20] });
    expect(legalActions(s, 0).filter((a) => a.type === 'retrieve')).toEqual([
      { type: 'retrieve', actor: 0, card: reliefCard('lull') },
    ]);
    s = act(s, { type: 'retrieve', actor: 0, card: reliefCard('lull') });
    expect(s.stored[0]).toBe(reliefCard('lull'));
    expect(s.discard).toEqual([20]);
    expect(s.actions).toBe(3);
    expect(types(edit(s, { discard: [reliefCard('permit')] }))).not.toContain('retrieve');
    s = act(s, { type: 'lull', actor: 0 });
    expect(s.stored[0]).toBeNull();
    expect(s.removed).toEqual([reliefCard('lull')]);
    expect(types(with0('courier'))).not.toContain('retrieve');
  });

  it('C26 the Coordinator moves others as its own with its cards, or any pawn to another pawn', () => {
    let s = at(withHand(with0('coordinator'), 0, [30]), 1, 20);
    expect(legalActions(s, 0)).toContainEqual({ type: 'fly', actor: 0, pawn: 1, to: 30 });
    s = act(s, { type: 'fly', actor: 0, pawn: 1, to: 30 });
    expect(s.at).toEqual([START_CITY, 30]);
    expect(s.hands[0]).toEqual([]);
    expect(legalActions(s, 0)).toContainEqual({ type: 'summon', actor: 0, pawn: 0, to: 30 });
    s = act(s, { type: 'summon', actor: 0, pawn: 1, to: START_CITY });
    expect(s.at).toEqual([START_CITY, START_CITY]);
    // Others cannot move pawns but their own.
    expect(legalActions(with0('courier', 'coordinator'), 0).some((a) => 'pawn' in a && a.pawn !== 0)).toBe(
      false,
    );
  });

  it('C27 the Paramedic treats a whole strain, clears and shields cured strains where it stands, even when moved', () => {
    let s = cases(with0('paramedic'), START_CITY, 1, 3);
    s = act(s, { type: 'treat', actor: 0, strain: 1 });
    expect(s.cases[START_CITY]?.[1]).toBe(0);
    // Walking into a city with a cured strain clears it without an action.
    s = cases(edit(s, { cured: [true, false, false, false] }), 5, 0, 2);
    s = act(s, { type: 'travel', actor: 0, pawn: 0, to: 5 });
    expect(s.cases[5]?.[0]).toBe(0);
    expect(s.actions).toBe(2);
    // Moved by Medevac on another's decision, it still clears.
    let m = withHand(
      cases(edit(with0('courier', 'paramedic'), { cured: [false, false, true, false] }), 30, 2, 3),
      0,
      [reliefCard('medevac')],
    );
    m = act(m, { type: 'medevac', actor: 0, pawn: 1, to: 30 });
    expect(m.cases[30]?.[2]).toBe(0);
    // No case of a cured strain can be placed where it stands: city 9 tops the spread deck.
    const shield = endTurn(at(edit(with0('paramedic'), { cured: [true, false, false, false] }), 0, 9));
    expect(shield.events.find((e) => e.type === 'blocked')).toMatchObject({ city: 9, strain: 0 });
    expect(shield.state.cases[9]?.[0]).toBe(0);
  });

  it('C28 the Engineer opens clinics without a card and once a turn flies from a clinic for any city card', () => {
    let s = at(withHand(with0('engineer'), 0, [30, 31]), 0, 7);
    s = act(s, { type: 'clinic', actor: 0, remove: null });
    expect(s.clinics).toEqual([START_CITY, 7]);
    expect(s.hands[0]).toEqual([30, 31]);
    expect(legalActions(s, 0)).toContainEqual({ type: 'relocate', actor: 0, to: 44, card: 31 });
    s = act(s, { type: 'relocate', actor: 0, to: 44, card: 31 });
    expect(s.at[0]).toBe(44);
    expect(s.hands[0]).toEqual([30]);
    // Back at a clinic, the flight is spent for this turn.
    expect(types(at(s, 0, 7))).not.toContain('relocate');
    expect(types(at(withHand(with0('courier'), 0, [30]), 0, START_CITY))).not.toContain('relocate');
  });

  it('C29 the Warden shields its city and neighbours from cases and spillovers, not the opening infection', () => {
    // The Warden stands in 9, the spread deck's top; 10 is linked to 9 and has three cases.
    let s = at(cases(with0('courier', 'warden'), 10, 0, 3), 1, 9);
    expect(NEIGHBOURS[9]).toContain(10);
    const r = endTurn(s);
    expect(r.events.filter((e) => e.type === 'blocked').map((e) => (e as { city: number }).city)).toEqual([
      9, 10,
    ]);
    expect(r.state.spills).toBe(0);
    // The opening infection lands under the Warden's start too: Glenhallow (4) is the second city turned up.
    s = started(2, { roles: ['warden', 'courier'], spread: [0, START_CITY] });
    expect(s.cases[START_CITY]?.[0]).toBe(3);
  });

  it('C30 the Courier hands over any city card, and others may take any of its city cards', () => {
    let s = withHand(with0('courier'), 0, [20, 21, reliefCard('lull')]);
    expect(
      legalActions(s, 0)
        .filter((a) => a.type === 'give')
        .map((a) => (a as { card: number }).card),
    ).toEqual([20, 21]);
    s = act(s, { type: 'give', actor: 0, to: 1, card: 21 });
    expect(s.hands[1]).toContain(21);
    // On seat 1's turn, it may take any city card from the Courier.
    const t = edit(withHand(s, 0, [20, 33]), { turn: 1 });
    expect(pendingOf(t)).toEqual({ type: 'player', seat: 1, decision: 'act' });
    expect(
      legalActions(t, 1)
        .filter((a) => a.type === 'take')
        .map((a) => (a as { card: number }).card),
    ).toEqual([20, 33]);
  });

  it('C31 the Virologist needs four cards for a cure', () => {
    let s = withHand(with0('virologist'), 0, [12, 13, 14, 15]);
    expect(legalActions(s, 0).filter((a) => a.type === 'cure')).toEqual([
      { type: 'cure', actor: 0, cards: [12, 13, 14, 15] },
    ]);
    s = act(s, { type: 'cure', actor: 0, cards: [12, 13, 14, 15] });
    expect(s.cured).toEqual([false, true, false, false]);
    expect(types(withHand(with0('courier'), 0, [12, 13, 14, 15]))).not.toContain('cure');
  });
});
