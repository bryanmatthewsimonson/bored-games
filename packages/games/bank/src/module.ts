import type { ApplyResult, GameModule, Learn, Seat } from '@bored-games/game-kit';
import {
  applyAction,
  beaconOf,
  legalActionsOf,
  outcomeOf,
  pendingOf,
  rollsOf,
  setupGame,
  standingsOf,
} from './engine.ts';
import { checkInvariants } from './invariants.ts';
import { type BankRules, DEFAULT_RULES, validateRules } from './rules.ts';
import type { BankEvent, BankState } from './types.ts';

export const BANK_ID = 'bank';
export const BANK_VERSION = '0.1.0';

/** Perfect information: every viewer sees the whole state. */
export function viewFor(s: BankState, _viewer: Seat | null): BankState {
  return s;
}

/** Bank has no hidden cards, so there is nothing to learn. */
export function learnNothing(_s: BankState, _learn: Learn): ApplyResult<BankState, BankEvent> {
  return { ok: false, error: { code: 'no-hidden', message: 'bank has no hidden cards to learn' } };
}

/** Rare-event tags for the fuzzer's coverage report. */
export function coverageTags(_s: BankState, events: readonly BankEvent[]): string[] {
  const tags: string[] = [];
  for (const event of events) {
    if (event.type === 'banked' && event.shared) tags.push('bank:shared');
    if (event.type === 'dice' && event.effect === 'seventy') tags.push('roll:safe7');
    if (event.type === 'dice' && event.effect === 'bust') tags.push('roll:bust');
    if (event.type === 'dice' && event.effect === 'double') tags.push('roll:double');
    if (event.type === 'round' && event.how === 'banks') tags.push('round:all-banked');
    if (event.type === 'round' && event.how === 'cap') tags.push('round:cap');
    if (event.type === 'over') tags.push('end:score');
  }
  return tags;
}

export const bank: GameModule<BankState, BankEvent, BankRules> = {
  id: BANK_ID,
  version: BANK_VERSION,
  defaultRules: () => DEFAULT_RULES,
  validateRules,
  seatRange: () => ({ min: 2, max: 6 }),
  decks: () => [],
  setup: setupGame,
  pending: pendingOf,
  legalActions: legalActionsOf,
  apply: applyAction,
  learn: learnNothing,
  knownTo: () => [],
  view: viewFor,
  outcome: outcomeOf,
  standings: standingsOf,
  dealt: () => [],
  revealsOf: () => [],
  invariants: checkInvariants,
  coverage: coverageTags,
  rolls: rollsOf,
  beaconOf,
};
