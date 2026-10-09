import { fuzzGame } from '@bored-games/game-kit';
import { expect, it } from 'vitest';
import { QUILL_POLICIES } from '../../../../tools/fuzz/src/quill-and-quarry.ts';
import { DEFAULT_RULES, quillAndQuarry } from '../src/index.ts';

for (const seats of [2, 3, 4])
  it(`replays encrypted-bag epochs and every private view at ${seats} seats`, () => {
    for (let i = 0; i < 6; i++) {
      const r = fuzzGame(quillAndQuarry, {
        seed: `quill-${seats}-${i}`,
        seats,
        rules: DEFAULT_RULES,
        policies: QUILL_POLICIES,
        maxSteps: 1500,
      });
      expect(r.failure, JSON.stringify(r.failure)).toBeNull();
      expect(r.outcome).not.toBeNull();
    }
  });
