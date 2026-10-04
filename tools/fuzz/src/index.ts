import { bank } from '@bored-games/bank';
import { chainReaction } from '@bored-games/chain-reaction';
import { chess } from '@bored-games/chess';
import type { DeckSpec, FuzzPolicy, GameModule, Outcome, Rng } from '@bored-games/game-kit';
import { luster } from '@bored-games/luster';
import { BANK_EXPECTED_COVERAGE, BANK_POLICIES } from './bank.ts';
import {
  CHAIN_REACTION_EXPECTED_COVERAGE,
  CHAIN_REACTION_POLICIES,
  chainReactionDeckOrder,
} from './chain-reaction.ts';
import { CHESS_EXPECTED_COVERAGE, CHESS_POLICIES } from './chess.ts';
import { LUSTER_EXPECTED_COVERAGE, LUSTER_POLICIES, lusterDeckOrder } from './luster.ts';

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
  luster: {
    module: luster,
    deckOrder: lusterDeckOrder,
    policies: LUSTER_POLICIES,
    expectedCoverage: LUSTER_EXPECTED_COVERAGE,
    defaultSeatCounts: [2, 3, 4],
  },
  'chain-reaction': {
    module: chainReaction,
    policies: CHAIN_REACTION_POLICIES,
    deckOrder: chainReactionDeckOrder,
    expectedCoverage: CHAIN_REACTION_EXPECTED_COVERAGE,
    defaultSeatCounts: [3, 4, 5, 6],
  },
  chess: {
    module: chess,
    policies: CHESS_POLICIES,
    expectedCoverage: CHESS_EXPECTED_COVERAGE,
    defaultSeatCounts: [2],
  },
  bank: {
    module: bank,
    policies: BANK_POLICIES,
    expectedCoverage: BANK_EXPECTED_COVERAGE,
    defaultSeatCounts: [2, 3, 4, 5, 6],
  },
};

export {
  BANK_EXPECTED_COVERAGE,
  BANK_POLICIES,
  CHAIN_REACTION_EXPECTED_COVERAGE,
  CHAIN_REACTION_POLICIES,
  CHESS_EXPECTED_COVERAGE,
  CHESS_POLICIES,
  chainReactionDeckOrder,
};
