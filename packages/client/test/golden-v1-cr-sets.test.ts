import { describe, it } from 'vitest';
import { goldenCases } from './golden-v1/cases.ts';
import { GOLDEN_GROUPS } from './golden-v1/fold.ts';

/* The v1 golden corpus (see golden-v1.test.ts): Chain Reaction, the stale-rival, freeze and shuffle-fork-deal sets. */

describe('the v1 golden corpus: Chain Reaction, the stale-rival, freeze and shuffle-fork-deal sets', () => {
  for (const c of goldenCases(GOLDEN_GROUPS.crSets)) {
    if (c.v253) {
      it(`V2-53: ${c.what} (V2-03: by v1 rules)`, c.run);
    } else {
      it(`V2-03 v1 rules: ${c.what}`, c.run);
    }
  }
});
