/*
 * The Current Affairs state, actions and events (docs/games/current-affairs/RULES.md). Plain JSON: money and fuel are
 * integers, absent values are null. The station stack is an encrypted deck (`stations`): only a full state knows its
 * order (`plain`); every view learns a station when it is turned up by a public reveal.
 */
import type { DealtPosition, DiceRoll, Outcome } from '@bored-games/game-kit';

export interface CurrentRules {
  readonly rulesVersion: 1;
}

export interface Company {
  readonly money: number;
  /** The cities it has wired, in the order it wired them. */
  readonly cities: readonly number[];
  /** The stations it owns, ascending. */
  readonly stations: readonly number[];
  /** The fuel stored on its stations, `[coal, oil, waste, uranium]`; it may move between them at any time (C13). */
  readonly fuel: readonly number[];
}

/** The round's phases (C04): the order is fixed between the phases, so it has no phase of its own. */
export type Phase = 'opening' | 'auction' | 'fuel' | 'build' | 'power' | 'over';

/** An auction under way (C06–C08). */
export interface Lot {
  readonly station: number;
  readonly bid: number;
  /** The highest bidder. */
  readonly leader: number;
  /** The seat that put the station up. */
  readonly opener: number;
  /** Seats still in this auction, the leader included. */
  readonly active: readonly number[];
  /** The seat whose bid or fold is awaited. */
  readonly turn: number;
}

/**
 * The stack (C03, C19, C21, C23), as deck positions of the deck `pile` (a card id is an index into DECK_STATIONS):
 * `next` holds the positions still to be drawn before the Era III card, position 0 (the green 13) first, then the
 * shuffled stations; `out` the positions taken out unseen at setup, never drawn; while `eraCard`, the Era III card
 * comes next; `under` holds the stations laid under the stack at paydays, with their positions, in the order they
 * were laid. When the Era III card comes up, what lies under it is reshuffled by a deck epoch (`shuffling` until the
 * epoch is in); then `next` holds the epoch's positions and `shuffled` is true.
 */
export interface Stack {
  readonly next: readonly number[];
  readonly out: readonly number[];
  readonly eraCard: boolean;
  readonly under: readonly { readonly pos: number; readonly station: number }[];
  readonly shuffling: boolean;
  readonly shuffled: boolean;
}

/** What an open roll decides: the opening order (the stations come from the deck). */
export type RollPurpose = 'order';

export interface OpenRoll {
  readonly id: number;
  readonly purpose: RollPurpose;
  readonly count: number;
  readonly sides: number;
}

/** Where play resumes once the market is settled after a draw (engine `resume`). */
export type After = 'auction' | 'auctionEnd' | 'build' | 'buildEnd' | 'round';

/** One line of the public history the screen shows; the newest last, at most HISTORY_LIMIT. */
export type Entry =
  | { readonly kind: 'regions'; readonly regions: readonly number[] }
  | { readonly kind: 'order'; readonly order: readonly number[] }
  | { readonly kind: 'round'; readonly round: number }
  | { readonly kind: 'pass'; readonly seat: number }
  | { readonly kind: 'won'; readonly seat: number; readonly station: number; readonly price: number }
  | {
      readonly kind: 'scrap';
      readonly seat: number;
      readonly station: number;
      readonly lost: readonly number[];
    }
  | { readonly kind: 'drew'; readonly station: number | null }
  | { readonly kind: 'removed'; readonly station: number }
  | { readonly kind: 'under'; readonly station: number }
  | {
      readonly kind: 'fuel';
      readonly seat: number;
      readonly bought: readonly number[];
      readonly cost: number;
    }
  | { readonly kind: 'built'; readonly seat: number; readonly city: number; readonly cost: number }
  | { readonly kind: 'power'; readonly seat: number; readonly powered: number; readonly paid: number }
  | { readonly kind: 'era'; readonly era: number }
  | { readonly kind: 'shuffled'; readonly cards: number }
  | { readonly kind: 'restock'; readonly added: readonly number[] }
  | { readonly kind: 'end'; readonly powered: readonly number[] };

export interface CurrentState {
  readonly game: 'current-affairs';
  readonly rules: CurrentRules;
  readonly seats: number;
  /** The regions in play, ascending; empty until the first seat chooses them (C02). */
  readonly regions: readonly number[];
  /** 1-based; 0 during the opening. */
  readonly round: number;
  readonly era: 1 | 2 | 3;
  /** Era III begins at the next payday (the Era III card came up while wiring, C20). */
  readonly eraNext: boolean;
  readonly phase: Phase;
  /** The player order, first player first (C05). */
  readonly order: readonly number[];
  readonly companies: readonly Company[];
  /** Per city, the seats with a substation there, in the order they built. */
  readonly houses: readonly (readonly number[])[];
  /** The station market, ascending (C03). */
  readonly market: readonly number[];
  /** The Era III card lies at the end of the market (it came up in an auction, C20). */
  readonly eraCardShown: boolean;
  readonly stack: Stack;
  /** Stations out of the game, face up, in the order they left. */
  readonly gone: readonly number[];
  /** The fuel yard, `[coal, oil, waste, uranium]`: how many units lie on it (they fill the dearest spaces). */
  readonly yard: readonly number[];
  /** This round: seats that bought a station, or passed, in the auction (C06). */
  readonly auctionDone: readonly boolean[];
  /** How many stations were sold this round. */
  readonly sold: number;
  readonly lot: Lot | null;
  /** A company over its station limit, choosing one of its older stations to scrap (C09). */
  readonly scrapping: { readonly seat: number; readonly bought: number } | null;
  /** Replacement draws owed to the market. */
  readonly owed: number;
  /** The deck position being turned up, or null. */
  readonly reveal: number | null;
  /** Each drawn station's deck position, by station number (for the Era III reshuffle). */
  readonly posOf: Readonly<Record<string, number>>;
  /** Every deck position assigned so far, in order (all public). */
  readonly dealt: readonly DealtPosition[];
  /** Full mode only: the card id at each deck position; null in every view. */
  readonly plain: Readonly<Record<string, number>> | null;
  /** The seats still to act in the fuel, wiring or payday phase, the next first. */
  readonly queue: readonly number[];
  /** The open roll, if any. */
  readonly roll: OpenRoll | null;
  /** Seats that still owe a share of the open roll, the next first. */
  readonly contributors: readonly number[];
  readonly rolls: readonly DiceRoll[];
  /** Where play resumes after a draw. */
  readonly after: After | null;
  /** The seat whose move led to the current automatic steps (it contributes last to a roll). */
  readonly actor: number;
  readonly history: readonly Entry[];
  readonly result: Outcome | null;
}

export type CurrentAction =
  | { readonly type: 'contribute'; readonly actor: number; readonly id: number }
  | {
      readonly type: 'reveal';
      readonly actor: 'deck';
      readonly deck: string;
      readonly pos: number;
      readonly card: number;
    }
  | { readonly type: 'epoch'; readonly actor: 'deck'; readonly epoch: number; readonly size: number }
  | { readonly type: 'regions'; readonly actor: number; readonly regions: readonly number[] }
  | {
      readonly type: 'rolled';
      readonly actor: 'beacon';
      readonly id: number;
      readonly dice: readonly number[];
    }
  | { readonly type: 'open'; readonly actor: number; readonly station: number; readonly bid: number }
  | { readonly type: 'pass'; readonly actor: number }
  | { readonly type: 'bid'; readonly actor: number; readonly amount: number }
  | { readonly type: 'fold'; readonly actor: number }
  | {
      readonly type: 'scrap';
      readonly actor: number;
      readonly station: number;
      readonly keep: readonly number[];
    }
  | { readonly type: 'fuel'; readonly actor: number; readonly buy: readonly number[] }
  | { readonly type: 'build'; readonly actor: number; readonly city: number }
  | { readonly type: 'done'; readonly actor: number }
  | {
      readonly type: 'power';
      readonly actor: number;
      readonly stations: readonly number[];
      readonly hybridCoal: number;
    };

/** Events are the history entries each action added. */
export type CurrentEvent = {
  [K in Entry['kind']]: Extract<Entry, { kind: K }> & { readonly type: K };
}[Entry['kind']];
