import type { ApplyResult, GameModule, Learn } from '@bored-games/game-kit';
import { deckOf, MAX_SEATS, MIN_SEATS } from './data.ts';
import {
  applyAction,
  DEFAULT_RULES,
  installDeckOrder,
  legalActions,
  pendingOf,
  setupGame,
  shufflePlaintexts,
  standingsOf,
  validateRules,
} from './engine.ts';
import { checkInvariants, coverageOf } from './invariants.ts';
import type { FeverEvent, FeverRules, FeverState } from './types.ts';

export const FEVER_ID = 'fever-pitch';
export const FEVER_VERSION = '0.1.0';

/** No card is ever dealt to one seat: hands are open, and every card is turned up in public (C01). */
function learnNothing(_s: FeverState, _learn: Learn): ApplyResult<FeverState, FeverEvent> {
  return { ok: false, error: { code: 'no-hidden', message: 'Fever Pitch has no hidden cards to learn' } };
}

/**
 * Fever Pitch (D096): a cooperative game on one encrypted deck with public reveals and prompt shares (D075), the
 * field deck's piles mixed with their surges by a second shuffle round (D076), and each restack of the spread deck a
 * deck epoch (D073). A view is the whole state but the deck's order.
 */
export const feverPitch: GameModule<FeverState, FeverEvent, FeverRules> = {
  id: FEVER_ID,
  version: FEVER_VERSION,
  defaultRules: () => DEFAULT_RULES,
  validateRules,
  seatRange: () => ({ min: MIN_SEATS, max: MAX_SEATS }),
  decks: (rules, seats) => [deckOf(rules, seats)],
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
  installDeckOrder,
  shufflePlaintexts,
};
