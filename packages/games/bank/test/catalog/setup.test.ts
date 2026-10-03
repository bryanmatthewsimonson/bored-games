import { describe, expect, it } from 'vitest';
import { bank, DEFAULT_RULES, pendingOf, validateRules } from '../../src/index.ts';
import { act, rules, setup } from '../helpers.ts';

describe('setup and options', () => {
  it('C01 setup of three seats asks seat 1 first, with an empty pot', () => {
    const state = setup(3);
    expect(state.pot).toBe(0);
    expect(state.scores).toEqual([0, 0, 0]);
    expect(state.roller).toBe(0);
    expect(state.round).toBe(0);
    expect(pendingOf(state)).toEqual({ type: 'player', seat: 1, decision: 'bank-or-stay' });
    expect(bank.legalActions(state, 0)).toEqual([]);
    expect(bank.legalActions(state, 1)).toEqual([
      { type: 'bank', actor: 1 },
      { type: 'stay', actor: 1 },
    ]);
  });

  it('C02 the default is ten rounds at the table, for two to six seats', () => {
    expect(bank.defaultRules()).toEqual(DEFAULT_RULES);
    expect(DEFAULT_RULES.rounds).toBe(10);
    expect(DEFAULT_RULES.banking).toBe('table');
    expect(DEFAULT_RULES.maxRollsPerRound).toBe(30);
    expect(bank.seatRange(DEFAULT_RULES)).toEqual({ min: 2, max: 6 });
    expect(setup(2).seats).toBe(2);
    expect(setup(6).seats).toBe(6);
    for (const seats of [1, 7]) {
      const result = bank.setup({ rules: DEFAULT_RULES, seats, mode: 'full', deckOrders: {} });
      expect(result.ok ? null : result.error.code).toBe('seats');
    }
  });

  it('C03 rules other than the three options are rejected', () => {
    expect(validateRules(DEFAULT_RULES).ok).toBe(true);
    expect(validateRules(rules({ rounds: 5 })).ok).toBe(true);
    expect(validateRules(rules({ rounds: 20, banking: 'turn' })).ok).toBe(true);
    for (const bad of [
      null,
      [],
      { rulesVersion: 1, rounds: 10, banking: 'table' },
      { ...DEFAULT_RULES, extra: true },
      { ...DEFAULT_RULES, rounds: 15 },
      { ...DEFAULT_RULES, rounds: 1 },
      { ...DEFAULT_RULES, banking: 'shout' },
      { ...DEFAULT_RULES, maxRollsPerRound: 10 },
      { ...DEFAULT_RULES, rulesVersion: 2 },
    ]) {
      expect(validateRules(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('C28 seat 0 rolls first in round 1, after the others have been asked', () => {
    let state = setup(3);
    expect(pendingOf(state)).toMatchObject({ seat: 1 });
    state = act(state, { type: 'stay', actor: 1 }).state;
    state = act(state, { type: 'stay', actor: 2 }).state;
    expect(state.roller).toBe(0);
    expect(pendingOf(state)).toEqual({ type: 'player', seat: 0, decision: 'bank-or-roll' });
    expect(bank.legalActions(state, 0)).toEqual([
      { type: 'bank', actor: 0 },
      { type: 'roll', actor: 0, rollId: 0 },
    ]);
  });
});
