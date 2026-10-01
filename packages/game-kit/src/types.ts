/**
 * The contract every game on the platform implements.
 *
 * A game is a pure, deterministic state machine. The public move log (plus,
 * for a player's own view, the private cards that player has learned) fully
 * determines the state. Hidden cards are dealt as positions in a shared
 * shuffled deck; their identities are either known (full mode: fuzzing and
 * post-game audit) or learned privately / revealed publicly (view mode: a live
 * client). See docs/ARCHITECTURE.md.
 */

/** Zero-based seat index in turn order as fixed at game creation. */
export type Seat = number;

export interface EngineError {
  readonly code: string;
  readonly message: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: EngineError };

export type ApplyResult<S, E> =
  | { readonly ok: true; readonly state: S; readonly events: readonly E[] }
  | { readonly ok: false; readonly error: EngineError };

/** A shuffled deck shared by all players; cards are numbered 0..size-1 by the game. */
export interface DeckSpec {
  readonly id: string;
  readonly size: number;
}

/** A card identity at a deck position, known privately by one viewer. */
export interface Learn {
  readonly deck: string;
  readonly pos: number;
  readonly card: number;
}

/**
 * A deck position assigned so far. `to` is the seat that owns the card (it
 * learns it privately), or null for a public position, whose card is revealed
 * to everyone (a requested or completed reveal).
 */
export interface DealtPosition {
  readonly deck: string;
  readonly pos: number;
  readonly to: Seat | null;
}

/**
 * The standard public reveal action. The deck "actor" is not a person: in
 * production a reveal is backed by every player's decryption share; in tests
 * and audits it comes from the known deck order.
 */
export interface RevealAction {
  readonly type: 'reveal';
  readonly actor: 'deck';
  readonly deck: string;
  readonly pos: number;
  readonly card: number;
}

export type Pending =
  | { readonly type: 'player'; readonly seat: Seat; readonly decision: string }
  | { readonly type: 'reveal'; readonly deck: string; readonly positions: readonly number[] }
  | { readonly type: 'over' };

export interface Outcome {
  /** 1-based finishing place per seat; tied seats share a place (1, 1, 3). */
  readonly places: readonly number[];
  readonly scores: readonly number[];
  readonly reason: string;
}

export type SetupInput<R> =
  | {
      readonly rules: R;
      readonly seats: number;
      readonly mode: 'full';
      /** One shuffled order per deck id: deckOrders[id][pos] = card. */
      readonly deckOrders: Readonly<Record<string, readonly number[]>>;
    }
  | {
      readonly rules: R;
      readonly seats: number;
      readonly mode: 'view';
      /** The seat whose private cards this state may learn; null = spectator. */
      readonly viewer: Seat | null;
    };

export interface GameModule<S, E extends { readonly type: string }, R> {
  /** Permanent internal id; appears in network events. Never user-facing. */
  readonly id: string;
  /** Engine semver; a game is pinned to the engine version it started on. */
  readonly version: string;

  defaultRules(): R;
  validateRules(rules: unknown): Result<R>;
  seatRange(rules: R): { readonly min: number; readonly max: number };
  decks(rules: R): readonly DeckSpec[];

  setup(input: SetupInput<R>): Result<S>;
  pending(state: S): Pending;
  /**
   * Every legal action for `seat`. Exact whenever the seat's hidden cards are
   * known to `state` (always in full mode); otherwise may be empty.
   */
  legalActions(state: S, seat: Seat): readonly unknown[];
  /** Validates and applies any input. Never throws, never mutates `state`. */
  apply(state: S, action: unknown): ApplyResult<S, E>;
  /** Records a privately learned card (view mode). */
  learn(state: S, learn: Learn): ApplyResult<S, E>;
  /** Everything `seat` privately knows in a full state, as learn records. */
  knownTo(state: S, seat: Seat): readonly Learn[];
  /** Redacts a full state to what `viewer` may know (null = spectator). */
  view(state: S, viewer: Seat | null): S;
  outcome(state: S): Outcome | null;
  /**
   * Per-seat scores as if the game ended now, computed from public data only,
   * so every seat's view gives the same result. Equals `outcome(state).scores`
   * once the game is over. Ranks the remaining seats after a forfeit
   * (PROTOCOL §8.2).
   */
  standings(state: S): readonly number[];
  /**
   * Every deck position assigned so far, in assignment order. An entry never
   * changes or disappears, even after its card is played. Identical in full
   * mode and in every view of the same log (PROTOCOL §6.1, §6.2).
   */
  dealt(state: S): readonly DealtPosition[];
  /**
   * The hidden cards `action` would make public from its actor's hand, as the
   * action claims them. Empty for actions that reveal nothing and for
   * unparseable input; `apply` still decides legality. Never throws.
   */
  revealsOf(state: S, action: unknown): readonly Learn[];
  /** Human-readable invariant violations; empty when the state is sound. */
  invariants(state: S): readonly string[];
  /** Optional rare-event tags used by the fuzzer's coverage report. */
  coverage?(state: S, events: readonly E[]): readonly string[];
}

export type LogEntry =
  | { readonly kind: 'action'; readonly action: unknown }
  | { readonly kind: 'learn'; readonly learn: Learn };

/** The public record of a game. Hidden card identities never appear here. */
export interface GameLog<R> {
  readonly game: { readonly id: string; readonly version: string };
  readonly rules: R;
  readonly seats: number;
  readonly actions: readonly unknown[];
}
