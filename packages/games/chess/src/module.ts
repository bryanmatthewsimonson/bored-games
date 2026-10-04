import type { ApplyResult, GameModule, Learn, Seat } from '@bored-games/game-kit';
import { applyAction, legalActionsOf, outcomeOf, pendingOf, setupGame, standingsOf } from './engine.ts';
import { checkInvariants } from './invariants.ts';
import { type ChessRules, DEFAULT_RULES, validateRules } from './rules.ts';
import type { ChessEvent, ChessState } from './types.ts';

export const CHESS_ID = 'chess';
export const CHESS_VERSION = '0.1.0';

/** Perfect information: every viewer sees the whole state. */
export function viewFor(s: ChessState, _viewer: Seat | null): ChessState {
  return s;
}

/** Chess has no hidden cards, so there is nothing to learn: every learn record is an error. */
export function learnNothing(_s: ChessState, _learn: Learn): ApplyResult<ChessState, ChessEvent> {
  return { ok: false, error: { code: 'no-hidden', message: 'chess has no hidden cards to learn' } };
}

/** Rare-event tags for the fuzzer's coverage report. */
export function coverageTags(_s: ChessState, events: readonly ChessEvent[]): string[] {
  const tags: string[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'moved':
        if (e.castle) tags.push(`move:castle:${e.castle}`);
        if (e.enPassant) tags.push('move:enPassant');
        if (e.promotion) tags.push(e.promotion === 'q' ? 'move:promotion' : 'move:underpromotion');
        if (e.promotion && e.captured) tags.push('move:promotionCapture');
        if (e.check) tags.push('move:check');
        break;
      case 'drawOffered':
        tags.push('draw:offered');
        break;
      case 'drawDeclined':
        tags.push('draw:declined');
        break;
      default:
        break;
    }
  }
  return tags;
}

export const chess: GameModule<ChessState, ChessEvent, ChessRules> = {
  id: CHESS_ID,
  version: CHESS_VERSION,
  // Runs unchanged under both protocols (PROTOCOL-v2 §2 item 6).
  protocols: [1, 2],
  defaultRules: () => DEFAULT_RULES,
  validateRules,
  seatRange: () => ({ min: 2, max: 2 }),
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
};
