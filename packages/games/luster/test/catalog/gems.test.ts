// biome-ignore-all lint/style/noNonNullAssertion: constructed test fixtures use known seats and positions.
import { canonicalJson } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, LEGACY_RULES } from '../../src/engine.ts';
import { luster } from '../../src/module.ts';
import type { LusterAction, LusterState } from '../../src/types.ts';
import { ANY, ready, step } from '../helpers.ts';

type Take = Extract<LusterAction, { type: 'take' }>;
/** The numbers of different colors among the single-gem takes on offer, ascending and unique. */
const singleTakeSizes = (s: LusterState): number[] =>
  [
    ...new Set(
      (luster.legalActions(s, s.turn) as LusterAction[])
        .filter((a): a is Take => a.type === 'take' && a.tokens.every((n) => n <= 1))
        .map((a) => a.tokens.reduce((x, y) => x + y, 0)),
    ),
  ].sort();
const withSupply = (s: LusterState, supply: number[]): LusterState => ({ ...s, supply });

describe('Luster gem rule option', () => {
  it('C11 new tables take three colors (fewer only when fewer are left); tables without the option keep any number', () => {
    // New tables default to the published rule; a rules object without `gems` (every table made before the
    // option) stays exactly as it was, so its canonical JSON (and rules hash) is unchanged.
    expect(luster.defaultRules()).toEqual({ target: 15, gems: 'published' });
    expect(luster.validateRules({ target: 15 })).toEqual({ ok: true, value: { target: 15 } });
    expect(canonicalJson(LEGACY_RULES)).toBe('{"target":15}');
    expect(luster.validateRules({ target: 15, gems: 'any' })).toEqual({ ok: true, value: ANY });
    expect(luster.validateRules(DEFAULT_RULES)).toEqual({ ok: true, value: DEFAULT_RULES });

    // Published: three different colors while three or more are left, never fewer.
    const pub = ready(2);
    expect(singleTakeSizes(pub)).toEqual([3]);
    expect(luster.apply(pub, { type: 'take', actor: 0, tokens: [1, 1, 0, 0, 0, 0] }).ok).toBe(false);
    expect(luster.apply(pub, { type: 'take', actor: 0, tokens: [1, 1, 1, 0, 0, 0] }).ok).toBe(true);
    // Two colors left: exactly those two; one left: that one; none: no gem take at all.
    const two = withSupply(pub, [2, 0, 3, 0, 0, 5]);
    expect(singleTakeSizes(two)).toEqual([2]);
    expect(luster.apply(two, { type: 'take', actor: 0, tokens: [1, 0, 1, 0, 0, 0] }).ok).toBe(true);
    expect(luster.apply(two, { type: 'take', actor: 0, tokens: [1, 0, 0, 0, 0, 0] }).ok).toBe(false);
    expect(singleTakeSizes(withSupply(pub, [0, 0, 0, 1, 0, 5]))).toEqual([1]);
    expect(singleTakeSizes(withSupply(pub, [0, 0, 0, 0, 0, 5]))).toEqual([]);
    // Pairs are unchanged: two of one color with at least four in supply.
    expect(luster.apply(pub, { type: 'take', actor: 0, tokens: [2, 0, 0, 0, 0, 0] }).ok).toBe(true);
    expect(
      luster.apply(withSupply(pub, [4, 4, 4, 4, 3, 5]), {
        type: 'take',
        actor: 0,
        tokens: [0, 0, 0, 0, 2, 0],
      }).ok,
    ).toBe(false);

    // `any`, and a legacy table (no field): one, two or three different colors at any time, with the same moves.
    for (const rules of [ANY, LEGACY_RULES]) {
      const s = ready(2, rules);
      expect(singleTakeSizes(s)).toEqual([1, 2, 3]);
      expect(step(s, { type: 'take', actor: 0, tokens: [1, 0, 0, 0, 0, 0] }).players[0]!.tokens).toEqual([
        1, 0, 0, 0, 0, 0,
      ]);
    }
    expect(luster.legalActions(ready(3, LEGACY_RULES), 0)).toEqual(luster.legalActions(ready(3, ANY), 0));
    expect(ready(2, LEGACY_RULES).rules).toEqual({ target: 15 });
  });
});
