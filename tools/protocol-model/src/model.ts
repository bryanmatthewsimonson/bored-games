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
 *   resign it counted first, while no honest client holds a fork, is the known claim race (PROTOCOL §11), reported
 *   as `claim-race`; any other difference, including a counted claim against a stop (round 3, A2), is a
 *   `divergence`.
 * - Liveness (honest-only runs): once the network is quiet, every honest seat knows every value granted to it on
 *   the chain (`prompt`), and with a lazy seat that never acks nor shares early, it knows it once every other seat
 *   has moved after the grant (`fallback`).
 * - Ratings (round 2): no stop, and no stop that overrides a counted claim or resign, leaves the equivocator or its
 *   coalition better off than a forfeit (`rating`). A stop below an end that a side had already reached, with 3
 *   or more seats, turns a finished game into an unrated abort (`ended-void`, reported apart: a residual of `stop`).
 * - Flags: an honest seat (one key, possibly on two devices) is never flagged for vouching for two sides, nor
 *   recorded as an equivocator (`honest-flagged`).
 * - Finality (round 3, `stop3`): a result that every honest seat attested, while no honest seat attested another,
 *   is the final result on every honest client; otherwise `attested-void` (reported apart: with a single adversary
 *   and one device per seat it must not happen; a 2-seat result that becomes the equivocator's loss is fine). A
 *   stop that voids a counted timeout or resign of a coalition seat and leaves a coalition seat with a score other
 *   than the same or a rated last place (3 or more seats: a timeout becoming an unrated abort, a standing moved to
 *   another head, the record moved to another seat) is `void-forfeit` (reported apart: needs a coalition once a
 *   stop scores as the equivocator's timeout, `stopScore`).
 * - Protocol v2 (`stop3`, PROTOCOL-v2 §5–§8; task T0 of the v2 build): a stop that cancels while a game action was
 *   played on a valid line (`cancel-escape`, review H1); every equivocator of the global scan placed last and rated
 *   in a stop (`rating`, review M1); a place after a stop that changes for anything but a proven audit failure
 *   (`stop-demotion`, review H2); and a cheat on the line of an `over` result that can neither be audited nor
 *   claimed (`cheat-escape`, review N1).
 *
 * Round-2 options: honest seats on two devices that share one key with independent delivery (`devices`), moves
 * that draw two positions (`multiDraw`), and honest humans who leave when their client shows a stop and come back
 * one deadline after being notified of a resume (`absence`).
 *
 * Round-3 options: result attestations (honest clients attest a result on a chain with no fork; the adversary
 * attests within `advAttests`), Shares events anchored on their releaser's head (the `head` field), and stale
 * outboxes (`stale`, `outboxRule`): an honest device signs its move offline, its human plays that turn again on
 * another device, and the saved move is published later, or dropped under the controller rule.
 *
 * Protocol v2 options (`stop3` only): setup steps before play (`setup`), the cancel rule (`cancelRule`), M1
 * equivocators (`topmostOnly` is the regression), a resign's identity at its named head with S cut at the first
 * fork past it (`resignAt`), adversary Shares events with free anchors, unresolved ones included (`advShares`,
 * `unresolved`), the Secret phase with audits and cheats (`secrets`, `advCheats`, and the regressions `stopClaims`
 * and `noStandingEnd`), public reveals and dice that block the next decision (modes `reveal-block` and `roll`),
 * and the own-forfeit question (`autoOwnForfeit` is the regression).
 */

export type Seat = number;
/**
 * Grant modes: `private` (U1, the drawer), `viewers` (U2, every seat but the drawer), `public` (U3, a card played
 * from the drawer's hand and shown to all), `roll` (U4, a public value whose point is bound to the move's id; under
 * `stop3` the roll blocks the next decision until every seat contributed, PROTOCOL-v2 §6.2), `reveal-block`
 * (`stop3` only: a public reveal that blocks the next decision until every seat's share is held, a Luster refill,
 * PROTOCOL-v2 §6.3; the stalled seats are every seat without a share, so a claim can forfeit several seats).
 */
export type Mode = 'private' | 'viewers' | 'public' | 'roll' | 'reveal-block';
/**
 * - `stop`: candidate (e), "plain stop" (prompt-reveal.md §5): one shared pile; shares released as soon as the
 *   drawing move is held (as `d039`); any held fork stops the game at the fork, never picking a branch and never
 *   resuming (with `overStands`, a side that already reached the end stands instead); the stop is the
 *   equivocator's forfeit; a stop never overrides a counted claim or resign (`rule9: none`; `strict`, the owner's
 *   first rule, still lets a colluder void a counted timeout).
 * - `stop3`: candidate (e), round 3, as specified in PROTOCOL-v2 §5: `stop`, plus the attestation-and-anchor
 *   cutoff. A result (a natural end, or a counted claim or resign) STANDS against a fork by E when every seat other
 *   than E attested it and no seat other than E signed a move, or a Shares event anchored on a head, off the
 *   result's path (root to its head); then the fork only records E. Otherwise the fork stops the game on every
 *   client, overriding any counted claim or resign (round 3, A2: the cutoff decides from the event set alone, so
 *   clients converge).
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
export type Design = 'v1' | 'd039' | 'ack' | 'ack-lock' | 'fs' | 'fgr' | 'fgr2' | 'stop' | 'stop3';

export const DESIGNS: readonly Design[] = [
  'v1',
  'd039',
  'ack',
  'ack-lock',
  'fs',
  'fgr',
  'fgr2',
  'stop',
  'stop3',
];
export const MODES: readonly Mode[] = ['private', 'viewers', 'public'];

export interface Scope {
  readonly design: Design;
  readonly mode: Mode;
  readonly seats: number;
  /** Game actions after which the game is over (after the `setup` steps). */
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
  /** `stop`: a fork below a side that already reached the end does not stop the game; that ending stands. */
  readonly overStands?: boolean;
  /** `stop3`: attestations the adversary may sign (of any valid end, claim or resign result). */
  readonly advAttests?: number;
  /**
   * Stale outboxes: how many honest moves a device may sign offline and publish later, possibly after its human
   * played that turn again on another device (round 3, A3). With `outboxRule` (the controller rule), a saved move
   * is published only once the device is synced (it holds every event some honest client holds, A3), its prev is
   * the device's head and the device holds no other move by its seat on that prev; otherwise it is dropped.
   */
  readonly stale?: number;
  readonly outboxRule?: boolean;
  /**
   * `stop3`, 3 or more seats: how a stop scores. `abort` (default, the owner's abort policy): unrated, the
   * equivocator recorded. `timeout`: as the equivocator's timeout at the fork (rated last, the others by standings
   * there), so a stalled seat that forks at its own head scores exactly as its timeout. `last`: the equivocator
   * rated last and recorded, the game unrated for every other seat (the approved rule, PROTOCOL-v2 §5.6).
   */
  readonly stopScore?: 'abort' | 'timeout' | 'last';
  /**
   * `stop3` variants, kept as regressions: `cutoff: 'attest'` drops the anchor clause (a result stands once every
   * seat but E attested it); `cutoff: 'path'` (round 3's first wording) also counts events past the result's head,
   * not only those on another side of a fork; `exemptLoser` does not ask the forfeiting seat of a claim or resign
   * to attest it.
   */
  readonly cutoff?: 'anchor' | 'attest' | 'path';
  readonly exemptLoser?: boolean;
  /**
   * Device policy (ii), round 3: before signing a move, a device fetches every event its seat published from any
   * device (as a query to the relays), and a device counts its own seat's claims.
   */
  readonly ownCheck?: boolean;
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
  /**
   * `stop3`: setup steps before play (shuffle-like: one per seat, seats 0 … k−1, granting nothing). The adversary
   * may sign well-formed rival steps, valid (`s`) or with a proof that fails (`j`, never linked, but a fork with any
   * other well-formed step, PROTOCOL-v2 §5.1). Timeouts during setup are v1 behaviour and are not modelled: no
   * deadline passes at a head before the first game action.
   */
  readonly setup?: number;
  /**
   * `stop3`: when a stop cancels the game (PROTOCOL-v2 §5.6). `played` (the approved rule, review H1): only when no
   * game action on a valid line is held at or past P. `position` (the regression): when the walk up to P holds no
   * game action, whatever was played past P since.
   */
  readonly cancelRule?: 'played' | 'position';
  /** `stop3` regression: only the topmost fork's E is an equivocator (before review M1). */
  readonly topmostOnly?: boolean;
  /**
   * `stop3`: a resign result's identity. `named` (the approved rule, review M3): (resign, the head it names, k),
   * scored along that head's line up to S, which stops at the first held fork past the head (PROTOCOL-v2 §8.3).
   * `counted` (the round-3 model, kept for comparison): attested at the head where the client counted it.
   */
  readonly resignAt?: 'named' | 'counted';
  /**
   * `stop3`: adversary Shares events with an anchor of its choice (any held move or the root, and with
   * `unresolved` an id no honest client ever holds). In the blocking modes the coalition also releases its share of
   * a pending reveal or roll at any time, anchored on the move that requested it, outside this budget.
   */
  readonly advShares?: number;
  /** `stop3`: the adversary may anchor Shares events and end attestations on an id it never delivers. */
  readonly unresolved?: boolean;
  /**
   * `stop3`: the Secret phase. Honest clients publish their Secret reveal once their game has ended (a result, a
   * cancel or a stop); the adversary publishes its own whenever it likes, or never. Once every secret is held the
   * audit runs on the scored line, and a cheat move fails its signer. At an `over` result (also a standing one,
   * review N1) a seat whose secret is missing is stalled and can be claimed (v1 End rules). After a stop no seat
   * is stalled (review H2). Secrets do not feed the S1 check: a client publishes one only once its own game has
   * ended, and no game goes on after a fork.
   */
  readonly secrets?: boolean;
  /** `stop3` with `secrets`: adversary game actions that pass every check in play but fail the audit. */
  readonly advCheats?: number;
  /** `stop3` regression (review H2): after a stop, seats with a missing secret are stalled and claims count. */
  readonly stopClaims?: boolean;
  /** `stop3` regression (review N1): a standing result plays out no End rules (no stall for a missing secret). */
  readonly noStandingEnd?: boolean;
  /**
   * `stop3` regression (review N2): a client accepts at once, without its deadline or its player's confirmation, a
   * claim at its head whose stalled seats are its own seat alone.
   */
  readonly autoOwnForfeit?: boolean;
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
  | 'ended-void'
  | 'honest-flagged'
  | 'attested-void'
  | 'void-forfeit'
  | 'cancel-escape'
  | 'stop-demotion'
  | 'cheat-escape';

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
  /** Signed offline by an honest device and published late (`stale`). */
  readonly stale?: boolean;
  /** A game action that passes every check in play and fails the audit (`secrets`). */
  readonly cheat?: boolean;
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
  /** The position, or -1 for a Shares event that matters only by its anchor (an adversary's, `advShares`). */
  readonly pos: number;
  readonly to: Seat | null;
  /** The releaser's head when it released (its anchor); `UNRESOLVED` for an id no honest client holds. */
  readonly head: string;
  /** An adversary Shares event within `advShares`. */
  readonly extra?: boolean;
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
/** A result attestation (round 3): `kind` at `head`, with the seats that forfeit (ascending; [] for a natural end). */
interface AttestEv {
  readonly t: 'attest';
  readonly id: string;
  readonly seat: Seat;
  readonly kind: 'over' | 'claim' | 'resign';
  readonly head: string;
  readonly forfeit: readonly Seat[];
}
/** A Secret reveal (`secrets`). */
interface SecretEv {
  readonly t: 'secret';
  readonly id: string;
  readonly seat: Seat;
}
type Ev = MoveEv | AckEv | ShareEv | ClaimEv | ResignEv | AttestEv | SecretEv;

const ROOT = 'R';
/** An anchor id that no honest client ever holds (`unresolved`). */
const UNRESOLVED = 'U';

/** `shuf`: a setup step; `junk`: a well-formed setup step whose proof fails (never valid). */
export type Kind = 'draw' | 'draw2' | 'pass' | 'shuf' | 'junk';
const DRAWS: Record<Kind, number> = { draw: 1, draw2: 2, pass: 0, shuf: 0, junk: 0 };

/* ------------------------------------------------------------------------------------------------ state */

interface Frozen {
  /** The path to `head`. */
  readonly path: readonly string[];
  readonly reason: 'claim' | 'resign';
  /** A claim's head; a resign's named head (`named`) or the client's head when it counted it. */
  readonly head: string;
  /** The forfeiting seats, ascending (stalled or resigning). */
  readonly forfeit: readonly Seat[];
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
  /** An accepted claim for missing secrets (`secrets`): the result it belongs to (`over:X`, `stop:P`) and the seats. */
  readonly endForfeit: { readonly at: string; readonly seats: readonly Seat[] } | null;
}

interface State {
  readonly events: ReadonlyMap<string, Ev>;
  /** Moves signed offline by an honest device and not published yet (`stale`), with the device's index. */
  readonly saved: ReadonlyMap<string, { readonly ev: MoveEv; readonly client: number }>;
  readonly clients: readonly Client[];
  readonly expiries: number;
}

/* ------------------------------------------------------------------------------------------- the game */

type Viewers = { readonly public: true } | { readonly public: false; readonly seats: readonly Seat[] };

interface Grant {
  readonly pos: number;
  readonly v: Viewers;
  readonly move: string;
}

/** Position numbers: the shared pile 0, 1, 2, …; a roll bound to a move id 2000 + its index. */
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
  if (mode === 'public' || mode === 'roll' || mode === 'reveal-block') return { public: true };
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

/** Setup steps before the first game action (`stop3`). */
const setupOf = (s: Scope): number => (s.design === 'stop3' ? (s.setup ?? 0) : 0);
/** The depth at which the game is over. */
const totalOf = (s: Scope): number => setupOf(s) + s.length;
/** The seat pending at a head of depth `d`: the setup step's seat, then round-robin from seat 0. */
function pendingAt(s: Scope, d: number): Seat {
  const k = setupOf(s);
  return d < k ? d : (d - k) % s.seats;
}
/** Grants whose reveal blocks the next decision until every seat's share is held (PROTOCOL-v2 §6.2, §6.3). */
const blocking = (s: Scope): boolean =>
  s.design === 'stop3' && (s.mode === 'roll' || s.mode === 'reveal-block');
const ascending = (xs: Iterable<Seat>): Seat[] => [...new Set(xs)].sort((a, b) => a - b);
const sameSeats = (a: readonly Seat[], b: readonly Seat[]): boolean =>
  a.length === b.length && a.every((x, i) => b[i] === x);

/* ------------------------------------------------------------------------------------------ the model */

export function explore(scope: Scope): Result {
  if (scope.mode === 'reveal-block' && scope.design !== 'stop3')
    throw new Error('protocol-model: reveal-block mode needs design stop3');
  if (setupOf(scope) > scope.seats) throw new Error('protocol-model: at most one setup step per seat');
  return new Explorer(scope).run();
}

class Explorer {
  private readonly s: Scope;
  private readonly honest: Seat[];
  private readonly coalition: ReadonlySet<Seat>;
  private readonly visited = new KeySet();
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
      saved: new Map(),
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
          endForfeit: null,
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
        `${setKey(c.has)}|${c.frozen === null ? '' : `${c.frozen.reason}${c.frozen.head}:${c.frozen.forfeit.join('.')}`}|${c.expired ?? ''}:${c.expiredCount}|${c.sawStop ? 's' : ''}${c.absent ? 'a' : ''}|${c.endForfeit === null ? '' : `${c.endForfeit.at}:${c.endForfeit.seats.join('.')}`}`,
    );
    const saved = [...st.saved.entries()]
      .map(([id, x]) => `${id}@${x.client}`)
      .sort()
      .join(',');
    const full = `${evs}#${cl.join('#')}#${st.expiries}#${saved}`;
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
    // A cache, bounded so that big scopes fit in memory.
    if (this.viewMemo.size >= 300_000) this.viewMemo.clear();
    this.viewMemo.set(memoKey, v);
    return v;
  }

  /**
   * The result whose End phase is open on a client (`secrets`): its `over` result, also one that stands against a
   * fork (review N1, unless `noStandingEnd`), or a stop with the `stopClaims` regression. Null otherwise.
   */
  private endPhase(v: View): string | null {
    if (this.s.secrets !== true) return null;
    if (v.status === 'over' && !v.forked) return `over:${v.head}`;
    if (v.status === 'stood' && v.standing?.kind === 'over' && this.s.noStandingEnd !== true)
      return `over:${v.head}`;
    if (v.status === 'stop' && !v.cancelled && this.s.stopClaims === true) return `stop:${v.head}`;
    return null;
  }

  /** The seats stalled in an open End phase: those whose secret the client does not hold. */
  private endStalled(v: View): Seat[] {
    return Array.from({ length: this.s.seats }, (_, k) => k).filter((k) => !v.secrets.has(k));
  }

  /* ---------------------------------------------------------------------------------- transitions */

  private successors(st: State): [string, State][] {
    const s = this.s;
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
    this.staleOutbox(st, out);
    if (this.coalition.size > 0) this.adversary(st, evs, out);
    // A deadline passes on one honest client: only while honest gossip is complete and no honest seat still has a
    // move to make (honest humans act within the deadline).
    if (st.expiries < s.expiries && moved.length === 0 && this.honestQuiet(st)) {
      for (let i = 0; i < st.clients.length; i++) {
        const c = st.clients[i] as Client;
        if (c.frozen !== null) continue;
        const v = this.view(st, c);
        // In play (stop3: past the setup steps; setup timeouts are not modelled), or an open End phase.
        const playing = v.status === 'live' && (s.design !== 'stop3' || v.path.length > setupOf(s));
        const ek = this.endPhase(v);
        const endOpen = ek !== null && c.endForfeit?.at !== ek && this.endStalled(v).length > 0;
        if (!playing && !endOpen) continue;
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

  /**
   * Stale outboxes (round 3, A3): a pending honest device saves its move offline (signed, not published); its human
   * may then play that turn on another device; later the saved move is published or, under the controller rule
   * (`outboxRule`), published only if the synced device's head is still its prev and the device holds no other move
   * by its seat there, and dropped otherwise.
   */
  private staleOutbox(st: State, out: [string, State][]): void {
    const budget = this.s.stale ?? 0;
    if (budget === 0) return;
    const used = [...st.events.values()].filter((e) => e.t === 'move' && e.stale === true).length;
    if (st.saved.size + used < budget) {
      for (let i = 0; i < st.clients.length; i++) {
        const c = st.clients[i] as Client;
        if (c.frozen !== null || c.absent) continue;
        const v = this.view(st, c);
        const me = c.seat;
        if (v.status !== 'live' || v.pending !== me || v.waiting) continue;
        const depth = v.path.length + 1;
        // The human takes each turn once per device; it has not played this one anywhere it can see yet.
        if ([...st.events.values()].some((e) => e.t === 'move' && e.seat === me && e.depth === depth))
          continue;
        if ([...st.saved.values()].some((x) => x.ev.seat === me && x.ev.depth === depth)) continue;
        const ev = { ...this.honestEvent(st, c, v, 1), stale: true };
        out.push([
          `${this.who(c)} saves ${ev.id} offline`,
          { ...st, saved: new Map(st.saved).set(ev.id, { ev, client: i }) },
        ]);
      }
    }
    for (const [id, x] of st.saved) {
      const c = st.clients[x.client] as Client;
      const rest = new Map(st.saved);
      rest.delete(id);
      if (this.s.outboxRule === true) {
        // Synced (A3): the device holds every event some honest client holds; until then the outbox waits.
        if (!this.synced(st, c)) continue;
        const head = this.view(st, c).head;
        const taken = [...c.has].some((h) => {
          const e = st.events.get(h) as Ev;
          return e.t === 'move' && e.seat === x.ev.seat && e.prev === x.ev.prev;
        });
        if (x.ev.prev !== head || taken) {
          out.push([`${this.who(c)} drops its stale ${id}`, { ...st, saved: rest }]);
          continue;
        }
      }
      if (st.events.has(id)) {
        out.push([`${this.who(c)} drops its stale ${id} (already out)`, { ...st, saved: rest }]);
        continue;
      }
      const next: State = { ...st, saved: rest, events: new Map(st.events).set(id, x.ev) };
      out.push([`${this.who(c)} publishes its saved ${id}`, this.settle(deliver(next, x.client, [id]))]);
    }
  }

  /** Events signed by `c`'s seat (on any device) that `c` lacks, with the moves they build on. */
  private ownEvents(st: State, c: Client): string[] {
    const out = new Set<string>();
    const get = (id: string) => st.events.get(id) as MoveEv;
    for (const e of st.events.values()) {
      // Held or not: an event already held (an attestation reaches every client at once) still brings what it
      // builds on.
      if (e.seat !== c.seat) continue;
      if (!c.has.has(e.id)) out.add(e.id);
      const at =
        e.t === 'move'
          ? e.prev
          : e.t === 'share' || e.t === 'claim' || e.t === 'resign' || e.t === 'attest'
            ? e.head
            : ROOT;
      if (at !== ROOT && st.events.has(at)) for (const id of pathTo(at, get)) if (!c.has.has(id)) out.add(id);
      // An attestation of a claim or resign brings the claim or resign it rests on (the attestation names it).
      if (e.t === 'attest' && e.kind !== 'over')
        for (const x of st.events.values()) {
          const rests =
            (e.kind === 'resign' && x.t === 'resign' && e.forfeit.includes(x.seat)) ||
            (e.kind === 'claim' && x.t === 'claim' && x.head === e.head && !e.forfeit.includes(x.seat));
          if (rests && !c.has.has(x.id)) out.add(x.id);
        }
    }
    return [...out];
  }

  /** Client `c` holds every event that some honest client holds. */
  private synced(st: State, c: Client): boolean {
    for (const x of st.clients) for (const id of x.has) if (!c.has.has(id)) return false;
    return true;
  }

  /** The move honest client `c` signs on its head: a draw carrying every share it owes as of the head (slow path). */
  private honestEvent(st: State, c: Client, v: View, variant: number): MoveEv {
    const me = c.seat;
    const s = this.s;
    const depth = v.path.length + 1;
    const setup = depth <= setupOf(s);
    const released = this.releasedBy(c, st);
    const rel: string[] = [];
    // PROTOCOL-v2 §6.2: a Move never carries a roll contribution; setup steps carry no shares.
    if (!setup && !(s.design === 'stop3' && s.mode === 'roll'))
      for (const g of v.grants)
        for (const o of owed(g, me)) if (!released.has(o) && !rel.includes(o)) rel.push(o);
    const kind: Kind = setup ? 'shuf' : 'draw';
    return {
      t: 'move',
      id: moveId(v.head, me, kind, variant),
      seat: me,
      prev: v.head,
      depth,
      kind,
      v: variant,
      rel,
      kc: this.coalitionKnows(st),
      honest: true,
    };
  }

  private adversary(st: State, evs: Ev[], out: [string, State][]): void {
    const s = this.s;
    const e3 = s.design === 'stop3';
    const T = totalOf(s);
    const setup = setupOf(s);
    const counts = { move: 0, ack: 0, claim: 0, resign: 0, attest: 0, cheat: 0, extra: 0 };
    for (const e of evs) {
      if (!this.coalition.has(e.seat)) continue;
      if (e.t === 'share') {
        if (e.extra === true) counts.extra++;
      } else if (e.t !== 'secret') counts[e.t]++;
      if (e.t === 'move' && e.cheat === true) counts.cheat++;
    }
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
        if (p.depth >= T) continue;
        const seat = pendingAt(s, p.depth);
        if (!this.coalition.has(seat)) continue;
        const rivals = moves.filter((m) => m.prev === p.id);
        if (rivals.length >= s.rivalsPerPrev) continue;
        const kinds: Kind[] =
          p.depth < setup
            ? ['shuf', 'junk']
            : s.multiDraw === true
              ? ['draw', 'draw2', 'pass']
              : ['draw', 'pass'];
        const cheats =
          s.secrets === true && p.depth >= setup && counts.cheat < (s.advCheats ?? 0)
            ? [false, true]
            : [false];
        for (const kind of kinds) {
          for (let v = 0; v < s.rivalsPerPrev; v++) {
            for (const cheat of cheats) {
              const id = moveId(p.id, seat, kind, v) + (cheat ? 'x' : '');
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
                ...(cheat ? { cheat: true } : {}),
              };
              targets(`seat ${seat} signs ${id}${cheat ? ' (a cheat)' : ''}`, ev);
            }
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
    // Claims and resigns, naming any head (stop3: claims only past the setup steps, where a claim can count).
    const heads = [ROOT, ...moves.map((m) => m.id)];
    const depthOf = (h: string): number => (h === ROOT ? 0 : (st.events.get(h) as MoveEv).depth);
    if (counts.claim < s.advClaims) {
      for (const h of heads) {
        const depth = depthOf(h);
        if (e3 && depth <= setup) continue;
        for (const a of this.coalition) {
          if (pendingAt(s, depth) === a || depth >= T) continue;
          const id = `C${a}@${h}`;
          if (st.events.has(id)) continue;
          targets(`seat ${a} claims a timeout at ${h}`, { t: 'claim', id, seat: a, head: h });
        }
      }
    }
    // Attestations (`stop3`): a coalition seat attests any valid result. Only results that every seat but the
    // equivocator attested can stand, so the useful ones are those some honest client attested, natural ends, and
    // the results of claims and resigns that exist (the view checks validity in any case); with `unresolved`, also
    // one anchored on an id no honest client holds.
    if (e3 && counts.attest < (s.advAttests ?? 0)) {
      const results = new Map<string, Standing>();
      const add = (r: Standing): void => {
        results.set(standingKey(r), r);
      };
      const missing = blocking(s) ? this.missingShares(st) : new Map<string, Seat[]>();
      for (const e of evs) {
        if (e.t === 'attest' && !this.coalition.has(e.seat))
          add({ kind: e.kind, head: e.head, forfeit: e.forfeit });
        if (e.t === 'move' && e.depth >= T) add({ kind: 'over', head: e.id, forfeit: [] });
        if (e.t === 'claim' && (e.head === ROOT || st.events.has(e.head))) {
          const depth = depthOf(e.head);
          add({ kind: 'claim', head: e.head, forfeit: [pendingAt(s, depth)] });
          const m = missing.get(e.head);
          if (m !== undefined && m.length > 0) add({ kind: 'claim', head: e.head, forfeit: m });
        }
        if (e.t === 'resign') add({ kind: 'resign', head: e.head, forfeit: [e.seat] });
      }
      if (s.unresolved === true) add({ kind: 'over', head: UNRESOLVED, forfeit: [] });
      for (const a of this.coalition) {
        for (const [key, r] of results) {
          const id = `T${a}:${key}`;
          if (st.events.has(id)) continue;
          const next: State = {
            ...st,
            events: new Map(st.events).set(id, { t: 'attest', id, seat: a, ...r }),
          };
          out.push([`seat ${a} attests ${key}`, this.settle(everyone(next, id))]);
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
    if (!e3) return;
    // Shares events (`stop3`). In the blocking modes a coalition seat releases its share of a pending reveal or
    // roll whenever it likes, anchored on the requesting move; within `advShares`, it anchors a Shares event
    // anywhere (with `unresolved`, on an id no honest client holds), with a position of a blocking grant or none.
    const pub = blocking(s) ? this.publicGrants(st) : [];
    for (const a of this.coalition) {
      const released = new Set<number>();
      for (const e of evs) if (e.t === 'share' && e.seat === a && e.to === null) released.add(e.pos);
      for (const g of pub) {
        if (released.has(g.pos)) continue;
        const id = `S${a}:${g.pos}:*@${g.move}`;
        if (st.events.has(id)) continue;
        targets(`seat ${a} releases ${g.pos}`, {
          t: 'share',
          id,
          seat: a,
          pos: g.pos,
          to: null,
          head: g.move,
        });
      }
      if (counts.extra >= (s.advShares ?? 0)) continue;
      const anchors = [...heads, ...(s.unresolved === true ? [UNRESOLVED] : [])];
      const positions = [-1, ...pub.map((g) => g.pos).filter((p) => !released.has(p))];
      for (const anchor of anchors)
        for (const pos of positions) {
          const id = `Z${a}:${pos}@${anchor}`;
          if (st.events.has(id)) continue;
          targets(`seat ${a} anchors a Shares event (position ${pos}) on ${anchor}`, {
            t: 'share',
            id,
            seat: a,
            pos,
            to: null,
            head: anchor,
            extra: true,
          });
        }
    }
    // Secret reveals (`secrets`): a coalition seat publishes its own whenever it likes, or never. They reach every
    // honest client at once: a secret only matters to a claim (judged once gossip is complete) or to the audit.
    if (s.secrets === true)
      for (const a of this.coalition) {
        const id = `K${a}`;
        if (st.events.has(id)) continue;
        const next: State = { ...st, events: new Map(st.events).set(id, { t: 'secret', id, seat: a }) };
        out.push([`seat ${a} publishes its secret`, this.settle(everyone(next, id))]);
      }
  }

  /** Every public blocking grant on the line of some created move, one per position. */
  private publicGrants(st: State): Grant[] {
    const get = (id: string) => st.events.get(id) as MoveEv;
    const out = new Map<number, Grant>();
    for (const e of st.events.values()) {
      if (e.t !== 'move' || DRAWS[e.kind] === 0) continue;
      for (const g of grantsOn(this.s, pathTo(e.id, get), get))
        if (g.move === e.id && !out.has(g.pos)) out.set(g.pos, g);
    }
    return [...out.values()];
  }

  /** For each created blocking move, the seats with no public share of its positions in the whole event set. */
  private missingShares(st: State): Map<string, Seat[]> {
    const has = new Map<number, Set<Seat>>();
    for (const e of st.events.values()) {
      if (e.t === 'share' && e.to === null) addTo(has, e.pos, e.seat);
      if (e.t === 'move')
        for (const r of e.rel) if (r.endsWith(':*')) addTo(has, Number(r.split(':')[0]), e.seat);
    }
    const out = new Map<string, Seat[]>();
    for (const g of this.publicGrants(st)) {
      const miss = Array.from({ length: this.s.seats }, (_, k) => k).filter((k) => !has.get(g.pos)?.has(k));
      out.set(g.move, ascending([...(out.get(g.move) ?? []), ...miss]));
    }
    return out;
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

  /**
   * This client's own result, as it attests it (PROTOCOL-v2 §5.3, §7.1): an accepted claim, a counted resign
   * (`named`: at the head it names, unless it cancels), or the module over on its chain. Null otherwise.
   */
  private ownResult(c: Client, v: View): Standing | null {
    if (c.frozen !== null) {
      const f = c.frozen;
      if (f.reason === 'resign' && this.named() && v.resignCancels(f.head, f.forfeit[0] as Seat)) return null;
      return { kind: f.reason, head: f.head, forfeit: f.forfeit };
    }
    if (v.status === 'over') return { kind: 'over', head: v.head, forfeit: [] };
    return null;
  }

  /** A resign's identity is its named head (`stop3`, unless `resignAt: 'counted'`). */
  private named(): boolean {
    return this.s.design === 'stop3' && this.s.resignAt !== 'counted';
  }

  /** One honest client's reactions to what it holds: at most one batch of new events. */
  private react(st: State, i: number): State {
    const s = this.s;
    let c = st.clients[i] as Client;
    // Round 3: an honest client attests its result once it has one and holds no fork (PROTOCOL §7: the attestation
    // carries the log hash, so it names the chain).
    if (s.design === 'stop3') {
      const v0 = this.view(st, c);
      const r = this.ownResult(c, v0);
      if (r !== null && !v0.forked) {
        const id = `T${c.seat}:${standingKey(r)}`;
        if (!c.has.has(id)) {
          const ev: AttestEv = { t: 'attest', id, seat: c.seat, ...r };
          return everyone({ ...st, events: new Map(st.events).set(id, ev) }, id);
        }
      }
      // The Secret phase: once the game has ended on this client (a result, a cancel or a stop), it publishes its
      // Secret reveal (it reaches every honest client at once, as the adversary's do).
      if (s.secrets === true && !c.has.has(`K${c.seat}`) && (c.frozen !== null || v0.status !== 'live')) {
        const id = `K${c.seat}`;
        return everyone({ ...st, events: new Map(st.events).set(id, { t: 'secret', id, seat: c.seat }) }, id);
      }
    }
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
    const me = c.seat;
    // The End phase (`secrets`): once this client's deadline passed at the result's head, it claims against the
    // seats whose secret is missing, and accepts a claim there by a seat that is not stalled (v1 §8.1 "End").
    const ek = this.endPhase(v);
    if (ek !== null && c.endForfeit?.at !== ek && c.expired === v.head) {
      const stalled = this.endStalled(v);
      if (stalled.length > 0 && !stalled.includes(me)) {
        const accepted = [...c.has].some((id) => {
          const e = st.events.get(id) as Ev;
          return e.t === 'claim' && e.head === v.head && !stalled.includes(e.seat);
        });
        if (accepted) {
          const endForfeit = { at: ek, seats: stalled };
          return { ...st, clients: st.clients.map((x, j) => (j === i ? { ...c, endForfeit } : x)) };
        }
        const id = `C${me}@${v.head}`;
        if (!c.has.has(id)) {
          const ev: ClaimEv = { t: 'claim', id, seat: me, head: v.head };
          return deliver({ ...st, events: new Map(st.events).set(id, ev) }, i, [id]);
        }
      }
    }
    if (v.status !== 'live') return st;
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
    // Honest claims, when this client's deadline passed at the head (twice after a resume, in round 2), against
    // the stalled seats (the pending seat, or with a blocking reveal every seat missing a share).
    if (
      c.expired === v.head &&
      c.expiredCount >= this.claimNeed(c, st) &&
      v.stalled.length > 0 &&
      !v.stalled.includes(me) &&
      !c.has.has(`C${me}@${v.head}`)
    ) {
      made.push({ t: 'claim', id: `C${me}@${v.head}`, seat: me, head: v.head });
    }
    if (made.length === 0) return st;
    const events = new Map(st.events);
    // Another device of the same seat may already have published the same Ack or share: the same event here.
    for (const e of made) events.set(e.id, e);
    // Standalone shares reach every honest client at once: they change no honest decision (only what a client
    // can read; in the blocking modes, also when a reveal completes, which the adversary could only delay on some
    // clients until A3 delivers it), and the adversary sees them at once anyway, so their delivery order is not
    // explored. In honest-only runs (liveness) the network is synchronous: everything reaches everyone at once, and
    // only the humans' move order is explored.
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
  private honestMove(st0: State, i: number): State | null {
    let st = st0;
    if ((st.clients[i] as Client).frozen !== null || (st.clients[i] as Client).absent) return null;
    // `ownCheck` (round 3, device policy (ii)): before signing, the device fetches every event its seat published
    // from any device (with their prevs) and acts on what it then holds.
    if (this.s.ownCheck === true) {
      const ids = this.ownEvents(st, st.clients[i] as Client);
      if (ids.length > 0) st = this.settle(deliver(st, i, ids));
    }
    const c = st.clients[i] as Client;
    if (c.frozen !== null) return null;
    const v = this.view(st, c);
    const me = c.seat;
    // A blocking reveal or roll leaves no decision pending until every share is held.
    if (v.status !== 'live' || v.pending !== me || v.waiting) return null;
    // The human plays each of its turns once, on whichever device: it remembers it took turn number d.
    const depth = v.path.length + 1;
    for (const e of st.events.values()) if (e.t === 'move' && e.seat === me && e.depth === depth) return null;
    for (const x of st.saved.values()) if (x.client === i && x.ev.prev === v.head) return null;
    // `checked`: no published move or Ack by this seat may conflict with the head it would build on.
    if (this.s.ackDevice === 'checked' && this.conflictsWithOwn(st, me, v.head)) return null;
    const ev = this.honestEvent(st, c, v, 0);
    if (st.events.has(ev.id)) return null;
    let next: State = { ...st, events: new Map(st.events).set(ev.id, ev) };
    if (this.coalition.size === 0)
      for (let j = 0; j < st.clients.length; j++) next = deliver(next, j, [ev.id]);
    else next = deliver(next, i, [ev.id]);
    return this.settle(next);
  }

  private mayRelease(v: View, g: Grant, me: Seat): boolean {
    const d = this.s.design;
    // D039, fork stop alone and candidate (e): released as soon as the granting move is held.
    if (d === 'd039' || d === 'fs' || d === 'stop' || d === 'stop3') return true;
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
    const s = this.s;
    const e3 = s.design === 'stop3';
    const get = (id: string) => v.byId.get(id) as MoveEv;
    const pathOf = (h: string): string[] => (h === ROOT ? [] : pathTo(h, get));
    // A resign counts once its head is on the chain (PROTOCOL §8.3); it ends the game at this client's head, or
    // (`named`, PROTOCOL-v2 §8.3) its identity is the head it names.
    const onChain = new Set([ROOT, ...v.path]);
    let best: ResignEv | null = null;
    for (const id of c.has) {
      const e = st.events.get(id) as Ev;
      if (e.t === 'resign' && onChain.has(e.head) && (best === null || e.id < best.id)) best = e;
    }
    if (best !== null) {
      if (this.named())
        return { path: pathOf(best.head), reason: 'resign', head: best.head, forfeit: [best.seat] };
      return { path: v.path, reason: 'resign', head: v.head, forfeit: [best.seat] };
    }
    // Round 3, device policy (ii) (`ownCheck`): a device adopts a claim or resign result that its own seat attested
    // from another device, at a head on its chain: its seat already counted it.
    if (e3 && s.ownCheck === true) {
      let own: AttestEv | null = null;
      for (const id of c.has) {
        const e = st.events.get(id) as Ev;
        if (e.t !== 'attest' || e.seat !== c.seat || e.kind === 'over' || !onChain.has(e.head)) continue;
        if (own === null || e.id < own.id) own = e;
      }
      if (own !== null)
        return {
          path: pathOf(own.head),
          reason: own.kind as 'claim' | 'resign',
          head: own.head,
          forfeit: own.forfeit,
        };
    }
    // Round 3 (\`stop3\`): a claim by this client's own seat, from another device, at a head on its chain counts
    // there: that device's deadline passed (device policy (ii), with \`ownCheck\`).
    if (e3) {
      for (const id of c.has) {
        const e = st.events.get(id) as Ev;
        if (e.t !== 'claim' || e.seat !== c.seat || !onChain.has(e.head)) continue;
        const path = pathOf(e.head);
        if (path.length <= setupOf(s)) continue;
        const stalled = v.stalledAt(e.head);
        if (stalled.length > 0 && !stalled.includes(c.seat))
          return { path, reason: 'claim', head: e.head, forfeit: stalled };
      }
    }
    // The N2 regression (`autoOwnForfeit`): a claim at the head whose stalled seats are this seat alone is accepted
    // at once, without a deadline (claim validity has no clock, PROTOCOL-v2 §5.3).
    if (e3 && s.autoOwnForfeit === true && v.stalled.length === 1 && v.stalled[0] === c.seat) {
      for (const id of c.has) {
        const e = st.events.get(id) as Ev;
        if (e.t === 'claim' && e.head === v.head && e.seat !== c.seat)
          return { path: v.path, reason: 'claim', head: v.head, forfeit: v.stalled };
      }
    }
    // A claim counts when its head is the head, this client's deadline passed there, and its claimant is not
    // stalled there; every stalled seat forfeits.
    if (c.expired === v.head && c.expiredCount >= this.claimNeed(c, st)) {
      for (const id of c.has) {
        const e = st.events.get(id) as Ev;
        if (e.t === 'claim' && e.head === v.head && !v.stalled.includes(e.seat))
          return { path: v.path, reason: 'claim', head: v.head, forfeit: v.stalled };
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

  /** A client's final result: what it shows once every created event has reached it. */
  private finalOf(c: Client, v: View): Final {
    const s = this.s;
    const get = (id: string) => v.byId.get(id) as MoveEv;
    const pathOf = (h: string): string[] => (h === ROOT ? [] : pathTo(h, get));
    /** The scored path of a resign result (`named`: up to S, PROTOCOL-v2 §8.3). */
    const resignPath = (head: string, k: Seat, fallback: readonly string[]): readonly string[] =>
      this.named() ? pathOf(v.sOf(head, k)) : fallback;
    let f: Omit<Final, 'base' | 'score' | 'auditFailed'>;
    if (v.status === 'stood' && v.standing !== null) {
      // Round 3: the result that stood at the fork, on every client; a different counted one is voided.
      const R = v.standing;
      const same =
        c.frozen !== null &&
        c.frozen.reason === R.kind &&
        c.frozen.head === R.head &&
        sameSeats(c.frozen.forfeit, R.forfeit);
      f = {
        end: R.kind,
        head: R.head,
        path: R.kind === 'resign' ? resignPath(R.head, R.forfeit[0] as Seat, v.path) : v.path,
        forfeit: R.forfeit,
        frozen: c.frozen,
        view: v,
        voided: c.frozen !== null && !same ? c.frozen : null,
      };
    } else if (c.frozen !== null && v.status === 'stop' && this.stopVoids(v.path, c.frozen.path)) {
      // Fork stop takes precedence (prompt-reveal.md §5, rule 4): a stop at a prev on the path of a counted claim
      // or resign voids it, so the result is a function of the held events.
      f = {
        end: v.cancelled ? 'cancel' : 'stop',
        head: v.head,
        path: v.path,
        forfeit: v.equivocators,
        frozen: null,
        view: v,
        voided: c.frozen,
      };
    } else if (v.status === 'stop') {
      if (c.frozen !== null) f = this.frozenFinal(c.frozen, v, resignPath);
      else
        f = {
          end: v.cancelled ? 'cancel' : 'stop',
          head: v.head,
          path: v.path,
          forfeit: v.equivocators,
          frozen: null,
          view: v,
          voided: null,
        };
    } else if (c.frozen !== null) f = this.frozenFinal(c.frozen, v, resignPath);
    else
      f = {
        end: v.status === 'over' ? 'over' : 'live',
        head: v.head,
        path: v.path,
        forfeit: [],
        frozen: null,
        view: v,
        voided: null,
      };
    const base = scores(s, f.end, f.head, f.forfeit, v.stopSeat, v.beforePlay);
    // The audit (`secrets`): once every secret is held it replays the scored line, and fails each cheat's signer.
    const auditFailed =
      s.secrets === true && (f.end === 'over' || f.end === 'stop') && v.secrets.size === s.seats
        ? ascending(f.path.filter((id) => get(id).cheat === true).map((id) => get(id).seat))
        : [];
    const ended = c.endForfeit !== null && c.endForfeit.at === `${f.end}:${f.head}` ? c.endForfeit.seats : [];
    const score = base.map((x, k) => {
      if (f.end === 'over' && (ended.includes(k) || auditFailed.includes(k))) return 'last';
      if (f.end === 'stop') {
        if (ended.includes(k)) return 'last';
        // A proven failure after a stop moves a seat that is not an equivocator to just above the equivocators.
        if (auditFailed.includes(k) && !f.forfeit.includes(k)) return 'failed';
      }
      return x;
    });
    return { ...f, base, score, auditFailed };
  }

  private frozenFinal(
    fr: Frozen,
    v: View,
    resignPath: (head: string, k: Seat, fallback: readonly string[]) => readonly string[],
  ): Omit<Final, 'base' | 'score' | 'auditFailed'> {
    if (fr.reason === 'resign' && this.named() && v.resignCancels(fr.head, fr.forfeit[0] as Seat))
      return { end: 'cancel', head: fr.head, path: fr.path, forfeit: [], frozen: fr, view: v, voided: null };
    return {
      end: fr.reason,
      head: fr.head,
      path: fr.reason === 'resign' ? resignPath(fr.head, fr.forfeit[0] as Seat, fr.path) : fr.path,
      forfeit: fr.forfeit,
      frozen: fr,
      view: v,
      voided: null,
    };
  }

  private check(st: State, trace: () => string[]): void {
    this.checked++;
    const s = this.s;
    const e3 = s.design === 'stop3';
    const views = st.clients.map((c) => this.view(st, c));
    const finals = st.clients.map((c, i) => this.finalOf(c, views[i] as View));
    // S3.
    const sig = finals.map((f) => `${f.end}:${f.head}${f.end === 'claim' ? `:${f.forfeit.join('.')}` : ''}`);
    if (new Set(sig).size > 1) {
      // The pre-existing claim race: some client ended on a claim or resign, and no client holds a fork. A
      // difference with a fork held is a genuine divergence (round 3, A2).
      const raced = finals.some((f) => f.frozen !== null) && !finals.some((f) => f.view.forked);
      this.report(
        raced ? 'claim-race' : 'divergence',
        `honest results differ: ${st.clients.map((c, i) => `${this.who(c)} ${sig[i]}`).join(', ')}`,
        trace,
      );
    }
    // S2.
    for (const f of finals) {
      // Round 3: a fork records its equivocators (M1: every seat with a fork on a valid line); never an honest seat.
      for (const x of f.view.allEquivocators)
        if (!this.coalition.has(x))
          this.report('honest-flagged', `honest seat ${x} is recorded as an equivocator`, trace);
      if (f.end === 'claim') {
        for (const seat of f.forfeit) {
          if (this.coalition.has(seat)) continue;
          // The claim race (PROTOCOL §11): an honest seat whose own clients already ended the game on an accepted
          // claim against another seat stops moving, and is timed out on a client that never accepted it. Known v1
          // residual. (Ended on a counted resign instead, it needs a fork: F8, reported as an honest forfeit.)
          const ended = st.clients
            .filter((c) => c.seat === seat)
            .every(
              (c) => c.frozen !== null && c.frozen.reason === 'claim' && !c.frozen.forfeit.includes(seat),
            );
          this.report(
            ended ? 'claim-race' : 'honest-forfeit',
            `honest seat ${seat} timed out at ${f.head}${ended ? ' after its own client ended the game' : ''}`,
            trace,
          );
        }
      }
      if (f.end === 'stop' && !this.coalition.has(f.view.stopSeat as Seat))
        this.report(
          'honest-forfeit',
          `the game stopped on an honest seat's fork (${f.view.stopSeat})`,
          trace,
        );
      for (const [k, x] of f.score.entries())
        if (x !== f.base[k] && !this.coalition.has(k) && !f.auditFailed.includes(k))
          this.report('honest-forfeit', `honest seat ${k} forfeits for a missing secret at ${f.head}`, trace);
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
      // With 3 or more seats a stop is an unrated abort: voiding a game that had already ended (rated) is more
      // than a resign can do.
      if (f.end === 'stop' && s.seats > 2 && f.view.endedVoided)
        this.report(
          'ended-void',
          `the stop by seat ${f.view.stopSeat} voids a game that had already ended`,
          trace,
        );
      // M1 (PROTOCOL-v2 §5.6): every equivocator of the global scan shares the last places, rated.
      if (e3 && f.end === 'stop' && (s.stopScore ?? 'abort') !== 'abort')
        for (const x of f.view.allEquivocators)
          if (f.score[x] !== 'last' && f.score[x] !== 'tie')
            this.report(
              'rating',
              `equivocator ${x} is not rated last by the stop of seat ${f.view.stopSeat} (${f.score[x]})`,
              trace,
            );
      const lost = f.voided;
      if (lost?.forfeit.some((x) => this.coalition.has(x))) {
        const by = f.end === 'stop' ? `the stop of seat ${f.view.stopSeat}` : `${f.end} (stood)`;
        const detail = `a fork at ${f.path.at(-1) ?? ROOT} voids seat ${lost.forfeit.join(',')}'s counted ${lost.reason} (now ${by})`;
        // Round 3: a counted claim or resign that did not stand is overridden by design (A2: the stop wins on
        // every client). With 2 seats the stop is the same rated loss; with 3 or more, a rated timeout becoming an
        // unrated abort, or the record moving to another coalition seat, is reported apart (an owner question).
        if (e3) {
          // A coalition seat gains when its score changes to anything but a rated last place (a timeout becoming
          // an unrated abort, a standing moved to another head, the record moved to another seat).
          // A counted resign that cancels (`named`: S cut before the resigner's first game action) was no loss.
          const lostEnd = this.frozenFinal(lost, f.view, (h) => [h]).end;
          const was = scores(s, lostEnd, lost.head, lost.forfeit, null, false);
          const now = f.base;
          const gain =
            lostEnd !== 'cancel' && [...this.coalition].some((x) => was[x] !== now[x] && now[x] !== 'last');
          if (gain) this.report(s.seats === 2 ? 'rating' : 'void-forfeit', detail, trace);
        } else {
          const same = f.end === 'stop' && lost.forfeit.length === 1 && f.view.stopSeat === lost.forfeit[0];
          const sameEffect = same && (lost.reason === 'resign' || s.seats === 2) && forfeitStop(s.design);
          if (!sameEffect) this.report('rating', detail, trace);
        }
      }
    }
    if (e3) {
      for (const f of finals) {
        // H1 (PROTOCOL-v2 §5.6): a stop cancels only when nothing was played; a cancel with a game action held on
        // a valid line lets E escape a game in play.
        if (f.end === 'cancel' && f.view.status === 'stop' && f.view.anyPlay)
          this.report(
            'cancel-escape',
            `the fork of seat ${f.view.stopSeat} at ${f.head} cancels a game in play`,
            trace,
          );
        // H2 (PROTOCOL-v2 §7.3): a stop's places are fixed at the stop, except for a proven audit failure.
        if (f.end === 'stop')
          for (const [k, x] of f.score.entries())
            if (x !== f.base[k] && !f.auditFailed.includes(k))
              this.report(
                'stop-demotion',
                `seat ${k} moves from ${f.base[k]} to ${x} after the stop at ${f.head}`,
                trace,
              );
      }
      // N1 (PROTOCOL-v2 §5.4): a cheat on the line of an `over` result is audited (every secret held) or its End
      // phase is open (a seat whose secret is missing is stalled, and forfeits once a deadline passes).
      if (s.secrets === true)
        for (const [i, f] of finals.entries()) {
          if (f.end !== 'over' || f.view.secrets.size === s.seats) continue;
          if (this.endPhase(f.view) !== null) continue;
          const get = (id: string) => f.view.byId.get(id) as MoveEv;
          for (const id of f.path)
            if (get(id).cheat === true && f.score[get(id).seat] !== 'last')
              this.report(
                'cheat-escape',
                `seat ${get(id).seat}'s cheat ${id} stands unaudited on ${this.who(st.clients[i] as Client)}'s ` +
                  `${f.view.status === 'stood' ? 'standing ' : ''}result over:${f.head}, and no seat is stalled`,
                trace,
              );
        }
    }
    // Finality (round 3): the scores of a result every honest seat attested are the scores on every honest client
    // (a label change with the same scores, such as a 2-seat timeout of E becoming E's stop, is fine, and so is a
    // 2-seat result becoming the equivocator's loss). The audit's forfeits change places, never which result it is.
    if (e3) {
      const bySeat = new Map<Seat, Map<string, string>>();
      for (const e of st.events.values())
        if (e.t === 'attest' && !this.coalition.has(e.seat)) {
          const m = bySeat.get(e.seat) ?? new Map<string, string>();
          m.set(standingKey(e), scores(s, e.kind, e.head, e.forfeit, null, false).join(','));
          bySeat.set(e.seat, m);
        }
      const first = bySeat.get(this.honest[0] as Seat);
      for (const [r, score] of first ?? []) {
        if (!this.honest.every((h) => bySeat.get(h)?.has(r) === true)) continue;
        // An honest seat that also attested a rival result (two devices on two sides) leaves two results attested:
        // neither stands, by design.
        if (this.honest.some((h) => [...(bySeat.get(h)?.keys() ?? [])].some((x) => x !== r))) continue;
        for (const [i, f] of finals.entries()) {
          const now = f.base;
          const got = now.join(',');
          // A stop that only makes the equivocator's score worse (a 2-seat result becoming its loss, or a 3-seat
          // resign becoming its rated last place) harms no honest seat.
          const was = score.split(',');
          if (got !== score && !this.honest.every((h) => now[h] === 'first' || now[h] === was[h]))
            this.report(
              'attested-void',
              `every honest seat attested ${r} (${score}), but ${this.who(st.clients[i] as Client)} ends on ` +
                `${f.end}:${f.head} (${got})`,
              trace,
            );
        }
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
        const f = finals[i] as Final;
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
    if (d === 'stop3') return true;
    if (d !== 'fs' && d !== 'stop' && !isFgr(d)) return false;
    const rule = this.s.rule9 ?? (d === 'fgr2' || d === 'stop' ? 'none' : 'at-or-past');
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

/** A client's final result in the checks. */
interface Final {
  readonly end: 'live' | 'over' | 'claim' | 'resign' | 'stop' | 'cancel';
  /** The result's head (a resign's identity head), or the fork point of a stop. */
  readonly head: string;
  /** The scored path (S1): to the result's head, to S for a resign (`named`), to P for a stop. */
  readonly path: readonly string[];
  /** The forfeiting seats of a claim or resign; the equivocators of a stop. */
  readonly forfeit: readonly Seat[];
  readonly frozen: Frozen | null;
  readonly view: View;
  readonly voided: Frozen | null;
  /** Per-seat scores of the result itself. */
  readonly base: readonly string[];
  /** Per-seat scores after the End phase: claims for missing secrets and the audit (`secrets`). */
  readonly score: readonly string[];
  readonly auditFailed: readonly Seat[];
}

/**
 * A set of state keys that can outgrow one JavaScript Set (whose size is capped at 2^24 entries): the keys are
 * spread over 64 Sets by their last character.
 */
class KeySet {
  private readonly shards: Set<string>[] = Array.from({ length: 64 }, () => new Set<string>());

  private shard(k: string): Set<string> {
    return this.shards[k.charCodeAt(k.length - 1) & 63] as Set<string>;
  }

  has(k: string): boolean {
    return this.shard(k).has(k);
  }

  add(k: string): void {
    this.shard(k).add(k);
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
  const k = { draw: 'd', draw2: 'D', pass: 'p', shuf: 's', junk: 'j' }[kind];
  return `${prev === ROOT ? '' : `${prev}/`}${seat}${k}${v}`;
}

function addTo(m: Map<number, Set<Seat>>, pos: number, seat: Seat): void {
  const set = m.get(pos) ?? new Set<Seat>();
  set.add(seat);
  m.set(pos, set);
}

function hasAcks(d: Design): boolean {
  return d === 'ack' || d === 'ack-lock' || isFgr(d);
}

const standingKey = (r: { kind: string; head: string; forfeit: readonly Seat[] }): string =>
  `${r.kind}@${r.head}:${r.forfeit.join('.')}`;

/**
 * A result's score, per seat. 2 seats: a timeout, resign or stop is a rated loss for the forfeiting seats (a stop's
 * forfeiting seats are its equivocators; both equivocators is a tie) and a win for the other. 3 or more: a timeout
 * is a rated last place for the stalled seats at that head, the others by standings there; a resign is an unrated
 * abort recording the resigner (D052); a stop scores by `stopScore` (`abort`: an unrated abort recording E;
 * `timeout`: the equivocators last, the others by standings at P, or 0 when P is before play; `last`: the
 * equivocators rated last, the game unrated for the others). A natural end is scored by standings at its head; a
 * cancel counts for nothing.
 */
function scores(
  s: Scope,
  end: string,
  head: string,
  forfeit: readonly Seat[],
  E: Seat | null,
  beforePlay: boolean,
): string[] {
  return Array.from({ length: s.seats }, (_, x) => {
    if (end === 'over') return `standing@${head}`;
    if (end === 'live') return `live@${head}`;
    if (end === 'cancel') return 'cancel';
    const lost = forfeit.includes(x);
    if (s.seats === 2) {
      if (end === 'stop' && forfeit.length === s.seats) return 'tie';
      return lost ? 'last' : 'first';
    }
    if (end === 'claim') return lost ? 'last' : `standing@${head}`;
    if (end === 'resign') return lost ? 'unrated-recorded' : 'unrated';
    const mode = s.stopScore ?? 'abort';
    if (mode === 'timeout') return lost ? 'last' : beforePlay ? 'zero' : `standing@${head}`;
    if (mode === 'last') return lost ? 'last' : 'unrated';
    return x === E ? 'unrated-recorded' : 'unrated';
  });
}

/** Designs in which a stop is scored as the equivocator's forfeit (round 2 and candidate (d)). */
function forfeitStop(d: Design): boolean {
  return d === 'fgr2' || d === 'stop' || d === 'stop3';
}

function isFgr(d: Design): boolean {
  return d === 'fgr' || d === 'fgr2';
}

/**
 * Attestations reach every honest client at once. Sound: an attestation only matters at a fork (the cutoff), where
 * a client is stopped or its result stood, and either way makes no move, share or claim; so no honest decision
 * depends on when one arrives, and the adversary sees every event at once anyway.
 */
function everyone(st: State, id: string): State {
  return {
    ...st,
    clients: st.clients.map((c) => (c.has.has(id) ? c : { ...c, has: new Set(c.has).add(id) })),
  };
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
  for (const id of path) {
    const m = get(id);
    for (let n = 0; n < DRAWS[m.kind]; n++) {
      const v = viewersOf(s.mode, m.seat, s.seats);
      // A roll's point is bound to the move that requests it: a rival move rolls a different value.
      if (s.mode === 'roll') out.push({ pos: rollPos(`${id}#${n}`), v, move: id });
      else out.push({ pos: pos++, v, move: id });
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
  readonly status: 'live' | 'over' | 'stop' | 'stood';
  /** `stop3`: the attested result that stood at a fork (the game's result on every client). */
  readonly standing: Standing | null;
  readonly stopSeat: Seat | null;
  /** `stop3`: the stop cancels the game (PROTOCOL-v2 §5.6). */
  readonly cancelled: boolean;
  /** `stop3`: the walk up to the fork holds no game action (P before play). */
  readonly beforePlay: boolean;
  /** `stop3`: some held game action lies on a valid line. */
  readonly anyPlay: boolean;
  /** `stop3`: the equivocators the design records (every one of the global scan, or E alone with `topmostOnly`). */
  readonly equivocators: readonly Seat[];
  /** `stop3`: every seat with two valid-looking moves on one prev whose line is valid (review M1), whatever the design. */
  readonly allEquivocators: readonly Seat[];
  /** Seats that vouched for two sides of a fork on the walk (fork-stop designs). */
  readonly flagged: ReadonlySet<Seat>;
  /** A fork (a held rival) exists at some prev on the walk. */
  readonly forked: boolean;
  /** The stop is at a fork with a side that had already reached the end (`stop`): a finished game voided. */
  readonly endedVoided: boolean;
  readonly pending: Seat;
  /** A blocking reveal or roll at the head lacks some seat's share (no decision is pending). */
  readonly waiting: boolean;
  /** The stalled seats at the head: the pending seat, or every seat missing a share of a blocking reveal. */
  readonly stalled: readonly Seat[];
  readonly stalledAt: (head: string) => Seat[];
  /** Seats whose Secret reveal is held (a Resign carries its seat's secret). */
  readonly secrets: ReadonlySet<Seat>;
  /** The scoring position S of a resign by k naming `head` (PROTOCOL-v2 §8.3). */
  readonly sOf: (head: string, k: Seat) => string;
  /** Whether a resign by k naming `head` cancels (v1 §8.3 with S of PROTOCOL-v2 §8.3). */
  readonly resignCancels: (head: string, k: Seat) => boolean;
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

interface Standing {
  readonly kind: 'over' | 'claim' | 'resign';
  readonly head: string;
  readonly forfeit: readonly Seat[];
}

/** Whether moves `a` and `b` conflict: neither is an ancestor of the other. */
function conflicts(v: View, a: string, b: string): boolean {
  return !(v.ancestor(a, b) || v.ancestor(b, a));
}

function computeView(s: Scope, evs: readonly Ev[], me: Seat): View {
  const e3 = s.design === 'stop3';
  const T = totalOf(s);
  const setup = setupOf(s);
  const byId = new Map<string, MoveEv>();
  for (const e of evs) if (e.t === 'move') byId.set(e.id, e);
  // Linked moves: the prev chain reaches the root through held moves.
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
  const depthOf = (id: string): number => (id === ROOT ? 0 : (byId.get(id)?.depth ?? 0));
  const get = (id: string) => byId.get(id) as MoveEv;
  const pathOf = (id: string): string[] => (id === ROOT ? [] : pathTo(id, get));
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
  // Public shares held (the blocking modes), by position.
  const pub = new Map<number, Set<Seat>>();
  const secrets = new Set<Seat>();
  for (const e of evs) {
    if (e.t === 'share' && e.to === null) addTo(pub, e.pos, e.seat);
    if (e.t === 'move')
      for (const r of e.rel) if (r.endsWith(':*')) addTo(pub, Number(r.split(':')[0]), e.seat);
    if (e.t === 'secret' || e.t === 'resign') secrets.add(e.seat);
  }
  /** The seats missing a share of the blocking reveal or roll that move `h` requested; [] when none. */
  const missingMemo = new Map<string, Seat[]>();
  const missingAt = (h: string): Seat[] => {
    if (!blocking(s) || h === ROOT) return [];
    const known = missingMemo.get(h);
    if (known !== undefined) return known;
    const m = byId.get(h);
    let out: Seat[] = [];
    if (m !== undefined && DRAWS[m.kind] > 0) {
      const mine = grantsOn(s, pathOf(h), get).filter((g) => g.move === h);
      const miss: Seat[] = [];
      for (const g of mine) for (let k = 0; k < s.seats; k++) if (!pub.get(g.pos)?.has(k)) miss.push(k);
      out = ascending(miss);
    }
    missingMemo.set(h, out);
    return out;
  };
  /** C(h) (PROTOCOL-v2 §5.1): the valid-looking successors; none while a blocking reveal at h waits for shares. */
  const cands = (h: string): MoveEv[] => (missingAt(h).length > 0 ? [] : (kids.get(h) ?? []));
  /** A line is valid when every move on it is valid at its prev: no junk step, no move before its reveal. */
  const validMemo = new Map<string, boolean>();
  const validLine = (id: string): boolean => {
    if (id === ROOT) return true;
    const known = validMemo.get(id);
    if (known !== undefined) return known;
    const m = linked.get(id);
    const ok = m !== undefined && m.kind !== 'junk' && missingAt(m.prev).length === 0 && validLine(m.prev);
    validMemo.set(id, ok);
    return ok;
  };
  const stalledAt = (h: string): Seat[] => {
    const miss = missingAt(h);
    return miss.length > 0 ? miss : [pendingAt(s, depthOf(h))];
  };
  /** S (PROTOCOL-v2 §8.3, v1 §8.3 steps 2–3): along `head`'s line to the first fork past it. */
  const sOf = (head: string, k: Seat): string => {
    const line: MoveEv[] = [];
    let at = head;
    for (;;) {
      if (depthOf(at) >= T) break;
      const ks = cands(at);
      if (ks.length !== 1 || (ks[0] as MoveEv).kind === 'junk') break;
      line.push(ks[0] as MoveEv);
      at = (ks[0] as MoveEv).id;
    }
    let i = -1;
    line.forEach((m, j) => {
      if (m.seat === k && m.depth > setup) i = j;
    });
    const s0 = i < 0 ? head : (line[i] as MoveEv).id;
    const next = pendingAt(s, depthOf(s0));
    if (next !== k) while (i + 1 < line.length && (line[i + 1] as MoveEv).seat === next) i++;
    return i < 0 ? head : (line[i] as MoveEv).id;
  };
  const resignCancels = (head: string, k: Seat): boolean =>
    depthOf(head) <= setup && !pathOf(sOf(head, k)).some((id) => get(id).seat === k && get(id).depth > setup);

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
  let endedVoided = false;
  let standing: Standing | null = null;
  let cancelled = false;
  let beforePlay = false;
  // Round 3's cutoff (`stop3`): the attested results, and the Shares events with their anchors (the releaser's head).
  const attests = new Map<string, { r: Standing; seats: Set<Seat> }>();
  for (const e of evs) {
    if (e.t !== 'attest') continue;
    const key = standingKey(e);
    const g = attests.get(key) ?? {
      r: { kind: e.kind, head: e.head, forfeit: e.forfeit },
      seats: new Set<Seat>(),
    };
    g.seats.add(e.seat);
    attests.set(key, g);
  }
  const anchors = evs.filter((e): e is ShareEv => e.t === 'share');
  const attestEvs = evs.filter((e): e is AttestEv => e.t === 'attest');
  /** Whether result `r` is valid from the held events (PROTOCOL-v2 §5.3). */
  const valid = (r: Standing): boolean => {
    if (r.head !== ROOT && (!linked.has(r.head) || !validLine(r.head))) return false;
    const depth = depthOf(r.head);
    if (r.kind === 'over') return depth >= T && r.forfeit.length === 0;
    if (depth >= T) return false;
    if (r.kind === 'claim')
      // No clock and no stall check: rule (a) asks every forfeiting seat to attest it.
      return (
        r.forfeit.length > 0 &&
        depth > setup &&
        evs.some((e) => e.t === 'claim' && e.head === r.head && !r.forfeit.includes(e.seat))
      );
    if (r.forfeit.length !== 1) return false;
    const k = r.forfeit[0] as Seat;
    // `counted` (the round-3 model): a resign counts at a head of the client's choosing on or past the head it names.
    if (s.resignAt === 'counted')
      return evs.some((e) => e.t === 'resign' && e.seat === k && ancestor(e.head, r.head));
    // `named`: the identity is the head the resign names, and it must not cancel.
    return (
      evs.some((e) => e.t === 'resign' && e.seat === k && e.head === r.head) && !resignCancels(r.head, k)
    );
  };
  /**
   * The one result that stands at the fork after `at` (successors `ks`, signed by E): a valid result on the walk's
   * path or on one of the sides, attested by every seat but E, with no move, anchored Shares event or attestation by
   * a seat but E off its line (PROTOCOL-v2 §5.4; an unresolved anchor is off every line). Several, or none: null
   * (the fork stops the game).
   */
  const standingAt = (at: string, ks: readonly MoveEv[], E: Seat): Standing | null => {
    const found = new Set<string>();
    let one: Standing | null = null;
    for (const [key, g] of attests) {
      const R = g.r;
      if (!valid(R)) continue;
      if (!ancestor(R.head, at) && !ks.some((k) => ancestor(k.id, R.head))) continue;
      let all = true;
      for (let x = 0; x < s.seats; x++)
        if (x !== E && !g.seats.has(x) && !(s.exemptLoser === true && R.forfeit.includes(x))) all = false;
      if (!all) continue;
      // Off the result's line: neither on its path nor past its head (another side of a fork). Events past the head
      // only concern values granted after the result's end (post-end); `cutoff: 'path'` (a regression) counts them.
      const past = (head: string): boolean => s.cutoff !== 'path' && ancestor(R.head, head);
      const off =
        s.cutoff !== 'attest' &&
        ([...byId.values()].some((m) => m.seat !== E && !ancestor(m.id, R.head) && !past(m.prev)) ||
          anchors.some((a) => a.seat !== E && !ancestor(a.head, R.head) && !past(a.head)) ||
          (s.cutoff !== 'path' &&
            attestEvs.some((a) => a.seat !== E && !ancestor(a.head, R.head) && !past(a.head))));
      if (off) continue;
      found.add(key);
      one = R;
    }
    return found.size === 1 ? one : null;
  };
  for (;;) {
    if (path.length >= T) {
      status = 'over';
      break;
    }
    const ks = e3 ? cands(at) : (kids.get(at) ?? []);
    if (ks.length === 0) break;
    if (ks.length >= 2) forked = true;
    let next: MoveEv;
    if (e3) {
      if (ks.length === 1) {
        // A lone successor that is not valid (a setup step whose proof fails) ends the walk at h.
        if ((ks[0] as MoveEv).kind === 'junk') break;
        next = ks[0] as MoveEv;
      } else {
        // Round 3: a result that stands (attested by every seat but E, nothing signed off its line by a seat but E)
        // is the result; any other fork stops the game here, as E's forfeit, or cancels it (PROTOCOL-v2 §5.6).
        forked = true;
        const E = pendingAt(s, path.length);
        stopSeat = E;
        const R = standingAt(at, ks, E);
        if (R !== null) {
          path.length = 0;
          path.push(...pathOf(R.head));
          status = 'stood';
          standing = R;
          break;
        }
        status = 'stop';
        endedVoided = ks.some((k) => path.length + 1 + longest(k.id) >= T);
        beforePlay = path.length <= setup;
        // H1: cancelled only when no game action on a valid line is held at or past P; the `position` regression
        // cancels by where P is.
        const fork = at;
        const played = [...linked.values()].some(
          (m) => m.depth > setup && ancestor(fork, m.id) && validLine(m.id),
        );
        cancelled = s.cancelRule === 'position' ? beforePlay : !played;
        break;
      }
    } else if (s.design === 'stop') {
      if (ks.length === 1) next = ks[0] as MoveEv;
      else {
        // Candidate (e): any held fork stops the game here, the equivocator's forfeit. With `overStands`, a side
        // that already reached the end stands instead (over first, then length, then lowest id, as v1).
        const done = ks.filter((k) => path.length + 1 + longest(k.id) >= T);
        if (s.overStands === true && done.length > 0) next = bestOf(done);
        else {
          status = 'stop';
          stopSeat = pendingAt(s, path.length);
          endedVoided = done.length > 0;
          break;
        }
      }
    } else if (s.design === 'fs' || isFgr(s.design)) {
      if (ks.length === 1) next = ks[0] as MoveEv;
      else {
        forked = true;
        const pend = pendingAt(s, path.length);
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
      let cands2 = ks.filter((k) => containsAll(k.id, finals, at));
      if (s.design === 'ack-lock') {
        // Lock: keep every move I acked, unless a move conflicting with it is final.
        const locks = myAcks.filter((a) => !finals.some((f) => !(ancestor(a, f) || ancestor(f, a))));
        const locked = cands2.filter((k) => containsAll(k.id, locks, at));
        if (locked.length > 0) cands2 = locked;
      }
      next = bestOf(cands2.length > 0 ? cands2 : ks);
    } else {
      next = bestOf(ks);
    }
    path.push(next.id);
    at = next.id;
  }
  // M1 (PROTOCOL-v2 §5.2): every seat with two valid-looking moves on one prev whose line is valid, anywhere.
  const allEquivocators: Seat[] = [];
  if (e3 && forked) {
    const eq = new Set<Seat>();
    for (const q of [ROOT, ...linked.keys()]) {
      if (!validLine(q)) continue;
      const bySigner = new Map<Seat, number>();
      for (const m of cands(q)) bySigner.set(m.seat, (bySigner.get(m.seat) ?? 0) + 1);
      for (const [seat, n] of bySigner) if (n >= 2) eq.add(seat);
    }
    allEquivocators.push(...ascending(eq));
  }
  const equivocators: Seat[] =
    stopSeat === null
      ? []
      : e3 && s.topmostOnly !== true
        ? ascending([...allEquivocators, stopSeat])
        : [stopSeat];
  const head = path.at(-1) ?? ROOT;
  const pathMoves = path.map((id) => byId.get(id) as MoveEv);
  const grantsTo = (h: string): Grant[] => grantsOn(s, pathOf(h), get);
  const stalled = status === 'live' ? stalledAt(head) : [];
  return {
    path,
    head,
    status,
    stopSeat,
    cancelled,
    beforePlay,
    anyPlay: [...linked.values()].some((m) => m.depth > setup && validLine(m.id)),
    equivocators,
    allEquivocators,
    flagged: s.design === 'fgr2' ? flagged : new Set<Seat>(),
    forked,
    endedVoided,
    standing,
    pending: pendingAt(s, path.length),
    waiting: status === 'live' && missingAt(head).length > 0,
    stalled,
    stalledAt,
    secrets,
    sOf,
    resignCancels,
    grants: grantsOn(s, path, get),
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

/* ------------------------------------------------------------------------------- direct folds (tests) */

/** An event built by hand for `foldView` (tests and traces). */
export type ModelEvent = Ev;

/** A move by `seat` on `prev` (null for the root); its id names its path, as in the explorer's traces. */
export function modelMove(prev: ModelEvent | null, seat: Seat, kind: Kind, v = 0, cheat = false): ModelEvent {
  const p = prev === null ? null : (prev as MoveEv);
  return {
    t: 'move',
    id: moveId(p?.id ?? ROOT, seat, kind, v) + (cheat ? 'x' : ''),
    seat,
    prev: p?.id ?? ROOT,
    depth: (p?.depth ?? 0) + 1,
    kind,
    v,
    rel: [],
    kc: [],
    honest: false,
    ...(cheat ? { cheat: true } : {}),
  };
}

/** What one client holding exactly `events` computes: its walk, the fork, the cutoff and a stop's scores. */
export function foldView(
  scope: Scope,
  events: readonly ModelEvent[],
  seat: Seat,
): {
  status: View['status'];
  head: string;
  stopSeat: Seat | null;
  cancelled: boolean;
  equivocators: readonly Seat[];
  standing: Standing | null;
  scores: string[];
} {
  const v = computeView(scope, events, seat);
  const end =
    v.status === 'stop'
      ? v.cancelled
        ? 'cancel'
        : 'stop'
      : v.status === 'stood'
        ? (v.standing?.kind ?? 'over')
        : v.status;
  const head = v.status === 'stood' ? (v.standing?.head ?? v.head) : v.head;
  const forfeit = v.status === 'stop' ? v.equivocators : (v.standing?.forfeit ?? []);
  return {
    status: v.status,
    head,
    stopSeat: v.stopSeat,
    cancelled: v.cancelled,
    equivocators: v.equivocators,
    standing: v.standing,
    scores: scores(scope, end, head, forfeit, v.stopSeat, v.beforePlay),
  };
}
