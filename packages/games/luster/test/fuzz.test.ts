import { fuzzGame } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { LUSTER_POLICIES } from '../../../../tools/fuzz/src/luster.ts';
import { luster } from '../src/module.ts';

describe('complete Luster games, views, protocol hooks and replay', () => {
  for (const seats of [2, 3, 4])
    it(`${seats} players, independent private views and spectator`, () => {
      for (let g = 0; g < 8; g++) {
        const report = fuzzGame(luster, {
          seed: `luster-${seats}-${g}`,
          seats,
          rules: luster.defaultRules(),
          policies: LUSTER_POLICIES,
          maxSteps: 4000,
        });
        expect(report.failure, JSON.stringify(report.failure)).toBeNull();
        expect(report.outcome?.reason).toBe('radiance');
      }
    });
});
