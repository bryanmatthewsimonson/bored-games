import type { DeckSpec, FuzzPolicy, GameModule, Outcome, Rng } from '@bored-games/game-kit';
import { tilestock } from '@bored-games/tilestock';
import { TILESTOCK_EXPECTED_COVERAGE, TILESTOCK_POLICIES, tilestockDeckOrder } from './tilestock.ts';

/** A game registered with the fuzz CLI. Adding a game = adding an entry here. */
export interface FuzzTarget {
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry of modules
  readonly module: GameModule<any, any, any>;
  // biome-ignore lint/suspicious/noExplicitAny: policies match their module's state type
  readonly policies: readonly FuzzPolicy<any>[];
  readonly deckOrder?: (deck: DeckSpec, rng: Rng) => number[];
  readonly expectedCoverage: readonly string[];
  /** Outcomes that must never happen; each one is reported as a bug. */
  readonly checkOutcome?: (outcome: Outcome) => string | null;
  readonly defaultSeatCounts: readonly number[];
}

export const TARGETS: Readonly<Record<string, FuzzTarget>> = {
  tilestock: {
    module: tilestock,
    policies: TILESTOCK_POLICIES,
    deckOrder: tilestockDeckOrder,
    expectedCoverage: TILESTOCK_EXPECTED_COVERAGE,
    defaultSeatCounts: [3, 4, 5, 6],
  },
};

export { TILESTOCK_EXPECTED_COVERAGE, TILESTOCK_POLICIES, tilestockDeckOrder };
