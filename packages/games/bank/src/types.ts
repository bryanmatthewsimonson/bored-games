import type { BankRules } from './rules.ts';

/**
 * Which engine: `'v1'` is Bank 0.1.0, protocol 1 only (contributions are `contribute` turns, PROTOCOL §6.3a);
 * `'v2'` is Bank 0.2.0, protocol 2 only (a roll pends the beacon at once, PROTOCOL-v2 §6.2).
 */
export type BankVariant = 'v1' | 'v2';

/** `collect` is engine 0.1.0's only: engine 0.2.0 goes from a roll straight to `beacon`. */
export type BankPhase = 'call' | 'collect' | 'beacon' | 'over';

/** What a resolution did to the pot. */
export type DiceEffect = 'add' | 'seventy' | 'double' | 'bust';

/** How a round ended. */
export type RoundEnd = 'bust' | 'banks' | 'cap';

/**
 * One committed roll. Engine 0.1.0: `last` contributes last and can learn the faces first. Engine 0.2.0: `last` is
 * null, since contributions are unordered and any seat may be last (PROTOCOL-v2 §6.2).
 */
export interface RollScheduleEntry {
  readonly id: number;
  readonly last: number | null;
}

export type BankLog =
  | { readonly kind: 'round'; readonly round: number; readonly roller: number }
  | { readonly kind: 'bank'; readonly seat: number; readonly amount: number }
  | { readonly kind: 'stay'; readonly seat: number }
  | { readonly kind: 'roll'; readonly seat: number; readonly rollId: number }
  | { readonly kind: 'contribute'; readonly seat: number; readonly rollId: number }
  | {
      readonly kind: 'dice';
      readonly rollId: number;
      readonly dice: readonly [number, number];
      readonly effect: DiceEffect;
      readonly pot: number;
      readonly capped: boolean;
    };

/**
 * The whole game. Bank has no hidden cards, so every view is this state. Money is a safe integer. `round` is the
 * 0-based index of the round being played, or `rules.rounds` once the game is over.
 */
export interface BankState {
  readonly game: 'bank';
  readonly rules: BankRules;
  readonly seats: number;
  /** 0-based. Equals `rules.rounds` when `phase` is `over`. */
  readonly round: number;
  readonly pot: number;
  readonly scores: readonly number[];
  /** Still in this round: false once the seat has banked. */
  readonly inRound: readonly boolean[];
  readonly roller: number;
  /** Seats who chose Stay on this pot, sorted. The roller is never skipped for being here. */
  readonly passed: readonly number[];
  /** How many dice resolutions this round has had. The next one is safe while this is below 3. */
  readonly rolls: number;
  /** The next roll id. Equals `schedule.length`. */
  readonly nextRollId: number;
  readonly phase: BankPhase;
  /** Seats who still owe a contribution, in order. Empty outside `collect` (so always empty in engine 0.2.0). */
  readonly owe: readonly number[];
  /** The roll being collected or derived, or null in a call window and between rounds. */
  readonly openRoll: number | null;
  /** Every roll ever committed. Entries are never removed. */
  readonly schedule: readonly RollScheduleEntry[];
  /** What each seat banked this round, or null while they are still in. */
  readonly banked: readonly (number | null)[];
  readonly log: readonly BankLog[];
  /** The seat who took the last human action of the previous round, or null before any. */
  readonly lastActor: number | null;
  readonly endReason: 'score' | null;
}

export type BankEvent =
  | { readonly type: 'banked'; readonly seat: number; readonly amount: number; readonly shared: boolean }
  | { readonly type: 'stayed'; readonly seat: number }
  | { readonly type: 'committed'; readonly seat: number; readonly rollId: number }
  | { readonly type: 'contributed'; readonly seat: number; readonly rollId: number }
  | {
      readonly type: 'dice';
      readonly rollId: number;
      readonly dice: readonly [number, number];
      readonly effect: DiceEffect;
      readonly pot: number;
      readonly capped: boolean;
    }
  | { readonly type: 'round'; readonly round: number; readonly how: RoundEnd }
  | { readonly type: 'over' };
