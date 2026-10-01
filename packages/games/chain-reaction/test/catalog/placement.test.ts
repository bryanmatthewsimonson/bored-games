import { describe, expect, it } from 'vitest';
import { LOOSE, legalActions, pendingDecision, tileIndex } from '../../src/index.ts';
import { act, bankOf, cellOf, endTurn, ofType, place, scenario, sharesOf, sizeOf } from '../helpers.ts';

describe('placement', () => {
  it('C04 a lone tile stays unincorporated', () => {
    const s = scenario({ loose: '1A 12A 1I', hands: ['6F'] });
    const { state, events } = act(s, place(s, 0, '6F'));
    expect(cellOf(state, '6F')).toBe(LOOSE);
    expect(ofType(events, 'tilePlaced')[0]?.kind).toBe('lone');
    expect(state.phase.kind).toBe('buy');
  });

  it('C05 founding next to one loose tile', () => {
    const s = scenario({ loose: '1A 12A 1I', hands: ['2A'] });
    const placed = act(s, place(s, 0, '2A')).state;
    expect(pendingDecision(placed)).toEqual({ type: 'player', seat: 0, decision: 'foundChain' });
    expect(legalActions(placed, 0)).toHaveLength(7);
    const { state, events } = act(placed, { type: 'foundChain', actor: 0, chain: 'p1' });
    expect(sizeOf(state, 'p1')).toBe(2);
    expect(sharesOf(state, 0, 'p1')).toBe(1);
    expect(bankOf(state, 'p1')).toBe(24);
    expect(ofType(events, 'founderShare')[0]?.granted).toBe(true);
  });

  it('C06 founding by joining a multi-tile loose group', () => {
    const s = scenario({ loose: '1A 2A 4A 3C', hands: ['3A'] });
    const placed = act(s, place(s, 0, '3A')).state;
    const { state } = act(placed, { type: 'foundChain', actor: 0, chain: 's1' });
    expect(sizeOf(state, 's1')).toBe(4);
    expect(cellOf(state, '3C')).toBe(LOOSE);
  });

  it('C07 founder share when the bank has none', () => {
    const s = scenario({ loose: '1A 12A 1I', hands: ['', '', '2A'], turn: 2, shares: { s1: [15, 10, 0] } });
    expect(bankOf(s, 's1')).toBe(0);
    const placed = act(s, place(s, 2, '2A')).state;
    const { state, events } = act(placed, { type: 'foundChain', actor: 2, chain: 's1' });
    expect(sizeOf(state, 's1')).toBe(2);
    expect(sharesOf(state, 2, 's1')).toBe(0);
    expect(bankOf(state, 's1')).toBe(0);
    expect(ofType(events, 'founderShare')[0]?.granted).toBe(false);
  });

  it('C08 a chain founded this turn can be bought this turn', () => {
    const s = scenario({ loose: '1A 12A 1I', hands: ['2A'] });
    let state = act(s, place(s, 0, '2A')).state;
    state = act(state, { type: 'foundChain', actor: 0, chain: 'p1' }).state;
    state = act(state, endTurn(0, { buy: ['p1', 'p1', 'p1'] })).state;
    expect(sharesOf(state, 0, 'p1')).toBe(4);
    expect(state.players[0]?.cash).toBe(4800);
  });

  it('C09 growth absorbs loose groups on several sides', () => {
    const s = scenario({ chains: { b1: '1A-2A' }, loose: '4A 3B 3C', hands: ['3A'] });
    const { state, events } = act(s, place(s, 0, '3A'));
    expect(sizeOf(state, 'b1')).toBe(6);
    expect(ofType(events, 'chainGrew')[0]).toMatchObject({ chain: 'b1', size: 6, safe: false });
  });

  it('C10 a tile touching one chain on two sides grows it once', () => {
    const s = scenario({ chains: { b1: '1A 2A 2B' }, loose: '12I', hands: ['1B'] });
    const { state, events } = act(s, place(s, 0, '1B'));
    expect(sizeOf(state, 'b1')).toBe(4);
    expect(ofType(events, 'mergerStarted')).toEqual([]);
  });

  it('C11 a safe chain still grows', () => {
    const s = scenario({ chains: { s1: '1A-11A' }, loose: '12B', hands: ['12A'] });
    const { state, events } = act(s, place(s, 0, '12A'));
    expect(sizeOf(state, 's1')).toBe(13);
    expect(ofType(events, 'chainGrew')[0]?.safe).toBe(true);
    expect(state.board[tileIndex('12B') as number]).toBe(2);
  });
});
