import { describe, expect, it } from 'vitest';
import { legalActions, outcomeOf, pendingDecision } from '../../src/index.ts';
import { act, cash, endTurn, ofType, place, rejects, run, scenario, sharesOf } from '../helpers.ts';

describe('end of game', () => {
  it('C47 a chain of 41+ tiles enables the declaration; final liquidation', () => {
    const s = scenario({
      chains: { s1: '1A-12A 1B-12B 1C-12C 1D-5D', b1: '1F-2F' },
      phase: 'buy',
      cash: [1000, 1000, 1000],
      shares: { s1: [10, 5, 0], b1: [0, 2, 1], p2: [0, 0, 3] },
    });
    expect(s.turn?.endCondition).toBe('endSize');
    const { state, events } = act(s, endTurn(0, { declareEnd: true }));
    expect(ofType(events, 'endDeclared')[0]).toMatchObject({ seat: 0, condition: 'endSize' });
    expect(cash(state)).toEqual([23000, 14400, 2200]);
    expect(outcomeOf(state)).toEqual({ places: [1, 2, 3], scores: [23000, 14400, 2200], reason: 'declared' });
    expect(sharesOf(state, 2, 'p2')).toBe(3);
    expect(sharesOf(state, 0, 's1')).toBe(0);
    expect(pendingDecision(state)).toEqual({ type: 'over' });
    rejects(state, endTurn(1), 'over');
  });

  it('C48 all active chains safe enables the declaration; an empty board does not', () => {
    const safe = scenario({ chains: { s1: '1A-11A', p1: '1C-11C' }, phase: 'buy' });
    expect(safe.turn?.endCondition).toBe('allSafe');
    expect(legalActions(safe, 0).some((a) => a.type === 'endTurn' && a.declareEnd)).toBe(true);
    const empty = scenario({ loose: '1A 3A 5A', phase: 'buy' });
    expect(empty.turn?.endCondition).toBeNull();
    rejects(empty, endTurn(0, { declareEnd: true }), 'declare');
  });

  it('C49 declaring is optional', () => {
    const s = scenario({ chains: { s1: '1A-11A', p1: '1C-11C' }, phase: 'buy' });
    const { state } = act(s, endTurn(0));
    expect(state.phase.kind).toBe('place');
    expect(state.turn?.seat).toBe(1);
  });

  it('C50 a condition seen at the start of the turn stays declarable', () => {
    const s = scenario({ chains: { s1: '1A-11A', p1: '1C-11C' }, loose: '1E', hands: ['2E'] });
    expect(s.turn?.endCondition).toBe('allSafe');
    const { state, events } = run(s, [
      place(s, 0, '2E'),
      { type: 'foundChain', actor: 0, chain: 'b1' },
      endTurn(0, { buy: ['b1'], declareEnd: true }),
    ]);
    expect(ofType(events, 'sharesBought')[0]?.shares).toEqual(['b1']);
    expect(ofType(events, 'bonusPaid').filter((e) => e.chain === 'b1')).toEqual([
      { type: 'bonusPaid', chain: 'b1', seat: 0, amount: 3000, role: 'sole', final: true },
    ]);
    expect(state.result?.reason).toBe('declared');
  });

  it('C51 tied final cash shares the place', () => {
    const s = scenario({
      chains: { s1: '1A-11A' },
      loose: '1I',
      phase: 'buy',
      cash: [1000, 1000, 500],
      shares: { s1: [2, 2, 0] },
    });
    const { state } = act(s, endTurn(0, { declareEnd: true }));
    expect(outcomeOf(state)?.places).toEqual([1, 1, 3]);
  });

  it('C52 the game ends only by declaration', () => {
    const s = scenario({ chains: { s1: '1A-11A' }, loose: '1E 6E', emptyBag: true });
    expect(s.turn?.endCondition).toBe('allSafe');
    const skip = (seat: number) => [{ type: 'skipPlace', actor: seat }, endTurn(seat)];
    const continued = run(s, [...skip(0), ...skip(1), ...skip(2)]).state;
    expect(continued.result).toBeNull();
    expect(pendingDecision(continued)).toEqual({ type: 'player', seat: 0, decision: 'place' });
    const { state, events } = run(continued, [
      { type: 'skipPlace', actor: 0 },
      endTurn(0, { declareEnd: true }),
    ]);
    expect(ofType(events, 'gameEnded')[0]?.reason).toBe('declared');
    expect(state.result?.reason).toBe('declared');
  });

  it('C53 the bag can empty partway through a refill', () => {
    const s = scenario({ loose: '1A 6E 12I', hands: ['3C 5G 9G 11G 3I'], bag: '1H', emptyBag: true });
    const { state, events } = run(s, [place(s, 0, '3C'), endTurn(0)]);
    expect(ofType(events, 'tilesDealt')[0]?.positions).toHaveLength(1);
    expect(state.players[0]?.hand).toHaveLength(5);
    expect(state.deck.next).toBe(108);
  });
});
