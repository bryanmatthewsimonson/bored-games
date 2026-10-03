/*
 * The game controller: binds the relay pool to a `GameSession` for one game (PROTOCOL §6–§9).
 *
 * - It loads the root, the table and the Joins, builds the session for this player's seat (from the saved game
 *   secrets) or as a spectator, and folds in every game event from the relays.
 * - It performs this seat's automatic duties one at a time (shuffle, deal, secret, attest). Only `decide` waits
 *   for the player, through `act`.
 * - Every event it builds is saved to an outbox in storage before it is published. A duty whose event is already
 *   in the outbox reuses it: nothing is signed twice. A move is kept under the head it was built on, and one the
 *   session no longer accepts (an orphan, after the chain moved on) is never republished.
 * - A saved event that could conflict with what the seat did on another device (a move, the deal, a Resign) is
 *   republished only after the relays have been asked what this seat already published (D056, the stale outbox):
 *   a move only on the current head with no other move of this seat on its parent, the deal only if no other deal
 *   of this seat is out, a Resign only on the current head. Otherwise it is discarded and logged (`log`).
 * - The deal is built at most once per game (D056, review F7): a seat that dealt on a rival deck of a shuffle fork
 *   never deals again, and the shuffle steps it dealt on are republished with its deal.
 * - Timeouts run on local receipt time (D030 Ruling 10): the controller saves when it first saw each event
 *   (`bg:<profile>:seen:<rootId>`) and passes that time to `receive`, so a reopened tab keeps the deadlines. On
 *   load it feeds what it holds in first-seen order, which reproduces the session, a timeout's finality included.
 */
import { ClientError, type Duty, GameSession, type Identity, type SessionView } from '@bored-games/client';
import {
  type EventTemplate,
  type Hex,
  KIND,
  type NostrEvent,
  type ParsedRoot,
  type ParsedTable,
  parseRoot,
  parseTable,
  verifyEvent,
} from '@bored-games/protocol';
import type { EoseInfo, Filter } from '@bored-games/relay';
import { type Signal, signal } from '@preact/signals';
import { bytesToHex } from './hex.ts';
import { type ControllerDeps, unionRelays } from './net.ts';
import {
  type GameStatusName,
  loadSecrets,
  readJson,
  removeItem,
  saveGameStatus,
  saveRootId,
  storageKey,
  writeJson,
} from './storage.ts';

/**
 * - `syncing`: loading from the relays
 * - `working`: performing an automatic duty (shuffle, deal, secret, attest)
 * - `stuck`: an automatic duty failed at this head and is not retried until the game moves on
 * - `your-turn`: this seat's decision, with no move of its own already waiting at this head
 */
export type GameStatus = 'syncing' | 'working' | 'stuck' | 'waiting' | 'your-turn' | 'done' | 'cancelled';

/** How often `tick` runs while the controller is started, in ms. */
export const TICK_MS = 30_000;

/** The game event kinds a game subscription asks for (PROTOCOL §9). */
export const GAME_KINDS = [KIND.move, KIND.shares, KIND.timeout, KIND.reveal, KIND.attest, KIND.resign];

/** The game event kinds signed by a seat's session key; attestations (`KIND.attest`) are signed by its npub. */
const SESSION_KINDS: readonly number[] = [KIND.move, KIND.shares, KIND.timeout, KIND.reveal, KIND.resign];

/**
 * Stored game events asked for per page. A page that brings any event not seen before is followed by an older
 * page (`until` its oldest date), so a relay that caps its answers below this still yields every event.
 */
export const GAME_PAGE = 500;

/** Automatic duties, in the order they are performed. */
const AUTO: readonly Duty['kind'][] = ['shuffle', 'deal', 'secret', 'attest'];

/** One built event, whether a relay has confirmed it, and whether the session has refused it (an orphan). */
export interface OutboxEntry {
  event: NostrEvent;
  confirmed: boolean;
  orphan: boolean;
}

/** Outbox slots whose saved events can conflict with what this seat did elsewhere, so they are vetted (D056). */
const vetted = (slot: string): boolean => slot.startsWith('move:') || slot === 'deal' || slot === 'resign';

/** The most entries `GameController.log` keeps. */
const MAX_LOG = 20;

/** The outbox slot of a move: its seq and the head (`prev`) it was built on. */
export const moveSlot = (seq: number, prevId: string): string => `move:${seq}:${prevId}`;

export const outboxKey = (profile: string, rootId: string): string => storageKey(profile, `outbox:${rootId}`);

export const seenKey = (profile: string, rootId: string): string => storageKey(profile, `seen:${rootId}`);

export const tableKey = (profile: string, rootId: string): string => storageKey(profile, `table:${rootId}`);

/**
 * The Table event this profile validated the game's root against, saved on the first successful load, or null
 * when none is saved or it is not a valid Table at `address`.
 */
export function loadTable(
  store: ControllerDeps['storage'],
  profile: string,
  rootId: string,
  address: string,
): NostrEvent | null {
  const v = readJson(store, tableKey(profile, rootId));
  if (!verifyEvent(v)) return null;
  try {
    return parseTable(v).address === address ? v : null;
  } catch {
    return null;
  }
}

/** The most first-seen times saved per game; the oldest go first (never the root's). */
export const MAX_SEEN = 5_000;

const EVENT_ID = /^[0-9a-f]{64}$/;

/** The saved first-seen times of a game's events (Unix seconds), by event id. */
export function loadSeen(
  store: ControllerDeps['storage'],
  profile: string,
  rootId: string,
): Map<string, number> {
  const out = new Map<string, number>();
  const v = readJson(store, seenKey(profile, rootId));
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const [id, at] of Object.entries(v as Record<string, unknown>)) {
    if (EVENT_ID.test(id) && typeof at === 'number' && Number.isFinite(at)) out.set(id, at);
  }
  return out;
}

/**
 * The saved outbox of a game, by slot: `move:<seq>:<prev>`, `deal`, `secret`, `attest`, `resign` and
 * `timeout:<seat>:<head>`.
 */
export function loadOutbox(
  store: ControllerDeps['storage'],
  profile: string,
  rootId: string,
): Map<string, OutboxEntry> {
  const out = new Map<string, OutboxEntry>();
  const v = readJson(store, outboxKey(profile, rootId));
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const [slot, entry] of Object.entries(v as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { event, confirmed, orphan } = entry as Record<string, unknown>;
    if (verifyEvent(event)) out.set(slot, { event, confirmed: confirmed === true, orphan: orphan === true });
  }
  return out;
}

/** The move's `prev` event id. */
const prevOf = (ev: NostrEvent): string | null =>
  ev.tags.find((t) => t[0] === 'e' && t[3] === 'prev')?.[1] ?? null;

/** The head a Resign names. */
const headOf = (ev: NostrEvent): string | null =>
  ev.tags.find((t) => t[0] === 'e' && t[3] === 'head')?.[1] ?? null;

/**
 * The session's attestation builder, typed as optional: `attestTemplate(createdAt)` (Phase 2d Task 4) returns
 * the unsigned attestation, which the npub signer signs. Until the session has it, this seat does not attest.
 */
interface AttestApi {
  attestTemplate?(createdAt: number): EventTemplate;
}

const canAttest = (s: GameSession): boolean =>
  typeof (s as unknown as AttestApi).attestTemplate === 'function';

/** While nothing changes, the Home status entry is rewritten this often (s), so it stays fresh while the game is open. */
export const STATUS_REFRESH_S = 300;

/** The most seated game events kept while the session is still loading; past it, loading stops with an error. */
const MAX_BUFFER = 100_000;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class GameController {
  readonly rootId: string;
  /** The session's view after the latest batch of events; null while loading. */
  readonly view: Signal<SessionView | null> = signal(null);
  readonly status: Signal<GameStatus> = signal('syncing');
  /** True while `act` or `claimTimeout` is building and sending this player's event. */
  readonly busy: Signal<boolean> = signal(false);
  /** The last problem worth showing: loading, an automatic duty or a submitted move failed. */
  readonly error: Signal<string | null> = signal(null);
  /** Delivery state: set while one of this player's events has reached no relay yet, or after one was discarded. */
  readonly notice: Signal<string | null> = signal(null);
  /**
   * Saved events this controller discarded instead of publishing (D056): a move, deal or Resign saved on this
   * device that the game no longer fits, newest last, at most `MAX_LOG`.
   */
  readonly log: Signal<readonly string[]> = signal([]);
  /** This seat's legal actions now (empty unless it is this player's decision). */
  readonly legal: Signal<readonly unknown[]> = signal([]);
  /** A seat this player may claim a timeout against now, or null. */
  readonly timeoutTarget: Signal<number | null> = signal(null);
  /** Whether this player may resign now (PROTOCOL §4.9): seated, synced, and the game is live. */
  readonly canResign: Signal<boolean> = signal(false);
  /** The game's module id, from the root, once it is known. */
  readonly game: Signal<string | null> = signal(null);
  /** The seats' identity pubkeys, in seat order. */
  readonly seats: Signal<readonly Hex[]> = signal([]);
  readonly table: Signal<ParsedTable | null> = signal(null);
  /** The time of the latest refresh (Unix seconds), so deadline displays follow `tick`. */
  readonly clock: Signal<number>;

  readonly #d: ControllerDeps;
  #session: GameSession | null = null;
  #rootEv: NostrEvent | null = null;
  #root: ParsedRoot | null = null;
  /**
   * Every Table version at the root's address that the relays sent, by id. The Table is addressable, so its
   * creator can replace it after the start; the game is loaded from a version the root validates against.
   */
  readonly #tables = new Map<string, NostrEvent>();
  /** The Table this profile validated the root against on an earlier load; preferred over the relays' copies. */
  #storedTable: NostrEvent | null = null;
  readonly #joins = new Map<string, NostrEvent>();
  /** Game events that arrived before the session existed and the relays sent all they hold. */
  #buffer: NostrEvent[] = [];
  /** The seats' session keys and npubs, once the root is known: only their game events are taken. */
  #sessionKeys = new Set<string>();
  #npubs = new Set<string>();
  /** Resign events received, by id, so a counted one can be republished (D052, review M-b). */
  readonly #resigns = new Map<string, NostrEvent>();
  /** Counted Resigns this controller has republished. */
  readonly #echoed = new Set<string>();
  /** Ids of the game events received, for paging. */
  readonly #got = new Set<string>();
  /** The seated game events the relays sent, by id, so the session can be rebuilt without a discarded event. */
  readonly #events = new Map<string, NostrEvent>();
  /** This player's session key in the game, or null for a spectator. */
  #mySession: string | null = null;
  /**
   * This seat's own events the relays sent (D056), by what they could conflict with: `move:<prev>` for its moves
   * on a parent, `shares` for its Shares events, `resign` for its Resigns.
   */
  readonly #mine = new Map<string, Set<string>>();
  /**
   * Outbox slots loaded from storage with an unconfirmed move, deal or Resign: held back, neither folded in nor
   * published, until the relays have shown what this seat already published (`#vetSaved`).
   */
  readonly #unvetted = new Set<string>();
  /** Outbox events folded into the current session. */
  readonly #fed = new Set<string>();
  /** Whether a relay answered the initial sync with EOSE (not only the timeout). */
  #relayAnswered = false;
  /** A vetting query is in flight. */
  #vetting = false;
  /** Shuffle steps republished with this seat's deal (D056). */
  readonly #echoedSteps = new Set<string>();
  /** When this profile first saw each event of this game (Unix seconds), saved in storage. */
  #seen = new Map<string, number>();
  /** First-seen times not saved yet. */
  #seenDirty = false;
  #outbox = new Map<string, OutboxEntry>();
  readonly #inFlight = new Set<string>();
  #gameEose = false;
  #lobbyEose = false;
  #synced = false;
  #working = false;
  #running = false;
  #dutyQueued = false;
  #refreshQueued = false;
  /** The last status entry saved for Home, so it is written only on a change (or when it is getting old). */
  #savedStatus: { status: GameStatusName; seq: number; at: number } | null = null;
  /** Automatic duties that failed at a head (`kind@headId`), not retried until the head moves. */
  readonly #failed = new Set<string>();
  readonly #stops: (() => void)[] = [];
  #started = false;
  #disposed = false;

  /** Stored game events asked for per page (`GAME_PAGE`; tests make it small to exercise paging). */
  readonly #page: number;

  constructor(rootId: string, deps: ControllerDeps, opts: { gamePage?: number } = {}) {
    this.rootId = rootId;
    this.#d = deps;
    this.clock = signal(deps.now());
    this.#page = opts.gamePage ?? GAME_PAGE;
  }

  /** Load the game, follow its events, and tick every 30 s. */
  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    this.#outbox = loadOutbox(this.#d.storage, this.#d.profile, this.rootId);
    // Saved events that could conflict with what this seat did on another device wait for the relays (D056).
    for (const [slot, e] of this.#outbox)
      if (vetted(slot) && !e.confirmed && !e.orphan) this.#unvetted.add(slot);
    this.#seen = loadSeen(this.#d.storage, this.#d.profile, this.rootId);
    // The root first; the game's events are asked for once the root names the seats (`#subscribeGame`).
    this.#stops.push(this.#d.pool.subscribe([{ ids: [this.rootId] }], (ev) => this.#onEvent(ev)));
    this.#stops.push(this.#d.timers.every(TICK_MS, () => this.tick()));
  }

  dispose(): void {
    this.#disposed = true;
    for (const stop of this.#stops.splice(0)) stop();
  }

  /** Re-check deadlines and stored timeout claims, retry undelivered events, and resume duties. */
  tick(): void {
    if (this.#disposed) return;
    this.#session?.tick(this.#d.now());
    if (this.#synced) this.#retryUndelivered();
    this.#refresh();
    this.#queueDuties();
  }

  /**
   * Submit this player's decision. Resolves once the move is signed, saved and folded in locally (it is
   * published in the background and retried until a relay confirms it). Rejects while another submission is
   * in flight, when the session refuses the action, or when the game is not ready.
   */
  async act(action: unknown): Promise<void> {
    if (this.busy.value) throw new Error('A move is already being sent.');
    const session = this.#session;
    if (session === null || !this.#synced) throw new Error('The game is still loading.');
    this.busy.value = true;
    try {
      await this.#yield();
      if (this.#disposed) throw new Error('The game screen was closed.');
      const head = session.view().head;
      const slot = moveSlot(head.seq + 1, head.id);
      if (this.#unvetted.has(slot)) throw new Error('a move saved on this device is still being checked');
      // Never build twice for one decision: fresh randomness would make a rival move (equivocation).
      const ev = this.#reusable(slot, head.id) ?? session.buildAction(action, this.#d.rnd, this.#d.now());
      this.#commit(slot, ev);
      this.error.value = null;
    } catch (e) {
      this.error.value = `Your move was not sent: ${errorText(e)}`;
      throw e;
    } finally {
      this.busy.value = false;
      this.#refresh();
      this.#queueDuties();
    }
  }

  /** Claim a timeout against the seat `timeoutTarget` names, if any. */
  async claimTimeout(): Promise<void> {
    const session = this.#session;
    if (session === null || this.busy.value) return;
    const seat = session.timeoutTarget(this.#d.now());
    if (seat === null) return;
    this.busy.value = true;
    try {
      await this.#yield();
      if (this.#disposed) throw new Error('The game screen was closed.');
      const head = session.view().head;
      const slot = `timeout:${seat}:${head.id}`;
      const ev = this.#outbox.get(slot)?.event ?? session.buildTimeout(seat, this.#d.rnd, this.#d.now());
      this.#commit(slot, ev);
      this.error.value = null;
    } catch (e) {
      this.error.value = `The timeout claim was not sent: ${errorText(e)}`;
    } finally {
      this.busy.value = false;
      this.#refresh();
      this.#queueDuties();
    }
  }

  /**
   * Resign (PROTOCOL §4.9, D045): build the Resign once (the `resign` slot keeps it, so a reload re-sends the same
   * event), fold it in and publish it. The game ends with this seat last.
   */
  async resign(): Promise<void> {
    const session = this.#session;
    if (session === null || this.busy.value || !this.#synced) return;
    this.busy.value = true;
    try {
      await this.#yield();
      if (this.#disposed) throw new Error('The game screen was closed.');
      if (this.#unvetted.has('resign'))
        throw new Error('a resignation saved on this device is still being checked');
      const saved = this.#live('resign');
      if (saved === null && !session.canResign()) throw new Error('the game is no longer live');
      this.#commit('resign', saved ?? session.buildResign(this.#d.rnd, this.#d.now()));
      this.error.value = null;
    } catch (e) {
      this.error.value = `Your resignation was not sent: ${errorText(e)}`;
    } finally {
      this.busy.value = false;
      this.#refresh();
      this.#queueDuties();
    }
  }

  /* --------------------------------------------------------------------------------------------- loading */

  #onEvent(ev: NostrEvent): void {
    if (this.#disposed) return;
    if (ev.kind === KIND.root && ev.id === this.rootId) {
      this.#onRoot(ev);
      return;
    }
    // Relays are not trusted to filter: only seated keys' game events are taken (PROTOCOL §11).
    if (!this.#seated(ev)) return;
    this.#got.add(ev.id);
    if (this.#events.size < MAX_BUFFER) this.#events.set(ev.id, ev);
    if (ev.kind === KIND.resign) this.#resigns.set(ev.id, ev);
    if (ev.pubkey === this.#mySession) this.#noteMine(ev);
    const entry = [...this.#outbox.entries()].find(([, e]) => e.event.id === ev.id);
    if (entry !== undefined) this.#confirm(entry[0]);
    // Until the relays have sent what they hold, events wait, so they can be fed in first-seen order.
    if (this.#session === null || !this.#gameEose) {
      if (this.#buffer.length < MAX_BUFFER) this.#buffer.push(ev);
      else this.error.value = 'This game has too many events to load.';
      return;
    }
    this.#receive(this.#session, ev);
    this.#queueRefresh();
  }

  /**
   * Fold `ev` in at the time this profile first saw it (now, the first time), and record that time unless the
   * session rejects the event.
   */
  #receive(session: GameSession, ev: NostrEvent): ReturnType<GameSession['receive']> {
    const first = this.#seen.get(ev.id);
    const now = this.#d.now();
    const r = session.receive(ev, first ?? now);
    if (first === undefined && r.status !== 'rejected') this.#noteSeen(ev.id, now);
    return r;
  }

  /** Record one of this seat's own events the relays sent, by what it could conflict with (D056). */
  #noteMine(ev: NostrEvent): void {
    const key =
      ev.kind === KIND.move
        ? `move:${prevOf(ev)}`
        : ev.kind === KIND.shares
          ? 'shares'
          : ev.kind === KIND.resign
            ? 'resign'
            : null;
    if (key === null) return;
    let ids = this.#mine.get(key);
    if (ids === undefined) {
      ids = new Set();
      this.#mine.set(key, ids);
    }
    ids.add(ev.id);
  }

  /** Whether the relays sent an event of this seat's other than `ev` under `key` (`#noteMine`). */
  #otherMine(key: string, ev: NostrEvent): boolean {
    for (const id of this.#mine.get(key) ?? []) if (id !== ev.id) return true;
    return false;
  }

  #noteSeen(id: string, at: number): void {
    if (this.#seen.has(id)) return;
    this.#seen.set(id, at);
    this.#seenDirty = true;
  }

  /**
   * Save the first-seen times, merged with what another tab of this profile saved (the earlier time wins), and
   * keep at most `MAX_SEEN` besides the root's, dropping the oldest.
   */
  #saveSeen(): void {
    if (!this.#seenDirty || this.#disposed) return;
    for (const [id, at] of loadSeen(this.#d.storage, this.#d.profile, this.rootId)) {
      const mine = this.#seen.get(id);
      if (mine === undefined || at < mine) this.#seen.set(id, at);
    }
    const others = [...this.#seen].filter(([id]) => id !== this.rootId);
    if (others.length > MAX_SEEN) {
      others.sort((a, b) => a[1] - b[1]);
      for (const [id] of others.slice(0, others.length - MAX_SEEN)) this.#seen.delete(id);
    }
    if (writeJson(this.#d.storage, seenKey(this.#d.profile, this.rootId), Object.fromEntries(this.#seen)))
      this.#seenDirty = false;
  }

  /**
   * Feed this seat's saved events and the events held back while loading, in first-seen order (events never seen
   * before last). A saved event the session refuses is an orphan: it is kept (so its slot is never signed again)
   * but never republished. A refused event a relay confirmed is public anyway, so it is still fed: a deal on a
   * rival deck must count as this seat's deal (D056). An unconfirmed move, deal or Resign loaded from storage is
   * held back: once the relays have answered, `#vetSaved` folds it in and republishes it, or discards it (D056).
   */
  #feedHeld(): void {
    const session = this.#session;
    if (session === null) return;
    const held: { ev: NostrEvent; slot: string | null }[] = [];
    for (const [slot, entry] of this.#outbox) {
      if (this.#unvetted.has(slot) || (entry.orphan && !entry.confirmed)) continue;
      held.push({ ev: entry.event, slot });
    }
    for (const ev of this.#buffer.splice(0)) held.push({ ev, slot: null });
    const at = (ev: NostrEvent): number => this.#seen.get(ev.id) ?? Number.POSITIVE_INFINITY;
    // Among events seen at the same time (or never, on a fresh load) a resign goes last. The session would wait for
    // its head anyway (PROTOCOL §8.3), but a resign whose head is already on the chain counts at once, outside the
    // per-seat cap on waiting resigns, so junk resigns the same seat flooded cannot crowd it out on a fresh device.
    const rank = (ev: NostrEvent): number => (ev.kind === KIND.resign ? 1 : 0);
    held.sort((a, b) => at(a.ev) - at(b.ev) || rank(a.ev) - rank(b.ev));
    for (const { ev, slot } of held) {
      if (slot !== null) this.#fed.add(ev.id);
      if (this.#receive(session, ev).status !== 'rejected' || slot === null) continue;
      const entry = this.#outbox.get(slot);
      if (entry === undefined || entry.orphan) continue;
      entry.orphan = true;
      this.#persist(slot);
    }
    if (this.#relayAnswered) this.#vetSaved();
  }

  /**
   * Vet this seat's unconfirmed saved moves, deal and Resign against what the relays sent (D056, the stale outbox),
   * moves in seq order first, so a run of this seat's own moves is vetted one on top of the other:
   * - a move is republished only if no other move of this seat on its parent is at the relays and, when it is not
   *   folded in yet (it was loaded from storage), its parent is the current head;
   * - the deal only if no other Shares event of this seat is at the relays;
   * - a Resign only if no other Resign of this seat is at the relays and it names the current head.
   * An event not folded in yet must then be accepted by the session. Anything else is discarded: removed from the
   * outbox and storage, and logged. A discarded event the session had already folded in (built in this tab while
   * offline) leaves the session holding an event nobody else will, so the session is rebuilt without it.
   * An event the session now refuses outright is an orphan, as in `#retryUndelivered`.
   */
  #vetSaved(): void {
    const session = this.#session;
    if (session === null || this.#disposed) return;
    const rank = (slot: string): number =>
      slot.startsWith('move:') ? Number(slot.split(':')[1]) : slot === 'deal' ? 1e12 : 2e12;
    const slots = [...this.#outbox]
      .filter(([slot, e]) => vetted(slot) && !e.confirmed && !e.orphan)
      .map(([slot]) => slot)
      .sort((a, b) => rank(a) - rank(b));
    let rebuild = false;
    for (const slot of slots) {
      const entry = this.#outbox.get(slot);
      if (entry === undefined) continue;
      const ev = entry.event;
      const fed = this.#fed.has(ev.id);
      this.#unvetted.delete(slot);
      if (fed && this.#receive(session, ev).status === 'rejected') {
        entry.orphan = true;
        this.#persist(slot);
        continue;
      }
      let why = this.#stale(session, slot, ev, fed);
      if (why === null && !fed) {
        this.#fed.add(ev.id);
        const r = this.#receive(session, ev);
        if (r.status === 'rejected') why = `the game refuses it (${r.reason})`;
      }
      if (why === null) {
        void this.#publish(slot);
        continue;
      }
      if (fed) rebuild = true;
      this.#discard(slot, why);
    }
    if (rebuild) this.#rebuild();
  }

  /** Why a saved move, deal or Resign no longer fits the game (`#vetSaved`), or null when it may be published. */
  #stale(session: GameSession, slot: string, ev: NostrEvent, fed: boolean): string | null {
    const head = session.view().head;
    if (slot.startsWith('move:')) {
      const prev = prevOf(ev);
      if (this.#otherMine(`move:${prev}`, ev)) return 'another move of yours at that point is on the relays';
      if (!fed && (prev !== head.id || Number(slot.split(':')[1]) !== head.seq + 1))
        return 'the game has moved on';
      return null;
    }
    if (slot === 'deal')
      return this.#otherMine('shares', ev) ? 'another deal of yours is on the relays' : null;
    if (this.#otherMine('resign', ev)) return 'another resignation of yours is on the relays';
    if (headOf(ev) !== head.id) return 'the game has moved on';
    if (!fed && !session.canResign()) return 'the game is over';
    return null;
  }

  /** Remove a saved event from the outbox and storage without publishing it, and log why (D056). */
  #discard(slot: string, why: string): void {
    const entry = this.#outbox.get(slot);
    this.#outbox.delete(slot);
    this.#unvetted.delete(slot);
    if (entry === undefined) return;
    const key = outboxKey(this.#d.profile, this.rootId);
    const stored = readJson(this.#d.storage, key);
    if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
      const all = { ...(stored as Record<string, unknown>) };
      const there = all[slot] as { event?: { id?: unknown } } | undefined;
      if (there?.event?.id === entry.event.id) {
        delete all[slot];
        writeJson(this.#d.storage, key, all);
      }
    }
    const what = slot === 'deal' ? 'deal' : slot === 'resign' ? 'resignation' : 'move';
    const line = `A ${what} saved on this device was never sent, and it was discarded: ${why}.`;
    this.log.value = [...this.log.value, line].slice(-MAX_LOG);
    this.notice.value = line;
  }

  /** Build the session again from the relays' events and the outbox, after a folded-in event was discarded. */
  #rebuild(): void {
    if (this.#session === null || this.#disposed) return;
    this.#session = null;
    this.#fed.clear();
    this.#buffer = [...this.#events.values()];
    this.#tryCreate();
  }

  /**
   * Ask the relays again for this seat's own events before republishing an unconfirmed move, deal or Resign (D056):
   * its moves on the parents those moves name, its Shares events and Resigns, and, while a saved event is not folded
   * in yet, the whole game. Once a relay has answered, `#vetSaved` decides; with no answer, nothing is published.
   */
  #startVet(): void {
    const root = this.#root;
    const me = this.#mySession;
    if (this.#vetting || this.#disposed || !this.#synced || root === null || me === null) return;
    const saved = [...this.#outbox].filter(([slot, e]) => vetted(slot) && !e.confirmed && !e.orphan);
    if (saved.length === 0) return;
    this.#vetting = true;
    const prevs = new Set<string>();
    for (const [, e] of saved) {
      const prev = e.event.kind === KIND.move ? prevOf(e.event) : null;
      if (prev !== null) prevs.add(prev);
    }
    const filters: Filter[] = [{ kinds: [KIND.shares, KIND.resign], authors: [me], '#e': [this.rootId] }];
    if (prevs.size > 0) filters.push({ kinds: [KIND.move], authors: [me], '#e': [...prevs] });
    if (saved.some(([slot]) => this.#unvetted.has(slot)))
      filters.push({
        kinds: [...SESSION_KINDS],
        authors: [...this.#sessionKeys],
        '#e': [this.rootId],
        limit: this.#page,
      });
    let stop = (): void => {};
    stop = this.#d.pool.subscribe(
      filters,
      (ev) => this.#onEvent(ev),
      (info) => {
        stop();
        this.#vetting = false;
        if (this.#disposed) return;
        if (info.eose > 0) {
          this.#relayAnswered = true;
          this.#vetSaved();
        }
        this.#refresh();
        this.#queueDuties();
      },
    );
    this.#stops.push(stop);
  }

  /** Whether `ev` is a game event of this game signed by the key its kind needs: a seat's session key or npub. */
  #seated(ev: NostrEvent): boolean {
    if (!ev.tags.some((t) => t[0] === 'e' && t[1] === this.rootId)) return false;
    if (SESSION_KINDS.includes(ev.kind)) return this.#sessionKeys.has(ev.pubkey);
    return ev.kind === KIND.attest && this.#npubs.has(ev.pubkey);
  }

  /**
   * Follow the game's events from the seated keys only, so strangers' events cannot crowd a relay's answer. The
   * first page stays open for new events; while a page brings events not seen before, an older page follows, up
   * to the oldest date among those new events. Loading is complete when a page brings nothing new. The pool
   * merges relays, so one `until` serves them all (D036: a gap across relays).
   */
  #subscribeGame(root: ParsedRoot): void {
    this.#sessionKeys = new Set(root.seats.map((s) => s.session));
    this.#npubs = new Set(root.seats.map((s) => s.npub));
    const filters = (until: number | null): Filter[] => {
      const page = { '#e': [this.rootId], limit: this.#page, ...(until === null ? {} : { until }) };
      return [
        { kinds: [...SESSION_KINDS], authors: [...this.#sessionKeys], ...page },
        { kinds: [KIND.attest], authors: [...this.#npubs], ...page },
      ];
    };
    const page = (until: number | null): void => {
      let fresh = 0;
      let oldest = Number.POSITIVE_INFINITY;
      let stop = (): void => {};
      const onEvent = (ev: NostrEvent): void => {
        if (this.#disposed) return;
        // Only seated events this client had not seen move the page: a stranger's event, or an old one dated far
        // back, must not steer `until`.
        if (this.#seated(ev) && !this.#got.has(ev.id)) {
          fresh++;
          if (ev.created_at < oldest) oldest = ev.created_at;
        }
        this.#onEvent(ev);
      };
      const onEose = (info: EoseInfo): void => {
        if (this.#disposed) return;
        if (info.eose > 0) this.#relayAnswered = true;
        if (until !== null) stop();
        if (fresh > 0 && Number.isFinite(oldest)) {
          page(oldest);
          return;
        }
        this.#gameEose = true;
        if (this.#session !== null) this.#feedHeld();
        this.#maybeSynced();
      };
      stop = this.#d.pool.subscribe(filters(until), onEvent, onEose);
      this.#stops.push(stop);
    };
    page(null);
  }

  #onRoot(ev: NostrEvent): void {
    if (this.#rootEv !== null) return;
    let root: ParsedRoot;
    try {
      root = parseRoot(ev);
    } catch (e) {
      this.error.value = `This game's start event is invalid: ${errorText(e)}`;
      return;
    }
    this.#rootEv = ev;
    this.#root = root;
    this.game.value = root.game;
    this.#noteSeen(ev.id, this.#d.now());
    this.#storedTable = loadTable(this.#d.storage, this.#d.profile, this.rootId, root.tableAddress);
    if (this.#storedTable !== null) this.table.value = parseTable(this.#storedTable);
    this.#mySession = root.seats.find((s) => s.npub === this.#d.signer.pubkey)?.session ?? null;
    this.#subscribeGame(root);
    const seats = root.seats.map((s) => s.npub);
    this.seats.value = seats;
    this.#d.pool.addRelays?.(root.relays);
    const [, creator, tableId] = root.tableAddress.split(':');
    this.#stops.push(
      this.#d.pool.subscribe(
        [
          { kinds: [KIND.table], authors: [creator as string], '#d': [tableId as string] },
          // Only the Joins the root seats, by id: anyone can tag the public table address with Joins.
          { kinds: [KIND.join], ids: [...root.joinIds] },
        ],
        (lobbyEv) => this.#onLobby(lobbyEv),
        () => {
          this.#lobbyEose = true;
          this.#tryCreate();
        },
      ),
    );
  }

  /**
   * Take a Table or Join for this game's lobby. Relays are not trusted to filter: a Table counts only at the
   * root's address (same creator and `d` tag), and a Join only if the root seats it and it names that address.
   */
  #onLobby(ev: NostrEvent): void {
    const root = this.#root;
    if (this.#disposed || root === null) return;
    if (ev.kind === KIND.table) {
      let t: ParsedTable;
      try {
        t = parseTable(ev);
      } catch {
        return;
      }
      if (t.address !== root.tableAddress || this.#tables.has(ev.id)) return;
      this.#tables.set(ev.id, ev);
      // Until the game loads, show the saved Table, else the newest from the relays.
      if (this.#session === null && this.#storedTable === null && this.#relayTables()[0] === ev)
        this.table.value = t;
    } else if (ev.kind === KIND.join) {
      const a = ev.tags.find((tag) => tag[0] === 'a')?.[1];
      if (a !== root.tableAddress || !root.joinIds.includes(ev.id)) return;
      this.#joins.set(ev.id, ev);
    } else return;
    this.#tryCreate();
  }

  /** The relays' Table versions, newest first (ties: lowest id). */
  #relayTables(): NostrEvent[] {
    return [...this.#tables.values()].sort((a, b) =>
      a.created_at !== b.created_at ? b.created_at - a.created_at : a.id < b.id ? -1 : 1,
    );
  }

  /**
   * Build the session once a Table the root validates against and every seat's Join are known. The saved Table
   * comes first; without one, every Table version the relays sent is tried, newest first. The one that works is
   * saved, so a creator who republishes the Table later cannot stop this profile from loading the game.
   */
  #tryCreate(): void {
    const root = this.#root;
    const rootEv = this.#rootEv;
    if (this.#session !== null || root === null || rootEv === null || this.#disposed) return;
    const stored = this.#storedTable;
    const tables = [
      ...(stored === null ? [] : [stored]),
      ...this.#relayTables().filter((t) => t.id !== stored?.id),
    ];
    const missing = tables.length === 0 || root.joinIds.some((id) => !this.#joins.has(id));
    if (missing) {
      if (this.#lobbyEose)
        this.error.value = "Still looking for this game's table and players on the relays…";
      return;
    }
    const base = {
      modules: this.#d.modules,
      joins: [...this.#joins.values()],
      root: rootEv,
      rootSeenAt: this.#seen.get(root.id) ?? this.#d.now(),
    };
    // The Table the root validates against: validation does not depend on the seat.
    let table: NostrEvent | null = null;
    let problem = '';
    for (const t of tables) {
      try {
        GameSession.create({ ...base, table: t, me: null });
        table = t;
        break;
      } catch (e) {
        problem ||= errorText(e);
      }
    }
    if (table === null) {
      // Another relay may still send an older version that fits.
      if (this.#lobbyEose) this.error.value = `This game cannot be loaded: ${problem}`;
      return;
    }
    const input = { ...base, table };
    const me = this.#identity(root);
    let session: GameSession;
    try {
      session = GameSession.create({ ...input, me });
    } catch (e) {
      if (me === null) {
        this.error.value = `This game cannot be loaded: ${errorText(e)}`;
        return;
      }
      try {
        session = GameSession.create({ ...input, me: null });
        this.error.value = 'Your saved keys do not match your seat in this game, so you are watching it.';
      } catch (e2) {
        this.error.value = `This game cannot be loaded: ${errorText(e2)}`;
        return;
      }
    }
    if (this.error.value?.startsWith('Still looking') || this.error.value?.startsWith('This game cannot'))
      this.error.value = null;
    this.#session = session;
    if (table.id !== stored?.id && writeJson(this.#d.storage, tableKey(this.#d.profile, this.rootId), table))
      this.#storedTable = table;
    this.table.value = parseTable(table);
    if (me !== null) saveRootId(this.#d.profile, this.#d.storage, root.tableAddress, root.id);
    // Own events (they may never have reached a relay) and whatever arrived meanwhile, once the relays sent all.
    if (this.#gameEose) this.#feedHeld();
    this.#refresh();
    this.#maybeSynced();
  }

  /** This player's seat and secrets, or null to watch as a spectator. */
  #identity(root: ParsedRoot): Identity | null {
    const seat = root.seats.findIndex((s) => s.npub === this.#d.signer.pubkey);
    if (seat < 0) return null;
    const secrets = loadSecrets(this.#d.profile, this.#d.storage, root.tableAddress);
    if (secrets === null) {
      this.error.value = 'This browser does not hold your keys for this game, so you are watching it.';
      return null;
    }
    return { seat, sessionSk: secrets.sessionSk, deckSecret: BigInt(`0x${bytesToHex(secrets.deckSecret)}`) };
  }

  #maybeSynced(): void {
    if (this.#synced || this.#session === null || !this.#gameEose) return;
    this.#synced = true;
    this.#retryUndelivered();
    this.#refresh();
    this.#queueDuties();
  }

  /* ------------------------------------------------------------------------------------------- refresh */

  #queueRefresh(): void {
    if (this.#refreshQueued) return;
    this.#refreshQueued = true;
    queueMicrotask(() => {
      this.#refreshQueued = false;
      this.#refresh();
      this.#queueDuties();
    });
  }

  #refresh(): void {
    const session = this.#session;
    const now = this.#d.now();
    this.clock.value = now;
    this.#saveSeen();
    if (session === null) return;
    const v = session.view();
    const duties = session.duties();
    this.view.value = v;
    this.legal.value = this.#synced && !this.#ownMovePending(v) ? session.legalActions() : [];
    this.timeoutTarget.value = this.#synced ? session.timeoutTarget(now) : null;
    this.canResign.value = this.#synced && session.canResign();
    this.status.value = this.#statusOf(v, duties);
    this.#echoResign(v);
    this.#cacheStatus(v.head.seq, this.status.value, now);
    this.#maybePrune(v, duties);
  }

  /**
   * Republish the Resign that counted on this client to the root's relays and this player's (D052, review M-b),
   * once per load, as other final evidence: a resigner that sent its Resign to only some relays cannot leave the
   * players who never saw it to be timed out while the game looks live to them.
   */
  #echoResign(v: SessionView): void {
    const id = v.resignId;
    const root = this.#root;
    if (!this.#synced || id === null || root === null || this.#echoed.has(id) || this.#disposed) return;
    const ev = this.#resigns.get(id);
    if (ev === undefined) return;
    this.#echoed.add(id);
    void this.#d.pool.publish(ev, unionRelays(root.relays, this.#d.relays())).catch(() => {
      // Best effort: the resign is held here either way.
    });
  }

  /**
   * Save the status for the Home screen (`bg:<profile>:gamestatus:<rootId>`) when it or the head changed, or the
   * saved entry is older than `STATUS_REFRESH_S`. Not while loading: `syncing` says nothing.
   */
  #cacheStatus(seq: number, status: GameStatus, now: number): void {
    if (status === 'syncing' || this.#disposed) return;
    const last = this.#savedStatus;
    if (last?.status === status && last.seq === seq && now - last.at < STATUS_REFRESH_S) return;
    if (saveGameStatus(this.#d.profile, this.#d.storage, this.rootId, { status, seq, updatedAt: now }))
      this.#savedStatus = { status, seq, at: now };
  }

  #statusOf(v: SessionView, duties: readonly Duty[]): GameStatus {
    if (!this.#synced) return 'syncing';
    if (v.phase === 'cancelled') return 'cancelled';
    if (this.#working || this.#nextAuto(duties, v) !== null) return 'working';
    if (this.#stuck(duties, v)) return 'stuck';
    if (v.phase === 'done') return 'done';
    if (duties.some((d) => d.kind === 'decide') && !this.#ownMovePending(v)) return 'your-turn';
    return 'waiting';
  }

  /** An automatic duty is due but failed at this head. */
  #stuck(duties: readonly Duty[], v: SessionView): boolean {
    return duties.some((d) => AUTO.includes(d.kind) && this.#failed.has(`${d.kind}@${v.head.id}`));
  }

  /** A move of mine on the current head is saved but not folded in (it waits for something): do not decide again. */
  #ownMovePending(v: SessionView): boolean {
    const e = this.#outbox.get(moveSlot(v.head.seq + 1, v.head.id));
    return e !== undefined && !e.orphan;
  }

  /** Once the game is over and every saved event is delivered (or refused), the outbox is no longer needed. */
  #maybePrune(v: SessionView, duties: readonly Duty[]): void {
    if (this.#disposed || this.#outbox.size === 0) return;
    if (v.phase !== 'done' && v.phase !== 'cancelled') return;
    if (this.#working || this.#nextAuto(duties, v) !== null) return;
    if (![...this.#outbox.values()].every((e) => e.confirmed || e.orphan)) return;
    this.#outbox.clear();
    removeItem(this.#d.storage, outboxKey(this.#d.profile, this.rootId));
  }

  /* -------------------------------------------------------------------------------------------- duties */

  #nextAuto(duties: readonly Duty[], v: SessionView): Duty['kind'] | null {
    for (const kind of AUTO) {
      if (kind === 'attest' && (this.#session === null || !canAttest(this.#session))) continue;
      if (this.#blocked(kind, v)) continue;
      if (duties.some((d) => d.kind === kind) && !this.#failed.has(`${kind}@${v.head.id}`)) return kind;
    }
    return null;
  }

  /**
   * Whether an automatic duty must not be built now (D056): its saved event is still being vetted, or, for the deal,
   * this seat's deal already reached a relay and the session refuses it (it is on a rival deck of a shuffle fork):
   * a seat never deals twice.
   */
  #blocked(kind: Duty['kind'], v: SessionView): boolean {
    if (kind === 'shuffle') return this.#unvetted.has(moveSlot(v.head.seq + 1, v.head.id));
    if (kind !== 'deal') return false;
    if (this.#unvetted.has('deal')) return true;
    const held = this.#outbox.get('deal');
    return held?.confirmed === true && held.orphan && held.event.pubkey === this.#mySession;
  }

  #queueDuties(): void {
    if (this.#dutyQueued || this.#running || !this.#synced || this.#disposed) return;
    this.#dutyQueued = true;
    this.#d.timers.later(0, () => {
      this.#dutyQueued = false;
      void this.#runDuties();
    });
  }

  /** Perform automatic duties one at a time until none is due. */
  async #runDuties(): Promise<void> {
    const session = this.#session;
    if (session === null || this.#running || this.#disposed || this.busy.value) return;
    this.#running = true;
    const done = new Set<string>();
    try {
      for (;;) {
        const v = session.view();
        const kind = this.#nextAuto(session.duties(), v);
        if (kind === null) break;
        this.#working = true;
        this.#refresh();
        // Let the screen show "working" before a long proof blocks the thread.
        await this.#yield();
        if (this.#disposed) return;
        const head = session.view().head;
        const key = `${kind}@${head.id}`;
        try {
          // A duty still due after its event was folded in would loop forever: stop at the second try.
          if (done.has(key)) throw new ClientError('the duty is still due after its event was sent');
          done.add(key);
          await this.#perform(session, kind);
        } catch (e) {
          this.#failed.add(key);
          this.error.value = `Could not ${kind === 'deal' ? 'deal' : `send the ${kind}`}: ${errorText(e)}`;
        }
      }
    } finally {
      this.#running = false;
      this.#working = false;
      this.#refresh();
    }
  }

  async #perform(session: GameSession, kind: Duty['kind']): Promise<void> {
    const head = session.view().head;
    const { rnd, now } = this.#d;
    if (kind === 'shuffle') {
      const slot = moveSlot(head.seq + 1, head.id);
      return this.#commit(slot, this.#reusable(slot, head.id) ?? session.buildShuffle(rnd, now()));
    }
    // A secret or attestation the session refused (an orphan: a changed result) is built anew: a seat's secret is
    // one value, and its latest attestation is the one that counts. A deal is not (D056, review F7): a seat deals
    // at most once per game, since the shuffle equivocator could translate shares between rival decks. A refused
    // deal is rebuilt only if it never left this device (no relay confirmed it) and is not this seat's (a stray
    // event in storage); the session itself owes no deal once it holds this seat's deal on a rival deck.
    if (kind === 'deal') return this.#single('deal', () => session.buildDeal(rnd, now()));
    if (kind === 'secret') return this.#single('secret', () => session.buildSecret(rnd, now()));
    if (kind === 'attest') {
      // A new attestation must be later than the refused one, or it would not replace it (latest wins).
      const after = (): number => (this.#outbox.get('attest')?.event.created_at ?? 0) + 1;
      return this.#single('attest', () => this.#attestEvent(session, after()));
    }
  }

  /**
   * Commit the saved event for a single-slot duty, or a new one. If the session refuses the event it committed
   * (saved by this or another tab, now an orphan), build anew once, in this same step, rather than leaving the
   * duty failed until the head moves.
   */
  async #single(slot: string, build: () => NostrEvent | Promise<NostrEvent>): Promise<void> {
    try {
      return this.#commit(slot, this.#live(slot) ?? (await build()));
    } catch (e) {
      const refused = this.#outbox.get(slot);
      if (!(e instanceof ClientError) || refused?.orphan !== true) throw e;
      // Never deal twice (D056): a refused deal of this seat's that a relay has is its deal for the game.
      if (slot === 'deal' && refused.confirmed && refused.event.pubkey === this.#mySession) throw e;
    }
    return this.#commit(slot, await build());
  }

  /** The event saved for a single-slot duty (`deal`, `secret`, `attest`), unless the session refused it. */
  #live(slot: string): NostrEvent | null {
    const entry = this.#outbox.get(slot);
    return entry !== undefined && !entry.orphan ? entry.event : null;
  }

  /**
   * The attestation: the session's `attestTemplate(createdAt)`, signed by the player's npub (§4.8), dated now or
   * `notBefore`, whichever is later.
   */
  async #attestEvent(session: GameSession, notBefore = 0): Promise<NostrEvent> {
    const api = session as unknown as AttestApi;
    if (typeof api.attestTemplate !== 'function') throw new ClientError('this session cannot attest');
    const ev = await this.#d.signer.sign(api.attestTemplate(Math.max(this.#d.now(), notBefore)));
    // The signer may have kept a prompt open while the screen closed.
    if (this.#disposed) throw new Error('the game screen was closed');
    return ev;
  }

  /**
   * A move already built for `slot` on the parent `prevId`, from this tab or another tab of the same profile.
   * Reusing it is what keeps this seat from ever signing two moves on one parent (equivocation, §6.6).
   */
  #reusable(slot: string, prevId: string): NostrEvent | null {
    const fresh = loadOutbox(this.#d.storage, this.#d.profile, this.rootId).get(slot);
    if (fresh !== undefined && !this.#outbox.has(slot)) this.#outbox.set(slot, fresh);
    const held = this.#outbox.get(slot)?.event;
    return held !== undefined && prevOf(held) === prevId ? held : null;
  }

  /**
   * Save the event to the outbox, fold it in locally, then publish it. If the session rejects it, it is marked
   * an orphan and not published, and this throws (the duty is then not retried at this head). A move that
   * cannot be saved is dropped unpublished: an unsaved move could be signed again after a reload.
   */
  #commit(slot: string, built: NostrEvent): void {
    if (this.#disposed) throw new Error('the game screen was closed');
    const session = this.#session;
    if (session === null) throw new Error('the game is not loaded');
    // Another tab of this profile may have saved an event for the same slot meanwhile: use that one instead.
    // A refused event saved for a single-slot duty is replaced; a move slot always keeps what it holds.
    let saved = loadOutbox(this.#d.storage, this.#d.profile, this.rootId).get(slot);
    if (saved?.orphan === true && !slot.startsWith('move:')) saved = undefined;
    const ev = saved?.event ?? built;
    const held = this.#outbox.get(slot);
    const entry: OutboxEntry =
      held?.event.id === ev.id && !(held.orphan && saved === undefined)
        ? held
        : { event: ev, confirmed: saved?.confirmed ?? false, orphan: saved?.orphan ?? false };
    this.#outbox.set(slot, entry);
    if (!this.#persist(slot)) {
      if (slot.startsWith('move:')) {
        this.#outbox.delete(slot);
        this.notice.value = 'This browser could not save your move, so it was not sent. Free some storage.';
        throw new Error('the move could not be saved in this browser');
      }
      this.notice.value = 'This browser could not save your last event; keep this tab open until it is sent.';
    }
    this.#unvetted.delete(slot);
    this.#fed.add(ev.id);
    const r = this.#receive(session, ev);
    if (r.status === 'rejected') {
      entry.orphan = true;
      this.#persist(slot);
      throw new ClientError(`own event rejected: ${r.reason}`);
    }
    void this.#publish(slot);
    this.#refresh();
  }

  /** Merge one slot into the stored outbox (other tabs may have written other slots). */
  #persist(slot: string): boolean {
    if (this.#disposed) return true;
    const entry = this.#outbox.get(slot);
    if (entry === undefined) return true;
    const key = outboxKey(this.#d.profile, this.rootId);
    const stored = readJson(this.#d.storage, key);
    const all: Record<string, unknown> =
      typeof stored === 'object' && stored !== null && !Array.isArray(stored)
        ? { ...(stored as Record<string, unknown>) }
        : {};
    all[slot] = entry;
    return writeJson(this.#d.storage, key, all);
  }

  #confirm(slot: string): void {
    const entry = this.#outbox.get(slot);
    // A relay has it: it is public, so there is nothing left to vet (D056).
    this.#unvetted.delete(slot);
    if (entry === undefined || entry.confirmed) return;
    entry.confirmed = true;
    this.#persist(slot);
    if ([...this.#outbox.values()].every((e) => e.confirmed || e.orphan)) this.notice.value = null;
  }

  /** Publish the slot's event to the root's relays and this player's relays. */
  async #publish(slot: string): Promise<void> {
    const entry = this.#outbox.get(slot);
    const root = this.#root;
    if (this.#disposed || entry === undefined || entry.orphan || root === null || this.#inFlight.has(slot))
      return;
    this.#inFlight.add(slot);
    try {
      if (slot === 'deal' && this.#session !== null) this.#echoDeck(this.#session, root);
      const results = await this.#d.pool.publish(entry.event, unionRelays(root.relays, this.#d.relays()));
      if (this.#disposed) return;
      if (results.some((r) => r.ok)) this.#confirm(slot);
      else this.notice.value = 'Not delivered to any relay yet; retrying.';
    } finally {
      this.#inFlight.delete(slot);
    }
  }

  /**
   * Republish the shuffle steps this seat deals on, before its deal (D056): every client that receives the deal
   * then holds the deck it was built on, so a shuffle fork the equivocator showed to some seats only is held by
   * every client the deal reaches, and the stall falls on the equivocator there too. Once per step per load.
   */
  #echoDeck(session: GameSession, root: ParsedRoot): void {
    for (const id of session.deckSteps()) {
      if (this.#echoedSteps.has(id)) continue;
      const ev = this.#events.get(id) ?? [...this.#outbox.values()].find((e) => e.event.id === id)?.event;
      if (ev === undefined) continue;
      this.#echoedSteps.add(id);
      void this.#d.pool.publish(ev, unionRelays(root.relays, this.#d.relays())).catch(() => {
        // Best effort: the deal itself is what this seat owes.
      });
    }
  }

  /**
   * Republish what no relay has confirmed. Each event is first fed to the session again: one it has since
   * refused (a pooled move whose parent lost, for example) becomes an orphan and is retried no more. A move, deal
   * or Resign is republished only once the relays have been asked again what this seat published (D056).
   */
  #retryUndelivered(): void {
    const session = this.#session;
    let vet = false;
    for (const [slot, entry] of this.#outbox) {
      if (entry.confirmed || entry.orphan) continue;
      if (vetted(slot)) {
        // Just vetted and being published (after a load): no need to ask the relays again yet.
        if (!this.#inFlight.has(slot)) vet = true;
        continue;
      }
      if (session !== null && this.#receive(session, entry.event).status === 'rejected') {
        entry.orphan = true;
        this.#persist(slot);
        continue;
      }
      void this.#publish(slot);
    }
    if (vet) this.#startVet();
  }

  #yield(): Promise<void> {
    return new Promise((resolve) => this.#d.timers.later(0, resolve));
  }
}
