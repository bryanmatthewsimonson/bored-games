/**
 * node packages/client/scripts/golden-v1.ts [--only name,name] [--list]
 *
 * Records the v1 golden corpus (protocol v2 build plan, T1 and D-A) into packages/client/test/golden-v1/: one JSON
 * fixture per event set, holding the signed events and the digest of every fold of them, in three arrival orders,
 * by fresh v1 `GameSession`s (see test/golden-v1/fold.ts). The event sets are whole v1 games from `simulateGame`
 * (Chain Reaction, Chess, Bank 0.1.0 and Luster, honest and with the test adversaries) and the hand-built sets of
 * stale-rival.test.ts and shuffle-fork-deal.test.ts. Everything comes from seeds and simulated clocks.
 *
 * The corpus is recorded once, on the v2 branch's base, and never regenerated during the v2 build: the fixtures
 * are what the frozen v1 fold must keep producing. Run it again only to add a new event set (`--only`), and check
 * that no existing fixture changed.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { bank } from '@bored-games/bank';
import { type ChainReactionRules, chainReaction } from '@bored-games/chain-reaction';
import { chess } from '@bored-games/chess';
import { canonicalJson, createRng, type Rng } from '@bored-games/game-kit';
import { luster } from '@bored-games/luster';
import {
  finalizeEvent,
  type Hex,
  KIND,
  moveTemplate,
  type NostrEvent,
  parseRoot,
  timeoutTemplate,
} from '@bored-games/protocol';
import { TARGETS } from '../../../tools/fuzz/src/index.ts';
import { MemoryRelay } from '../src/memory-relay.ts';
import { GameSession } from '../src/session.ts';
import { type Adversary, type SimPolicy, type SimReport, simulateGame } from '../src/sim.ts';
import type { Identity } from '../src/types.ts';
import {
  type AdversaryName,
  adversary as makeAdversary,
  quickPolicy,
  unexpected,
} from '../test/adversaries.ts';
import {
  arrivalOrders,
  type ClientMode,
  clientsFor,
  foldClient,
  GOLDEN_FORMAT,
  GOLDEN_MODULES,
  GOLDEN_NAMES,
  type GoldenFixture,
  goldenIdentity,
  goldenSession,
  labelOf,
  serializeFixture,
} from '../test/golden-v1/fold.ts';
import {
  catchUp,
  deliver,
  LATE,
  makeGame,
  makeModuleGame,
  newSession,
  seededRandom,
  shuffleAll,
  statuses,
  T0,
  type TestGame,
  trust,
} from '../test/helpers.ts';

const OUT = new URL('../test/golden-v1/', import.meta.url);

/* ------------------------------------------------------------------------------------------ capture */

// The sim keeps its relay and its players' keys to itself; the corpus needs both. Record every event the relay
// stores, and every identity a session is created with (test tooling only; nothing in src changes).
let captured: NostrEvent[] = [];
let identities = new Map<number, Identity>();
const relayPublish = MemoryRelay.prototype.publish;
MemoryRelay.prototype.publish = function publish(this: MemoryRelay, ev: NostrEvent): boolean {
  const ok = relayPublish.call(this, ev);
  if (ok) captured.push(ev);
  return ok;
};
const createSession = GameSession.create.bind(GameSession);
GameSession.create = (input) => {
  if (input.me !== null && !identities.has(input.me.seat)) identities.set(input.me.seat, input.me);
  return createSession(input);
};

interface EventSet {
  table: NostrEvent;
  joins: NostrEvent[];
  root: NostrEvent;
  identities: Identity[];
  events: NostrEvent[];
}

/* -------------------------------------------------------------------------------------------- sims */

// Small Chain Reaction games: a 3-tile hand and an end at a 3-tile chain keep a whole game near 25 moves, so that
// every fold of it costs about a second and a half (shares are verified, the end audit decrypts the deck).
const SMALL_CR: ChainReactionRules = { ...chainReaction.defaultRules(), endSize: 3, handSize: 3 };

const fuzzPolicy = (game: string): SimPolicy => {
  const p = TARGETS[game]?.policies[0];
  if (p === undefined) throw new Error(`no fuzz policy for ${game}`);
  return (state, seat, legal, rng) => p.choose(state, seat, legal, rng);
};
/** Any legal action, draw offers and acceptances included, so a Chess game ends soon (deckless.test.ts). */
const anyLegal: SimPolicy = (_state, _seat, legal, rng: Rng) => rng.pick(legal);

interface SimSpec {
  game: string;
  seats: number;
  rules?: unknown;
  policy: SimPolicy;
  adversary?: { name: AdversaryName; seat: number; at?: number };
  fullSync?: boolean;
  /** Extra conditions on the report, besides no failures and no departure from the adversary's expected result. */
  want?: (r: SimReport) => boolean;
}

/**
 * Run `spec` with seed `<base>#0`, `<base>#1`, … until a game passes every check (the search is deterministic), and
 * return its events.
 */
function simSet(base: string, spec: SimSpec): { set: EventSet; seed: string; report: SimReport } {
  for (let i = 0; i < 40; i++) {
    const seed = `${base}#${i}`;
    captured = [];
    identities = new Map();
    const adv: Adversary | undefined =
      spec.adversary === undefined
        ? undefined
        : makeAdversary(
            spec.adversary.name,
            spec.adversary.seat,
            spec.seats,
            spec.adversary.at ?? spec.seats,
          );
    const report = simulateGame({
      seats: spec.seats,
      seed,
      modules: GOLDEN_MODULES,
      game: spec.game,
      policy: spec.policy,
      ...(spec.rules === undefined ? {} : { rules: spec.rules }),
      ...(adv === undefined ? {} : { adversary: adv }),
      ...(spec.fullSync === true ? { fullSync: true } : {}),
    });
    const problems = [...report.failures, ...unexpected(report, spec.adversary?.seat ?? 0)];
    if (problems.length > 0 || (spec.want !== undefined && !spec.want(report))) {
      console.log(`  ${seed}: skipped (${problems.join('; ') || 'not the wanted game'})`);
      continue;
    }
    const table = captured.find((e) => e.kind === KIND.table) as NostrEvent;
    const joins = captured.filter((e) => e.kind === KIND.join);
    const root = captured.find((e) => e.kind === KIND.root) as NostrEvent;
    const events = captured.filter((e) => e !== table && e !== root && e.kind !== KIND.join);
    const ids = [...identities.values()].sort((a, b) => a.seat - b.seat);
    if (ids.length !== spec.seats) throw new Error(`${seed}: captured ${ids.length} identities`);
    return { set: { table, joins, root, identities: ids, events }, seed, report };
  }
  throw new Error(`${base}: no seed passed`);
}

const simAbout = (what: string, seed: string, r: SimReport): string =>
  `${what}. simulateGame seed ${seed}: ${r.seats} seats, ${r.phase}, ${r.actions} game actions, ${r.events} events.`;

/* ------------------------------------------------------------------------- stale rival and freeze */

type Action = { type: string; actor: number; declareEnd?: boolean };
const isDeclare = (a: unknown): boolean => (a as Action).declareEnd === true;

/**
 * The game of stale-rival.test.ts (D056), on small rules: three seats play to a declared end, passing on the first
 * chance to declare for a few moves. Returns the log and the positions the rivals are built at.
 */
function staleRivalGame() {
  const game = makeGame(3, 'golden-v1-stale-rival', SMALL_CR);
  const log: NostrEvent[] = [];
  const players = [0, 1, 2].map((seat) => newSession(game, seat));
  const spectator = newSession(game, null);
  const all = [...players, spectator];
  const publish = (ev: NostrEvent): void => {
    const results = statuses(deliver(all, [ev]));
    if (results.some((r) => r !== 'accepted')) throw new Error(`event ${log.length}: ${results.join(', ')}`);
    log.push(ev);
  };
  log.push(...shuffleAll(game, players, [spectator]));
  for (const [k, s] of players.entries()) publish(s.buildDeal(game.rnd, T0 + 200 + k));
  const rng = createRng('golden-v1-stale-rival-policy');
  let t = T0 + 1000;
  let after = -1;
  let moves = 0;
  let mid: NostrEvent[] | undefined;
  let beforeDeclare: NostrEvent[] | undefined;
  let beforeChoice: NostrEvent[] | undefined;
  while (spectator.view().phase === 'play') {
    if (moves > 600) throw new Error('the game does not end');
    const pending = spectator.view().pending as { seat: number };
    const s = players[pending.seat] as GameSession;
    const legal = s.legalActions();
    const declares = legal.filter(isDeclare);
    const others = legal.filter((a) => !isDeclare(a));
    if (beforeChoice === undefined && moves > 0 && others.length >= 2) beforeChoice = [...log];
    if (beforeDeclare === undefined && declares.length > 0) {
      beforeDeclare = [...log];
      after = moves;
    }
    const playOn = after < 0 || moves < after + 4;
    if (!playOn && mid === undefined) mid = [...log];
    const action =
      !playOn && declares.length > 0 ? declares[0] : rng.pick(others.length > 0 ? others : legal);
    publish(s.buildAction(action, game.rnd, t++));
    moves++;
  }
  for (const s of players) publish(s.buildSecret(game.rnd, t++));
  for (const [k, s] of players.entries())
    publish(finalizeEvent(s.attestTemplate(t++), game.npubSks[k] as Uint8Array, game.rnd));
  if (mid === undefined || beforeDeclare === undefined || beforeChoice === undefined)
    throw new Error('the stale-rival game never reached its positions');

  /** A rival to the move that followed `prefix`, by the same seat, built by that seat's session there. */
  const rivalAt = (
    prefix: readonly NostrEvent[],
    pick: (legal: readonly unknown[], played: string) => unknown,
  ) => {
    const probe = catchUp(game, null, prefix);
    const seat = (probe.view().pending as { seat: number }).seat;
    const s = catchUp(game, seat, prefix);
    const played = canonicalJson(
      (JSON.parse((log[prefix.length] as NostrEvent).content) as { action: unknown }).action,
    );
    return { seat, ev: s.buildAction(pick(s.legalActions(), played), game.rnd, LATE) };
  };
  const ordinary = rivalAt(beforeChoice, (legal, played) =>
    legal.find((a) => !isDeclare(a) && canonicalJson(a) !== played),
  );
  const ending = rivalAt(beforeDeclare, (legal) => legal.find(isDeclare));
  const endingSecrets = [0, 1, 2].map((k) =>
    catchUp(game, k, [...beforeDeclare, ending.ev]).buildSecret(game.rnd, LATE + 1 + k),
  );
  const lobby = { table: game.table, joins: game.joins, root: game.root, identities: game.ids };
  return { lobby, log, mid, ordinary, ending, endingSecrets };
}

/* ------------------------------------------------------------------------------- shuffle fork, deal */

/** The F7 trace of shuffle-fork-deal.test.ts (D056): rival final shuffle steps, a deal on each, then a claim. */
function shuffleForkDeal(): EventSet {
  const game = makeGame(3, 'golden-v1-shuffle-fork-deal');
  const E = 2;
  const h0 = newSession(game, 0);
  const s0 = h0.buildShuffle(game.rnd, T0 + 100);
  const h1 = newSession(game, 1);
  trust([h1], [s0]);
  deliver([h1], [s0]);
  const s1 = h1.buildShuffle(game.rnd, T0 + 101);
  const e = newSession(game, E);
  trust([e], [s0, s1]);
  deliver([e], [s0, s1]);
  const a = e.buildShuffle(game.rnd, T0 + 102);
  const b = e.buildShuffle(game.rnd, T0 + 103);
  const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
  const steps = [s0, s1, lo, hi];
  const on = (seat: number, deck: NostrEvent): GameSession => {
    const s = newSession(game, seat);
    trust([s], steps);
    deliver([s], [s0, s1, deck]);
    return s;
  };
  const eLo = on(E, lo).buildDeal(game.rnd, T0 + 104);
  const eHi = on(E, hi).buildDeal(game.rnd, T0 + 105);
  const d0 = on(0, lo).buildDeal(game.rnd, T0 + 200);
  const s1Hi = on(1, hi);
  const d1 = s1Hi.buildDeal(game.rnd, T0 + 201);
  const all = [d1, d0, lo, hi, eLo, eHi];
  deliver([s1Hi], all);
  const claim = s1Hi.buildTimeout(E, game.rnd, LATE);
  return {
    table: game.table,
    joins: game.joins,
    root: game.root,
    identities: game.ids,
    events: [s0, s1, lo, hi, d0, d1, eLo, eHi, claim],
  };
}

/* ---------------------------------------------------------------------------- noise and the clock */

type Seat = { seat: number };

/** Three honest Chess plies (a plain move each, the first legal one), every one delivered to both seats. */
function chessOpening(game: TestGame): { players: GameSession[]; moves: NostrEvent[] } {
  const players = [0, 1].map((seat) => newSession(game, seat));
  const moves: NostrEvent[] = [];
  for (let k = 0; k < 3; k++) {
    const seat = ((players[0] as GameSession).view().pending as Seat).seat;
    const s = players[seat] as GameSession;
    const legal = s.legalActions() as readonly { type: string; offerDraw?: true }[];
    const action = legal.find((a) => a.type === 'move' && a.offerDraw !== true) ?? legal[0];
    const ev = s.buildAction(action, game.rnd, T0 + 100 * (k + 1));
    deliver(players, [ev]);
    moves.push(ev);
  }
  return { players, moves };
}

/** A Timeout claim built raw (the builder refuses an early one): `by` claims against `seat` on `head` at `at`. */
function rawClaim(game: TestGame, by: number, seat: number, head: Hex, at: number): NostrEvent {
  const sk = (game.ids[by] as Identity).sessionSk;
  return finalizeEvent(timeoutTemplate({ rootId: game.rootId, headId: head, seat }, at), sk, game.rnd);
}

/**
 * Chess with noise: three plies, then events every client must refuse, each for its own reason (a broken id, a
 * broken signature, another game's move, a foreign kind, a signer with no seat, a move without its root tag, a
 * Join, junk, a move by the seat not to move, an illegal move, and claims against oneself, against no seat, on an
 * old head, and by the stalled seat), then an early claim by the seat not to move. The fixture's ticks reach the
 * deadline one second short, then exactly: the claim is accepted only at the second.
 */
function chessNoise(): { set: EventSet; ticks: number[] } {
  const game = makeModuleGame(chess, 2, 'golden-v1-chess-noise');
  const { players, moves } = chessOpening(game);
  const [m1, , m3] = moves as [NostrEvent, NostrEvent, NostrEvent];
  const p = ((players[0] as GameSession).view().pending as Seat).seat;
  const q = 1 - p;
  let t = m3.created_at + 100;
  const next = (): number => {
    t += 100;
    return t;
  };
  const honest = (players[p] as GameSession).buildAction(
    (players[p] as GameSession).legalActions()[0],
    game.rnd,
    next(),
  );
  const resign = (ev: NostrEvent, sk: Uint8Array): NostrEvent =>
    finalizeEvent({ kind: ev.kind, created_at: next(), tags: ev.tags, content: ev.content }, sk, game.rnd);
  const other = makeModuleGame(chess, 2, 'golden-v1-chess-noise-other');
  const otherSeat = newSession(other, (newSession(other, null).view().pending as Seat).seat);
  const foreign = otherSeat.buildAction(otherSeat.legalActions()[0], other.rnd, next());
  const stranger = seededRandom('golden-v1-chess-noise-stranger');
  const strangerSk = Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? 1 : (stranger(1)[0] as number)));
  const action = (a: unknown) => ({ type: 'action' as const, action: a, shares: [], reveals: [] });
  const illegal = moveTemplate(
    {
      rootId: game.rootId,
      prevId: m3.id,
      seq: 4,
      content: action({ type: 'move', actor: p, uci: 'a1a8' }),
    },
    next(),
  );
  const rootless = moveTemplate(
    { rootId: game.rootId, prevId: m3.id, seq: 4, content: action({ type: 'move', actor: p, uci: 'e2e4' }) },
    next(),
  );
  const sk = (seat: number): Uint8Array => (game.ids[seat] as Identity).sessionSk;
  const deadline = parseRoot(game.root).deadline;
  const events: NostrEvent[] = [
    ...moves,
    { ...honest, content: `${honest.content} ` },
    { ...honest, sig: `${honest.sig.slice(0, -1)}${honest.sig.endsWith('0') ? '1' : '0'}` },
    foreign,
    finalizeEvent(
      { kind: 1, created_at: next(), tags: [['e', game.rootId]], content: 'hello' },
      sk(q),
      game.rnd,
    ),
    resign(honest, strangerSk),
    finalizeEvent({ ...rootless, tags: rootless.tags.filter((tag) => tag[3] !== 'root') }, sk(p), game.rnd),
    game.joins[q] as NostrEvent,
    { kind: KIND.move, created_at: next(), content: 'not json' } as unknown as NostrEvent,
    resign(honest, sk(q)),
    finalizeEvent(illegal, sk(p), game.rnd),
    rawClaim(game, q, q, m3.id, next()),
    rawClaim(game, q, 5, m3.id, next()),
    rawClaim(game, q, p, m1.id, next()),
    rawClaim(game, p, q, m3.id, next()),
    rawClaim(game, q, p, m3.id, next()),
  ];
  const at = m3.created_at + deadline;
  return {
    set: { table: game.table, joins: game.joins, root: game.root, identities: game.ids, events },
    ticks: [at - 1, at],
  };
}

/**
 * Chess claims at the deadline: three plies, then two claims by the seat not to move, one created a second before
 * its deadline (early, kept), one created exactly at it (accepted when its first-seen time is its date).
 */
function chessDeadlineClaim(): EventSet {
  const game = makeModuleGame(chess, 2, 'golden-v1-chess-deadline-claim');
  const { players, moves } = chessOpening(game);
  const m3 = moves[2] as NostrEvent;
  const p = ((players[0] as GameSession).view().pending as Seat).seat;
  const at = m3.created_at + parseRoot(game.root).deadline;
  return {
    table: game.table,
    joins: game.joins,
    root: game.root,
    identities: game.ids,
    events: [...moves, rawClaim(game, 1 - p, p, m3.id, at - 1), rawClaim(game, 1 - p, p, m3.id, at)],
  };
}

/* ------------------------------------------------------------------------------------------ record */

/** The shuffle steps whose proofs verify: folded once with none trusted, by a spectator in publication order. */
function verifiedSteps(set: EventSet): Hex[] {
  const s = goldenSession({ ...lobbyOf(set), trusted: [] }, null);
  for (const ev of set.events) s.receive(ev, ev.created_at);
  const checked = (s as unknown as { shuffleChecked: Map<Hex, boolean> }).shuffleChecked;
  return [...checked].filter(([, ok]) => ok).map(([id]) => id);
}

const lobbyOf = (set: EventSet) => ({
  table: set.table,
  joins: set.joins,
  root: set.root,
  identities: set.identities.map(goldenIdentity),
});

function record(
  name: string,
  about: string,
  set: EventSet,
  mode: ClientMode,
  ticks?: number[],
): GoldenFixture {
  const root = parseRoot(set.root);
  const base = {
    ...lobbyOf(set),
    events: set.events,
    game: root.game,
    trusted: verifiedSteps(set),
    ...(ticks === undefined ? {} : { ticks }),
  };
  // The trust shortcut must not change a fold: with and without it, the spectator folds the set the same way.
  const published = set.events.map((_, i) => i);
  const plain = foldClient({ ...base, trusted: [] }, published, null);
  const fast = foldClient(base, published, null);
  if (canonicalJson(plain) !== canonicalJson(fast))
    throw new Error(`${name}: trusting the steps changed the fold`);
  const orders = arrivalOrders(name, set.events.length).map((o, k) => ({
    ...o,
    clients: Object.fromEntries(
      clientsFor(set.identities.length, k, mode).map((seat) => [
        labelOf(seat),
        foldClient(base, o.deliveries, seat),
      ]),
    ),
  }));
  return {
    format: GOLDEN_FORMAT,
    name,
    about,
    game: root.game,
    version: root.version,
    seats: set.identities.length,
    clients: mode,
    table: set.table,
    joins: set.joins,
    root: set.root,
    identities: base.identities,
    events: set.events,
    trusted: base.trusted,
    ...(ticks === undefined ? {} : { ticks }),
    orders,
  };
}

/* ------------------------------------------------------------------------------------------ the list */

const CHEAT = 1;

interface Entry {
  name: string;
  mode: ClientMode;
  build: () => { set: EventSet; about: string; ticks?: number[] };
}

const sim = (name: string, what: string, spec: SimSpec, mode: ClientMode): Entry => ({
  name,
  mode,
  build: () => {
    const { set, seed, report } = simSet(`golden-v1-${name}`, spec);
    return { set, about: simAbout(what, seed, report) };
  },
});

const cr = (adversary?: SimSpec['adversary'], want?: SimSpec['want'], fullSync?: boolean): SimSpec => ({
  game: chainReaction.id,
  seats: 3,
  rules: SMALL_CR,
  policy: quickPolicy,
  ...(adversary === undefined ? {} : { adversary }),
  ...(want === undefined ? {} : { want }),
  ...(fullSync === undefined ? {} : { fullSync }),
});

let staleRival: ReturnType<typeof staleRivalGame> | undefined;
const stale = (): ReturnType<typeof staleRivalGame> => {
  staleRival ??= staleRivalGame();
  return staleRival;
};

const ENTRIES: Entry[] = [
  sim('cr-honest', 'Chain Reaction, honest, small rules (hand 3, end at 3)', cr(), 'rotate'),
  sim(
    'cr-bad-share',
    'Chain Reaction, seat 1 publishes a move with a corrupt share (badShare)',
    cr({ name: 'badShare', seat: CHEAT }),
    'rotate',
  ),
  sim(
    'cr-forged-skip',
    'Chain Reaction, seat 1 forges a skipPlace while holding a playable tile (forgedSkip); the audit fails it',
    cr({ name: 'forgedSkip', seat: CHEAT }),
    'rotate',
  ),
  sim(
    'cr-equivocate',
    'Chain Reaction, seat 1 signs two moves on one prev (equivocate)',
    cr({ name: 'equivocate', seat: CHEAT }),
    'rotate',
  ),
  sim(
    'cr-vanish-early',
    'Chain Reaction, seat 1 vanishes before the first game action (vanish); a claim cancels the game',
    cr({ name: 'vanish', seat: CHEAT }),
    'all',
  ),
  sim(
    'cr-vanish-late',
    'Chain Reaction, seat 1 vanishes in play (vanish); a claim ends the game with it last',
    cr({ name: 'vanish', seat: CHEAT, at: 3 + 6 }, (r) => r.actions > 0),
    'rotate',
  ),
  sim(
    'cr-bad-shuffle',
    'Chain Reaction, seat 1 proves its shuffle step against the wrong input (badShuffle)',
    cr({ name: 'badShuffle', seat: CHEAT }),
    'all',
  ),
  sim(
    'cr-resign-cancel',
    'Chain Reaction, seat 2 resigns at the first decision of the game (resignAt): cancelled, secrets published',
    cr({ name: 'resign', seat: 2, at: 3 }, (r) => r.phase === 'cancelled', true),
    'all',
  ),
  sim(
    'cr-resign-mid',
    'Chain Reaction, seat 1 resigns in play (resignAt, D052): partial audit, unrated',
    cr({ name: 'resign', seat: CHEAT, at: 3 + 4 }, (r) => r.actions > 0 && r.phase === 'done'),
    'rotate',
  ),
  sim(
    'chess-honest',
    'Chess, honest, any legal action (draw offers included)',
    { game: chess.id, seats: 2, policy: anyLegal, want: (r) => r.actions <= 120 },
    'all',
  ),
  sim(
    'chess-equivocate',
    'Chess, seat 1 signs two moves on one prev (equivocate)',
    {
      game: chess.id,
      seats: 2,
      policy: anyLegal,
      adversary: { name: 'equivocate', seat: CHEAT },
      want: (r) => r.actions <= 120,
    },
    'all',
  ),
  sim(
    'chess-vanish',
    'Chess, seat 1 vanishes in play (vanish); a claim ends the game',
    { game: chess.id, seats: 2, policy: anyLegal, adversary: { name: 'vanish', seat: CHEAT, at: 6 } },
    'all',
  ),
  sim(
    'chess-resign',
    'Chess, seat 1 resigns in play (resignAt, the deckless path)',
    { game: chess.id, seats: 2, policy: anyLegal, adversary: { name: 'resign', seat: CHEAT, at: 6 } },
    'all',
  ),
  {
    name: 'chess-noise',
    mode: 'all',
    build: () => {
      const { set, ticks } = chessNoise();
      return {
        set,
        ticks,
        about:
          'Chess, hand-built: three plies, then events to refuse (a broken id and signature, another game, a foreign ' +
          'kind, a seatless signer, a rootless move, a Join, junk, the wrong seat, an illegal move, bad claims), then ' +
          'an early claim; ticks a second before and exactly at the deadline',
      };
    },
  },
  {
    name: 'chess-deadline-claim',
    mode: 'all',
    build: () => ({
      set: chessDeadlineClaim(),
      about:
        'Chess, hand-built: three plies, then two claims by the seat not to move, created a second before and ' +
        'exactly at its deadline',
    }),
  },
  sim(
    'bank-honest-2',
    `Bank ${bank.version}, honest, 2 seats (the v1 dice beacon, contributions as turns)`,
    { game: bank.id, seats: 2, policy: fuzzPolicy(bank.id) },
    'all',
  ),
  sim(
    'bank-honest-4',
    `Bank ${bank.version}, honest, 4 seats`,
    { game: bank.id, seats: 4, policy: fuzzPolicy(bank.id), want: (r) => r.actions <= 200 },
    'rotate',
  ),
  sim(
    'bank-vanish',
    `Bank ${bank.version}, seat 1 vanishes in play (vanish); a claim ends the game`,
    {
      game: bank.id,
      seats: 3,
      policy: fuzzPolicy(bank.id),
      adversary: { name: 'vanish', seat: CHEAT, at: 8 },
    },
    'all',
  ),
  sim(
    'bank-resign',
    `Bank ${bank.version}, seat 1 resigns in play (resignAt), 3 seats: unrated`,
    {
      game: bank.id,
      seats: 3,
      policy: fuzzPolicy(bank.id),
      adversary: { name: 'resign', seat: CHEAT, at: 8 },
      want: (r) => r.phase === 'done',
    },
    'all',
  ),
  sim(
    'luster-honest',
    `Luster ${luster.version}, honest, 2 seats (partitioned decks)`,
    { game: luster.id, seats: 2, policy: fuzzPolicy(luster.id) },
    'rotate',
  ),
  sim(
    'luster-vanish',
    `Luster ${luster.version}, seat 1 vanishes in play (vanish), 3 seats`,
    {
      game: luster.id,
      seats: 3,
      policy: fuzzPolicy(luster.id),
      adversary: { name: 'vanish', seat: CHEAT, at: 20 },
      want: (r) => r.actions > 0,
    },
    'rotate',
  ),
  {
    name: 'cr-stale-rival',
    mode: 'rotate',
    build: () => {
      const g = stale();
      return {
        set: { ...g.lobby, events: [...g.log, g.ordinary.ev, g.ending.ev] },
        about:
          'stale-rival.test.ts (D056): a finished small Chain Reaction game, its secrets and attestations, then two ' +
          'late rivals: an ordinary one where a seat had a choice, and a declared end at the first chance to declare',
      };
    },
  },
  {
    name: 'cr-stale-rival-play',
    mode: 'rotate',
    build: () => {
      const g = stale();
      return {
        set: { ...g.lobby, events: [...g.mid, g.ordinary.ev, g.ending.ev] },
        about:
          'stale-rival.test.ts (D056): the same game while still in play (a few moves past the first chance to ' +
          'declare), with the ordinary rival and the ending rival',
      };
    },
  },
  {
    name: 'cr-freeze',
    mode: 'all',
    build: () => {
      const g = stale();
      return {
        set: { ...g.lobby, events: [...g.mid, g.ending.ev, ...g.endingSecrets] },
        about:
          'stale-rival.test.ts (D056 freeze): the game in play, the ending rival, and every seat’s secret revealed ' +
          'for that end, so that honest secrets freeze it',
      };
    },
  },
  {
    name: 'cr-shuffle-fork-deal',
    mode: 'all',
    build: () => ({
      set: shuffleForkDeal(),
      about:
        'shuffle-fork-deal.test.ts (review F7, D056): seat 2 signs two rival final shuffle steps, seat 0 deals on ' +
        'one and seat 1 on the other, seat 2 on both, then seat 1 claims a timeout against seat 2',
    }),
  },
];

/* ------------------------------------------------------------------------------------------ main */

const { values } = parseArgs({ options: { only: { type: 'string' }, list: { type: 'boolean' } } });
if (values.list === true) {
  for (const e of ENTRIES) console.log(e.name);
  process.exit(0);
}
const names = ENTRIES.map((e) => e.name).sort();
if (canonicalJson(names) !== canonicalJson([...GOLDEN_NAMES].sort()))
  throw new Error('ENTRIES and GOLDEN_NAMES differ');
const only = values.only?.split(',') ?? null;
for (const e of ENTRIES) {
  if (only !== null && !only.includes(e.name)) continue;
  const started = performance.now();
  console.log(`${e.name}…`);
  const { set, about, ticks } = e.build();
  const fx = record(e.name, about, set, e.mode, ticks);
  const text = serializeFixture(fx);
  writeFileSync(new URL(`${e.name}.json`, OUT), text);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`  ${set.events.length} events, ${(text.length / 1024).toFixed(0)} KiB, ${seconds}s`);
}
