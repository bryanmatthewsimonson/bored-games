import { describe, expect, it } from 'vitest';
import { FIELD_BASE, pilesOf, SURGE_BASE } from '../../src/data.ts';
import { DEFAULT_RULES, legalActions, onBoard, pendingOf, spreadRate } from '../../src/engine.ts';
import { NEIGHBOURS, START_CITY } from '../../src/map.ts';
import { feverPitch } from '../../src/module.ts';
import type { FeverState } from '../../src/types.ts';
import { act, at, cases, clean, edit, endTurn, run, started, withHand } from '../helpers.ts';

/** Two seats, a clean board, roles that shield nothing: Archivist and Courier. */
const quiet = (plan = {}) => clean(started(2, { roles: ['archivist', 'courier'], ...plan }));
const total = (s: FeverState): number => [0, 1, 2, 3].reduce((n, k) => n + onBoard(s, k), 0);

describe('the draw, the spread and the surges', () => {
  it('C14 a cured strain with no case on the board is stamped out, and its spread cards place nothing', () => {
    let s = withHand(quiet(), 0, [0, 1, 2, 3, 5]);
    s = act(s, { type: 'cure', actor: 0, cards: [0, 1, 2, 3, 5] });
    expect(s.stamped).toEqual([true, false, false, false]);
    // The pile's top cards are cities 9 and 10 (Tide): nothing is placed.
    const r = endTurn(s);
    expect(r.events.filter((e) => e.type === 'infect').map((e) => (e as { placed: number }).placed)).toEqual([
      0, 0,
    ]);
    expect(total(r.state)).toBe(0);
    // Treating the last case of a cured strain stamps it out too.
    let t = cases(edit(quiet(), { cured: [false, true, false, false] }), START_CITY, 1, 1);
    t = act(t, { type: 'treat', actor: 0, strain: 1 });
    expect(t.stamped).toEqual([false, true, false, false]);
  });

  it('C15 two field cards after the actions; fewer than two left loses', () => {
    const s = quiet();
    const r = endTurn(s);
    expect(r.state.hands[0]).toHaveLength(6);
    expect(r.events.find((e) => e.type === 'drew')).toMatchObject({ seat: 0, surges: 0 });
    const last = edit(s, { field: s.field.slice(0, 1) });
    const l = run(last, { type: 'end', actor: 0 });
    expect(l.state.phase).toBe('over');
    expect(l.state.result?.reason).toBe('deck');
  });

  it('C16 the spread turns up the rate in cards, one case each, and spends them', () => {
    const s = quiet();
    expect(spreadRate(s)).toBe(2);
    const r = endTurn(s);
    expect(r.events.filter((e) => e.type === 'infect').map((e) => (e as { city: number }).city)).toEqual([
      9, 10,
    ]);
    expect(r.state.cases[9]?.[0]).toBe(1);
    expect(r.state.cases[10]?.[0]).toBe(1);
    expect(r.state.spent.map((x) => x.city).slice(-2)).toEqual([9, 10]);
    expect(r.state.pile[0]?.pos).toBe(11);
  });

  it('C17 a surge rises, strikes the bottom card with three, restacks the spent pile; two resolve in turn', () => {
    const s = quiet({ surgeAt: [0] });
    const r = endTurn(s);
    const kinds = r.events.map((e) => e.type);
    expect(kinds.slice(0, 5)).toEqual(['drew', 'rise', 'strike', 'restack', 'infect']);
    expect(r.state.rate).toBe(1);
    expect(r.state.cases[47]?.[3]).toBe(3);
    // The ten spent cards (the opening nine and 47) went back on top, as epoch 1; the spread drew two of them.
    expect(r.state.epoch).toBe(1);
    expect(r.state.pile).toHaveLength(46);
    expect(r.state.hands[0]).toHaveLength(5);
    // A strike on a city with cases tops it up to three and spills over.
    const topped = endTurn(cases(quiet({ surgeAt: [0] }), 47, 3, 1));
    expect(topped.events.find((e) => e.type === 'strike')).toMatchObject({ city: 47, placed: 2 });
    expect(topped.events.filter((e) => e.type === 'spillover')).toHaveLength(1);
    // Two surges in one draw: both resolve, one after the other.
    const two = quiet({ surgeAt: [0, 0] });
    const piles = pilesOf(DEFAULT_RULES, 2);
    const field = [
      piles[0]?.[0],
      piles[1]?.[0],
      ...two.field.filter((p) => p !== piles[0]?.[0] && p !== piles[1]?.[0]),
    ];
    const d = endTurn(edit(two, { field: field as number[] }));
    expect(d.events.filter((e) => e.type === 'rise')).toHaveLength(2);
    expect(d.events.filter((e) => e.type === 'restack')).toHaveLength(2);
    expect(d.state.epoch).toBe(2);
    expect(d.state.rate).toBe(2);
    expect(two.plain?.[String(piles[1]?.[0])]).toBe(SURGE_BASE + 1);
  });

  it('C18 the rate runs 2, 2, 2, 3, 3, 4, 4 and stops at the end', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((rate) => spreadRate(edit(quiet(), { rate })))).toEqual([
      2, 2, 2, 3, 3, 4, 4,
    ]);
    const r = endTurn(edit(quiet({ surgeAt: [0] }), { rate: 6 }));
    expect(r.state.rate).toBe(6);
    expect(r.events.filter((e) => e.type === 'infect')).toHaveLength(4);
  });

  it('C19 over seven cards: discard at once; after a draw, once its surges are resolved', () => {
    let s = withHand(quiet({ surgeAt: [1] }), 0, [10, 11, 12, 13, 14, 15, 16]);
    s = act(s, { type: 'end', actor: 0 });
    // The draw held a surge: it resolved before the discard was asked.
    expect(s.history.some((h) => h.kind === 'restack')).toBe(true);
    expect(s.hands[0]).toHaveLength(8);
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'discard' });
    expect(legalActions(s, 0).filter((a) => a.type === 'discard')).toHaveLength(8);
    s = act(s, { type: 'discard', actor: 0, card: 10 });
    expect(s.hands[0]).toHaveLength(7);
    expect(s.turn).toBe(1);
  });

  it('C20 a fourth case spills over to every neighbour; chains follow; no city spills twice in a chain', () => {
    // City 9 tops the pile; 9 and its neighbour 10 hold three Tide cases.
    const s = cases(cases(quiet(), 9, 0, 3), 10, 0, 3);
    expect(NEIGHBOURS[9]).toEqual([6, 8, 10, 11]);
    expect(NEIGHBOURS[10]).toEqual([8, 9, 26]);
    const r = endTurn(s);
    const spills = r.events.filter((e) => e.type === 'spillover').map((e) => (e as { city: number }).city);
    // Card 9: 9 spills, 10 is pushed over and spills, and 9 is not spilled again in that chain. Card 10 starts a new
    // chain: 10 spills, pushing 9 over (it may spill again now), and 8, full by then, follows.
    expect(spills).toEqual([9, 10, 10, 9, 8]);
    expect(r.state.spills).toBe(5);
    expect(r.state.cases[26]?.[0]).toBe(2);
  });

  it('C21 the eighth spillover, or a strain out of tokens, loses at once', () => {
    const s = edit(cases(quiet(), 9, 0, 3), { spills: 7 });
    const r = endTurn(s);
    expect(r.state.phase).toBe('over');
    expect(r.state.result?.reason).toBe('spillovers');
    expect(r.state.spills).toBe(8);
    // 24 Tide cases on the board: the spread of city 9 needs one more.
    let full = quiet();
    for (const c of [0, 1, 2, 3, 5, 6, 7, 8]) full = cases(full, c, 0, 3);
    expect(onBoard(full, 0)).toBe(24);
    const out = endTurn(full);
    expect(out.state.result?.reason).toBe('cases');
    expect(feverPitch.outcome(out.state)?.places).toEqual([1, 1]);
  });

  it('C32 the fourth cure wins at once, whatever is on the board', () => {
    let s = withHand(edit(quiet(), { cured: [false, true, true, true] }), 0, [0, 1, 2, 3, 5]);
    s = cases(s, 30, 2, 3);
    s = at(s, 1, 30);
    const r = run(s, { type: 'cure', actor: 0, cards: [0, 1, 2, 3, 5] });
    expect(r.state.phase).toBe('over');
    expect(r.state.result).toEqual({ places: [1, 1], scores: [4, 4], reason: 'cured' });
    expect(r.events.map((e) => e.type)).toContain('won');
    expect(pendingOf(r.state)).toEqual({ type: 'over' });
    expect(FIELD_BASE).toBe(48);
  });
});
