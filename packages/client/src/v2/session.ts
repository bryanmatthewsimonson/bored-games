import {
  type Ciphertext,
  type Point as CurvePoint,
  cardTable,
  G,
  initialDeck,
  jointKey,
  makeMoveRollShare,
  makeShare,
  proveShuffle,
  type RandomBytes,
  shuffleDeck,
} from '@bored-games/deck';
import { canonicalJson, deepFreeze, type Outcome as ModuleOutcome, moduleFor } from '@bored-games/game-kit';
import {
  cardSharesTemplate,
  type EventTemplate,
  endAttestTemplate,
  finalizeEvent,
  getPublicKey,
  type Hex,
  KIND,
  moveTemplate,
  type NostrEvent,
  type Outcome,
  type ParsedEndAttest,
  type ParsedJoin,
  type ParsedMove,
  type ParsedRollShares,
  type ParsedRoot,
  type ParsedStatsAttest,
  type PosShare,
  ProtocolError,
  parseAttestV2,
  parseDeviceNote,
  parseJoin,
  parseResign,
  parseRoot,
  parseSecret,
  parseSharesV2,
  parseTable,
  parseTimeout,
  rollSharesTemplate,
  secretTemplate,
  attestTemplate as statsTemplate,
  timeoutTemplate,
  validateRoot,
} from '@bored-games/protocol';
import { auditGame, auditPrefix, clipReason, type LoggedAction, rankWithForfeits } from '../audit.ts';
import { ClientError } from '../errors.ts';
import { deckPartitions, parsePartitionMove, shuffleStepGroup } from '../partitioned-deck.ts';
import type { Session } from '../session-api.ts';
import type {
  Duty,
  Identity,
  Phase,
  ReceiveResult,
  ResultId,
  SessionAudit,
  SessionInput,
  SessionViewV2,
} from '../types.ts';
import { standingResult } from './cutoff.ts';
import type { LineFold } from './line.ts';
import { moveShape, nextShuffler, pendingAt } from './line.ts';
import {
  attestedResult,
  endAttestedSeats,
  endProblem,
  endVerdict,
  lineLogHash,
  ownResult,
  resignScoring,
  type Scoring,
} from './results.ts';
import { contributions, rollEventProblem } from './rolls.ts';
import { cardSharesProblem, DeckCaches, type LineShares, shareCtx } from './shares.ts';
import { SideLines } from './sides.ts';
import {
  type AfterStopAudit,
  demotedBy,
  partialAudit,
  type Stop,
  standingsAt,
  stopAt,
  stopOutcome,
} from './stop.ts';
import { EventStoreV2, type Kept, resultKey } from './store.ts';
import type { AnyModule, GameCtx, HeldMove, Judgement, LinePoint } from './types.ts';
import { type Walk, walk } from './walk.ts';

/*
 * GameSessionV2: the protocol 2 fold over one game's signed events (PROTOCOL-v2; build plan D-E). Events may arrive
 * in any order and more than once. Each is parsed strictly at the game's proto ("2"), checked against the root's
 * seats and kept in the event store (`store.ts`) or rejected. The walk (`walk.ts`) is then recomputed from the
 * root: there is no fork choice. The game's result, its end attestations and the duties are functions of the held
 * events and the walk, so every client that holds the same events reaches the same state (V2-20).
 *
 * Built so far (tasks T7 to T11): intake of every kind, seats by session key (and by npub for attestations), the walk
 * with C(h) and the topmost fork, play to `over` with the
 * module's audit, end attestations (built with the session key, counted with either key, checked against the line
 * to their head) and the npub's stats attestation. With a deck (T8): the shuffle (partitioned decks included), the
 * deal (a card Shares event anchored on the last shuffle step), card Shares events verified against each line's
 * final deck, derived reveals and learns, prompt release (`release` duty, PROTOCOL-v2 §6.1) beside the slow path
 * (owed shares on game actions), the Secret phase and the full audit at `over`. `DeckSpec.promptShares` is
 * ignored (§6.3). With dice (T9, §6.2): roll Shares events kept in a roll store by (seat, requesting move, index),
 * derived rolls along the walk, the `roll` duty and `buildRoll`, and stalls on a pending beacon. The stop (T10,
 * §5.6, `stop.ts`): a held fork with no result standing stops the game at P, cancelled only when no game action is
 * held at or past P on a valid line (H1), otherwise scored with every M1 equivocator last (`equivocators.ts`, over
 * side lines folded by `sides.ts`); while stopped nothing is owed but, in a deck game, the Secret reveal, and the
 * partial audit runs once the held secrets and shares decrypt every position (§7.3). The cutoff (T11, §5.4,
 * `cutoff.ts`): a valid result (§5.3, `results.ts`) attested by every seat but E, with nothing off its line by
 * another seat, and alone, stands against the fork, which then only records E; it is played out as if no fork were
 * held (N1): scored at its head (S for a Resign), with the End phase's stalls, claims (a withheld secret, by this
 * client's own clock), Secret reveals and audit. Not yet: Timeout claims and Resigns counted with no fork held
 * (T12; both are held, and read by the cutoff), the outbox rule and the rebroadcast set (T13).
 */

/** The module events `view().events` keeps (as v1). */
const MAX_EVENTS = 300;

/** Audits kept by log hash. */
const MAX_AUDITS = 8;

const ascending = (xs: Iterable<number>): number[] => [...new Set(xs)].sort((a, b) => a - b);

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

/** The result, audit and phase the view reports. */
interface Status {
  phase: Phase;
  outcome: Outcome | null;
  audit: SessionAudit;
  forfeits: number[];
}

/**
 * The game's result (PROTOCOL-v2 §5.5) and where it is scored: this client's own result with no fork held, or the
 * result standing against a held fork (§5.4), which is played out as if no fork were held (review N1).
 */
interface Ending {
  readonly r: ResultId;
  /** The line the result is scored on, its point at `seq`: the result's head, or S for a Resign (§8.3). */
  readonly fold: LineFold;
  readonly seq: number;
  readonly point: LinePoint;
  /** The module is over at the point: an `over` result, or a Resign whose S is over (v1 §8.3 step 4). */
  readonly over: boolean;
  /**
   * The End phase's key, for the claims accepted in it and when the result first stood: the result's identity
   * (`resultKey`), not its point, so a later move of a Resign's S neither drops an accepted claim nor restarts the
   * deadline (D069, review of T11 L1).
   */
  readonly key: string;
}

export class GameSessionV2 implements Session {
  readonly proto = 2 as const;

  private readonly ctx: GameCtx;
  private readonly module: AnyModule;
  private readonly root: ParsedRoot;
  private readonly seatOf: ReadonlyMap<Hex, number>;
  /** Each seat by its npub, which may sign end attestations and signs stats attestations (PROTOCOL-v2 §4.3). */
  private readonly npubSeat: ReadonlyMap<Hex, number>;
  private readonly me: Identity | null;
  private readonly rootSeenAt: number;

  private readonly store: EventStoreV2;
  /** When this client first saw each held event (its first `receive`), for the progress time P. */
  private readonly seenAt = new Map<Hex, number>();
  /**
   * The latest first-seen time of any event received (`see`): a result first standing here stands no earlier than
   * it (`noteStanding`), so a refeed in another order with saved first-seen times never moves the End-phase deadline
   * earlier (D069, review of T11 L2).
   */
  private lastSeen = Number.NEGATIVE_INFINITY;
  /** Events refused for good, by id, with the reason: they are not held. */
  private readonly rejected = new Map<Hex, string>();
  /** Judgements that never change, by move id and the log length at its prev (`walk`, deckless games only). */
  private readonly judgements = new Map<string, Judgement>();
  /** Crypto results by event (shuffle proofs, share verification, decryptions). */
  private readonly caches = new DeckCaches();
  /**
   * The latest first-seen time of a Shares event or secret that let the walk advance or removed a seat from the
   * stall set at the head (v1 §8.1, D030 Ruling 11): part of the progress time P.
   */
  private stallProgress = Number.NEGATIVE_INFINITY;
  private current: Walk;
  /**
   * The stop at the walk's fork (PROTOCOL-v2 §5.6), computed when first needed after each held event (it reads side
   * lines, whose validity any held event may change); undefined until then, null while no fork is held.
   */
  private stopCache: Stop | null | undefined = undefined;
  /**
   * The side lines folded for the stop and the cutoff (`SideLines`), made when first needed; dropped, with the stop,
   * whenever a Move or a Shares event is held (`lineChanged`), the only events that can change a line's validity
   * (review of T10, L3).
   */
  private sideCache: SideLines | undefined = undefined;
  /** Resign scoring positions by `${head}|${seat}`, dropped with the side lines. */
  private scoringMemo = new Map<string, Scoring | null>();
  /**
   * The result standing against the walk's fork (the cutoff, §5.4) and the game's result with its scoring point,
   * computed when first needed; dropped whenever a Move, Shares event, end attestation, Timeout claim or Resign is
   * held (the events the cutoff and §5.3 read).
   */
  private verdictCache: { standing: ResultId | null; ending: Ending | null } | undefined = undefined;
  /**
   * End-phase claims this client accepted (v1 §8.1 "End", §8.2 "At the end"), by End-phase key (`Ending.key`): the
   * claim's id and every seat stalled when it was accepted (whose secret was missing). Final for that result, as
   * v1's accepted claims (§8.2 "Finality").
   */
  private readonly endClaims = new Map<string, { id: Hex; seats: number[] }>();
  /**
   * When each result first stood against a held fork on this client: its first-seen time of the event after which
   * the cutoff first held it (coordinator ruling on D068, PROTOCOL-v2 §5.4, §8.1), by End-phase key. The End-phase
   * deadline of a standing result runs from it when it is later than the progress on the result's line, so late
   * attestations never make a seat claimable at once.
   */
  private readonly stoodSince = new Map<string, number>();
  /** The partial audit after a stop, by P, once it ran (its verdict depends on P's line alone). */
  private readonly stopAudits = new Map<Hex, AfterStopAudit>();
  /** Audits by the log hash of the line they ran on. */
  private readonly audits = new Map<Hex, SessionAudit>();
  /** The latest local clock reading seen by `receive` or `tick`. */
  private clock: number;

  private constructor(input: SessionInput, root: ParsedRoot, module: AnyModule, rules: unknown) {
    this.module = module;
    this.root = root;
    const deck = module.decks(rules)[0] ?? null;
    const partitions = deckPartitions(deck);
    const keys = root.seats.map((s) => s.deckKey);
    this.ctx = {
      module,
      rules,
      rootId: root.id,
      seats: root.seats.length,
      deckId: deck?.id ?? null,
      deckSize: deck?.size ?? 0,
      partitions,
      shuffleSteps: partitions.length * root.seats.length,
      keys,
      X: jointKey(keys),
      initialDeck: deck === null ? [] : initialDeck(deck.id, deck.size),
      cards: deck === null ? new Map() : cardTable(deck.id, deck.size),
      viewer: input.me?.seat ?? null,
      viewerSecret: input.me?.deckSecret ?? null,
    };
    this.seatOf = new Map(root.seats.map((s, i) => [s.session, i]));
    this.npubSeat = new Map(root.seats.map((s, i) => [s.npub, i]));
    this.me = input.me === null ? null : { ...input.me, sessionSk: input.me.sessionSk.slice() };
    this.rootSeenAt = input.rootSeenAt;
    this.clock = input.rootSeenAt;
    this.store = new EventStoreV2(root.id);
    this.current = walk(this.ctx, this.store, this.judgements, this.caches);
  }

  /**
   * A session for the protocol 2 game started by `input.root`. Throws `ClientError` when the table or root does
   * not parse, the root is not proto 2 (a v1 game is `GameSession`'s, for good), the root is not a valid start of
   * the game (`validateRoot`, which also requires that the module version supports proto 2), no module folds it, or
   * `me` does not hold the seat it names.
   * `input.confirmedForfeits` is read from T12 (the own-forfeit question).
   */
  static create(input: SessionInput): GameSessionV2 {
    let table: ReturnType<typeof parseTable>;
    let root: ParsedRoot;
    try {
      table = parseTable(input.table);
      root = parseRoot(input.root);
    } catch (e) {
      throw new ClientError(`the table or root does not parse: ${message(e)}`);
    }
    if (root.proto !== '2') throw new ClientError(`the root is proto ${root.proto}, not a v2 game`);
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
    const module: AnyModule | undefined = moduleFor(input.modules, root.game, root.version);
    if (module === undefined)
      throw new ClientError(`there is no module for game ${root.game} ${root.version}`);
    const rules = module.validateRules(root.rules);
    if (!rules.ok) throw new ClientError(`invalid rules: ${rules.error.message}`);
    const decks = module.decks(rules.value);
    if (decks.length > 1) throw new ClientError(`a session supports one deck or none, not ${decks.length}`);

    const me = input.me;
    if (me !== null) {
      const seat = root.seats[me.seat];
      if (!Number.isSafeInteger(me.seat) || seat === undefined) throw new ClientError(`no seat ${me.seat}`);
      let session: Hex;
      let deckKey: CurvePoint;
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
    return new GameSessionV2(input, root, module, rules.value);
  }

  /* ------------------------------------------------------------------------------------------- intake */

  /**
   * Fold in one event from a peer (or this client's own, fed back). Never throws. `now` is the local clock, and the
   * time this client first saw `ev`. The result says what happened to the event:
   * - a Move is `accepted` when it is on the walk or one of the valid-looking successors of the fork the walk ends
   *   at, `rejected` when it can never be valid-looking at its prev (it is still held: every held move counts for
   *   the cutoff, PROTOCOL-v2 §5.4), and `stored` otherwise;
   * - an end attestation is `accepted` when it is a valid attestation of this client's result, `rejected` when its
   *   log hash does not match the line to its head, and `stored` otherwise (unresolved, or another result);
   * - a Timeout claim is `accepted` when it is the End-phase claim this client accepts (a withheld secret, v1 §8.1),
   *   otherwise `stored` (claims during play count from T12); Resigns are `stored` (they count as results through
   *   the cutoff, and with no fork held from T12), and Device notes `accepted` (stored only).
   */
  receive(ev: unknown, now: number): ReceiveResult {
    try {
      this.observe(now);
      const r = this.intake(ev, this.clockOf(now));
      this.noteStanding(this.clockOf(now));
      this.decideEndClaim();
      return r;
    } catch (e) {
      return { status: 'rejected', reason: `internal error: ${message(e)}` };
    }
  }

  /**
   * Advance the local clock. Never throws. An End-phase claim (a withheld secret) may count once this client's own
   * deadline passes (v1 §8.1); claims during play are judged from T12.
   */
  tick(now: number): void {
    try {
      this.observe(now);
      this.decideEndClaim();
    } catch {
      // never throws
    }
  }

  private observe(now: number): void {
    if (typeof now === 'number' && Number.isFinite(now) && now > this.clock) this.clock = now;
  }

  private clockOf(now: number): number {
    return typeof now === 'number' && Number.isFinite(now) ? now : this.clock;
  }

  private see(id: Hex, now: number): void {
    if (!this.seenAt.has(id)) this.seenAt.set(id, now);
    this.lastSeen = Math.max(this.lastSeen, now);
  }

  /**
   * Apply what a claim or Resign cap did (`Kept`, D069): ids refused for good are recorded in `rejected`; waiting ids
   * let go are forgotten (a later delivery is judged again). The answer for `id` when the cap refused it, else null.
   */
  private settle(id: Hex, kept: Kept, why: string): ReceiveResult | null {
    for (const x of kept.final) this.rejected.set(x, why);
    for (const x of kept.dropped) this.seenAt.delete(x);
    if (kept.final.includes(id)) return { status: 'rejected', reason: why };
    if (!kept.kept) return { status: 'rejected', reason: `${why}: too many waiting for their head` };
    return null;
  }

  private reject(id: Hex, reason: string): ReceiveResult {
    this.rejected.set(id, reason);
    return { status: 'rejected', reason };
  }

  private intake(ev: unknown, now: number): ReceiveResult {
    const id = idOf(ev);
    if (id !== null) {
      // A known event is answered before it is parsed again (its id was authenticated when it was parsed).
      const why = this.rejected.get(id);
      if (why !== undefined) return { status: 'rejected', reason: why };
      if (this.seenAt.has(id) || this.store.statsIds.has(id)) return this.again(id);
    }
    switch (kindOf(ev)) {
      case KIND.move:
        return this.intakeMove(ev, now);
      case KIND.shares:
        return this.intakeShares(ev, now);
      case KIND.timeout:
        return this.intakeTimeout(ev, now);
      case KIND.reveal:
        return this.intakeSecret(ev, now);
      case KIND.attest:
        return this.intakeAttest(ev, now);
      case KIND.resign:
        return this.intakeResign(ev, now);
      case KIND.device:
        return this.intakeDevice(ev, now);
      default:
        return { status: 'rejected', reason: `kind ${String(kindOf(ev))} is not an in-game event` };
    }
  }

  /**
   * The answer for a held event received again: a move that can never be valid (judged invalid at its prev, or of a
   * bad shape wherever it lies), an invalid end attestation and an invalid Shares event stay `rejected`; anything
   * else is a `duplicate`.
   */
  private again(id: Hex): ReceiveResult {
    const held = this.store.moves.get(id);
    if (held !== undefined) {
      const j = this.current.judged.get(id);
      if (j?.kind === 'invalid') return { status: 'rejected', reason: j.why };
      if (held.shape !== null) return { status: 'rejected', reason: held.shape };
      return { status: 'duplicate' };
    }
    const end = this.store.ends.get(id);
    if (end !== undefined) {
      const bad = endProblem(this.store, this.ctx.seats, end.ev);
      return bad === null ? { status: 'duplicate' } : { status: 'rejected', reason: bad };
    }
    if (this.store.cardShares.has(id) || this.store.rollShares.has(id)) {
      const bad = this.sharesProblem(id);
      return bad === null ? { status: 'duplicate' } : { status: 'rejected', reason: bad };
    }
    return { status: 'duplicate' };
  }

  /** The seat of a seated session key, or a rejection. */
  private sessionSeat(p: { id: Hex; pubkey: Hex; rootId: Hex }): number | ReceiveResult {
    if (p.rootId !== this.root.id) return { status: 'rejected', reason: 'the event is for another game' };
    const seat = this.seatOf.get(p.pubkey);
    if (seat === undefined) return { status: 'rejected', reason: 'not signed by a seated session key' };
    return seat;
  }

  private intakeMove(ev: unknown, now: number): ReceiveResult {
    let m: ParsedMove;
    try {
      // A deckless game parses with a 1-card deck, so that a shuffle step gets the shape check's clear reason.
      m = parsePartitionMove(ev, this.ctx.deckSize, this.ctx.partitions, '2');
    } catch (e) {
      return { status: 'rejected', reason: message(e) };
    }
    const seat = this.sessionSeat(m);
    if (typeof seat !== 'number') return seat;
    this.see(m.id, now);
    this.store.addMove({ m, seat, shape: moveShape(this.ctx, m, seat) });
    // Claims and Resigns waiting for this move are kept now (D069); the refold drops the verdict too.
    if (this.store.promote(m.id)) this.cutoffChanged();
    this.refold();
    return this.moveStatus(m.id);
  }

  /** How a held move stands on the current walk. */
  private moveStatus(id: Hex): ReceiveResult {
    const w = this.current;
    if (w.chain.some((h) => h.m.id === id) || w.fork?.successors.includes(id) === true)
      return { status: 'accepted' };
    const j = w.judged.get(id);
    if (j?.kind === 'invalid') return { status: 'rejected', reason: j.why };
    const shape = this.store.moves.get(id)?.shape ?? null;
    if (shape !== null) return { status: 'rejected', reason: shape };
    return { status: 'stored' };
  }

  /**
   * A v2 Shares event (PROTOCOL-v2 §4.2). Once it parses with a seated signer it is held, whatever its validity
   * (D066, V2-56): rule (b) of the cutoff and the rebroadcast count it. A card variant is invalid in a game without
   * a deck, and a roll variant in a game whose module does not roll (V2-08): both are held and reported `rejected`.
   * A card variant in a game with a deck is verified against the walk's final deck (§4.2): `rejected` when a share
   * fails or a position is outside the deck (it is still held, and kept out of the share pool), `stored` before the
   * final deck is complete, `accepted` when it brings a share the walk did not hold, `duplicate` otherwise. A roll
   * variant in a game that rolls (§6.2) is `rejected` when its requesting move is held but is not a game action, a
   * contribution does not verify against that move's points (V2-32), or the move is on the chain and requested fewer
   * rolls than it names (all still held); `stored` while the move is not held (it waits) or not on the chain (with
   * no proof checked: judged on its move's line when that is folded, §4.2);
   * `accepted` when it brings a contribution by its seat to a roll of a move on the chain that the roll store did not
   * hold (the walk is folded again, and the roll may be derived); `duplicate` otherwise (another device of the seat,
   * with the same `D`: Shares events are not moves, so this is never a fork).
   */
  private intakeShares(ev: unknown, now: number): ReceiveResult {
    let s: ReturnType<typeof parseSharesV2>;
    try {
      s = parseSharesV2(ev);
    } catch (e) {
      return { status: 'rejected', reason: message(e) };
    }
    const seat = this.sessionSeat(s);
    if (typeof seat !== 'number') return seat;
    this.see(s.id, now);
    // A roll event is measured before it is held: the roll store reads the held events directly.
    const rollBefore = s.type === 'roll' ? { kept: this.keptRolls(s.moveId), mark: this.stallMark() } : null;
    this.store.addShares(s, seat);
    // A held Shares event may complete a side line's owed shares or a roll there, even when the walk ignores it.
    this.lineChanged();
    const bad = this.sharesProblem(s.id);
    if (bad !== null) return { status: 'rejected', reason: bad };
    if (s.type === 'roll') {
      const was = rollBefore as { kept: number; mark: { head: Hex; stalled: number[] } };
      // Not a requesting move on the walk (not held, off the walk, or no roll requested there and judged above).
      if (!this.current.requests.has(s.moveId)) return { status: 'stored' };
      // Only a contribution new to the roll store can change the walk (every valid one of a (seat, M, n) has the
      // same D).
      if (this.keptRolls(s.moveId) === was.kept) return { status: 'duplicate' };
      this.refold();
      this.noteProgress(was.mark, s.id);
      return { status: 'accepted' };
    }
    const head = this.finalDeck();
    if (s.type !== 'shares' || head === null) return { status: 'stored' };
    // New to the final deck's pool: it may change any point of the walk, so the walk is folded again. A share the
    // pool holds already changes nothing (every valid share of a (seat, position) has the same D).
    const pool = this.caches.pools.get(head.key)?.shares;
    if (pool !== undefined && s.shares.every(({ pos }) => pool.has(seat, pos)))
      return { status: 'duplicate' };
    const before = this.stallMark();
    this.refold();
    this.noteProgress(before, s.id);
    return { status: 'accepted' };
  }

  /**
   * Why held Shares event `id` is invalid, or null: a variant the game cannot have (V2-08), a card variant whose
   * shares fail against the walk's final deck (null while there is none: it waits), or a roll variant that
   * `rollProblem` finds invalid.
   */
  private sharesProblem(id: Hex): string | null {
    const card = this.store.cardShares.get(id);
    if (card !== undefined) {
      if (this.ctx.deckId === null) return 'a card Shares event in a game without a deck';
      const head = this.finalDeck();
      if (head === null) return null;
      return cardSharesProblem(this.ctx, this.caches, head.key, head.deck, id, card.seat, card.ev.shares);
    }
    if (typeof this.module.rolls !== 'function') return 'a roll Shares event in a game that does not roll';
    const roll = this.store.rollShares.get(id);
    return roll === undefined ? null : this.rollProblem(roll.ev, roll.seat);
  }

  /**
   * Why roll Shares event `ev` by `seat` is invalid as a whole (PROTOCOL-v2 §4.2), or null: its requesting move is
   * held but is not a game action; a contribution does not verify against the move's points (V2-32); or the move is
   * on the chain and requested fewer rolls than the event names (checked before any proof). Null while the move is
   * not held (it waits), and for a held game action off the chain: how many rolls it requested is a fact of its
   * line, so the event is judged on that line when it is folded (PROTOCOL-v2 §4.2; a side line the cutoff needs,
   * T11). Until then nothing is verified for it (review of T9, L3): the walk never reads it.
   */
  private rollProblem(ev: ParsedRollShares, seat: number): string | null {
    const move = this.store.moves.get(ev.moveId);
    if (move === undefined) return null;
    if (move.m.content.type !== 'action') return `the requesting move ${ev.moveId} is not a game action`;
    if (this.chainSeq(ev.moveId) === null) return null;
    const requested = this.current.requests.get(ev.moveId) ?? 0;
    return rollEventProblem(this.ctx, this.caches.rolls, seat, ev, requested);
  }

  /** How many (seat, n) contributions the roll store keeps for requesting move `move`, while it is on the chain. */
  private keptRolls(move: Hex): number {
    const requested = this.current.requests.get(move);
    if (requested === undefined) return 0;
    let n = 0;
    for (const slots of contributions(this.ctx, this.store, this.caches.rolls, move, requested))
      for (const x of slots) if (x !== null) n++;
    return n;
  }

  /** The walk's final deck and its key, once the shuffle is complete on it; null before and in a deckless game. */
  private finalDeck(): { key: Hex; deck: readonly Ciphertext[] } | null {
    if (this.ctx.deckId === null) return null;
    const point = this.current.line.points[this.ctx.shuffleSteps];
    if (point === undefined || point.deckKey === null) return null;
    return { key: point.deckKey, deck: point.deck };
  }

  /**
   * A Timeout claim (v1 §4.6 at proto 2): kept within the caps. It makes a `claim` result valid (§5.3, the cutoff),
   * and in an End phase it may count for a withheld secret (`decideEndClaim`); claims during play count from T12.
   */
  private intakeTimeout(ev: unknown, now: number): ReceiveResult {
    let t: ReturnType<typeof parseTimeout>;
    try {
      t = parseTimeout(ev, '2');
    } catch (e) {
      return { status: 'rejected', reason: message(e) };
    }
    const claimant = this.sessionSeat(t);
    if (typeof claimant !== 'number') return claimant;
    this.see(t.id, now);
    if (t.seat >= this.ctx.seats) return this.reject(t.id, `there is no seat ${t.seat}`);
    if (t.seat === claimant) return this.reject(t.id, 'a seat cannot claim a timeout against itself');
    const kept = this.store.keepClaim(t, claimant);
    const refused = this.settle(t.id, kept, 'claim limit');
    if (refused !== null) return refused;
    this.cutoffChanged();
    this.decideEndClaim();
    for (const c of this.endClaims.values()) if (c.id === t.id) return { status: 'accepted' };
    return { status: 'stored' };
  }

  /**
   * A Resign (v1 §4.9 at proto 2): with a deck its secret must match the seat's deck key (v1 §8.3 "Validity"); kept
   * within the cap, and its secret counts as the seat's Secret reveal. It makes a `resign` result valid (§5.3, the
   * cutoff); counted with no fork held from T12.
   */
  private intakeResign(ev: unknown, now: number): ReceiveResult {
    let r: ReturnType<typeof parseResign>;
    try {
      r = parseResign(ev, this.ctx.deckId !== null, '2');
    } catch (e) {
      return { status: 'rejected', reason: message(e) };
    }
    const seat = this.sessionSeat(r);
    if (typeof seat !== 'number') return seat;
    this.see(r.id, now);
    if (!this.resignAllowed()) return this.reject(r.id, 'resigning is not allowed in this game');
    if (r.secret !== null && !this.secretMatches(seat, r.secret))
      return this.reject(r.id, `the Resign's deck secret does not match seat ${seat}'s deck key`);
    const before = this.stallMark();
    const known = this.secretOf(seat) !== null;
    // The secret counts whether the Resign is kept, waits or is let go by the waiting cap (v1 §8.3 "The early secret").
    if (!known && r.secret !== null) this.store.resignSecrets.set(seat, r.secret);
    const kept = this.store.keepResign(r, seat);
    this.cutoffChanged();
    if (!known && r.secret !== null) this.noteProgress(before, r.id);
    return this.settle(r.id, kept, 'resign limit') ?? { status: 'stored' };
  }

  /**
   * A Secret reveal (v1 §4.7 at proto 2): a deckless game has none; with a deck, `x·G` must be the seat's deck key.
   * It is kept, and counts once the game is over or stopped and scored (`accepted` then, `stored` before); a seat
   * has one secret, so another event with it is a `duplicate`.
   */
  private intakeSecret(ev: unknown, now: number): ReceiveResult {
    let s: ReturnType<typeof parseSecret>;
    try {
      s = parseSecret(ev, '2');
    } catch (e) {
      return { status: 'rejected', reason: message(e) };
    }
    const seat = this.sessionSeat(s);
    if (typeof seat !== 'number') return seat;
    this.see(s.id, now);
    if (this.ctx.deckId === null) return this.reject(s.id, 'a deckless game has no deck secrets');
    if (!this.secretMatches(seat, s.deckSecret))
      return this.reject(s.id, `the deck secret does not match seat ${seat}'s deck key`);
    const known = this.secretOf(seat) !== null;
    const before = this.stallMark();
    this.store.secrets.set(s.id, { ev: s, seat });
    if (known) return { status: 'duplicate' };
    this.noteProgress(before, s.id);
    return this.result() === null && !this.secretPhaseAfterStop()
      ? { status: 'stored' }
      : { status: 'accepted' };
  }

  /** Whether `x·G` is seat `seat`'s deck key. */
  private secretMatches(seat: number, x: bigint): boolean {
    try {
      return G.multiply(x).equals(this.ctx.keys[seat] as CurvePoint);
    } catch {
      // x = 0 has no point.
      return false;
    }
  }

  /**
   * Seat `seat`'s verified deck secret, or null: from its Secret reveal, or from a Resign it signed (v1 §8.3: the
   * secret of every valid Resign kept counts as that seat's Secret reveal).
   */
  private secretOf(seat: number): bigint | null {
    for (const x of this.store.secrets.values()) if (x.seat === seat) return x.ev.deckSecret;
    return this.store.resignSecrets.get(seat) ?? null;
  }

  /** Whether every seat's deck secret is held. */
  private allSecrets(): boolean {
    for (let k = 0; k < this.ctx.seats; k++) if (this.secretOf(k) === null) return false;
    return true;
  }

  /** The head and the seats stalled there, before an event is folded, for `noteProgress`. */
  private stallMark(): { head: Hex; stalled: number[] } {
    return { head: this.stallHead(), stalled: this.stalled() };
  }

  /** The head the stall set is read at: the result's scoring point once there is a result, else the walk's head. */
  private stallHead(): Hex {
    return this.ending()?.point.id ?? this.head().id;
  }

  /**
   * After Shares event or secret `id` was folded: if it let the walk advance, or removed a seat from the stall set
   * at the head, its first-seen time counts toward P (v1 §8.1, D030 Ruling 11).
   */
  private noteProgress(before: { head: Hex; stalled: number[] }, id: Hex): void {
    const after = this.stallHead() === before.head ? this.stalled() : null;
    if (after !== null && before.stalled.every((k) => after.includes(k))) return;
    this.stallProgress = Math.max(this.stallProgress, this.seenAt.get(id) ?? this.clock);
  }

  /** A Result attestation (PROTOCOL-v2 §4.3): an end attestation or a stats attestation. */
  private intakeAttest(ev: unknown, now: number): ReceiveResult {
    let a: ParsedEndAttest | ParsedStatsAttest;
    try {
      a = parseAttestV2(ev);
    } catch (e) {
      return { status: 'rejected', reason: message(e) };
    }
    if (a.rootId !== this.root.id) return { status: 'rejected', reason: 'the event is for another game' };
    if (a.variant === 'stats') {
      // The stats attestation is the npub's alone (PROTOCOL-v2 §4.3).
      const seat = this.npubSeat.get(a.pubkey);
      if (seat === undefined) return { status: 'rejected', reason: 'not signed by a seated npub' };
      this.store.addStats(a, seat);
      return this.statsStatus(a.id);
    }
    // An end attestation counts for its seat whichever of the seat's keys signed it (V2-11).
    const bySession = this.seatOf.get(a.pubkey);
    const byNpub = this.npubSeat.get(a.pubkey);
    const seat = bySession ?? byNpub;
    if (seat === undefined)
      return { status: 'rejected', reason: 'not signed by a seated session key or npub' };
    this.see(a.id, now);
    // Held whatever its validity (D066, V2-56): rule (b) counts it by its head.
    const first = this.store.addEnd(a, seat, bySession === undefined);
    this.cutoffChanged();
    const bad = endProblem(this.store, this.ctx.seats, a);
    if (bad !== null) return { status: 'rejected', reason: bad };
    if (!first) return { status: 'duplicate' };
    return this.endStatus(a);
  }

  /** How a held, valid-looking end attestation stands: see `receive`. */
  private endStatus(a: ParsedEndAttest): ReceiveResult {
    const mine = this.result();
    if (
      endVerdict(this.store, a) === 'valid' &&
      mine !== null &&
      resultKey(attestedResult(a)) === resultKey(mine)
    )
      return { status: 'accepted' };
    return { status: 'stored' };
  }

  /** How a stats attestation stands, as v1's attestations: matched against this client's result once it has one. */
  private statsStatus(id: Hex): ReceiveResult {
    const kept = [...this.store.stats.values()].find((a) => a.id === id);
    if (kept === undefined) return { status: 'duplicate' };
    const mine = this.statsContent();
    if (mine === null) return { status: 'stored' };
    if (kept.content !== mine)
      return { status: 'rejected', reason: "the attestation does not match this session's result" };
    return { status: 'accepted' };
  }

  /** A Device note (PROTOCOL-v2 §4.4): stored only, until §9.5 is built with the first audit-`'none'` module. */
  private intakeDevice(ev: unknown, now: number): ReceiveResult {
    let d: ReturnType<typeof parseDeviceNote>;
    try {
      d = parseDeviceNote(ev);
    } catch (e) {
      return { status: 'rejected', reason: message(e) };
    }
    const seat = this.sessionSeat(d);
    if (typeof seat !== 'number') return seat;
    this.see(d.id, now);
    this.store.devices.set(d.id, { ev: d, seat });
    return { status: 'accepted' };
  }

  /** Walk the held events again from the root. */
  private refold(): void {
    this.current = walk(this.ctx, this.store, this.judgements, this.caches);
    this.lineChanged();
  }

  /**
   * A Move or a Shares event was held: line validity may have changed, so the side lines and the stop are dropped
   * (recomputed when next needed). Other events (secrets, attestations, claims, Resigns, Device notes) keep them.
   */
  private lineChanged(): void {
    this.sideCache = undefined;
    this.stopCache = undefined;
    this.scoringMemo = new Map();
    this.verdictCache = undefined;
  }

  /** An end attestation, Timeout claim or Resign was held: the cutoff and the result are recomputed when needed. */
  private cutoffChanged(): void {
    this.verdictCache = undefined;
  }

  /** The side lines over the held events and the current walk (`SideLines`), made once per line change. */
  private sides(): SideLines {
    if (this.sideCache === undefined) this.sideCache = new SideLines(this.store, this.current);
    return this.sideCache;
  }

  /* ---------------------------------------------------------------------------------------------- fold */

  private head(): LinePoint {
    const points = this.current.line.points;
    return points[points.length - 1] as LinePoint;
  }

  /**
   * The game's result (PROTOCOL-v2 §5.5): with no fork held, this client's own (the module over on the walk; claims
   * and Resigns counted with no fork held are T12); with a fork held, the result standing against it (§5.4), or
   * null (the game is stopped, `stopNow`). Null while live.
   */
  private result(): ResultId | null {
    return this.verdict().ending?.r ?? null;
  }

  /** The result standing against the walk's fork (the cutoff, §5.4), or null (none or several, or no fork held). */
  private standing(): ResultId | null {
    return this.verdict().standing;
  }

  /** The game's result and where it is scored, or null (`Ending`). */
  private ending(): Ending | null {
    return this.verdict().ending;
  }

  /**
   * The cutoff and the game's result, from the held events (no clock, no arrival order: V2-20). With no fork held the
   * result is this client's own, scored at the walk's head. With a fork held, a standing result X is scored on its
   * own line: at its head, or at S for a Resign (§8.3), which may lie on a side of the fork (review N1).
   */
  private verdict(): { standing: ResultId | null; ending: Ending | null } {
    if (this.verdictCache !== undefined) return this.verdictCache;
    const w = this.current;
    let standing: ResultId | null = null;
    let ending: Ending | null = null;
    if (w.fork === null) {
      const r = ownResult(this.ctx, w);
      if (r !== null) ending = this.endingOf(r, w.fold, w.fold.point.seq);
    } else {
      const sides = this.sides();
      standing = standingResult(this.ctx, this.store, sides, w.fork, (h, k) => this.scoring(h, k));
      if (standing !== null) {
        const k = standing.forfeit[0] as number;
        const at: Scoring | null =
          standing.kind === 'resign'
            ? this.scoring(standing.head, k)
            : (() => {
                const f = sides.fold(standing.head);
                return f === null ? null : { fold: f, seq: f.point.seq };
              })();
        // A standing result is valid, so its line folds: `at` is never null here.
        if (at !== null) ending = this.endingOf(standing, at.fold, at.seq);
      }
    }
    this.verdictCache = { standing, ending };
    return this.verdictCache;
  }

  private endingOf(r: ResultId, fold: LineFold, seq: number): Ending {
    const point = fold.points[seq] as LinePoint;
    const over = point.state !== null && this.module.pending(point.state).type === 'over';
    return { r, fold, seq, point, over, key: resultKey(r) };
  }

  /** A Resign's scoring position S (§8.3), memoised per (head, seat) for one set of held Moves and Shares events. */
  private scoring(head: Hex, k: number): Scoring | null {
    const key = `${head}|${k}`;
    if (this.scoringMemo.has(key)) return this.scoringMemo.get(key) as Scoring | null;
    const s = resignScoring(this.ctx, this.store, this.sides(), head, k);
    this.scoringMemo.set(key, s);
    return s;
  }

  /**
   * The fork's stop analysis (PROTOCOL-v2 §5.6) whenever a fork is held: P, E, the cancel test and the M1
   * equivocators. Equivocators are recorded whether or not a result stands (§5.2, §7.5).
   */
  private forkStop(): Stop | null {
    if (this.current.fork === null) return null;
    if (this.stopCache === undefined)
      this.stopCache = stopAt(this.ctx, this.store, this.current, this.sides());
    return this.stopCache;
  }

  /**
   * The stop at the walk's fork (PROTOCOL-v2 §5.6), or null: no fork held, or a result stands against it (§5.4: the
   * fork then only records E). Otherwise the game is stopped: cancelled, or scored.
   */
  private stopNow(): Stop | null {
    if (this.current.fork === null || this.standing() !== null) return null;
    return this.forkStop();
  }

  /**
   * Whether the after-stop Secret phase applies (§7.3): the game is stopped and scored, it has a deck, and the final
   * deck exists at P (every shuffle step on P's line is linked: P's point has a final-deck key). Below that point
   * there is no card to audit, so no seat owes a secret and none is recorded as withholding one (coordinator
   * ruling, T10 question 1).
   */
  private secretPhaseAfterStop(): boolean {
    const stop = this.stopNow();
    return stop !== null && !stop.cancelled && this.ctx.deckId !== null && this.head().deckKey !== null;
  }

  /**
   * After a scored stop in a deck game (§7.3): the seats whose secret is not held ("secret withheld"), the partial
   * audit (run once the held secrets and shares decrypt every position of the final deck at P, cached by P once it
   * ran), and the seats a proven failure demotes.
   */
  private afterStop(stop: Stop): { withheld: number[]; audit: AfterStopAudit; demoted: number[] } {
    const secrets = Array.from({ length: this.ctx.seats }, (_, k) => this.secretOf(k));
    const withheld = secrets.flatMap((x, k) => (x === null ? [k] : []));
    let audit = this.stopAudits.get(stop.at);
    if (audit === undefined) {
      audit = partialAudit(this.ctx, this.current, secrets);
      if (audit.state === 'ran') this.stopAudits.set(stop.at, audit);
    }
    const demoted = audit.state === 'ran' ? demotedBy(audit.verdict, this.ctx.seats, stop.equivocators) : [];
    return { withheld, audit, demoted };
  }

  /** Whether a seat may resign this game (v1 §8.3, unchanged): never in a 2-seat game with a deck, nor when the module opts out. */
  private resignAllowed(): boolean {
    if (this.ctx.deckId !== null && this.ctx.seats === 2) return false;
    return this.module.resignAllowed?.(this.ctx.rules, this.ctx.seats) ?? true;
  }

  /** Every seat's verified deck secret (the caller checks they are all held). */
  private allSecretsList(): bigint[] {
    return Array.from({ length: this.ctx.seats }, (_, k) => this.secretOf(k) as bigint);
  }

  /**
   * The audit of the line to `e`'s point (PROTOCOL-v2 §7.2, v1 §7), cached by the line's log hash: the full audit
   * (with the outcome compared) at a point where the module is over, otherwise the partial audit after a Resign (v1
   * §8.3: no outcome compared). A deckless game's runs at once; with a deck it needs every seat's secret (the caller
   * checks), and decrypts the final deck with them.
   */
  private auditAt(e: Ending): SessionAudit {
    const key = `${e.over ? 'full' : 'prefix'}|${lineLogHash(this.store, e.point.id) as Hex}`;
    const known = this.audits.get(key);
    if (known !== undefined) return known;
    const deck = this.ctx.deckId !== null;
    const input = {
      module: this.module,
      rules: this.ctx.rules,
      seats: this.ctx.seats,
      deckId: this.ctx.deckId,
      deck: deck ? e.point.deck : [],
      secrets: deck ? this.allSecretsList() : [],
      cards: this.ctx.cards,
      log: e.fold.log.slice(0, e.point.logLength) as LoggedAction[],
    };
    const audit = e.over
      ? auditGame({ ...input, outcome: this.module.outcome(e.point.state) })
      : auditPrefix(input);
    if (this.audits.size >= MAX_AUDITS) this.audits.clear();
    this.audits.set(key, audit);
    return audit;
  }

  /** Whether `e`'s End phase owes Secret reveals: a deck game at `over` (v1 §7 step 1) or after a Resign (v1 §8.3). */
  private needsSecrets(e: Ending): boolean {
    return this.ctx.deckId !== null && (e.over || e.r.kind === 'resign');
  }

  /**
   * The phase, outcome, audit and forfeits the view reports (PROTOCOL-v2 §5.5): the stop's (`stopStatus`) while a
   * fork is held and no result stands; live while there is no result; otherwise the result scored at its point,
   * as without a fork when it stands against one (review N1, V2-54):
   * - `over` (or a Resign whose S is over, v1 §8.3 step 4): the module's outcome with the full audit (§7.2), the
   *   failed seats forfeiting with the end adjustment; with a deck the audit waits for every secret (phase `end`),
   *   and an End-phase claim accepted for a withheld secret forfeits the stalled seats instead (v1 §8.2 "At the end");
   * - `claim`: v1 §8.2's forfeit ranking at its head, with no audit (`{fail, reason: 'timeout'}`);
   * - `resign`: v1 §8.3's resign ranking at S, the resigner strictly last, unrated with 3 or more seats; with a deck
   *   the partial audit up to S once every secret is in (or the End-phase claim's forfeits).
   */
  private status(): Status {
    const stop = this.stopNow();
    if (stop !== null) return this.stopStatus(stop);
    const e = this.ending();
    if (e === null) return { phase: this.head().phase, outcome: null, audit: 'pending', forfeits: [] };
    if (e.r.kind === 'claim') return this.claimStatus(e);
    if (e.over) return this.overStatus(e);
    return this.resignStatus(e);
  }

  /** The result at a point where the module is over: its outcome, with the full audit or a withheld-secret claim. */
  private overStatus(e: Ending): Status {
    const declared = this.module.outcome(e.point.state) as ModuleOutcome;
    const claimed = this.endClaims.get(e.key);
    if (claimed !== undefined) {
      const forfeits = ascending(claimed.seats);
      return {
        phase: 'done',
        outcome: rankWithForfeits(declared.scores, forfeits, declared.places),
        audit: { fail: [...forfeits], reason: 'withheld secret' },
        forfeits,
      };
    }
    if (this.ctx.deckId !== null && !this.allSecrets())
      return { phase: 'end', outcome: null, audit: 'pending', forfeits: [] };
    const audit = this.auditAt(e);
    const failed = typeof audit === 'object' ? ascending(audit.fail) : [];
    const outcome =
      failed.length === 0
        ? { places: [...declared.places], reason: declared.reason, scores: [...declared.scores] }
        : rankWithForfeits(declared.scores, failed, declared.places);
    const copy = typeof audit === 'object' ? { fail: [...audit.fail], reason: audit.reason } : audit;
    return { phase: 'done', outcome, audit: copy, forfeits: failed };
  }

  /** A `claim` result (v1 §8.2 "During play"): the forfeiting seats last, the others by `standings` at its head. */
  private claimStatus(e: Ending): Status {
    const forfeits = [...e.r.forfeit];
    return {
      phase: 'done',
      outcome: rankWithForfeits(standingsAt(this.ctx, e.point), forfeits, null),
      audit: { fail: [...forfeits], reason: 'timeout' },
      forfeits,
    };
  }

  /**
   * A `resign` result whose S is not over (v1 §8.3): deckless, done at once (`{fail: [k], reason: 'resign'}`); with a
   * deck, `end` until every secret is in, then the partial audit up to S (its failed seats forfeit too, above the
   * resigner), or an accepted End-phase claim's stalled seats (`resign; withheld secret`).
   */
  private resignStatus(e: Ending): Status {
    const k = e.r.forfeit[0] as number;
    if (this.ctx.deckId === null)
      return {
        phase: 'done',
        outcome: this.resignOutcome(e, k, [k]),
        audit: { fail: [k], reason: 'resign' },
        forfeits: [k],
      };
    let failed: readonly number[];
    let reason: string;
    const claimed = this.endClaims.get(e.key);
    if (claimed !== undefined) {
      failed = claimed.seats;
      reason = 'resign; withheld secret';
    } else if (this.allSecrets()) {
      const a = this.auditAt(e);
      failed = a === 'pass' || a === 'pending' ? [] : a.fail;
      reason = typeof a === 'object' ? clipReason(`resign; ${a.reason}`) : 'resign';
    } else {
      return { phase: 'end', outcome: null, audit: 'pending', forfeits: [k] };
    }
    const forfeits = ascending([k, ...failed]);
    return {
      phase: 'done',
      outcome: this.resignOutcome(e, k, forfeits),
      audit: { fail: [...forfeits], reason },
      forfeits,
    };
  }

  /**
   * A Resign's outcome (v1 §8.3): `forfeits` last, the others by `standings` at S, reason `resign`, the resigning seat
   * strictly last (the other forfeiting seats share the place above it); with 3 or more seats also `unrated` and
   * `endedBy` (D052).
   */
  private resignOutcome(e: Ending, k: number, forfeits: readonly number[]): Outcome {
    const ranked = rankWithForfeits(standingsAt(this.ctx, e.point), forfeits, null);
    const places = ranked.places.map((p, j) => (j === k ? this.ctx.seats : p));
    const outcome: Outcome = { places, reason: 'resign', scores: ranked.scores };
    if (this.ctx.seats < 3) return outcome;
    return { ...outcome, unrated: true, endedBy: { type: 'resign', seat: k } };
  }

  /**
   * A stopped game's phase, outcome, audit and forfeits (PROTOCOL-v2 §5.6, §7.3): `cancelled` with no outcome; or
   * `done` with the stop's places at once. In a deck game the audit is the partial audit's verdict once it ran
   * (`pending` meanwhile: "audit incomplete"), and only a proven failure demotes a seat. A deckless game, and a deck
   * game stopped before its final deck exists at P, has no audit after a stop: it records the equivocators with
   * reason `stop`, as a timeout records its forfeits (v1 §8.2).
   */
  private stopStatus(stop: Stop): Status {
    if (stop.cancelled) return { phase: 'cancelled', outcome: null, audit: 'pending', forfeits: [] };
    const eq = [...stop.equivocators];
    // No deck, or no final deck at P: nothing to audit after the stop (§7.3).
    if (!this.secretPhaseAfterStop())
      return {
        phase: 'done',
        outcome: stopOutcome(this.ctx, stop, []),
        audit: { fail: eq, reason: 'stop' },
        forfeits: eq,
      };
    const after = this.afterStop(stop);
    const verdict = after.audit.state === 'ran' ? after.audit.verdict : 'pending';
    return {
      phase: 'done',
      outcome: stopOutcome(this.ctx, stop, after.demoted),
      audit: typeof verdict === 'object' ? { fail: [...verdict.fail], reason: verdict.reason } : verdict,
      forfeits: ascending([...eq, ...after.demoted]),
    };
  }

  /**
   * The progress time P (v1 §8.1, D030 Rulings 10 and 11): the latest local first-seen time over the root and the
   * moves of the chain (the walk's, or with a result the line to its scoring point, as without a fork: review N1),
   * and the Shares events and secrets that let the walk advance or removed a seat from the stall set
   * (`noteProgress`); for a result standing against a fork, also the first-seen time of the event after which it
   * first stood here (`stoodSince`). No `created_at` counts.
   */
  private progress(): number {
    let out = Math.max(this.rootSeenAt, this.stallProgress);
    const e = this.ending();
    const chain = e === null ? this.current.chain : e.fold.chain.slice(0, e.seq);
    for (const h of chain) out = Math.max(out, this.seenAt.get(h.m.id) ?? this.clock);
    // A result standing against a fork: no earlier than when it first stood here (coordinator ruling on D068).
    if (e !== null && this.current.fork !== null)
      out = Math.max(out, this.stoodSince.get(e.key) ?? this.clock);
    return out;
  }

  /**
   * After an event is folded at local time `now` (its first-seen time): if a result now stands against the held
   * fork that had not stood here before, record the time it first stood (`stoodSince`): `now`, or the latest
   * first-seen time of any event received if later (D069, review of T11 L2). In arrival order the two agree; on a
   * refeed in another order with saved first-seen times, the later of them is never earlier than the moment it
   * first stood in arrival order.
   */
  private noteStanding(now: number): void {
    if (this.current.fork === null) return;
    const e = this.ending();
    if (e !== null && !this.stoodSince.has(e.key)) this.stoodSince.set(e.key, Math.max(now, this.lastSeen));
  }

  /**
   * The view's `pendingSince`: the progress time P, except while the game is stopped at a held fork, when no seat is
   * stalled (§5.7) and it is the root's first-seen time, the floor of P (review of T9, I1). P itself depends on
   * which Shares events this client accepted before the fork surfaced, so it would differ between arrival orders of
   * the same events. A result standing against the fork has stalls (N1), so its P is shown.
   */
  private pendingSince(): number {
    return this.current.fork !== null && this.standing() === null ? this.rootSeenAt : this.progress();
  }

  /**
   * The seats stalled at the head (v1 §8.1 as PROTOCOL-v2 §8.1 amends it), ascending: none while the game is stopped
   * at a held fork; once there is a result (also one standing against a fork: N1), the End phase's (`endStalled`);
   * during the shuffle, the seat whose step is next; during the deal, every seat missing deal shares (there is no
   * shuffle-fork exception: a held fork stalls nobody); in play, as v1 (`stalledInPlay`).
   */
  private stalled(): number[] {
    const e = this.ending();
    if (e !== null) return this.endStalled(e);
    if (this.current.fork !== null) return [];
    const all = Array.from({ length: this.ctx.seats }, (_, k) => k);
    const head = this.head();
    const shares = this.current.shares;
    switch (head.phase) {
      case 'shuffle': {
        const next = nextShuffler(this.ctx, head);
        return next === null ? [] : [next];
      }
      case 'deal': {
        if (shares === null) return [];
        const dealt = this.module.dealt(head.state);
        return all.filter((k) => shares.missing(k, dealt).length > 0);
      }
      case 'play':
        return this.stalledInPlay(all, head, shares);
      default:
        return [];
    }
  }

  /**
   * The seats stalled in `e`'s End phase (v1 §8.1 "End"): with a deck, at `over` or after a Resign, every seat whose
   * secret is not in, until an End-phase claim is accepted; none otherwise (a deckless game, a `claim` result).
   */
  private endStalled(e: Ending): number[] {
    if (!this.needsSecrets(e) || this.endClaims.has(e.key)) return [];
    return Array.from({ length: this.ctx.seats }, (_, k) => k).filter((k) => this.secretOf(k) === null);
  }

  /**
   * Accept an End-phase claim when one is due (v1 §8.1 "Accepting", by this client's own clock): the game has a
   * result whose End phase owes secrets, some seat's secret is missing, and a kept Timeout claim names the result's
   * scoring point (its head, or S: never the fork point P, review N1; for a Resign also its head H or any held move at
   * or past H, every S it has had, D069) signed by a seat whose secret is in, with `now ≥ P + deadline`. The lowest
   * such claim id is recorded, and every seat stalled then forfeits. Final for that result, by its identity whatever
   * its S (v1 §8.2 "Finality", D069).
   */
  private decideEndClaim(): void {
    const e = this.ending();
    if (e === null || !this.needsSecrets(e) || this.endClaims.has(e.key)) return;
    const stalled = this.endStalled(e);
    if (stalled.length === 0 || this.clock < this.progress() + this.root.deadline) return;
    // A Resign's S can move after it stands (a fork between H and S, or moves past S): a claim naming H or any move
    // at or past it counts, so one built at an earlier S still does (D069, review of T11 L1).
    const names = (h: Hex): boolean =>
      h === e.point.id || (e.r.kind === 'resign' && this.store.atOrPast(h, e.r.head));
    const ids = [...this.store.claims.values()]
      .filter((c) => names(c.ev.headId) && !stalled.includes(c.seat))
      .map((c) => c.ev.id)
      .sort();
    const id = ids[0];
    if (id !== undefined) this.endClaims.set(e.key, { id, seats: stalled });
  }

  /**
   * The play-phase part of `stalled` (v1): for a pending public reveal, the seats missing a share of it; for a
   * pending beacon, every seat without a verified contribution to its roll, the requester included (PROTOCOL-v2
   * §6.2, V2-36); for a player decision, that seat, unless the decision needs a card dealt to it that some other
   * seat has not shared (judged on the public state: if the module lists actions with its hand hidden, the seat can
   * act), in which case those seats.
   */
  private stalledInPlay(all: readonly number[], head: LinePoint, shares: LineShares | null): number[] {
    const p = pendingAt(this.ctx, head);
    if (p === null) return [];
    if (p.type === 'reveal') return shares === null ? [] : this.owesReveal(all, p.positions, shares);
    if (p.type === 'beacon') return this.owesRoll(all, p.id);
    if (p.type !== 'player') return [];
    const seat = p.seat;
    if (shares === null) return [seat];
    const needed = this.module
      .dealt(head.state)
      .filter((d) => d.to === seat && d.deck === this.ctx.deckId && !shares.covered(d.pos, seat))
      .map((d) => d.pos);
    if (needed.length === 0) return [seat];
    if (this.module.legalActions(this.module.view(head.state, null), seat).length > 0) return [seat];
    return all.filter((k) => k !== seat && needed.some((pos) => !shares.has(k, pos)));
  }

  /**
   * The seats without a verified contribution to the roll the module calls `id`, requested on the chain (a pending
   * beacon). None when no game action on the chain requested it (a module that pends a roll it never listed).
   */
  private owesRoll(all: readonly number[], id: number): number[] {
    const ref = this.current.rolls.get(id);
    if (ref === undefined) return [];
    const slots = this.current.contributions(ref.move)[ref.n] ?? [];
    return all.filter((k) => (slots[k] ?? null) === null);
  }

  /** The seats missing a share of any of `positions` (a pending public reveal). */
  private owesReveal(all: readonly number[], positions: readonly number[], shares: LineShares): number[] {
    return all.filter((k) => positions.some((pos) => !shares.has(k, pos)));
  }

  /** The seats the game waits on at the head, ascending, a fresh copy (for the "Waiting for …" lines). */
  waitingFor(): number[] {
    return [...this.stalled()];
  }

  /** The canonical `{audit, logHash, outcome}` of the stats attestation (PROTOCOL-v2 §7.4), or null before `done`. */
  private statsContent(): string | null {
    const { phase, outcome, audit } = this.status();
    const e = this.ending();
    if (phase !== 'done' || outcome === null || audit === 'pending' || e === null) return null;
    // The line up to the result's scoring point: its head, or S for a Resign (PROTOCOL-v2 §7.4, §8.3).
    return canonicalJson({ audit, logHash: lineLogHash(this.store, e.point.id), outcome });
  }

  /** The seats whose latest stats attestation matches this client's result, ascending. */
  private statsAttested(): number[] {
    const mine = this.statsContent();
    if (mine === null) return [];
    return ascending([...this.store.stats].filter(([, a]) => a.content === mine).map(([seat]) => seat));
  }

  /**
   * A snapshot. With a result, `head`, `state`, `pending` and `events` are those of its scoring point (its head, or
   * S for a Resign), also when it stands against a fork and lies on a side of it (review N1); otherwise the walk's
   * head (P while stopped).
   */
  view(): SessionViewV2 {
    const status = this.status();
    const w = this.current;
    const e = this.ending();
    const r = e?.r ?? null;
    const head = e?.point ?? this.head();
    const events = (e?.fold.events ?? w.line.events).slice(0, head.eventsLength);
    const fork = w.fork;
    const stop = this.stopNow();
    const after = stop !== null && this.secretPhaseAfterStop() ? this.afterStop(stop) : null;
    const resignedBy = r?.kind === 'resign' ? (r.forfeit[0] as number) : null;
    return {
      phase: status.phase,
      rootId: this.root.id,
      seats: this.ctx.seats,
      shuffleSteps: this.ctx.shuffleSteps,
      mySeat: this.me?.seat ?? null,
      head: { id: head.id, seq: head.seq },
      state: head.state,
      pending: this.pendingView(head),
      pendingSince: this.pendingSince(),
      outcome: status.outcome,
      forfeits: status.forfeits,
      resigned: resignedBy !== null && e?.over === false ? [resignedBy] : [],
      resignOverridden: resignedBy !== null && e?.over === true ? [resignedBy] : [],
      resignId: r?.kind === 'resign' ? this.resignIdOf(r) : null,
      // Every M1 equivocator whenever a fork is held, whether the game stopped or a result stands (§5.2, §7.5).
      equivocators: fork === null ? [] : [...(this.forkStop()?.equivocators ?? [])],
      audit: status.audit,
      logHash: lineLogHash(this.store, head.id) as Hex,
      resultLogHash: lineLogHash(this.store, head.id) as Hex,
      deadline: this.root.deadline,
      attested: this.statsAttested(),
      events: Object.freeze(events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events),
      proto: 2,
      fork:
        fork === null
          ? null
          : { at: fork.at, seat: fork.seat, certificate: fork.successors.slice(0, 2) as Hex[] },
      result: r === null ? null : { kind: r.kind, head: r.head, forfeit: [...r.forfeit] },
      stood: fork !== null && r !== null,
      stop: stop === null ? null : { at: stop.at, seat: stop.seat, cancelled: stop.cancelled },
      secretWithheld: after === null ? [] : after.withheld,
      auditIncomplete: after !== null && after.audit.state === 'incomplete',
      endAttested: r === null ? [] : endAttestedSeats(this.store, this.ctx.seats, r),
      owed: { reveal: this.owedReveal(), roll: this.owedRoll() },
      ownForfeit: null,
    };
  }

  /** The id of the held Resign a `resign` result counts (the lowest id by its seat naming its head), or null. */
  private resignIdOf(r: ResultId): Hex | null {
    const ids = [...this.store.resigns.values()]
      .filter((x) => x.seat === r.forfeit[0] && x.ev.headId === r.head)
      .map((x) => x.ev.id)
      .sort();
    return ids[0] ?? null;
  }

  /** During the shuffle, the next shuffler; afterwards, the module's pending decision. A fresh copy. */
  private pendingView(head: LinePoint): SessionViewV2['pending'] {
    const shuffler = head.phase === 'shuffle' ? nextShuffler(this.ctx, head) : null;
    if (shuffler !== null) return { type: 'player', seat: shuffler, decision: 'shuffle' };
    const p = pendingAt(this.ctx, head);
    if (p === null) return { type: 'over' };
    return p.type === 'reveal' ? { type: 'reveal', deck: p.deck, positions: [...p.positions] } : { ...p };
  }

  /** The seats that owe a contribution to a roll pending at the head (PROTOCOL-v2 §6.4, V2-49), ascending. */
  private owedRoll(): number[] {
    const head = this.head();
    if (this.current.fork !== null || this.result() !== null || head.phase !== 'play') return [];
    const p = pendingAt(this.ctx, head);
    if (p?.type !== 'beacon') return [];
    return this.owesRoll(
      Array.from({ length: this.ctx.seats }, (_, k) => k),
      p.id,
    );
  }

  /** The seats that owe a share of a public reveal pending at the head (PROTOCOL-v2 §6.4), ascending. */
  private owedReveal(): number[] {
    const head = this.head();
    const shares = this.current.shares;
    if (this.current.fork !== null || this.result() !== null || head.phase !== 'play' || shares === null)
      return [];
    const p = pendingAt(this.ctx, head);
    if (p?.type !== 'reveal') return [];
    return this.owesReveal(
      Array.from({ length: this.ctx.seats }, (_, k) => k),
      p.positions,
      shares,
    );
  }

  /* ---------------------------------------------------------------------------------------------- duties */

  /**
   * What this seat must publish next, as of the walk's head. Spectators have none. While a fork is held and no
   * result stands, the game is stopped (PROTOCOL-v2 §5.7): no decision, release, roll, end or stats attestation is
   * owed (V2-24, V2-38); in a deck game whose stop is scored (not cancelled) the only duty is `secret`, until my
   * secret is held (§7.3). While the game is live:
   * - `shuffle`: the next shuffle step is mine;
   * - `deal`: the deal phase, and I owe shares (`releasable`): the seat's deal (§6.1), built once;
   * - `release`: the play phase, and I owe shares of positions dealt to another seat or to nobody: a prompt release
   *   anchored on the head (§6.1). It comes first, and `decide` may follow it in the same list;
   * - `roll`: a game action on the chain requested rolls to which my seat has no verified contribution: one duty per
   *   requesting move, in chain order, with every such index, anchored on the head (§6.2, `buildRoll`). After any
   *   release, before `decide` (no decision is pending while a beacon is);
   * - `decide`: the pending decision is mine and the module lists legal actions.
   * Once this client has a result:
   * - `end`: it holds none of its seat's end attestations of it (PROTOCOL-v2 §7.1), before the Secret phase; never
   *   while a fork is held (a result standing against it included);
   * - `secret`: the End phase owes secrets (a deck game at `over` or after a Resign) and my deck secret is not in
   *   (v1 §7 step 1, §8.3), unless an End-phase claim was accepted; also for a result standing against a fork (N1);
   * - `attest`: the stats attestation, once the result and its audit are final (a SHOULD, PROTOCOL-v2 §7.4): never
   *   while a fork is held.
   */
  duties(): Duty[] {
    const me = this.me;
    if (me === null) return [];
    if (this.stopNow() !== null)
      // Stopped (no result stands, §5.7): nothing but the after-stop Secret reveal in a deck game (§7.3).
      return this.secretPhaseAfterStop() && this.secretOf(me.seat) === null ? [{ kind: 'secret' }] : [];
    const e = this.ending();
    if (e === null) {
      const head = this.head();
      if (head.phase === 'shuffle')
        return nextShuffler(this.ctx, head) === me.seat ? [{ kind: 'shuffle' }] : [];
      const positions = this.releasable(me);
      if (head.phase === 'deal') return positions.length > 0 ? [{ kind: 'deal' }] : [];
      const out: Duty[] = [];
      if (positions.length > 0) out.push({ kind: 'release', positions, anchor: head.id });
      out.push(...this.rollDuties(me));
      if (this.decides(me)) out.push({ kind: 'decide' });
      return out;
    }
    // A result standing against a held fork is played out as without one (N1: the Secret phase), but nothing new is
    // attested while the fork is held (§5.7, §7.1), and it is not final (§8.1 "Finality"), so no stats attestation.
    const standing = this.current.fork !== null;
    if (!standing && !endAttestedSeats(this.store, this.ctx.seats, e.r).includes(me.seat))
      return [{ kind: 'end' }];
    if (this.needsSecrets(e) && !this.endClaims.has(e.key) && this.secretOf(me.seat) === null)
      return [{ kind: 'secret' }];
    if (!standing && this.statsContent() !== null && !this.statsAttested().includes(me.seat))
      return [{ kind: 'attest' }];
    return [];
  }

  /**
   * The positions this seat may release now (PROTOCOL-v2 §6.1), sorted: none unless it holds no fork (1), the game
   * has no result (2), the final deck is complete (3: the deal or the play phase) and it holds no Shares event of
   * its own seat that fails against the final deck (4: a seat deals once, D056). Otherwise every position `dealt`
   * assigns at the head to another seat or to nobody for which it holds no verified share by its seat: never one
   * dealt to itself, never an undealt one.
   */
  private releasable(me: Identity): number[] {
    if (this.current.fork !== null || this.result() !== null) return [];
    const head = this.head();
    const shares = this.current.shares;
    if ((head.phase !== 'deal' && head.phase !== 'play') || shares === null || head.state === null) return [];
    if (this.dealtElsewhere(me.seat)) return [];
    return shares.missing(me.seat, this.module.dealt(head.state));
  }

  /**
   * Whether a card Shares event signed by `seat` is held that fails against the walk's final deck (PROTOCOL-v2 §6.1
   * condition 4). An honest client's shares verify against the deck it built them on, so for its own seat that
   * means it released on another deck (a shuffle fork's rival), and it must never release again (D056).
   */
  private dealtElsewhere(seat: number): boolean {
    const head = this.finalDeck();
    if (head === null) return false;
    for (const [id, x] of this.store.cardShares) {
      if (x.seat !== seat) continue;
      if (cardSharesProblem(this.ctx, this.caches, head.key, head.deck, id, x.seat, x.ev.shares) !== null)
        return true;
    }
    return false;
  }

  /**
   * My `roll` duties (PROTOCOL-v2 §6.2 "Release", V2-34): none while a fork is held or once there is a result;
   * otherwise one per requesting move on the chain (so only once the move is on my chain: the requester's own
   * contribution comes after its move), listing every roll index of it with no verified contribution by my seat,
   * anchored on the head.
   */
  private rollDuties(me: Identity): Duty[] {
    if (this.current.fork !== null || this.result() !== null) return [];
    const head = this.head();
    const out: Duty[] = [];
    for (const h of this.current.chain) {
      if (!this.current.requests.has(h.m.id)) continue;
      const indices: number[] = [];
      for (const [n, slots] of this.current.contributions(h.m.id).entries())
        if (slots[me.seat] === null) indices.push(n);
      if (indices.length > 0) out.push({ kind: 'roll', move: h.m.id, indices, anchor: head.id });
    }
    return out;
  }

  private decides(me: Identity): boolean {
    if (this.current.fork !== null || this.result() !== null) return false;
    const head = this.head();
    if (head.phase !== 'play') return false;
    const p = pendingAt(this.ctx, head);
    if (p?.type !== 'player' || p.seat !== me.seat) return false;
    return this.module.legalActions(head.state, me.seat).length > 0;
  }

  /** My legal actions when a decision is mine (`decide` duty); otherwise none. A fresh, frozen list. */
  legalActions(): readonly unknown[] {
    const me = this.me;
    if (me === null || !this.decides(me)) return [];
    const legal = this.module.legalActions(this.head().state, me.seat);
    return deepFreeze(JSON.parse(canonicalJson(legal)) as unknown[]);
  }

  /* ---------------------------------------------------------------------------------------------- builders */
  /*
   * Every builder signs with this seat's session key and puts `["proto","2"]` on the event (V2-01). Build each once
   * and re-send the event you built: two moves on one prev are a fork, which stops the game as this seat's loss.
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
   * My shuffle step (`shuffle` duty): the head's slice of the deck for this step's group (v1 §5.5), permuted and
   * re-encrypted under the joint key, with its proof, at proto 2. Build it once: two well-formed steps by one seat
   * on one prev are a fork, which stops the game as this seat's loss.
   */
  buildShuffle(rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireDuty('shuffle');
    const head = this.head();
    const step = head.seq;
    const group = shuffleStepGroup(step, this.ctx.partitions);
    if (group === null) throw new ClientError('the game has no deck to shuffle');
    const input = head.deck.slice(group.offset, group.offset + group.size) as Ciphertext[];
    const { out, psi, rPrime } = shuffleDeck(input, this.ctx.X, rnd);
    const proof = proveShuffle(
      input,
      out,
      this.ctx.X,
      psi,
      rPrime,
      {
        rootId: this.root.id,
        seat: me.seat,
        deckId: group.id,
      },
      rnd,
    );
    const t = moveTemplate(
      {
        rootId: this.root.id,
        prevId: head.id,
        seq: step + 1,
        content: { type: 'shuffle', deck: out, proof },
      },
      createdAt,
      '2',
    );
    const ev = finalizeEvent(t, me.sessionSk, rnd);
    // This seat proved it, so its own step need not be verified again.
    this.caches.shuffleOk.set(ev.id, true);
    return ev;
  }

  /**
   * My deal (`deal` duty, PROTOCOL-v2 §6.1): a card Shares event anchored on the head (the last shuffle step) with
   * my share of every position the deal assigns to another seat or to nobody, sorted. At most one per game: build
   * it once, persist it and re-send that event, never a new one.
   */
  buildDeal(rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireDuty('deal');
    return this.cardShares(me, this.releasable(me), rnd, createdAt);
  }

  /**
   * My prompt release (`release` duty, PROTOCOL-v2 §6.1): a card Shares event anchored on the head (V2-27), with my
   * share of every position the duty lists (dealt to another seat or to nobody at the head, not yet verified for my
   * seat), sorted. Never a position dealt to my seat, nor an undealt one (V2-26); none while a fork is held, after
   * the result or before the final deck (V2-25: the duty is not due then, and this throws `ClientError`).
   */
  buildRelease(rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireDuty('release');
    return this.cardShares(me, this.releasable(me), rnd, createdAt);
  }

  /**
   * My contributions to the rolls of requesting move `moveId` (`roll` duty, PROTOCOL-v2 §6.2): one roll Shares event
   * with `move` M and, for every index the duty lists, `D = x·H(M, n)` with its proof (deck id `roll`, position n),
   * anchored on the head (V2-27). Throws `ClientError` unless a roll duty for `moveId` is due: never while a fork is
   * held or after the result, and never before M is on the chain (V2-34). Contributions are automatic; two devices
   * of a seat publishing both is harmless (the same `D`, never a fork).
   */
  buildRoll(moveId: Hex, rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireMe();
    const duty = this.duties().find(
      (d): d is Extract<Duty, { kind: 'roll' }> => d.kind === 'roll' && d.move === moveId,
    );
    if (duty === undefined) throw new ClientError(`no roll duty is due from this seat for move ${moveId}`);
    const shares: PosShare[] = duty.indices.map((n) => ({
      pos: n,
      share: makeMoveRollShare(me.deckSecret, this.root.id, moveId, n, rnd),
    }));
    const t = rollSharesTemplate(
      { rootId: this.root.id, anchorId: this.head().id, moveId, shares },
      createdAt,
    );
    const ev = finalizeEvent(t, me.sessionSk, rnd);
    // This seat made the proofs against M's points, so they need not be verified again.
    this.caches.rolls.proofs.set(ev.id, null);
    return ev;
  }

  /** A card Shares event by `me` of `positions` of the walk's final deck, anchored on the head. */
  private cardShares(
    me: Identity,
    positions: readonly number[],
    rnd: RandomBytes,
    createdAt: number,
  ): NostrEvent {
    const head = this.head();
    const shares: PosShare[] = positions.map((pos) => ({
      pos,
      share: makeShare(me.deckSecret, head.deck[pos] as Ciphertext, shareCtx(this.ctx, pos), rnd),
    }));
    const t = cardSharesTemplate({ rootId: this.root.id, anchorId: head.id, shares }, createdAt);
    const ev = finalizeEvent(t, me.sessionSk, rnd);
    // This seat made the proofs against this deck, so they need not be verified again.
    if (head.deckKey !== null) this.caches.sharesOk.set(`${ev.id}|${head.deckKey}`, null);
    return ev;
  }

  /**
   * My Secret reveal (`secret` duty, v1 §4.7 at proto 2): once the game is over and my end attestation is in, or once
   * this client holds a scored stop in a deck game (PROTOCOL-v2 §7.3).
   */
  buildSecret(rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireDuty('secret');
    const t = secretTemplate({ rootId: this.root.id, deckSecret: me.deckSecret }, createdAt, '2');
    return finalizeEvent(t, me.sessionSk, rnd);
  }

  /**
   * My game-action move at proto 2: `action` (one of `legalActions()`) on the walk's head. With a deck it carries
   * every share my seat owes as of the head that is not held yet (the slow path, v1 §6.2, V2-28) and my reveal
   * shares for the cards the action shows (`revealsOf`), each sorted; a deckless game's move carries none. Throws
   * `ClientError` unless a decision is mine and the action is legal.
   */
  buildAction(action: unknown, rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireDuty('decide');
    let wanted: string;
    try {
      wanted = canonicalJson(action);
    } catch {
      throw new ClientError('the action is not canonical JSON');
    }
    const head = this.head();
    const legal = this.module.legalActions(head.state, me.seat).find((a) => canonicalJson(a) === wanted);
    if (legal === undefined) throw new ClientError('the action is not legal now');
    let shares: PosShare[] = [];
    let reveals: PosShare[] = [];
    const line = this.current.shares;
    if (line !== null) {
      const share = (pos: number): PosShare => ({
        pos,
        share: makeShare(me.deckSecret, head.deck[pos] as Ciphertext, shareCtx(this.ctx, pos), rnd),
      });
      shares = line.missing(me.seat, this.module.dealt(head.state)).map(share);
      const shown = [...new Set(this.module.revealsOf(head.state, legal).map((l) => l.pos))];
      reveals = shown.sort((a, b) => a - b).map(share);
    }
    const t = moveTemplate(
      {
        rootId: this.root.id,
        prevId: head.id,
        seq: head.seq + 1,
        content: { type: 'action', action: legal, reveals, shares },
      },
      createdAt,
      '2',
    );
    const ev = finalizeEvent(t, me.sessionSk, rnd);
    // This seat made the proofs, so they need not be verified again.
    if (shares.length > 0 || reveals.length > 0) this.caches.moveProofs.set(ev.id, null);
    return ev;
  }

  /**
   * My end attestation of this client's result (PROTOCOL-v2 §4.3, §7.1): its identity and the log hash of the line
   * to its head, signed by my session key with no prompt (`end` duty). Throws `ClientError` unless the duty is due.
   * Build it once, persist it, and re-send that event.
   */
  buildEndAttest(rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireDuty('end');
    const r = this.result() as ResultId;
    const t = endAttestTemplate(
      {
        rootId: this.root.id,
        headId: r.head,
        end: { kind: r.kind, forfeit: [...r.forfeit], logHash: lineLogHash(this.store, r.head) as Hex },
      },
      createdAt,
    );
    return finalizeEvent(t, me.sessionSk, rnd);
  }

  /**
   * My stats attestation (PROTOCOL-v2 §4.3, §7.4), unsigned: `{audit, logHash, outcome}` as this session computed
   * them, at proto 2 (`attest` duty). The player's npub signs it; it plays no part in the cutoff.
   */
  attestTemplate(createdAt: number): EventTemplate {
    this.requireDuty('attest');
    const { outcome, audit } = this.status();
    const e = this.ending() as Ending;
    return statsTemplate(
      {
        rootId: this.root.id,
        audit: audit as Exclude<SessionAudit, 'pending'>,
        logHash: lineLogHash(this.store, e.point.id) as Hex,
        outcome: outcome as Outcome,
      },
      createdAt,
      '2',
    );
  }

  /** Resign under protocol 2 is built in task T12: not yet. */
  canResign(): boolean {
    return false;
  }

  /** Resign under protocol 2 is built in task T12: throws `ClientError`. */
  buildResign(_rnd: RandomBytes, _createdAt: number): NostrEvent {
    this.requireMe();
    throw new ClientError('resigning a protocol 2 game is not built yet (build plan T12)');
  }

  /**
   * The seat this client may claim a timeout against at `now` (v1 §8.1 "Claiming"), or null. Built so far for the End
   * phase only (claims during play are T12): the game has a result whose End phase owes secrets (also one standing
   * against a fork: N1), my secret is in, another seat's is missing, no End-phase claim was accepted, and
   * `now ≥ P + deadline`. The lowest stalled seat.
   */
  timeoutTarget(now: number): number | null {
    this.observe(now);
    const me = this.me;
    const e = this.ending();
    if (me === null || e === null || !this.needsSecrets(e) || this.endClaims.has(e.key)) return null;
    const stalled = this.endStalled(e);
    if (stalled.length === 0 || stalled.includes(me.seat)) return null;
    if (this.clock < this.progress() + this.root.deadline) return null;
    return stalled[0] as number;
  }

  /**
   * My Timeout claim against `seat` (v1 §4.6 at proto 2), naming the result's scoring point (its head, or S: never
   * the fork point P, review N1). Throws `ClientError` unless `timeoutTarget` allows a claim now and `seat` is
   * stalled.
   */
  buildTimeout(seat: number, rnd: RandomBytes, createdAt: number): NostrEvent {
    const me = this.requireMe();
    const e = this.ending();
    if (this.timeoutTarget(this.clock) === null || e === null || !this.endStalled(e).includes(seat))
      throw new ClientError(`no timeout claim against seat ${seat} is due`);
    const t = timeoutTemplate({ rootId: this.root.id, headId: e.point.id, seat }, createdAt, '2');
    return finalizeEvent(t, me.sessionSk, rnd);
  }

  /* ---------------------------------------------------------------------------------------------- chain */

  /** The shuffle steps on the walk, in seq order (none in a deckless game). */
  deckSteps(): Hex[] {
    return this.current.chain
      .slice(0, Math.min(this.ctx.shuffleSteps, this.current.chain.length))
      .map((h) => h.m.id);
  }

  /** The seq of `id` on the walk (0 for the root), or null when it is not on it. */
  chainSeq(id: Hex): number | null {
    if (id === this.root.id) return 0;
    const i = this.current.chain.findIndex((h) => h.m.id === id);
    return i < 0 ? null : i + 1;
  }

  /**
   * Where `id` sits, as v1 reports it (only moves that may still link count, as v1 pools only those):
   * - `chain`: the root or a move on the walk;
   * - `ahead`: a held move whose ancestry through held moves reaches the head, every move on the way able to link
   *   still (none of a bad shape, none judged invalid at its prev, no shuffle step whose proof failed, each `seq` one
   *   more than its prev's), with no fork held: it extends the chain once what it waits for arrives;
   * - `side`: the same, but its ancestry reaches the walk below the head;
   * - `unknown`: anything else, including every move past a fork held at the head, and a move above junk.
   */
  branchOf(id: Hex): 'chain' | 'ahead' | 'side' | 'unknown' {
    if (this.chainSeq(id) !== null) return 'chain';
    const head = this.head();
    let at = this.store.moves.get(id);
    for (let i = 0; at !== undefined && i <= this.store.moves.size; i++) {
      if (!this.mayLink(at)) return 'unknown';
      if (at.m.prevId === head.id) return this.current.fork === null ? 'ahead' : 'unknown';
      if (this.chainSeq(at.m.prevId) !== null) return 'side';
      at = this.store.moves.get(at.m.prevId);
    }
    return 'unknown';
  }

  /**
   * Whether held move `h` may still link at its prev: a good shape, not judged invalid, not a shuffle step whose
   * proof failed (valid-looking for good, never linked: review of T8, L1), and the next `seq`.
   */
  private mayLink(h: HeldMove): boolean {
    if (h.shape !== null) return false;
    const j = this.current.judged.get(h.m.id);
    if (j?.kind === 'invalid' || (j?.kind === 'looking' && j.final)) return false;
    const prev = h.m.prevId === this.root.id ? 0 : this.store.moves.get(h.m.prevId)?.m.seq;
    return prev === undefined || h.m.seq === prev + 1;
  }

  /**
   * Whether a held move above the head (seq beyond head + 1) descends from the head through moves that may still
   * link (`branchOf` is `ahead`). Always false while a fork is held: nothing links past it.
   */
  aheadOfHead(): boolean {
    if (this.current.fork !== null) return false;
    const seq = this.head().seq;
    for (const h of this.store.moves.values())
      if (h.m.seq > seq + 1 && this.branchOf(h.m.id) === 'ahead') return true;
    return false;
  }

  /** The parents this client does not hold that held moves above the head (seq beyond head + 1) descend from, sorted. */
  missingParents(): Hex[] {
    const seq = this.head().seq;
    const out = new Set<Hex>();
    for (const h of this.store.moves.values()) {
      if (h.m.seq <= seq + 1) continue;
      let at = h;
      for (let i = 0; i <= this.store.moves.size; i++) {
        const up = this.store.moves.get(at.m.prevId);
        if (up === undefined) break;
        at = up;
      }
      if (!this.store.held(at.m.prevId)) out.add(at.m.prevId);
    }
    return [...out].sort();
  }

  /**
   * The held set (PROTOCOL-v2 §5.4 (b), D066, V2-56): every held Shares event and end attestation, valid or not, with
   * its signer's seat and what rule (b) reads it by (a Shares event's anchor, an end attestation's head), ascending
   * by id. A function of the held events alone; rule (b) (T11) and the rebroadcast (T13) read it.
   */
  heldSet(): { id: Hex; kind: 'shares' | 'roll' | 'end'; seat: number; at: Hex }[] {
    const out: { id: Hex; kind: 'shares' | 'roll' | 'end'; seat: number; at: Hex }[] = [];
    for (const [id, x] of this.store.cardShares)
      out.push({ id, kind: 'shares', seat: x.seat, at: x.ev.anchorId });
    for (const [id, x] of this.store.rollShares)
      out.push({ id, kind: 'roll', seat: x.seat, at: x.ev.anchorId });
    for (const [id, x] of this.store.ends) out.push({ id, kind: 'end', seat: x.seat, at: x.ev.headId });
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** The certificate of a held fork between shuffle steps (none in a deckless game), for its rebroadcast. */
  forkSteps(): Hex[] {
    const fork = this.current.fork;
    if (fork === null || fork.seq >= this.ctx.shuffleSteps) return [];
    return fork.successors.slice(0, 2);
  }
}
