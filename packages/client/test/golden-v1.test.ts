import { readdirSync } from 'node:fs';
import type { Hex } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { goldenCases, loadFixture } from './golden-v1/cases.ts';
import {
  clientsFor,
  foldClient,
  GOLDEN_FORMAT,
  GOLDEN_GROUPS,
  GOLDEN_MODULES,
  GOLDEN_NAMES,
  goldenSession,
  labelOf,
} from './golden-v1/fold.ts';

/*
 * The v1 golden corpus (protocol v2 build plan, T1 and D-A). Each fixture holds a signed v1 event set (whole games
 * from `simulateGame` for Chain Reaction, Chess, Bank 0.1.0 and Luster, honest and with the test adversaries, the
 * hand-built sets of stale-rival.test.ts and shuffle-fork-deal.test.ts, and hand-built Chess noise and deadline
 * claims) and, for three arrival orders, the digest of each fold of it by a fresh v1 `GameSession`: every receive
 * status, every rejection reason, the duty sequence, a hash over every step's view, and the final view, state hash
 * and attestation content. The corpus folds the stored events again and requires the same digests, so the v1 fold
 * stays byte-identical whatever v2 adds. This file holds the deckless games and the checks on the corpus itself;
 * golden-v1-cr.test.ts, golden-v1-cr-sets.test.ts and golden-v1-luster.test.ts hold the rest, so that vitest folds
 * them in parallel.
 *
 * Never regenerate these fixtures to make a test pass: a difference is a v1 regression (D-A). The generator is
 * scripts/golden-v1.ts.
 */

const DIR = new URL('./golden-v1/', import.meta.url);

describe('the v1 golden corpus', () => {
  it('holds exactly the listed fixtures, each in the current format and for an engine the corpus folds with', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort();
    expect(new Set(GOLDEN_NAMES).size).toBe(GOLDEN_NAMES.length);
    expect(files).toEqual([...GOLDEN_NAMES].sort());
    for (const name of GOLDEN_NAMES) {
      const fx = loadFixture(name);
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

/*
 * Every other fold marks the valid shuffle steps' proofs as verified up front (a proof costs about a second). These
 * verify them: the stored steps were built with v1's proof context (root id, seat, deck id, the partition's input
 * slice), so a drift in that context rejects them here. Chain Reaction has one deck; Luster has four groups.
 */
describe('the v1 golden corpus: shuffle proofs verified, nothing trusted', () => {
  for (const name of ['cr-vanish-early', 'luster-honest']) {
    it(`V2-03 (v1 half): ${name}: the spectator verifies every valid shuffle step and folds as recorded`, () => {
      const fx = loadFixture(name);
      const published = fx.orders[0];
      expect(published?.name).toBe('published');
      expect(fx.trusted.length).toBeGreaterThan(0);
      const s = goldenSession({ ...fx, trusted: [] }, null);
      for (const i of published?.deliveries ?? []) {
        const ev = fx.events[i];
        if (ev !== undefined) s.receive(ev, ev.created_at);
      }
      const internals = s as unknown as { shuffleChecked: Map<Hex, boolean>; shuffleVerifications: number };
      expect(internals.shuffleVerifications).toBe(fx.trusted.length);
      expect(fx.trusted.filter((id) => internals.shuffleChecked.get(id) !== true)).toEqual([]);
      const got = foldClient({ ...fx, trusted: [] }, published?.deliveries ?? [], null);
      expect(got).toEqual(published?.clients.spectator);
    });
  }
});

describe('the v1 golden corpus: Chess and Bank 0.1.0', () => {
  for (const c of goldenCases(GOLDEN_GROUPS.deckless)) {
    if (c.v253) {
      it(`V2-03, V2-53 (v1 halves): ${c.what}`, c.run);
    } else {
      it(`V2-03 (v1 half): ${c.what}`, c.run);
    }
  }
});
