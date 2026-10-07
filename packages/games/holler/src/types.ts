import type { DealtPosition } from '@bored-games/game-kit';
import type { Suit } from './cards.ts';
import type { HollerRules } from './rules.ts';

/** A card sitting in a hand. `fresh` hides a voluntary draw until the cover ring finishes. */
export interface Slot {
  readonly pos: number;
  readonly card: number | null;
  readonly open: boolean;
  readonly fresh: boolean;
}

export interface PileCard {
  readonly pos: number;
  readonly card: number;
}

export type After = 'skip' | 'cover' | 'score' | 'play';

/** Public summary of a draw that is waiting on an epoch. Absent fields are not stored. */
export interface Resume {
  readonly seat: number;
  readonly left: number;
  readonly after: After;
}

/**
 * The rest of a draw, kept on the epoch phase. `resume` stays the three public fields.
 * `catcher` is set only when a catch draw finishes inside the action that caught it.
 */
export interface Plan {
  readonly seat: number;
  readonly left: number;
  readonly after: After;
  readonly selected: number;
  readonly windowFor: number | null;
  readonly offender: number | null;
  readonly catcher: number | null;
  readonly goer: number | null;
  readonly fresh: boolean;
}

export type Phase =
  | { readonly type: 'reveal'; readonly kind: 'starter'; readonly positions: readonly number[] }
  | {
      readonly type: 'reveal';
      readonly kind: 'score';
      readonly positions: readonly number[];
      readonly goer: number;
    }
  | { readonly type: 'name'; readonly seat: number }
  | { readonly type: 'play'; readonly seat: number }
  | {
      readonly type: 'cover';
      readonly kind: 'voluntary' | 'catch';
      readonly queue: readonly number[];
      readonly drawer: number;
      readonly selected: number;
    }
  | { readonly type: 'drawn'; readonly seat: number; readonly pos: number }
  | {
      readonly type: 'levy';
      readonly seat: number;
      readonly player: number;
      readonly prior: Suit | null;
      readonly named: Suit;
      /** True when any slot of the levy player's hand was hidden at the moment of the play. */
      readonly blind: boolean;
    }
  | {
      readonly type: 'answer';
      readonly seat: number;
      readonly challenger: number;
      readonly prior: Suit | null;
      readonly named: Suit;
      /** Copied from the levy. A blind claim cannot be checked after the card has left. */
      readonly blind: boolean;
    }
  | {
      readonly type: 'catch';
      readonly offender: number;
      readonly queue: readonly number[];
      readonly selected: number;
    }
  | {
      readonly type: 'epoch';
      readonly epoch: number;
      readonly from: readonly { readonly deck: 'pile'; readonly pos: number }[];
      readonly purpose: 'mid' | 'round';
      readonly plan: Plan | null;
    }
  | { readonly type: 'grant'; readonly starter: number }
  | { readonly type: 'over' };

export type HollerEvent =
  | {
      readonly type: 'played';
      readonly seat: number;
      readonly pos: number;
      readonly card: number;
      readonly suit: Suit | null;
    }
  | { readonly type: 'drawn'; readonly seat: number; readonly count: number; readonly short: boolean }
  | { readonly type: 'covered'; readonly seat: number }
  | { readonly type: 'kept'; readonly seat: number; readonly pos: number }
  | { readonly type: 'named'; readonly seat: number; readonly suit: Suit }
  | { readonly type: 'accepted'; readonly seat: number }
  | { readonly type: 'challenged'; readonly seat: number }
  | { readonly type: 'answered'; readonly seat: number; readonly clean: boolean }
  | { readonly type: 'caught'; readonly seat: number }
  | { readonly type: 'passed'; readonly seat: number }
  | { readonly type: 'hollered'; readonly seat: number }
  | { readonly type: 'reshuffled'; readonly epoch: number; readonly size: number }
  | { readonly type: 'scored'; readonly seat: number; readonly points: number }
  | { readonly type: 'round'; readonly round: number; readonly starter: 'levy' | 'swing2' | null }
  | { readonly type: 'over' };

export interface HollerState {
  readonly game: 'holler';
  readonly rules: HollerRules;
  readonly seats: number;
  readonly mode: 'full' | 'view';
  readonly viewer: number | null;
  readonly direction: 1 | -1;
  readonly scores: readonly number[];
  readonly round: number;
  readonly epoch: number;
  readonly phase: Phase;
  readonly activeSuit: Suit | null;
  readonly hands: readonly (readonly Slot[])[];
  readonly draw: readonly number[];
  readonly discard: readonly PileCard[];
  readonly buried: readonly number[];
  readonly called: readonly boolean[];
  readonly resume: Resume | null;
  /** Full mode stores permutations. A view stores a null per epoch, with no holes. */
  readonly orders: readonly (readonly number[] | null)[];
  readonly dealt: readonly DealtPosition[];
}
