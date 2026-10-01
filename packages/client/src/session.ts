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
import { deepFreeze, type GameModule, type Pending, type RevealAction } from '@bored-games/game-kit';
import {
  finalizeEvent,
  getPublicKey,
  type Hex,
  KIND,
  logHash,
  moveTemplate,
  type NostrEvent,
  type ParsedJoin,
  type ParsedMove,
  type ParsedRoot,
  type ParsedShares,
  ProtocolError,
  parseJoin,
  parseMove,
  parseRoot,
  parseShares,
  parseTable,
  sharesTemplate,
  validateRoot,
} from '@bored-games/protocol';
import { ClientError } from './errors.ts';
import { ShareStore } from './shares.ts';
import type { Duty, Identity, Phase, ReceiveResult, SessionInput, SessionView } from './types.ts';

/*
 * GameSession: a deterministic fold over one game's signed events (PROTOCOL §6, D030). Events may arrive in any
 * order and more than once. Each one is parsed strictly, checked against the root's seats, and either folded in,
 * kept in a pool until what it depends on arrives, or rejected. After every accepted event the pool is retried
 * until nothing more applies, so every client that holds the same events reaches the same state.
 */

type AnyModule = GameModule<unknown, { readonly type: string }, unknown>;

/** The outcome of trying to fold one event: folded, not yet (keep it pooled), or a rejection reason. */
type Fold = 'accepted' | 'wait' | { reject: string };

/** One entry of the interleaved action log: a seat's game action or a derived reveal, in fold order (D030 R6). */
export interface LoggedAction {
  actor: number | 'deck';
  action: unknown;
}

const reject = (reason: string): Fold => ({ reject: reason });

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
  private readonly me: Identity | null;
  /** Card points to card indices for the deck. */
  private readonly cards: ReadonlyMap<string, number>;

  private phase: Phase = 'shuffle';
  /** Accepted moves in `seq` order. */
  private readonly chain: ParsedMove[] = [];
  /** The root id and every accepted move id. */
  private readonly linked = new Set<Hex>();
  /** `decks[k]` is the deck after `k` shuffle steps; `decks[0]` is the initial deck. */
  private readonly decks: Ciphertext[][];
  /** Shuffle proofs already checked, by event id, so each is verified once per session. */
  private readonly shuffleChecked = new Map<Hex, boolean>();
  /** The module state (frozen), set up in view mode once the shuffle is complete. */
  private state: unknown = null;
  private pendingSince: number;
  private readonly shares: ShareStore;
  /** Ids of Shares events folded in (including those that added nothing new). */
  private readonly sharesSeen = new Set<Hex>();
  /** My positions already decrypted (or found undecryptable), so each is tried once. */
  private readonly learned = new Set<number>();
  /** Game actions and derived reveals in the order the fold applied them (D030 R6). */
  private readonly actionLog: LoggedAction[] = [];

  /** Moves that wait for their `prev` to become the head, keyed by `prev`. */
  private readonly movesByPrev = new Map<Hex, Map<Hex, ParsedMove>>();
  /** Shares events that wait for the final deck. */
  private readonly waitingShares = new Map<Hex, ParsedShares>();
  private readonly rejected = new Map<Hex, string>();

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
    this.me = input.me === null ? null : { ...input.me, sessionSk: input.me.sessionSk.slice() };
    this.decks = [initialDeck(this.deckId, this.deckSize)];
    this.cards = cardTable(this.deckId, this.deckSize);
    this.shares = new ShareStore(this.seats);
    this.linked.add(root.id);
    this.pendingSince = 0;
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
    s.pendingSince = (input.root as NostrEvent).created_at;
    return s;
  }

  /* ------------------------------------------------------------------------------------------- intake */

  /** Fold in one event from a peer (or this client's own, fed back). Never throws. `now` is the local clock. */
  receive(ev: unknown, now: number): ReceiveResult {
    try {
      return this.intake(ev, now);
    } catch (e) {
      return { status: 'rejected', reason: `internal error: ${message(e)}` };
    }
  }

  /** Re-check time-dependent claims against the local clock. */
  tick(_now: number): void {
    // Nothing folded so far depends on the clock; timeout claims will.
  }

  private intake(ev: unknown, _now: number): ReceiveResult {
    const kind = kindOf(ev);
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
    const known = this.rejected.get(p.id);
    if (known !== undefined) return { status: 'rejected', reason: known };
    return parsed.kind === 'move' ? this.intakeMove(parsed.m, seat) : this.intakeShares(parsed.s, seat);
  }

  /** Whether the event was folded in or is pooled. */
  private isKnown(id: Hex): boolean {
    if (this.linked.has(id) || this.sharesSeen.has(id) || this.waitingShares.has(id)) return true;
    for (const moves of this.movesByPrev.values()) if (moves.has(id)) return true;
    return false;
  }

  private rejectEvent(id: Hex, reason: string): ReceiveResult {
    this.rejected.set(id, reason);
    return { status: 'rejected', reason };
  }

  private intakeMove(m: ParsedMove, seat: number): ReceiveResult {
    const pre = this.moveShape(m, seat);
    if (pre !== null) return this.rejectEvent(m.id, pre);
    if (m.prevId !== this.headId()) {
      if (this.linked.has(m.prevId)) {
        return this.rejectEvent(m.id, 'its prev already has an accepted successor');
      }
      this.pool(m);
      return { status: 'stored' };
    }
    const r = this.foldMove(m, seat);
    if (r === 'wait') {
      this.pool(m);
      return { status: 'stored' };
    }
    if (r !== 'accepted') return this.rejectEvent(m.id, r.reject);
    this.settle();
    return { status: 'accepted' };
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

  private intakeShares(s: ParsedShares, seat: number): ReceiveResult {
    for (const { pos } of s.shares) {
      if (pos >= this.deckSize) return this.rejectEvent(s.id, `position ${pos} is outside the deck`);
    }
    const r = this.foldShares(s, seat);
    if (r === 'wait') {
      this.waitingShares.set(s.id, s);
      return { status: 'stored' };
    }
    if (typeof r === 'object') return this.rejectEvent(s.id, r.reject);
    if (r === 'nothing-new') return { status: 'duplicate' };
    this.settle();
    return { status: 'accepted' };
  }

  /* --------------------------------------------------------------------------------------------- fold */

  private headId(): Hex {
    return this.chain.length === 0 ? this.root.id : (this.chain[this.chain.length - 1] as ParsedMove).id;
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
    // Game actions are folded from the play phase on; until then they wait.
    return 'wait';
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
    this.chain.push(m);
    this.linked.add(m.id);
    this.pendingSince = Math.max(this.pendingSince, m.createdAt);
    // Pooled rivals that named the same prev can no longer link.
    const rivals = this.movesByPrev.get(m.prevId);
    if (rivals !== undefined) {
      for (const id of rivals.keys())
        if (id !== m.id) this.rejected.set(id, 'its prev already has an accepted successor');
      this.movesByPrev.delete(m.prevId);
    }
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
    this.sharesSeen.add(s.id);
    let added = 0;
    for (const { pos, share } of s.shares) if (this.shares.add(seat, pos, share)) added++;
    if (added === 0) return 'nothing-new';
    this.pendingSince = Math.max(this.pendingSince, s.createdAt);
    return 'accepted';
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

  /** Retry pooled events until nothing more applies. */
  private settle(): void {
    for (;;) {
      let progressed = false;
      const head = this.headId();
      const waiting = this.movesByPrev.get(head);
      if (waiting !== undefined) {
        for (const m of byId(waiting.values())) {
          const r = this.foldMove(m, this.seatOf.get(m.pubkey) as number);
          if (r === 'accepted') {
            progressed = true;
            break;
          }
          if (r === 'wait') continue;
          waiting.delete(m.id);
          this.rejected.set(m.id, r.reject);
        }
        if (waiting.size === 0) this.movesByPrev.delete(head);
      }
      if (this.finalDeck() !== null) {
        for (const s of byId(this.waitingShares.values())) {
          this.waitingShares.delete(s.id);
          const r = this.foldShares(s, this.seatOf.get(s.pubkey) as number);
          if (r === 'accepted') progressed = true;
          else if (typeof r === 'object') this.rejected.set(s.id, r.reject);
        }
      }
      if (this.advance()) progressed = true;
      if (!progressed) return;
    }
  }

  /** Phase changes, derived reveals and private learns that the folded events allow. Returns whether any happened. */
  private advance(): boolean {
    let progressed = false;
    if (this.phase === 'deal' && this.dealComplete()) {
      this.phase = 'play';
      progressed = true;
    }
    if (this.phase === 'play' && this.revealPublic()) progressed = true;
    if (this.learnPrivate()) progressed = true;
    return progressed;
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
        this.actionLog.push({ actor: 'deck', action });
        progressed = true;
      }
    }
  }

  /**
   * Private learns (PROTOCOL §6.4): decrypt each position dealt to me once every other seat's share is in, using
   * my own layer for mine, and tell the module.
   */
  private learnPrivate(): boolean {
    const me = this.me;
    const deck = this.finalDeck();
    if (me === null || deck === null || this.state === null) return false;
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
      progressed = true;
    }
    return progressed;
  }

  /* -------------------------------------------------------------------------------------------- views */

  view(): SessionView {
    return {
      phase: this.phase,
      rootId: this.root.id,
      seats: this.seats,
      mySeat: this.me?.seat ?? null,
      head: { id: this.headId(), seq: this.chain.length },
      state: this.state,
      pending: this.pending(),
      pendingSince: this.pendingSince,
      outcome: null,
      forfeits: [],
      audit: 'pending',
      logHash: logHash(this.chain.map((m) => m.id)),
      deadline: this.root.deadline,
    };
  }

  /** During the shuffle, the next shuffler; afterwards, the module's pending decision. A fresh copy. */
  private pending(): Pending {
    if (this.phase === 'shuffle') return { type: 'player', seat: this.chain.length, decision: 'shuffle' };
    const p = this.module.pending(this.state);
    return p.type === 'reveal' ? { type: 'reveal', deck: p.deck, positions: [...p.positions] } : { ...p };
  }

  duties(): Duty[] {
    const me = this.me;
    if (me === null) return [];
    if (this.phase === 'shuffle' && this.chain.length === me.seat) return [{ kind: 'shuffle' }];
    if (this.phase === 'deal' && this.shares.missing(me.seat, this.module.dealt(this.state)).length > 0) {
      return [{ kind: 'deal' }];
    }
    return [];
  }

  legalActions(): readonly unknown[] {
    return [];
  }

  /* ----------------------------------------------------------------------------------------- builders */

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
   * feed it back through `receive`.
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
   * nobody, that this seat has not shared yet, sorted by position.
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

  buildAction(_action: unknown, _rnd: RandomBytes, _createdAt: number): NostrEvent {
    this.requireDuty('decide');
    throw new ClientError('unreachable');
  }

  buildSecret(_rnd: RandomBytes, _createdAt: number): NostrEvent {
    this.requireDuty('secret');
    throw new ClientError('unreachable');
  }

  buildAttest(_rnd: RandomBytes, _createdAt: number): NostrEvent {
    this.requireDuty('attest');
    throw new ClientError('unreachable');
  }

  /** A seat this client may claim a timeout against at `now`, or null. */
  timeoutTarget(_now: number): number | null {
    return null;
  }

  buildTimeout(seat: number, _rnd: RandomBytes, _createdAt: number): NostrEvent {
    this.requireMe();
    throw new ClientError(`seat ${seat} cannot be claimed against now`);
  }
}
