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
  /** Optional contiguous groups shuffled independently; their sizes sum to `size`. */
  readonly partitions?: readonly { readonly id: string; readonly size: number }[];
  /**
   * Optional second shuffle round (D076, PROTOCOL §5.5): groups of positions that every seat shuffles together,
   * after every seat has shuffled every first-round group (the `partitions`, or the whole deck). The groups may
   * mix cards of different partitions. A position outside every group keeps a card of its own partition, so its
   * kind stays public while the kinds of the mixed positions do not.
   *
   * Valid only if: it holds 1 to 16 groups; every `id` is a non-empty string, distinct from the others and from
   * every partition id; every group's `positions` are safe integers in `[0, size)`, strictly ascending, at least
   * 2 of them; and the groups share no position. The session refuses a deck that is not valid. Each group's
   * proof domain is `<deck id>/<group id>`. `packetOrder` draws a deck order the rounds can produce and
   * `packetOrderFits` says whether an order is one.
   */
  readonly secondRound?: readonly { readonly id: string; readonly positions: readonly number[] }[];
  /** Explicit release-policy opt-in; defaults off. Authorized per game in the owner decision log. */
  readonly promptShares?: boolean;
}

/**
 * A card identity at a deck position, known privately by one viewer. `deck` may also be `SHOW_DECK`: a private
 * show's card (D077, PROTOCOL §14), whose `pos` is then the show's id, not a deck position.
 */
export interface Learn {
  readonly deck: string;
  readonly pos: number;
  readonly card: number;
}

/**
 * The pseudo-deck of a private show's learn (D077, PROTOCOL §14): `{deck: SHOW_DECK, pos: <show id>, card}`. It is
 * never a real deck's id.
 */
export const SHOW_DECK = 'shown';

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
  /**
   * A dice roll whose faces are fixed but not yet derived. `id` is the roll. Production applies the `rolled`
   * action once every seat's beacon share for `id` is in (D058). The fuzzer supplies the faces itself.
   */
  | { readonly type: 'beacon'; readonly id: number }
  | { readonly type: 'over' };

/**
 * One committed dice roll (D058). `id` is never reused. `last` is the seat whose contribution is published last,
 * and who therefore can learn the faces first.
 */
export interface DiceRoll {
  readonly id: number;
  readonly last: number;
}

export interface Outcome {
  /** 1-based finishing place per seat; tied seats share a place (1, 1, 3). */
  readonly places: readonly number[];
  readonly scores: readonly number[];
  readonly reason: string;
  /**
   * Set only by the platform, never by a module: the result does not count toward ratings (a Resign ended a game of
   * 3 or more seats, PROTOCOL §8.3, D052; or the end holds only because a deck secret froze its fork, §6.6, D056).
   * Absent otherwise.
   */
  readonly unrated?: true;
  /**
   * Set only by the platform, with `unrated`: the seat whose Resign ended the game (`resign`), or the forker whose
   * ending branch holds only by the freeze (`fork`). Absent otherwise.
   */
  readonly endedBy?: { readonly type: 'resign' | 'fork'; readonly seat: Seat };
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

/** A private, uniformly selected member of the sender's hand, delivered to sender and recipient. */
export interface PrivateSelection {
  readonly id: number;
  readonly from: Seat;
  readonly to: Seat;
  readonly index: number;
  /** Sorted labels, one per card. Null when this viewer cannot see the sender's hand. */
  readonly labels: readonly number[] | null;
}

/**
 * A private show (D077, PROTOCOL §14): seat `from` is deciding whether to show seat `to` one card it holds, and
 * nobody else may learn the card or its deck position. `id` names the show; a module never reuses it.
 */
export interface PrivateShow {
  readonly id: number;
  readonly from: Seat;
  readonly to: Seat;
}

export interface GameModule<S, E extends { readonly type: string }, R> {
  /** Permanent internal id; appears in network events. Never user-facing. */
  readonly id: string;
  /** Engine semver; a game is pinned to the engine version it started on. */
  readonly version: string;

  /** Parameterized forms may validate a canonical owned intent beyond the finite choice list. */
  validateIntent?(state: S, seat: Seat, action: unknown): Result<unknown>;
  /** Optional private transfer, fixed by a completed public random selection. */
  privateSelection?(state: S): PrivateSelection | null;
  /**
   * Optional private show (D077, PROTOCOL §14): non-null while seat `from` is deciding whether to show seat `to` a
   * card. Meanwhile:
   * - `legalActions(state, from)` holds a marker `{type: 'show', actor: from, pos}` for each deck position `from`
   *   holds and may show (and any other answers the rules allow). The type `show` is reserved for this: a legal
   *   action of type `show` with a `pos` key is a marker.
   * - The session turns the chosen marker into the wire `{type: 'show', actor: from, id, packet}`, exactly those
   *   keys, whose packet only `from` and `to` can open. `apply` accepts only the wire, never a marker, and
   *   `revealsOf` of the wire is `[]`.
   * - After the wire's `apply`, the session calls `learn` with `{deck: SHOW_DECK, pos: id, card}` in the views of
   *   `from` and `to`, and the audit in full mode, where the module checks that the card may be shown and is held.
   * The module's duties: `view` keeps a shown card only for `from` and `to`, `knownTo` never lists it, and `dealt`
   * does not change when a card is shown.
   */
  privateShow?(state: S): PrivateShow | null;
  /** Optional dice shape; legacy games use two six-sided dice. */
  rollShape?(state: S): { readonly count: number; readonly sides: number };
  defaultRules(): R;
  validateRules(rules: unknown): Result<R>;
  seatRange(rules: R): { readonly min: number; readonly max: number };
  decks(rules: R): readonly DeckSpec[];

  setup(input: SetupInput<R>): Result<S>;
  pending(state: S): Pending;
  /**
   * Legal finite choices for `seat`; parameterized forms may add choices through validateIntent.
   * Exact whenever the seat's hidden cards are known to `state` (always in full mode), except private
   * delivery markers that the session materializes before apply: a private selection's `transfer`, and the
   * `show` markers `{type: 'show', actor, pos}` it may list while `privateShow` is set (D077). It must return []
   * whenever the legality of any action it would list depends on hidden cards the seat has
   * not learned, so a non-empty list is always exact: a live client offers a
   * decision as soon as the list is non-empty (D030).
   */
  legalActions(state: S, seat: Seat): readonly unknown[];
  /** Validates and applies any input. Never throws, never mutates `state`. */
  apply(state: S, action: unknown): ApplyResult<S, E>;
  /**
   * Records a privately learned card (view mode). A private selection's card and a private show's
   * (`SHOW_DECK`, D077) are also learned in full mode, as the audit learns them.
   */
  learn(state: S, learn: Learn): ApplyResult<S, E>;
  /**
   * Everything `seat` privately knows in a full state, as learn records. Never a `SHOW_DECK` learn: the session
   * delivers a shown card itself, after the show's `apply` (D077).
   */
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
   * mode and in every view of the same log (PROTOCOL §6.1, §6.2). A private
   * position may be assigned again, to another seat once its holder has given
   * the card back (its first holder then seals its share to each later holder
   * and never publishes it while the card stays private, D066) or to the public;
   * a public position is never assigned again.
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
  /**
   * Append-only dice commitments, present only on a game that rolls with the beacon (D058). The list never
   * drops an entry. Absent on a game that does not roll.
   */
  rolls?(state: S): readonly DiceRoll[];
  /**
   * The roll id `action` must carry exactly one beacon share for, or null when the action carries none.
   * Absent on a game that does not roll. Never throws.
   */
  beaconOf?(state: S, action: unknown): number | null;
  /**
   * Whether a seat may resign a game with these rules and seats (PROTOCOL §4.9, D052). Absent means yes. A game
   * whose hidden cards the resigner's published deck secret would expose to others (a co-op game, or one where
   * a seat cannot see its own cards, such as Hanabi) returns false: the platform then rejects every Resign. The
   * platform also refuses Resign in every 2-seat game with a deck, whatever this says.
   */
  resignAllowed?(rules: R, seats: number): boolean;
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
