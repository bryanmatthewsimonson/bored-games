import type { DealtPosition, Outcome } from '@bored-games/game-kit';
import type { DeckId, TierDeck } from './data.ts';

export interface LusterRules {
  readonly target: 15;
}
export interface CardSlot {
  readonly deck: TierDeck;
  readonly pos: number;
  readonly card: number | null;
  readonly private: boolean;
}
export interface LusterPlayer {
  readonly tokens: readonly number[];
  readonly bought: readonly CardSlot[];
  readonly reserved: readonly CardSlot[];
  readonly patrons: readonly number[];
}
export interface LusterState {
  readonly game: 'luster';
  readonly rules: LusterRules;
  readonly seats: number;
  readonly mode: 'full' | 'view';
  readonly viewer: number | null;
  readonly decks: Readonly<
    Record<DeckId, { readonly order: readonly number[] | null; readonly next: number }>
  >;
  readonly dealt: readonly DealtPosition[];
  readonly market: readonly (readonly (CardSlot | null)[])[];
  readonly patrons: readonly { readonly pos: number; readonly card: number | null }[];
  readonly players: readonly LusterPlayer[];
  readonly supply: readonly number[];
  /** Chosen from public setup reveals; null while the draw is unresolved. */
  readonly startingSeat: number | null;
  readonly turn: number;
  readonly round: number;
  readonly phase: 'turn' | 'return' | 'patron' | 'over';
  readonly finalRound: boolean;
  readonly result: Outcome | null;
  readonly seq: number;
}
export type LusterAction =
  | {
      readonly type: 'reveal';
      readonly actor: 'deck';
      readonly deck: DeckId;
      readonly pos: number;
      readonly card: number;
    }
  | { readonly type: 'take'; readonly actor: number; readonly tokens: readonly number[] }
  | { readonly type: 'reserve'; readonly actor: number; readonly deck: TierDeck; readonly pos: number }
  | {
      readonly type: 'buy';
      readonly actor: number;
      readonly deck: TierDeck;
      readonly pos: number;
      readonly card: number;
      readonly pay: readonly number[];
    }
  | { readonly type: 'return'; readonly actor: number; readonly tokens: readonly number[] }
  | { readonly type: 'patron'; readonly actor: number; readonly card: number }
  | { readonly type: 'pass'; readonly actor: number };
export type LusterEvent = { readonly type: 'acted'; readonly action: LusterAction };
