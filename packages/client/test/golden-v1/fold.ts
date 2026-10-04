import { createHash } from 'node:crypto';
import { bank } from '@bored-games/bank';
import { chainReaction } from '@bored-games/chain-reaction';
import { chess } from '@bored-games/chess';
import { canonicalJson, createRng, type GameModule } from '@bored-games/game-kit';
import { luster } from '@bored-games/luster';
import type { Hex, NostrEvent } from '@bored-games/protocol';
import { GameSession } from '../../src/session.ts';
import type { Identity, SessionView } from '../../src/types.ts';

/*
 * The v1 golden corpus (protocol v2 build plan, T1 and D-A): signed v1 event sets, each folded by fresh v1
 * `GameSession`s in three arrival orders, with the expected digest of every fold. `scripts/golden-v1.ts` records the
 * event sets and the digests once; `golden-v1.test.ts` folds the stored events again and compares. The event sets
 * are stored, not rebuilt, so that a later change to a builder (hedged share nonces, say) cannot move them: the
 * corpus pins how the frozen v1 fold reads a given set of signed events, nothing else.
 *
 * Everything here is a function of the stored events: each event is received at its own `created_at` (its
 * first-seen time), the root at its own date, and the shuffled order comes from a seed. No timer and no `Date`.
 */

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
type AnyModule = GameModule<any, any, any>;

/**
 * The modules the corpus folds with, by id: the engines v1 games were played with (Chain Reaction 0.3.0, Chess
 * 0.1.0, Bank 0.1.0, Luster 0.2.0). A fixture names its engine version, and `golden-v1.test.ts` checks it is the one
 * here; once Bank 0.2.0 ships (T5), Bank 0.1.0 must still be the engine its fixtures fold with.
 */
export const GOLDEN_MODULES: ReadonlyMap<string, AnyModule> = new Map<string, AnyModule>([
  [chainReaction.id, chainReaction],
  [chess.id, chess],
  [bank.id, bank],
  [luster.id, luster],
]);

/** The format of the fixture files; bump it only with a new corpus, never to regenerate this one. */
export const GOLDEN_FORMAT = 1;

export interface GoldenIdentity {
  seat: number;
  /** The session secret key, hex. */
  sessionSk: Hex;
  /** The deck secret, hex. */
  deckSecret: string;
}

/** One client's fold of one arrival order. */
export interface ClientDigest {
  /** One letter per delivery: `a`ccepted, `s`tored, `d`uplicate, `r`ejected. */
  receipts: string;
  /** The rejections, by delivery index, with their reasons. */
  rejections: [number, string][];
  /** The duty list each time it changed, by delivery index (-1: before the first delivery). */
  duties: [number, string][];
  /** SHA-256 over every step's status and view digest (with the state's hash and the duties). */
  trace: string;
  /** The view once every delivery is in. */
  final: FinalDigest;
}

export interface FinalDigest {
  phase: string;
  head: { id: Hex; seq: number };
  logHash: Hex;
  resultLogHash: Hex;
  outcome: unknown;
  audit: unknown;
  forfeits: number[];
  equivocators: number[];
  attested: number[];
  resigned: number[];
  resignOverridden: number[];
  resignId: Hex | null;
  pending: unknown;
  pendingSince: number;
  /** SHA-256 of the canonical JSON of the session's module state, and of the module's view of it for no seat. */
  stateHash: string | null;
  publicStateHash: string | null;
  /** SHA-256 of the canonical JSON of the module events the view keeps. */
  eventsHash: string;
  waitingFor: number[];
  missingParents: Hex[];
  aheadOfHead: boolean;
  /** For a seat: its timeout target far past every deadline, whether it may resign, and its legal actions' hash. */
  timeoutTarget: number | null;
  canResign: boolean | null;
  legalHash: string | null;
  /** The content of the attestation this client would sign now (`attestTemplate`), or null when none is due. */
  attestation: string | null;
}

export interface GoldenOrder {
  name: 'published' | 'reversed' | 'shuffled';
  /** Indices into `events`, in delivery order; the shuffled order delivers some events twice. */
  deliveries: number[];
  /** By client label (`seat <k>` or `spectator`). */
  clients: Record<string, ClientDigest>;
}

export interface GoldenFixture {
  format: number;
  name: string;
  about: string;
  game: string;
  version: string;
  seats: number;
  /** Which clients fold each order (`clientsFor`). */
  clients: ClientMode;
  table: NostrEvent;
  joins: NostrEvent[];
  root: NostrEvent;
  identities: GoldenIdentity[];
  /** The game's events (moves, shares, claims, resigns, secrets, attestations), in publication order. */
  events: NostrEvent[];
  /**
   * Shuffle steps whose proofs verified when the corpus was recorded. Every fold marks them verified up front (the
   * tests' `trust` shortcut): a proof takes about a second to verify, and verification is pinned by the deck
   * vectors and shuffle-phase.test.ts. A step not listed here (a bad one) is verified in every fold.
   */
  trusted: Hex[];
  /**
   * Local clock readings at which every fold calls `tick` once all its deliveries are in, in order (absent: none).
   * They pin how stored claims are judged against the clock alone.
   */
  ticks?: number[];
  orders: GoldenOrder[];
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'));

export const bytesToHex = (b: Uint8Array): Hex => Buffer.from(b).toString('hex');

export function identityOf(g: GoldenIdentity): Identity {
  return { seat: g.seat, sessionSk: hexToBytes(g.sessionSk), deckSecret: BigInt(`0x${g.deckSecret}`) };
}

export function goldenIdentity(id: Identity): GoldenIdentity {
  return { seat: id.seat, sessionSk: bytesToHex(id.sessionSk), deckSecret: id.deckSecret.toString(16) };
}

/** The three arrival orders of `count` events: as published, reversed, and shuffled with some duplicates. */
export function arrivalOrders(
  name: string,
  count: number,
): { name: GoldenOrder['name']; deliveries: number[] }[] {
  const published = Array.from({ length: count }, (_, i) => i);
  const rng = createRng(`golden-v1:${name}`);
  const shuffled = [...published];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j] as number, shuffled[i] as number];
  }
  // About one event in four arrives a second time, later.
  const withDuplicates = [...shuffled];
  for (const i of shuffled) {
    if (rng.float() < 0.25) {
      const at = withDuplicates.indexOf(i) + 1;
      withDuplicates.splice(at + rng.int(withDuplicates.length - at + 1), 0, i);
    }
  }
  return [
    { name: 'published', deliveries: published },
    { name: 'reversed', deliveries: [...published].reverse() },
    { name: 'shuffled', deliveries: withDuplicates },
  ];
}

/** Which clients fold each arrival order of a fixture. */
export type ClientMode = 'all' | 'rotate';

/**
 * The clients folded in arrival order `k`. `all`: every seat and the spectator. `rotate`, for the games whose folds
 * cost seconds (a deck, or many dice shares): seat 0 and the spectator in the published order, then one seat per
 * order in turn (seat 1 reversed, seat 2 shuffled), so that every seat of a 3-seat game folds once.
 */
export function clientsFor(seats: number, k: number, mode: ClientMode): (number | null)[] {
  if (mode === 'all') return [...Array.from({ length: seats }, (_, i) => i), null];
  return k === 0 ? [0, null] : [k % seats];
}

export const labelOf = (seat: number | null): string => (seat === null ? 'spectator' : `seat ${seat}`);

const LETTER: Record<string, string> = { accepted: 'a', stored: 's', duplicate: 'd', rejected: 'r' };

/** A fresh session of the fixture's game for `seat` (null: a spectator) that trusts the listed shuffle steps. */
export function goldenSession(
  fx: Pick<GoldenFixture, 'table' | 'joins' | 'root' | 'identities' | 'trusted'>,
  seat: number | null,
  modules: ReadonlyMap<string, AnyModule> = GOLDEN_MODULES,
): GameSession {
  const id = seat === null ? undefined : fx.identities.find((g) => g.seat === seat);
  if (seat !== null && id === undefined) throw new Error(`no identity for seat ${seat}`);
  const s = GameSession.create({
    modules,
    table: fx.table,
    joins: fx.joins,
    root: fx.root,
    me: id === undefined ? null : identityOf(id),
    rootSeenAt: fx.root.created_at,
  });
  const checked = (s as unknown as { shuffleChecked: Map<Hex, boolean> }).shuffleChecked;
  for (const step of fx.trusted) checked.set(step, true);
  return s;
}

function stepDigest(v: SessionView): unknown {
  return {
    phase: v.phase,
    head: v.head,
    logHash: v.logHash,
    resultLogHash: v.resultLogHash,
    outcome: v.outcome,
    audit: v.audit,
    forfeits: v.forfeits,
    equivocators: v.equivocators,
    attested: v.attested,
    resigned: v.resigned,
    resignId: v.resignId,
    pending: v.pending,
    pendingSince: v.pendingSince,
    state: v.state === null ? null : sha(canonicalJson(v.state)),
  };
}

function finalDigest(s: GameSession, module: AnyModule, late: number): FinalDigest {
  const v = s.view();
  const seat = v.mySeat;
  let attestation: string | null = null;
  if (s.duties().some((d) => d.kind === 'attest')) attestation = s.attestTemplate(0).content;
  return {
    phase: v.phase,
    head: v.head,
    logHash: v.logHash,
    resultLogHash: v.resultLogHash,
    outcome: v.outcome,
    audit: v.audit,
    forfeits: v.forfeits,
    equivocators: v.equivocators,
    attested: v.attested,
    resigned: v.resigned,
    resignOverridden: v.resignOverridden,
    resignId: v.resignId,
    pending: v.pending,
    pendingSince: v.pendingSince,
    stateHash: v.state === null ? null : sha(canonicalJson(v.state)),
    publicStateHash: v.state === null ? null : sha(canonicalJson(module.view(v.state, null))),
    eventsHash: sha(canonicalJson(v.events)),
    waitingFor: s.waitingFor(),
    missingParents: s.missingParents(),
    aheadOfHead: s.aheadOfHead(),
    timeoutTarget: seat === null ? null : s.timeoutTarget(late),
    canResign: seat === null ? null : s.canResign(),
    legalHash: seat === null ? null : sha(canonicalJson(s.legalActions())),
    attestation,
  };
}

/** Fold the fixture's events in `deliveries` order as `seat` (null: a spectator), each at its own date. */
export function foldClient(
  fx: Pick<
    GoldenFixture,
    'table' | 'joins' | 'root' | 'identities' | 'trusted' | 'events' | 'game' | 'ticks'
  >,
  deliveries: readonly number[],
  seat: number | null,
  modules: ReadonlyMap<string, AnyModule> = GOLDEN_MODULES,
): ClientDigest {
  const module = modules.get(fx.game);
  if (module === undefined) throw new Error(`no module ${fx.game}`);
  const s = goldenSession(fx, seat, modules);
  const trace = createHash('sha256');
  let receipts = '';
  const rejections: [number, string][] = [];
  const duties: [number, string][] = [];
  let last = canonicalJson(s.duties());
  duties.push([-1, last]);
  let latest = fx.root.created_at;
  for (const [i, idx] of deliveries.entries()) {
    const ev = fx.events[idx] as NostrEvent;
    latest = Math.max(latest, ev.created_at);
    const r = s.receive(ev, ev.created_at);
    receipts += LETTER[r.status] ?? '?';
    if (r.status === 'rejected') rejections.push([i, r.reason]);
    const now = canonicalJson(s.duties());
    if (now !== last) {
      duties.push([i, now]);
      last = now;
    }
    trace.update(`${i} ${r.status} ${canonicalJson(stepDigest(s.view()))} ${now}\n`);
  }
  // Then the ticks, numbered after the deliveries.
  for (const [j, at] of (fx.ticks ?? []).entries()) {
    const i = deliveries.length + j;
    latest = Math.max(latest, at);
    s.tick(at);
    const now = canonicalJson(s.duties());
    if (now !== last) {
      duties.push([i, now]);
      last = now;
    }
    trace.update(`${i} tick ${at} ${canonicalJson(stepDigest(s.view()))} ${now}\n`);
  }
  // Far past every deadline: the timeout target a returning client would see.
  const late = latest + 10 * (s.view().deadline + 1);
  return { receipts, rejections, duties, trace: trace.digest('hex'), final: finalDigest(s, module, late) };
}

/**
 * Every fixture of the corpus, by name, in groups: one test file per group, so that vitest folds the groups in
 * parallel. `golden-v1.test.ts` requires exactly these files.
 */
export const GOLDEN_GROUPS = {
  deckless: [
    'chess-honest',
    'chess-equivocate',
    'chess-vanish',
    'chess-resign',
    'bank-honest-2',
    'bank-honest-4',
    'bank-vanish',
    'bank-resign',
  ],
  cr: [
    'cr-honest',
    'cr-bad-share',
    'cr-forged-skip',
    'cr-equivocate',
    'cr-vanish-early',
    'cr-vanish-late',
    'cr-bad-shuffle',
    'cr-resign-cancel',
    'cr-resign-mid',
  ],
  crSets: ['cr-stale-rival', 'cr-stale-rival-play', 'cr-freeze', 'cr-shuffle-fork-deal'],
  luster: ['luster-honest', 'luster-vanish'],
} as const;

export const GOLDEN_NAMES: readonly string[] = Object.values(GOLDEN_GROUPS).flat();

/** A fixture as JSON, one event and one order per line, so that a diff shows which event or fold moved. */
export function serializeFixture(fx: GoldenFixture): string {
  const { events, orders, ...head } = fx;
  return [
    `${JSON.stringify(head, null, 1).slice(0, -2)},`,
    ' "events": [',
    events.map((e) => `  ${JSON.stringify(e)}`).join(',\n'),
    ' ],',
    ' "orders": [',
    orders.map((o) => `  ${JSON.stringify(o)}`).join(',\n'),
    ' ]',
    '}',
    '',
  ].join('\n');
}
