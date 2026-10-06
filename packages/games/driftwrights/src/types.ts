import type { Outcome } from '@bored-games/game-kit';
export type Goods = readonly [number, number, number, number, number];
export interface Venture {
  readonly pos: number;
  readonly card: number;
  readonly bought: number;
}
export interface Player {
  readonly goods: Goods;
  readonly ventures: readonly Venture[];
  readonly guides: number;
}
export type Stage =
  | 'starting-roll'
  | 'setup-hearth'
  | 'setup-link'
  | 'roll'
  | 'trade'
  | 'construct'
  | 'discard'
  | 'squall'
  | 'free-links'
  | 'trade-answer'
  | 'requisition'
  | 'chance'
  | 'over';
export type DecisionStage = Exclude<Stage, 'chance' | 'over'>;
export type Chance =
  | { readonly kind: 'dice'; readonly purpose: 'starter' | 'production'; readonly roller: number }
  | { readonly kind: 'theft'; readonly thief: number; readonly victim: number; readonly size: number };
export interface Offer {
  readonly from: number;
  readonly to: number;
  readonly give: Goods;
  readonly receive: Goods;
}
export interface State {
  /** Network views use -1 goods/card sentinels; reference games keep full information. */
  readonly networkMode?: boolean;
  readonly windfall?: 'available' | 'two';
  readonly publicCounts?: readonly number[];
  readonly requisition?: { readonly resource: number; readonly waiting: readonly number[] } | null;
  readonly seats: number;
  readonly players: readonly Player[];
  readonly bank: Goods;
  readonly terrain: readonly number[];
  readonly yields: readonly (number | null)[];
  readonly buildings: readonly ({ readonly seat: number; readonly hub: boolean } | null)[];
  readonly links: readonly (number | null)[];
  readonly squall: number;
  readonly ventureOrder: readonly number[];
  readonly ventureNext: number;
  readonly usedVentures: readonly { readonly seat: number; readonly pos: number; readonly card: number }[];
  readonly starter: number | null;
  readonly turn: number;
  readonly turnNo: number;
  readonly stage: Stage;
  readonly opening: readonly number[];
  readonly openingRolls: readonly { readonly seat: number; readonly total: number }[];
  readonly setupOrder: readonly number[];
  readonly setupStep: number;
  readonly setupSite: number | null;
  readonly actor: number;
  readonly resume: DecisionStage;
  readonly chance: Chance | null;
  readonly discards: readonly number[];
  readonly freeLinks: number;
  readonly actionPlayed: boolean;
  readonly offer: Offer | null;
  readonly span: number | null;
  readonly watch: number | null;
  readonly dice: readonly [number, number] | null;
  readonly result: Outcome | null;
}
/** Entropy completions are coordinator inputs, never signed player moves. */
export type EntropyAction =
  | { readonly type: 'dice'; readonly actor: 'entropy'; readonly faces: readonly [number, number] }
  | { readonly type: 'theft'; readonly actor: 'entropy'; readonly index: number };
export type Action =
  | { readonly type: 'requisition-payment'; readonly actor: number; readonly amount: number }
  | { readonly type: 'request-roll'; readonly actor: number }
  | { readonly type: 'hearth' | 'hub'; readonly actor: number; readonly site: number }
  | { readonly type: 'link'; readonly actor: number; readonly lane: number }
  | {
      readonly type: 'finish-trade' | 'end-turn' | 'buy-venture' | 'accept' | 'decline';
      readonly actor: number;
    }
  | { readonly type: 'bank'; readonly actor: number; readonly give: number; readonly receive: number }
  | {
      readonly type: 'offer';
      readonly actor: number;
      readonly to: number;
      readonly give: Goods;
      readonly receive: Goods;
    }
  | { readonly type: 'discard'; readonly actor: number; readonly goods: Goods }
  | {
      readonly type: 'move-squall';
      readonly actor: number;
      readonly island: number;
      readonly victim: number | null;
    }
  | {
      readonly type: 'play';
      readonly actor: number;
      readonly pos: number;
      readonly goods: Goods | null;
      readonly resource: number | null;
    };
export interface PublicPlayer {
  readonly count: number;
  readonly goods: Goods | null;
  readonly ventures: readonly {
    readonly pos: number;
    readonly card: number | null;
    readonly bought: number;
  }[];
  readonly guides: number;
}
export type View = Omit<State, 'players' | 'ventureOrder'> & {
  readonly players: readonly PublicPlayer[];
  readonly ventureOrder: null;
};
