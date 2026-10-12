import { deepFreeze } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { reinforcements, startTurn } from '../../src/engine.ts';
import { PROVINCES } from '../../src/map.ts';
import type { HazardState } from '../../src/types.ts';
import { act, legalActions, opened, refused } from '../helpers.ts';

/** `s` with seat 0 holding the first `n` provinces of `order` and seat 1 every other province. */
function holding(s: HazardState, provinces: readonly string[]): HazardState {
  return deepFreeze({
    ...s,
    owner: PROVINCES.map((p) => (provinces.includes(p) ? 0 : 1)),
    troops: PROVINCES.map(() => 1),
  });
}

/** n provinces scattered so that no realm is whole: never a whole realm before 42. */
const SCATTERED = [
  'a1',
  'b1',
  'c1',
  'd1',
  'e1',
  'f1',
  'a2',
  'b2',
  'c2',
  'd2',
  'e2',
  'f2',
  'a3',
  'b3',
  'c3',
  'd3',
  'e3',
];

describe('the muster', () => {
  it('C07 a third of your provinces, rounded down, and never fewer than 3', () => {
    const s = opened(3);
    for (const [n, troops] of [
      [11, 3],
      [14, 4],
      [17, 5],
      [5, 3],
      [1, 3],
    ] as const)
      expect(reinforcements(holding(s, SCATTERED.slice(0, n)), 0), `${n}`).toBe(troops);
  });

  it('C08 a whole realm adds its bonus: 5, 2, 5, 3, 7 and 2', () => {
    const s = opened(3);
    const realm = (r: string) => PROVINCES.filter((p) => p.startsWith(r));
    expect(reinforcements(holding(s, realm('b')), 0)).toBe(3 + 2);
    expect(reinforcements(holding(s, realm('f')), 0)).toBe(3 + 2);
    expect(reinforcements(holding(s, realm('d')), 0)).toBe(3 + 3);
    expect(reinforcements(holding(s, realm('c')), 0)).toBe(3 + 5);
    expect(reinforcements(holding(s, realm('a')), 0)).toBe(3 + 5);
    expect(reinforcements(holding(s, realm('e')), 0)).toBe(4 + 7);
    expect(reinforcements(holding(s, [...realm('b'), ...realm('f')]), 0)).toBe(3 + 2 + 2);
    // Eleven of the Vast's twelve: no bonus.
    expect(reinforcements(holding(s, realm('e').slice(1)), 0)).toBe(3);
    // Counted when the turn starts.
    const turn = startTurn(holding(s, realm('b')), 0);
    expect(turn.state.pool).toBe(5);
    expect(turn.state.stage).toBe('muster');
  });

  it('C09 the pool is placed in any split, and the attack waits until it is all placed', () => {
    const s = opened(3);
    expect(s.turn).toBe(0);
    expect(s.pool).toBe(4);
    const offered = legalActions(s, 0);
    expect(offered).toContainEqual({ type: 'muster', actor: 0, province: 'a1', count: 1 });
    expect(offered).toContainEqual({ type: 'muster', actor: 0, province: 'a1', count: 4 });
    expect(offered.some((a) => a.type === 'attack' || a.type === 'endAttack')).toBe(false);
    expect(refused(s, { type: 'muster', actor: 0, province: 'a1', count: 0 })).toMatch(/1 to 4/);
    expect(refused(s, { type: 'muster', actor: 0, province: 'a1', count: 5 })).toMatch(/1 to 4/);
    expect(refused(s, { type: 'muster', actor: 0, province: 'a2', count: 1 })).toMatch(/your own/);
    expect(refused(s, { type: 'muster', actor: 1, province: 'a2', count: 1 })).toMatch(/turn/);
    const two = act(s, { type: 'muster', actor: 0, province: 'a1', count: 2 });
    expect(two.pool).toBe(2);
    expect(two.stage).toBe('muster');
    expect(two.troops[0]).toBe((s.troops[0] ?? 0) + 2);
    const done = act(two, { type: 'muster', actor: 0, province: 'a4', count: 2 });
    expect(done.pool).toBe(0);
    expect(done.stage).toBe('attack');
  });

  it('placed one troop at a time, the pool stays exact and the attack opens on the last one only', () => {
    let t = opened(3);
    const before = t.troops.reduce((a, b) => a + b, 0);
    for (let n = 4; n > 0; n--) {
      expect(t.stage).toBe('muster');
      expect(t.pool).toBe(n);
      t = act(t, { type: 'muster', actor: 0, province: 'a1', count: 1 });
    }
    expect(t.stage).toBe('attack');
    expect(t.troops.reduce((a, b) => a + b, 0)).toBe(before + 4);
  });
});
