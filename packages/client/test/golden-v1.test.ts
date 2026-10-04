import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clientsFor,
  foldClient,
  GOLDEN_FORMAT,
  GOLDEN_MODULES,
  GOLDEN_NAMES,
  type GoldenFixture,
  labelOf,
} from './golden-v1/fold.ts';

/*
 * The v1 golden corpus (protocol v2 build plan, T1 and D-A). Each fixture holds a signed v1 event set (whole games
 * from `simulateGame` for Chain Reaction, Chess, Bank 0.1.0 and Luster, honest and with the test adversaries, and
 * the hand-built sets of stale-rival.test.ts and shuffle-fork-deal.test.ts) and, for three arrival orders, the
 * digest of each fold of it by a fresh v1 `GameSession`: every receive status, every rejection reason, the duty
 * sequence, a hash over every step's view, and the final view, state hash and attestation content. This test folds
 * the stored events again and requires the same digests, so the v1 fold stays byte-identical whatever v2 adds.
 *
 * Never regenerate these fixtures to make this test pass: a difference is a v1 regression (D-A). The generator is
 * scripts/golden-v1.ts.
 */

const DIR = new URL('./golden-v1/', import.meta.url);

const load = (name: string): GoldenFixture =>
  JSON.parse(readFileSync(new URL(`${name}.json`, DIR), 'utf8')) as GoldenFixture;

describe('the v1 golden corpus', () => {
  it('holds exactly the listed fixtures, each in the current format and for an engine the corpus folds with', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort();
    expect(files).toEqual([...GOLDEN_NAMES].sort());
    for (const name of GOLDEN_NAMES) {
      const fx = load(name);
      expect(fx.format).toBe(GOLDEN_FORMAT);
      expect(fx.name).toBe(name);
      // Bank's fixtures are Bank 0.1.0 games: once 0.2.0 ships (T5), they must still fold with 0.1.0.
      expect(GOLDEN_MODULES.get(fx.game)?.version).toBe(fx.version);
      expect(fx.orders.map((o) => o.name)).toEqual(['published', 'reversed', 'shuffled']);
      for (const [k, o] of fx.orders.entries()) {
        expect(Object.keys(o.clients)).toEqual(clientsFor(fx.seats, k, fx.clients).map(labelOf));
      }
    }
  });
});

for (const name of GOLDEN_NAMES) {
  describe(name, () => {
    const fx = load(name);
    for (const order of fx.orders) {
      const run = (): void => {
        for (const [label, want] of Object.entries(order.clients)) {
          const seat = label === 'spectator' ? null : Number(label.slice('seat '.length));
          const got = foldClient(fx, order.deliveries, seat);
          // The final view first: its difference reads best.
          expect({ label, final: got.final }).toEqual({ label, final: want.final });
          expect({ label, ...got }).toEqual({ label, ...want });
        }
      };
      const what = `${fx.game} ${fx.version} (${name}), ${order.name} order: every client folds as recorded`;
      // Every v1 game folds by v1 rules (V2-03); Bank 0.1.0 and Luster games in progress keep folding (V2-53).
      if (fx.game === 'bank' || fx.game === 'luster') it(`V2-03, V2-53 (v1 halves): ${what}`, run);
      else it(`V2-03 (v1 half): ${what}`, run);
    }
  });
}
