import {
  type Ciphertext,
  cardTable,
  decryptPosition,
  G,
  initialDeck,
  jointKey,
  makeShare,
  ownShare,
  type Point,
  proveShuffle,
  type RandomBytes,
  type ShareCtx,
  type ShuffleCtx,
  shuffleDeck,
  verifyShare,
  verifyShuffle,
} from '@bored-games/deck';
import {
  canonicalJson,
  deepFreeze,
  type GameModule,
  type Outcome as ModuleOutcome,
  type Pending,
  type RevealAction,
} from '@bored-games/game-kit';
import {
  attestTemplate as attestEventTemplate,
  type EventTemplate,
  finalizeEvent,
  getPublicKey,
  type Hex,
  KIND,
  logHash,
  moveTemplate,
  type NostrEvent,
  type Outcome,
  type ParsedAttest,
  type ParsedJoin,
  type ParsedMove,
  type ParsedRoot,
  type ParsedSecret,
  type ParsedShares,
  type ParsedTimeout,
  type PosShare,
  ProtocolError,
  parseAttest,
  parseJoin,
  parseMove,
  parseRoot,
  parseSecret,
  parseShares,
  parseTable,
  parseTimeout,
  secretTemplate,
  sharesTemplate,
  timeoutTemplate,
  validateRoot,
} from '@bored-games/protocol';
import { auditGame, type LoggedAction, rankWithForfeits } from './audit.ts';
import { ClientError } from './errors.ts';
import { ShareStore } from './shares.ts';
import type {
  Duty,
  Identity,
  Phase,
  ReceiveResult,
  SessionAudit,
  SessionInput,
  SessionView,
} from './types.ts';

/*
 * GameSession: a deterministic fold over one game's signed events (PROTOCOL §6–§7, D030). Events may arrive in any
 * order and more than once. Each one is parsed strictly, checked against the root's seats, and either folded in,
 * kept in a pool until what it depends on arrives, or rejected. After every event the pool is retried until nothing
 * more applies, so every client that holds the same events reaches the same state.
 *
 * The chain is chosen by fork choice (D030 Ruling 5): from the root, at each prev, the successor that heads the
 * longest valid branch, counted in accepted moves, with ties going to the lowest event id. A late rival on an old
 * prev is shorter than the main chain and never displaces it. Two distinct game actions by one seat on the same
 * (prev, seq), both valid as of that prev, flag the seat as an equivocator; so do two distinct well-formed shuffle
 * steps by the step's seat on the chain's prev, proofs or not (Ruling 12). Play goes on, and at the end the
 * flagged seats move to the last places (R5).
 *
 * Shuffle candidates (D030 Ruling 12): when one seat holds more than `MAX_SHUFFLE_CANDIDATES` well-formed steps on
 * one prev, only those acknowledged by another seat (a move it signed lies 1 to `MAX_ACK_DEPTH` moves below) take
 * part in fork choice. The others stay pooled and unverified. Both conditions are functions of the event set alone,
 * so every client holding the same events has the same candidates.
 *
 * Timeouts (D030 R4–R5 and Rulings 10–11, PROTOCOL §8) are judged by local receipt time. `receive(ev, now)`
 * records `now` as the time this client first saw `ev`, and the game's progress time P is the latest first-seen
 * time over the root, the canonical chain's moves, and the Shares events and secrets that removed a seat from the
 * stall set at the head. No event's `created_at` plays any part. A Timeout claim is accepted when it names the
 * current head and a seat stalled there (the seat it names is a shape check only), its signer is not stalled
 * there itself, and the local clock has reached P + deadline. Its effect does not depend on which claim it is:
 * every seat stalled at the head forfeits, and the outcome is final for this client, so the fold stops there for
 * good (the game is cancelled before the first game action, ends at once by forfeit during play, or ends with the
 * withheld secrets failed).
 */

type AnyModule = GameModule<unknown, { readonly type: string }, unknown>;

/** The outcome of trying to fold one event: folded, not yet (keep it pooled), or a rejection reason. */
type Fold = 'accepted' | 'wait' | { reject: string };

/**
 * A game action checked against a state on everything but R1: the state it leads to and the module's events, not
 * yet, or why not.
 */
type Checked = { next: unknown; events: readonly unknown[] } | 'wait' | { reject: string };

/** A Timeout claim judged now: decisive, not yet (its head is unknown, or the deadline has not passed), or why not. */
type Claimed = 'valid' | 'wait' | 'early' | { reject: string };

/** The module events `view().events` keeps. */
const MAX_EVENTS = 300;

/** The Timeout claims kept per signer per head, the lowest ids (D030 Ruling 8); more are ignored. */
const MAX_CLAIMS = 4;

/** The Timeout claims kept per signer that name a head not on the chain; more are rejected until some link. */
const MAX_UNKNOWN_CLAIMS = 8;

/**
 * Shuffle steps per `prev:seq:seat` group that are all fork-choice candidates (D030 Ruling 12). Past this, only
 * acknowledged steps are; the others stay pooled and unverified.
 */
const MAX_SHUFFLE_CANDIDATES = 3;

/** The cap on a pooled branch's counted depth, and on how far an insertion's change is passed up the pool. */
const MAX_DEPTH = 64;

/** How far below a shuffle step another seat's move acknowledges it (D030 Ruling 12), in moves along `prev`. */
const MAX_ACK_DEPTH = 32;

/** Audits kept by log hash, so a trial fold that relinks the same finished chain does not run it again. */
const MAX_AUDITS = 8;

/** A fork's best side branch, found by trial: its moves (lowest-id first among equals) and whether it ends the game. */
interface Branch {
  moves: ParsedMove[];
  over: boolean;
}

/** Whether branch `a` beats `b` (D030 Ruling 9): reaching `over` first, then length; ties keep `b`. */
const beats = (a: { over: boolean; length: number }, b: { over: boolean; length: number }): boolean =>
  a.over !== b.over ? a.over : a.length > b.length;

/** A move judged as of its prev (D030 R2 as refined by Ruling 3): valid, not known yet, or why it is invalid. */
type Judged = 'valid' | 'unknown' | { reject: string };

/** The fold's state at one head, for cutting the chain back to it. */
interface Snapshot {
  phase: Phase;
  state: unknown;
  logLength: number;
  learned: number[];
  events: readonly unknown[];
}

/** A well-formed Timeout claim from a seated session key, and the claiming seat. */
interface Claim {
  t: ParsedTimeout;
  claimant: number;
}

/** A well-formed move from a seated session key, kept as a possible equivocation rival. */
interface Candidate {
  m: ParsedMove;
  seat: number;
}

/** The accepted timeout: the claim that ended the game, the head it named, and the seats stalled there then. */
interface TimedOut {
  claim: Hex;
  head: Hex;
  seats: number[];
}

/** The session's result as the view reports it. */
interface Status {
  phase: Phase;
  outcome: Outcome | null;
  audit: SessionAudit;
  forfeits: number[];
}

const reject = (reason: string): { reject: string } => ({ reject: reason });

function message(e: unknown): string {
  try {
    if (e instanceof ProtocolError) return `${e.code}: ${e.message}`;
    if (e instanceof Error) return e.message;
  } catch {
    // fall through
  }
  return 'invalid event';
}

/** The `id` of an untrusted value when it looks like an event id (64 lowercase hex), or null. Never throws. */
function idOf(ev: unknown): Hex | null {
  try {
    if (typeof ev !== 'object' || ev === null) return null;
    const id: unknown = (ev as { id?: unknown }).id;
    return typeof id === 'string' && /^[0-9a-f]{64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** The `kind` of an untrusted value, or null. Never throws. */
function kindOf(ev: unknown): number | null {
  try {
    if (typeof ev !== 'object' || ev === null) return null;
    const kind: unknown = (ev as { kind?: unknown }).kind;
    return typeof kind === 'number' ? kind : null;
  } catch {
    return null;
  }
}

const byId = <T extends { id: Hex }>(xs: Iterable<T>): T[] => [...xs].sort((a, b) => (a.id < b.id ? -1 : 1));
const ascending = (xs: Iterable<number>): number[] => [...new Set(xs)].sort((a, b) => a - b);

export class GameSession {
  private readonly module: AnyModule;
  private readonly root: ParsedRoot;
  private readonly rules: unknown;
  private readonly deckId: string;
  private readonly deckSize: number;
  private readonly seats: number;
  /** Seat deck keys `X_k` and their sum, the joint key `X`. */
  private readonly keys: Point[];
  private readonly X: Point;
  private readonly seatOf: ReadonlyMap<Hex, number>;
  /** Each seat by its npub, which signs Result attestations (PROTOCOL §4.8). */
  private readonly npubSeat: ReadonlyMap<Hex, number>;
  private readonly me: Identity | null;
  /** Card points to card indices for the deck. */
  private readonly cards: ReadonlyMap<string, number>;

  private phase: Phase = 'shuffle';
  /** The canonical chain: accepted moves in `seq` order. */
  private readonly chain: ParsedMove[] = [];
  /** The root id and every move on the canonical chain. */
  private readonly linked = new Set<Hex>();
  /** `decks[k]` is the deck after `k` shuffle steps; `decks[0]` is the initial deck. */
  private readonly decks: Ciphertext[][];
  /** Shuffle proofs already checked, by event id, so each is verified once per session. */
  private readonly shuffleChecked = new Map<Hex, boolean>();
  /** The module state (frozen), set up in view mode once the shuffle is complete. */
  private state: unknown = null;
  /** When this client first saw the root (local clock): the floor of the progress time P. */
  private readonly rootSeenAt: number;
  /**
   * When this client first saw each authentic event of this game (D030 Ruling 10): the `now` of the first
   * `receive` that parsed it. Later copies leave it alone. It also marks the event as known, so a copy is answered
   * before it is parsed again.
   */
  private readonly seenAt = new Map<Hex, number>();
  /**
   * Verified shares from folded Shares events and from the chain's moves. Rebuilt from those two sources when the
   * chain is cut back (see `truncate`).
   */
  private shares: ShareStore;
  /** Shares events folded in, by id (including those that added nothing new), every share verified. */
  private readonly sharesSeen = new Map<Hex, ParsedShares>();
  /** Shares events that failed against the current final deck; they are tried again if that deck changes. */
  private readonly badShares = new Map<Hex, ParsedShares>();
  /**
   * `snapshots[i]` is the fold as it stood at head seq `i`, taken just before move `i + 1` was linked, so the chain
   * can be cut back to any accepted move.
   */
  private readonly snapshots: Snapshot[] = [];
  /** My positions already decrypted (or found undecryptable), so each is tried once. */
  private readonly learned = new Set<number>();
  /** Game actions and derived reveals in the order the fold applied them (D030 R6). */
  private readonly actionLog: LoggedAction[] = [];

  /** Every well-formed, unlinked move not known to be invalid, keyed by `prev`: waiting moves and side branches. */
  private readonly movesByPrev = new Map<Hex, Map<Hex, ParsedMove>>();
  /** Shares events that wait for the final deck. */
  private readonly waitingShares = new Map<Hex, ParsedShares>();
  private readonly rejected = new Map<Hex, string>();
  /** Game actions' share and reveal checks, by event id: null when every proof verifies, else the reason. */
  private readonly actionChecked = new Map<Hex, string | null>();

  /**
   * Every well-formed move (it parsed and passed `moveShape`), grouped by `prev:seq:seat`, as possible
   * equivocation rivals. Kept whatever their judgement.
   */
  private readonly candidates = new Map<string, Map<Hex, Candidate>>();
  /** Keys of `candidates` that hold two moves or more. */
  private readonly rivalKeys = new Set<string>();
  /** Every well-formed move by id: the same moves as `candidates`. */
  private readonly candidateById = new Map<Hex, Candidate>();
  /** The ids of the well-formed moves on each `prev`. */
  private readonly kidsOf = new Map<Hex, Set<Hex>>();
  /**
   * Shuffle steps acknowledged by another seat (D030 Ruling 12): some well-formed move it signed lies 1 to
   * `MAX_ACK_DEPTH` moves below along `prev`. Only grows.
   */
  private readonly acked = new Set<Hex>();
  /**
   * Bumped whenever a shuffle step's eligibility may change: a group passes `MAX_SHUFFLE_CANDIDATES`, or any shuffle
   * step is acknowledged (a superset, which only costs fork-memo misses). Fork verdicts are kept while it holds.
   */
  private shuffleVersion = 0;
  /**
   * Moves judged as of their prev, by id: true when valid on everything but R1, else the reason. A prev fixes its
   * whole ancestry, so a judgement never changes.
   */
  private readonly validity = new Map<Hex, true | string>();
  /** Equivocating seats on the canonical chain, ascending (D030 Ruling 5). */
  private flagged: number[] = [];
  /** Counts `receive` calls; a fork is re-examined at most once per call. */
  private generation = 0;
  /** The generation each fork point (a prev with side moves) was last examined in. */
  private readonly forkSeen = new Map<Hex, number>();
  /** Every pooled move by id. */
  private readonly pooledById = new Map<Hex, ParsedMove>();
  /**
   * Per id (a chain move or a pooled one), a counter bumped whenever the pool below it changes, passed up through
   * pooled ancestors (at most `MAX_DEPTH` steps, and not past a stuck move). A fork's verdict is kept until it moves.
   */
  private readonly poolVersion = new Map<Hex, number>();
  /**
   * Counts new shares from Shares events (a copy of a kept share is not new); whether a move can link depends on
   * it, and fork verdicts are kept while it holds.
   */
  private sharesVersion = 0;
  /** Fork trials run (`sideBest` without a kept verdict); a debug counter the tests read. */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: read by the tests through a cast.
  private trials = 0;
  /** Shuffle proofs verified (`shuffleChecked` misses); a debug counter the tests read. */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: read by the tests through a cast.
  private shuffleVerifications = 0;
  /** Side moves at a prev below the head found `unknown` there, by the `sharesVersion` they were judged at. */
  private readonly sideUnknown = new Map<Hex, number>();
  /** Pooled moves found unable to link at their prev yet (R1, or a missing reveal share), by `sharesVersion`. */
  private readonly stuck = new Map<Hex, number>();
  /** The best side branch per fork prev, found by trial, valid while the key (pool and shares versions) holds. */
  private readonly forkMemo = new Map<Hex, { key: string; ids: Hex[]; over: boolean }>();
  /** Above zero during trial folds, which skip private learns and the audit. */
  private trialDepth = 0;
  /** Above zero while a fork is examined: the pool ends as it started, so its versions are left alone. */
  private quiet = 0;
  /** Audit results by log hash. */
  private readonly auditCache = new Map<Hex, SessionAudit>();

  /** Verified deck secrets by seat. */
  private readonly secrets = new Map<number, bigint>();
  /**
   * The latest first-seen time of a Shares event or secret that removed a seat from the stall set at the head, or
   * let the chain advance (D030 Ruling 11): the part of P that is not a chain move.
   */
  private stallProgress = Number.NEGATIVE_INFINITY;
  /** Secret reveal events folded in, by id. */
  private readonly secretIds = new Set<Hex>();
  /** The R6 audit, run once every secret is in (phase `done`); `pending` until then. */
  private auditResult: SessionAudit = 'pending';
  /**
   * Each seat's attestation: its latest well-formed one by (`created_at`, id), with its canonical
   * `{audit, logHash, outcome}`. The seat is attested when that one matches this session's result.
   */
  private readonly attests = new Map<number, { id: Hex; content: string; at: number }>();
  /** Every attestation id received from a seated npub, kept or superseded. */
  private readonly attestIds = new Set<Hex>();

  /** The module's events on the canonical chain, the last `MAX_EVENTS`; frozen, replaced on every change. */
  private events: readonly unknown[] = Object.freeze([]);

  /**
   * Every well-formed Timeout claim from a seated key against another seat, by id, kept whatever its judgement:
   * the `MAX_CLAIMS` lowest ids per signer per head, and at most `MAX_UNKNOWN_CLAIMS` per signer naming heads not
   * on the chain. A claim is judged again whenever the fold or the clock changes.
   */
  private readonly claims = new Map<Hex, Claim>();
  /** Claim ids by the head they name. */
  private readonly claimsByHead = new Map<Hex, Set<Hex>>();
  /** The accepted timeout, or null. Once set it is final: the fold stops. */
  private timedOut: TimedOut | null = null;
  /** The latest local clock reading seen by `receive` or `tick`. */
  private clock = 0;

  private constructor(input: SessionInput, root: ParsedRoot, module: AnyModule, rules: unknown) {
    this.module = module;
    this.root = root;
    this.rules = rules;
    const decks = module.decks(rules);
    if (decks.length !== 1) throw new ClientError(`a session supports exactly one deck, not ${decks.length}`);
    const deck = decks[0] as { id: string; size: number };
    this.deckId = deck.id;
    this.deckSize = deck.size;
    this.seats = root.seats.length;
    this.keys = root.seats.map((s) => s.deckKey);
    this.X = jointKey(this.keys);
    this.seatOf = new Map(root.seats.map((s, i) => [s.session, i]));
    this.npubSeat = new Map(root.seats.map((s, i) => [s.npub, i]));
    this.me = input.me === null ? null : { ...input.me, sessionSk: input.me.sessionSk.slice() };
    this.decks = [initialDeck(this.deckId, this.deckSize)];
    this.cards = cardTable(this.deckId, this.deckSize);
    this.shares = new ShareStore(this.seats);
    this.linked.add(root.id);
    this.rootSeenAt = input.rootSeenAt;
    this.clock = input.rootSeenAt;
  }

  /**
   * A session for the game started by `input.root`. Throws `ClientError` when the table or root does not parse,
   * the root is not a valid start of the game (`validateRoot`), the module has other than one deck, or `me` does
   * not hold the seat it names. Joins that do not parse are ignored; `validateRoot` reports the ones it misses.
   */
  static create(input: SessionInput): GameSession {
    let table: ReturnType<typeof parseTable>;
    let root: ParsedRoot;
    try {
      table = parseTable(input.table);
      root = parseRoot(input.root);
    } catch (e) {
      throw new ClientError(`the table or root does not parse: ${message(e)}`);
    }
    const joins = new Map<Hex, ParsedJoin>();
    for (const ev of input.joins) {
      try {
        const j = parseJoin(ev);
        joins.set(j.id, j);
      } catch {
        // not a join; validateRoot reports any seat it leaves unknown
      }
    }
    const problems = validateRoot(root, table, joins, input.modules);
    if (problems.length > 0) throw new ClientError(`invalid game root: ${problems.join('; ')}`);
    const module = input.modules.get(root.game) as AnyModule;
    const rules = module.validateRules(root.rules);
    if (!rules.ok) throw new ClientError(`invalid rules: ${rules.error.message}`);

    const me = input.me;
    if (me !== null) {
      const seat = root.seats[me.seat];
      if (!Number.isSafeInteger(me.seat) || seat === undefined) throw new ClientError(`no seat ${me.seat}`);
      let session: Hex;
      let deckKey: Point;
      try {
        session = getPublicKey(me.sessionSk);
        deckKey = G.multiply(me.deckSecret);
      } catch {
        throw new ClientError('the identity holds an invalid session key or deck secret');
      }
      if (session !== seat.session) throw new ClientError(`the session key is not seat ${me.seat}'s`);
      if (!deckKey.equals(seat.deckKey)) throw new ClientError(`the deck secret is not seat ${me.seat}'s`);
    }

    if (typeof input.rootSeenAt !== 'number' || !Number.isFinite(input.rootSeenAt))
      throw new ClientError('rootSeenAt must be a finite number');
    return new GameSession(input, root, module, rules.value);
  }

  /* ------------------------------------------------------------------------------------------- intake */

  /**
   * Fold in one event from a peer (or this client's own, fed back). Never throws. `now` is the local clock, and
   * the time this client first saw `ev` (D030 Ruling 10): a client that reloads passes each event's saved
   * first-seen time, and feeding the events in first-seen order reproduces the session.
   */
  receive(ev: unknown, now: number): ReceiveResult {
    this.generation++;
    try {
      this.observe(now);
      // The deadline may have passed before this event arrived: judge the stored claims first.
      try {
        this.decideTimeouts();
      } catch {
        // A module that throws leaves the claims as they were; the event is still folded.
      }
      return this.intake(ev, this.clockOf(now));
    } catch (e) {
      return { status: 'rejected', reason: `internal error: ${message(e)}` };
    }
  }

  /** Re-check stored Timeout claims against the local clock `now`. Never throws. */
  tick(now: number): void {
    try {
      this.observe(now);
      this.decideTimeouts();
    } catch {
      // A module that throws leaves the claims as they were; the next event or tick tries again.
    }
  }

  /** Advance the session's clock to `now`; it never goes back. */
  private observe(now: number): void {
    if (typeof now === 'number' && Number.isFinite(now) && now > this.clock) this.clock = now;
  }

  /** `now` as a first-seen time: the clock itself when `now` is not a finite number. */
  private clockOf(now: number): number {
    return typeof now === 'number' && Number.isFinite(now) ? now : this.clock;
  }

  /** Record `id`'s first-seen time, unless it has one. */
  private see(id: Hex, now: number): void {
    if (!this.seenAt.has(id)) this.seenAt.set(id, now);
  }

  /** When this client first saw `id`; the clock for an event it never received (a test shortcut). */
  private seenOf(id: Hex): number {
    return this.seenAt.get(id) ?? this.clock;
  }

  private intake(ev: unknown, now: number): ReceiveResult {
    const kind = kindOf(ev);
    // A known event is answered before it is parsed: parsing (a shuffle step's deck above all) is the cost.
    const id = idOf(ev);
    if (id !== null) {
      const again = this.again(id);
      if (again !== null) return again;
    }
    if (kind === KIND.timeout) return this.intakeTimeout(ev);
    if (kind === KIND.reveal) return this.intakeSecret(ev, now);
    if (kind === KIND.attest) return this.intakeAttest(ev);
    let parsed: { kind: 'move'; m: ParsedMove } | { kind: 'shares'; s: ParsedShares };
    try {
      if (kind === KIND.move) parsed = { kind: 'move', m: parseMove(ev, this.deckSize) };
      else if (kind === KIND.shares) parsed = { kind: 'shares', s: parseShares(ev) };
      else return { status: 'rejected', reason: `kind ${String(kind)} is not an in-game event` };
    } catch (e) {
      return { status: 'rejected', reason: message(e) };
    }
    const p = parsed.kind === 'move' ? parsed.m : parsed.s;
    if (p.rootId !== this.root.id) return { status: 'rejected', reason: 'the event is for another game' };
    const seat = this.seatOf.get(p.pubkey);
    if (seat === undefined) return { status: 'rejected', reason: 'not signed by a seated session key' };
    this.see(p.id, now);
    if (parsed.kind === 'shares') return this.intakeShares(parsed.s, seat);
    return this.intakeMove(parsed.m, seat);
  }

  /**
   * The answer for an event this session already parsed (its id was authenticated then; a copy with the same id
   * is the same event): its rejection, a claim or attestation judged again, or `duplicate`. Null when unknown.
   */
  private again(id: Hex): ReceiveResult | null {
    const why = this.rejected.get(id);
    if (why !== undefined) return { status: 'rejected', reason: why };
    const claim = this.claims.get(id);
    if (claim !== undefined) return this.claimStatus(claim, false);
    if (this.attestIds.has(id)) return this.attestStatus(id, false);
    return this.seenAt.has(id) ? { status: 'duplicate' } : null;
  }

  /**
   * Keep a well-formed move as a possible rival under its `prev:seq:seat` key, and as a child of its prev, then
   * note the acknowledgements it completes. A shuffle group that passes `MAX_SHUFFLE_CANDIDATES` changes which of
   * its steps are candidates.
   */
  private addCandidate(m: ParsedMove, seat: number): void {
    const key = `${m.prevId}:${m.seq}:${seat}`;
    let group = this.candidates.get(key);
    if (group === undefined) {
      group = new Map();
      this.candidates.set(key, group);
    }
    group.set(m.id, { m, seat });
    if (group.size >= 2) this.rivalKeys.add(key);
    if (m.content.type === 'shuffle' && group.size === MAX_SHUFFLE_CANDIDATES + 1) this.shuffleVersion++;
    this.candidateById.set(m.id, { m, seat });
    let kids = this.kidsOf.get(m.prevId);
    if (kids === undefined) {
      kids = new Set();
      this.kidsOf.set(m.prevId, kids);
    }
    kids.add(m.id);
    this.noteAcks(m, seat);
  }

  /**
   * Mark the shuffle steps that well-formed move `m` (signed by `seat`) completes an acknowledgement for (D030
   * Ruling 12). An acknowledgement of step A is a path along `prev` from a move signed by a seat other than A's
   * up to A, 1 to `MAX_ACK_DEPTH` moves long, every move on it held. Any path `m` completes runs through `m`: walk
   * up from `m` (at most `MAX_ACK_DEPTH` ancestors) for unacknowledged steps, and down from it over the held
   * children for each signer's nearest distance. So the result is the same whether `m`'s descendants arrived
   * before or after it.
   */
  private noteAcks(m: ParsedMove, seat: number): void {
    const ups: { id: Hex; seat: number; d: number }[] = [];
    let at: Candidate | undefined = { m, seat };
    for (let d = 0; at !== undefined && d <= MAX_ACK_DEPTH; d++) {
      if (at.m.content.type === 'shuffle' && !this.acked.has(at.m.id))
        ups.push({ id: at.m.id, seat: at.seat, d });
      at = this.candidateById.get(at.m.prevId);
    }
    if (ups.length === 0) return;
    const reach = MAX_ACK_DEPTH - Math.min(...ups.map((u) => u.d));
    // Each signer's nearest distance below m (m itself at 0), breadth first; every move has one prev, so no move
    // is reached twice.
    const near = new Map<number, number>([[seat, 0]]);
    let level = [m.id];
    for (let depth = 1; depth <= reach && level.length > 0 && near.size < this.seats; depth++) {
      const next: Hex[] = [];
      for (const id of level) {
        for (const k of this.kidsOf.get(id) ?? []) {
          const kid = this.candidateById.get(k) as Candidate;
          if (!near.has(kid.seat)) near.set(kid.seat, depth);
          next.push(k);
        }
      }
      level = next;
    }
    for (const u of ups) {
      for (const [signer, depth] of near) {
        const dist = u.d + depth;
        if (signer === u.seat || dist < 1 || dist > MAX_ACK_DEPTH) continue;
        this.acked.add(u.id);
        this.shuffleVersion++;
        break;
      }
    }
  }

  /**
   * Whether well-formed move `m` is a fork-choice candidate (D030 Ruling 12): any game action; a shuffle step in
   * a `prev:seq:seat` group of at most `MAX_SHUFFLE_CANDIDATES` held steps; or an acknowledged one.
   */
  private shuffleEligible(m: ParsedMove): boolean {
    if (m.content.type !== 'shuffle') return true;
    if (this.acked.has(m.id)) return true;
    const group = this.candidates.get(`${m.prevId}:${m.seq}:${this.seatOf.get(m.pubkey) as number}`);
    return (group?.size ?? 0) <= MAX_SHUFFLE_CANDIDATES;
  }

  private rejectEvent(id: Hex, reason: string): ReceiveResult {
    this.rejected.set(id, reason);
    return { status: 'rejected', reason };
  }

  /**
   * Pool a move and settle. It is `accepted` when it ends up on the chain or proves an equivocation, `rejected`
   * when it is found invalid, and `stored` otherwise: it waits for its prev or its shares, or heads a side branch.
   */
  private intakeMove(m: ParsedMove, seat: number): ReceiveResult {
    const shape = this.moveShape(m, seat);
    if (shape !== null) return this.rejectEvent(m.id, shape);
    // Every well-formed move is a possible rival, and may acknowledge shuffle steps above it.
    const version = this.shuffleVersion;
    this.addCandidate(m, seat);
    if (this.shuffleEligible(m) && m.prevId !== this.headId() && this.linked.has(m.prevId)) {
      // A side branch on an older prev: if it is invalid there, it never will be valid. A step that is not a
      // candidate is not verified at all: it stays pooled.
      const v = this.validAtPrev(m, seat);
      if (typeof v === 'object') {
        const r = this.rejectEvent(m.id, v.reject);
        // A shuffle step flags its seat whatever its proof, and an acknowledgement changes the candidates: judge
        // the chain, the side moves and the flags again.
        if (m.content.type === 'shuffle' || this.shuffleVersion !== version) this.settleAndDecide();
        return r;
      }
    }
    const flagged = this.flagged.join();
    this.pool(m);
    // A move's first-seen time is recorded before it links, and P reads the chain: no progress to note.
    this.settleAndDecide();
    if (this.linked.has(m.id)) return { status: 'accepted' };
    const why = this.rejected.get(m.id);
    if (why !== undefined) return { status: 'rejected', reason: why };
    return this.flagged.join() !== flagged ? { status: 'accepted' } : { status: 'stored' };
  }

  /** Checks that hold whatever the state: the content type for its `seq`, and a shuffle step's signer. */
  private moveShape(m: ParsedMove, seat: number): string | null {
    if (m.seq <= this.seats) {
      if (m.content.type !== 'shuffle') return `move ${m.seq} must be a shuffle step`;
      if (seat !== m.seq - 1) return `shuffle step ${m.seq} must be signed by seat ${m.seq - 1}`;
    } else if (m.content.type !== 'action') {
      return `move ${m.seq} must be a game action`;
    }
    return null;
  }

  private pool(m: ParsedMove): void {
    let moves = this.movesByPrev.get(m.prevId);
    if (moves === undefined) {
      moves = new Map();
      this.movesByPrev.set(m.prevId, moves);
    }
    moves.set(m.id, m);
    this.pooledById.set(m.id, m);
    this.poolChanged(m.prevId);
  }

  private unpool(m: ParsedMove): void {
    const moves = this.movesByPrev.get(m.prevId);
    if (moves === undefined) return;
    moves.delete(m.id);
    this.pooledById.delete(m.id);
    if (moves.size === 0) this.movesByPrev.delete(m.prevId);
    this.poolChanged(m.prevId);
  }

  /**
   * Note that the pool below `id` changed: bump its version and its pooled ancestors', up to a chain move. A stuck
   * move stops the walk, since nothing below it can link; so does `MAX_DEPTH`. Trial folds put back what they move,
   * so they bump nothing.
   */
  private poolChanged(id: Hex): void {
    if (this.quiet > 0) return;
    let at = id;
    for (let i = 0; i < MAX_DEPTH; i++) {
      this.poolVersion.set(at, (this.poolVersion.get(at) ?? 0) + 1);
      if (this.linked.has(at)) return;
      const m = this.pooledById.get(at);
      if (m === undefined || this.isStuck(m.id)) return;
      at = m.prevId;
    }
  }

  /** Whether `id` was found unable to link at its prev with the shares held now. */
  private isStuck(id: Hex): boolean {
    return this.stuck.get(id) === this.sharesVersion;
  }

  /** Drop an invalid pooled move for good. A prev fixes the move's whole ancestry, so it never becomes valid. */
  private dropMove(m: ParsedMove, reason: string): void {
    this.unpool(m);
    this.rejected.set(m.id, reason);
  }

  private intakeShares(s: ParsedShares, seat: number): ReceiveResult {
    for (const { pos } of s.shares) {
      if (pos >= this.deckSize) return this.rejectEvent(s.id, `position ${pos} is outside the deck`);
    }
    if (this.timedOut !== null) {
      // A timeout ended the game: the fold no longer changes.
      this.waitingShares.set(s.id, s);
      return { status: 'stored' };
    }
    const before = this.stallMark();
    const r = this.foldShares(s, seat);
    if (r === 'wait') {
      this.waitingShares.set(s.id, s);
      return { status: 'stored' };
    }
    if (typeof r === 'object') {
      this.badShares.set(s.id, s);
      return this.rejectEvent(s.id, r.reject);
    }
    if (r === 'nothing-new') return { status: 'duplicate' };
    this.settle();
    // Progress first, then the claims: a claim must be judged against the P this event set (Ruling 11).
    this.noteProgress(before, s.id);
    this.decideTimeouts();
    return { status: 'accepted' };
  }

  /**
   * Fold a Secret reveal (PROTOCOL §4.7): signed by a seated session key, with `x·G = X_k` for that seat. A
   * secret that arrives before the game is over is kept (`stored`) and counts once it is. A second copy only
   * matters when it was seen earlier (a reload that feeds events out of first-seen order).
   */
  private intakeSecret(ev: unknown, now: number): ReceiveResult {
    let s: ParsedSecret;
    try {
      s = parseSecret(ev);
    } catch (e) {
      return { status: 'rejected', reason: message(e) };
    }
    if (s.rootId !== this.root.id) return { status: 'rejected', reason: 'the event is for another game' };
    const seat = this.seatOf.get(s.pubkey);
    if (seat === undefined) return { status: 'rejected', reason: 'not signed by a seated session key' };
    this.see(s.id, now);
    if (!this.secretMatches(seat, s.deckSecret)) {
      return this.rejectEvent(s.id, `the deck secret does not match seat ${seat}'s deck key`);
    }
    this.secretIds.add(s.id);
    // A timeout ended the game: the fold no longer changes.
    if (this.timedOut !== null) return { status: 'stored' };
    if (this.secrets.has(seat)) return { status: 'duplicate' };
    const before = this.stallMark();
    this.secrets.set(seat, s.deckSecret);
    this.settle();
    // Progress first, then the claims: a claim must be judged against the P this event set (Ruling 11).
    this.noteProgress(before, s.id);
    this.decideTimeouts();
    return this.phase === 'end' || this.phase === 'done' ? { status: 'accepted' } : { status: 'stored' };
  }

  private secretMatches(seat: number, x: bigint): boolean {
    try {
      return G.multiply(x).equals(this.keys[seat] as Point);
    } catch {
      // x = 0 has no point.
      return false;
    }
  }

  /**
   * Fold a Result attestation (PROTOCOL §4.8): signed by a seated npub, not a session key. Each seat's latest one
   * by (`created_at`, id) is kept, whatever the arrival order, and the seat is attested when it equals this
   * session's audit, logHash and outcome. Before this session has a result it is `stored`; one that does not match
   * is `rejected`, but kept, since the result may still change as events arrive. An older one is a `duplicate`.
   */
  private intakeAttest(ev: unknown): ReceiveResult {
    let a: ParsedAttest;
    try {
      a = parseAttest(ev);
    } catch (e) {
      return { status: 'rejected', reason: message(e) };
    }
    if (a.rootId !== this.root.id) return { status: 'rejected', reason: 'the event is for another game' };
    const seat = this.npubSeat.get(a.pubkey);
    if (seat === undefined) return { status: 'rejected', reason: 'not signed by a seated npub' };
    this.attestIds.add(a.id);
    const content = canonicalJson({ audit: a.audit, logHash: a.logHash, outcome: a.outcome });
    const held = this.attests.get(seat);
    if (held === undefined || a.createdAt > held.at || (a.createdAt === held.at && a.id > held.id)) {
      this.attests.set(seat, { id: a.id, content, at: a.createdAt });
    }
    return this.attestStatus(a.id, true);
  }

  /** How an attestation stands now: `fresh` on its first receipt. */
  private attestStatus(id: Hex, fresh: boolean): ReceiveResult {
    const kept = [...this.attests.values()].find((a) => a.id === id);
    if (kept === undefined) return { status: 'duplicate' };
    const mine = this.attestContent();
    if (mine === null) return { status: fresh ? 'stored' : 'duplicate' };
    if (kept.content !== mine) {
      return { status: 'rejected', reason: "the attestation does not match this session's result" };
    }
    return { status: fresh ? 'accepted' : 'duplicate' };
  }

  /**
   * Fold a Timeout claim (PROTOCOL §4.6, §8.1, D030 R4–R5, Rulings 8 and 10): signed by a seated session key,
   * naming another seat. It is `accepted` when it ends the game, `stored` while its head is unknown or the deadline
   * has not passed by the local clock, and `rejected` otherwise. A kept claim is judged again as events and the
   * clock move, so one rejected now may still count later.
   */
  private intakeTimeout(ev: unknown): ReceiveResult {
    let t: ParsedTimeout;
    try {
      t = parseTimeout(ev);
    } catch (e) {
      return { status: 'rejected', reason: message(e) };
    }
    if (t.rootId !== this.root.id) return { status: 'rejected', reason: 'the event is for another game' };
    const claimant = this.seatOf.get(t.pubkey);
    if (claimant === undefined) return { status: 'rejected', reason: 'not signed by a seated session key' };
    if (t.seat >= this.seats) return this.rejectEvent(t.id, `there is no seat ${t.seat}`);
    if (t.seat === claimant) return this.rejectEvent(t.id, 'a seat cannot claim a timeout against itself');
    if (this.timedOut !== null) {
      // The outcome is final; a claim on the same head agrees with it.
      return t.headId === this.timedOut.head
        ? { status: 'duplicate' }
        : { status: 'rejected', reason: 'a timeout has already ended the game' };
    }
    const full = this.keepClaim({ t, claimant });
    if (full !== null) return full;
    this.decideTimeouts();
    // decideTimeouts may have set it.
    if ((this.timedOut as TimedOut | null)?.claim === t.id) return { status: 'accepted' };
    return this.claimStatus(this.claims.get(t.id) as Claim, true);
  }

  /**
   * Keep a claim within the caps: per signer, the `MAX_CLAIMS` lowest ids per head (a lower id evicts the highest
   * kept, so the kept set does not depend on arrival order), and at most `MAX_UNKNOWN_CLAIMS` naming heads not on
   * the chain. Returns the rejection when the claim is not kept.
   */
  private keepClaim(c: Claim): ReceiveResult | null {
    const { t, claimant } = c;
    if (!this.linked.has(t.headId)) {
      let unknown = 0;
      for (const k of this.claims.values())
        if (k.claimant === claimant && !this.linked.has(k.t.headId)) unknown++;
      // Not recorded: once some of those heads link, the claim may be kept.
      if (unknown >= MAX_UNKNOWN_CLAIMS) return { status: 'rejected', reason: 'claim limit' };
    }
    let ids = this.claimsByHead.get(t.headId);
    if (ids === undefined) {
      ids = new Set();
      this.claimsByHead.set(t.headId, ids);
    }
    const mine = [...ids].filter((id) => this.claims.get(id)?.claimant === claimant).sort();
    if (mine.length >= MAX_CLAIMS) {
      const highest = mine[mine.length - 1] as Hex;
      if (t.id > highest) return this.rejectEvent(t.id, 'claim limit');
      this.claims.delete(highest);
      ids.delete(highest);
      this.rejected.set(highest, 'claim limit');
    }
    this.claims.set(t.id, c);
    ids.add(t.id);
    return null;
  }

  /** How a kept claim stands now: `fresh` on its first receipt. */
  private claimStatus(c: Claim, fresh: boolean): ReceiveResult {
    if (this.timedOut?.claim === c.t.id) return { status: 'duplicate' };
    const v = this.judgeClaim(c);
    if (typeof v === 'object') return { status: 'rejected', reason: v.reject };
    if (v === 'valid' || !fresh) return { status: 'duplicate' };
    return { status: 'stored' };
  }

  /**
   * A claim judged against the fold and the local clock (D030 R4, Rulings 10 and 11). Valid when all hold:
   * - its head is the current head;
   * - some seat is stalled there, and the claimant is not;
   * - the local clock has reached P + deadline (`progress`).
   * Its `created_at` plays no part, and the seat it names is a shape check only (a seat other than the claimant):
   * the effect is the same whichever seat it names.
   */
  private judgeClaim(c: Claim): Claimed {
    const t = c.t;
    if (!this.linked.has(t.headId)) return 'wait';
    if (t.headId !== this.headId()) return reject('the claim names an old head');
    const stalled = this.stalled();
    if (stalled.length === 0) return reject('no seat is stalled at the head');
    if (stalled.includes(c.claimant))
      return reject(`the claimant, seat ${c.claimant}, is stalled at the head`);
    if (this.clock < this.progress() + this.root.deadline) return 'early';
    return 'valid';
  }

  /**
   * Accept a timeout when some kept claim on the current head is valid (the lowest id is recorded, for the
   * receive status only): every seat stalled at the head forfeits, whichever seat the claim names. Final: once set,
   * the fold stops.
   */
  private decideTimeouts(): void {
    if (this.timedOut !== null) return;
    const head = this.headId();
    const ids = this.claimsByHead.get(head);
    if (ids === undefined) return;
    for (const id of [...ids].sort()) {
      if (this.judgeClaim(this.claims.get(id) as Claim) === 'valid') {
        this.timedOut = { claim: id, head, seats: this.stalled() };
        return;
      }
    }
  }

  /* --------------------------------------------------------------------------------------------- fold */

  private headId(): Hex {
    return this.idAt(this.chain.length);
  }

  /** The id of the chain's move at `seq` (the root for 0). */
  private idAt(seq: number): Hex {
    return seq === 0 ? this.root.id : (this.chain[seq - 1] as ParsedMove).id;
  }

  /** Fold a move whose `prev` is the head. */
  private foldMove(m: ParsedMove, seat: number): Fold {
    if (m.seq !== this.chain.length + 1) return reject(`seq ${m.seq} does not follow the head`);
    const c = m.content;
    if (c.type === 'shuffle') {
      const step = m.seq - 1;
      if (seat !== step) return reject(`shuffle step ${m.seq} must be signed by seat ${step}`);
      if (!this.shuffleVerifies(m.id, step, c.deck, c.proof))
        return reject('the shuffle proof does not verify');
      this.decks.push(c.deck);
      this.link(m);
      if (m.seq === this.seats) this.startDeal();
      return 'accepted';
    }
    return this.foldAction(m, seat, c);
  }

  /**
   * Fold a game action whose `prev` is the head (PROTOCOL §6.5, D030 R1): it must pass `checkAction` at the head,
   * and the signer's owed shares must all be present. A move that lacks only shares other events may still bring
   * (another seat's share of a revealed position, or one of its own owed shares) waits.
   */
  private foldAction(
    m: ParsedMove,
    seat: number,
    c: Extract<ParsedMove['content'], { type: 'action' }>,
  ): Fold {
    // Game actions are folded from the play phase on; until then they wait.
    if (this.phase === 'shuffle' || this.phase === 'deal') return 'wait';
    if (this.phase !== 'play') return reject('the game is not in play');
    const r = this.checkAction(this.state, m, seat, c);
    if (r === 'wait' || 'reject' in r) return r;

    const brought = new Set(c.shares.map((x) => x.pos));
    if (this.shares.missing(seat, this.module.dealt(this.state)).some((pos) => !brought.has(pos)))
      return 'wait';

    this.link(m);
    for (const { pos, share } of [...c.shares, ...c.reveals]) this.shares.add(seat, pos, share);
    this.state = deepFreeze(r.next);
    this.record(r.events);
    this.actionLog.push({ actor: seat, action: c.action, seq: m.seq });
    return 'accepted';
  }

  /**
   * Check a game action against `state` on everything but R1, in order: the signer is the pending seat; every
   * share and reveal verifies; the module accepts the action; and the reveals are exactly the positions
   * `revealsOf` names, each decrypting to the claimed card. A pending reveal, or another seat's missing share of a
   * revealed position, means not yet.
   */
  private checkAction(
    state: unknown,
    m: ParsedMove,
    seat: number,
    c: Extract<ParsedMove['content'], { type: 'action' }>,
  ): Checked {
    const p = this.module.pending(state);
    // A pending reveal resolves once its shares arrive; the move may follow it.
    if (p.type === 'reveal') return 'wait';
    if (p.type !== 'player') return reject('no player decision is pending');
    if (seat !== p.seat) return reject(`move ${m.seq} must be signed by seat ${p.seat}`);

    const bad = this.actionProofs(m.id, seat, c.shares, c.reveals);
    if (bad !== null) return reject(bad);

    const r = this.module.apply(state, c.action);
    if (!r.ok) return reject(`the module rejects the action: ${r.error.code}: ${r.error.message}`);

    const claims = this.module.revealsOf(state, c.action);
    const claimed = claims.map((l) => l.pos).sort((a, b) => a - b);
    const shown = c.reveals.map((x) => x.pos);
    if (claims.some((l) => l.deck !== this.deckId) || canonicalJson(claimed) !== canonicalJson(shown)) {
      return reject('the reveals do not match the positions the action shows');
    }
    const deck = this.finalDeck() as Ciphertext[];
    let missingShares = false;
    for (const claim of claims) {
      if (!this.shares.covered(claim.pos, seat)) {
        missingShares = true;
        continue;
      }
      const slots = this.shares.slots(claim.pos, seat);
      slots[seat] = (c.reveals.find((x) => x.pos === claim.pos) as PosShare).share;
      const ctx = this.shareCtx(claim.pos);
      const card = decryptPosition(deck[claim.pos] as Ciphertext, ctx, this.keys, slots, this.cards);
      if (card !== claim.card) return reject(`the reveal of position ${claim.pos} is not the claimed card`);
    }
    if (missingShares) return 'wait';
    return { next: r.state, events: r.events };
  }

  /**
   * Verify a game action's shares and reveals against the signer's key, once per event. The move's prev fixes its
   * final deck, so the result never changes. Null when all verify.
   */
  private actionProofs(
    id: Hex,
    seat: number,
    shares: readonly PosShare[],
    reveals: readonly PosShare[],
  ): string | null {
    const cached = this.actionChecked.get(id);
    if (cached !== undefined) return cached;
    const deck = this.finalDeck() as Ciphertext[];
    const key = this.keys[seat] as Point;
    const check = (list: readonly PosShare[], what: string): string | null => {
      for (const { pos, share } of list) {
        if (pos >= this.deckSize) return `the ${what} for position ${pos} is outside the deck`;
        if (!verifyShare(key, deck[pos] as Ciphertext, share, this.shareCtx(pos))) {
          return `the ${what} for position ${pos} does not verify`;
        }
      }
      return null;
    };
    const result = check(shares, 'share') ?? check(reveals, 'reveal');
    this.actionChecked.set(id, result);
    return result;
  }

  private shuffleVerifies(
    id: Hex,
    step: number,
    output: readonly Ciphertext[],
    proof: Parameters<typeof verifyShuffle>[3],
  ): boolean {
    const cached = this.shuffleChecked.get(id);
    if (cached !== undefined) return cached;
    this.shuffleVerifications++;
    const ok = verifyShuffle(this.decks[step] as Ciphertext[], output, this.X, proof, this.shuffleCtx(step));
    this.shuffleChecked.set(id, ok);
    return ok;
  }

  private shuffleCtx(seat: number): ShuffleCtx {
    return { rootId: this.root.id, seat, deckId: this.deckId };
  }

  private link(m: ParsedMove): void {
    this.snapshots[this.chain.length] = {
      phase: this.phase,
      state: this.state,
      logLength: this.actionLog.length,
      learned: [...this.learned],
      events: this.events,
    };
    this.chain.push(m);
    this.linked.add(m.id);
    this.unpool(m);
  }

  /** Append module events to the log, keeping the last `MAX_EVENTS`. The array is replaced, never changed. */
  private record(events: readonly unknown[]): void {
    if (events.length === 0) return;
    const next = [...this.events, ...events.map((e) => deepFreeze(e))];
    this.events = Object.freeze(next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next);
  }

  private finalDeck(): Ciphertext[] | null {
    return this.decks.length > this.seats ? (this.decks[this.seats] as Ciphertext[]) : null;
  }

  private shareCtx(pos: number): ShareCtx {
    return { rootId: this.root.id, deckId: this.deckId, pos };
  }

  /**
   * Fold a Shares event from `seat`: every share must verify against the seat's deck key and the final deck, or
   * the event is rejected as a whole. Only shares for new (seat, position) pairs are kept, and only those bump
   * `sharesVersion`: an earlier-seen copy of a kept share moves P back but cannot let a move link.
   */
  private foldShares(s: ParsedShares, seat: number): Fold | 'nothing-new' {
    const deck = this.finalDeck();
    if (deck === null) return 'wait';
    const key = this.keys[seat] as Point;
    for (const { pos, share } of s.shares) {
      if (!verifyShare(key, deck[pos] as Ciphertext, share, this.shareCtx(pos))) {
        return reject(`the share for position ${pos} does not verify`);
      }
    }
    this.sharesSeen.set(s.id, s);
    let changed = false;
    for (const { pos, share } of s.shares) if (this.shares.add(seat, pos, share) === 'new') changed = true;
    if (changed) this.sharesVersion++;
    return changed ? 'accepted' : 'nothing-new';
  }

  private startDeal(): void {
    const r = this.module.setup({
      rules: this.rules,
      seats: this.seats,
      mode: 'view',
      viewer: this.me?.seat ?? null,
    });
    // validateRoot accepted these rules and this seat count, so setup cannot fail for a sound module.
    if (!r.ok) throw new Error(`module setup failed: ${r.error.message}`);
    this.state = deepFreeze(r.value);
    this.phase = 'deal';
  }

  /**
   * Bring the fold up to date: extend the chain with pooled moves at the head, fold waiting Shares events, take
   * the phase steps the events allow, cut the chain back above a shuffle step that is no longer a candidate, then
   * re-examine forks, until nothing changes. Then judge side moves at old prevs and flag equivocators. Once a
   * timeout has ended the game, nothing changes any more. The stored claims are not judged here: the caller first
   * records any progress the event made, then calls `decideTimeouts`.
   */
  private settle(): void {
    if (this.timedOut !== null) return;
    for (;;) {
      this.extend();
      if (this.cutIneligible()) continue;
      if (!this.resolveForks()) break;
    }
    this.judgeSides();
    this.flagged = this.equivocators();
  }

  /** `settle`, then judge the stored claims, for an event whose progress (if any) P already reflects. */
  private settleAndDecide(): void {
    this.settle();
    this.decideTimeouts();
  }

  /**
   * Cut the chain back above the first shuffle step on it that is no longer a candidate (D030 Ruling 12): its group
   * passed `MAX_SHUFFLE_CANDIDATES` and nobody else acknowledged it. Returns true when the chain changed. The cut
   * moves stay pooled, and the step links again if it is acknowledged later.
   */
  private cutIneligible(): boolean {
    const top = Math.min(this.seats, this.chain.length);
    for (let j = 0; j < top; j++) {
      if (this.shuffleEligible(this.chain[j] as ParsedMove)) continue;
      this.truncate(j);
      this.quiesce();
      return true;
    }
    return false;
  }

  /**
   * Judge each pooled move at a prev below the head once, as of that prev, and drop it if it is invalid there. A
   * move that arrived before its prev and lost to a sibling would otherwise stay pooled, unjudged, while a client
   * that got it after its prev rejects it at once. A move not judgeable yet (`unknown`) is judged again only once
   * the shares change. A shuffle step that is not a candidate is not judged (nor verified).
   */
  private judgeSides(): void {
    for (let j = 0; j < this.chain.length; j++) {
      const side = this.movesByPrev.get(this.idAt(j));
      if (side === undefined) continue;
      for (const m of byId(side.values())) {
        if (!this.shuffleEligible(m)) continue;
        if (this.validity.get(m.id) === true || this.sideUnknown.get(m.id) === this.sharesVersion) continue;
        const v = this.validAtPrev(m, this.seatOf.get(m.pubkey) as number);
        if (typeof v === 'object') this.dropMove(m, v.reject);
        else if (v === 'unknown') this.sideUnknown.set(m.id, this.sharesVersion);
      }
    }
  }

  /**
   * Link pooled moves at the head, lowest id first among the candidates that fold, and quiesce, until nothing
   * applies. A shuffle step that is not a candidate is skipped: it is neither verified nor marked stuck.
   */
  private extend(): void {
    for (;;) {
      let progressed = false;
      const waiting = this.movesByPrev.get(this.headId());
      if (waiting !== undefined) {
        for (const m of byId(waiting.values())) {
          if (!this.shuffleEligible(m)) continue;
          const r = this.foldMove(m, this.seatOf.get(m.pubkey) as number);
          if (r === 'accepted') {
            progressed = true;
            break;
          }
          if (r === 'wait') this.stuck.set(m.id, this.sharesVersion);
          else this.dropMove(m, r.reject);
        }
      }
      if (this.quiesceOnce()) progressed = true;
      if (!progressed) return;
    }
  }

  /** Fold waiting Shares events and take phase steps until nothing changes, without linking moves. */
  private quiesce(): void {
    while (this.quiesceOnce()) {
      // keep going
    }
  }

  private quiesceOnce(): boolean {
    let progressed = false;
    if (this.finalDeck() !== null) {
      for (const s of byId(this.waitingShares.values())) {
        this.waitingShares.delete(s.id);
        const r = this.foldShares(s, this.seatOf.get(s.pubkey) as number);
        if (r === 'accepted') progressed = true;
        else if (typeof r === 'object') {
          this.badShares.set(s.id, s);
          this.rejected.set(s.id, r.reject);
        }
      }
    }
    if (this.advance()) progressed = true;
    return progressed;
  }

  /* ------------------------------------------------------------------------------------- fork choice */

  /**
   * Re-choose the chain at every fork point where a side branch beats the current one (D030 Rulings 5 and 9). At a
   * prev on the chain, branches rank by whether they reach the module's `over`, then by length in accepted moves,
   * then by the lowest id: a finished game is never reopened by a branch that does not finish it, however long.
   * - A fork is examined at most once per `receive`.
   * - Only candidates count (D030 Ruling 12): a shuffle step that is not one is no side branch.
   * - When the chain is over, a side branch whose pooled depth (an upper bound on its valid length) cannot reach
   *   the chain's length past the prev is skipped without a trial.
   * - Otherwise the fork's best side branch comes from `sideBest`, which keeps its verdict until the pool below
   *   the prev, the shares or the shuffle candidates change.
   * Returns true when the chain changed.
   */
  private resolveForks(): boolean {
    for (let j = 0; j < this.chain.length; j++) {
      const prev = this.idAt(j);
      const pooled = this.movesByPrev.get(prev);
      if (pooled === undefined || this.forkSeen.get(prev) === this.generation) continue;
      this.forkSeen.set(prev, this.generation);
      const side = [...pooled.values()].filter((m) => this.shuffleEligible(m));
      if (side.length === 0) continue;
      const cur = { over: this.isOver(), length: this.chain.length - j };
      const top = (this.chain[j] as ParsedMove).id;
      if (cur.over) {
        const depths = new Map<Hex, number>();
        const contender = side.some((m) => {
          const bound = 1 + this.poolDepth(m.id, depths);
          return bound > cur.length || (bound === cur.length && m.id < top);
        });
        if (!contender) continue;
      }
      const best = this.sideBest(j);
      const first = best.ids[0];
      if (first === undefined) continue;
      const side1 = { over: best.over, length: best.ids.length };
      if (!(beats(side1, cur) || (!beats(cur, side1) && first < top))) continue;
      this.truncate(j);
      this.quiesce();
      for (const id of best.ids) {
        const m = this.pooledById.get(id);
        if (m === undefined || !this.tryLink(m)) break;
      }
      return true;
    }
    return false;
  }

  /** Whether the chain has reached the module's `over`. */
  private isOver(): boolean {
    return this.phase === 'end' || this.phase === 'done';
  }

  /**
   * The best branch at the fork after chain move `j`, other than the chain's own, by trial: cut back to `j`, find
   * the best extension in trial mode, and relink the chain. Kept per prev until the pool below it, the shares or
   * the shuffle candidates change, so an event elsewhere does not repeat the trial.
   */
  private sideBest(j: number): { ids: Hex[]; over: boolean } {
    const prev = this.idAt(j);
    const key = `${this.poolVersion.get(prev) ?? 0}:${this.sharesVersion}:${this.shuffleVersion}`;
    const known = this.forkMemo.get(prev);
    if (known !== undefined && known.key === key) return known;
    this.trials++;
    const tail = this.chain.slice(j);
    const top = (tail[0] as ParsedMove).id;
    let best: Branch = { moves: [], over: false };
    this.quiet++;
    try {
      this.truncate(j);
      this.trialDepth++;
      try {
        best = this.bestExtension(top);
      } finally {
        this.trialDepth--;
      }
      // Put the chain back as it was, learns and (cached) audit included; the pool ends as it started.
      this.quiesce();
      for (const m of tail) if (!this.tryLink(m)) break;
    } finally {
      this.quiet--;
    }
    const out = {
      key: `${this.poolVersion.get(prev) ?? 0}:${this.sharesVersion}:${this.shuffleVersion}`,
      ids: best.moves.map((m) => m.id),
      over: best.over,
    };
    this.forkMemo.set(prev, out);
    return out;
  }

  /**
   * The longest chain of pooled moves below `id`, ignoring validity, capped at `MAX_DEPTH`. A move known to be
   * stuck counts, but nothing below it does. Iterative, so a deep pool cannot overflow the stack.
   */
  private poolDepth(id: Hex, memo: Map<Hex, number>): number {
    const stack: [Hex, boolean][] = [[id, false]];
    // Ids are hashes, so the pool has no cycles; this guard keeps the walk finite regardless.
    const open = new Set<Hex>();
    while (stack.length > 0) {
      const [at, expanded] = stack.pop() as [Hex, boolean];
      if (memo.has(at)) continue;
      const kids = this.isStuck(at) ? undefined : this.movesByPrev.get(at);
      if (!expanded && kids !== undefined) {
        if (open.has(at)) continue;
        open.add(at);
        stack.push([at, true]);
        for (const k of kids.keys()) if (!memo.has(k) && !open.has(k)) stack.push([k, false]);
        continue;
      }
      let out = 0;
      if (kids !== undefined) for (const k of kids.keys()) out = Math.max(out, 1 + (memo.get(k) ?? 0));
      memo.set(at, Math.min(out, MAX_DEPTH));
    }
    return memo.get(id) ?? 0;
  }

  /**
   * The best branch from the head, by trial: link each pooled successor that is a candidate in id order (but
   * `exclude`), recurse, and cut back. Branches rank by reaching `over`, then length; ties keep the lowest id.
   * Leaves the fold at the head it started from.
   */
  private bestExtension(exclude: Hex | null = null): Branch {
    const h = this.chain.length;
    let best: Branch = { moves: [], over: false };
    const kids = this.movesByPrev.get(this.headId());
    if (kids === undefined) return best;
    for (const k of byId(kids.values())) {
      if (k.id === exclude || !this.shuffleEligible(k) || !this.tryLink(k)) continue;
      const sub = this.bestExtension();
      const branch = { moves: [k, ...sub.moves], over: sub.moves.length > 0 ? sub.over : this.isOver() };
      this.truncate(h);
      if (
        beats(
          { over: branch.over, length: branch.moves.length },
          { over: best.over, length: best.moves.length },
        )
      ) {
        best = branch;
      }
    }
    return best;
  }

  /** Fold one pooled move at the head and quiesce; drops it if invalid. Returns whether it linked. */
  private tryLink(m: ParsedMove): boolean {
    const r = this.foldMove(m, this.seatOf.get(m.pubkey) as number);
    if (r === 'accepted') {
      this.quiesce();
      return true;
    }
    if (r === 'wait') this.stuck.set(m.id, this.sharesVersion);
    else this.dropMove(m, r.reject);
    return false;
  }

  /**
   * Cut the chain back to head seq `h`: the later moves go back to the pool, the fold is restored as it stood at
   * that head, and the share store is rebuilt from the Shares events and the moves that remain. Learns are redone
   * from the shares by the next quiesce.
   */
  private truncate(h: number): void {
    if (this.chain.length <= h) return;
    const snap = this.snapshots[h] as Snapshot;
    for (const m of this.chain.splice(h)) {
      this.linked.delete(m.id);
      this.pool(m);
    }
    this.snapshots.length = h;
    this.decks.length = Math.min(this.decks.length, h + 1);
    this.phase = snap.phase;
    this.state = snap.state;
    this.auditResult = 'pending';
    this.actionLog.length = snap.logLength;
    this.events = snap.events;
    this.learned.clear();
    for (const pos of snap.learned) this.learned.add(pos);
    this.shares = new ShareStore(this.seats);
    if (this.finalDeck() === null) {
      // The shares were checked against a final deck that is gone: they all wait again, as if never folded.
      if (this.sharesSeen.size > 0) this.sharesVersion++;
      for (const [id, s] of this.sharesSeen) this.waitingShares.set(id, s);
      this.sharesSeen.clear();
      for (const [id, s] of this.badShares) {
        this.rejected.delete(id);
        this.waitingShares.set(id, s);
      }
      this.badShares.clear();
      return;
    }
    for (const s of this.sharesSeen.values()) {
      const seat = this.seatOf.get(s.pubkey) as number;
      for (const { pos, share } of s.shares) this.shares.add(seat, pos, share);
    }
    for (const m of this.chain) {
      if (m.content.type !== 'action') continue;
      const seat = this.seatOf.get(m.pubkey) as number;
      for (const { pos, share } of [...m.content.shares, ...m.content.reveals])
        this.shares.add(seat, pos, share);
    }
  }

  /* ------------------------------------------------------------------------------------- equivocation */

  /**
   * The seats with two distinct well-formed moves on one (prev, seq), the prev being the chain's move at seq − 1,
   * ascending:
   * - shuffle steps (D030 Ruling 12): any two, proofs unchecked. Only the step's seat could sign both, and an honest
   *   client never signs twice;
   * - game actions (R2 as refined by Ruling 3): both valid as of that prev on everything but R1. An invalid action
   *   never counts.
   */
  private equivocators(): number[] {
    const out = new Set<number>();
    for (const key of this.rivalKeys) {
      const group = byId([...(this.candidates.get(key) as Map<Hex, Candidate>).values()].map((c) => c.m));
      const first = group[0] as ParsedMove;
      const seat = this.seatOf.get(first.pubkey) as number;
      if (out.has(seat)) continue;
      const at = first.seq - 1;
      if (at > this.chain.length || this.idAt(at) !== first.prevId) continue;
      if (first.content.type === 'shuffle') out.add(seat);
      else if (group.filter((m) => this.validAtPrev(m, seat) === 'valid').length >= 2) out.add(seat);
    }
    return ascending(out);
  }

  /** `m` judged as of its prev; definite judgements are kept. */
  private validAtPrev(m: ParsedMove, seat: number): Judged {
    const cached = this.validity.get(m.id);
    if (cached === true) return 'valid';
    if (cached !== undefined) return reject(cached);
    const v = this.judgeAtPrev(m, seat);
    if (v === 'valid') this.validity.set(m.id, true);
    else if (typeof v === 'object') this.validity.set(m.id, v.reject);
    return v;
  }

  /** Judge a move against the chain's state at its prev, which must be the chain's move at `seq − 1`. */
  private judgeAtPrev(m: ParsedMove, seat: number): Judged {
    const shape = this.moveShape(m, seat);
    if (shape !== null) return reject(shape);
    const at = m.seq - 1;
    if (at > this.chain.length || this.idAt(at) !== m.prevId) {
      // A prev on the chain at another seq does not fit; any other prev is not on the chain (yet).
      return this.linked.has(m.prevId) ? reject(`seq ${m.seq} does not follow its prev`) : 'unknown';
    }
    const c = m.content;
    if (c.type === 'shuffle') {
      return this.shuffleVerifies(m.id, at, c.deck, c.proof)
        ? 'valid'
        : reject('the shuffle proof does not verify');
    }
    // Below the head, a game action was linked on that snapshot, so it is in the play phase.
    const snap =
      at === this.chain.length ? { phase: this.phase, state: this.state } : (this.snapshots[at] as Snapshot);
    if (snap.phase === 'shuffle' || snap.phase === 'deal') return 'unknown';
    if (snap.phase !== 'play') return reject('the game is not in play');
    const r = this.checkAction(snap.state, m, seat, c);
    if (r === 'wait') return 'unknown';
    return 'next' in r ? 'valid' : r;
  }

  /* -------------------------------------------------------------------------------------- phase steps */

  /** Phase changes, derived reveals, private learns and the audit that the folded events allow. */
  private advance(): boolean {
    let progressed = false;
    if (this.phase === 'deal' && this.dealComplete()) {
      this.phase = 'play';
      progressed = true;
    }
    if (this.phase === 'play' && this.revealPublic()) progressed = true;
    if (this.phase === 'play' && this.module.pending(this.state).type === 'over') {
      this.phase = 'end';
      progressed = true;
    }
    // Trial folds only need validity and length: no audit and no private learns.
    if (this.trialDepth > 0) return progressed;
    if (this.phase === 'end' && this.secrets.size === this.seats) {
      this.auditResult = this.cachedAudit();
      this.phase = 'done';
      progressed = true;
    }
    if (this.learnPrivate()) progressed = true;
    return progressed;
  }

  /** The R6 audit for the chain as it stands, run once per log hash. */
  private cachedAudit(): SessionAudit {
    const key = this.logHash();
    const known = this.auditCache.get(key);
    if (known !== undefined) return known;
    const audit = this.runAudit();
    if (this.auditCache.size >= MAX_AUDITS) this.auditCache.clear();
    this.auditCache.set(key, audit);
    return audit;
  }

  /** The R6 audit over this session's log, with every seat's verified secret. */
  private runAudit(): SessionAudit {
    return auditGame({
      module: this.module,
      rules: this.rules,
      seats: this.seats,
      deckId: this.deckId,
      deck: this.finalDeck() as Ciphertext[],
      secrets: Array.from({ length: this.seats }, (_, k) => this.secrets.get(k) as bigint),
      cards: this.cards,
      log: this.actionLog,
      outcome: this.module.outcome(this.state),
    });
  }

  /** Every seat has shared every position the deal assigns to another seat or to nobody (PROTOCOL §6.1). */
  private dealComplete(): boolean {
    const dealt = this.module.dealt(this.state);
    for (let k = 0; k < this.seats; k++) if (this.shares.missing(k, dealt).length > 0) return false;
    return true;
  }

  /**
   * Derived reveals (PROTOCOL §6.3): while the module pends a public reveal and every listed position has all S
   * shares, apply `{type: 'reveal', actor: 'deck', …}` for each listed position in ascending order.
   */
  private revealPublic(): boolean {
    const deck = this.finalDeck() as Ciphertext[];
    let progressed = false;
    for (;;) {
      const p = this.module.pending(this.state);
      if (p.type !== 'reveal' || p.deck !== this.deckId || p.positions.length === 0) return progressed;
      const positions = [...p.positions].sort((a, b) => a - b);
      if (!positions.every((pos) => this.shares.covered(pos))) return progressed;
      for (const pos of positions) {
        const ctx = this.shareCtx(pos);
        const card = decryptPosition(
          deck[pos] as Ciphertext,
          ctx,
          this.keys,
          this.shares.slots(pos),
          this.cards,
        );
        // With verified shuffles and shares every position decrypts to a card the module accepts; stop otherwise.
        if (card === null) return progressed;
        const action: RevealAction = { type: 'reveal', actor: 'deck', deck: this.deckId, pos, card };
        const r = this.module.apply(this.state, action);
        if (!r.ok) return progressed;
        this.state = deepFreeze(r.state);
        this.record(r.events);
        this.actionLog.push({ actor: 'deck', action, seq: this.chain.length });
        progressed = true;
      }
    }
  }

  /**
   * Private learns (PROTOCOL §6.4): decrypt each position dealt to me once every other seat's share is in, using
   * my own layer for mine, and tell the module. Learns start with the play phase, after the setup reveals, so the
   * module's event log does not depend on the order the deal's Shares events arrived in.
   */
  private learnPrivate(): boolean {
    const me = this.me;
    const deck = this.finalDeck();
    if (me === null || deck === null || this.phase === 'shuffle' || this.phase === 'deal') return false;
    let progressed = false;
    for (const d of this.module.dealt(this.state)) {
      if (d.to !== me.seat || d.deck !== this.deckId || this.learned.has(d.pos)) continue;
      if (!this.shares.covered(d.pos, me.seat)) continue;
      this.learned.add(d.pos);
      const ct = deck[d.pos] as Ciphertext;
      const own = { seat: me.seat, D: ownShare(me.deckSecret, ct) };
      const slots = this.shares.slots(d.pos, me.seat);
      const card = decryptPosition(ct, this.shareCtx(d.pos), this.keys, slots, this.cards, own);
      if (card === null) continue;
      const r = this.module.learn(this.state, { deck: this.deckId, pos: d.pos, card });
      if (!r.ok) continue;
      this.state = deepFreeze(r.state);
      this.record(r.events);
      progressed = true;
    }
    return progressed;
  }

  /**
   * The game's progress time P (D030 Rulings 10 and 11): the latest local first-seen time over the root, the
   * canonical chain's moves, and the Shares events and secrets that removed a seat from the stall set at the head
   * (or let the chain advance). A share that leaves the stall set as it was does not count, so a stalled seat
   * cannot put its own deadline off by publishing useless shares one at a time. No `created_at` counts.
   */
  private progress(): number {
    let out = Math.max(this.rootSeenAt, this.stallProgress);
    for (const m of this.chain) out = Math.max(out, this.seenOf(m.id));
    return out;
  }

  /** The head and the seats stalled there, before an event is folded, for `noteProgress`. */
  private stallMark(): { head: Hex; stalled: number[] } {
    return { head: this.headId(), stalled: this.stalled() };
  }

  /**
   * After Shares event or secret `id` was folded: if it let the chain advance, or removed a seat from the stall
   * set at the head, its first-seen time counts toward P (D030 Ruling 11).
   */
  private noteProgress(before: { head: Hex; stalled: number[] }, id: Hex): void {
    const after = this.headId() === before.head ? this.stalled() : null;
    if (after !== null && before.stalled.every((k) => after.includes(k))) return;
    this.stallProgress = Math.max(this.stallProgress, this.seenOf(id));
  }

  /**
   * The seats stalled at the head (D030 R4), ascending:
   * - shuffle: the seat whose step is next;
   * - deal: every seat whose owed deal positions are not all shared;
   * - play: the pending seat, unless the decision needs a card dealt to it that some other seat has not shared,
   *   in which case those seats; for a pending public reveal, the seats missing a share of it;
   * - end: every seat whose secret is not in;
   * - otherwise none.
   */
  private stalled(): number[] {
    const all = Array.from({ length: this.seats }, (_, k) => k);
    switch (this.phase) {
      case 'shuffle':
        return [this.chain.length];
      case 'deal': {
        const dealt = this.module.dealt(this.state);
        return all.filter((k) => this.shares.missing(k, dealt).length > 0);
      }
      case 'play':
        return this.stalledInPlay(all);
      case 'end':
        return all.filter((k) => !this.secrets.has(k));
      default:
        return [];
    }
  }

  /**
   * The play-phase part of `stalled`. Whether the pending decision needs hidden cards is judged on the public
   * state, so every view agrees: if the module lists actions for the seat with its hand hidden, the seat can act.
   */
  private stalledInPlay(all: readonly number[]): number[] {
    const p = this.module.pending(this.state);
    if (p.type === 'reveal') {
      return all.filter((k) => p.positions.some((pos) => !this.shares.has(k, pos)));
    }
    if (p.type !== 'player') return [];
    const seat = p.seat;
    const needed = this.module
      .dealt(this.state)
      .filter((d) => d.to === seat && d.deck === this.deckId && !this.shares.covered(d.pos, seat))
      .map((d) => d.pos);
    if (needed.length === 0) return [seat];
    if (this.module.legalActions(this.module.view(this.state, null), seat).length > 0) return [seat];
    return all.filter((k) => k !== seat && needed.some((pos) => !this.shares.has(k, pos)));
  }

  /* -------------------------------------------------------------------------------------------- views */

  view(): SessionView {
    const status = this.status();
    return {
      phase: status.phase,
      rootId: this.root.id,
      seats: this.seats,
      mySeat: this.me?.seat ?? null,
      head: { id: this.headId(), seq: this.chain.length },
      state: this.state,
      pending: this.pending(),
      pendingSince: this.progress(),
      outcome: status.outcome,
      forfeits: status.forfeits,
      equivocators: [...this.flagged],
      audit: status.audit,
      logHash: this.logHash(),
      deadline: this.root.deadline,
      attested: this.attested(),
      events: this.events,
    };
  }

  private logHash(): Hex {
    return logHash(this.chain.map((m) => m.id));
  }

  /**
   * The phase, outcome, audit and forfeits the view reports (PROTOCOL §7, §8.2, D030 R5). The outcome is known
   * once the game is done: the declared one when the audit passes and nobody equivocated; otherwise the failed and
   * equivocating seats move to shared last places and the others keep their declared order.
   */
  private status(): Status {
    if (this.timedOut !== null) return this.timeoutStatus(this.timedOut.seats);
    if (this.phase !== 'done') {
      return { phase: this.phase, outcome: null, audit: 'pending', forfeits: [...this.flagged] };
    }
    const declared = this.module.outcome(this.state) as ModuleOutcome;
    const audit = this.auditResult;
    const failed = typeof audit === 'object' ? audit.fail : [];
    const forfeits = ascending([...this.flagged, ...failed]);
    const outcome =
      forfeits.length === 0
        ? { places: [...declared.places], reason: declared.reason, scores: [...declared.scores] }
        : rankWithForfeits(declared.scores, forfeits, declared.places);
    const copy = typeof audit === 'object' ? { fail: [...audit.fail], reason: audit.reason } : audit;
    return { phase: 'done', outcome, audit: copy, forfeits };
  }

  /**
   * The result once a timeout is accepted (PROTOCOL §8.2, D030 R5, Ruling 10), from the fold as it stood then;
   * `stalled` holds every seat stalled at the head then, whichever seat the claim named:
   * - before the first game action: `cancelled`, no outcome; the stalled seats forfeit;
   * - during play: `done` at once, the stalled seats (and any equivocator) last, the others ranked by the module's
   *   `standings`. The deck cannot be decrypted without every secret, so the audit cannot run: it records the
   *   forfeits instead, `{fail: forfeits, reason: 'timeout'}` (D030 Ruling 7), and the result can be attested;
   * - at the end: `done`, the seats whose secret was not in forfeit for a withheld secret, and the declared order
   *   is adjusted with them (and any equivocator) last; the audit is `{fail: forfeits, reason: 'withheld secret'}`.
   */
  private timeoutStatus(stalled: readonly number[]): Status {
    const actions = this.chain.length > this.seats;
    const forfeits = ascending([...stalled, ...this.flagged]);
    if (this.phase === 'shuffle' || this.phase === 'deal' || (this.phase === 'play' && !actions)) {
      return { phase: 'cancelled', outcome: null, audit: 'pending', forfeits };
    }
    if (this.phase === 'play') {
      const outcome = rankWithForfeits(this.module.standings(this.state), forfeits, null);
      return { phase: 'done', outcome, audit: { fail: [...forfeits], reason: 'timeout' }, forfeits };
    }
    // The end phase: only a seat whose secret is missing can be stalled there.
    const declared = this.module.outcome(this.state) as ModuleOutcome;
    const outcome = rankWithForfeits(declared.scores, forfeits, declared.places);
    return { phase: 'done', outcome, audit: { fail: [...forfeits], reason: 'withheld secret' }, forfeits };
  }

  /** The canonical `{audit, logHash, outcome}` this session would attest (PROTOCOL §4.8), or null before `done`. */
  private attestContent(): string | null {
    const { phase, outcome, audit } = this.status();
    if (phase !== 'done' || outcome === null || audit === 'pending') return null;
    return canonicalJson({ audit, logHash: this.logHash(), outcome });
  }

  /** The seats whose kept (latest) attestation matches this session's result, ascending. */
  private attested(): number[] {
    const mine = this.attestContent();
    if (mine === null) return [];
    return ascending([...this.attests].filter(([, a]) => a.content === mine).map(([seat]) => seat));
  }

  /** During the shuffle, the next shuffler; afterwards, the module's pending decision. A fresh copy. */
  private pending(): Pending {
    if (this.phase === 'shuffle') return { type: 'player', seat: this.chain.length, decision: 'shuffle' };
    const p = this.module.pending(this.state);
    return p.type === 'reveal' ? { type: 'reveal', deck: p.deck, positions: [...p.positions] } : { ...p };
  }

  /**
   * What this seat must publish next, as of the canonical head. Spectators have none. In play, the shares this
   * seat owes come first (D039), then its decision, if any.
   */
  duties(): Duty[] {
    const me = this.me;
    if (me === null) return [];
    // After a timeout only the attestation can be due.
    const live = this.timedOut === null;
    if (live && this.phase === 'shuffle' && this.chain.length === me.seat) return [{ kind: 'shuffle' }];
    if (live && this.phase === 'deal' && this.owed(me).length > 0) return [{ kind: 'deal' }];
    const owed = live && this.phase === 'play' ? this.owed(me) : [];
    const share: Duty[] = owed.length > 0 ? [{ kind: 'share', positions: owed }] : [];
    if (this.decides(me)) return [...share, { kind: 'decide' }];
    if (share.length > 0) return share;
    if (live && this.phase === 'end' && !this.secrets.has(me.seat)) return [{ kind: 'secret' }];
    // Attesting is a SHOULD (PROTOCOL §7): the duty is advisory.
    if (this.attestContent() !== null && !this.attested().includes(me.seat)) return [{ kind: 'attest' }];
    return [];
  }

  /** The positions `me` owes as of the head and has not shared yet, ascending (PROTOCOL §6.2). */
  private owed(me: Identity): number[] {
    return this.shares.missing(me.seat, this.module.dealt(this.state));
  }

  /**
   * Whether the play phase pends `me`'s decision and the module lists legal actions for it (D030 Ruling 4). A
   * module lists none while their legality depends on hidden cards this seat has not learned, so the list is
   * exact whenever it is not empty.
   */
  private decides(me: Identity): boolean {
    if (this.phase !== 'play' || this.timedOut !== null) return false;
    const p = this.module.pending(this.state);
    if (p.type !== 'player' || p.seat !== me.seat) return false;
    return this.module.legalActions(this.state, me.seat).length > 0;
  }

  /** My legal actions when a decision is mine (`decide` duty); otherwise none. A fresh, frozen list. */
  legalActions(): readonly unknown[] {
    const me = this.me;
    if (me === null || !this.decides(me)) return [];
    return deepFreeze(JSON.parse(canonicalJson(this.module.legalActions(this.state, me.seat))) as unknown[]);
  }

  /* ----------------------------------------------------------------------------------------- builders */
  /*
   * Every builder makes fresh randomness, so building twice for one decision gives two distinct valid events on
   * one prev: equivocation. Build once per decision, then persist and re-send the event you built.
   */

  private requireMe(): Identity {
    if (this.me === null) throw new ClientError('a spectator has no duties');
    return this.me;
  }

  private requireDuty(kind: Duty['kind']): Identity {
    const me = this.requireMe();
    if (!this.duties().some((d) => d.kind === kind))
      throw new ClientError(`no ${kind} duty is due from this seat`);
    return me;
  }

  /**
   * This seat's shuffle step: the current deck permuted and re-encrypted under the joint key, with its proof.
   * The permutation and re-encryption factors are dropped once proven. The event is not folded in: publish it and
   * feed it back through `receive`. Build it once: a second step on the same prev is equivocation.
   */
  buildShuffle(rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireDuty('shuffle');
    const input = this.decks[this.chain.length] as Ciphertext[];
    const { out, psi, rPrime } = shuffleDeck(input, this.X, rnd);
    const proof = proveShuffle(input, out, this.X, psi, rPrime, this.shuffleCtx(me.seat), rnd);
    const t = moveTemplate(
      {
        rootId: this.root.id,
        prevId: this.headId(),
        seq: this.chain.length + 1,
        content: { type: 'shuffle', deck: out, proof },
      },
      createdAt,
    );
    const ev = finalizeEvent(t, me.sessionSk, rnd);
    // This seat proved it, so its own step need not be verified again.
    this.shuffleChecked.set(ev.id, true);
    return ev;
  }

  /**
   * This seat's deal: one Shares event with a share for every position the deal assigns to another seat or to
   * nobody, that this seat has not shared yet, sorted by position. Build it once and re-send that event.
   */
  buildDeal(rnd: RandomBytes, createdAt: number): NostrEvent {
    return this.owedSharesEvent(this.requireDuty('deal'), rnd, createdAt);
  }

  /**
   * My owed shares in play (`share` duty, D039): one Shares event with a share for every position the `share`
   * duty names, sorted by position. Publish it as soon as the duty appears, so the drawer learns its tile without
   * waiting for my next move, which then carries no shares. Build it once and re-send that event; a second build
   * is harmless (only a seat's first share of a position is kept) but wasteful.
   */
  buildShares(rnd: RandomBytes, createdAt: number): NostrEvent {
    return this.owedSharesEvent(this.requireDuty('share'), rnd, createdAt);
  }

  /** One Shares event, signed by my session key, with my share of every position I owe and have not shared. */
  private owedSharesEvent(me: Identity, rnd: RandomBytes, createdAt: number): NostrEvent {
    const deck = this.finalDeck() as Ciphertext[];
    const shares = this.owed(me).map((pos) => ({
      pos,
      share: makeShare(me.deckSecret, deck[pos] as Ciphertext, this.shareCtx(pos), rnd),
    }));
    return finalizeEvent(sharesTemplate({ rootId: this.root.id, shares }, createdAt), me.sessionSk, rnd);
  }

  /**
   * My game-action move: `action` (one of `legalActions()`), every share I owe as of the head (R1) and my reveal
   * shares for the cards it shows (`revealsOf`), each sorted by position. Throws `ClientError` unless a decision
   * is mine and the action is legal. Build it once per decision: a second move on the same prev is equivocation.
   */
  buildAction(action: unknown, rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireDuty('decide');
    let wanted: string;
    try {
      wanted = canonicalJson(action);
    } catch {
      throw new ClientError('the action is not canonical JSON');
    }
    const legal = this.module.legalActions(this.state, me.seat).find((a) => canonicalJson(a) === wanted);
    if (legal === undefined) throw new ClientError('the action is not legal now');
    const deck = this.finalDeck() as Ciphertext[];
    const share = (pos: number): PosShare => ({
      pos,
      share: makeShare(me.deckSecret, deck[pos] as Ciphertext, this.shareCtx(pos), rnd),
    });
    const shares = this.owed(me).map(share);
    const shown = [...new Set(this.module.revealsOf(this.state, legal).map((l) => l.pos))];
    const reveals = shown.sort((a, b) => a - b).map(share);
    const t = moveTemplate(
      {
        rootId: this.root.id,
        prevId: this.headId(),
        seq: this.chain.length + 1,
        content: { type: 'action', action: legal, reveals, shares },
      },
      createdAt,
    );
    const ev = finalizeEvent(t, me.sessionSk, rnd);
    // This seat made the proofs, so they need not be verified again.
    this.actionChecked.set(ev.id, null);
    return ev;
  }

  /**
   * My Secret reveal (PROTOCOL §4.7): my deck secret, signed by my session key, once the game is over (`secret`
   * duty). Build it once and re-send that event.
   */
  buildSecret(rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireDuty('secret');
    const t = secretTemplate({ rootId: this.root.id, deckSecret: me.deckSecret }, createdAt);
    return finalizeEvent(t, me.sessionSk, rnd);
  }

  /**
   * My Result attestation (PROTOCOL §4.8), unsigned: `{audit, logHash, outcome}` as this session computed them
   * (`attest` duty). Attestations are signed by the seat's npub, which the session does not hold: the caller signs
   * the template with its identity signer, publishes it and feeds it back through `receive`.
   */
  attestTemplate(createdAt: number): EventTemplate {
    this.requireDuty('attest');
    const { outcome, audit } = this.status();
    return attestEventTemplate(
      {
        rootId: this.root.id,
        audit: audit as Exclude<SessionAudit, 'pending'>,
        logHash: this.logHash(),
        outcome: outcome as Outcome,
      },
      createdAt,
    );
  }

  /**
   * The lowest seat other than mine that is stalled at the head, once `now ≥ P + deadline` with P the progress
   * time by this client's first-seen times (D030 Ruling 10); otherwise null. Null for a spectator, while this seat
   * is stalled there itself (its claim would be rejected), and once a timeout has ended the game.
   */
  timeoutTarget(now: number): number | null {
    const me = this.me;
    if (me === null || this.timedOut !== null) return null;
    if (now < this.progress() + this.root.deadline) return null;
    const stalled = this.stalled();
    if (stalled.includes(me.seat)) return null;
    return stalled.find((k) => k !== me.seat) ?? null;
  }

  /**
   * My Timeout claim (PROTOCOL §4.6) against `seat`, naming the current head and dated `createdAt`, which is also
   * taken as the local clock. Throws `ClientError` for a spectator, once a timeout has ended the game, or unless
   * `seat` is another seat stalled at the head, this seat is not, and `createdAt ≥ P + deadline`. Other clients
   * accept it once their own clock passes their own P + deadline; its date plays no part there.
   */
  buildTimeout(seat: number, rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireMe();
    if (this.timedOut !== null) throw new ClientError('a timeout has already ended the game');
    if (seat === me.seat) throw new ClientError('a seat cannot claim a timeout against itself');
    const stalled = this.stalled();
    if (!stalled.includes(seat)) throw new ClientError(`seat ${seat} is not stalled at the head`);
    if (stalled.includes(me.seat)) throw new ClientError('this seat is stalled at the head itself');
    if (createdAt < this.progress() + this.root.deadline) {
      throw new ClientError(`the deadline for seat ${seat} has not passed`);
    }
    const t = timeoutTemplate({ rootId: this.root.id, headId: this.headId(), seat }, createdAt);
    return finalizeEvent(t, me.sessionSk, rnd);
  }
}
