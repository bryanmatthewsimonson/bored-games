import { describe, expect, it } from 'vitest';
import { setupGame } from '../../src/engine.ts';
import { hazard } from '../../src/module.ts';
import {
  act,
  claimAll,
  contributeAndRoll,
  fresh,
  legalActions,
  orderRoll,
  pendingOf,
  placeAll,
  refused,
} from '../helpers.ts';

describe('setup', () => {
  it('C01 seats 3 to 6 with 35, 30, 25 or 20 troops each', () => {
    for (const [seats, troops] of [
      [3, 35],
      [4, 30],
      [5, 25],
      [6, 20],
    ] as const) {
      const s = fresh(seats);
      expect(s.reserve).toEqual(Array(seats).fill(troops));
      expect(s.owner.every((o) => o === null)).toBe(true);
      expect(s.pile).toHaveLength(44);
      expect(s.stage).toBe('order');
    }
    for (const seats of [2, 7])
      expect(
        setupGame({ rules: { defense: 'choose' }, seats, mode: 'full', deckOrders: { pile: [] } }).ok,
      ).toBe(false);
    expect(hazard.seatRange(hazard.defaultRules())).toEqual({ min: 3, max: 6 });
  });

  it('C02 the highest die claims first; tied seats roll again among themselves', () => {
    const s = fresh(4);
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'roll' });
    const started = act(s, { type: 'roll', actor: 0 });
    expect(hazard.rollShape?.(started)).toEqual({ count: 4, sides: 6 });
    const tied = contributeAndRoll(started, [3, 6, 6, 2]);
    expect(tied.stage).toBe('order');
    expect(tied.tied).toEqual([1, 2]);
    expect(pendingOf(tied)).toEqual({ type: 'player', seat: 1, decision: 'roll' });
    const again = act(tied, { type: 'roll', actor: 1 });
    expect(hazard.rollShape?.(again)).toEqual({ count: 2, sides: 6 });
    const won = contributeAndRoll(again, [5, 4]);
    expect(won.stage).toBe('claim');
    expect(won.turn).toBe(1);
  });

  it('C03 claims go round from the first seat, one troop on an empty province', () => {
    const s = orderRoll(fresh(3), [2, 5, 1]);
    expect(s.turn).toBe(1);
    const a = act(s, { type: 'claim', actor: 1, province: 'e9' });
    expect(a.owner[34]).toBe(1);
    expect(a.troops[34]).toBe(1);
    expect(a.reserve).toEqual([35, 34, 35]);
    expect(a.turn).toBe(2);
    expect(legalActions(a, 2)).toHaveLength(41);
    expect(legalActions(a, 0)).toEqual([]);
  });

  it('C04 a held province cannot be claimed', () => {
    const s = orderRoll(fresh(3), [6, 1, 1]);
    const a = act(s, { type: 'claim', actor: 0, province: 'a1' });
    expect(refused(a, { type: 'claim', actor: 1, province: 'a1' })).toMatch(/claimed/);
    expect(refused(a, { type: 'claim', actor: 2, province: 'a2' })).toMatch(/turn/);
  });

  it('C05 placing starts after the last claimer, one troop on a held province, and skips empty reserves', () => {
    // Four seats: 42 claims end with seat 1 (seat 0 first), so seat 2 places first; seats 0 and 1 hold 11.
    const s = claimAll(orderRoll(fresh(4), [6, 1, 1, 1]));
    expect(s.stage).toBe('place');
    expect(s.turn).toBe(2);
    expect(s.reserve).toEqual([19, 19, 20, 20]);
    expect(refused(s, { type: 'place', actor: 2, province: 'a1' })).toMatch(/your own/);
    const placed = act(s, { type: 'place', actor: 2, province: 'a3' });
    expect(placed.troops[2]).toBe(2);
    expect(placed.turn).toBe(3);
    // Late in the placing, seats with nothing left are passed over.
    let t = placed;
    let guard = 0;
    while (t.stage === 'place' && guard++ < 200) {
      expect(t.reserve[t.turn]).toBeGreaterThan(0);
      const province = (['a1', 'a2', 'a3', 'a4'] as const)[t.turn] as 'a1';
      t = act(t, { type: 'place', actor: t.turn, province });
    }
    expect(t.reserve).toEqual([0, 0, 0, 0]);
  });

  it('C06 the first turn starts with the first claimer once every troop is placed', () => {
    const t = placeAll(claimAll(orderRoll(fresh(3), [1, 1, 6])));
    expect(t.stage).toBe('muster');
    expect(t.turn).toBe(2);
    expect(t.pool).toBe(4);
    expect(t.troops.reduce((a, b) => a + b, 0)).toBe(105);
  });
});
