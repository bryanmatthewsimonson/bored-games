/*
 * The Current Affairs state, actions and events (docs/games/current-affairs/RULES.md). Plain JSON: money and fuel are
 * integers, absent values are null. Nothing is hidden from any seat, so every view is the whole state.
 */
import type { DiceRoll, Outcome } from '@bored-games/game-kit';

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
 * The stack (C03, C19, C20): `top` holds the known cards on top (the green 13 at first); then `draws` cards drawn
 * evenly at random from `pool`, the stations shuffled at setup (the rest of the pool was taken out unseen); then,
 * while `eraCard`, the Era III card; then `under`, the stations laid under the stack, in the order they were laid.
 * Once Era III has shuffled the stack (`shuffled`), `under` is empty and `pool` holds what was under it, all of it
 * to be drawn (`draws` is its length).
 */
export interface Stack {
  readonly top: readonly number[];
  readonly pool: readonly number[];
  readonly draws: number;
  readonly eraCard: boolean;
  readonly under: readonly number[];
  readonly shuffled: boolean;
  /** The stations taken out unseen at setup, once Era III's shuffle has shown which they were; else empty. */
  readonly boxed: readonly number[];
}

/** What an open roll decides: the regions in play, the opening order, or a card drawn from the pool. */
export type RollPurpose = 'regions' | 'order' | 'draw';

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
  /** The regions in play, ascending; empty until the opening roll. */
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
