/*
 * Hazard's state, actions and events (docs/games/hazard/RULES.md). Plain JSON: absent values are null, every number
 * an integer. Provinces are indexed in PROVINCES order (map.ts); charters are cards 0–43 of the deck `pile`.
 */
import type { DealtPosition, DiceRoll, Outcome } from '@bored-games/game-kit';
import type { ProvinceId } from './map.ts';

export interface HazardRules {
  /** `choose`: the defender picks one or two dice for each battle (the rulebook). `auto`: always the most allowed. */
  readonly defense: 'choose' | 'auto';
}

/**
 * Where the game stands. `order`: the first-player roll is to be started; `orderRoll` and `roll`: a roll is
 * collecting beacon shares; `reveal`: a cashed set is being turned face up; `shuffle`: cashed charters are being
 * reshuffled into a new pile.
 */
export type Stage =
  | 'order'
  | 'orderRoll'
  | 'claim'
  | 'place'
  | 'muster'
  | 'reveal'
  | 'attack'
  | 'defend'
  | 'roll'
  | 'advance'
  | 'shuffle'
  | 'march'
  | 'over';

/** A charter in a hand: its deck position, its card when this state knows it, and every seat that has held it. */
export interface Slot {
  readonly pos: number;
  readonly card: number | null;
  readonly holders: readonly number[];
}

export interface Battle {
  readonly from: ProvinceId;
  readonly to: ProvinceId;
  readonly attack: number;
  /** The defender's dice, or null while the defender is choosing. */
  readonly defend: number | null;
}

export interface Advance {
  readonly from: ProvinceId;
  readonly to: ProvinceId;
  readonly min: number;
  readonly max: number;
}

export interface Cashing {
  readonly seat: number;
  readonly positions: readonly number[];
  readonly bonus: ProvinceId | null;
}

export interface HazardState {
  readonly rules: HazardRules;
  readonly seats: number;
  /** True for the full state (fuzzing, the audit); false for a seat's or a spectator's view. */
  readonly full: boolean;
  /** The seat this view belongs to, or null (the full state, or a spectator). */
  readonly viewer: number | null;
  readonly stage: Stage;
  /** The seat whose turn it is (in `order`: the seat that starts the roll). */
  readonly turn: number;
  /** Who holds each province, in PROVINCES order, or null while it is unclaimed. */
  readonly owner: readonly (number | null)[];
  readonly troops: readonly number[];
  /** Starting troops each seat has yet to put on the map. */
  readonly reserve: readonly number[];
  /** The winner of the first-player roll: the first claimer, who takes the first turn. Null until it is known. */
  readonly first: number | null;
  /** The seats still in the first-player roll. */
  readonly tied: readonly number[];
  readonly rolls: readonly DiceRoll[];
  /** The open roll, or null. */
  readonly roll: number | null;
  /** The seats yet to add their share of the open roll, in order. */
  readonly contributors: readonly number[];
  /** Troops to muster this turn. */
  readonly pool: number;
  /** A muster after an elimination: cash until four charters or fewer, place, then attack on. */
  readonly midTurn: boolean;
  /** Whether this turn's two extra troops for a held province on a cashed charter have been taken. */
  readonly bonusUsed: boolean;
  /** Whether the turn seat has captured a province this turn. */
  readonly captured: boolean;
  readonly battle: Battle | null;
  /** The faces of the last battle, attacker's then defender's, each sorted high to low. Display only. */
  readonly dice: { readonly attack: readonly number[]; readonly defend: readonly number[] } | null;
  readonly advance: Advance | null;
  /** The seat whose province was just captured, until the move in (then checked for elimination). */
  readonly beaten: number | null;
  readonly hands: readonly (readonly Slot[])[];
  /** Positions still to be drawn, in draw order. */
  readonly pile: readonly number[];
  /** Cashed charters, face up, waiting for the next reshuffle. */
  readonly discard: readonly { readonly pos: number; readonly card: number }[];
  /** Reshuffles so far; the next one is `epoch + 1`. */
  readonly epoch: number;
  /** Sets cashed by anyone so far: the next set is worth `setValue(cashes)`. */
  readonly cashes: number;
  readonly cashing: Cashing | null;
  /** The cards of the set being cashed that are already face up. */
  readonly revealed: readonly { readonly pos: number; readonly card: number }[];
  /** Full mode only: every deck position's card (the opening order, then each reshuffle's). */
  readonly plain: Readonly<Record<string, number>> | null;
  /** Eliminated seats, first out first. */
  readonly out: readonly number[];
  /** Seats caught cashing a false set or bonus (only a cheating client can): they rank last. */
  readonly fouls: readonly number[];
  readonly dealt: readonly DealtPosition[];
  readonly result: Outcome | null;
}

export type HazardAction =
  | { readonly type: 'roll'; readonly actor: number }
  | { readonly type: 'contribute'; readonly actor: number; readonly id: number }
  | {
      readonly type: 'rolled';
      readonly actor: 'beacon';
      readonly id: number;
      readonly dice: readonly number[];
    }
  | { readonly type: 'claim'; readonly actor: number; readonly province: ProvinceId }
  | { readonly type: 'place'; readonly actor: number; readonly province: ProvinceId }
  | { readonly type: 'muster'; readonly actor: number; readonly province: ProvinceId; readonly count: number }
  | {
      readonly type: 'cash';
      readonly actor: number;
      readonly positions: readonly number[];
      readonly bonus: ProvinceId | null;
    }
  | {
      readonly type: 'reveal';
      readonly actor: 'deck';
      readonly deck: 'pile';
      readonly pos: number;
      readonly card: number;
    }
  | {
      readonly type: 'attack';
      readonly actor: number;
      readonly from: ProvinceId;
      readonly to: ProvinceId;
      readonly dice: number;
    }
  | { readonly type: 'defend'; readonly actor: number; readonly dice: number }
  | { readonly type: 'advance'; readonly actor: number; readonly count: number }
  | { readonly type: 'endAttack'; readonly actor: number }
  | {
      readonly type: 'march';
      readonly actor: number;
      readonly from: ProvinceId;
      readonly to: ProvinceId;
      readonly count: number;
    }
  | { readonly type: 'endTurn'; readonly actor: number }
  | { readonly type: 'epoch'; readonly actor: 'deck'; readonly epoch: number; readonly size: number };

export type HazardEvent =
  | { readonly type: 'first'; readonly seat: number; readonly faces: readonly number[] }
  | { readonly type: 'tie'; readonly seats: readonly number[]; readonly faces: readonly number[] }
  | { readonly type: 'claimed'; readonly seat: number; readonly province: ProvinceId }
  | { readonly type: 'placed'; readonly seat: number; readonly province: ProvinceId }
  | { readonly type: 'turn'; readonly seat: number; readonly troops: number }
  | {
      readonly type: 'mustered';
      readonly seat: number;
      readonly province: ProvinceId;
      readonly count: number;
    }
  | { readonly type: 'cashing'; readonly seat: number }
  | {
      readonly type: 'cashed';
      readonly seat: number;
      readonly cards: readonly number[];
      readonly troops: number;
      readonly bonus: ProvinceId | null;
      readonly foul: boolean;
    }
  | {
      readonly type: 'attacked';
      readonly seat: number;
      readonly from: ProvinceId;
      readonly to: ProvinceId;
      readonly dice: number;
    }
  | { readonly type: 'defended'; readonly seat: number; readonly dice: number }
  | {
      readonly type: 'battle';
      readonly seat: number;
      readonly from: ProvinceId;
      readonly to: ProvinceId;
      readonly attack: readonly number[];
      readonly defend: readonly number[];
      readonly lost: readonly [number, number];
    }
  | { readonly type: 'captured'; readonly seat: number; readonly from: ProvinceId; readonly to: ProvinceId }
  | { readonly type: 'advanced'; readonly seat: number; readonly to: ProvinceId; readonly count: number }
  | { readonly type: 'eliminated'; readonly seat: number; readonly by: number; readonly charters: number }
  | { readonly type: 'drew'; readonly seat: number }
  | { readonly type: 'reshuffled'; readonly epoch: number; readonly size: number }
  | {
      readonly type: 'marched';
      readonly seat: number;
      readonly from: ProvinceId;
      readonly to: ProvinceId;
      readonly count: number;
    }
  | { readonly type: 'ended'; readonly seat: number }
  | { readonly type: 'won'; readonly seat: number };
