import { type RandomBytes, randomScalar } from '@bored-games/deck';
import { canonicalJson, createRng, type GameModule, type Rng, shuffle } from '@bored-games/game-kit';
import {
  type EventTemplate,
  finalizeEvent,
  getPublicKey,
  type Hex,
  KIND,
  type NostrEvent,
  type ParsedTable,
  parseTable,
  tableTemplate,
} from '@bored-games/protocol';
import { buildJoinTemplate, buildRootTemplate, foldLobby, type GameKeys, newGameKeys } from './lobby.ts';
import { MemoryRelay } from './memory-relay.ts';
import { GameSession } from './session.ts';
import type { Duty, Identity, Phase, SessionAudit, SessionView } from './types.ts';

/*
 * Asynchronous multi-client game simulation over an in-memory relay (Phase 2d Task 7). Every player runs its own
 * `GameSession`, a spectator follows along, and nobody coordinates. Each round one random client syncs at the
 * simulated clock: it queries the relay for every event of the game and receives, in its own shuffled order, the
 * ones it has not received yet (some of them twice) plus a few it has, at random places (`fullSync`: all of them
 * again). Then it does what an honest client does: its duties (shuffle, deal, share, a public dice share,
 * decide through a policy, secret, attest) and a timeout claim when `timeoutTarget` names a seat. Every event
 * it builds goes to a per-client outbox
 * first, keyed by the decision it answers, so it never builds twice for one decision (as the web controller
 * does). The clock then advances by 1 to 3600 s.
 *
 * Timeouts run on local receipt time (D030 Ruling 10): each client passes the simulated clock as `now` when it
 * first receives an event, and remembers that first-seen time, passing it again for every later copy, as the web
 * controller does across reloads.
 *
 * An adversary may take one seat's turns over to cheat; its hooks live with the tests and tools, never here.
 *
 * At the end every client, a vanished one included, syncs everything once more, and the sim checks that all of
 * them agree with the spectator on the phase, the head, the log hash, the outcome, the audit, the forfeits, the
 * equivocators, the attestations and the public state, and that every client accepts every published
 * attestation. Pure: the clock is simulated and all randomness comes from the seed.
 */

/** Picks one of `legal` for `seat`, given the seat's view of the module state. */
export type SimPolicy = (state: unknown, seat: number, legal: readonly unknown[], rng: Rng) => unknown;

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
type Modules = ReadonlyMap<string, GameModule<any, any, any>>;

/** What an adversary's hook sees and may do on its seat's turn, after the seat synced. */
export interface SimTurn {
  seat: number;
  session: GameSession;
  identity: Identity;
  /** The seat's npub secret key, which signs its attestations. */
  npubSk: Uint8Array;
  /** The simulated clock: the `created_at` for events built now. */
  now: number;
  rng: Rng;
  rnd: RandomBytes;
  /** The action the sim's policy picks now, from `session.legalActions()`; null when no decision is mine. */
  choose(): unknown;
  /**
   * Publish `ev` as this seat: it goes to the relay and back into this seat's session. A `cheat` label records
   * the event in the report, with how every other client received it.
   */
  publish(ev: NostrEvent, cheat?: string): void;
}

/** A cheating seat. */
export interface Adversary {
  name: string;
  seat: number;
  /** The modules the cheating seat's own session runs (e.g. a lenient engine); the sim's by default. */
  modules?: Modules;
  /** The seat's turn: `honest` lets the sim do the seat's duties as usual, `pass` ends the turn. */
  turn(t: SimTurn): 'honest' | 'pass';
}

export interface SimOptions {
  seats: number;
  seed: string;
  modules: Modules;
  /** The module id of the game to play. */
  game: string;
  /** The rules; the module's defaults if omitted. */
  rules?: unknown;
  policy: SimPolicy;
  adversary?: Adversary;
  /** The move deadline in seconds, one of the protocol's (default one day). */
  deadline?: number;
  /** Rounds before the sim gives up, which counts as a failure (default 20000). */
  maxRounds?: number;
  /** The clock at the start, in Unix seconds. */
  start?: number;
  /** The chance that a synced event is delivered a second time in the same sync (default 0.25). */
  duplicates?: number;
  /**
   * Each sync re-delivers every event of the game, not only the ones this client has not seen yet. A session
   * answers a known event before parsing it, so this costs little.
   */
  fullSync?: boolean;
  /** Events this client has seen already that a sync delivers again, at random (default 3). */
  replays?: number;
}

/** An event an adversary labelled as a cheat, and the statuses each other client gave it, in order. */
export interface CheatRecord {
  id: Hex;
  label: string;
  seat: number;
  createdAt: number;
  /** By client label (`seat <k>` or `spectator`): the distinct receive statuses, first one first. */
  statuses: Record<string, string[]>;
  /** By client label: the status of the last delivery, in the final full sync. */
  last: Record<string, string>;
}

export interface SimReport {
  seed: string;
  seats: number;
  adversary: string | null;
  /** The spectator's final view. */
  phase: Phase;
  outcome: SessionView['outcome'];
  audit: SessionAudit;
  forfeits: number[];
  equivocators: number[];
  attested: number[];
  /** Moves on the chain (shuffle steps included, if the game has a deck), and game actions among them. */
  moves: number;
  actions: number;
  /** Events on the relay, of every kind. */
  events: number;
  /** Events on the relay by kind (Sealed events, kind 7458, show re-dealt cards, D066). */
  kinds: Record<number, number>;
  rounds: number;
  /** Simulated seconds from the root to the end. */
  duration: number;
  /** Timeout claims published. */
  claims: number;
  cheats: CheatRecord[];
  /** Empty when the game ended and every check held. */
  failures: string[];
}

/** The in-game kinds a client subscribes to (PROTOCOL §9): all but the lobby's (table, join, root) and the backup. */
export const GAME_KINDS: readonly number[] = [
  KIND.move,
  KIND.shares,
  KIND.sealed,
  KIND.timeout,
  KIND.reveal,
  KIND.attest,
  KIND.resign,
];
const RELAYS = ['wss://relay.sim.invalid'];
const DEFAULT_START = 1_700_000_000;
/** The most events one client publishes in one turn; a sound session needs far fewer. */
const MAX_PER_TURN = 32;

/** A byte source drawing from a seeded rng. */
export function rngBytes(rng: Rng): RandomBytes {
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = rng.int(256);
    return out;
  };
}

/** A fresh secret key: 32 big-endian bytes of a random nonzero scalar. */
function secretKey(rnd: RandomBytes): Uint8Array {
  let v = randomScalar(rnd);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

interface Client {
  label: string;
  seat: number | null;
  session: GameSession;
  identity: Identity | null;
  npubSk: Uint8Array | null;
  rng: Rng;
  rnd: RandomBytes;
  /** Built events by slot: `move:<seq>:<prev>`, `deal`, `secret`, `attest:<result>`, `timeout:<seat>:<head>`. */
  outbox: Map<string, NostrEvent>;
  /** Ids of the events this client has received. */
  delivered: Set<Hex>;
  /** When this client first received each event it did not reject (the simulated clock then). */
  seen: Map<Hex, number>;
}

interface Player {
  npubSk: Uint8Array;
  npub: Hex;
  keys: GameKeys;
  rng: Rng;
  rnd: RandomBytes;
}

const TERMINAL: readonly Phase[] = ['done', 'cancelled'];

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Simulate one game from the lobby to its end. A game that goes wrong is reported in `failures`; it throws only
 * for an unknown game or a lobby that cannot start one.
 */
/** How many of `events` there are of each kind. */
function kindCounts(events: readonly NostrEvent[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const ev of events) out[ev.kind] = (out[ev.kind] ?? 0) + 1;
  return out;
}

export function simulateGame(opts: SimOptions): SimReport {
  const rng = createRng(`sim:${opts.seed}`);
  const rnd = rngBytes(rng.fork('bytes'));
  const relay = new MemoryRelay(rng.fork('relay'));
  const module = opts.modules.get(opts.game);
  if (module === undefined) throw new Error(`unknown game ${opts.game}`);
  const rules = opts.rules ?? module.defaultRules();
  const seats = opts.seats;
  const deadline = opts.deadline ?? 86400;
  const maxRounds = opts.maxRounds ?? 20000;
  const dupRate = opts.duplicates ?? 0.25;
  const fullSync = opts.fullSync ?? false;
  const replays = opts.replays ?? 3;
  const adversary = opts.adversary ?? null;
  const failures: string[] = [];
  /** Record a problem once, however often it recurs. */
  const fail = (what: string): void => {
    if (!failures.includes(what)) failures.push(what);
  };
  let clock = opts.start ?? DEFAULT_START;
  const advance = (): void => {
    clock += 1 + rng.int(3600);
  };

  /* ---------------------------------------------------------------------------------------------- lobby */

  const players: Player[] = Array.from({ length: seats }, (_, i) => {
    const prng = rng.fork(`player:${i}`);
    const prnd = rngBytes(prng);
    const npubSk = secretKey(prnd);
    return { npubSk, npub: getPublicKey(npubSk), keys: newGameKeys(prnd), rng: prng, rnd: prnd };
  });
  const sign = (t: EventTemplate, sk: Uint8Array): NostrEvent => finalizeEvent(t, sk, rnd);
  const creator = players[0] as Player;
  // Some seats are invited by npub, the rest are open.
  const invitedCount = Math.floor((seats - 1) / 2);
  const tableEv = sign(
    tableTemplate(
      {
        tableId: `sim-${rng.int(1_000_000_000)}`,
        game: module.id,
        version: module.version,
        seats,
        deadline,
        invited: players.slice(1, 1 + invitedCount).map((p) => p.npub),
        open: seats - 1 - invitedCount,
        relays: RELAYS,
        status: 'open',
        rules,
      },
      clock,
    ),
    creator.npubSk,
  );
  relay.publish(tableEv);
  const table: ParsedTable = parseTable(tableEv);
  advance();
  for (const p of shuffle(players, rng)) {
    const join = buildJoinTemplate(table, p.npub, p.keys, RELAYS, p.rnd, clock);
    relay.publish(finalizeEvent(join, p.npubSk, p.rnd));
    advance();
  }
  const lobbyFilter = [{ kinds: [KIND.join, KIND.root], '#a': [table.address] }];
  const creatorView = foldLobby(tableEv, relay.query(lobbyFilter, creator.rng), opts.modules);
  if (!creatorView.full) throw new Error('the lobby did not fill');
  relay.publish(sign(buildRootTemplate(creatorView, RELAYS, clock), creator.npubSk));
  const rootAt = clock;
  advance();

  // Every client folds the lobby on its own and builds its session from what it sees.
  const lobbyOf = (r: Rng) => {
    const events = relay.query(lobbyFilter, r);
    const view = foldLobby(tableEv, events, opts.modules);
    const root = view.root === null ? undefined : events.find((ev) => ev.id === view.root?.id);
    if (root === undefined || view.root === null) throw new Error('no valid root on the relay');
    return { events, root, parsed: view.root };
  };
  const clients: Client[] = players.map((p) => {
    const { events, root, parsed } = lobbyOf(p.rng);
    const seat = parsed.seats.findIndex((s) => s.session === p.keys.sessionPub);
    if (seat < 0) throw new Error('a joined player holds no seat');
    const identity: Identity = { seat, sessionSk: p.keys.sessionSk, deckSecret: p.keys.deckSecret };
    const modules =
      adversary !== null && adversary.seat === seat ? (adversary.modules ?? opts.modules) : opts.modules;
    const joins = events.filter((ev) => ev.kind === KIND.join);
    const session = GameSession.create({
      modules,
      table: tableEv,
      joins,
      root,
      me: identity,
      rootSeenAt: clock,
    });
    return {
      label: `seat ${seat}`,
      seat,
      session,
      identity,
      npubSk: p.npubSk,
      rng: p.rng.fork('game'),
      rnd: p.rnd,
      outbox: new Map(),
      delivered: new Set(),
      seen: new Map(),
    };
  });
  clients.sort((a, b) => (a.seat as number) - (b.seat as number));
  const specRng = rng.fork('spectator');
  const spec = lobbyOf(specRng);
  const spectator: Client = {
    label: 'spectator',
    seat: null,
    session: GameSession.create({
      modules: opts.modules,
      table: tableEv,
      joins: spec.events.filter((ev) => ev.kind === KIND.join),
      root: spec.root,
      me: null,
      rootSeenAt: clock,
    }),
    identity: null,
    npubSk: null,
    rng: specRng,
    rnd: rngBytes(specRng.fork('bytes')),
    outbox: new Map(),
    delivered: new Set(),
    seen: new Map(),
  };
  const everyone = [...clients, spectator];
  const rootId = spec.root.id;

  /* ------------------------------------------------------------------------------------------- the game */

  /** How each client received each event: the distinct statuses, first one first, and the last one. */
  const received = new Map<Hex, Map<string, { all: string[]; last: string }>>();
  const record = (c: Client, id: Hex, status: string): void => {
    let byClient = received.get(id);
    if (byClient === undefined) {
      byClient = new Map();
      received.set(id, byClient);
    }
    const r = byClient.get(c.label) ?? { all: [], last: status };
    if (!r.all.includes(status)) r.all.push(status);
    r.last = status;
    byClient.set(c.label, r);
  };
  const cheats: Omit<CheatRecord, 'statuses' | 'last'>[] = [];
  let claims = 0;

  const deliver = (c: Client, ev: NostrEvent): string => {
    c.delivered.add(ev.id);
    const first = c.seen.get(ev.id);
    const r = c.session.receive(ev, first ?? clock);
    if (first === undefined && r.status !== 'rejected') c.seen.set(ev.id, clock);
    record(c, ev.id, r.status);
    return r.status;
  };

  /**
   * Sync `c`: query every event of the game and deliver, in the relay's shuffled order, the ones `c` has not seen,
   * some of them twice, plus a few it has seen before (every one of them with `full`) at random places.
   */
  const sync = (c: Client, full = fullSync): void => {
    const events = relay.query({ kinds: GAME_KINDS, '#e': [rootId] }, c.rng);
    const seen = events.filter((ev) => c.delivered.has(ev.id));
    const stream: NostrEvent[] = [];
    for (const ev of events) {
      if (!full && c.delivered.has(ev.id)) continue;
      stream.push(ev);
      if (c.rng.float() < dupRate) stream.splice(c.rng.int(stream.length + 1), 0, ev);
    }
    if (!full && seen.length > 0) {
      for (let i = 0; i < replays; i++) stream.splice(c.rng.int(stream.length + 1), 0, c.rng.pick(seen));
    }
    for (const ev of stream) deliver(c, ev);
    c.session.tick(clock);
  };

  const publish = (c: Client, ev: NostrEvent): string => {
    relay.publish(ev);
    return deliver(c, ev);
  };

  /** The outbox slot of a duty, as of the head. */
  const slotOf = (c: Client, duty: Duty): string => {
    const v = c.session.view();
    switch (duty.kind) {
      case 'shuffle':
      case 'decide':
      case 'beacon':
        return `move:${v.head.seq + 1}:${v.head.id}`;
      case 'share':
        return `share:${duty.positions.join(',')}`;
      case 'seal':
        return `seal:${duty.items.map((x) => `${x.pos}>${x.to}`).join(',')}`;
      case 'attest':
        return `attest:${canonicalJson({ audit: v.audit, logHash: v.logHash, outcome: v.outcome })}`;
      default:
        return duty.kind;
    }
  };

  const choose = (c: Client): unknown => {
    const legal = c.session.legalActions();
    if (legal.length === 0) return null;
    return opts.policy(c.session.view().state, c.seat as number, legal, c.rng);
  };

  const build = (c: Client, duty: Duty): NostrEvent => {
    const s = c.session;
    switch (duty.kind) {
      case 'shuffle':
        return s.buildShuffle(c.rnd, clock);
      case 'deal':
        return s.buildDeal(c.rnd, clock);
      case 'share':
        return s.buildShares(c.rnd, clock);
      case 'seal':
        return s.buildSealed(c.rnd, clock);
      case 'beacon':
        return s.buildBeacon(c.rnd, clock);
      case 'decide':
        return s.buildAction(choose(c), c.rnd, clock);
      case 'secret':
        return s.buildSecret(c.rnd, clock);
      case 'attest':
        return finalizeEvent(s.attestTemplate(clock), c.npubSk as Uint8Array, c.rnd);
    }
  };

  /** Do the seat's duties, one event at a time, until none is due or one makes no progress. */
  const performDuties = (c: Client): void => {
    for (let i = 0; i < MAX_PER_TURN; i++) {
      const duty = c.session.duties()[0];
      if (duty === undefined) return;
      const slot = slotOf(c, duty);
      const held = c.outbox.get(slot);
      if (held !== undefined) {
        // Already built for this decision: re-send it, never build again.
        publish(c, held);
        return;
      }
      let ev: NostrEvent;
      try {
        ev = build(c, duty);
      } catch (e) {
        fail(`${c.label}: building ${duty.kind} failed: ${errorText(e)}`);
        return;
      }
      c.outbox.set(slot, ev);
      const status = publish(c, ev);
      if (status !== 'accepted') {
        fail(`${c.label}: its own ${duty.kind} event was ${status}`);
        return;
      }
    }
  };

  const claimTimeout = (c: Client): void => {
    const seat = c.session.timeoutTarget(clock);
    if (seat === null) return;
    const slot = `timeout:${seat}:${c.session.view().head.id}`;
    if (c.outbox.has(slot)) return;
    let ev: NostrEvent;
    try {
      ev = c.session.buildTimeout(seat, c.rnd, clock);
    } catch (e) {
      fail(`${c.label}: timeoutTarget named seat ${seat} but the claim failed: ${errorText(e)}`);
      return;
    }
    c.outbox.set(slot, ev);
    claims++;
    const status = publish(c, ev);
    if (status !== 'accepted' && status !== 'duplicate')
      fail(`${c.label}: its own timeout claim was ${status}`);
  };

  const turnOf = (c: Client): SimTurn => ({
    seat: c.seat as number,
    session: c.session,
    identity: c.identity as Identity,
    npubSk: c.npubSk as Uint8Array,
    now: clock,
    rng: c.rng,
    rnd: c.rnd,
    choose: () => choose(c),
    publish: (ev, cheat) => {
      if (cheat !== undefined)
        cheats.push({ id: ev.id, label: cheat, seat: c.seat as number, createdAt: ev.created_at });
      publish(c, ev);
    },
  });

  const isAdversary = (c: Client): boolean => adversary !== null && c.seat === adversary.seat;
  /** Every session is over and no honest seat owes anything, an attestation included. */
  const finished = (): boolean =>
    everyone.every((c) => TERMINAL.includes(c.session.view().phase)) &&
    clients.every((c) => isAdversary(c) || c.session.duties().length === 0);

  let rounds = 0;
  for (; rounds < maxRounds && !finished(); rounds++) {
    const c = rng.pick(everyone);
    sync(c);
    if (c.seat !== null) {
      const mode = isAdversary(c) && adversary !== null ? adversary.turn(turnOf(c)) : 'honest';
      if (mode === 'honest') {
        performDuties(c);
        claimTimeout(c);
      }
    }
    advance();
  }
  if (!finished()) fail(`the game did not finish within ${maxRounds} rounds`);

  /* ------------------------------------------------------------------------------------------- checks */

  // A last full sync for everyone, the absent included, then every client must agree.
  for (const c of everyone) sync(c, true);
  const summary = (c: Client): string => {
    const v = c.session.view();
    return canonicalJson({
      phase: v.phase,
      head: v.head,
      logHash: v.logHash,
      outcome: v.outcome,
      audit: v.audit,
      forfeits: v.forfeits,
      equivocators: v.equivocators,
      attested: v.attested,
      // A cancelled game has no result: its state is wherever each client's fold stopped (a resign can count
      // before or after a client folded the setup reveals), so only a game with a result compares it.
      state: v.state === null || v.phase === 'cancelled' ? null : module.view(v.state, null),
    });
  };
  const reference = summary(spectator);
  for (const c of clients) {
    if (summary(c) !== reference) fail(`${c.label} disagrees with the spectator`);
  }
  const final = spectator.session.view();
  if (!TERMINAL.includes(final.phase)) fail(`the game ended in phase ${final.phase}`);

  // Every published attestation is accepted by every client.
  const attesters = new Set<number>();
  for (const ev of relay.query({ kinds: [KIND.attest], '#e': [rootId] })) {
    const seat = clients.find((c) => c.npubSk !== null && getPublicKey(c.npubSk) === ev.pubkey)?.seat;
    if (seat !== undefined && seat !== null) attesters.add(seat);
  }
  for (const c of everyone) {
    const attested = c.session.view().attested;
    for (const seat of attesters) {
      if (!attested.includes(seat)) fail(`${c.label} does not accept seat ${seat}'s attestation`);
    }
  }

  return {
    seed: opts.seed,
    seats,
    adversary: adversary?.name ?? null,
    phase: final.phase,
    outcome: final.outcome,
    audit: final.audit,
    forfeits: final.forfeits,
    equivocators: final.equivocators,
    attested: final.attested,
    moves: final.head.seq,
    // A deckless game has no shuffle steps before its first action (D045).
    actions: Math.max(0, final.head.seq - final.shuffleSteps),
    events: relay.size,
    kinds: kindCounts(relay.query({})),
    rounds,
    duration: clock - rootAt,
    claims,
    cheats: cheats.map((ch) => {
      const others = [...(received.get(ch.id) ?? new Map())].filter(([label]) => label !== `seat ${ch.seat}`);
      return {
        ...ch,
        statuses: Object.fromEntries(others.map(([label, r]) => [label, [...r.all]])),
        last: Object.fromEntries(others.map(([label, r]) => [label, r.last])),
      };
    }),
    failures,
  };
}
