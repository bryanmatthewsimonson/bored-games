import { describe, expect, it } from 'vitest';
import { legalActions, pendingDecision } from '../../src/index.ts';
import {
  act,
  bankOf,
  cash,
  dispose,
  ofType,
  place,
  rejects,
  run,
  scenario,
  sharesOf,
  sizeOf,
} from '../helpers.ts';

describe('disposal', () => {
  it('C26 disposal starts with the mergemaker, in seat order, skipping non-holders', () => {
    const s = scenario({
      seats: 4,
      chains: { s1: '1A-5A', b1: '7A-9A' },
      loose: '12I',
      hands: ['', '', '6A'],
      turn: 2,
      shares: { b1: [1, 2, 0, 3], s1: [0, 0, 2, 0] },
    });
    let state = act(s, place(s, 2, '6A')).state;
    const order: number[] = [];
    while (state.phase.kind === 'merger') {
      const p = pendingDecision(state);
      if (p.type !== 'player') throw new Error('expected a player decision');
      order.push(p.seat);
      rejects(state, dispose((p.seat + 1) % 4, 'b1', 0, 0), 'actor');
      state = act(state, dispose(p.seat, 'b1', 0, 0)).state;
    }
    expect(order).toEqual([3, 0, 1]);
  });

  it('C27 sales use the pre-merger price', () => {
    const s = scenario({
      chains: { s1: '1A-5A', b1: '7A-9A' },
      hands: ['6A'],
      shares: { b1: [0, 2, 0], s1: [1] },
    });
    const merged = act(s, place(s, 0, '6A')).state;
    const { events } = act(merged, dispose(1, 'b1', 2, 0));
    expect(ofType(events, 'sharesDisposed')[0]).toMatchObject({ sell: 2, proceeds: 600 });
  });

  it('C28 trades are two-for-one and must be even', () => {
    const s = scenario({
      chains: { s1: '1A-5A', b1: '7A-9A' },
      hands: ['6A'],
      shares: { b1: [3, 0, 0], s1: [0, 1] },
    });
    const merged = act(s, place(s, 0, '6A')).state;
    rejects(merged, dispose(0, 'b1', 0, 3), 'trade');
    rejects(merged, dispose(0, 'b1', 2, 2), 'shares');
    const { state } = act(merged, dispose(0, 'b1', 1, 2));
    expect(sharesOf(state, 0, 's1')).toBe(1);
    expect(sharesOf(state, 0, 'b1')).toBe(0);
    expect(cash(state)[0]).toBe(6000 + 4500 + 300);
  });

  it('C29 trades are limited by survivor supply in the bank', () => {
    const s = scenario({
      chains: { s1: '1A-5A', b1: '7A-9A' },
      hands: ['6A'],
      shares: { b1: [4, 0, 0], s1: [0, 24, 0] },
    });
    expect(bankOf(s, 's1')).toBe(1);
    const merged = act(s, place(s, 0, '6A')).state;
    rejects(merged, dispose(0, 'b1', 0, 4), 'trade');
    expect(Math.max(...legalActions(merged, 0).map((a) => (a.type === 'dispose' ? a.trade : 0)))).toBe(2);
    const { state, events } = act(merged, dispose(0, 'b1', 0, 2));
    expect(bankOf(state, 's1')).toBe(0);
    expect(ofType(events, 'sharesDisposed')[0]).toMatchObject({ keep: 2, tradeCapped: true });
  });

  it('C30 an earlier defunct can exhaust survivor supply for a later one', () => {
    const s = scenario({
      chains: { s1: '5A-5D 6A', p1: '6E-9E', b1: '2E-4E' },
      hands: ['5E'],
      shares: { s1: [0, 0, 23], p1: [4, 0, 0], b1: [0, 4, 0] },
    });
    const merged = act(s, place(s, 0, '5E')).state;
    const afterP1 = act(merged, dispose(0, 'p1', 0, 4)).state;
    expect(bankOf(afterP1, 's1')).toBe(0);
    expect(pendingDecision(afterP1)).toEqual({ type: 'player', seat: 1, decision: 'dispose' });
    expect(legalActions(afterP1, 1).every((a) => a.type === 'dispose' && a.trade === 0)).toBe(true);
    rejects(afterP1, dispose(1, 'b1', 0, 2), 'trade');
    const { events } = act(afterP1, dispose(1, 'b1', 2, 0));
    expect(ofType(events, 'sharesDisposed')[0]?.tradeCapped).toBe(true);
  });

  it('C31 sell, trade and keep can be combined', () => {
    const s = scenario({
      chains: { s1: '1A-5A', b1: '7A-9A' },
      hands: ['6A'],
      shares: { b1: [6, 0, 0], s1: [0, 1, 0] },
    });
    const merged = act(s, place(s, 0, '6A')).state;
    const before = bankOf(merged, 'b1');
    const { state, events } = act(merged, dispose(0, 'b1', 1, 4));
    expect(sharesOf(state, 0, 's1')).toBe(2);
    expect(sharesOf(state, 0, 'b1')).toBe(1);
    expect(bankOf(state, 'b1')).toBe(before + 5);
    expect(ofType(events, 'sharesDisposed')[0]).toMatchObject({ sell: 1, trade: 4, keep: 1, proceeds: 300 });
  });

  it('C32 completion: the tile and connected loose tiles join; the defunct chain is foundable again', () => {
    const s = scenario({
      chains: { s1: '1A-5A', b1: '7A-9A' },
      loose: '6B',
      hands: ['6A'],
      shares: { b1: [1, 0, 0], s1: [0, 1, 0] },
    });
    const { state } = run(act(s, place(s, 0, '6A')).state, [dispose(0, 'b1', 1, 0)]);
    expect(sizeOf(state, 's1')).toBe(10);
    expect(sizeOf(state, 'b1')).toBe(0);
    expect(state.phase.kind).toBe('buy');
  });
});
