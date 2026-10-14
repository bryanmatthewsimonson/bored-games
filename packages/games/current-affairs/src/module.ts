import type { ApplyResult, GameModule, Learn } from '@bored-games/game-kit';
import {
  applyAction,
  beaconFor,
  DEFAULT_RULES,
  installDeckOrder,
  legalActions,
  pendingOf,
  rollShapeOf,
  STATION_DECK,
  setupGame,
  shufflePlaintexts,
  standingsOf,
  validateIntent,
  validateRules,
} from './engine.ts';
import { checkInvariants, coverageOf } from './invariants.ts';
import type { CurrentEvent, CurrentRules, CurrentState } from './types.ts';

export const CURRENT_ID = 'current-affairs';
export const CURRENT_VERSION = '0.1.0';

/** No card is ever dealt to one seat: every station is turned up in public. */
function learnNothing(_s: CurrentState, _learn: Learn): ApplyResult<CurrentState, CurrentEvent> {
  return { ok: false, error: { code: 'no-hidden', message: 'Current Affairs has no hidden cards to learn' } };
}

/**
 * Current Affairs (D091): one encrypted station deck with public reveals and prompt shares (D075), an Era III
 * reshuffle as a deck epoch (D073), and the opening order from the dice beacon (D058). A view is the whole state but
 * the deck's order.
 */
export const currentAffairs: GameModule<CurrentState, CurrentEvent, CurrentRules> = {
  id: CURRENT_ID,
  version: CURRENT_VERSION,
  validateIntent,
  defaultRules: () => DEFAULT_RULES,
  validateRules,
  seatRange: () => ({ min: 2, max: 6 }),
  decks: () => [STATION_DECK],
  setup: setupGame,
  pending: pendingOf,
  legalActions,
  apply: applyAction,
  learn: learnNothing,
  knownTo: () => [],
  view: (s) => (s.plain === null ? s : { ...s, plain: null }),
  outcome: (s) => s.result,
  standings: standingsOf,
  dealt: (s) => s.dealt,
  revealsOf: () => [],
  invariants: checkInvariants,
  coverage: coverageOf,
  rolls: (s) => s.rolls,
  beaconOf: beaconFor,
  rollShape: rollShapeOf,
  installDeckOrder,
  shufflePlaintexts,
};
