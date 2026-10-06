import type { GameModule } from '@bored-games/game-kit';
import {
  applyAction,
  dealtOf,
  handsReveal,
  installDeckOrder,
  knownTo,
  learnCard,
  legalActionsOf,
  outcomeOf,
  pendingOf,
  revealsOf,
  setupGame,
  shufflePlaintexts,
  standingsOf,
  viewFor,
} from './engine.ts';
import { checkInvariants } from './invariants.ts';
import { DEFAULT_RULES, type HollerRules, validateRules } from './rules.ts';
import type { HollerEvent, HollerState } from './types.ts';

export const HOLLER_ID = 'holler';
export const HOLLER_VERSION = '0.1.0';

/** Rare-event tags for the fuzzer's coverage report. */
export function coverageTags(s: HollerState, events: readonly HollerEvent[]): string[] {
  const tags: string[] = [];
  for (const event of events) {
    if (event.type === 'round' && event.starter === 'levy') tags.push('starter:levy');
    if (event.type === 'round' && event.starter === 'swing2') tags.push('starter:swing2');
    if (event.type === 'answered' && event.clean) tags.push('challenge:clean');
    if (event.type === 'answered' && !event.clean) tags.push('challenge:unclean');
    if (event.type === 'hollered') tags.push('holler');
    if (event.type === 'caught') tags.push('catch');
    if (event.type === 'reshuffled') tags.push('reshuffle');
    if (event.type === 'drawn' && event.short) tags.push('empty-draw');
    if (event.type === 'over') tags.push('score:500');
  }
  if (s.resume !== null) tags.push('resume');
  return tags;
}

/** Two-seat refusal belongs to the session. The module allows a resign at every count. */
export function resignAllowed(_rules: HollerRules, _seats: number): boolean {
  return true;
}

export const holler: GameModule<HollerState, HollerEvent, HollerRules> = {
  id: HOLLER_ID,
  version: HOLLER_VERSION,
  defaultRules: () => DEFAULT_RULES,
  validateRules,
  seatRange: () => ({ min: 2, max: 10 }),
  decks: () => [{ id: 'pile', size: 108 }],
  setup: setupGame,
  pending: pendingOf,
  legalActions: legalActionsOf,
  apply: applyAction,
  learn: learnCard,
  knownTo,
  view: viewFor,
  outcome: outcomeOf,
  standings: standingsOf,
  dealt: dealtOf,
  revealsOf,
  invariants: checkInvariants,
  coverage: coverageTags,
  installDeckOrder,
  shufflePlaintexts,
  handsReveal,
  resignAllowed,
};
