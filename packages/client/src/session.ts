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
  type Pending,
  type RevealAction,
} from '@bored-games/game-kit';
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
  type PosShare,
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

/** The fold's state at one head, for cutting the chain back to it. */
interface Snapshot {
  phase: Phase;
  state: unknown;
  logLength: number;
  learned: number[];
  known: number[];
}

/** Two distinct moves by one seat under the same (prev, seq): proof of equivocation (D030 R2). */
interface Equivocation {
  seq: number;
  ids: [Hex, Hex];
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
  /** The root's `created_at`, the floor of `pendingSince`. */
  private rootCreatedAt: number;
  /**
   * Verified shares from folded Shares events and from accepted moves. Rebuilt from those two sources when the
   * chain is cut back (see `rollback`).
   */
  private shares: ShareStore;
  /** Shares events folded in, by id (including those that added nothing new), every share verified. */
  private readonly sharesSeen = new Map<Hex, ParsedShares>();
  /**
   * `snapshots[i]` is the fold as it stood at head seq `i`, taken just before move `i + 1` was linked, so the chain
   * can be cut back to any accepted move.
   */
  private readonly snapshots: Snapshot[] = [];
  /** My positions already decrypted (or found undecryptable), so each is tried once. */
  private readonly learned = new Set<number>();
  /** My positions whose card the module has learned. */
  private readonly known = new Set<number>();
  /** Game actions and derived reveals in the order the fold applied them (D030 R6). */
  private readonly actionLog: LoggedAction[] = [];

  /** Moves that wait for their `prev` to become the head, keyed by `prev`. */
  private readonly movesByPrev = new Map<Hex, Map<Hex, ParsedMove>>();
  /** Shares events that wait for the final deck. */
  private readonly waitingShares = new Map<Hex, ParsedShares>();
  private readonly rejected = new Map<Hex, string>();
  /** Game actions' share and reveal checks, by event id: null when every proof verifies, else the reason. */
  private readonly actionChecked = new Map<Hex, string | null>();

  /**
   * Every well-formed move from a seated key, by `prev:seq:seat`: the first id seen. A second id under the same key
   * proves equivocation (D030 R2), whether or not either move is otherwise valid.
   */
  private readonly moveKeys = new Map<string, Hex>();
  /**
   * Equivocating seats, each with the lowest `seq` at which two of its moves collide and the two ids that prove it.
   * They forfeit (§8.2); Task 4 settles the outcome.
   */
  private readonly equivocation = new Map<number, Equivocation>();

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
    // Every well-formed move from a seated key counts as equivocation evidence, even one rejected before.
    if (parsed.kind === 'move' && this.recordMoveKey(parsed.m, seat)) {
      this.rollback();
      this.settle();
      return { status: 'accepted' };
    }
    const known = this.rejected.get(p.id);
    if (known !== undefined) return { status: 'rejected', reason: known };
    if (parsed.kind === 'shares') return this.intakeShares(parsed.s, seat);
    const cut = this.cut();
    if (cut !== null && parsed.m.seq > cut) {
      return { status: 'rejected', reason: 'a forfeit is recorded: no further moves are folded' };
    }
    return this.intakeMove(parsed.m, seat);
  }

  /**
   * Keep the move's (prev, seq, signer) key. Returns true when it is a second, distinct move under a known key at a
   * lower `seq` than any equivocation already recorded for that seat: the signer equivocated (D030 R2) and
   * forfeits. The rival's id is kept as evidence.
   */
  private recordMoveKey(m: ParsedMove, seat: number): boolean {
    const key = `${m.prevId}:${m.seq}:${seat}`;
    const first = this.moveKeys.get(key);
    if (first === undefined) {
      this.moveKeys.set(key, m.id);
      return false;
    }
    if (first === m.id) return false;
    const known = this.equivocation.get(seat);
    if (known !== undefined && known.seq <= m.seq) return false;
    this.equivocation.set(seat, { seq: m.seq, ids: [first, m.id] });
    return true;
  }

  /**
   * The head seq the game stops at once a forfeit is recorded: the common prev of the earliest equivocation, judged
   * by the rivals' `seq` (one below it). Moves above it are not folded, so the state a forfeit is settled on does
   * not depend on which rival, if any, a client linked. Null while no forfeit is recorded.
   */
  private cut(): number | null {
    let out: number | null = null;
    for (const e of this.equivocation.values()) if (out === null || e.seq - 1 < out) out = e.seq - 1;
    return out;
  }

  /** Whether the event was folded in or is pooled. */
  private isKnown(id: Hex): boolean {
    if (this.linked.has(id) || this.sharesSeen.has(id) || this.waitingShares.has(id)) return true;
    for (const e of this.equivocation.values()) if (e.ids.includes(id)) return true;
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
    const cut = this.cut();
    if (cut !== null && m.seq > cut) return 'wait';
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
   * Fold a game action whose `prev` is the head (PROTOCOL §6.5, D030 R1). In order: the signer is the pending
   * seat; every share and reveal verifies; the module accepts the action; the reveals are exactly the positions
   * `revealsOf` names, each decrypting to the claimed card; and the signer's owed shares are all present. A move
   * that lacks only shares other events may still bring (another seat's share of a revealed position, or one of
   * its own owed shares) waits.
   */
  private foldAction(
    m: ParsedMove,
    seat: number,
    c: Extract<ParsedMove['content'], { type: 'action' }>,
  ): Fold {
    // Game actions are folded from the play phase on; until then they wait.
    if (this.phase === 'shuffle' || this.phase === 'deal') return 'wait';
    if (this.phase !== 'play') return reject('the game is not in play');
    const p = this.module.pending(this.state);
    // A pending reveal resolves once its shares arrive; the move may follow it.
    if (p.type === 'reveal') return 'wait';
    if (p.type !== 'player') return reject('no player decision is pending');
    if (seat !== p.seat) return reject(`move ${m.seq} must be signed by seat ${p.seat}`);

    const bad = this.actionProofs(m.id, seat, c.shares, c.reveals);
    if (bad !== null) return reject(bad);

    const r = this.module.apply(this.state, c.action);
    if (!r.ok) return reject(`the module rejects the action: ${r.error.code}: ${r.error.message}`);

    const claims = this.module.revealsOf(this.state, c.action);
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

    const brought = new Set(c.shares.map((x) => x.pos));
    if (this.shares.missing(seat, this.module.dealt(this.state)).some((pos) => !brought.has(pos)))
      return 'wait';

    this.link(m);
    for (const { pos, share } of [...c.shares, ...c.reveals]) this.shares.add(seat, pos, share, m.createdAt);
    this.state = deepFreeze(r.state);
    this.actionLog.push({ actor: seat, action: c.action });
    return 'accepted';
  }

  /** Verify a game action's shares and reveals against the signer's key, once per event. Null when all verify. */
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
      known: [...this.known],
    };
    this.chain.push(m);
    this.linked.add(m.id);
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
      this.known.add(d.pos);
      progressed = true;
    }
    return progressed;
  }

  /**
   * Cut the chain back to `cut()` when it runs past it: drop the later moves, restore the fold as it stood at that
   * head, and rebuild the share store from the Shares events and the moves that remain. Learns are redone from the
   * shares by the next `settle`.
   */
  private rollback(): void {
    const cut = this.cut();
    if (cut === null || this.chain.length <= cut) return;
    const snap = this.snapshots[cut] as Snapshot;
    for (const m of this.chain.splice(cut)) this.linked.delete(m.id);
    this.snapshots.length = cut;
    this.decks.length = Math.min(this.decks.length, cut + 1);
    this.phase = snap.phase;
    this.state = snap.state;
    this.actionLog.length = snap.logLength;
    this.learned.clear();
    for (const pos of snap.learned) this.learned.add(pos);
    this.known.clear();
    for (const pos of snap.known) this.known.add(pos);
    this.shares = new ShareStore(this.seats);
    if (this.finalDeck() === null) {
      // The shares were verified against a final deck that is gone: they wait again, as if never folded.
      for (const [id, s] of this.sharesSeen) this.waitingShares.set(id, s);
      this.sharesSeen.clear();
      this.actionChecked.clear();
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

  /**
   * The game's last progress (D030 R3): the largest `created_at` among the root, the accepted moves and, per kept
   * share, the earliest verified copy of it. It depends only on which events are held, not their arrival order.
   */
  private pendingSince(): number {
    let out = this.rootCreatedAt;
    for (const m of this.chain) if (m.createdAt > out) out = m.createdAt;
    const shares = this.shares.latest();
    return shares !== null && shares > out ? shares : out;
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
      pendingSince: this.pendingSince(),
      outcome: null,
      forfeits: [...this.equivocation.keys()].sort((a, b) => a - b),
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
    // Once a forfeit is recorded no further move is folded (Task 4 settles the outcome).
    if (me === null || this.equivocation.size > 0) return [];
    if (this.phase === 'shuffle' && this.chain.length === me.seat) return [{ kind: 'shuffle' }];
    if (this.phase === 'deal' && this.shares.missing(me.seat, this.module.dealt(this.state)).length > 0) {
      return [{ kind: 'deal' }];
    }
    if (this.decides(me)) return [{ kind: 'decide' }];
    return [];
  }

  /**
   * Whether the play phase pends `me`'s decision, no forfeit is recorded, and I know every card dealt to me (so the
   * module's legal actions are exact). By R1 the other seats' shares for my cards are in by my turn.
   */
  private decides(me: Identity): boolean {
    if (this.phase !== 'play' || this.equivocation.size > 0) return false;
    const p = this.module.pending(this.state);
    if (p.type !== 'player' || p.seat !== me.seat) return false;
    return this.module
      .dealt(this.state)
      .every((d) => d.to !== me.seat || d.deck !== this.deckId || this.known.has(d.pos));
  }

  /** My legal actions when a decision is mine (`decide` duty); otherwise none. A fresh, frozen list. */
  legalActions(): readonly unknown[] {
    const me = this.me;
    if (me === null || !this.decides(me)) return [];
    return deepFreeze(JSON.parse(canonicalJson(this.module.legalActions(this.state, me.seat))) as unknown[]);
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

  /**
   * My game-action move: `action` (one of `legalActions()`), every share I owe as of the head (R1) and my reveal
   * shares for the cards it shows (`revealsOf`), each sorted by position. Throws `ClientError` unless a decision
   * is mine and the action is legal.
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
