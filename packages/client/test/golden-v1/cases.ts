import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { foldClient, type GoldenFixture } from './fold.ts';

/*
 * The golden corpus's test cases (see fold.ts): one per fixture and arrival order, folding every recorded client
 * again and comparing with its recorded digest. The test files hold the `it` calls themselves, so that their titles
 * carry the conformance ids the guard scans for (tests/conformance-v2.test.ts).
 */

export const loadFixture = (name: string): GoldenFixture =>
  JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8')) as GoldenFixture;

export interface GoldenCase {
  /** The rest of the title, after the conformance ids. */
  what: string;
  /** A Bank or Luster game: its fixture also covers the v1 half of V2-53 (proto-1 games in progress keep folding). */
  v253: boolean;
  run: () => void;
}

export function goldenCases(names: readonly string[]): GoldenCase[] {
  return names.flatMap((name) => {
    const fx = loadFixture(name);
    return fx.orders.map((order) => ({
      what: `${fx.game} ${fx.version} (${name}), ${order.name} order: every client folds as recorded`,
      v253: fx.game === 'bank' || fx.game === 'luster',
      run: () => {
        for (const [label, want] of Object.entries(order.clients)) {
          const seat = label === 'spectator' ? null : Number(label.slice('seat '.length));
          const got = foldClient(fx, order.deliveries, seat);
          // The final view first: its difference reads best.
          expect({ label, final: got.final }).toEqual({ label, final: want.final });
          expect({ label, ...got }).toEqual({ label, ...want });
        }
      },
    }));
  });
}
