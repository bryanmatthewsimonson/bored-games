import type { Point as CurvePoint } from '@bored-games/deck';
import type { GameModule } from '@bored-games/game-kit';
import type { Hex, ParsedMove } from '@bored-games/protocol';
import type { LoggedAction } from '../audit.ts';
import type { DeckPartition } from '../partitioned-deck.ts';
import type { Phase } from '../types.ts';

/*
 * Types shared by the protocol 2 session's layers (build plan D-E): the game's fixed context, the held moves, the
 * fold at one head of a line, and a move's judgement at its prev.
 */

export type AnyModule = GameModule<unknown, { readonly type: string }, unknown>;

/** What never changes in a game: the module, its rules, the seats and their keys, the deck's shape. */
export interface GameCtx {
  readonly module: AnyModule;
  readonly rules: unknown;
  readonly rootId: Hex;
  readonly seats: number;
  /** The module's one deck id, or null for a deckless game. */
  readonly deckId: string | null;
  readonly deckSize: number;
  readonly partitions: readonly DeckPartition[];
  /** The shuffle steps that open every line: groups times seats with a deck, 0 without. */
  readonly shuffleSteps: number;
  /** Seat deck keys `X_k`. */
  readonly keys: readonly CurvePoint[];
  /** The seat whose private cards the view-mode state may learn, or null for a spectator. */
  readonly viewer: number | null;
}

/**
 * A held Move (PROTOCOL-v2 §5.1): it parsed and is signed by a seated session key, valid or not. `shape` is why it
 * can never be valid whatever its prev's state (a game action where a shuffle step belongs, a shuffle step by the
 * wrong seat, shares in a deckless game), or null.
 */
export interface HeldMove {
  readonly m: ParsedMove;
  readonly seat: number;
  readonly shape: string | null;
}

/**
 * The fold of a line at one head: the phase, the module's view-mode state, and how much of the line's interleaved
 * action log (`Line.log`) and module event list (`Line.events`) lie at or below this head.
 */
export interface LinePoint {
  /** The head: the root's id, or a move's. */
  readonly id: Hex;
  readonly seq: number;
  readonly phase: Exclude<Phase, 'done' | 'cancelled'>;
  /** The module state (frozen); null before the module is set up. */
  readonly state: unknown;
  readonly logLength: number;
  readonly eventsLength: number;
}

/** A line folded from the root: one point per head (`points[i]` at seq `i`), and its log and events. */
export interface Line {
  readonly points: readonly LinePoint[];
  readonly log: readonly LoggedAction[];
  readonly events: readonly unknown[];
}

/**
 * A move judged at its prev's point (PROTOCOL-v2 §5.1):
 * - `valid`: valid at its prev, with the state and module events applying it gives;
 * - `looking`: valid-looking but not valid: it waits (`final` false: owed shares not held yet) or never will be
 *   (`final` true: a shuffle proof that fails);
 * - `wait`: not valid-looking yet (a reveal whose other shares are not held);
 * - `invalid`: never valid-looking at its prev.
 */
export type Judgement =
  | { readonly kind: 'valid'; readonly state: unknown; readonly events: readonly unknown[] }
  | { readonly kind: 'looking'; readonly why: string; readonly final: boolean }
  | { readonly kind: 'wait'; readonly why: string }
  | { readonly kind: 'invalid'; readonly why: string };

/** The fork that ends a walk (PROTOCOL-v2 §5.2): at P, two or more valid-looking successors signed by E. */
export interface Fork {
  readonly at: Hex;
  readonly seq: number;
  readonly seat: number;
  /** Every valid-looking successor of P, ascending by id. */
  readonly successors: readonly Hex[];
}
