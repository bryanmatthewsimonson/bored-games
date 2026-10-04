import type { GameModule, Pending } from '@bored-games/game-kit';
import type { Hex, NostrEvent, Outcome } from '@bored-games/protocol';

/** This client's seat and the secrets it plays with: its session signing key and its deck secret `x`. */
export interface Identity {
  seat: number;
  sessionSk: Uint8Array;
  deckSecret: bigint;
}

/** Everything a session starts from: the rules modules, the signed lobby events and who is watching. */
export interface SessionInput {
  // biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
  modules: ReadonlyMap<string, GameModule<any, any, any>>;
  table: NostrEvent;
  joins: readonly NostrEvent[];
  root: NostrEvent;
  /** The seat this client plays, or null for a spectator. */
  me: Identity | null;
  /**
   * When this client first saw the root, by its local clock (Unix seconds): the floor of the progress time P
   * (D030 Ruling 10). A client that reloads passes the time it saved, not the time it reloaded.
   */
  rootSeenAt: number;
  /**
   * Protocol 2 only (PROTOCOL-v2 §8.1, review N2): the Timeout claims this seat's player confirmed as its own
   * forfeit before its own deadline, by id, so a reload keeps the confirmation. Ignored by the v1 session.
   */
  confirmedForfeits?: readonly Hex[];
}

/** `cancelled`: a timeout claim was accepted before the first game action (D030 R5); there is no result. */
export type Phase = 'shuffle' | 'deal' | 'play' | 'end' | 'done' | 'cancelled';

/**
 * What `receive` did with an event:
 * - `accepted`: it was folded in (and anything it unblocked with it)
 * - `stored`: it is well formed and waits for events it depends on
 * - `duplicate`: it was seen before, or it adds nothing new
 * - `rejected`: it is invalid for this game; `reason` says why.
 */
export type ReceiveResult =
  | { status: 'accepted' | 'stored' | 'duplicate' }
  | { status: 'rejected'; reason: string };

/**
 * What this seat must publish next (protocol 1; the protocol 2 kinds are documented on their members):
 * - `shuffle`, `deal`, `decide`: `buildShuffle`, `buildDeal`, `buildAction` (with one of `legalActions()`).
 * - `share`: `buildShares` supplies public reveals during play and new non-owner layers in grouped decks; it never shares an owner's private layer.
 * - `beacon`: `buildBeacon` publishes this seat's share of a public dice roll. Every seat decides on the same
 *   faces, so an open app sends the share with no decision. It is not a card share and not a sealed choice.
 * - `secret`: the game is over and my deck secret is not in yet; `buildSecret`.
 * - `attest`: the game is done with an audit and my attestation is not accepted yet (in protocol 2, the stats
 *   attestation, PROTOCOL-v2 §7.4). Attesting is a SHOULD
 *   (PROTOCOL §7), so the duty is advisory. Attestations are signed by the seat's npub, which the session does not
 *   hold: `attestTemplate` returns the unsigned event for the caller's identity signer.
 *
 * Each signed event is published by the caller and fed back through `receive`; the builders do not apply it.
 */
export type Duty =
  | { kind: 'shuffle' }
  | { kind: 'deal' }
  | { kind: 'share'; readonly positions: readonly number[] }
  | { kind: 'beacon' }
  | { kind: 'decide' }
  | { kind: 'secret' }
  | { kind: 'attest' }
  /**
   * Protocol 2 (PROTOCOL-v2 §6.1): a prompt release of this seat's shares of `positions`, anchored on `anchor`
   * (the head), with `buildRelease`.
   */
  | { kind: 'release'; readonly positions: readonly number[]; readonly anchor: Hex }
  /**
   * Protocol 2 (PROTOCOL-v2 §6.2): this seat's contributions to the rolls `indices` of requesting move `move`,
   * anchored on `anchor` (the head), with `buildRoll`.
   */
  | { kind: 'roll'; readonly move: Hex; readonly indices: readonly number[]; readonly anchor: Hex }
  /**
   * Protocol 2 (PROTOCOL-v2 §7.1): the end attestation of this client's result, signed by the session key with no
   * prompt, with `buildEndAttest`. Due until one of this seat's end attestations of that result is held.
   */
  | { kind: 'end' };

export type SessionAudit = 'pending' | 'pass' | { fail: number[]; reason: string };

/** A snapshot of the session. Every field is a copy or frozen. */
export interface SessionView {
  phase: Phase;
  rootId: Hex;
  seats: number;
  /**
   * The shuffle steps that open the chain (PROTOCOL §6.1): groups times seats in a game with a deck, 0 in a deckless
   * game (D045). The first game action is move `shuffleSteps + 1`.
   */
  shuffleSteps: number;
  mySeat: number | null;
  /** The last accepted move, or the root (seq 0) before the first. */
  head: { id: Hex; seq: number };
  /** The module state as `mySeat` (or a spectator) sees it; null until the shuffle is complete. */
  state: unknown;
  pending: Pending;
  /**
   * The progress time P (D030 Rulings 10–11): the latest time, by this client's local clock, that it first saw
   * the root, a move on the canonical chain, or a Shares event or secret that removed a seat from the stall set at
   * the head. The deadline runs from it; no `created_at` counts.
   */
  pendingSince: number;
  /**
   * The result: null until the game is done, and for a cancelled game. The declared outcome once the audit passes
   * and nobody equivocated; otherwise ranked with the forfeiting seats last and the others in their declared order
   * (D030 R5), with reason `forfeit`. A timeout during play ends the game at once: the seats stalled at the head
   * are last and the others are ranked by the module's `standings`.
   */
  outcome: Outcome | null;
  /**
   * Seats that forfeit (PROTOCOL §8.2): the equivocators, every seat stalled at the head when a timeout claim was
   * accepted (whichever seat it named; at the end, the seats that withheld their secret), the seats whose resign
   * ended the game, and, once the game is done, the seats the audit failed.
   */
  forfeits: number[];
  /**
   * Seats whose Resign (PROTOCOL §4.9, D045) ended the game: they forfeit, last, and the outcome's reason is
   * `resign` (the game is cancelled before the first game action). Empty when no resign counts, including when the
   * chain reached the module's `over` regardless (a finished game stands).
   */
  resigned: number[];
  /**
   * Seats whose counted Resign was outranked by the game's own end, reached at the resign's scoring position (a
   * mate or a declared end there, PROTOCOL §8.3, D052): the rules result stands, rated as usual. Empty otherwise.
   */
  resignOverridden: number[];
  /** The id of the Resign that counted on this client (ended, cancelled or outranked the game), or null. */
  resignId: Hex | null;
  /**
   * Seats flagged for equivocation (D030 R2, Ruling 5): two distinct moves on one prev of the chain, both valid as
   * of that prev. The game goes on; at the end they move to the last places.
   */
  equivocators: number[];
  /**
   * The R6 audit; `pending` until every secret is in. When a timeout ends the game (D030 Ruling 7) the audit cannot
   * run, and it records the forfeiting seats instead: `{fail: forfeits, reason: 'timeout'}` during play, or
   * `{fail: forfeits, reason: 'withheld secret'}` at the end. A resign ends the game the same way, with
   * `{fail: forfeits, reason: 'resign'}` (D045). A cancelled game stays `pending`.
   */
  audit: SessionAudit;
  /**
   * The hash of the canonical chain's move ids. After a Resign that ended the game the attested result covers the
   * chain only up to the resign's scoring position (PROTOCOL §8.3, D052): see `resultLogHash`.
   */
  logHash: Hex;
  /** The log hash the result attests: `logHash`, or after a Resign the chain's up to its scoring position. */
  resultLogHash: Hex;
  /** The game's move deadline in seconds, from the root. */
  deadline: number;
  /** The seats whose Result attestation matches this session's audit, logHash and outcome, ascending. */
  attested: number[];
  /**
   * The module's events from every `apply` and `learn` on the canonical chain, in fold order: the last 300, for a
   * game log. Rebuilt when the chain switches branch.
   */
  events: readonly unknown[];
}

/** A result's identity (PROTOCOL-v2 §5.3): its kind, its head, and its forfeiting seats, ascending. */
export interface ResultId {
  kind: 'over' | 'claim' | 'resign';
  head: Hex;
  forfeit: number[];
}

/**
 * The view of a protocol 2 session (PROTOCOL-v2 §5–§7): every `SessionView` field, read as v2 defines it, plus the
 * fork stop, the result's identity and the end attestations. `equivocators` holds the seats recorded as
 * equivocators (review M1). While a fork is held and no result stands, no seat is stalled (§5.7) and `pendingSince`
 * is the root's first-seen time, so that it is the same in every arrival order of the same events.
 *
 * **Ratings: read `gameRecord(view).rated`, never `outcome.unrated`** (review of T10, I2). A stop of 3 or more seats
 * is rated for the seats in the shared last places (the equivocators and the seats a proven audit failure demoted)
 * and unrated for the others (§5.6, §7.5). `Outcome.unrated` is one flag for the whole result, so it cannot say
 * that: a stop's outcome carries neither `unrated` nor `endedBy` (a stop is never attested, V2-38, so the outcome
 * never reaches the wire). A deck stop's record can also still change while it is "audit incomplete" (a demotion
 * lands once the last secret arrives), so a consumer stores it again whenever it changes.
 */
export interface SessionViewV2 extends SessionView {
  proto: 2;
  /**
   * The fork that ends the walk (PROTOCOL-v2 §5.1, §5.2): the move or root `at` (P) with two or more valid-looking
   * successors, all signed by `seat` (E), and their ids, ascending (the certificate); null while the walk holds none.
   */
  fork: { at: Hex; seat: number; certificate: Hex[] } | null;
  /** The game's result's identity (PROTOCOL-v2 §5.5), or null (live, cancelled, or stopped). */
  result: ResultId | null;
  /** Whether `result` stands against a held fork (PROTOCOL-v2 §5.4). */
  stood: boolean;
  /** The stop at the fork (PROTOCOL-v2 §5.6), or null; `cancelled` when nothing was played at or past P. */
  stop: { at: Hex; seat: number; cancelled: boolean } | null;
  /** Seats recorded as "secret withheld" after a stop (PROTOCOL-v2 §7.3), ascending. */
  secretWithheld: number[];
  /** A stop whose partial audit cannot run for want of a secret (PROTOCOL-v2 §7.3, review N3). */
  auditIncomplete: boolean;
  /** The seats that signed a valid end attestation of `result`, with either key, ascending (PROTOCOL-v2 §4.3). */
  endAttested: number[];
  /** The seats that owe a public reveal or a roll contribution at the head, ascending (PROTOCOL-v2 §6.4). */
  owed: { reveal: number[]; roll: number[] };
  /** A Timeout claim that forfeits only this seat, awaiting its player's answer (PROTOCOL-v2 §8.1, N2), or null. */
  ownForfeit: { claim: Hex } | null;
}
