import type { Seat } from '@bored-games/game-kit';
import type { TilestockRules } from './rules.ts';
import type { TileId } from './tiles.ts';

/** Board cell: null = empty, LOOSE = unincorporated, PENDING = placed tile awaiting resolution, n >= 0 = chain. */
export type Cell = number | null;
export const LOOSE = -1;
export const PENDING = -2;

/** A tile in hand: its deck position and, if known to this state, its tile index. */
export interface HandSlot {
  readonly pos: number;
  readonly tile: number | null;
}

export interface PlayerState {
  readonly cash: number;
  /** Shares held, indexed by chain. */
  readonly shares: readonly number[];
  /** Sorted by deck position. */
  readonly hand: readonly HandSlot[];
}

export interface MergerState {
  readonly tile: number;
  readonly mergemaker: Seat;
  /** Involved chain indices, ascending. */
  readonly chains: readonly number[];
  /** Pre-merger sizes, parallel to `chains`. */
  readonly sizes: readonly number[];
  readonly survivor: number | null;
  /** Defunct chains still to resolve, in resolution order; null until ordered. */
  readonly defuncts: readonly number[] | null;
  /** Holders still to dispose of the head defunct; null until its bonuses are paid. */
  readonly holders: readonly Seat[] | null;
}

export type Phase =
  | { readonly kind: 'setup' }
  | { readonly kind: 'place' }
  | { readonly kind: 'found'; readonly tile: number }
  | { readonly kind: 'merger'; readonly merger: MergerState }
  | { readonly kind: 'buy' }
  | { readonly kind: 'over' };

export interface TurnState {
  readonly seat: Seat;
  readonly number: number;
  /** An end condition that held at the start of this turn or after its placement resolved. */
  readonly endCondition: 'endSize' | 'allSafe' | null;
}

export interface GameResult {
  readonly reason: 'declared';
  readonly cash: readonly number[];
  readonly places: readonly number[];
}

export interface TilestockState {
  readonly game: 'tilestock';
  readonly rules: TilestockRules;
  readonly seats: number;
  readonly mode: 'full' | 'view';
  readonly viewer: Seat | null;
  /** order is the shuffled tile order (full mode only); next is the next undealt position. */
  readonly deck: { readonly order: readonly number[] | null; readonly next: number };
  /** Setup tile per seat (dealt at positions 0..seats-1), null until revealed. */
  readonly setupTiles: readonly (number | null)[];
  readonly board: readonly Cell[];
  readonly players: readonly PlayerState[];
  readonly bank: readonly number[];
  /** Discarded dead tiles, ascending. */
  readonly discard: readonly number[];
  readonly firstPlayer: Seat | null;
  readonly turn: TurnState | null;
  readonly phase: Phase;
  readonly result: GameResult | null;
  readonly seq: number;
}

export interface DiscardEntry {
  readonly pos: number;
  readonly tile: TileId;
}

export type TilestockAction =
  | {
      readonly type: 'reveal';
      readonly actor: 'deck';
      readonly deck: 'tiles';
      readonly pos: number;
      readonly card: number;
    }
  | { readonly type: 'place'; readonly actor: Seat; readonly pos: number; readonly tile: TileId }
  | { readonly type: 'skipPlace'; readonly actor: Seat }
  | { readonly type: 'foundChain'; readonly actor: Seat; readonly chain: string }
  | { readonly type: 'chooseSurvivor'; readonly actor: Seat; readonly chain: string }
  | { readonly type: 'orderDefunct'; readonly actor: Seat; readonly order: readonly string[] }
  | {
      readonly type: 'dispose';
      readonly actor: Seat;
      readonly chain: string;
      readonly sell: number;
      readonly trade: number;
    }
  | {
      readonly type: 'endTurn';
      readonly actor: Seat;
      /** Chain ids bought this turn, in chain order (e.g. ["b1","b1","p2"]). */
      readonly buy: readonly string[];
      readonly declareEnd: boolean;
      /** Every dead tile held, ascending by position. */
      readonly discard: readonly DiscardEntry[];
    };

export type BonusRole = 'majority' | 'minority' | 'sole' | 'majorityTie' | 'minorityTie';

export type TilestockEvent =
  | { readonly type: 'setupTileRevealed'; readonly seat: Seat; readonly tile: TileId }
  | { readonly type: 'firstPlayer'; readonly seat: Seat }
  | { readonly type: 'tilesDealt'; readonly seat: Seat; readonly positions: readonly number[] }
  | { readonly type: 'turnStarted'; readonly seat: Seat; readonly turn: number }
  | {
      readonly type: 'tilePlaced';
      readonly seat: Seat;
      readonly tile: TileId;
      readonly kind: 'lone' | 'found' | 'grow' | 'merge';
    }
  | { readonly type: 'placementSkipped'; readonly seat: Seat }
  | {
      readonly type: 'chainFounded';
      readonly seat: Seat;
      readonly chain: string;
      readonly size: number;
      /** Shares of this chain still held by players from an earlier life. */
      readonly keptShares: number;
    }
  | { readonly type: 'founderShare'; readonly seat: Seat; readonly chain: string; readonly granted: boolean }
  | { readonly type: 'chainGrew'; readonly chain: string; readonly size: number; readonly safe: boolean }
  | {
      readonly type: 'mergerStarted';
      readonly seat: Seat;
      readonly tile: TileId;
      readonly chains: readonly string[];
      readonly sizes: readonly number[];
      readonly safeChains: number;
    }
  | { readonly type: 'survivorChosen'; readonly chain: string; readonly tied: boolean }
  | { readonly type: 'defunctOrder'; readonly order: readonly string[]; readonly tied: boolean }
  | {
      readonly type: 'bonusPaid';
      readonly chain: string;
      readonly seat: Seat;
      readonly amount: number;
      readonly role: BonusRole;
      readonly final: boolean;
    }
  | { readonly type: 'noBonus'; readonly chain: string; readonly final: boolean }
  | {
      readonly type: 'sharesDisposed';
      readonly seat: Seat;
      readonly chain: string;
      readonly sell: number;
      readonly trade: number;
      readonly keep: number;
      readonly proceeds: number;
      /** Survivor shares in the bank capped how many could be traded. */
      readonly tradeCapped: boolean;
    }
  | { readonly type: 'chainDefunct'; readonly chain: string }
  | { readonly type: 'mergerCompleted'; readonly survivor: string; readonly size: number }
  | {
      readonly type: 'sharesBought';
      readonly seat: Seat;
      readonly shares: readonly string[];
      readonly cost: number;
    }
  | { readonly type: 'endDeclared'; readonly seat: Seat; readonly condition: 'endSize' | 'allSafe' }
  | { readonly type: 'tilesDiscarded'; readonly seat: Seat; readonly tiles: readonly TileId[] }
  | {
      readonly type: 'finalSale';
      readonly seat: Seat;
      readonly chain: string;
      readonly count: number;
      readonly amount: number;
    }
  | {
      readonly type: 'gameEnded';
      readonly reason: 'declared';
      readonly cash: readonly number[];
      readonly places: readonly number[];
    };
