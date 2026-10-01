import { describe, expect, it } from 'vitest';
import { act, endTurn, rejects, scenario, sharesOf } from '../helpers.ts';

const board = { chains: { b1: '1A-2A', p1: '4A-5A' }, loose: '12I' };

describe('buying', () => {
  it('C42 at most 3 shares per turn, in any mix', () => {
    const s = scenario({ ...board, phase: 'buy' });
    rejects(s, endTurn(0, { buy: ['b1', 'b1', 'p1', 'p1'] }), 'buy');
    const { state } = act(s, endTurn(0, { buy: ['b1', 'b1', 'p1'] }));
    expect(sharesOf(state, 0, 'b1')).toBe(2);
    expect(sharesOf(state, 0, 'p1')).toBe(1);
    expect(state.players[0]?.cash).toBe(6000 - 200 - 200 - 400);
  });

  it('C43 purchases are limited by bank supply', () => {
    const s = scenario({ ...board, phase: 'buy', shares: { b1: [0, 24, 0] } });
    rejects(s, endTurn(0, { buy: ['b1', 'b1'] }), 'buy');
    act(s, endTurn(0, { buy: ['b1'] }));
  });

  it('C44 purchases are limited by cash at current prices', () => {
    const poor = scenario({ ...board, phase: 'buy', cash: [900] });
    act(poor, endTurn(0, { buy: ['b1', 'b1', 'p1'] }));
    rejects(poor, endTurn(0, { buy: ['p1', 'p1', 'p1'] }), 'buy');
    const exact = scenario({ ...board, phase: 'buy', cash: [1200] });
    expect(act(exact, endTurn(0, { buy: ['p1', 'p1', 'p1'] })).state.players[0]?.cash).toBe(0);
  });

  it('C45 only chains on the board can be bought', () => {
    const s = scenario({ ...board, phase: 'buy', shares: { p2: [3, 0, 0] } });
    rejects(s, endTurn(0, { buy: ['p2'] }), 'buy');
  });

  it('C46 purchases have one canonical encoding', () => {
    const s = scenario({ ...board, phase: 'buy' });
    rejects(s, endTurn(0, { buy: ['p1', 'b1'] }), 'malformed');
    act(s, endTurn(0, { buy: ['b1', 'p1'] }));
  });
});
