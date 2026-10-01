import { describe, expect, it } from 'vitest';
import { legalActions, pendingDecision } from '../../src/index.ts';
import { act, cash, dispose, ofType, place, rejects, run, scenario, sharesOf, sizeOf } from '../helpers.ts';

describe('mergers', () => {
  it('C12 two-way merger with a clear survivor', () => {
    const s = scenario({
      chains: { s1: '1A-5A', b1: '7A-9A' },
      hands: ['', '', '6A'],
      turn: 2,
      shares: { b1: [3, 2, 0], s1: [0, 0, 5] },
    });
    const placed = act(s, place(s, 2, '6A'));
    const started = ofType(placed.events, 'mergerStarted')[0];
    expect(started).toMatchObject({ chains: ['b1', 's1'], sizes: [3, 5] });
    expect(ofType(placed.events, 'survivorChosen')[0]).toMatchObject({ chain: 's1', tied: false });
    expect(ofType(placed.events, 'bonusPaid').map((e) => [e.seat, e.amount, e.role])).toEqual([
      [0, 3000, 'majority'],
      [1, 1500, 'minority'],
    ]);
    // Seat 2 (mergemaker) holds no b1, so disposal starts with seat 0.
    expect(pendingDecision(placed.state)).toEqual({ type: 'player', seat: 0, decision: 'dispose' });
    const done = run(placed.state, [dispose(0, 'b1', 3, 0), dispose(1, 'b1', 0, 2)]);
    expect(sizeOf(done.state, 's1')).toBe(9);
    expect(sizeOf(done.state, 'b1')).toBe(0);
    expect(cash(done.state)).toEqual([6000 + 3000 + 900, 6000 + 1500, 6000]);
    expect(sharesOf(done.state, 1, 's1')).toBe(1);
    expect(done.state.phase.kind).toBe('buy');
  });

  it('C13 the merging tile is not counted', () => {
    const s = scenario({ chains: { s2: '1A-10A', b2: '12A-12G' }, hands: ['11A'] });
    const { state, events } = act(s, place(s, 0, '11A'));
    expect(ofType(events, 'mergerStarted')[0]?.sizes).toEqual([7, 10]);
    expect(ofType(events, 'survivorChosen')[0]?.chain).toBe('s2');
    // b2's only holder (seat 2, added by the scenario builder) sells; then the merger completes.
    const done = act(state, dispose(2, 'b2', 1, 0)).state;
    expect(sizeOf(done, 's2')).toBe(18);
  });

  it('C14 tie for survivor: the mergemaker chooses', () => {
    const s = scenario({
      chains: { s1: '1A-4A', p1: '6A-9A' },
      hands: ['5A'],
      shares: { s1: [0, 4, 1], p1: [2, 0, 0] },
    });
    const placed = act(s, place(s, 0, '5A')).state;
    expect(pendingDecision(placed)).toEqual({ type: 'player', seat: 0, decision: 'chooseSurvivor' });
    expect(legalActions(placed, 0).map((a) => (a.type === 'chooseSurvivor' ? a.chain : ''))).toEqual([
      's1',
      'p1',
    ]);
    rejects(placed, { type: 'chooseSurvivor', actor: 1, chain: 'p1' }, 'actor');
    const chosen = act(placed, { type: 'chooseSurvivor', actor: 0, chain: 'p1' });
    expect(ofType(chosen.events, 'bonusPaid').map((e) => [e.seat, e.amount])).toEqual([
      [1, 5000],
      [2, 2500],
    ]);
    const done = run(chosen.state, [dispose(1, 's1', 4, 0), dispose(2, 's1', 1, 0)]);
    expect(sizeOf(done.state, 'p1')).toBe(9);
  });

  it('C15 three-way merger: defuncts resolve largest first', () => {
    const s = scenario({
      chains: { s1: '5A-5D 6A', p1: '6E-9E', b1: '2E-4E' },
      hands: ['5E'],
      shares: { s1: [3, 0, 0], p1: [0, 2, 0], b1: [0, 0, 2] },
    });
    const placed = act(s, place(s, 0, '5E'));
    expect(ofType(placed.events, 'defunctOrder')[0]).toMatchObject({ order: ['p1', 'b1'], tied: false });
    // p1 resolves first at $600 (premium, size 4): seat 1 is sole holder.
    expect(ofType(placed.events, 'bonusPaid')).toEqual([
      { type: 'bonusPaid', chain: 'p1', seat: 1, amount: 9000, role: 'sole', final: false },
    ]);
    const afterP1 = act(placed.state, dispose(1, 'p1', 2, 0));
    expect(ofType(afterP1.events, 'bonusPaid')).toEqual([
      { type: 'bonusPaid', chain: 'b1', seat: 2, amount: 4500, role: 'sole', final: false },
    ]);
    const done = act(afterP1.state, dispose(2, 'b1', 2, 0));
    expect(sizeOf(done.state, 's1')).toBe(13);
    expect(ofType(done.events, 'mergerCompleted')[0]).toMatchObject({ survivor: 's1', size: 13 });
  });

  it('C16 four-way merger with all chains tied', () => {
    const s = scenario({
      chains: { b1: '5B-5D', b2: '2E-4E', s1: '6E-8E', s2: '5F-5H' },
      hands: ['5E'],
      shares: { b1: [1, 0, 0], b2: [0, 1, 0], s1: [0, 0, 1], s2: [1, 0, 0] },
    });
    const placed = act(s, place(s, 0, '5E'));
    expect(ofType(placed.events, 'mergerStarted')[0]?.chains).toEqual(['b1', 'b2', 's1', 's2']);
    expect(legalActions(placed.state, 0)).toHaveLength(4);
    const chosen = act(placed.state, { type: 'chooseSurvivor', actor: 0, chain: 's2' }).state;
    expect(pendingDecision(chosen)).toEqual({ type: 'player', seat: 0, decision: 'orderDefunct' });
    expect(legalActions(chosen, 0)).toHaveLength(6);
    const ordered = act(chosen, { type: 'orderDefunct', actor: 0, order: ['s1', 'b1', 'b2'] });
    expect(ofType(ordered.events, 'bonusPaid')[0]?.chain).toBe('s1');
    const done = run(ordered.state, [dispose(2, 's1', 1, 0), dispose(0, 'b1', 1, 0), dispose(1, 'b2', 1, 0)]);
    expect(sizeOf(done.state, 's2')).toBe(13);
    for (const id of ['b1', 'b2', 's1']) expect(sizeOf(done.state, id)).toBe(0);
  });

  it('C17 three-way merger 5/5/5', () => {
    const s = scenario({
      chains: { b1: '5A-5D 4A', b2: '1E-4E 1F', s1: '6E-9E 9F' },
      hands: ['5E'],
      shares: { b1: [1, 0, 0], b2: [0, 1, 0], s1: [0, 0, 1] },
    });
    const placed = act(s, place(s, 0, '5E')).state;
    expect(legalActions(placed, 0)).toHaveLength(3);
    const chosen = act(placed, { type: 'chooseSurvivor', actor: 0, chain: 'b1' }).state;
    expect(legalActions(chosen, 0).map((a) => (a.type === 'orderDefunct' ? a.order : []))).toEqual([
      ['b2', 's1'],
      ['s1', 'b2'],
    ]);
    const ordered = act(chosen, { type: 'orderDefunct', actor: 0, order: ['s1', 'b2'] });
    expect(ofType(ordered.events, 'defunctOrder')[0]).toMatchObject({ order: ['s1', 'b2'], tied: true });
    expect(pendingDecision(ordered.state)).toEqual({ type: 'player', seat: 2, decision: 'dispose' });
  });

  it('C18 three-way merger 5/3/3', () => {
    const s = scenario({
      chains: { b1: '5A-5D 4A', b2: '2E-4E', s1: '6E-8E' },
      hands: ['5E'],
      shares: { b1: [1, 0, 0], b2: [0, 1, 0], s1: [0, 0, 1] },
    });
    const placed = act(s, place(s, 0, '5E'));
    expect(ofType(placed.events, 'survivorChosen')[0]).toMatchObject({ chain: 'b1', tied: false });
    expect(pendingDecision(placed.state)).toEqual({ type: 'player', seat: 0, decision: 'orderDefunct' });
    rejects(placed.state, { type: 'orderDefunct', actor: 0, order: ['b2'] }, 'order');
    rejects(placed.state, { type: 'orderDefunct', actor: 0, order: ['b1', 's1'] }, 'order');
    act(placed.state, { type: 'orderDefunct', actor: 0, order: ['b2', 's1'] });
  });
});
