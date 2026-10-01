import type { GameModule, Learn, Outcome, Seat } from '@bored-games/game-kit';
import { classifyTile } from './board.ts';
import { applyAction, learnTile, setupGame } from './engine.ts';
import { checkInvariants } from './invariants.ts';
import { legalActions, pendingDecision } from './legal.ts';
import { DEFAULT_RULES, type TilestockRules, validateRules } from './rules.ts';
import { TILE_COUNT } from './tiles.ts';
import type { TilestockEvent, TilestockState } from './types.ts';

export const TILESTOCK_ID = 'tilestock';
export const TILESTOCK_VERSION = '0.2.0';

/** Redacts a state to what `viewer` may know: opponents' hands and the deck order are hidden. */
export function viewFor(s: TilestockState, viewer: Seat | null): TilestockState {
  return {
    ...s,
    mode: 'view',
    viewer,
    deck: { order: null, next: s.deck.next },
    players: s.players.map((p, seat) =>
      seat === viewer ? p : { ...p, hand: p.hand.map((h) => ({ pos: h.pos, tile: null })) },
    ),
  };
}

export function knownTo(s: TilestockState, seat: Seat): Learn[] {
  return (s.players[seat]?.hand ?? []).flatMap((h) =>
    h.tile === null ? [] : [{ deck: 'tiles', pos: h.pos, card: h.tile }],
  );
}

export function outcomeOf(s: TilestockState): Outcome | null {
  if (!s.result) return null;
  return { places: s.result.places, scores: s.result.cash, reason: s.result.reason };
}

/** Rare-event tags for the fuzzer's coverage report. */
export function coverageTags(s: TilestockState, events: readonly TilestockEvent[]): string[] {
  const tags: string[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'mergerStarted':
        tags.push(`merger:${e.chains.length}way`);
        if (e.safeChains > 0) tags.push('merger:safeAbsorbsUnsafe');
        break;
      case 'survivorChosen':
        if (e.tied) tags.push('merger:survivorTie');
        break;
      case 'defunctOrder':
        if (e.tied) tags.push('merger:defunctTie');
        break;
      case 'bonusPaid':
        tags.push(`bonus:${e.role}${e.final ? ':final' : ''}`);
        break;
      case 'noBonus':
        tags.push(`bonus:none${e.final ? ':final' : ''}`);
        break;
      case 'sharesDisposed':
        if (e.tradeCapped) tags.push('dispose:tradeCappedBySupply');
        if (e.sell > 0 && e.trade > 0 && e.keep > 0) tags.push('dispose:sellTradeKeep');
        break;
      case 'founderShare':
        if (!e.granted) tags.push('found:noBankShare');
        break;
      case 'chainFounded':
        if (e.keptShares > 0) tags.push('found:refoundedWithKeptShares');
        if (e.size >= 3) tags.push('found:multiTileGroup');
        break;
      case 'chainGrew':
        if (e.safe) tags.push('grow:safeChain');
        break;
      case 'placementSkipped':
        tags.push('turn:noPlayableTile');
        break;
      case 'tilesDiscarded':
        tags.push('turn:deadTileDiscarded');
        break;
      case 'endDeclared':
        tags.push(`declare:${e.condition}`);
        break;
      case 'tilesDealt':
        if (s.deck.next >= TILE_COUNT && e.positions.length < s.rules.handSize && s.phase.kind !== 'setup') {
          tags.push('deck:bagEmptied');
        }
        break;
      default:
        break;
    }
  }
  if (s.deck.order) {
    for (const p of s.players) {
      for (const h of p.hand) {
        if (h.tile === null || s.board[h.tile] !== null) continue;
        const kind = classifyTile(s.board, s.rules, h.tile).kind;
        if (kind === 'dead' || kind === 'blocked') tags.push(`hand:${kind}TileHeld`);
      }
    }
  }
  return tags;
}

export const tilestock: GameModule<TilestockState, TilestockEvent, TilestockRules> = {
  id: TILESTOCK_ID,
  version: TILESTOCK_VERSION,
  defaultRules: () => DEFAULT_RULES,
  validateRules,
  seatRange: (rules) => ({ min: rules.minPlayers, max: rules.maxPlayers }),
  decks: () => [{ id: 'tiles', size: TILE_COUNT }],
  setup: setupGame,
  pending: pendingDecision,
  legalActions,
  apply: applyAction,
  learn: learnTile,
  knownTo,
  view: viewFor,
  outcome: outcomeOf,
  invariants: checkInvariants,
  coverage: coverageTags,
};
