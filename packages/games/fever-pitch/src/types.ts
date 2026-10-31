/*
 * The Fever Pitch state, actions and events (docs/games/fever-pitch/RULES.md). Plain JSON: counts are integers,
 * absent values are null. Every card is public once it is turned up; only a full state knows the deck's order
 * (`plain`). The deck `pile` holds the spread cards, the field cards, the surges and the role cards (engine.ts).
 */
import type { DealtPosition, Outcome } from '@bored-games/game-kit';

export interface FeverRules {
  readonly rulesVersion: 1;
  /** How many surge cards go into the field deck: 4 gentle, 5 standard, 6 brutal (C03). */
  readonly surges: 4 | 5 | 6;
}

/** One card of the spread deck, top first: its deck position, and its city once it has been turned up. */
export interface PileItem {
  readonly pos: number;
  readonly city: number | null;
}

/** A spent spread card: its city and the deck position it was turned up from (a restack shuffles that position). */
export interface Spent {
  readonly pos: number;
  readonly city: number;
}

/**
 * Where a turn stands. `actions`: the active seat acts. The others run on their own until a reveal, a reshuffle
 * or a decision is needed: `draw` (two field cards), `surge` (resolving the surges drawn), `spread` (the spread step).
 */
export type Phase = 'setup' | 'actions' | 'draw' | 'surge' | 'spread' | 'over';

/** The steps of one surge (C17): the rate rises, the bottom card strikes, a window for Herd Immunity, the restack. */
export type SurgeStep = 'rise' | 'strike' | 'immunity' | 'restack' | 'next';

/** What a pending reveal is for. */
export type RevealPurpose = 'setup' | 'draw' | 'strike' | 'spread' | 'warning';

export interface Reveal {
  /** The positions to turn up, in the order the rules draw them. */
  readonly positions: readonly number[];
  /** The cards turned up so far, by position. */
  readonly cards: Readonly<Record<string, number>>;
  readonly purpose: RevealPurpose;
  /** The seat that played Early Warning (purpose `warning`), else null. */
  readonly seat: number | null;
}

/** A relief window (C23): the seats still to be asked, the one asked first; `immunity` offers only Herd Immunity. */
export interface Window {
  readonly queue: readonly number[];
  readonly only: 'any' | 'immunity';
}

export type LossReason = 'spillovers' | 'cases' | 'deck';

export interface FeverState {
  readonly game: 'fever-pitch';
  readonly rules: FeverRules;
  readonly seats: number;
  readonly phase: Phase;
  /** The active seat. */
  readonly turn: number;
  /** Turns begun so far, 1-based once play starts. */
  readonly turnNo: number;
  /** Actions the active seat has left. */
  readonly actions: number;
  /** The Engineer's once-a-turn flight from a clinic is used this turn. */
  readonly flew: boolean;
  /** Each seat's role (an index into ROLES); -1 until the roles are turned up. */
  readonly roles: readonly number[];
  /** Each seat's hand of field cards (0–47 a city card, 48–52 a relief card), ascending. */
  readonly hands: readonly (readonly number[])[];
  /** The Archivist's stored relief card (48–52), per seat; null otherwise. */
  readonly stored: readonly (number | null)[];
  /** Each seat's pawn: the city it stands in. */
  readonly at: readonly number[];
  /** Cases per city, `[strain0, strain1, strain2, strain3]`, each 0–3. */
  readonly cases: readonly (readonly number[])[];
  /** The cities with a clinic, ascending. */
  readonly clinics: readonly number[];
  readonly cured: readonly boolean[];
  readonly stamped: readonly boolean[];
  /** Spillovers so far; the eighth loses (C21). */
  readonly spills: number;
  /** The spread-rate marker: an index into SPREAD_RATES. */
  readonly rate: number;
  /** The field deck still to draw: deck positions, top first. */
  readonly field: readonly number[];
  /** Field cards discarded, oldest first (city and relief cards; surges leave the game). */
  readonly discard: readonly number[];
  /** Field cards out of the game (the Archivist's played reliefs), oldest first. */
  readonly removed: readonly number[];
  /** Surge cards drawn so far. */
  readonly surgesDrawn: number;
  /** The spread deck, top first. */
  readonly pile: readonly PileItem[];
  /** The spent spread cards, oldest first. */
  readonly spent: readonly Spent[];
  /** Spread cards taken out of the game by Herd Immunity, oldest first. */
  readonly purged: readonly number[];
  /** Restacks so far; the next is `epoch + 1`. */
  readonly epoch: number;
  /** Surges drawn this turn and not yet resolved, the current one included. */
  readonly surges: number;
  readonly surgeStep: SurgeStep;
  /** The spread step: its window first, then the cards. `left` is null until the window has closed. */
  readonly spreadStep: 'window' | 'infect';
  readonly spreadLeft: number | null;
  /** Lull was played: the next spread step is skipped. */
  readonly quiet: boolean;
  readonly reveal: Reveal | null;
  /** The spent pile is being reshuffled as deck epoch `epoch + 1`. */
  readonly shuffling: boolean;
  readonly window: Window | null;
  /** The seat ordering the top `count` spread cards after Early Warning. */
  readonly arrange: { readonly seat: number; readonly count: number } | null;
  /** Every deck position assigned so far, in order (all public). */
  readonly dealt: readonly DealtPosition[];
  /** Full mode only: the card id at each deck position; null in every view. */
  readonly plain: Readonly<Record<string, number>> | null;
  readonly history: readonly Entry[];
  readonly result: Outcome | null;
}

/** One line of the public history the screen shows; the newest last, at most HISTORY_LIMIT. */
export type Entry =
  | { readonly kind: 'setup'; readonly roles: readonly number[]; readonly first: number }
  | { readonly kind: 'turn'; readonly seat: number; readonly turnNo: number }
  | {
      readonly kind: 'move';
      readonly seat: number;
      readonly pawn: number;
      readonly how: 'travel' | 'fly' | 'charter' | 'shuttle' | 'summon' | 'relocate' | 'medevac';
      readonly from: number;
      readonly to: number;
    }
  | { readonly kind: 'clinic'; readonly seat: number; readonly city: number; readonly moved: number | null }
  | {
      readonly kind: 'treat';
      readonly seat: number;
      readonly city: number;
      readonly strain: number;
      readonly removed: number;
    }
  | { readonly kind: 'cleared'; readonly city: number; readonly strain: number; readonly removed: number }
  | { readonly kind: 'handed'; readonly from: number; readonly to: number; readonly card: number }
  | { readonly kind: 'cure'; readonly seat: number; readonly strain: number }
  | { readonly kind: 'stamped'; readonly strain: number }
  | { readonly kind: 'retrieve'; readonly seat: number; readonly card: number }
  | { readonly kind: 'relief'; readonly seat: number; readonly card: number; readonly city: number | null }
  | {
      readonly kind: 'drew';
      readonly seat: number;
      readonly cards: readonly number[];
      readonly surges: number;
    }
  | { readonly kind: 'discard'; readonly seat: number; readonly card: number }
  | { readonly kind: 'rise'; readonly rate: number }
  | { readonly kind: 'strike'; readonly city: number; readonly placed: number }
  | { readonly kind: 'restack'; readonly cards: number }
  | { readonly kind: 'infect'; readonly city: number; readonly placed: number }
  | { readonly kind: 'blocked'; readonly city: number; readonly strain: number }
  | { readonly kind: 'spillover'; readonly city: number; readonly strain: number; readonly count: number }
  | { readonly kind: 'quiet' }
  | { readonly kind: 'arranged'; readonly seat: number; readonly cities: readonly number[] }
  | { readonly kind: 'pass'; readonly seat: number }
  | { readonly kind: 'won' }
  | { readonly kind: 'lost'; readonly reason: LossReason };

type Pawned = { readonly actor: number; readonly pawn: number; readonly to: number };

export type FeverAction =
  | {
      readonly type: 'reveal';
      readonly actor: 'deck';
      readonly deck: string;
      readonly pos: number;
      readonly card: number;
    }
  | { readonly type: 'epoch'; readonly actor: 'deck'; readonly epoch: number; readonly size: number }
  | ({ readonly type: 'travel' } & Pawned)
  | ({ readonly type: 'fly' } & Pawned)
  | ({ readonly type: 'charter' } & Pawned)
  | ({ readonly type: 'shuttle' } & Pawned)
  | ({ readonly type: 'summon' } & Pawned)
  | { readonly type: 'relocate'; readonly actor: number; readonly to: number; readonly card: number }
  | { readonly type: 'clinic'; readonly actor: number; readonly remove: number | null }
  | { readonly type: 'treat'; readonly actor: number; readonly strain: number }
  | { readonly type: 'give'; readonly actor: number; readonly to: number; readonly card: number }
  | { readonly type: 'take'; readonly actor: number; readonly from: number; readonly card: number }
  | { readonly type: 'cure'; readonly actor: number; readonly cards: readonly number[] }
  | { readonly type: 'retrieve'; readonly actor: number; readonly card: number }
  | { readonly type: 'end'; readonly actor: number }
  | { readonly type: 'discard'; readonly actor: number; readonly card: number }
  | { readonly type: 'pass'; readonly actor: number }
  | { readonly type: 'arrange'; readonly actor: number; readonly order: readonly number[] }
  | ({ readonly type: 'medevac' } & Pawned)
  | { readonly type: 'warning'; readonly actor: number }
  | { readonly type: 'permit'; readonly actor: number; readonly city: number; readonly remove: number | null }
  | { readonly type: 'lull'; readonly actor: number }
  | { readonly type: 'immunity'; readonly actor: number; readonly city: number };

/** Events are the history entries each action added. */
export type FeverEvent = {
  [K in Entry['kind']]: Extract<Entry, { kind: K }> & { readonly type: K };
}[Entry['kind']];
