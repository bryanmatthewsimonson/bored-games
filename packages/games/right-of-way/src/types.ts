import type { DealtPosition, Outcome } from '@bored-games/game-kit';

/** The base game has no options (RULES.md, "Rule options"). */
export interface RowRules {
  readonly map: 'ferrovia';
}

/** A packet position and its card (a packet card id), or null where this state does not know it. */
export interface Slot {
  readonly pos: number;
  readonly card: number | null;
}

/** A freight card in hand. `open` cards came from the yard, so everyone knows them; the rest are private. */
export interface HandCard extends Slot {
  readonly open: boolean;
}

export interface RowPlayer {
  readonly hand: readonly HandCard[];
  /** Kept charters, in the order kept. */
  readonly charters: readonly Slot[];
  /** Charters drawn and not yet kept or returned. */
  readonly offered: readonly Slot[];
  /** Charters this seat returned: it still knows them (a re-dealt one is known again at once). */
  readonly memory: readonly Slot[];
  readonly track: number;
  /** Route points scored so far (public). */
  readonly points: number;
}

/**
 * The freight draw pile. Group 0 is the freight deck itself; a spare group (1..) is a reshuffle: `members` is the
 * number of discards it stands for and `found` how many of them have been drawn. The pile holds
 * `members - found` cards (or, in group 0, `FREIGHT_SIZE - next`).
 */
export interface Pile {
  readonly group: number;
  /** The next unused packet position of the group. */
  readonly next: number;
  readonly members: number;
  readonly found: number;
}

/** A reshuffle: the spare group used and the discards it stands for, ascending (card v is `list[v]`). */
export interface Epoch {
  readonly group: number;
  readonly list: readonly number[];
}

export type RowPhase = 'setup' | 'keep' | 'turn' | 'draw' | 'sift' | 'charters' | 'reveal' | 'over';

export interface RowState {
  readonly game: 'right-of-way';
  readonly rules: RowRules;
  readonly seats: number;
  readonly mode: 'full' | 'view';
  readonly viewer: number | null;
  /** The whole packet order (full mode), else null. */
  readonly order: readonly number[] | null;
  readonly dealt: readonly DealtPosition[];
  /** Five face-up slots; null is an empty slot. A slot whose card is null is waiting for its public reveal. */
  readonly yard: readonly (Slot | null)[];
  /** Yard slots waiting for a card from the pile, in slot order. */
  readonly want: readonly number[];
  readonly pile: Pile;
  readonly epochs: readonly Epoch[];
  /** Discarded freight cards (freight ids 0–109), in discard order. */
  readonly discards: readonly number[];
  /** Charter positions in draw order: the unseen pile, then returned charters at the bottom. */
  readonly charterPile: readonly number[];
  /** Owner seat of each route side, or null. */
  readonly routes: readonly (readonly (number | null)[])[];
  readonly players: readonly RowPlayer[];
  readonly startingSeat: number | null;
  /** The seat to act in `turn`, `draw`, `sift` and `charters`; the seat keeping first charters in `keep`. */
  readonly turn: number;
  readonly phase: RowPhase;
  /** How many seats have kept their first charters (phase `keep`). */
  readonly kept: number;
  /** Freight cards taken this turn (0 or 1). */
  readonly drawn: number;
  /** The spare card being sifted (phase `sift`): its position, and its card where this state knows it. */
  readonly sift: Slot | null;
  /** Turns left in the final round, or null before it. */
  readonly finalTurns: number | null;
  /** Passes in a row. */
  readonly passes: number;
  /** Wipes in a row since the last player action. */
  readonly wipes: number;
  /** Held charter positions still to be revealed at the end, in order. */
  readonly endReveal: readonly number[];
  readonly result: Outcome | null;
  readonly seq: number;
}

export type RowAction =
  | {
      readonly type: 'reveal';
      readonly actor: 'deck';
      readonly deck: string;
      readonly pos: number;
      readonly card: number;
    }
  | { readonly type: 'take'; readonly actor: number; readonly slot: number }
  | { readonly type: 'blind'; readonly actor: number }
  | { readonly type: 'sift'; readonly actor: number; readonly card: number | null }
  | {
      readonly type: 'claim';
      readonly actor: number;
      readonly route: number;
      readonly side: number;
      /** The cards paid, as [position, card] pairs, ascending by position. */
      readonly pay: readonly (readonly [number, number])[];
    }
  | { readonly type: 'charters'; readonly actor: number }
  | { readonly type: 'keep'; readonly actor: number; readonly keep: readonly number[] }
  | { readonly type: 'pass'; readonly actor: number };

export type RowEvent = { readonly type: 'acted'; readonly action: RowAction };
