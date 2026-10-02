/*
 * The game controller: binds the relay pool to a `GameSession` for one game (PROTOCOL §6–§9).
 *
 * - It loads the root, the table and the Joins, builds the session for this player's seat (from the saved game
 *   secrets) or as a spectator, and folds in every game event from the relays.
 * - It performs this seat's automatic duties one at a time (shuffle, deal, share, secret, attest). Only `decide`
 *   waits for the player, through `act`. The `share` duty is quiet: it never shows "working" and never hides "your
 *   turn", and its slots leave the outbox once a relay confirms them (D039).
 * - Every event it builds is saved to an outbox in storage before it is published. A reopened tab republishes
 *   an unconfirmed event, and a duty whose event is already in the outbox reuses it: nothing is signed twice.
 *   A move is kept under the head it was built on, and one the session no longer accepts (an orphan, after the
 *   chain moved on) is never republished.
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
import type { Filter } from '@bored-games/relay';
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
 * - `working`: performing an automatic duty (shuffle, deal, secret, attest; never the quiet `share`)
 * - `stuck`: an automatic duty other than `share` failed at this head and is not retried until the game moves on
 * - `your-turn`: this seat's decision, with no move of its own already waiting at this head
 */
export type GameStatus = 'syncing' | 'working' | 'stuck' | 'waiting' | 'your-turn' | 'done' | 'cancelled';

/** How often `tick` runs while the controller is started, in ms. */
export const TICK_MS = 30_000;

/** The game event kinds a game subscription asks for (PROTOCOL §9). */
export const GAME_KINDS = [KIND.move, KIND.shares, KIND.timeout, KIND.reveal, KIND.attest];

/** The game event kinds signed by a seat's session key; attestations (`KIND.attest`) are signed by its npub. */
const SESSION_KINDS: readonly number[] = [KIND.move, KIND.shares, KIND.timeout, KIND.reveal];

/**
 * Stored game events asked for per page. A page that brings any event not seen before is followed by an older
 * page (`until` its oldest date), so a relay that caps its answers below this still yields every event.
 */
export const GAME_PAGE = 500;

/** Automatic duties, in the order they are performed. */
const AUTO: readonly Duty['kind'][] = ['shuffle', 'deal', 'share', 'secret', 'attest'];

/**
 * Automatic duties done quietly (D039): small and fast, so they never set `working` or yield, and a failure is not
 * `stuck` (the shares still ride on the seat's next move). They never hide "your turn" or make it flicker.
 */
const QUIET: readonly Duty['kind'][] = ['share'];

/** The outbox slot prefix of a `share` duty's event (`shares:<positions>`); pruned once a relay confirms it. */
const SHARES_SLOT = 'shares:';

/** One built event, whether a relay has confirmed it, and whether the session has refused it (an orphan). */
export interface OutboxEntry {
  event: NostrEvent;
  confirmed: boolean;
  orphan: boolean;
}

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
 * The saved outbox of a game, by slot: `move:<seq>:<prev>`, `deal`, `shares:<positions>` (until confirmed),
 * `secret`, `attest` and `timeout:<seat>:<head>`.
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

/** The most characters of a profile name shown. */
export const MAX_PROFILE_NAME = 32;

/**
 * The name in kind 0 metadata: `display_name`, else `name`. Control and format characters (bidi overrides,
 * zero-width characters) are removed and whitespace collapsed, then it is cut to `MAX_PROFILE_NAME`
 * characters. Null when there is none.
 */
export function profileName(content: string): string | null {
  let meta: unknown;
  try {
    meta = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof meta !== 'object' || meta === null) return null;
  const { display_name, name } = meta as Record<string, unknown>;
  for (const raw of [display_name, name]) {
    if (typeof raw !== 'string') continue;
    const clean = raw
      .replace(/\s/gu, ' ')
      .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
      .replace(/ +/g, ' ')
      .trim();
    if (clean !== '') return [...clean].slice(0, MAX_PROFILE_NAME).join('').trim();
  }
  return null;
}

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
  /** Delivery state: set while one of this player's events has reached no relay yet. */
  readonly notice: Signal<string | null> = signal(null);
  /** This seat's legal actions now (empty unless it is this player's decision). */
  readonly legal: Signal<readonly unknown[]> = signal([]);
  /** A seat this player may claim a timeout against now, or null. */
  readonly timeoutTarget: Signal<number | null> = signal(null);
  /** Each seat's profile name from its kind 0 metadata (`profileName`), or null; in seat order. */
  readonly profileNames: Signal<readonly (string | null)[]> = signal([]);
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
  /** The newest kind 0 metadata event per seat pubkey. */
  readonly #profiles = new Map<string, NostrEvent>();
  /** Game events that arrived before the session existed and the relays sent all they hold. */
  #buffer: NostrEvent[] = [];
  /** The seats' session keys and npubs, once the root is known: only their game events are taken. */
  #sessionKeys = new Set<string>();
  #npubs = new Set<string>();
  /** Ids of the game events received, for paging. */
  readonly #got = new Set<string>();
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
   * but never republished.
   */
  #feedHeld(): void {
    const session = this.#session;
    if (session === null) return;
    const held: { ev: NostrEvent; slot: string | null }[] = [];
    for (const [slot, entry] of this.#outbox) if (!entry.orphan) held.push({ ev: entry.event, slot });
    for (const ev of this.#buffer.splice(0)) held.push({ ev, slot: null });
    const at = (ev: NostrEvent): number => this.#seen.get(ev.id) ?? Number.POSITIVE_INFINITY;
    held.sort((a, b) => at(a.ev) - at(b.ev));
    for (const { ev, slot } of held) {
      if (this.#receive(session, ev).status !== 'rejected' || slot === null) continue;
      const entry = this.#outbox.get(slot);
      if (entry === undefined) continue;
      entry.orphan = true;
      this.#persist(slot);
    }
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
      const onEose = (): void => {
        if (this.#disposed) return;
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
    this.#noteSeen(ev.id, this.#d.now());
    this.#storedTable = loadTable(this.#d.storage, this.#d.profile, this.rootId, root.tableAddress);
    if (this.#storedTable !== null) this.table.value = parseTable(this.#storedTable);
    this.#subscribeGame(root);
    const seats = root.seats.map((s) => s.npub);
    this.seats.value = seats;
    this.#stops.push(
      this.#d.pool.subscribe([{ kinds: [0], authors: seats }], (p) => this.#onProfile(p, seats)),
    );
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

  /** A seat's kind 0 metadata; the newest per pubkey names it. Relays are not trusted to filter. */
  #onProfile(ev: NostrEvent, seats: readonly Hex[]): void {
    if (this.#disposed || ev.kind !== 0 || !seats.includes(ev.pubkey)) return;
    if ((this.#profiles.get(ev.pubkey)?.created_at ?? -1) >= ev.created_at) return;
    this.#profiles.set(ev.pubkey, ev);
    this.profileNames.value = seats.map((pk) => {
      const p = this.#profiles.get(pk);
      return p === undefined ? null : profileName(p.content);
    });
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
    this.status.value = this.#statusOf(v, duties);
    this.#cacheStatus(v.head.seq, this.status.value, now);
    this.#maybePrune(v, duties);
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
    if (this.#working || this.#nextAuto(duties, v, false) !== null) return 'working';
    if (this.#stuck(duties, v)) return 'stuck';
    if (v.phase === 'done') return 'done';
    if (duties.some((d) => d.kind === 'decide') && !this.#ownMovePending(v)) return 'your-turn';
    return 'waiting';
  }

  /** An automatic duty other than a quiet one is due but failed at this head. */
  #stuck(duties: readonly Duty[], v: SessionView): boolean {
    return duties.some(
      (d) => AUTO.includes(d.kind) && !QUIET.includes(d.kind) && this.#failed.has(`${d.kind}@${v.head.id}`),
    );
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
    if (this.#working || this.#nextAuto(duties, v, false) !== null) return;
    if (![...this.#outbox.values()].every((e) => e.confirmed || e.orphan)) return;
    this.#outbox.clear();
    removeItem(this.#d.storage, outboxKey(this.#d.profile, this.rootId));
  }

  /* -------------------------------------------------------------------------------------------- duties */

  /** The next automatic duty due and not failed at this head; with `quiet` false, quiet duties are skipped. */
  #nextAuto(duties: readonly Duty[], v: SessionView, quiet = true): Duty['kind'] | null {
    for (const kind of AUTO) {
      if (!quiet && QUIET.includes(kind)) continue;
      if (kind === 'attest' && (this.#session === null || !canAttest(this.#session))) continue;
      if (duties.some((d) => d.kind === kind) && !this.#failed.has(`${kind}@${v.head.id}`)) return kind;
    }
    return null;
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
        const quiet = QUIET.includes(kind);
        if (!quiet) {
          this.#working = true;
          this.#refresh();
          // Let the screen show "working" before a long proof blocks the thread.
          await this.#yield();
          if (this.#disposed) return;
        }
        const head = session.view().head;
        const key = `${kind}@${head.id}`;
        try {
          // A duty still due after its event was folded in would loop forever: stop at the second try.
          if (done.has(key)) throw new ClientError('the duty is still due after its event was sent');
          done.add(key);
          await this.#perform(session, kind);
        } catch (e) {
          this.#failed.add(key);
          // A quiet duty's failure costs only time: the seat's next move carries what it owed.
          if (!quiet)
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
    // A deal, secret or attestation the session refused (an orphan: after a shuffle fork, or a changed result) is
    // built anew. None of them is a chain move, so a second one is never equivocation: a seat's later shares of a
    // position are ignored, its secret is one value, and its latest attestation is the one that counts.
    if (kind === 'deal') return this.#single('deal', () => session.buildDeal(rnd, now()));
    if (kind === 'share') {
      // One slot per set of positions owed, so a retry re-sends the same event (D039).
      const duty = session.duties().find((d) => d.kind === 'share');
      if (duty?.kind !== 'share') return;
      return this.#single(`${SHARES_SLOT}${duty.positions.join(',')}`, () => session.buildShares(rnd, now()));
    }
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
      if (!(e instanceof ClientError) || this.#outbox.get(slot)?.orphan !== true) throw e;
    }
    return this.#commit(slot, await build());
  }

  /** The event saved for a single-slot duty (`deal`, `shares:…`, `secret`, `attest`), unless it was refused. */
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

  /** Remove one slot from the stored outbox (other tabs may have written other slots). */
  #unpersist(slot: string): void {
    if (this.#disposed) return;
    const key = outboxKey(this.#d.profile, this.rootId);
    const stored = readJson(this.#d.storage, key);
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored) || !(slot in stored)) return;
    writeJson(this.#d.storage, key, Object.fromEntries(Object.entries(stored).filter(([k]) => k !== slot)));
  }

  /**
   * Mark the slot's event delivered. A `shares:` slot is dropped instead (D039): it is a small event a seat sends
   * after most draws, so keeping each would grow storage by about a hundred events a game. Dropping it is safe:
   * the relay holds it, and should the duty come back, a new Shares event is harmless (a seat's first share of a
   * position is the one kept, and Shares events are not chain moves).
   */
  #confirm(slot: string): void {
    const entry = this.#outbox.get(slot);
    if (entry === undefined || entry.confirmed) return;
    if (slot.startsWith(SHARES_SLOT)) {
      this.#outbox.delete(slot);
      this.#unpersist(slot);
    } else {
      entry.confirmed = true;
      this.#persist(slot);
    }
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
      const results = await this.#d.pool.publish(entry.event, unionRelays(root.relays, this.#d.relays()));
      if (this.#disposed) return;
      if (results.some((r) => r.ok)) this.#confirm(slot);
      else this.notice.value = 'Not delivered to any relay yet; retrying.';
    } finally {
      this.#inFlight.delete(slot);
    }
  }

  /**
   * Republish what no relay has confirmed. Each event is first fed to the session again: one it has since
   * refused (a pooled move whose parent lost, for example) becomes an orphan and is retried no more.
   */
  #retryUndelivered(): void {
    const session = this.#session;
    for (const [slot, entry] of this.#outbox) {
      if (entry.confirmed || entry.orphan) continue;
      if (session !== null && this.#receive(session, entry.event).status === 'rejected') {
        entry.orphan = true;
        this.#persist(slot);
        continue;
      }
      void this.#publish(slot);
    }
  }

  #yield(): Promise<void> {
    return new Promise((resolve) => this.#d.timers.later(0, resolve));
  }
}
