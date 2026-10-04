import { type Point as CurvePoint, G, type RandomBytes } from '@bored-games/deck';
import { canonicalJson, deepFreeze, type Outcome as ModuleOutcome, moduleFor } from '@bored-games/game-kit';
import {
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
  type ParsedRoot,
  type ParsedStatsAttest,
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
  attestTemplate as statsTemplate,
  validateRoot,
} from '@bored-games/protocol';
import { auditGame, rankWithForfeits } from '../audit.ts';
import { ClientError } from '../errors.ts';
import { deckPartitions, parsePartitionMove } from '../partitioned-deck.ts';
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
import { moveShape, pendingAt } from './line.ts';
import { attestedResult, endAttestedSeats, endVerdict, lineLogHash, ownResult } from './results.ts';
import { EventStoreV2, resultKey } from './store.ts';
import type { AnyModule, GameCtx, Judgement, LinePoint } from './types.ts';
import { type Walk, walk } from './walk.ts';

/*
 * GameSessionV2: the protocol 2 fold over one game's signed events (PROTOCOL-v2; build plan D-E). Events may arrive
 * in any order and more than once. Each is parsed strictly at the game's proto ("2"), checked against the root's
 * seats and kept in the event store (`store.ts`) or rejected. The walk (`walk.ts`) is then recomputed from the
 * root: there is no fork choice. The game's result, its end attestations and the duties are functions of the held
 * events and the walk, so every client that holds the same events reaches the same state (V2-20).
 *
 * Built so far (task T7): intake of every kind, seats by session key (and by npub for attestations), the walk with
 * C(h) and the topmost fork (reported in the view; its scoring, the stop, is T10), deckless play to `over` with the
 * module's audit, end attestations (built with the session key, counted with either key, checked against the line
 * to their head) and the npub's stats attestation. Not yet: games with a deck (T8), dice (T9), the stop and the
 * equivocators (T10), the cutoff (T11), Timeout claims and Resigns as results (T12; both are stored, never
 * counted), the outbox rule and the rebroadcast set (T13). `create` refuses a module this session cannot fold yet.
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
  /** Events refused for good, by id, with the reason: they are not held. */
  private readonly rejected = new Map<Hex, string>();
  /** Judgements that never change, by move id (`walk`). */
  private readonly judgements = new Map<Hex, Judgement>();
  private current: Walk;
  /** Audits by the log hash of the line they ran on. */
  private readonly audits = new Map<Hex, SessionAudit>();
  /** The latest local clock reading seen by `receive` or `tick`. */
  private clock: number;

  private constructor(input: SessionInput, root: ParsedRoot, module: AnyModule, rules: unknown) {
    this.module = module;
    this.root = root;
    const deck = module.decks(rules)[0] ?? null;
    const partitions = deckPartitions(deck);
    this.ctx = {
      module,
      rules,
      rootId: root.id,
      seats: root.seats.length,
      deckId: deck?.id ?? null,
      deckSize: deck?.size ?? 0,
      partitions,
      shuffleSteps: partitions.length * root.seats.length,
      keys: root.seats.map((s) => s.deckKey),
      viewer: input.me?.seat ?? null,
    };
    this.seatOf = new Map(root.seats.map((s, i) => [s.session, i]));
    this.npubSeat = new Map(root.seats.map((s, i) => [s.npub, i]));
    this.me = input.me === null ? null : { ...input.me, sessionSk: input.me.sessionSk.slice() };
    this.rootSeenAt = input.rootSeenAt;
    this.clock = input.rootSeenAt;
    this.store = new EventStoreV2(root.id);
    this.current = walk(this.ctx, this.store, this.judgements);
  }

  /**
   * A session for the protocol 2 game started by `input.root`. Throws `ClientError` when the table or root does
   * not parse, the root is not proto 2 (a v1 game is `GameSession`'s, for good), the root is not a valid start of
   * the game (`validateRoot`, which also requires that the module version supports proto 2), no module folds it,
   * the module has a deck or rolls dice (not built yet: T8, T9), or `me` does not hold the seat it names.
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
    if (decks.length === 1)
      throw new ClientError('the protocol 2 session does not fold games with a deck yet (build plan T8)');
    if (typeof module.rolls === 'function')
      throw new ClientError('the protocol 2 session does not fold dice games yet (build plan T9)');

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
   * - Timeout claims and Resigns are `stored` (they count from T12), and Device notes `accepted` (stored only).
   */
  receive(ev: unknown, now: number): ReceiveResult {
    try {
      this.observe(now);
      return this.intake(ev, this.clockOf(now));
    } catch (e) {
      return { status: 'rejected', reason: `internal error: ${message(e)}` };
    }
  }

  /** Advance the local clock. Never throws. Timeout claims are judged from T12, so nothing else changes yet. */
  tick(now: number): void {
    this.observe(now);
  }

  private observe(now: number): void {
    if (typeof now === 'number' && Number.isFinite(now) && now > this.clock) this.clock = now;
  }

  private clockOf(now: number): number {
    return typeof now === 'number' && Number.isFinite(now) ? now : this.clock;
  }

  private see(id: Hex, now: number): void {
    if (!this.seenAt.has(id)) this.seenAt.set(id, now);
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

  /** The answer for a held event received again: a move judged invalid at its prev stays `rejected`. */
  private again(id: Hex): ReceiveResult {
    const j = this.current.judged.get(id);
    if (this.store.moves.has(id) && j?.kind === 'invalid') return { status: 'rejected', reason: j.why };
    const end = this.store.ends.get(id);
    if (end !== undefined && endVerdict(this.store, end.ev) === 'mismatch')
      return {
        status: 'rejected',
        reason: "the end attestation's log hash does not match the line to its head",
      };
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
   * A v2 Shares event (PROTOCOL-v2 §4.2). A card variant is invalid in a game without a deck, and a roll variant in
   * a game whose module does not roll (V2-08); both are refused, not held. (Games with a deck or dice are T8, T9.)
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
    if (s.type === 'shares') {
      if (this.ctx.deckId === null) return this.reject(s.id, 'a card Shares event in a game without a deck');
      return this.reject(s.id, 'protocol 2 games with a deck are folded from build task T8');
    }
    if (typeof this.module.rolls !== 'function')
      return this.reject(s.id, 'a roll Shares event in a game that does not roll');
    return this.reject(s.id, 'protocol 2 dice are folded from build task T9');
  }

  /** A Timeout claim (v1 §4.6 at proto 2): kept within the caps, judged from T12. */
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
    if (!kept.kept) return this.reject(t.id, kept.why);
    if (kept.evicted !== null) this.rejected.set(kept.evicted, 'claim limit');
    return { status: 'stored' };
  }

  /** A Resign (v1 §4.9 at proto 2): kept within the cap, counted from T12. */
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
    const kept = this.store.keepResign(r, seat);
    if (!kept.kept) return this.reject(r.id, kept.why);
    if (kept.evicted !== null) this.rejected.set(kept.evicted, 'resign limit');
    return { status: 'stored' };
  }

  /** A Secret reveal (v1 §4.7 at proto 2): a deckless game has none. */
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
    return this.reject(s.id, 'a deckless game has no deck secrets');
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
    const outside = a.end.forfeit.find((k) => k >= this.ctx.seats);
    if (outside !== undefined) return this.reject(a.id, `there is no seat ${outside}`);
    if (!this.store.addEnd(a, seat, bySession === undefined)) return { status: 'duplicate' };
    return this.endStatus(a);
  }

  /** How a held end attestation stands: see `receive`. */
  private endStatus(a: ParsedEndAttest): ReceiveResult {
    const verdict = endVerdict(this.store, a);
    if (verdict === 'mismatch')
      return {
        status: 'rejected',
        reason: "the end attestation's log hash does not match the line to its head",
      };
    const mine = this.result();
    if (verdict === 'valid' && mine !== null && resultKey(attestedResult(a)) === resultKey(mine))
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
    this.current = walk(this.ctx, this.store, this.judgements);
  }

  /* ---------------------------------------------------------------------------------------------- fold */

  private head(): LinePoint {
    const points = this.current.line.points;
    return points[points.length - 1] as LinePoint;
  }

  /** This client's result (PROTOCOL-v2 §5.5): null while live, and while a fork is held (scored from T10). */
  private result(): ResultId | null {
    return ownResult(this.ctx, this.current);
  }

  /** Whether a seat may resign this game (v1 §8.3, unchanged): never in a 2-seat game with a deck, nor when the module opts out. */
  private resignAllowed(): boolean {
    if (this.ctx.deckId !== null && this.ctx.seats === 2) return false;
    return this.module.resignAllowed?.(this.ctx.rules, this.ctx.seats) ?? true;
  }

  /** The audit of the line to the head (PROTOCOL-v2 §7.2): a deckless game's runs as soon as it is over. */
  private audit(): SessionAudit {
    const key = lineLogHash(this.store, this.head().id) as Hex;
    const known = this.audits.get(key);
    if (known !== undefined) return known;
    const head = this.head();
    const audit = auditGame({
      module: this.module,
      rules: this.ctx.rules,
      seats: this.ctx.seats,
      deckId: null,
      deck: [],
      secrets: [],
      cards: new Map(),
      log: this.current.line.log.slice(0, head.logLength),
      outcome: this.module.outcome(head.state),
    });
    if (this.audits.size >= MAX_AUDITS) this.audits.clear();
    this.audits.set(key, audit);
    return audit;
  }

  /**
   * The phase, outcome, audit and forfeits the view reports. With no fork and the module over, the result is the
   * module's outcome with the audit verdict (PROTOCOL-v2 §7.2): the seats the audit fails forfeit, last. While a
   * fork is held nothing is scored yet (the stop and the cutoff are T10, T11).
   */
  private status(): Status {
    const head = this.head();
    const r = this.result();
    if (r === null || r.kind !== 'over') {
      return { phase: head.phase, outcome: null, audit: 'pending', forfeits: [] };
    }
    const declared = this.module.outcome(head.state) as ModuleOutcome;
    const audit = this.audit();
    const failed = typeof audit === 'object' ? ascending(audit.fail) : [];
    const outcome =
      failed.length === 0
        ? { places: [...declared.places], reason: declared.reason, scores: [...declared.scores] }
        : rankWithForfeits(declared.scores, failed, declared.places);
    const copy = typeof audit === 'object' ? { fail: [...audit.fail], reason: audit.reason } : audit;
    return { phase: 'done', outcome, audit: copy, forfeits: failed };
  }

  /**
   * The progress time P (v1 §8.1, D030 Rulings 10 and 11): the latest local first-seen time over the root and the
   * walk's moves. No `created_at` counts.
   */
  private progress(): number {
    let out = this.rootSeenAt;
    for (const h of this.current.chain) out = Math.max(out, this.seenAt.get(h.m.id) ?? this.clock);
    return out;
  }

  /** The seats stalled at the head (v1 §8.1 as PROTOCOL-v2 §8.1 amends it): none while a fork is held or after the end. */
  private stalled(): number[] {
    if (this.current.fork !== null || this.result() !== null) return [];
    const p = pendingAt(this.ctx, this.head());
    return p?.type === 'player' ? [p.seat] : [];
  }

  /** The seats the game waits on at the head, ascending, a fresh copy (for the "Waiting for …" lines). */
  waitingFor(): number[] {
    return [...this.stalled()];
  }

  /** The canonical `{audit, logHash, outcome}` of the stats attestation (PROTOCOL-v2 §7.4), or null before `done`. */
  private statsContent(): string | null {
    const { phase, outcome, audit } = this.status();
    const r = this.result();
    if (phase !== 'done' || outcome === null || audit === 'pending' || r === null) return null;
    return canonicalJson({ audit, logHash: lineLogHash(this.store, r.head), outcome });
  }

  /** The seats whose latest stats attestation matches this client's result, ascending. */
  private statsAttested(): number[] {
    const mine = this.statsContent();
    if (mine === null) return [];
    return ascending([...this.store.stats].filter(([, a]) => a.content === mine).map(([seat]) => seat));
  }

  view(): SessionViewV2 {
    const status = this.status();
    const head = this.head();
    const w = this.current;
    const r = this.result();
    const p = pendingAt(this.ctx, head);
    const events = w.line.events.slice(0, head.eventsLength);
    const fork = w.fork;
    return {
      phase: status.phase,
      rootId: this.root.id,
      seats: this.ctx.seats,
      shuffleSteps: this.ctx.shuffleSteps,
      mySeat: this.me?.seat ?? null,
      head: { id: head.id, seq: head.seq },
      state: head.state,
      pending:
        p === null
          ? { type: 'over' }
          : p.type === 'reveal'
            ? { type: 'reveal', deck: p.deck, positions: [...p.positions] }
            : { ...p },
      pendingSince: this.progress(),
      outcome: status.outcome,
      forfeits: status.forfeits,
      resigned: [],
      resignOverridden: [],
      resignId: null,
      equivocators: [],
      audit: status.audit,
      logHash: lineLogHash(this.store, head.id) as Hex,
      resultLogHash:
        (r === null ? null : lineLogHash(this.store, r.head)) ?? (lineLogHash(this.store, head.id) as Hex),
      deadline: this.root.deadline,
      attested: this.statsAttested(),
      events: Object.freeze(events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events),
      proto: 2,
      fork:
        fork === null
          ? null
          : { at: fork.at, seat: fork.seat, certificate: fork.successors.slice(0, 2) as Hex[] },
      result: r === null ? null : { kind: r.kind, head: r.head, forfeit: [...r.forfeit] },
      stood: false,
      stop: null,
      secretWithheld: [],
      auditIncomplete: false,
      endAttested: r === null ? [] : endAttestedSeats(this.store, r),
      owed: { reveal: [], roll: [] },
      ownForfeit: null,
    };
  }

  /* ---------------------------------------------------------------------------------------------- duties */

  /**
   * What this seat must publish next, as of the walk's head. Spectators have none, and neither does a seat whose
   * client holds a fork (PROTOCOL-v2 §5.7; the Secret phase after a stop is T10):
   * - `decide`: the pending decision is mine and the module lists legal actions;
   * - `end`: this client has a result and holds none of its seat's end attestations of it (PROTOCOL-v2 §7.1);
   * - `attest`: the stats attestation, once the result and its audit are final (a SHOULD, PROTOCOL-v2 §7.4).
   */
  duties(): Duty[] {
    const me = this.me;
    if (me === null || this.current.fork !== null) return [];
    const r = this.result();
    if (r === null) return this.decides(me) ? [{ kind: 'decide' }] : [];
    if (!endAttestedSeats(this.store, r).includes(me.seat)) return [{ kind: 'end' }];
    if (this.statsContent() !== null && !this.statsAttested().includes(me.seat)) return [{ kind: 'attest' }];
    return [];
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

  /** A shuffle step: protocol 2 games with a deck are built from task T8, so no shuffle duty is ever due yet. */
  buildShuffle(_rnd: RandomBytes, _createdAt: number): NostrEvent {
    this.requireDuty('shuffle');
    throw new ClientError('no shuffle duty is due from this seat');
  }

  /** The deal: built from task T8, so no deal duty is ever due yet. */
  buildDeal(_rnd: RandomBytes, _createdAt: number): NostrEvent {
    this.requireDuty('deal');
    throw new ClientError('no deal duty is due from this seat');
  }

  /** A Secret reveal: a deckless game has none (games with a deck from T8). */
  buildSecret(_rnd: RandomBytes, _createdAt: number): NostrEvent {
    this.requireDuty('secret');
    throw new ClientError('no secret duty is due from this seat');
  }

  /**
   * My game-action move at proto 2: `action` (one of `legalActions()`) on the walk's head. A deckless game's move
   * carries no shares or reveals. Throws `ClientError` unless a decision is mine and the action is legal.
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
    const t = moveTemplate(
      {
        rootId: this.root.id,
        prevId: head.id,
        seq: head.seq + 1,
        content: { type: 'action', action: legal, reveals: [], shares: [] },
      },
      createdAt,
      '2',
    );
    return finalizeEvent(t, me.sessionSk, rnd);
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
    const r = this.result() as ResultId;
    return statsTemplate(
      {
        rootId: this.root.id,
        audit: audit as Exclude<SessionAudit, 'pending'>,
        logHash: lineLogHash(this.store, r.head) as Hex,
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

  /** Timeout claims under protocol 2 are built in task T12: none yet. */
  timeoutTarget(_now: number): number | null {
    return null;
  }

  /** Timeout claims under protocol 2 are built in task T12: throws `ClientError`. */
  buildTimeout(_seat: number, _rnd: RandomBytes, _createdAt: number): NostrEvent {
    this.requireMe();
    throw new ClientError('timeout claims in a protocol 2 game are not built yet (build plan T12)');
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
   * Where `id` sits: `chain` (the root or a move on the walk), `ahead` (a held move whose ancestry through held moves
   * reaches the head), `side` (one whose ancestry reaches the walk below the head), or `unknown`.
   */
  branchOf(id: Hex): 'chain' | 'ahead' | 'side' | 'unknown' {
    if (this.chainSeq(id) !== null) return 'chain';
    const head = this.head().id;
    let at = this.store.moves.get(id);
    for (let i = 0; at !== undefined && i <= this.store.moves.size; i++) {
      if (at.m.prevId === head) return 'ahead';
      if (this.chainSeq(at.m.prevId) !== null) return 'side';
      at = this.store.moves.get(at.m.prevId);
    }
    return 'unknown';
  }

  /** Whether a held move above the head (seq beyond head + 1) descends from the head. */
  aheadOfHead(): boolean {
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

  /** The certificate of a held fork between shuffle steps (none in a deckless game), for its rebroadcast. */
  forkSteps(): Hex[] {
    const fork = this.current.fork;
    if (fork === null || fork.seq >= this.ctx.shuffleSteps) return [];
    return fork.successors.slice(0, 2);
  }
}
