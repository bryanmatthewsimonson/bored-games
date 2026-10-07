import type { GameModule } from '@bored-games/game-kit';
import {
  applyAction,
  beaconFor,
  CASE_DECK,
  coverageOf,
  DEFAULT_RULES,
  knownTo,
  learnCard,
  legalActions,
  pendingOf,
  setupGame,
  showOf,
  standingsOf,
  validateRules,
  viewOf,
} from './engine.ts';
import { checkInvariants } from './invariants.ts';
import type { RfdEvent, RfdRules, RfdState } from './types.ts';

export const ROOM_FOR_DOUBT_ID = 'room-for-doubt';
export const ROOM_FOR_DOUBT_VERSION = '0.1.0';

export { CASE_DECK };

/** Room for Doubt (D078): one case deck (D076), dice from the beacon (D058) and private shows (D077). */
export const roomForDoubt: GameModule<RfdState, RfdEvent, RfdRules> = {
  id: ROOM_FOR_DOUBT_ID,
  version: ROOM_FOR_DOUBT_VERSION,
  defaultRules: () => DEFAULT_RULES,
  validateRules,
  seatRange: () => ({ min: 3, max: 6 }),
  decks: () => [CASE_DECK],
  setup: setupGame,
  pending: pendingOf,
  legalActions,
  apply: applyAction,
  learn: learnCard,
  knownTo,
  view: viewOf,
  outcome: (s) => s.result,
  standings: standingsOf,
  dealt: (s) => s.dealt,
  // No action shows a card in public: a rebuttal is a private show, and the Verdict is announced, not shown.
  revealsOf: () => [],
  invariants: checkInvariants,
  coverage: coverageOf,
  privateShow: showOf,
  rolls: (s) => s.rolls,
  beaconOf: beaconFor,
  // An early deck secret would open the hands, the shown cards and the Verdict: Resign waits for its D052 review.
  resignAllowed: () => false,
};
