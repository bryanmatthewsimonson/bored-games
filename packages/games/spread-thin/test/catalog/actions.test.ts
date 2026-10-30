import { describe, expect, it } from 'vitest';
import { CLINIC_LIMIT, reliefCard } from '../../src/data.ts';
import { legalActions, pendingOf } from '../../src/engine.ts';
import { NEIGHBOURS, START_CITY } from '../../src/map.ts';
import type { SpreadAction } from '../../src/types.ts';
import { act, at, cases, clean, edit, refused, run, started, withHand } from '../helpers.ts';

/** Two seats, seat 0 to act, a clean board, roles that change none of these actions. */
const base = () => clean(started(2, { roles: ['archivist', 'warden'] }));
const types = (s: ReturnType<typeof base>, seat = 0) => new Set(legalActions(s, seat).map((a) => a.type));

describe('actions', () => {
  it('C06 four actions, then the draw; ending early is allowed; a relief costs no action', () => {
    let s = base();
    expect(s.actions).toBe(4);
    s = act(s, { type: 'travel', actor: 0, pawn: 0, to: 5 });
    expect(s.actions).toBe(3);
    s = withHand(s, 0, [reliefCard('lull')]);
    s = act(s, { type: 'lull', actor: 0 });
    expect(s.actions).toBe(3);
    expect(s.quiet).toBe(true);
    s = act(s, { type: 'end', actor: 0 });
    expect(s.turn).toBe(1);
    expect(s.actions).toBe(4);
    expect(refused(s, { type: 'end', actor: 0 })).toBe('It is not your decision.');
  });

  it('C07 travel goes to linked cities only, across the world edge too', () => {
    const s = base();
    const travel = legalActions(s, 0).filter((a) => a.type === 'travel');
    expect(travel.map((a) => (a as { to: number }).to)).toEqual([...(NEIGHBOURS[START_CITY] ?? [])]);
    // City 0 links across the edge to 38 and 45.
    const edge = at(base(), 0, 0);
    expect(
      legalActions(edge, 0)
        .filter((a) => a.type === 'travel')
        .map((a) => (a as { to: number }).to),
    ).toEqual([1, 12, 38, 45]);
    refused(s, { type: 'travel', actor: 0, pawn: 0, to: 20 });
  });

  it('C08 fly: discard a city card to move there', () => {
    let s = withHand(base(), 0, [20, 30]);
    s = act(s, { type: 'fly', actor: 0, pawn: 0, to: 20 });
    expect(s.at[0]).toBe(20);
    expect(s.hands[0]).toEqual([30]);
    expect(s.discard).toContain(20);
  });

  it('C09 charter: discard the card of your own city to go anywhere', () => {
    let s = withHand(base(), 0, [START_CITY]);
    expect(legalActions(s, 0).filter((a) => a.type === 'charter')).toHaveLength(47);
    s = act(s, { type: 'charter', actor: 0, pawn: 0, to: 40 });
    expect(s.at[0]).toBe(40);
    expect(s.hands[0]).toEqual([]);
    expect(types(withHand(base(), 0, [7]))).not.toContain('charter');
  });

  it('C10 a clinic takes the card of its city; one per city; the seventh moves one', () => {
    let s = at(withHand(base(), 0, [7, 8]), 0, 7);
    expect(legalActions(s, 0)).toContainEqual({ type: 'clinic', actor: 0, remove: null });
    s = act(s, { type: 'clinic', actor: 0, remove: null });
    expect(s.clinics).toEqual([START_CITY, 7]);
    expect(s.hands[0]).toEqual([8]);
    expect(types(s)).not.toContain('clinic');
    // Six out: the next one must move one of them.
    let full = at(edit(base(), { clinics: [0, 1, 2, 3, 4, 5] }), 0, 9);
    full = withHand(full, 0, [9]);
    const opts = legalActions(full, 0).filter((a) => a.type === 'clinic');
    expect(opts).toHaveLength(CLINIC_LIMIT);
    full = act(full, { type: 'clinic', actor: 0, remove: 2 });
    expect(full.clinics).toEqual([0, 1, 3, 4, 5, 9]);
  });

  it('C11 shuttle runs between clinics', () => {
    let s = edit(base(), { clinics: [START_CITY, 33] });
    expect(legalActions(s, 0)).toContainEqual({ type: 'shuttle', actor: 0, pawn: 0, to: 33 });
    s = act(s, { type: 'shuttle', actor: 0, pawn: 0, to: 33 });
    expect(s.at[0]).toBe(33);
    expect(types(at(edit(base(), { clinics: [START_CITY, 33] }), 0, 5))).not.toContain('shuttle');
  });

  it('C12 treat removes one case; all of them once the strain is cured', () => {
    let s = cases(cases(base(), START_CITY, 0, 3), START_CITY, 2, 2);
    s = act(s, { type: 'treat', actor: 0, strain: 0 });
    expect(s.cases[START_CITY]).toEqual([2, 0, 2, 0]);
    s = edit(s, { cured: [false, false, true, false] });
    s = act(s, { type: 'treat', actor: 0, strain: 2 });
    expect(s.cases[START_CITY]).toEqual([2, 0, 0, 0]);
  });

  it('C13 a cure takes five cards of one strain at a clinic, once per strain', () => {
    let s = withHand(base(), 0, [0, 1, 2, 3, 6, 13]);
    const cures = legalActions(s, 0).filter((a) => a.type === 'cure');
    expect(cures).toHaveLength(1);
    expect(cures[0]).toEqual({ type: 'cure', actor: 0, cards: [0, 1, 2, 3, 6] });
    expect(types(at(s, 0, 5))).not.toContain('cure');
    s = act(s, { type: 'cure', actor: 0, cards: [0, 1, 2, 3, 6] });
    expect(s.cured).toEqual([true, false, false, false]);
    expect(s.hands[0]).toEqual([13]);
    const again = withHand(s, 0, [7, 8, 9, 10, 11]);
    expect(types(again)).not.toContain('cure');
    refused(withHand(base(), 0, [0, 1, 2, 3, 13]), { type: 'cure', actor: 0, cards: [0, 1, 2, 3, 13] });
  });

  it('C24 hand over: the city card between two players in that city; the receiver over the limit discards', () => {
    let s = withHand(withHand(base(), 0, [START_CITY, 9]), 1, [1, 2, 3, 5, 6, 7, 8]);
    const gives = legalActions(s, 0).filter((a) => a.type === 'give');
    expect(gives).toEqual([{ type: 'give', actor: 0, to: 1, card: START_CITY }]);
    s = act(s, { type: 'give', actor: 0, to: 1, card: START_CITY });
    expect(s.hands[1]).toHaveLength(8);
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 1, decision: 'discard' });
    s = act(s, { type: 'discard', actor: 1, card: 2 });
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'act' });
    // Taking: the other player holds this city's card.
    const t = withHand(withHand(base(), 0, []), 1, [START_CITY]);
    expect(legalActions(t, 0).filter((a) => a.type === 'take')).toEqual([
      { type: 'take', actor: 0, from: 1, card: START_CITY },
    ]);
    // Not in the same city: nothing to hand over.
    expect(types(at(s, 1, 5))).not.toContain('give');
    const r = run(t, { type: 'take', actor: 0, from: 1, card: START_CITY } as SpreadAction);
    expect(r.events.map((e) => e.type)).toEqual(['handed']);
  });
});
