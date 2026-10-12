import type { GameModule } from '@bored-games/game-kit';
import {
  applyAction,
  beaconFor,
  CAMP_DECK,
  DEFAULT_RULES,
  legalActions,
  pendingOf,
  rollShapeOf,
  setupGame,
  validateRules,
} from './engine.ts';
import { checkInvariants, coverageOf } from './invariants.ts';
import { tally } from './scoring.ts';
import type { SticksEvent, SticksRules, SticksState } from './types.ts';
import { knownTo, learnCard, viewOf } from './view.ts';

export const STICKS_ID = 'sticks-and-stones';
export const STICKS_VERSION = '0.1.0';

/** Sticks & Stones (D089): dice from the beacon (D058) and one deck in two groups with prompt shares (D075). */
export const sticksAndStones: GameModule<SticksState, SticksEvent, SticksRules> = {
  id: STICKS_ID,
  version: STICKS_VERSION,
  defaultRules: () => DEFAULT_RULES,
  validateRules,
  seatRange: () => ({ min: 2, max: 4 }),
  decks: () => [CAMP_DECK],
  setup: setupGame,
  pending: pendingOf,
  legalActions,
  apply: applyAction,
  learn: learnCard,
  knownTo,
  view: viewOf,
  outcome: (s) => s.result,
  // Public data only: a face-down card counts once it is turned up (RULES.md C29).
  standings: (s) => s.result?.scores ?? s.clans.map((c) => tally(c, s.rules, true).total),
  dealt: (s) => s.dealt,
  // No move turns a card up from a hand: the display and the stacks are deck reveals, and so is the final count.
  revealsOf: () => [],
  handsReveal: (s) => s.stage === 'ending',
  invariants: checkInvariants,
  coverage: coverageOf,
  rolls: (s) => s.rolls,
  beaconOf: beaconFor,
  rollShape: rollShapeOf,
};
