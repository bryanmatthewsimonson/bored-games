import type { ApplyResult, GameModule, Learn } from '@bored-games/game-kit';
import {
  applyAction,
  beaconFor,
  DEFAULT_RULES,
  legalActions,
  pendingOf,
  rollShapeOf,
  setupGame,
  standingsOf,
  validateIntent,
  validateRules,
} from './engine.ts';
import { checkInvariants, coverageOf } from './invariants.ts';
import type { CurrentEvent, CurrentRules, CurrentState } from './types.ts';

export const CURRENT_ID = 'current-affairs';
export const CURRENT_VERSION = '0.1.0';

/** Nothing is hidden: there is no card to learn. */
function learnNothing(_s: CurrentState, _learn: Learn): ApplyResult<CurrentState, CurrentEvent> {
  return { ok: false, error: { code: 'no-hidden', message: 'Current Affairs has no hidden cards to learn' } };
}

/**
 * Current Affairs (D091): deckless, with every random card and the opening drawn by the dice beacon (D058). Every
 * view is the whole state.
 */
export const currentAffairs: GameModule<CurrentState, CurrentEvent, CurrentRules> = {
  id: CURRENT_ID,
  version: CURRENT_VERSION,
  validateIntent,
  defaultRules: () => DEFAULT_RULES,
  validateRules,
  seatRange: () => ({ min: 2, max: 6 }),
  decks: () => [],
  setup: setupGame,
  pending: pendingOf,
  legalActions,
  apply: applyAction,
  learn: learnNothing,
  knownTo: () => [],
  view: (s) => s,
  outcome: (s) => s.result,
  standings: standingsOf,
  dealt: () => [],
  revealsOf: () => [],
  invariants: checkInvariants,
  coverage: coverageOf,
  rolls: (s) => s.rolls,
  beaconOf: beaconFor,
  rollShape: rollShapeOf,
};
