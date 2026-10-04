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
import type { BankEvent, BankState, BankVariant } from './types.ts';

export const BANK_ID = 'bank';
/** The current engine, Bank 0.2.0: protocol 2 only. New tables use it. */
export const BANK_VERSION = '0.2.0';
/** Bank 0.1.0: protocol 1 only, shipped beside 0.2.0 to keep folding v1 games in progress (PROTOCOL-v2 §2 item 5). */
export const BANK_V1_VERSION = '0.1.0';

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

export type BankModule = GameModule<BankState, BankEvent, BankRules>;

/**
 * One engine, two versions (protocol v2 build plan D-C). They differ only in what follows a Roll, the `contribute`
 * action, the roll list's entry form and `beaconOf`; every other rule is shared.
 * - `'v2'`, Bank 0.2.0, `protocols: [2]`: a Roll pends `{type: 'beacon', id}` at once; there is no `collect` phase
 *   and no `contribute` action; `rolls` lists `{id, count: 2, sides: 6}`; no `beaconOf` (PROTOCOL-v2 §6.2, §10).
 * - `'v1'`, Bank 0.1.0, `protocols: [1]`: exactly the engine v1 games were played with: contributions are turns in
 *   a fixed order and the roll point is counter-bound (PROTOCOL §6.3a). Its golden fixtures pin it step for step.
 */
export function createBankModule(variant: BankVariant): BankModule {
  const v1 = variant === 'v1';
  return {
    id: BANK_ID,
    version: v1 ? BANK_V1_VERSION : BANK_VERSION,
    protocols: v1 ? [1] : [2],
    defaultRules: () => DEFAULT_RULES,
    validateRules,
    seatRange: () => ({ min: 2, max: 6 }),
    decks: () => [],
    setup: setupGame,
    pending: pendingOf,
    legalActions: legalActionsOf,
    apply: (s, action) => applyAction(s, action, variant),
    learn: learnNothing,
    knownTo: () => [],
    view: viewFor,
    outcome: outcomeOf,
    standings: standingsOf,
    dealt: () => [],
    revealsOf: () => [],
    invariants: (s) => checkInvariants(s, variant),
    coverage: coverageTags,
    rolls: rollsOf,
    ...(v1 ? { beaconOf } : {}),
  };
}

/** Bank 0.2.0, the current engine (protocol 2), registered under `bank`. */
export const bank: BankModule = createBankModule('v2');

/**
 * Bank 0.1.0 (protocol 1), registered under `bank@0.1.0` (`moduleFor`) so that v1 games in progress keep folding by
 * the rules they were started with. Never offered for a new table.
 */
export const bankV1: BankModule = createBankModule('v1');
