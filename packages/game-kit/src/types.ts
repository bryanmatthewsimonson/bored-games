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

/**
 * A protocol version a module version can run under (PROTOCOL-v2 §2 item 6, §10): 1 is `docs/PROTOCOL.md`, 2 is
 * `docs/PROTOCOL-v2.md`. On the wire it is the `["proto", "1" | "2"]` tag.
 */
export type ProtocolVersion = 1 | 2;

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
  /** Explicit release-policy opt-in; defaults off. Currently authorized for Luster only. */
  readonly promptShares?: boolean;
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
  /**
   * A dice roll whose faces are fixed but not yet derived. `id` is the roll. Production applies the `rolled`
   * action once every seat's beacon share for `id` is in (D058). The fuzzer supplies the faces itself.
   */
  | { readonly type: 'beacon'; readonly id: number }
  | { readonly type: 'over' };

/**
 * One committed dice roll under protocol 1 (D058, PROTOCOL §6.3a). `id` is never reused. `last` is the seat whose
 * contribution is published last, and who therefore can learn the faces first.
 */
export interface DiceRoll {
  readonly id: number;
  readonly last: number;
}

/**
 * One roll under protocol 2 (PROTOCOL-v2 §6.2, §10): `id` is never reused; the session derives `count` faces in
 * `1..sides` from every seat's contribution. `count` is a safe integer from 1 to 64 and `sides` one from 2 to 256,
 * the range `faces` draws (`isRollEntry`).
 */
export interface RollEntry {
  readonly id: number;
  readonly count: number;
  readonly sides: number;
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
   * ending branch holds only by the freeze (`fork`). Absent otherwise. `stop` is the protocol 2 equivocator whose
   * fork stopped the game (PROTOCOL-v2 §5.6): a session-internal value, never attested (§7.4), so never on the wire.
   */
  readonly endedBy?: { readonly type: 'resign' | 'fork' | 'stop'; readonly seat: Seat };
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
  /**
   * The protocol versions this module version runs under (PROTOCOL-v2 §2 item 6, §10). Absent means `[1]`; read it
   * with `moduleProtocols`. A Table or root at a protocol its (id, version) does not list is rejected.
   */
  readonly protocols?: readonly ProtocolVersion[];

  defaultRules(): R;
  validateRules(rules: unknown): Result<R>;
  seatRange(rules: R): { readonly min: number; readonly max: number };
  decks(rules: R): readonly DeckSpec[];

  setup(input: SetupInput<R>): Result<S>;
  pending(state: S): Pending;
  /**
   * Every legal action for `seat`. Exact whenever the seat's hidden cards are
   * known to `state` (always in full mode). It must return [] whenever the
   * legality of any action it would list depends on hidden cards the seat has
   * not learned, so a non-empty list is always exact: a live client offers a
   * decision as soon as the list is non-empty (D030).
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
  /**
   * Append-only dice commitments, present only on a game that rolls with the beacon (D058). The list never
   * drops an entry. Absent on a game that does not roll. Under protocol 1 the entries are `DiceRoll`s; a module
   * version that runs under protocol 2 lists `RollEntry`s (`isRollEntry`), which only a game action appends,
   * and pends `{type: 'beacon', id}` for a new entry before any player decision that should not see it
   * (PROTOCOL-v2 §10).
   */
  rolls?(state: S): readonly (DiceRoll | RollEntry)[];
  /**
   * The roll id `action` must carry exactly one beacon share for, or null when the action carries none.
   * Absent on a game that does not roll. Never throws. Protocol 1 only: v2 sessions do not use it (PROTOCOL-v2
   * §10).
   */
  beaconOf?(state: S, action: unknown): number | null;
  /**
   * What the end of a game makes public (PROTOCOL-v2 §10): `'reveal'` (the default when absent) when every card is
   * public at the end and the audit runs, `'none'` otherwise. `'none'` requires PROTOCOL-v2 §9.5, which is not
   * built: a guard test fails while any registered module declares it.
   */
  audit?(rules: R): 'reveal' | 'none';
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
