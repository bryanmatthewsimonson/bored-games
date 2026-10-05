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
  parseSharesV2,
  parseTable,
  tableTemplate,
} from '@bored-games/protocol';
import { buildJoinTemplate, buildRootTemplate, foldLobby, type GameKeys, newGameKeys } from './lobby.ts';
import { MemoryRelay } from './memory-relay.ts';
import { openSession, type Session, statsAttestTemplate, v1Session } from './session-api.ts';
import type {
  Duty,
  Identity,
  Phase,
  ResultId,
  SessionAudit,
  SessionInput,
  SessionView,
  SessionViewV2,
} from './types.ts';
import { type GameRecord, gameRecord } from './v2/record.ts';
import { GameSessionV2 } from './v2/session.ts';

/*
 * Asynchronous multi-client game simulation over an in-memory relay (Phase 2d Task 7; protocol 2, build plan T19).
 * Every player runs its own game `Session` (`openSession`, protocol 1 or 2 by the table), a spectator follows along,
 * and nobody coordinates. Each round one random client syncs at the simulated clock: it queries the relay for every
 * event of the game and receives, in its own shuffled order, the ones it has not received yet (some of them twice)
 * plus a few it has, at random places (`fullSync`: all of them again). Then it does what an honest client does: its
 * duties (shuffle, deal, decide through a policy, secret, attest; in protocol 1 also share and a public dice share,
 * in protocol 2 a prompt release, a roll contribution and the end attestation) and a timeout claim when
 * `timeoutTarget` names a seat. Every event it builds goes to a per-client outbox first, keyed by the decision it
 * answers, so it never builds twice for one decision (as the web controller does). The clock then advances by 1 to
 * 3600 s.
 *
 * Timeouts run on local receipt time (D030 Ruling 10): each client passes the simulated clock as `now` when it
 * first receives an event, and remembers that first-seen time, passing it again for every later copy, as the web
 * controller does across reloads.
 *
 * Devices (protocol 2, PROTOCOL-v2 §9): an adversary may give its seat more devices, each a client of its own with
 * the seat's keys. A device the adversary takes offline does not sync and saves what it builds unsent (fed to its
 * own session, not to the relay). Back online, it syncs, then vets each unsent event with `vetSaved` (the outbox
 * rule, §9.2): it publishes what is sent, keeps what waits, and drops what is discarded (and a move built on a
 * discarded move), rebuilding its session without a dropped event it had fed in, before it does anything else. A
 * device can also reload: a fresh session fed what it saved, in first-seen order, with its unsent events held back
 * until vetted (as the web controller's load). The relay never loses events, so the §9.1 rebroadcast is not modelled.
 *
 * An adversary may take one seat's turns over to cheat; its hooks live with the tests and tools, never here.
 *
 * An observer session receives every event the moment it is published. At the end every client, a vanished one
 * included, syncs everything once more, and the sim checks that all of them and the observer agree with the
 * spectator on the phase, the head, the log hash, the outcome, the audit, the forfeits, the equivocators, the
 * attestations and the public state, and in protocol 2 on the fork, the result's identity, the stop, the end
 * attestations and the game record (places, ratings, marks), and that every client accepts every published
 * attestation. Honest seats (every seat but a cheating adversary's) are checked never to fork themselves (two moves
 * of the seat on one prev at the relay, or the seat an equivocator or the stop's seat), never to publish a share of
 * a position dealt to their own seat (protocol 2: a card Shares event anchored on the final chain), and never to
 * publish a Secret reveal while the game is live for the observer. Pure: the clock is simulated and all randomness
 * comes from the seed.
 */

/** Picks one of `legal` for `seat`, given the seat's view of the module state. */
export type SimPolicy = (state: unknown, seat: number, legal: readonly unknown[], rng: Rng) => unknown;

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
type Modules = ReadonlyMap<string, GameModule<any, any, any>>;

/** What an adversary's hook sees and may do on its seat's turn, after the seat synced (unless offline). */
export interface SimTurn {
  seat: number;
  /** Which device of the seat this is: 0, or more when the adversary plays the seat on several devices. */
  device: number;
  session: Session;
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

/** What a device's connection hook sees before the device syncs (`Adversary.connect`). */
export interface DeviceTurn {
  seat: number;
  device: number;
  /** The device's session as of its last sync (or its offline builds). */
  session: Session;
  now: number;
  rng: Rng;
  /** The number of events on the relay. */
  relayEvents: number;
  /** The device's own events not published yet (built offline). */
  unsent: number;
}

/**
 * How a device of the adversary's seat starts its turn:
 * - `online`: it syncs, vets its unsent events, then plays (`turn`);
 * - `reload`: as `online`, from a fresh session fed what it saved (its unsent events held back until vetted);
 * - `offline`: it does not sync, and saves what it builds unsent;
 * - `idle`: it does nothing this turn.
 */
export type DeviceMode = 'online' | 'reload' | 'offline' | 'idle';

/** A cheating seat, or (with `honest`) a seat played by several honest devices. */
export interface Adversary {
  name: string;
  seat: number;
  /** The modules the cheating seat's own session runs (e.g. a lenient engine); the sim's by default. */
  modules?: Modules;
  /** The seat plays honestly (a device scenario): every check on honest seats covers it too. */
  honest?: boolean;
  /** How many devices play the seat (default 1; more need protocol 2): each one a client with the seat's keys. */
  devices?: number;
  /** Before a device of the seat syncs: how it starts its turn (default `online`). */
  connect?(t: DeviceTurn): DeviceMode;
  /**
   * The seat's turn: `honest` lets the sim do the seat's duties as usual, `offline` does them but saves every
   * event unsent (as if the connection dropped), `pass` ends the turn.
   */
  turn(t: SimTurn): 'honest' | 'offline' | 'pass';
  /** Whether the scenario has played out; the game is not finished before (default: always). */
  done?(): boolean;
}

export interface SimOptions {
  seats: number;
  seed: string;
  modules: Modules;
  /** The module id of the game to play. */
  game: string;
  /** The table's protocol version (default 2). */
  proto?: 1 | 2;
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

/** What the devices of a seat did with their outboxes (protocol 2, the outbox rule). */
export interface DeviceStats {
  /** Events built offline and saved unsent. */
  saved: number;
  /** Saved events `vetSaved` sent once back online. */
  sent: number;
  /** Saved events discarded (by `vetSaved`, or built on a discarded move). */
  discarded: number;
  /** Sessions rebuilt: after a discard of an event fed in, or a reload. */
  rebuilds: number;
  /** The discard reasons, distinct, first one first. */
  reasons: string[];
}

export interface SimReport {
  seed: string;
  seats: number;
  proto: 1 | 2;
  adversary: string | null;
  /** The spectator's final view. */
  phase: Phase;
  outcome: SessionView['outcome'];
  audit: SessionAudit;
  forfeits: number[];
  equivocators: number[];
  attested: number[];
  /** Protocol 2: the fork's signer, the stop, the result's identity, the end attesters and the game record. */
  fork: number | null;
  stop: SessionViewV2['stop'];
  result: ResultId | null;
  endAttested: number[];
  record: GameRecord | null;
  /** Moves on the chain (shuffle steps included, if the game has a deck), and game actions among them. */
  moves: number;
  actions: number;
  /** Events on the relay, of every kind. */
  events: number;
  rounds: number;
  /** Simulated seconds from the root to the end. */
  duration: number;
  /** Timeout claims published. */
  claims: number;
  cheats: CheatRecord[];
  devices: DeviceStats;
  /** Empty when the game ended and every check held. */
  failures: string[];
}

/** The in-game kinds a client subscribes to (PROTOCOL §9; PROTOCOL-v2 §4.5 adds the Device note). */
const GAME_KINDS_V1 = [KIND.move, KIND.shares, KIND.timeout, KIND.reveal, KIND.attest, KIND.resign];
const GAME_KINDS_V2 = [...GAME_KINDS_V1, KIND.device];
const RELAYS = ['wss://relay.sim.invalid'];
const DEFAULT_START = 1_700_000_000;
/** The most events one client publishes in one turn; a sound session needs far fewer. */
const MAX_PER_TURN = 32;
/** The most vetting passes after a sync (each pass after a rebuild); one or two suffice. */
const MAX_VET_PASSES = 16;

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
  /** The device of the seat: 0, or more for an adversary's extra devices. */
  device: number;
  /** What the session was opened from, for a rebuild. */
  input: SessionInput;
  session: Session;
  identity: Identity | null;
  npubSk: Uint8Array | null;
  rng: Rng;
  rnd: RandomBytes;
  /**
   * Built events by slot: `move:<seq>:<prev>`, `deal`, `release:<anchor>`, `roll:<move>`, `end:<result>`, `secret`,
   * `attest:<result>`, `timeout:<seat>:<head>`.
   */
  outbox: Map<string, NostrEvent>;
  /** Events this client built and has not published (offline), by id, in build order. */
  unsent: Map<Hex, NostrEvent>;
  /** Own events the outbox rule discarded: never fed again. */
  discarded: Set<Hex>;
  /** Unsent events a reload held back from the session until vetted. */
  heldBack: Set<Hex>;
  /** Ids of the events this client has received. */
  delivered: Set<Hex>;
  /** Every event this client has received, for a rebuild. */
  events: Map<Hex, NostrEvent>;
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
const LIVE: readonly Phase[] = ['shuffle', 'deal', 'play'];

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A Move's `prev` id, read from its tags (no parse: the deck size is not needed). */
const prevOf = (ev: NostrEvent): Hex | null =>
  (ev.tags.find((t) => t[0] === 'e' && t[3] === 'prev')?.[1] as Hex | undefined) ?? null;

/**
 * Simulate one game from the lobby to its end. A game that goes wrong is reported in `failures`; it throws only
 * for an unknown game, a lobby that cannot start one, or devices asked of a protocol 1 game.
 */
export function simulateGame(opts: SimOptions): SimReport {
  const rng = createRng(`sim:${opts.seed}`);
  const rnd = rngBytes(rng.fork('bytes'));
  const relay = new MemoryRelay(rng.fork('relay'));
  const module = opts.modules.get(opts.game);
  if (module === undefined) throw new Error(`unknown game ${opts.game}`);
  const proto = opts.proto ?? 2;
  const rules = opts.rules ?? module.defaultRules();
  const seats = opts.seats;
  const deadline = opts.deadline ?? 86400;
  const maxRounds = opts.maxRounds ?? 20000;
  const dupRate = opts.duplicates ?? 0.25;
  const fullSync = opts.fullSync ?? false;
  const replays = opts.replays ?? 3;
  const adversary = opts.adversary ?? null;
  const deviceCount = adversary?.devices ?? 1;
  if (deviceCount > 1 && proto !== 2) throw new Error('several devices of one seat need protocol 2');
  const gameKinds = proto === 2 ? GAME_KINDS_V2 : GAME_KINDS_V1;
  const failures: string[] = [];
  /** Record a problem once, however often it recurs. */
  const fail = (what: string): void => {
    if (!failures.includes(what)) failures.push(what);
  };
  let clock = opts.start ?? DEFAULT_START;
  const advance = (): void => {
    clock += 1 + rng.int(3600);
  };
  const devices: DeviceStats = { saved: 0, sent: 0, discarded: 0, rebuilds: 0, reasons: [] };

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
        proto: proto === 2 ? '2' : '1',
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
  const newClient = (
    label: string,
    seat: number | null,
    device: number,
    input: SessionInput,
    who: { identity: Identity | null; npubSk: Uint8Array | null; rng: Rng; rnd: RandomBytes },
  ): Client => ({
    label,
    seat,
    device,
    input,
    session: openSession(input),
    ...who,
    outbox: new Map(),
    unsent: new Map(),
    discarded: new Set(),
    heldBack: new Set(),
    delivered: new Set(),
    events: new Map(),
    seen: new Map(),
  });
  const clients: Client[] = [];
  for (const p of players) {
    const { events, root, parsed } = lobbyOf(p.rng);
    const seat = parsed.seats.findIndex((s) => s.session === p.keys.sessionPub);
    if (seat < 0) throw new Error('a joined player holds no seat');
    const identity: Identity = { seat, sessionSk: p.keys.sessionSk, deckSecret: p.keys.deckSecret };
    const mine = adversary !== null && adversary.seat === seat;
    const input: SessionInput = {
      modules: mine ? (adversary.modules ?? opts.modules) : opts.modules,
      table: tableEv,
      joins: events.filter((ev) => ev.kind === KIND.join),
      root,
      me: identity,
      rootSeenAt: clock,
    };
    const count = mine ? deviceCount : 1;
    for (let d = 0; d < count; d++) {
      const drng = d === 0 ? p.rng.fork('game') : p.rng.fork(`device:${d}`);
      clients.push(
        newClient(d === 0 ? `seat ${seat}` : `seat ${seat} device ${d}`, seat, d, input, {
          identity,
          npubSk: p.npubSk,
          rng: drng,
          rnd: d === 0 ? p.rnd : rngBytes(drng.fork('bytes')),
        }),
      );
    }
  }
  clients.sort((a, b) => (a.seat as number) - (b.seat as number) || a.device - b.device);
  const spectatorOf = (label: string): Client => {
    const r = rng.fork(label);
    const lobby = lobbyOf(r);
    const input: SessionInput = {
      modules: opts.modules,
      table: tableEv,
      joins: lobby.events.filter((ev) => ev.kind === KIND.join),
      root: lobby.root,
      me: null,
      rootSeenAt: clock,
    };
    return newClient(label, null, 0, input, { identity: null, npubSk: null, rng: r, rnd: rngBytes(r.fork('bytes')) });
  };
  const spectator = spectatorOf('spectator');
  // The observer receives every event as it is published: the game as a client holding everything public.
  const observer = spectatorOf('observer');
  const everyone = [...clients, spectator];
  const rootId = spectator.input.root.id;
  const sessionKeys = new Map<Hex, number>();
  for (const c of clients) sessionKeys.set(getPublicKey((c.identity as Identity).sessionSk), c.seat as number);
  const npubs = new Map<Hex, number>();
  for (const c of clients) npubs.set(getPublicKey(c.npubSk as Uint8Array), c.seat as number);
  const honest = (seat: number): boolean => adversary === null || seat !== adversary.seat || adversary.honest === true;

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
    c.events.set(ev.id, ev);
    const first = c.seen.get(ev.id);
    const r = c.session.receive(ev, first ?? clock);
    if (first === undefined && r.status !== 'rejected') c.seen.set(ev.id, clock);
    c.heldBack.delete(ev.id);
    if (c !== observer) record(c, ev.id, r.status);
    return r.status;
  };

  /**
   * Sync `c`: query every event of the game and deliver, in the relay's shuffled order, the ones `c` has not seen,
   * some of them twice, plus a few it has seen before (every one of them with `full`) at random places.
   */
  const sync = (c: Client, full = fullSync): void => {
    const events = relay.query({ kinds: gameKinds, '#e': [rootId] }, c.rng);
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

  /**
   * Put `c`'s event on the relay, and on the observer, after the checks that must hold when an honest seat
   * publishes: never a Secret reveal while the game is live for a client holding every published event.
   */
  const toRelay = (c: Client, ev: NostrEvent): void => {
    if (c.seat !== null && honest(c.seat) && ev.kind === KIND.reveal) {
      observer.session.tick(clock);
      const phase = observer.session.view().phase;
      if (LIVE.includes(phase))
        fail(`${c.label}: published its Secret reveal while the game is live (phase ${phase} for the observer)`);
    }
    if (relay.publish(ev)) deliver(observer, ev);
  };

  const publish = (c: Client, ev: NostrEvent): string => {
    toRelay(c, ev);
    return deliver(c, ev);
  };

  /** Save `ev` unsent (offline): fed to `c`'s own session, as the web controller does, and kept for vetting. */
  const save = (c: Client, ev: NostrEvent): string => {
    c.unsent.set(ev.id, ev);
    devices.saved++;
    return deliver(c, ev);
  };

  /** The kinds of own unsent events a reload holds back until vetted: all but Secret reveals, claims and npub's. */
  const holdsBack = (c: Client, ev: NostrEvent): boolean =>
    c.unsent.has(ev.id) &&
    ev.kind !== KIND.reveal &&
    ev.kind !== KIND.timeout &&
    !(ev.kind === KIND.attest && ev.pubkey === getPublicKey(c.npubSk as Uint8Array));

  /**
   * A fresh session for `c` fed every event it holds (but the discarded ones) in first-seen order, at their
   * first-seen times, with what the old session decided that a reload keeps (`savedStanding`, `savedCounted`,
   * `confirmedForfeits`). `reload`: the unsent events wait for vetting (`heldBack`), as on the web controller's load.
   */
  const rebuild = (c: Client, reload: boolean): void => {
    const old = c.session;
    const kept =
      old instanceof GameSessionV2
        ? {
            savedStanding: old.standingTimes(),
            savedCounted: old.countedResult(),
            confirmedForfeits: old.confirmedForfeits(),
          }
        : {};
    c.session = openSession({ ...c.input, ...kept });
    const at = (id: Hex): number => c.seen.get(id) ?? Number.POSITIVE_INFINITY;
    c.heldBack.clear();
    const held: NostrEvent[] = [];
    for (const ev of c.events.values()) {
      if (c.discarded.has(ev.id)) continue;
      if (reload && holdsBack(c, ev)) c.heldBack.add(ev.id);
      else held.push(ev);
    }
    held.sort((a, b) => at(a.id) - at(b.id));
    for (const ev of held) c.session.receive(ev, c.seen.get(ev.id) ?? clock);
    c.session.tick(clock);
    devices.rebuilds++;
  };

  /**
   * The outbox rule (PROTOCOL-v2 §9.2) after a sync: vet each unsent event of `c` in build order. Sent: published
   * (and fed, if a reload held it back). Waits: kept. Discarded, or a move built on a discarded move: dropped with
   * its slot, and the session rebuilt without it if it had been fed, before vetting the rest again.
   */
  const reconcile = (c: Client): void => {
    if (c.unsent.size === 0) return;
    const dropped = new Set<Hex>();
    for (let pass = 0; pass < MAX_VET_PASSES; pass++) {
      const s = c.session;
      if (!(s instanceof GameSessionV2)) return;
      let rebuilt = false;
      for (const [id, ev] of [...c.unsent]) {
        const prev = ev.kind === KIND.move ? prevOf(ev) : null;
        const v =
          prev !== null && (dropped.has(prev) || c.discarded.has(prev))
            ? { discard: 'built on a discarded move' }
            : s.vetSaved(ev, c.unsent.keys());
        if (v === 'wait') continue;
        c.unsent.delete(id);
        if (v === 'send') {
          devices.sent++;
          publish(c, ev);
          continue;
        }
        devices.discarded++;
        if (!devices.reasons.includes(v.discard)) devices.reasons.push(v.discard);
        c.discarded.add(id);
        dropped.add(id);
        for (const [slot, held] of c.outbox) if (held.id === id) c.outbox.delete(slot);
        if (!c.heldBack.delete(id)) {
          rebuild(c, false);
          rebuilt = true;
          break;
        }
      }
      if (!rebuilt) return;
    }
    fail(`${c.label}: vetting its outbox did not settle`);
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
      case 'release':
        return `release:${duty.anchor}`;
      case 'roll':
        return `roll:${duty.move}`;
      case 'end': {
        const r = (v as SessionViewV2).result;
        return `end:${r === null ? '' : `${r.kind}:${r.head}:${r.forfeit.join(',')}`}`;
      }
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

  const v2Of = (s: Session): GameSessionV2 => {
    if (s instanceof GameSessionV2) return s;
    throw new Error('a protocol 2 duty in a protocol 1 session');
  };

  const build = (c: Client, duty: Duty): NostrEvent => {
    const s = c.session;
    switch (duty.kind) {
      case 'shuffle':
        return s.buildShuffle(c.rnd, clock);
      case 'deal':
        return s.buildDeal(c.rnd, clock);
      case 'share':
        return v1Session(s).buildShares(c.rnd, clock);
      case 'beacon':
        return v1Session(s).buildBeacon(c.rnd, clock);
      case 'decide':
        return s.buildAction(choose(c), c.rnd, clock);
      case 'secret':
        return s.buildSecret(c.rnd, clock);
      case 'attest':
        return finalizeEvent(statsAttestTemplate(s, clock), c.npubSk as Uint8Array, c.rnd);
      case 'release':
        return v2Of(s).buildRelease(c.rnd, clock);
      case 'roll':
        return v2Of(s).buildRoll(duty.move, c.rnd, clock);
      case 'end':
        return v2Of(s).buildEndAttest(c.rnd, clock);
    }
  };

  /**
   * Do the seat's duties, one event at a time, until none is due or one makes no progress. Offline, every event is
   * saved unsent; a held event that is still unsent is never re-sent here (only `reconcile` sends it).
   */
  const performDuties = (c: Client, offline: boolean): void => {
    for (let i = 0; i < MAX_PER_TURN; i++) {
      const duty = c.session.duties()[0];
      if (duty === undefined) return;
      const slot = slotOf(c, duty);
      const held = c.outbox.get(slot);
      if (held !== undefined) {
        // Already built for this decision: re-send it, never build again.
        if (!offline && !c.unsent.has(held.id)) publish(c, held);
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
      const status = offline ? save(c, ev) : publish(c, ev);
      if (status !== 'accepted') {
        fail(`${c.label}: its own ${duty.kind} event was ${status}`);
        return;
      }
    }
  };

  const claimTimeout = (c: Client, offline: boolean): void => {
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
    const status = offline ? save(c, ev) : publish(c, ev);
    if (status !== 'accepted' && status !== 'duplicate')
      fail(`${c.label}: its own timeout claim was ${status}`);
  };

  const turnOf = (c: Client): SimTurn => ({
    seat: c.seat as number,
    device: c.device,
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
  /** Every session is over, no honest seat owes anything (an attestation included), and the scenario played out. */
  const finished = (): boolean =>
    everyone.every((c) => TERMINAL.includes(c.session.view().phase)) &&
    clients.every((c) => !honest(c.seat as number) || c.session.duties().length === 0) &&
    (adversary?.done?.() ?? true);

  let rounds = 0;
  for (; rounds < maxRounds && !finished(); rounds++) {
    const c = rng.pick(everyone);
    let mode: DeviceMode = 'online';
    if (isAdversary(c) && adversary?.connect !== undefined)
      mode = adversary.connect({
        seat: c.seat as number,
        device: c.device,
        session: c.session,
        now: clock,
        rng: c.rng,
        relayEvents: relay.size,
        unsent: c.unsent.size,
      });
    if (mode !== 'idle') {
      if (mode === 'reload') rebuild(c, true);
      if (mode === 'offline') c.session.tick(clock);
      else {
        sync(c);
        reconcile(c);
      }
      if (c.seat !== null) {
        const act = isAdversary(c) && adversary !== null ? adversary.turn(turnOf(c)) : 'honest';
        if (act !== 'pass') {
          const offline = mode === 'offline' || act === 'offline';
          performDuties(c, offline);
          claimTimeout(c, offline);
        }
      }
    }
    advance();
  }
  if (!finished()) fail(`the game did not finish within ${maxRounds} rounds`);

  /* ------------------------------------------------------------------------------------------- checks */

  // A last full sync for everyone, the absent included (a device with unsent events vets them first, then everyone
  // syncs again), then every client must agree.
  for (const c of everyone) {
    sync(c, true);
    reconcile(c);
  }
  for (const c of everyone) sync(c, true);
  observer.session.tick(clock);
  const summary = (c: Client): string => {
    const v = c.session.view();
    const v2 = c.session.proto === 2 ? (v as SessionViewV2) : null;
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
      ...(v2 === null
        ? {}
        : {
            fork: v2.fork,
            result: v2.result,
            stood: v2.stood,
            stop: v2.stop,
            secretWithheld: v2.secretWithheld,
            auditIncomplete: v2.auditIncomplete,
            endAttested: v2.endAttested,
            record: gameRecord(v2),
          }),
    });
  };
  const reference = summary(spectator);
  for (const c of [...clients, observer]) {
    if (summary(c) !== reference) fail(`${c.label} disagrees with the spectator`);
  }
  const final = spectator.session.view();
  const finalV2 = spectator.session.proto === 2 ? (final as SessionViewV2) : null;
  if (!TERMINAL.includes(final.phase)) fail(`the game ended in phase ${final.phase}`);

  // Every published attestation is accepted by every client: in protocol 2 the stats attestations (by npub).
  const attesters = new Set<number>();
  for (const ev of relay.query({ kinds: [KIND.attest], '#e': [rootId] })) {
    const seat = npubs.get(ev.pubkey);
    if (seat !== undefined) attesters.add(seat);
  }
  for (const c of everyone) {
    const attested = c.session.view().attested;
    for (const seat of attesters) {
      if (!attested.includes(seat)) fail(`${c.label} does not accept seat ${seat}'s attestation`);
    }
  }

  // Honest seats never fork themselves.
  for (const seat of final.equivocators)
    if (honest(seat)) fail(`honest seat ${seat} is recorded as an equivocator`);
  if (finalV2?.fork != null && honest(finalV2.fork.seat)) fail(`honest seat ${finalV2.fork.seat} forked the game`);
  const byPrev = new Map<string, Set<Hex>>();
  for (const ev of relay.query({ kinds: [KIND.move], '#e': [rootId] })) {
    const seat = sessionKeys.get(ev.pubkey);
    const prev = prevOf(ev);
    if (seat === undefined || seat < 0 || !honest(seat) || prev === null) continue;
    const key = `${seat}:${prev}`;
    const ids = byPrev.get(key) ?? new Set<Hex>();
    ids.add(ev.id);
    byPrev.set(key, ids);
    if (ids.size > 1) fail(`honest seat ${seat} signed two moves on one prev`);
  }

  // Honest seats never share a card dealt to themselves (protocol 2: a card Shares event anchored on the chain; one
  // anchored off it lies past a stop, where every Secret reveal exposes every hand anyway).
  if (finalV2 !== null && final.state !== null) {
    const owner = new Map<number, number | null>(module.dealt(final.state).map((d) => [d.pos, d.to]));
    for (const ev of relay.query({ kinds: [KIND.shares], '#e': [rootId] })) {
      const seat = sessionKeys.get(ev.pubkey);
      if (seat === undefined || seat < 0 || !honest(seat)) continue;
      let parsed: ReturnType<typeof parseSharesV2>;
      try {
        parsed = parseSharesV2(ev);
      } catch {
        fail(`honest seat ${seat} published a Shares event that does not parse`);
        continue;
      }
      if (parsed.type !== 'shares' || spectator.session.chainSeq(parsed.anchorId) === null) continue;
      for (const x of parsed.shares)
        if (owner.get(x.pos) === seat) fail(`honest seat ${seat} published a share of its own card (position ${x.pos})`);
    }
  }

  // An honest device's events all went out or were dropped by the outbox rule, but those that still wait.
  for (const c of clients) {
    if (c.unsent.size === 0 || !honest(c.seat as number)) continue;
    const s = c.session;
    if (!(s instanceof GameSessionV2)) continue;
    const unconfirmed = [...c.unsent.keys()];
    for (const ev of c.unsent.values()) {
      const v = s.vetSaved(ev, unconfirmed);
      if (v !== 'wait') fail(`${c.label}: an unsent event is left with verdict ${JSON.stringify(v)}`);
    }
  }

  return {
    seed: opts.seed,
    seats,
    proto,
    adversary: adversary?.name ?? null,
    phase: final.phase,
    outcome: final.outcome,
    audit: final.audit,
    forfeits: final.forfeits,
    equivocators: final.equivocators,
    attested: final.attested,
    fork: finalV2?.fork?.seat ?? null,
    stop: finalV2?.stop ?? null,
    result: finalV2?.result ?? null,
    endAttested: finalV2?.endAttested ?? [],
    record: finalV2 === null ? null : gameRecord(finalV2),
    moves: final.head.seq,
    // A deckless game has no shuffle steps before its first action (D045).
    actions: Math.max(0, final.head.seq - final.shuffleSteps),
    events: relay.size,
    rounds,
    duration: clock - rootAt,
    claims,
    cheats: cheats.map((ch) => {
      const others = [...(received.get(ch.id) ?? new Map())].filter(
        ([label]) => label !== `seat ${ch.seat}` && !label.startsWith(`seat ${ch.seat} `),
      );
      return {
        ...ch,
        statuses: Object.fromEntries(others.map(([label, r]) => [label, [...r.all]])),
        last: Object.fromEntries(others.map(([label, r]) => [label, r.last])),
      };
    }),
    devices,
    failures,
  };
}
