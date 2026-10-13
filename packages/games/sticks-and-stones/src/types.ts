/*
 * Sticks & Stones' state, actions and events (docs/games/sticks-and-stones/RULES.md). Plain JSON: absent values are
 * null, every number an integer. Goods are always `[wood, brick, stone, gold]`.
 */
import type { DealtPosition, DiceRoll, Outcome } from '@bored-games/game-kit';

export interface SticksRules {
  /**
   * How a second card of a culture symbol scores (RULES.md C27): `squared`, the publisher's ruling, makes the
   * duplicates a second set scored like the first; `ones` scores one point for each duplicate.
   */
  readonly duplicates: 'squared' | 'ones';
}

/** The places on the board a player can send people to. `card0` costs 1 good, `card3` 4. */
export const SPOTS = [
  'hunt',
  'wood',
  'brick',
  'stone',
  'gold',
  'tools',
  'hut',
  'field',
  'card0',
  'card1',
  'card2',
  'card3',
  'stack0',
  'stack1',
  'stack2',
  'stack3',
] as const;
export type Spot = (typeof SPOTS)[number];
/** The four gathering grounds, in good order. */
export const GROUNDS: readonly Spot[] = ['wood', 'brick', 'stone', 'gold'];
/** The village: the toolmaker, the hut and the field. */
export const VILLAGE: readonly Spot[] = ['tools', 'hut', 'field'];

/**
 * Where the game stands. `place` and `resolve` are the first two phases of a round; `roll`: a roll is collecting
 * beacon shares; `tools`: the roller decides which tools to add; `pick`: players take dice from a gift of the dice;
 * `feed`: a hungry player decides how to feed; `ending`: private cards are turned up for the final count.
 */
export type Stage = 'place' | 'resolve' | 'roll' | 'tools' | 'pick' | 'feed' | 'ending' | 'over';

/** A card face up in the display: its deck position, and its card once revealed. */
export interface Shown {
  readonly pos: number;
  readonly card: number | null;
}

/** A card drawn face down for its owner (the extra card): known to them, turned up at the end. */
export interface Hidden {
  readonly pos: number;
  readonly card: number | null;
  readonly open: boolean;
}

export interface Clan {
  /** People in the clan, 5–10. */
  readonly people: number;
  readonly food: number;
  readonly goods: readonly number[];
  /** The harvest track, 0–10. */
  readonly field: number;
  /** Tool tiles, at most three, each 1–4. */
  readonly tools: readonly number[];
  /** Which tool tiles were used this round. */
  readonly used: readonly boolean[];
  /** One-use tools not yet used, by value. */
  readonly spares: readonly number[];
  /** Unused "two goods of your choice" cards. */
  readonly choices: number;
  /** Discoveries taken from the display (public). */
  readonly cards: readonly number[];
  /** Discoveries drawn face down (the extra card). */
  readonly hidden: readonly Hidden[];
  /** Monuments built, as monument numbers 0–27. */
  readonly monuments: readonly number[];
  /** The score track: monuments, points from cards, and the hunger penalties. */
  readonly score: number;
}

/** A gathering waiting for its dice or for the roller's tools. */
export interface Gather {
  /** Where the dice come from: a spot, or a discovery's roll (`card`). */
  readonly spot: Spot | 'card';
  /** The good gathered, or -1 for food. */
  readonly good: number;
  /** How many dice. */
  readonly count: number;
  /** The faces, once rolled. */
  readonly dice: readonly number[] | null;
}

/** A gift of the dice being shared out. */
export interface Gift {
  /** The faces still to take (null while rolling). */
  readonly dice: readonly number[] | null;
  /** The seats still to take one, in order. */
  readonly order: readonly number[];
}

/** A monument stack: how many tiles were built from it, and its top tile once revealed. */
export interface Stack {
  readonly built: number;
  readonly top: number | null;
}

export interface SticksState {
  readonly rules: SticksRules;
  readonly seats: number;
  /** True for the full state (fuzzing, the audit); false for a seat's or a spectator's view. */
  readonly full: boolean;
  readonly viewer: number | null;
  /** The deck order (full state only): `order[pos]` is the card there. */
  readonly order: readonly number[] | null;
  readonly stage: Stage;
  readonly round: number;
  /** The round's first player, or null until the opening display is turned up. */
  readonly first: number | null;
  /** The seat whose decision it is (placing, resolving, feeding). */
  readonly turn: number;
  readonly clans: readonly Clan[];
  /** People each seat has not yet placed this round. */
  readonly home: readonly number[];
  /** People on each spot, per seat (`spots[spot][seat]`). */
  readonly spots: Readonly<Record<Spot, readonly number[]>>;
  /** The four display slots: slot i costs i + 1 goods. Null where a card was taken. */
  readonly display: readonly (Shown | null)[];
  /** The next discovery position to draw (0–36). */
  readonly next: number;
  /** One per player. */
  readonly stacks: readonly Stack[];
  readonly rolls: readonly DiceRoll[];
  readonly roll: number | null;
  readonly contributors: readonly number[];
  readonly gather: Gather | null;
  readonly gift: Gift | null;
  /** The seats still to feed this round, in order; the first is feeding now. */
  readonly feeding: readonly number[];
  /** The last dice rolled, for the screen. */
  readonly lastDice: { readonly seat: number; readonly dice: readonly number[] } | null;
  readonly dealt: readonly DealtPosition[];
  /** Why the game ended, once it has (the face-down cards may still be turning up). */
  readonly ended: 'pile' | 'monuments' | null;
  readonly result: Outcome | null;
}

type Pay = readonly number[];

export type SticksAction =
  | {
      readonly type: 'reveal';
      readonly actor: 'deck';
      readonly deck: string;
      readonly pos: number;
      readonly card: number;
    }
  | {
      readonly type: 'rolled';
      readonly actor: 'beacon';
      readonly id: number;
      readonly dice: readonly number[];
    }
  | { readonly type: 'contribute'; readonly actor: number; readonly id: number }
  | { readonly type: 'place'; readonly actor: number; readonly spot: Spot; readonly count: number }
  /** Resolve a gathering ground or a village spot. */
  | { readonly type: 'use'; readonly actor: number; readonly spot: Spot }
  | { readonly type: 'buy'; readonly actor: number; readonly slot: number; readonly pay: Pay }
  | { readonly type: 'build'; readonly actor: number; readonly stack: number; readonly pay: Pay }
  /** Take a person back from a card or a stack without buying. */
  | { readonly type: 'skip'; readonly actor: number; readonly spot: Spot }
  /** Add tools to a roll: tool tile indexes and spare (one-use) indexes, each ascending. */
  | {
      readonly type: 'tools';
      readonly actor: number;
      readonly tools: readonly number[];
      readonly spares: readonly number[];
    }
  | { readonly type: 'pick'; readonly actor: number; readonly face: number }
  /** Use a "two goods of your choice" card. */
  | { readonly type: 'choose'; readonly actor: number; readonly take: Pay }
  /** Feed the shortfall with goods, or `null`: go hungry (−10). */
  | { readonly type: 'feed'; readonly actor: number; readonly pay: Pay | null };

export type SticksEvent =
  | { readonly type: 'first'; readonly seat: number }
  | { readonly type: 'round'; readonly round: number; readonly first: number }
  | { readonly type: 'placed'; readonly seat: number; readonly spot: Spot; readonly count: number }
  | {
      readonly type: 'gathered';
      readonly seat: number;
      readonly spot: Spot | 'card';
      readonly good: number;
      readonly dice: readonly number[];
      readonly bonus: number;
      readonly amount: number;
    }
  | { readonly type: 'village'; readonly seat: number; readonly spot: Spot; readonly gained: boolean }
  | { readonly type: 'bought'; readonly seat: number; readonly card: number; readonly slot: number }
  | { readonly type: 'drew'; readonly seat: number; readonly pos: number }
  | { readonly type: 'built'; readonly seat: number; readonly monument: number; readonly points: number }
  | { readonly type: 'skipped'; readonly seat: number; readonly spot: Spot }
  | { readonly type: 'picked'; readonly seat: number; readonly face: number }
  | { readonly type: 'chose'; readonly seat: number; readonly take: readonly number[] }
  | {
      readonly type: 'fed';
      readonly seat: number;
      readonly food: number;
      readonly goods: number;
      readonly hungry: boolean;
    }
  | { readonly type: 'ended'; readonly reason: 'pile' | 'monuments' };
