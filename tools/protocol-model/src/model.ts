/*
 * An exhaustive, small-scope model of the hidden-information reveal protocols (docs/proposals/prompt-reveal.md §6).
 * Test tooling only: nothing here is used by the client, and it abstracts the cryptography away.
 *
 * The game. S seats move round-robin (the seat at depth d is d mod S), and the game ends after `length` moves.
 * A move is `draw` (it takes the next undealt position and grants it) or `pass`. A grant's viewer set depends on
 * the mode: `private` (the drawer: a Chain Reaction tile, U1), `viewers` (every seat but the drawer: a Hanabi
 * draw, U2) or `public` (every seat: a Hanabi play or a dice roll, U3 and U4). Honest seats always draw; the
 * adversary chooses. Only the pending seat can sign a move on a prev, as in PROTOCOL §6.5.
 *
 * The cryptography. A value at a position is known to a set of seats once every seat outside the set has released
 * its share of the position to it: publicly, or sealed to one of its members. Shares are branch-independent
 * values, which is the whole problem (D039).
 *
 * The network. The adversary (a coalition of 1–2 seats) sees every event at once, signs anything its seats may
 * sign, delivers every event to every honest client in any order and at any time, and decides when each honest
 * client's deadline passes. Honest clients react to each delivery at once (they are online). A deadline may pass
 * only while every event some honest client holds has reached every honest client (PROTOCOL's implicit
 * assumption, made explicit: honest gossip arrives within the deadline).
 *
 * The checks, at every state where every created event has reached every honest client:
 * - S1: each position the coalition knows is one it is entitled to on each honest client's final chain, by a grant
 *   made before it learned the value. A breach whose every releasing share came from a chain strictly extending
 *   that client's final chain is reported as `post-end` (benign: the result was fixed before); anything else is an
 *   `exposure`.
 * - S2: no honest seat forfeits a timeout or is flagged.
 * - S3: every honest client has the same result. A difference involving a client whose result is a claim or a
 *   resign it counted first is the known claim race (PROTOCOL §11), reported as `claim-race`; any other difference
 *   is a `divergence`.
 * - Liveness (honest-only runs): once the network is quiet, every honest seat knows every value granted to it on
 *   the chain (`prompt`), and with a lazy seat that never acks nor shares early, it knows it once every other seat
 *   has moved after the grant (`fallback`).
 * - Ratings (round 2): no stop, and no stop that overrides a counted claim or resign, leaves the equivocator or its
 *   coalition better off than a forfeit (`rating`).
 * - Flags: an honest seat (one key, possibly on two devices) is never flagged for vouching for two sides
 *   (`honest-flagged`).
 *
 * Round-2 options: honest seats on two devices that share one key with independent delivery (`devices`), moves
 * that draw two positions (`multiDraw`), and honest humans who leave when their client shows a stop and come back
 * one deadline after being notified of a resume (`absence`).
 */

export type Seat = number;
/**
 * Grant modes: `private` (U1, the drawer), `viewers` (U2, every seat but the drawer), `public` (U3, a card played
 * from the drawer's hand and shown to all), `roll` (U4, a public value whose point is bound to the move's id).
 */
export type Mode = 'private' | 'viewers' | 'public' | 'roll';
/**
 * - `pile`: candidate (d) (prompt-reveal.md §5): ownership is fixed before any share is released (per-seat draw
 *   piles cut from the shuffled deck, so seat k's i-th draw is always position p_k(i)); shares are released at
 *   once, with no Acks; positions past a seat's pile come from a common reserve and use the slow path only; a
 *   fork stops the game at the fork (unless one side already reached the end: that ending stands) and is the
 *   equivocator's forfeit; a stop never overrides a counted claim or resign.
 * - `fgr2`: round 2 of the recommended design (prompt-reveal.md §5): `fgr`, but a fork stops unless exactly one
 *   side is vouched for by every seat but the equivocator (never the lowest id), every move is acked, a seat that
 *   vouches for two sides is flagged (and a fork where one did stops), a stop is the equivocator's forfeit, a stop
 *   never overrides a counted claim or resign (rule 9), and once a client holds a fork every claim needs two
 *   deadlines (rule 10b).
 * - `v1`: PROTOCOL v1: shares ride on the seat's own next move; fork choice (length, then lowest id); no acks.
 * - `d039`: v1 plus prompt shares as soon as the grant is on the client's chain (D039, reverted).
 * - `ack`: "acknowledge, then share" as in fast-reveal.md §2 (acks of drawing moves, release on all acks, the
 *   finality filter in fork choice), without the lock.
 * - `ack-lock`: `ack` plus fast-reveal.md §5 A (no early share while a rival is held) and B (ack implies lock).
 * - `fs`: fork stop alone: prompt shares as in `d039`, but a fork with no final side ends the game at the fork.
 * - `fgr`: the recommended design (prompt-reveal.md §5): acks, release only on a final move (every seat vouches
 *   for it by a move or an ack in its subtree), fork stop, and the slow path as in v1.
 */
export type Design = 'v1' | 'd039' | 'ack' | 'ack-lock' | 'fs' | 'fgr' | 'fgr2' | 'pile';

export const DESIGNS: readonly Design[] = ['v1', 'd039', 'ack', 'ack-lock', 'fs', 'fgr', 'fgr2', 'pile'];
export const MODES: readonly Mode[] = ['private', 'viewers', 'public'];

export interface Scope {
  readonly design: Design;
  readonly mode: Mode;
  readonly seats: number;
  /** Moves after which the game is over. */
  readonly length: number;
  /** The adversary's seats; empty for an honest-only run. */
  readonly coalition: readonly Seat[];
  /** Budgets for the adversary's events. */
  readonly advMoves: number;
  readonly advAcks: number;
  readonly advClaims: number;
  readonly advResigns: number;
  /** How many times a deadline may pass (on some honest client). */
  readonly expiries: number;
  /** Most adversary moves on one prev (rivals). */
  readonly rivalsPerPrev: number;
  /** Honest-only runs: a seat that moves but never acks or shares outside its moves (offline between turns). */
  readonly lazy?: Seat | null;
  /** Clients per honest seat: 2 models one session key on two devices with independent delivery. */
  readonly devices?: number;
  /**
   * With two devices, which ones act on their own: `all`; `first` (one designated acking device per seat); or
   * `checked` (`first`, and a device lets its human move only after checking the seat's own published events for
   * a vouch on another side, as a query to the relays would).
   */
  readonly ackDevice?: 'all' | 'first' | 'checked';
  /** `pile`: positions in each seat's own draw pile; later draws come from the common reserve. */
  readonly pile?: number;
  /** The adversary may also sign moves that draw two positions. */
  readonly multiDraw?: boolean;
  /** Honest humans leave when their client shows a stop, and return one deadline after a resume. */
  readonly absence?: boolean;
  /**
   * When a stop overrides a counted claim or resign (fork-stop designs): `at-or-past` (round 1: a fork at or
   * below its head), `strict` (strictly below its head, as the round-2 review proposed) or `none` (never: the
   * round-2 default, since `strict` still lets a colluder void a counted timeout). Default by design.
   */
  readonly rule9?: 'at-or-past' | 'strict' | 'none';
  /** Stop exploring at the first violation of these kinds (regression checks). */
  readonly stopAt?: readonly ViolationKind[];
  /**
   * Keep full state keys instead of 64-bit hash compaction. Compaction (as in SPIN's hash-compact mode) keeps
   * memory small; a collision could only prune a state, with probability about n²/2^65 for n states.
   */
  readonly exactKeys?: boolean;
  /** Give up after this many distinct states (the result says so). */
  readonly maxStates?: number;
}

export type ViolationKind =
  | 'exposure'
  | 'post-end'
  | 'honest-forfeit'
  | 'divergence'
  | 'claim-race'
  | 'not-prompt'
  | 'no-fallback'
  | 'rating'
  | 'honest-flagged'
  | 'self-leak';

export interface Violation {
  readonly kind: ViolationKind;
  readonly detail: string;
  readonly trace: readonly string[];
}

export interface Result {
  readonly scope: Scope;
  readonly states: number;
  readonly checked: number;
  readonly complete: boolean;
  /** The first violation found of each kind, and how many states showed it. */
  readonly violations: Partial<Record<ViolationKind, { count: number; first: Violation }>>;
}

/* ------------------------------------------------------------------------------------------------ events */

interface MoveEv {
  readonly t: 'move';
  readonly id: string;
  readonly seat: Seat;
  readonly prev: string;
  readonly depth: number;
  readonly kind: Kind;
  readonly v: number;
  /** Shares released inside the move (the slow path): `pos:to`, `to` = `*` for public. */
  readonly rel: readonly string[];
  /** Positions the coalition knew when the move was created (for the foresight check). */
  readonly kc: readonly number[];
  readonly honest: boolean;
}
interface AckEv {
  readonly t: 'ack';
  readonly id: string;
  readonly seat: Seat;
  readonly move: string;
}
interface ShareEv {
  readonly t: 'share';
  readonly id: string;
  readonly seat: Seat;
  readonly pos: number;
  readonly to: Seat | null;
  /** The releaser's head when it released. */
  readonly head: string;
}
interface ClaimEv {
  readonly t: 'claim';
  readonly id: string;
  readonly seat: Seat;
  readonly head: string;
}
interface ResignEv {
  readonly t: 'resign';
  readonly id: string;
  readonly seat: Seat;
  readonly head: string;
}
type Ev = MoveEv | AckEv | ShareEv | ClaimEv | ResignEv;

const ROOT = 'R';

type Kind = 'draw' | 'draw2' | 'pass';
const DRAWS: Record<Kind, number> = { draw: 1, draw2: 2, pass: 0 };

/* ------------------------------------------------------------------------------------------------ state */

interface Frozen {
  readonly path: readonly string[];
  readonly reason: 'claim' | 'resign';
  readonly seat: Seat; // the forfeiting seat (stalled or resigning)
}

interface Client {
  readonly seat: Seat;
  readonly device: number;
  readonly has: ReadonlySet<string>;
  readonly frozen: Frozen | null;
  /** The head at which this client's deadline last passed, if it is still the head. */
  readonly expired: string | null;
  /** How many deadlines passed at `expired`. */
  readonly expiredCount: number;
  /** The client has shown a stop since it was last live. */
  readonly sawStop: boolean;
  /** The seat's human left on seeing a stop and has not been notified back yet (`absence`). */
  readonly absent: boolean;
}

interface State {
  readonly events: ReadonlyMap<string, Ev>;
  readonly clients: readonly Client[];
  readonly expiries: number;
}

/* ------------------------------------------------------------------------------------------- the game */

type Viewers = { readonly public: true } | { readonly public: false; readonly seats: readonly Seat[] };

interface Grant {
  readonly pos: number;
  readonly v: Viewers;
  readonly move: string;
  /** A position whose owner depends on history (the `pile` design's common reserve): slow path only. */
  readonly reserve: boolean;
}

/** Position numbers: pile p_k(i) = k·100 + i; reserve 1000 + j; a roll bound to a move id 2000 + its index. */
const PILE = 100;
const RESERVE = 1000;
const ROLL = 2000;
const rollIds = new Map<string, number>();
function rollPos(key: string): number {
  let n = rollIds.get(key);
  if (n === undefined) {
    n = ROLL + rollIds.size;
    rollIds.set(key, n);
  }
  return n;
}

function viewersOf(mode: Mode, drawer: Seat, seats: number): Viewers {
  if (mode === 'public' || mode === 'roll') return { public: true };
  if (mode === 'private') return { public: false, seats: [drawer] };
  return {
    public: false,
    seats: Array.from({ length: seats }, (_, s) => s).filter((s) => s !== drawer),
  };
}

const sees = (v: Viewers, s: Seat): boolean => v.public || v.seats.includes(s);

/** The shares seat `s` owes for a grant: `pos:*` (public) or `pos:t` (sealed to t). */
function owed(g: Grant, s: Seat): string[] {
  if (g.v.public || !g.v.seats.includes(s)) return [`${g.pos}:*`];
  return g.v.seats.filter((t) => t !== s).map((t) => `${g.pos}:${t}`);
}

/* ------------------------------------------------------------------------------------------ the model */

export function explore(scope: Scope): Result {
  return new Explorer(scope).run();
}

class Explorer {
  private readonly s: Scope;
  private readonly honest: Seat[];
  private readonly coalition: ReadonlySet<Seat>;
  private readonly visited = new Set<string>();
  private readonly viewMemo = new Map<string, View>();
  private states = 0;
  private checked = 0;
  private complete = true;
  private halt = false;
  private readonly found: Partial<Record<ViolationKind, { count: number; first: Violation }>> = {};

  constructor(scope: Scope) {
    this.s = scope;
    this.coalition = new Set(scope.coalition);
    this.honest = Array.from({ length: scope.seats }, (_, k) => k).filter((k) => !this.coalition.has(k));
  }

  run(): Result {
    let st: State = {
      events: new Map(),
      clients: this.honest.flatMap((seat) =>
        Array.from({ length: this.s.devices ?? 1 }, (_, device) => ({
          seat,
          device,
          has: new Set<string>(),
          frozen: null,
          expired: null,
          expiredCount: 0,
          sawStop: false,
          absent: false,
        })),
      ),
      expiries: 0,
    };
    st = this.settle(st);
    // Iterative DFS: each frame holds a state and a link to the frame it came from, for its trace.
    const stack: Frame[] = [{ st, parent: null, label: '' }];
    this.visited.add(this.key(st));
    while (stack.length > 0 && !this.halt) {
      const frame = stack.pop() as Frame;
      const cur = frame.st;
      this.states++;
      if (this.s.maxStates !== undefined && this.states > this.s.maxStates) {
        this.complete = false;
        break;
      }
      if (this.fullyDelivered(cur)) this.check(cur, () => traceOf(frame));
      if (this.halt) break;
      for (const [label, next] of this.successors(cur)) {
        const k = this.key(next);
        if (this.visited.has(k)) continue;
        this.visited.add(k);
        stack.push({ st: next, parent: frame, label });
      }
    }
    return {
      scope: this.s,
      states: this.states,
      checked: this.checked,
      complete: this.complete && !this.halt,
      violations: this.found,
    };
  }

  /* ----------------------------------------------------------------------------------------- keys */

  private key(st: State): string {
    let evs = eventsKeys.get(st.events);
    if (evs === undefined) {
      evs = [...st.events.values()].map(evKey).sort().join(';');
      eventsKeys.set(st.events, evs);
    }
    const cl = st.clients.map(
      (c) =>
        `${setKey(c.has)}|${c.frozen === null ? '' : `${c.frozen.reason}${c.frozen.path.at(-1) ?? ROOT}`}|${c.expired ?? ''}:${c.expiredCount}|${c.sawStop ? 's' : ''}${c.absent ? 'a' : ''}`,
    );
    const full = `${evs}#${cl.join('#')}#${st.expiries}`;
    return this.s.exactKeys === true ? full : compact(full);
  }

  private who(c: Client): string {
    return (this.s.devices ?? 1) > 1 ? `seat ${c.seat}${'ab'[c.device] ?? c.device}` : `seat ${c.seat}`;
  }

  /**
   * Deadlines a client must see pass at its head before a claim there counts. Round 2 (rule 10b): two, once the
   * client holds a fork on its chain, since any seat may have seen a stop there and left (a function of the held
   * events, unlike "this client resumed").
   */
  private claimNeed(c: Client, st: State): number {
    return this.s.design === 'fgr2' && this.view(st, c).forked ? 2 : 1;
  }

  /** Whether a published move or Ack by \`seat\` conflicts with \`head\` (the \`checked\` device policy). */
  private conflictsWithOwn(st: State, seat: Seat, head: string): boolean {
    const get = (id: string) => st.events.get(id) as MoveEv;
    const above = new Set([ROOT, ...pathTo(head, get)]);
    for (const e of st.events.values()) {
      if (e.seat !== seat || (e.t !== 'move' && e.t !== 'ack')) continue;
      const target = e.t === 'move' ? e.prev : e.move;
      if (!above.has(target) && !pathTo(target, get).includes(head)) return true;
    }
    return false;
  }

  /* ----------------------------------------------------------------------------------------- views */

  private view(st: State, c: Client): View {
    const memoKey = `${c.seat}|${setKey(c.has)}`;
    const known = this.viewMemo.get(memoKey);
    if (known !== undefined) return known;
    const v = computeView(
      this.s,
      [...c.has].sort().map((id) => st.events.get(id) as Ev),
      c.seat,
    );
    this.viewMemo.set(memoKey, v);
    return v;
  }

  /* ---------------------------------------------------------------------------------- transitions */

  private successors(st: State): [string, State][] {
    const out: [string, State][] = [];
    const evs = [...st.events.values()];
    // Deliveries of created events to honest clients that lack them.
    for (const e of evs) {
      for (let i = 0; i < st.clients.length; i++) {
        const c = st.clients[i] as Client;
        if (c.has.has(e.id)) continue;
        // A move whose prev the client lacks would only be pooled; deliver prevs first (no loss of generality:
        // a pooled move changes nothing until its prev arrives).
        if (e.t === 'move' && e.prev !== ROOT && !c.has.has(e.prev)) continue;
        out.push([`deliver ${e.id} to ${this.who(c)}`, this.settle(deliver(st, i, [e.id]))]);
      }
    }
    // Honest moves, whenever the seat's human gets to it.
    const moved: State[] = [];
    for (let i = 0; i < st.clients.length; i++) {
      const next = this.honestMove(st, i);
      if (next === null) continue;
      moved.push(next);
      out.push([`${this.who(st.clients[i] as Client)} moves`, next]);
    }
    if (this.coalition.size > 0) this.adversary(st, evs, out);
    // A deadline passes on one honest client: only while honest gossip is complete and no honest seat still has a
    // move to make (honest humans act within the deadline).
    if (st.expiries < this.s.expiries && moved.length === 0 && this.honestQuiet(st)) {
      for (let i = 0; i < st.clients.length; i++) {
        const c = st.clients[i] as Client;
        if (c.frozen !== null) continue;
        const v = this.view(st, c);
        if (v.status !== 'live') continue;
        // Another deadline at the same head only matters where a claim needs two (rule 10b).
        if (c.expired === v.head && c.expiredCount >= this.claimNeed(c, st)) continue;
        // A passing deadline also brings back every absent human: it was notified of the resume (A5, `absence`).
        const next: State = {
          ...st,
          expiries: st.expiries + 1,
          clients: st.clients.map((x, j) =>
            j === i
              ? {
                  ...x,
                  expired: v.head,
                  expiredCount: x.expired === v.head ? x.expiredCount + 1 : 1,
                  absent: false,
                }
              : x.absent
                ? { ...x, absent: false }
                : x,
          ),
        };
        out.push([`deadline passes for ${this.who(c)} at ${v.head}`, this.settle(next)]);
      }
    }
    return out;
  }

  private adversary(st: State, evs: Ev[], out: [string, State][]): void {
    const s = this.s;
    const counts = { move: 0, ack: 0, claim: 0, resign: 0 };
    for (const e of evs) if (e.t !== 'share' && this.coalition.has(e.seat)) counts[e.t]++;
    const moves = evs.filter((e): e is MoveEv => e.t === 'move');
    const kc = this.coalitionKnows(st);
    const targets = (label: string, ev: Ev): void => {
      for (let i = 0; i < st.clients.length; i++) {
        const c = st.clients[i] as Client;
        if (ev.t === 'move' && ev.prev !== ROOT && !c.has.has(ev.prev)) continue;
        const next: State = { ...st, events: new Map(st.events).set(ev.id, ev) };
        out.push([`${label} → ${this.who(c)}`, this.settle(deliver(next, i, [ev.id]))]);
      }
    };
    // Moves: on any prev where an adversary seat is pending, within the rivals cap.
    if (counts.move < s.advMoves) {
      const prevs: { id: string; depth: number }[] = [{ id: ROOT, depth: 0 }];
      for (const m of moves) prevs.push({ id: m.id, depth: m.depth });
      for (const p of prevs) {
        if (p.depth >= s.length) continue;
        const seat = p.depth % s.seats;
        if (!this.coalition.has(seat)) continue;
        const rivals = moves.filter((m) => m.prev === p.id);
        if (rivals.length >= s.rivalsPerPrev) continue;
        for (const kind of (s.multiDraw === true ? ['draw', 'draw2', 'pass'] : ['draw', 'pass']) as Kind[]) {
          for (let v = 0; v < s.rivalsPerPrev; v++) {
            const id = moveId(p.id, seat, kind, v);
            if (st.events.has(id) || rivals.some((r) => r.v === v)) continue;
            const ev: MoveEv = {
              t: 'move',
              id,
              seat,
              prev: p.id,
              depth: p.depth + 1,
              kind,
              v,
              rel: [],
              kc,
              honest: false,
            };
            targets(`seat ${seat} signs ${id}`, ev);
          }
        }
      }
    }
    // Acks (designs with acks): of any drawing move (any move for fgr and fgr2), by a coalition seat other than
    // its signer.
    if (counts.ack < s.advAcks && hasAcks(s.design)) {
      for (const m of moves) {
        if (!isFgr(s.design) && DRAWS[m.kind] === 0) continue;
        for (const a of this.coalition) {
          if (a === m.seat) continue;
          const id = `A${a}:${m.id}`;
          if (st.events.has(id)) continue;
          targets(`seat ${a} acks ${m.id}`, { t: 'ack', id, seat: a, move: m.id });
        }
      }
    }
    // Claims and resigns, naming any head.
    const heads = [ROOT, ...moves.map((m) => m.id)];
    if (counts.claim < s.advClaims) {
      for (const h of heads) {
        const depth = h === ROOT ? 0 : (st.events.get(h) as MoveEv).depth;
        for (const a of this.coalition) {
          if (depth % s.seats === a || depth >= s.length) continue;
          const id = `C${a}@${h}`;
          if (st.events.has(id)) continue;
          targets(`seat ${a} claims a timeout at ${h}`, { t: 'claim', id, seat: a, head: h });
        }
      }
    }
    if (counts.resign < s.advResigns) {
      for (const h of heads) {
        for (const a of this.coalition) {
          const id = `X${a}@${h}`;
          if (st.events.has(id)) continue;
          targets(`seat ${a} resigns naming ${h}`, { t: 'resign', id, seat: a, head: h });
        }
      }
    }
  }

  /** Every event any honest client holds is held by every honest client. */
  private honestQuiet(st: State): boolean {
    const all = new Set<string>();
    for (const c of st.clients) for (const id of c.has) all.add(id);
    return st.clients.every((c) => c.has.size === all.size);
  }

  private fullyDelivered(st: State): boolean {
    return st.clients.every((c) => c.has.size === st.events.size);
  }

  /** Honest reactions until nothing changes. */
  private settle(st0: State): State {
    let st = st0;
    for (let guard = 0; guard < 1000; guard++) {
      let changed = false;
      for (let i = 0; i < st.clients.length; i++) {
        const next = this.react(st, i);
        if (next !== st) {
          st = next;
          changed = true;
        }
      }
      if (!changed) return st;
    }
    throw new Error('protocol-model: honest reactions did not settle');
  }

  /** One honest client's reactions to what it holds: at most one batch of new events. */
  private react(st: State, i: number): State {
    const s = this.s;
    let c = st.clients[i] as Client;
    // Counted resigns and accepted claims freeze the client's result (PROTOCOL §8.2 "Finality", §8.3).
    if (c.frozen !== null) return st;
    const v = this.view(st, c);
    const freeze = this.freezeFor(st, c, v);
    if (freeze !== null)
      return { ...st, clients: st.clients.map((x, j) => (j === i ? { ...x, frozen: freeze } : x)) };
    if (c.expired !== null && c.expired !== v.head) {
      c = { ...c, expired: null, expiredCount: 0 };
      st = { ...st, clients: st.clients.map((x, j) => (j === i ? c : x)) };
    }
    // Stops and resumes (R12): a human who sees a stop may leave (`absence`).
    if (v.status === 'stop' && !c.sawStop) {
      c = { ...c, sawStop: true, absent: s.absence === true };
      st = { ...st, clients: st.clients.map((x, j) => (j === i ? c : x)) };
    } else if (v.status === 'live' && c.sawStop) {
      c = { ...c, sawStop: false };
      st = { ...st, clients: st.clients.map((x, j) => (j === i ? c : x)) };
    }
    if (v.status !== 'live') return st;
    const me = c.seat;
    const lazy = s.lazy === me;
    const made: Ev[] = [];
    const released = this.releasedBy(c, st);
    // Acks: of every move on the chain (fgr2), or of granting moves; with `ackDevice: first`, only device 0 acks.
    const acking = !lazy && ((s.ackDevice ?? 'all') === 'all' || c.device === 0);
    if (hasAcks(s.design) && acking) {
      for (const m of v.pathMoves) {
        if (m.seat === me || v.ackedByMe.has(m.id)) continue;
        if (s.design !== 'fgr2' && DRAWS[m.kind] === 0) continue;
        if (s.ackDevice === 'checked' && this.conflictsWithOwn(st, me, m.id)) continue;
        if (v.myAcks.some((a) => conflicts(v, a, m.id))) continue;
        made.push({ t: 'ack', id: `A${me}:${m.id}`, seat: me, move: m.id });
      }
    }
    // Prompt releases.
    if (!lazy && s.design !== 'v1') {
      for (const g of v.grants) {
        if (!this.mayRelease(v, g, me)) continue;
        for (const o of owed(g, me)) {
          if (released.has(o)) continue;
          const [pos, to] = o.split(':') as [string, string];
          made.push({
            t: 'share',
            id: `S${me}:${o}@${v.head}`,
            seat: me,
            pos: Number(pos),
            to: to === '*' ? null : Number(to),
            head: v.head,
          });
          released.add(o);
        }
      }
    }
    // Honest claims, when this client's deadline passed at the head (twice after a resume, in round 2).
    if (
      c.expired === v.head &&
      c.expiredCount >= this.claimNeed(c, st) &&
      v.pending !== me &&
      !c.has.has(`C${me}@${v.head}`)
    ) {
      made.push({ t: 'claim', id: `C${me}@${v.head}`, seat: me, head: v.head });
    }
    if (made.length === 0) return st;
    const events = new Map(st.events);
    // Another device of the same seat may already have published the same Ack or share: the same event here.
    for (const e of made) events.set(e.id, e);
    // Standalone shares reach every honest client at once: they change no honest decision (only what a client
    // can read), and the adversary sees them at once anyway, so their delivery order is not explored.
    // In honest-only runs (liveness) the network is synchronous: everything reaches everyone at once, and only the
    // humans' move order is explored.
    const sync = this.coalition.size === 0;
    const shares = made.filter((e) => sync || e.t === 'share').map((e) => e.id);
    return {
      ...st,
      events,
      clients: st.clients.map((x, j) => {
        if (j !== i && shares.length === 0) return x;
        const has = new Set(j === i ? c.has : x.has);
        for (const id of j === i ? made.map((e) => e.id) : shares) has.add(id);
        return j === i ? { ...c, has } : { ...x, has };
      }),
    };
  }

  /**
   * Honest seat `i` makes its move, if it is pending and has not built on the head: a human decision, so the
   * scheduler picks when. It draws and carries every share it owes as of the head (the slow path, PROTOCOL §6.2).
   */
  private honestMove(st: State, i: number): State | null {
    const c = st.clients[i] as Client;
    if (c.frozen !== null || c.absent) return null;
    const v = this.view(st, c);
    const me = c.seat;
    if (v.status !== 'live' || v.pending !== me) return null;
    // The human plays each of its turns once, on whichever device: it remembers it took turn number d.
    const depth = v.path.length + 1;
    for (const e of st.events.values()) if (e.t === 'move' && e.seat === me && e.depth === depth) return null;
    // `checked`: no published move or Ack by this seat may conflict with the head it would build on.
    if (this.s.ackDevice === 'checked' && this.conflictsWithOwn(st, me, v.head)) return null;
    const released = this.releasedBy(c, st);
    const rel: string[] = [];
    for (const g of v.grants)
      for (const o of owed(g, me)) if (!released.has(o) && !rel.includes(o)) rel.push(o);
    const ev: MoveEv = {
      t: 'move',
      id: moveId(v.head, me, 'draw', 0),
      seat: me,
      prev: v.head,
      depth: v.path.length + 1,
      kind: 'draw',
      v: 0,
      rel,
      kc: this.coalitionKnows(st),
      honest: true,
    };
    if (st.events.has(ev.id)) return null;
    let next: State = { ...st, events: new Map(st.events).set(ev.id, ev) };
    if (this.coalition.size === 0)
      for (let j = 0; j < st.clients.length; j++) next = deliver(next, j, [ev.id]);
    else next = deliver(next, i, [ev.id]);
    return this.settle(next);
  }

  private mayRelease(v: View, g: Grant, me: Seat): boolean {
    const d = this.s.design;
    if (d === 'd039' || d === 'fs') return true;
    // Candidate (d): a position with a fixed owner is released at once; the reserve waits for the slow path.
    if (d === 'pile') return !g.reserve;
    const m = v.byId.get(g.move) as MoveEv;
    if (isFgr(d)) return v.final.has(g.move);
    if (d === 'ack' || d === 'ack-lock') {
      // Acks of the move from every seat but its signer, own included.
      for (let k = 0; k < this.s.seats; k++) if (k !== m.seat && !v.acks.get(g.move)?.has(k)) return false;
      // Self-guard (fast-reveal §2.3, 3): never on a branch I vouched where the position was mine alone.
      for (const x of v.myVouches) {
        const gs = v.grantsTo(x);
        if (gs.some((h) => h.pos === g.pos && !h.v.public && h.v.seats.length === 1 && h.v.seats[0] === me))
          return false;
      }
      // Amendment A: no early share while a rival of the move is held.
      if (d === 'ack-lock' && v.linkedMoves.some((x) => conflicts(v, x.id, g.move))) return false;
      return true;
    }
    return false;
  }

  private freezeFor(st: State, c: Client, v: View): Frozen | null {
    if (v.status !== 'live') return null;
    // A resign counts once its head is on the chain (PROTOCOL §8.3); it ends the game at this client's head.
    const onChain = new Set([ROOT, ...v.path]);
    let best: ResignEv | null = null;
    for (const id of c.has) {
      const e = st.events.get(id) as Ev;
      if (e.t === 'resign' && onChain.has(e.head) && (best === null || e.id < best.id)) best = e;
    }
    if (best !== null) return { path: v.path, reason: 'resign', seat: best.seat };
    // A claim counts when its head is the head, this client's deadline passed there, and its claimant is not
    // the stalled (pending) seat.
    if (c.expired === v.head && c.expiredCount >= this.claimNeed(c, st)) {
      for (const id of c.has) {
        const e = st.events.get(id) as Ev;
        if (e.t === 'claim' && e.head === v.head && e.seat !== v.pending)
          return { path: v.path, reason: 'claim', seat: v.pending };
      }
    }
    return null;
  }

  /** What this client knows its seat released: from the events it holds (another device's may not have arrived). */
  private releasedBy(c: Client, st: State): Set<string> {
    const out = new Set<string>();
    for (const id of c.has) {
      const e = st.events.get(id) as Ev;
      if (e.seat !== c.seat) continue;
      if (e.t === 'share') out.add(`${e.pos}:${e.to === null ? '*' : e.to}`);
      else if (e.t === 'move') for (const r of e.rel) out.add(r);
    }
    return out;
  }

  /** The positions the coalition can read now, from every released share (the adversary sees every event). */
  private coalitionKnows(st: State): number[] {
    if (this.coalition.size === 0) return [];
    const bySeatPos = new Map<number, Set<Seat>>();
    for (const r of this.releases(st)) {
      if (this.coalition.has(r.seat)) continue;
      if (r.to !== null && !this.coalition.has(r.to)) continue;
      let at = bySeatPos.get(r.pos);
      if (at === undefined) {
        at = new Set();
        bySeatPos.set(r.pos, at);
      }
      at.add(r.seat);
    }
    const out: number[] = [];
    for (const [pos, seats] of bySeatPos) if (this.honest.every((h) => seats.has(h))) out.push(pos);
    return out.sort((a, b) => a - b);
  }

  private releases(st: State): { seat: Seat; pos: number; to: Seat | null; head: string }[] {
    const out: { seat: Seat; pos: number; to: Seat | null; head: string }[] = [];
    for (const e of st.events.values()) {
      if (e.t === 'share') out.push({ seat: e.seat, pos: e.pos, to: e.to, head: e.head });
      else if (e.t === 'move')
        for (const r of e.rel) {
          const [pos, to] = r.split(':') as [string, string];
          out.push({ seat: e.seat, pos: Number(pos), to: to === '*' ? null : Number(to), head: e.prev });
        }
    }
    return out;
  }

  /* ---------------------------------------------------------------------------------------- checks */

  private check(st: State, trace: () => string[]): void {
    this.checked++;
    const s = this.s;
    const views = st.clients.map((c) => this.view(st, c));
    const finals = st.clients.map((c, i) => {
      const v = views[i] as View;
      // Fork stop takes precedence (prompt-reveal.md §5, rule 4): a stop at a prev on the path of a counted claim
      // or resign voids it, so the result is a function of the held events.
      if (c.frozen !== null && v.status === 'stop' && this.stopVoids(v.path, c.frozen.path))
        return { path: v.path, end: v.status, frozen: null, view: v, voided: c.frozen };
      const path = c.frozen?.path ?? v.path;
      const end = c.frozen !== null ? c.frozen.reason : v.status;
      return { path, end, frozen: c.frozen, view: v, voided: null as Frozen | null };
    });
    // S3.
    const sig = finals.map((f) => `${f.end}:${f.path.at(-1) ?? ROOT}`);
    if (new Set(sig).size > 1) {
      const raced = finals.some((f) => f.frozen !== null);
      this.report(
        raced ? 'claim-race' : 'divergence',
        `honest results differ: ${st.clients.map((c, i) => `${this.who(c)} ${sig[i]}`).join(', ')}`,
        trace,
      );
    }
    // S2.
    for (const f of finals) {
      if (f.frozen?.reason === 'claim' && !this.coalition.has(f.frozen.seat)) {
        // The claim race (PROTOCOL §11): an honest seat whose own clients already ended the game on an accepted
        // claim stops moving, and is timed out on a client that never accepted it. Known v1 residual. (Ended on a
        // counted resign instead, it needs a fork: F8, reported as an honest forfeit.)
        const seat = f.frozen.seat;
        const ended = st.clients
          .filter((c) => c.seat === seat)
          .every((c) => c.frozen !== null && c.frozen.reason === 'claim');
        this.report(
          ended ? 'claim-race' : 'honest-forfeit',
          `honest seat ${seat} timed out at ${f.path.at(-1) ?? ROOT}${ended ? ' after its own client ended the game' : ''}`,
          trace,
        );
      }
      if (f.end === 'stop' && !this.coalition.has(f.view.stopSeat as Seat))
        this.report(
          'honest-forfeit',
          `the game stopped on an honest seat's fork (${f.view.stopSeat})`,
          trace,
        );
    }
    // Flags: a seat that vouched for two sides of a fork is flagged (round 2); never an honest one.
    for (const f of finals)
      for (const x of f.view.flagged)
        if (!this.coalition.has(x))
          this.report('honest-flagged', `honest seat ${x} vouched for two sides of a fork`, trace);
    // Ratings (round 2): a stop must never leave the equivocator, or its coalition, better off than a forfeit.
    // Two seats: every result is rated, and a forfeit is a rated loss. Three or more: a timeout is a rated last
    // place, while a resign and (round 2) a stop follow the owner's abort policy (unrated, the aborter recorded).
    for (const f of finals) {
      if (f.end === 'stop' && s.seats === 2 && !forfeitStop(s.design))
        this.report('rating', `the stop by seat ${f.view.stopSeat} leaves a 2-seat game unrated`, trace);
      const lost = f.voided;
      if (lost !== null && this.coalition.has(lost.seat)) {
        const same = f.view.stopSeat === lost.seat;
        const sameEffect = same && (lost.reason === 'resign' || s.seats === 2) && forfeitStop(s.design);
        if (!sameEffect)
          this.report(
            'rating',
            `a stop at ${f.path.at(-1) ?? ROOT} voids seat ${lost.seat}'s counted ${lost.reason}` +
              ` (now the stop of seat ${f.view.stopSeat})`,
            trace,
          );
      }
    }
    // S1.
    if (this.coalition.size > 0) {
      const known = this.coalitionKnows(st);
      const rel = this.releases(st);
      for (const pos of known) {
        for (const [i, f] of finals.entries()) {
          const grants = grantsOn(s, f.path, (id) => st.events.get(id) as MoveEv);
          const ok = grants.some((g) => {
            if (g.pos !== pos) return false;
            if (!(g.v.public || g.v.seats.some((x) => this.coalition.has(x)))) return false;
            return !(st.events.get(g.move) as MoveEv).kc.includes(pos);
          });
          if (ok) continue;
          // Post-end: every honest release of the position that the coalition can read came from a chain that
          // strictly extends this client's final chain.
          const used = rel.filter(
            (r) =>
              r.pos === pos && !this.coalition.has(r.seat) && (r.to === null || this.coalition.has(r.to)),
          );
          const fset = f.path;
          const postEnd = used.every((r) => {
            const hp = pathTo(r.head, (id) => st.events.get(id) as MoveEv);
            return hp.length > fset.length && fset.every((id, k) => hp[k] === id);
          });
          const who = this.who(st.clients[i] as Client);
          // Candidate (d): a pile position belongs to one seat on every branch. If that seat is in the coalition,
          // the coalition only learned a card of its own early (an equivocating seat's own next draw).
          if (s.design === 'pile' && pos < RESERVE && this.coalition.has(Math.floor(pos / PILE))) {
            this.report(
              'self-leak',
              `coalition {${[...this.coalition].join(',')}} reads its own seat ${Math.floor(pos / PILE)}'s ` +
                `pile position ${pos} early (on ${who}'s final chain [${f.path.join(' ')}], ${f.end})`,
              trace,
            );
            continue;
          }
          const held = grants.filter((g) => g.pos === pos).map((g) => viewersText(g.v));
          this.report(
            postEnd ? 'post-end' : 'exposure',
            `coalition {${[...this.coalition].join(',')}} reads position ${pos}; on ${who}'s final chain ` +
              `[${f.path.join(' ')}] (${f.end}) it is ${held.length > 0 ? `granted to ${held.join(', ')} too late or to others` : 'never dealt'}`,
            trace,
          );
        }
      }
    }
    // Liveness, honest-only runs: while the game is live (once it is over, the end reveal takes over).
    if (this.coalition.size === 0) {
      for (const [i, c] of st.clients.entries()) {
        const f = finals[i] as (typeof finals)[number];
        if (f.end !== 'live') continue;
        const grants = grantsOn(s, f.path, (id) => st.events.get(id) as MoveEv);
        for (const g of grants) {
          if (!sees(g.v, c.seat)) continue;
          const learned = this.learns(st, c, g.pos);
          if (learned) continue;
          const idx = f.path.indexOf(g.move);
          const after = new Set(f.path.slice(idx + 1).map((id) => (st.events.get(id) as MoveEv).seat));
          const everyoneMoved = Array.from({ length: s.seats }, (_, k) => k).every(
            (k) => k === c.seat || after.has(k),
          );
          if (everyoneMoved)
            this.report(
              'no-fallback',
              `seat ${c.seat} cannot read position ${g.pos} although every seat moved after it`,
              trace,
            );
          else if (s.lazy === undefined || s.lazy === null)
            this.report(
              'not-prompt',
              `seat ${c.seat} cannot read position ${g.pos} once the network is quiet`,
              trace,
            );
        }
      }
    }
  }

  /** Whether honest client `c` can read `pos` from what it holds. */
  private learns(st: State, c: Client, pos: number): boolean {
    const from = new Set<Seat>([c.seat]);
    for (const id of c.has) {
      const e = st.events.get(id) as Ev;
      if (e.t === 'share' && e.pos === pos && (e.to === null || e.to === c.seat)) from.add(e.seat);
      if (e.t === 'move')
        for (const r of e.rel) if (r === `${pos}:*` || r === `${pos}:${c.seat}`) from.add(e.seat);
    }
    return from.size === this.s.seats;
  }

  /** Rule 9: whether a stop at the end of \`stop\` overrides a counted result on \`frozen\` (fork-stop designs). */
  private stopVoids(stop: readonly string[], frozen: readonly string[]): boolean {
    const d = this.s.design;
    if (d !== 'fs' && d !== 'pile' && !isFgr(d)) return false;
    const rule = this.s.rule9 ?? (d === 'fgr2' || d === 'pile' ? 'none' : 'at-or-past');
    if (rule === 'none') return false;
    const below = stop.length <= frozen.length && stop.every((id, k) => frozen[k] === id);
    return below && (rule === 'at-or-past' || stop.length < frozen.length);
  }

  private report(kind: ViolationKind, detail: string, trace: () => string[]): void {
    const known = this.found[kind];
    if (known === undefined) this.found[kind] = { count: 1, first: { kind, detail, trace: trace() } };
    else known.count++;
    if (this.s.stopAt?.includes(kind)) this.halt = true;
  }
}

/* ------------------------------------------------------------------------------------------ helpers */

/** Two independent 32-bit FNV-1a hashes of `text`, as one 64-bit key. */
function compact(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    a = Math.imul(a ^ ch, 0x01000193);
    b = Math.imul(b ^ ch, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}

interface Frame {
  readonly st: State;
  readonly parent: Frame | null;
  readonly label: string;
}

function traceOf(frame: Frame): string[] {
  const out: string[] = [];
  for (let f: Frame | null = frame; f !== null && f.parent !== null; f = f.parent) out.push(f.label);
  return out.reverse();
}

const eventsKeys = new WeakMap<ReadonlyMap<string, Ev>, string>();
const setKeys = new WeakMap<ReadonlySet<string>, string>();

/** A set's canonical text, cached: states share their sets until a delivery changes one. */
function setKey(set: ReadonlySet<string>): string {
  let k = setKeys.get(set);
  if (k === undefined) {
    k = [...set].sort().join(',');
    setKeys.set(set, k);
  }
  return k;
}

function evKey(e: Ev): string {
  if (e.t === 'move') return `${e.id}[${e.rel.join('.')}|${e.kc.join('.')}]`;
  return e.id;
}

function moveId(prev: string, seat: Seat, kind: Kind, v: number): string {
  const k = kind === 'draw' ? 'd' : kind === 'draw2' ? 'D' : 'p';
  return `${prev === ROOT ? '' : `${prev}/`}${seat}${k}${v}`;
}

function hasAcks(d: Design): boolean {
  return d === 'ack' || d === 'ack-lock' || isFgr(d);
}

/** Designs in which a stop is scored as the equivocator's forfeit (round 2 and candidate (d)). */
function forfeitStop(d: Design): boolean {
  return d === 'fgr2' || d === 'pile';
}

function isFgr(d: Design): boolean {
  return d === 'fgr' || d === 'fgr2';
}

function deliver(st: State, i: number, ids: string[]): State {
  return {
    ...st,
    clients: st.clients.map((c, j) => {
      if (j !== i) return c;
      const has = new Set(c.has);
      for (const id of ids) has.add(id);
      return { ...c, has };
    }),
  };
}

function pathTo(head: string, get: (id: string) => MoveEv): string[] {
  const out: string[] = [];
  let at = head;
  while (at !== ROOT) {
    out.push(at);
    at = get(at).prev;
  }
  return out.reverse();
}

function grantsOn(s: Scope, path: readonly string[], get: (id: string) => MoveEv): Grant[] {
  const out: Grant[] = [];
  let pos = 0;
  let reserve = 0;
  const drawn = new Map<Seat, number>();
  for (const id of path) {
    const m = get(id);
    for (let n = 0; n < DRAWS[m.kind]; n++) {
      const v = viewersOf(s.mode, m.seat, s.seats);
      if (s.mode === 'roll') {
        // A roll's point is bound to the move that requests it: a rival move rolls a different value.
        out.push({ pos: rollPos(`${id}#${n}`), v, move: id, reserve: false });
      } else if (s.design === 'pile') {
        const i = drawn.get(m.seat) ?? 0;
        drawn.set(m.seat, i + 1);
        if (i < (s.pile ?? PILE)) out.push({ pos: m.seat * PILE + i, v, move: id, reserve: false });
        else out.push({ pos: RESERVE + reserve++, v, move: id, reserve: true });
      } else out.push({ pos: pos++, v, move: id, reserve: false });
    }
  }
  return out;
}

function viewersText(v: Viewers): string {
  return v.public ? 'everyone' : `{${v.seats.join(',')}}`;
}

/* -------------------------------------------------------------------------------------- the client view */

interface View {
  readonly path: readonly string[];
  readonly head: string;
  readonly status: 'live' | 'over' | 'stop';
  readonly stopSeat: Seat | null;
  /** Seats that vouched for two sides of a fork on the walk (fork-stop designs). */
  readonly flagged: ReadonlySet<Seat>;
  /** A fork (a held rival) exists at some prev on the walk. */
  readonly forked: boolean;
  readonly pending: Seat;
  readonly grants: readonly Grant[];
  readonly pathMoves: readonly MoveEv[];
  readonly linkedMoves: readonly MoveEv[];
  readonly byId: ReadonlyMap<string, MoveEv>;
  readonly acks: ReadonlyMap<string, ReadonlySet<Seat>>;
  readonly final: ReadonlySet<string>;
  readonly builtAt: ReadonlySet<string>;
  readonly ackedByMe: ReadonlySet<string>;
  readonly myAcks: readonly string[];
  /** Moves this seat signed or acked. */
  readonly myVouches: readonly string[];
  readonly ancestor: (a: string, b: string) => boolean;
  readonly grantsTo: (head: string) => Grant[];
}

/** Whether moves `a` and `b` conflict: neither is an ancestor of the other. */
function conflicts(v: View, a: string, b: string): boolean {
  return !(v.ancestor(a, b) || v.ancestor(b, a));
}

function computeView(s: Scope, evs: readonly Ev[], me: Seat): View {
  const byId = new Map<string, MoveEv>();
  for (const e of evs) if (e.t === 'move') byId.set(e.id, e);
  // Linked moves: the prev chain reaches the root through held moves (every move here is valid by construction).
  const linked = new Map<string, MoveEv>();
  const kids = new Map<string, MoveEv[]>();
  const sorted = [...byId.values()].sort((a, b) => a.depth - b.depth);
  for (const m of sorted) {
    if (m.prev !== ROOT && !linked.has(m.prev)) continue;
    linked.set(m.id, m);
    const list = kids.get(m.prev) ?? [];
    list.push(m);
    kids.set(m.prev, list);
  }
  for (const list of kids.values()) list.sort((a, b) => a.v - b.v || a.kind.localeCompare(b.kind));
  const ancestor = (a: string, b: string): boolean => {
    // a is an ancestor of (or equal to) b
    let at = b;
    for (;;) {
      if (at === a) return true;
      if (at === ROOT) return false;
      const m = byId.get(at);
      if (m === undefined) return false;
      at = m.prev;
    }
  };
  const acks = new Map<string, Set<Seat>>();
  const ackedByMe = new Set<string>();
  const myAcks: string[] = [];
  for (const e of evs) {
    if (e.t === 'ack') {
      const set = acks.get(e.move) ?? new Set<Seat>();
      set.add(e.seat);
      acks.set(e.move, set);
      if (e.seat === me) {
        ackedByMe.add(e.move);
        myAcks.push(e.move);
      }
    }
  }
  const myVouches = [...myAcks, ...[...byId.values()].filter((m) => m.seat === me).map((m) => m.id)];
  const builtAt = new Set([...byId.values()].filter((m) => m.seat === me).map((m) => m.prev));

  // Subtree facts.
  const lenMemo = new Map<string, number>();
  const longest = (id: string): number => {
    const k = lenMemo.get(id);
    if (k !== undefined) return k;
    let best = 0;
    for (const c of kids.get(id) ?? []) best = Math.max(best, 1 + longest(c.id));
    lenMemo.set(id, best);
    return best;
  };
  const subtree = (id: string): MoveEv[] => {
    const out: MoveEv[] = [];
    const walk = (x: string): void => {
      for (const c of kids.get(x) ?? []) {
        out.push(c);
        walk(c.id);
      }
    };
    const self = linked.get(id);
    if (self !== undefined) out.push(self);
    walk(id);
    return out;
  };
  /** Seat k vouches for the subtree at `id`: it signed a move there, or (with acks) acked one. */
  const vouches = (id: string, k: Seat): boolean => {
    const sub = subtree(id);
    if (sub.some((m) => m.seat === k)) return true;
    if (isFgr(s.design)) return sub.some((m) => acks.get(m.id)?.has(k) === true);
    return false;
  };
  // Finality.
  const final = new Set<string>();
  for (const m of linked.values()) {
    if (s.design === 'ack' || s.design === 'ack-lock') {
      if (DRAWS[m.kind] === 0) continue;
      let all = true;
      for (let k = 0; k < s.seats; k++) if (k !== m.seat && acks.get(m.id)?.has(k) !== true) all = false;
      if (all) final.add(m.id);
    } else if (isFgr(s.design) || s.design === 'fs') {
      let all = true;
      for (let k = 0; k < s.seats; k++) if (k !== m.seat && !vouches(m.id, k)) all = false;
      if (all) final.add(m.id);
    }
  }
  const containsAll = (kid: string, required: readonly string[], at: string): boolean =>
    required.filter((r) => r !== at && ancestor(at, r)).every((r) => ancestor(kid, r));
  const better = (a: MoveEv, b: MoveEv): boolean => {
    const la = longest(a.id);
    const lb = longest(b.id);
    if (la !== lb) return la > lb;
    return a.v - b.v < 0 || (a.v === b.v && a.kind < b.kind);
  };
  const bestOf = (list: readonly MoveEv[]): MoveEv => {
    let best = list[0] as MoveEv;
    for (const m of list.slice(1)) if (better(m, best)) best = m;
    return best;
  };

  const path: string[] = [];
  let at = ROOT;
  let status: View['status'] = 'live';
  let stopSeat: Seat | null = null;
  const flagged = new Set<Seat>();
  let forked = false;
  for (;;) {
    if (path.length >= s.length) {
      status = 'over';
      break;
    }
    const ks = kids.get(at) ?? [];
    if (ks.length === 0) break;
    let next: MoveEv;
    if (s.design === 'pile') {
      if (ks.length === 1) next = ks[0] as MoveEv;
      else {
        // A fork stops the game at the fork (the equivocator's forfeit), unless a side already reached the end:
        // a finished game is never reopened (over first, then length, then lowest id, as v1).
        const done = ks.filter((k) => path.length + 1 + longest(k.id) >= s.length);
        if (done.length === 0) {
          status = 'stop';
          stopSeat = path.length % s.seats;
          break;
        }
        next = bestOf(done);
      }
    } else if (s.design === 'fs' || isFgr(s.design)) {
      if (ks.length === 1) next = ks[0] as MoveEv;
      else {
        forked = true;
        const pend = path.length % s.seats;
        const sides = ks.filter((k) => {
          for (let x = 0; x < s.seats; x++) if (x !== pend && !vouches(k.id, x)) return false;
          return true;
        });
        const here = new Set<Seat>();
        for (let x = 0; x < s.seats; x++)
          if (x !== pend && ks.filter((k) => vouches(k.id, x)).length >= 2) here.add(x);
        for (const x of here) flagged.add(x);
        // Round 1 follows the lowest id among several vouched sides. Round 2 stops unless exactly one side is
        // vouched for and no seat vouched for two sides (a double vouch makes "every seat" meaningless).
        const doubled = here.size > 0;
        if (sides.length === 0 || (s.design === 'fgr2' && (sides.length > 1 || doubled))) {
          status = 'stop';
          stopSeat = pend;
          break;
        }
        next = bestOf(sides);
      }
    } else if (s.design === 'ack' || s.design === 'ack-lock') {
      const finals = [...final];
      let cands = ks.filter((k) => containsAll(k.id, finals, at));
      if (s.design === 'ack-lock') {
        // Lock: keep every move I acked, unless a move conflicting with it is final.
        const locks = myAcks.filter((a) => !finals.some((f) => !(ancestor(a, f) || ancestor(f, a))));
        const locked = cands.filter((k) => containsAll(k.id, locks, at));
        if (locked.length > 0) cands = locked;
      }
      next = bestOf(cands.length > 0 ? cands : ks);
    } else {
      next = bestOf(ks);
    }
    path.push(next.id);
    at = next.id;
  }
  const pathMoves = path.map((id) => byId.get(id) as MoveEv);
  const grantsTo = (head: string): Grant[] =>
    grantsOn(
      s,
      pathTo(head, (id) => byId.get(id) as MoveEv),
      (id) => byId.get(id) as MoveEv,
    );
  return {
    path,
    head: path.at(-1) ?? ROOT,
    status,
    stopSeat,
    flagged: s.design === 'fgr2' ? flagged : new Set<Seat>(),
    forked,
    pending: path.length % s.seats,
    grants: grantsOn(s, path, (id) => byId.get(id) as MoveEv),
    pathMoves,
    linkedMoves: [...linked.values()],
    byId,
    acks,
    final,
    builtAt,
    ackedByMe,
    myAcks,
    myVouches,
    ancestor,
    grantsTo,
  };
}
