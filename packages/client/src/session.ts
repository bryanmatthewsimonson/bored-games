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
 * prev is shorter than the main chain and never displaces it. Two distinct moves by one seat on the same
 * (prev, seq), both valid as of that prev, flag the seat as an equivocator; play goes on, and at the end the
 * flagged seats move to the last places (R5).
 *
 * Timeouts (D030 R3–R5, PROTOCOL §8): a Timeout claim is accepted when it names the current head and a seat
 * stalled there, is dated at least `deadline` after the game's last progress as of its own date, and the local
 * clock has reached its date. The lowest-id such claim decides, and the fold stops there: the game is cancelled
 * before the first game action, ends at once by forfeit during play, or ends with the withheld secrets failed.
 */

type AnyModule = GameModule<unknown, { readonly type: string }, unknown>;

/** The outcome of trying to fold one event: folded, not yet (keep it pooled), or a rejection reason. */
type Fold = 'accepted' | 'wait' | { reject: string };

/**
 * A game action checked against a state on everything but R1: the state it leads to and the module's events, not
 * yet, or why not.
 */
type Checked = { next: unknown; events: readonly unknown[] } | 'wait' | { reject: string };

/** A Timeout claim judged now: decisive, not yet (its head is unknown, or the clock is behind it), or why not. */
type Claimed = 'valid' | 'wait' | 'early' | { reject: string };

/** The module events `view().events` keeps. */
const MAX_EVENTS = 300;

/** The Timeout claims kept per signer per head (D030 Ruling 8); more are ignored. */
const MAX_CLAIMS = 4;

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
  /** The root's `created_at`, the floor of `pendingSince`. */
  private rootCreatedAt: number;
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

  /** Every well-formed move from a seated key, grouped by `prev:seq:seat`, as possible equivocation rivals. */
  private readonly candidates = new Map<string, Map<Hex, Candidate>>();
  /** Keys of `candidates` that hold two moves or more. */
  private readonly rivalKeys = new Set<string>();
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

  /** Verified deck secrets by seat, each with the earliest `created_at` among its verified copies. */
  private readonly secrets = new Map<number, { x: bigint; at: number }>();
  /** Secret reveal events folded in, by id. */
  private readonly secretIds = new Set<Hex>();
  /** The R6 audit, run once every secret is in (phase `done`); `pending` until then. */
  private auditResult: SessionAudit = 'pending';
  /** Well-formed attestations from seated npubs, by id: the seat and its canonical `{audit, logHash, outcome}`. */
  private readonly attests = new Map<Hex, { seat: number; content: string }>();

  /** The module's events on the canonical chain, the last `MAX_EVENTS`; frozen, replaced on every change. */
  private events: readonly unknown[] = Object.freeze([]);

  /**
   * Every well-formed Timeout claim from a seated key against another seat, by id, kept whatever its judgement
   * (at most `MAX_CLAIMS` per signer per head): a claim is judged again whenever the fold or the clock changes.
   */
  private readonly claims = new Map<Hex, Claim>();
  /** Claim ids by the head they name. */
  private readonly claimsByHead = new Map<Hex, Set<Hex>>();
  /** The accepted claim that ended the game (the lowest id among valid ones), or null. The fold stops once set. */
  private decider: Hex | null = null;
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
    this.rootCreatedAt = 0;
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

    const s = new GameSession(input, root, module, rules.value);
    s.rootCreatedAt = (input.root as NostrEvent).created_at;
    return s;
  }

  /* ------------------------------------------------------------------------------------------- intake */

  /** Fold in one event from a peer (or this client's own, fed back). Never throws. `now` is the local clock. */
  receive(ev: unknown, now: number): ReceiveResult {
    this.generation++;
    try {
      this.observe(now);
      return this.intake(ev);
    } catch (e) {
      return { status: 'rejected', reason: `internal error: ${message(e)}` };
    }
  }

  /**
   * Re-check stored Timeout claims against the local clock `now`: a claim received before the clock reached its
   * `created_at` is accepted once it does. Never throws.
   */
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

  private intake(ev: unknown): ReceiveResult {
    const kind = kindOf(ev);
    if (kind === KIND.timeout) return this.intakeTimeout(ev);
    if (kind === KIND.reveal) return this.intakeSecret(ev);
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
    if (this.isKnown(p.id)) return { status: 'duplicate' };
    // Every well-formed move from a seated key is a possible rival, even one rejected before.
    if (parsed.kind === 'move') this.addCandidate(parsed.m, seat);
    const known = this.rejected.get(p.id);
    if (known !== undefined) return { status: 'rejected', reason: known };
    if (parsed.kind === 'shares') return this.intakeShares(parsed.s, seat);
    return this.intakeMove(parsed.m, seat);
  }

  /** Keep a move as a possible rival under its `prev:seq:seat` key. */
  private addCandidate(m: ParsedMove, seat: number): void {
    const key = `${m.prevId}:${m.seq}:${seat}`;
    let group = this.candidates.get(key);
    if (group === undefined) {
      group = new Map();
      this.candidates.set(key, group);
    }
    group.set(m.id, { m, seat });
    if (group.size >= 2) this.rivalKeys.add(key);
  }

  /** Whether the event is on the chain, pooled, or a folded or waiting Shares event. */
  private isKnown(id: Hex): boolean {
    if (this.linked.has(id) || this.sharesSeen.has(id) || this.waitingShares.has(id)) return true;
    for (const moves of this.movesByPrev.values()) if (moves.has(id)) return true;
    return false;
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
    if (m.prevId !== this.headId() && this.linked.has(m.prevId)) {
      // A side branch on an older prev: if it is invalid there, it never will be valid.
      const v = this.validAtPrev(m, seat);
      if (typeof v === 'object') return this.rejectEvent(m.id, v.reject);
    }
    const flagged = this.flagged.join();
    this.pool(m);
    this.settle();
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
  }

  private unpool(m: ParsedMove): void {
    const moves = this.movesByPrev.get(m.prevId);
    if (moves === undefined) return;
    moves.delete(m.id);
    if (moves.size === 0) this.movesByPrev.delete(m.prevId);
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
    if (this.decider !== null) {
      // A timeout ended the game: the fold no longer changes.
      this.waitingShares.set(s.id, s);
      return { status: 'stored' };
    }
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
    return { status: 'accepted' };
  }

  /**
   * Fold a Secret reveal (PROTOCOL §4.7): signed by a seated session key, with `x·G = X_k` for that seat. A
   * secret that arrives before the game is over is kept (`stored`) and counts once it is. A second copy only
   * matters when it is earlier (D030 R3).
   */
  private intakeSecret(ev: unknown): ReceiveResult {
    let s: ParsedSecret;
    try {
      s = parseSecret(ev);
    } catch (e) {
      return { status: 'rejected', reason: message(e) };
    }
    if (s.rootId !== this.root.id) return { status: 'rejected', reason: 'the event is for another game' };
    const seat = this.seatOf.get(s.pubkey);
    if (seat === undefined) return { status: 'rejected', reason: 'not signed by a seated session key' };
    if (this.secretIds.has(s.id)) return { status: 'duplicate' };
    const known = this.rejected.get(s.id);
    if (known !== undefined) return { status: 'rejected', reason: known };
    if (!this.secretMatches(seat, s.deckSecret)) {
      return this.rejectEvent(s.id, `the deck secret does not match seat ${seat}'s deck key`);
    }
    this.secretIds.add(s.id);
    // A timeout ended the game: the fold no longer changes.
    if (this.decider !== null) return { status: 'stored' };
    const held = this.secrets.get(seat);
    if (held !== undefined && held.at <= s.createdAt) return { status: 'duplicate' };
    this.secrets.set(seat, { x: s.deckSecret, at: s.createdAt });
    this.settle();
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
   * Fold a Result attestation (PROTOCOL §4.8): signed by a seated npub, not a session key. It counts once its
   * content equals this session's own audit, logHash and outcome. Before this session has a result it is kept
   * (`stored`); one that does not match is `rejected`, but kept too, since the result may still change as events
   * arrive.
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
    const seen = this.attests.has(a.id);
    const content = canonicalJson({ audit: a.audit, logHash: a.logHash, outcome: a.outcome });
    if (!seen) this.attests.set(a.id, { seat, content });
    const mine = this.attestContent();
    if (mine === null) return { status: seen ? 'duplicate' : 'stored' };
    if (content !== mine) {
      return { status: 'rejected', reason: "the attestation does not match this session's result" };
    }
    return { status: seen ? 'duplicate' : 'accepted' };
  }

  /**
   * Fold a Timeout claim (PROTOCOL §4.6, §8.1, D030 R3–R5): signed by a seated session key, naming another seat.
   * It is `accepted` when it decides the game, `duplicate` when it is valid but a lower-id claim decides, `stored`
   * while its head is unknown or the local clock is behind its `created_at`, and `rejected` otherwise. Every such
   * claim is kept and judged again as events and the clock move, so a rejected claim may still count later.
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
    const known = this.rejected.get(t.id);
    if (known !== undefined) return { status: 'rejected', reason: known };
    if (t.seat >= this.seats) return this.rejectEvent(t.id, `there is no seat ${t.seat}`);
    if (t.seat === claimant) return this.rejectEvent(t.id, 'a seat cannot claim a timeout against itself');
    const seen = this.claims.has(t.id);
    if (!seen && this.claimCount(t.headId, claimant) >= MAX_CLAIMS) {
      return { status: 'rejected', reason: 'claim limit' };
    }
    if (!seen) {
      const claim = { t, claimant };
      this.claims.set(t.id, claim);
      let ids = this.claimsByHead.get(t.headId);
      if (ids === undefined) {
        ids = new Set();
        this.claimsByHead.set(t.headId, ids);
      }
      ids.add(t.id);
      this.decideTimeouts();
    }
    if (this.decider === t.id) return { status: seen ? 'duplicate' : 'accepted' };
    const v = this.judgeClaim(this.claims.get(t.id) as Claim);
    if (typeof v === 'object') return { status: 'rejected', reason: v.reject };
    return { status: seen || v === 'valid' ? 'duplicate' : 'stored' };
  }

  /** How many claims `claimant` has stored against `headId`. */
  private claimCount(headId: Hex, claimant: number): number {
    let n = 0;
    for (const id of this.claimsByHead.get(headId) ?? []) if (this.claims.get(id)?.claimant === claimant) n++;
    return n;
  }

  /**
   * A claim judged against the fold and the clock (D030 R3, R4 and the far-future clamp). Valid when all hold:
   * - its head is the current head;
   * - the named seat is stalled there, counting only shares and secrets dated at or before the claim;
   * - `claim.created_at ≥ P + deadline`, where P is the last progress dated at or before the claim;
   * - the local clock has reached `claim.created_at`.
   * Events dated after the claim are ignored, so a seat cannot put off every claim by dating an event far ahead.
   */
  private judgeClaim(c: Claim): Claimed {
    const t = c.t;
    if (!this.linked.has(t.headId)) return 'wait';
    if (t.headId !== this.headId()) return reject('the claim names an old head');
    if (!this.stalled(t.createdAt).includes(t.seat))
      return reject(`seat ${t.seat} is not stalled at the head`);
    if (t.createdAt < this.progress(t.createdAt) + this.root.deadline) {
      return reject('the claim is dated before the deadline');
    }
    if (this.clock < t.createdAt) return 'early';
    return 'valid';
  }

  /**
   * Settle the timeout: the lowest-id valid claim on the current head decides. Once one decides, the fold stops,
   * so its validity cannot change; a lower-id valid claim on the same head that arrives later takes over.
   */
  private decideTimeouts(): void {
    const ids = this.claimsByHead.get(this.headId());
    if (ids === undefined) return;
    for (const id of [...ids].sort()) {
      if (this.decider !== null && id >= this.decider) return;
      if (this.judgeClaim(this.claims.get(id) as Claim) === 'valid') {
        this.decider = id;
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
    for (const { pos, share } of [...c.shares, ...c.reveals]) this.shares.add(seat, pos, share, m.createdAt);
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
   * the event is rejected as a whole. Only shares for new (seat, position) pairs are kept.
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
    for (const { pos, share } of s.shares)
      if (this.shares.add(seat, pos, share, s.createdAt) !== 'none') changed = true;
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
   * the phase steps the events allow, then re-examine forks, until nothing changes. Then flag equivocators and
   * judge the stored timeout claims. Once a timeout has ended the game, nothing changes any more.
   */
  private settle(): void {
    if (this.decider !== null) return;
    for (;;) {
      this.extend();
      if (!this.resolveForks()) break;
    }
    this.flagged = this.equivocators();
    this.decideTimeouts();
  }

  /** Link pooled moves at the head, lowest id first among those that fold, and quiesce, until nothing applies. */
  private extend(): void {
    for (;;) {
      let progressed = false;
      const waiting = this.movesByPrev.get(this.headId());
      if (waiting !== undefined) {
        for (const m of byId(waiting.values())) {
          const r = this.foldMove(m, this.seatOf.get(m.pubkey) as number);
          if (r === 'accepted') {
            progressed = true;
            break;
          }
          if (r !== 'wait') this.dropMove(m, r.reject);
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
   * Re-choose the chain at every fork point where a side branch could beat the current one (D030 Ruling 5): at a
   * prev on the chain, the successor heading the longest valid branch wins, ties going to the lowest id. A side
   * branch is examined only when its pooled depth, an upper bound on its valid length, reaches the chain's length
   * past that prev. Returns true when the chain changed.
   */
  private resolveForks(): boolean {
    for (let j = 0; j < this.chain.length; j++) {
      const prev = this.idAt(j);
      const side = this.movesByPrev.get(prev);
      if (side === undefined || this.forkSeen.get(prev) === this.generation) continue;
      this.forkSeen.set(prev, this.generation);
      const cur = this.chain.length - j;
      const top = (this.chain[j] as ParsedMove).id;
      const depths = new Map<Hex, number>();
      const contender = [...side.values()].some((m) => {
        const bound = 1 + this.poolDepth(m.id, depths);
        return bound > cur || (bound === cur && m.id < top);
      });
      if (!contender) continue;
      const before = this.chain.slice(j).map((m) => m.id);
      this.truncate(j);
      for (const m of this.bestExtension()) this.tryLink(m);
      if (canonicalJson(this.chain.slice(j).map((m) => m.id)) !== canonicalJson(before)) return true;
    }
    return false;
  }

  /** The longest chain of pooled moves below `id`, ignoring validity. */
  private poolDepth(id: Hex, memo: Map<Hex, number>): number {
    const known = memo.get(id);
    if (known !== undefined) return known;
    let out = 0;
    const kids = this.movesByPrev.get(id);
    if (kids !== undefined) for (const k of kids.keys()) out = Math.max(out, 1 + this.poolDepth(k, memo));
    memo.set(id, out);
    return out;
  }

  /**
   * The longest valid branch from the head, by trial: link each pooled successor in id order, recurse, and cut
   * back. Ties keep the lowest id. Leaves the fold at the head it started from.
   */
  private bestExtension(): ParsedMove[] {
    const h = this.chain.length;
    const kids = this.movesByPrev.get(this.headId());
    if (kids === undefined) return [];
    let best: ParsedMove[] = [];
    for (const k of byId(kids.values())) {
      if (!this.tryLink(k)) continue;
      const branch = [k, ...this.bestExtension()];
      this.truncate(h);
      if (branch.length > best.length) best = branch;
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
    if (r !== 'wait') this.dropMove(m, r.reject);
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
      for (const { pos, share } of s.shares) this.shares.add(seat, pos, share, s.createdAt);
    }
    for (const m of this.chain) {
      if (m.content.type !== 'action') continue;
      const seat = this.seatOf.get(m.pubkey) as number;
      for (const { pos, share } of [...m.content.shares, ...m.content.reveals]) {
        this.shares.add(seat, pos, share, m.createdAt);
      }
    }
  }

  /* ------------------------------------------------------------------------------------- equivocation */

  /**
   * The seats with two distinct moves on one (prev, seq), the prev on the chain, both valid as of that prev on
   * everything but R1 (D030 R2 as refined by Ruling 3). An invalid move never counts. Ascending.
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
      if (group.filter((m) => this.validAtPrev(m, seat) === 'valid').length >= 2) out.add(seat);
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
    else if (v !== 'unknown') this.validity.set(m.id, v.reject);
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
    if (this.phase === 'end' && this.secrets.size === this.seats) {
      this.auditResult = this.runAudit();
      this.phase = 'done';
      progressed = true;
    }
    if (this.learnPrivate()) progressed = true;
    return progressed;
  }

  /** The R6 audit over this session's log, with every seat's verified secret. */
  private runAudit(): SessionAudit {
    return auditGame({
      module: this.module,
      rules: this.rules,
      seats: this.seats,
      deckId: this.deckId,
      deck: this.finalDeck() as Ciphertext[],
      secrets: Array.from({ length: this.seats }, (_, k) => (this.secrets.get(k) as { x: bigint }).x),
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
   * The game's last progress (D030 R3): the largest `created_at` among the root, the chain's moves, per kept share
   * the earliest verified copy of it, and, once the game is over, per seat the earliest verified secret. It depends
   * only on which events are held, not their arrival order. With `limit`, events dated after it are ignored (the
   * far-future clamp), except the root and the head move, which always count (D030 Ruling 6): a seat that dates
   * its move ahead only gives the next seat more time, and cannot make it claimable at once.
   */
  private progress(limit: number | null): number {
    const counts = (at: number): boolean => limit === null || at <= limit;
    let out = this.rootCreatedAt;
    const head = this.chain[this.chain.length - 1];
    if (head !== undefined && head.createdAt > out) out = head.createdAt;
    for (const m of this.chain) if (counts(m.createdAt) && m.createdAt > out) out = m.createdAt;
    const shares = this.shares.latest(limit);
    if (shares !== null && shares > out) out = shares;
    if (this.phase === 'end' || this.phase === 'done') {
      for (const { at } of this.secrets.values()) if (counts(at) && at > out) out = at;
    }
    return out;
  }

  /**
   * The seats stalled at the head (D030 R4), ascending, counting only shares and secrets dated at or before
   * `limit` (all of them for null):
   * - shuffle: the seat whose step is next;
   * - deal: every seat whose owed deal positions are not all shared;
   * - play: the pending seat, unless the decision needs a card dealt to it that some other seat has not shared,
   *   in which case those seats; for a pending public reveal, the seats missing a share of it;
   * - end: every seat whose secret is not in;
   * - otherwise none.
   */
  private stalled(limit: number | null): number[] {
    const all = Array.from({ length: this.seats }, (_, k) => k);
    switch (this.phase) {
      case 'shuffle':
        return [this.chain.length];
      case 'deal': {
        const dealt = this.module.dealt(this.state);
        return all.filter((k) => this.shares.missing(k, dealt, limit).length > 0);
      }
      case 'play':
        return this.stalledInPlay(all, limit);
      case 'end':
        return all.filter((k) => {
          const s = this.secrets.get(k);
          return s === undefined || (limit !== null && s.at > limit);
        });
      default:
        return [];
    }
  }

  /**
   * The play-phase part of `stalled`. Whether the pending decision needs hidden cards is judged on the public
   * state, so every view agrees: if the module lists actions for the seat with its hand hidden, the seat can act.
   */
  private stalledInPlay(all: readonly number[], limit: number | null): number[] {
    const p = this.module.pending(this.state);
    if (p.type === 'reveal') {
      return all.filter((k) => p.positions.some((pos) => !this.shares.has(k, pos, limit)));
    }
    if (p.type !== 'player') return [];
    const seat = p.seat;
    const needed = this.module
      .dealt(this.state)
      .filter((d) => d.to === seat && d.deck === this.deckId && !this.shares.covered(d.pos, seat, limit))
      .map((d) => d.pos);
    if (needed.length === 0) return [seat];
    if (this.module.legalActions(this.module.view(this.state, null), seat).length > 0) return [seat];
    return all.filter((k) => k !== seat && needed.some((pos) => !this.shares.has(k, pos, limit)));
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
      pendingSince: this.progress(null),
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
    if (this.decider !== null) return this.timeoutStatus(this.decider);
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
   * The result once the claim `id` is accepted (PROTOCOL §8.2, D030 R5), from the fold as it stood then:
   * - before the first game action: `cancelled`, no outcome; the named seat forfeits;
   * - during play: `done` at once, the named seat (and any equivocator) last, the others ranked by the module's
   *   `standings`. The deck cannot be decrypted without every secret, so the audit cannot run: it records the
   *   forfeits instead, `{fail: forfeits, reason: 'timeout'}` (D030 Ruling 7), and the result can be attested;
   * - at the end: `done`, every seat whose secret was not in by the claim's date forfeits for a withheld secret,
   *   and the declared order is adjusted with them (and any equivocator) last; the audit is
   *   `{fail: forfeits, reason: 'withheld secret'}`.
   */
  private timeoutStatus(id: Hex): Status {
    const t = (this.claims.get(id) as Claim).t;
    const actions = this.chain.length > this.seats;
    if (this.phase === 'shuffle' || this.phase === 'deal' || (this.phase === 'play' && !actions)) {
      return {
        phase: 'cancelled',
        outcome: null,
        audit: 'pending',
        forfeits: ascending([t.seat, ...this.flagged]),
      };
    }
    if (this.phase === 'play') {
      const forfeits = ascending([t.seat, ...this.flagged]);
      const outcome = rankWithForfeits(this.module.standings(this.state), forfeits, null);
      return { phase: 'done', outcome, audit: { fail: forfeits, reason: 'timeout' }, forfeits };
    }
    // The end phase: only a seat whose secret is missing can be stalled there.
    const withheld = this.stalled(t.createdAt);
    const declared = this.module.outcome(this.state) as ModuleOutcome;
    const forfeits = ascending([...this.flagged, ...withheld]);
    const outcome = rankWithForfeits(declared.scores, forfeits, declared.places);
    return { phase: 'done', outcome, audit: { fail: [...forfeits], reason: 'withheld secret' }, forfeits };
  }

  /** The canonical `{audit, logHash, outcome}` this session would attest (PROTOCOL §4.8), or null before `done`. */
  private attestContent(): string | null {
    const { phase, outcome, audit } = this.status();
    if (phase !== 'done' || outcome === null || audit === 'pending') return null;
    return canonicalJson({ audit, logHash: this.logHash(), outcome });
  }

  /** The seats with an attestation that matches this session's result, ascending. */
  private attested(): number[] {
    const mine = this.attestContent();
    if (mine === null) return [];
    return ascending([...this.attests.values()].filter((a) => a.content === mine).map((a) => a.seat));
  }

  /** During the shuffle, the next shuffler; afterwards, the module's pending decision. A fresh copy. */
  private pending(): Pending {
    if (this.phase === 'shuffle') return { type: 'player', seat: this.chain.length, decision: 'shuffle' };
    const p = this.module.pending(this.state);
    return p.type === 'reveal' ? { type: 'reveal', deck: p.deck, positions: [...p.positions] } : { ...p };
  }

  /** What this seat must publish next, as of the canonical head. Spectators have none. */
  duties(): Duty[] {
    const me = this.me;
    if (me === null) return [];
    // After a timeout only the attestation can be due.
    const live = this.decider === null;
    if (live && this.phase === 'shuffle' && this.chain.length === me.seat) return [{ kind: 'shuffle' }];
    if (
      live &&
      this.phase === 'deal' &&
      this.shares.missing(me.seat, this.module.dealt(this.state)).length > 0
    ) {
      return [{ kind: 'deal' }];
    }
    if (this.decides(me)) return [{ kind: 'decide' }];
    if (live && this.phase === 'end' && !this.secrets.has(me.seat)) return [{ kind: 'secret' }];
    // Attesting is a SHOULD (PROTOCOL §7): the duty is advisory.
    if (this.attestContent() !== null && !this.attested().includes(me.seat)) return [{ kind: 'attest' }];
    return [];
  }

  /**
   * Whether the play phase pends `me`'s decision and the module lists legal actions for it (D030 Ruling 4). A
   * module lists none while their legality depends on hidden cards this seat has not learned, so the list is
   * exact whenever it is not empty.
   */
  private decides(me: Identity): boolean {
    if (this.phase !== 'play' || this.decider !== null) return false;
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
    const me = this.requireDuty('deal');
    const deck = this.finalDeck() as Ciphertext[];
    const shares = this.shares.missing(me.seat, this.module.dealt(this.state)).map((pos) => ({
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
    const shares = this.shares.missing(me.seat, this.module.dealt(this.state)).map(share);
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
   * The lowest seat other than mine that is stalled at the head, once `now ≥ P + deadline` with P the last
   * progress dated at or before `now` (D030 R3, R4); otherwise null. Null for a spectator, and once a timeout has
   * ended the game.
   */
  timeoutTarget(now: number): number | null {
    const me = this.me;
    if (me === null || this.decider !== null) return null;
    if (now < this.progress(now) + this.root.deadline) return null;
    return this.stalled(now).find((k) => k !== me.seat) ?? null;
  }

  /**
   * My Timeout claim (PROTOCOL §4.6) against `seat`, naming the current head and dated `createdAt`. Throws
   * `ClientError` for a spectator, once a timeout has ended the game, or unless `seat` is another seat stalled at
   * the head with the deadline passed by `createdAt` (as `timeoutTarget(createdAt)` judges it). Other clients
   * accept it once their own clock reaches `createdAt`.
   */
  buildTimeout(seat: number, rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireMe();
    if (this.decider !== null) throw new ClientError('a timeout has already ended the game');
    if (seat === me.seat) throw new ClientError('a seat cannot claim a timeout against itself');
    if (!this.stalled(createdAt).includes(seat))
      throw new ClientError(`seat ${seat} is not stalled at the head`);
    if (createdAt < this.progress(createdAt) + this.root.deadline) {
      throw new ClientError(`the deadline for seat ${seat} has not passed`);
    }
    const t = timeoutTemplate({ rootId: this.root.id, headId: this.headId(), seat }, createdAt);
    return finalizeEvent(t, me.sessionSk, rnd);
  }
}
