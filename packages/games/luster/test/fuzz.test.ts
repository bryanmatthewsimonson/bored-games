import { fuzzGame } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { LUSTER_POLICIES } from '../../../../tools/fuzz/src/luster.ts';
import { luster } from '../src/module.ts';

describe('complete Luster games, views, protocol hooks and replay', () => {
  // The published gem rule (the default) and `any` (legacy tables, C11).
  for (const rules of [luster.defaultRules(), { target: 15 as const, gems: 'any' as const }])
    for (const seats of [2, 3, 4])
      it(`${seats} players, gems ${rules.gems}, independent private views and spectator`, () => {
        for (let g = 0; g < 8; g++) {
          const report = fuzzGame(luster, {
            seed: rules.gems === 'any' ? `luster-${seats}-${g}` : `luster-published-${seats}-${g}`,
            seats,
            rules,
            policies: LUSTER_POLICIES,
            maxSteps: 4000,
          });
          expect(report.failure, JSON.stringify(report.failure)).toBeNull();
          expect(report.outcome?.reason).toBe('radiance');
        }
      });
});
