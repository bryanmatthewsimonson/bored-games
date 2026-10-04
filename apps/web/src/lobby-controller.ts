/*
 * The lobby controller: lists open tables and the player's own tables, follows one table's Joins and root,
 * and signs the lobby events (Table, Join, root) with the player's identity signer (PROTOCOL §4.1–§4.3).
 * Per-game secrets are saved before anything that uses them is published, so a reload can always carry on.
 */
import {
  buildJoinTemplate,
  buildRootTemplate,
  foldLobby,
  type GameKeys,
  type LobbyView,
  newGameKeys,
  seatForGameKeys,
} from '@bored-games/client';
import { G } from '@bored-games/deck';
import { currentModules } from '@bored-games/game-kit';
import {
  type EventTemplate,
  getPublicKey,
  type Hex,
  KIND,
  type NostrEvent,
  type ParsedTable,
  parseTable,
  type TableStatus,
  tableTemplate,
  validateTable,
  verifyEvent,
} from '@bored-games/protocol';
import type { Filter } from '@bored-games/relay';
import { type Signal, signal } from '@preact/signals';
import { bytesToHex, hexToBytes } from './hex.ts';
import { type ControllerDeps, unionRelays } from './net.ts';
import {
  addToTableList,
  type GameSecrets,
  type GameStatusCache,
  loadGameStatus,
  loadSecrets,
  loadTableList,
  readJson,
  saveRootId,
  saveSecrets,
  storageKey,
  tableIsMine,
  writeJson,
} from './storage.ts';

/** A valid Table event, parsed. */
export interface TableEntry {
  address: string;
  event: NostrEvent;
  table: ParsedTable;
}

/** A table this player created or joined, with what its lobby events say. */
export interface MyTable extends TableEntry {
  role: 'creator' | 'player';
  /** Null until the Joins have been folded (or when they cannot be). */
  lobby: LobbyView | null;
  /** True when this profile listed the table under another player key (D041): it cannot be played now… */
  otherKey: boolean;
  /**
   * …unless this browser holds game keys for it that match a seat of its root (D057): the game screen then plays
   * that seat with them, so Home shows the table as playable.
   */
  savedKeys: boolean;
  /** The game's id once a valid root exists. */
  rootId: string | null;
}

export interface NewTable {
  seats: number;
  /** Seconds: one of `DEADLINES`. */
  deadline: number;
  /** Invited pubkeys, hex. */
  invited: readonly Hex[];
  /** The table's relays; the player's relays by default. */
  relays?: readonly string[];
  /** The module id; the first registered module by default. */
  game?: string;
  /**
   * Rule options for this table. Checked with the module's `validateRules`. Omitted means the module's defaults.
   * Only Bank's form sets this today.
   */
  rules?: unknown;
}

/** Why a join is refused for a table this profile joined or created with another player key. */
export const OTHER_KEY_TABLE =
  'You are at this table with another key. Switch to that key in Settings → Identity to play here, or ask the creator for a new table.';

/** How many recent tables the open list asks each relay for. */
export const OPEN_TABLES_LIMIT = 200;
/** The most tables held in memory; beyond it the oldest (not this player's) are dropped. */
export const MAX_TABLES = 500;
/** The most Joins and roots held per table; beyond it the oldest unseated Joins are dropped. */
export const MAX_LOBBY_EVENTS = 200;

/** `37450:<creator>:<tableId>` split, or null. */
export function splitAddress(address: string): { creator: Hex; tableId: string } | null {
  const m = /^37450:([0-9a-f]{64}):([A-Za-z0-9._-]{1,64})$/.exec(address);
  return m === null ? null : { creator: m[1] as Hex, tableId: m[2] as string };
}

const tableFilter = (address: string): Filter | null => {
  const a = splitAddress(address);
  return a === null ? null : { kinds: [KIND.table], authors: [a.creator], '#d': [a.tableId] };
};

/** Does `a` replace `b` at the same address: newer, or on a tie the lower id (NIP-01). */
const supersedes = (a: NostrEvent, b: NostrEvent): boolean =>
  a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);

function tryParseTable(ev: NostrEvent): ParsedTable | null {
  try {
    return parseTable(ev);
  } catch {
    return null;
  }
}

/** The `a` tag of a Join or root. */
const addressOf = (ev: NostrEvent): string | null => ev.tags.find((t) => t[0] === 'a')?.[1] ?? null;

const secretsOf = (keys: GameKeys): GameSecrets => ({
  sessionSk: keys.sessionSk,
  deckSecret: hexToBytes(keys.deckSecret.toString(16).padStart(64, '0')),
});

/** The game keys behind saved secrets. */
export function keysFromSecrets(s: GameSecrets): GameKeys {
  const deckSecret = BigInt(`0x${bytesToHex(s.deckSecret)}`);
  return {
    sessionSk: s.sessionSk,
    sessionPub: getPublicKey(s.sessionSk),
    deckSecret,
    deckKey: G.multiply(deckSecret),
  };
}

export class LobbyController {
  /** Open tables of registered games, newest first. */
  readonly openTables: Signal<TableEntry[]> = signal([]);
  /** Tables this player created or joined, newest first. */
  readonly myTables: Signal<MyTable[]> = signal([]);
  /** True until the open-table query has reached EOSE (or its deadline). */
  readonly loading: Signal<boolean> = signal(true);

  readonly #d: ControllerDeps;
  /** The latest valid Table event per address, parsed once. */
  readonly #tables = new Map<string, TableEntry>();
  /** Joins and roots per table address, by id. */
  readonly #lobby = new Map<string, Map<string, NostrEvent>>();
  /** `foldLobby` results per address, dropped when the table or its events change. */
  readonly #folds = new Map<string, LobbyView | null>();
  /** In-flight `start` and `join` calls per address: a second caller gets the first call's promise. */
  readonly #starting = new Map<string, Promise<string>>();
  readonly #joining = new Map<string, Promise<void>>();
  /** `#savedSeat` results by root id. */
  readonly #savedSeats = new Map<string, boolean>();
  readonly #views = new Map<string, Signal<LobbyView | null>>();
  readonly #watches = new Map<string, () => void>();
  #openUnsub: (() => void) | null = null;
  #mineUnsub: (() => void) | null = null;
  #mineAddresses: string[] = [];
  #listening = false;
  #disposed = false;

  constructor(deps: ControllerDeps) {
    this.#d = deps;
  }

  get #me(): Hex {
    return this.#d.signer.pubkey;
  }

  /** Start following open tables and this player's tables. */
  listen(): void {
    if (this.#listening || this.#disposed) return;
    this.#listening = true;
    this.#openUnsub = this.#d.pool.subscribe(
      [{ kinds: [KIND.table], limit: OPEN_TABLES_LIMIT }],
      (ev) => this.#ingest(ev),
      () => {
        this.loading.value = false;
      },
    );
    this.#followMine();
  }

  dispose(): void {
    this.#disposed = true;
    this.#openUnsub?.();
    this.#mineUnsub?.();
    for (const u of this.#watches.values()) u();
    this.#watches.clear();
  }

  /** The folded lobby of one table, followed from now on. Null until its Table event is known and valid. */
  table(address: string): Signal<LobbyView | null> {
    const view = this.#viewSignal(address);
    if (!this.#watches.has(address) && !this.#disposed) {
      const tf = tableFilter(address);
      if (tf !== null) {
        this.#watches.set(
          address,
          this.#d.pool.subscribe([tf, { kinds: [KIND.join, KIND.root], '#a': [address] }], (ev) =>
            this.#ingest(ev),
          ),
        );
      }
    }
    return view;
  }

  /**
   * The status a game screen last saved for this game (`bg:<profile>:gamestatus:<rootId>`), or null. Home shows
   * it without running the game: a game session verifies every shuffle, which is far too heavy for a list.
   */
  gameStatus(rootId: string): GameStatusCache | null {
    return loadGameStatus(this.#d.profile, this.#d.storage, rootId);
  }

  /** Unix seconds, from the injected clock. */
  now(): number {
    return this.#d.now();
  }

  /** The latest known Table event at `address`. */
  tableEvent(address: string): NostrEvent | null {
    return this.#tables.get(address)?.event ?? null;
  }

  /**
   * Create a table and the creator's Join: sign both, save the game secrets, then publish to the table's relays
   * and the player's relays. Returns the table address.
   */
  async createTable(spec: NewTable): Promise<string> {
    // New tables use the current engines only, never a version kept under `id@version` to fold older games.
    const current = currentModules(this.#d.modules);
    const game = spec.game ?? [...current.keys()][0];
    const module = game === undefined ? undefined : current.get(game);
    if (game === undefined || module === undefined) throw new Error('This game is not available.');
    const relays = [...(spec.relays ?? this.#d.relays())];
    const tableId = bytesToHex(this.#d.rnd(8));
    let rules = module.defaultRules();
    if (spec.rules !== undefined) {
      const checked = module.validateRules(spec.rules);
      if (!checked.ok) throw new Error(checked.error.message);
      rules = checked.value;
    }
    const template = tableTemplate(
      {
        tableId,
        game,
        version: module.version,
        seats: spec.seats,
        deadline: spec.deadline,
        invited: [...spec.invited],
        open: spec.seats - 1 - spec.invited.length,
        relays,
        status: 'open',
        rules,
      },
      this.#d.now(),
    );
    const tableEv = await this.#sign(template);
    const table = tryParseTable(tableEv);
    if (table === null) throw new Error('The table is not valid: check the seats, invitations and relays.');
    // Never publish a table no client can start (review I2): an engine that does not support the table's proto.
    const problems = validateTable(table, this.#d.modules);
    if (problems.length > 0) throw new Error(`This game cannot be started: ${problems.join('; ')}.`);
    const joinEv = await this.#signJoin(table);
    this.#ingest(tableEv);
    this.#ingest(joinEv);
    await this.#publishAll([tableEv, joinEv], table.relays);
    return table.address;
  }

  /**
   * The folded lobby of a table after one query of its Joins and root has finished (unless the table is already
   * followed), for a check before joining. Null when the table is not found.
   */
  async lobbyOf(address: string): Promise<LobbyView | null> {
    if (!this.#watches.has(address)) await this.#fetchTable(address);
    return this.#fold(address);
  }

  /**
   * Join an open table: sign a Join, save the game secrets, publish. Does nothing if already seated. While a
   * call for this address is in flight (a signer prompt may be open), further calls share it.
   */
  join(address: string): Promise<void> {
    return this.#once(this.#joining, address, () => this.#join(address));
  }

  async #join(address: string): Promise<void> {
    const tableEv = this.#tables.get(address)?.event ?? (await this.#fetchTable(address));
    if (tableEv === null) throw new Error('That table was not found on your relays.');
    const table = tryParseTable(tableEv);
    if (table === null) throw new Error('That table is not valid.');
    if (table.status !== 'open') throw new Error('That table is no longer open.');
    const view = this.#fold(address);
    if (view?.joins.some((j) => j.npub === this.#me)) return;
    const joinEv = await this.#signJoin(table);
    this.#ingest(joinEv);
    await this.#publishAll([joinEv], table.relays);
  }

  /**
   * Start the game (the creator, once the table is full): sign the root, publish it, then republish the table
   * with status `started`. A root already signed for this table is republished, never signed again, and
   * concurrent calls share one signing. Returns the root id, the game's id. `seats` (Join ids in seat order)
   * lets the creator choose among open joiners (D021); it applies only when this call signs the root.
   */
  start(address: string, seats?: readonly Hex[]): Promise<string> {
    return this.#once(this.#starting, address, () => this.#start(address, seats));
  }

  async #start(address: string, seats?: readonly Hex[]): Promise<string> {
    const tableEv = this.#tables.get(address)?.event ?? (await this.#fetchTable(address));
    const table = tableEv === null ? null : tryParseTable(tableEv);
    if (tableEv === null || table === null) throw new Error('That table was not found on your relays.');
    if (table.creator !== this.#me) throw new Error('Only the table creator can start the game.');

    const rootKey = storageKey(this.#d.profile, `root:${address}`);
    const view = this.#fold(address);
    let rootEv: NostrEvent | null = null;
    if (view?.root) {
      rootEv = this.#lobby.get(address)?.get(view.root.id) ?? null;
    }
    if (rootEv === null) {
      const stored = readJson(this.#d.storage, rootKey);
      if (verifyEvent(stored) && stored.kind === KIND.root && stored.pubkey === this.#me) rootEv = stored;
    }
    if (rootEv === null) {
      if (view === null || !view.full) throw new Error('The table is not full yet.');
      rootEv = await this.#sign(buildRootTemplate(view, table.relays, this.#d.now(), seats));
      if (!writeJson(this.#d.storage, rootKey, rootEv))
        throw new Error('Could not save the game start in this browser.');
    }
    this.#ingest(rootEv);
    await this.#publishAll([rootEv], table.relays);
    saveRootId(this.#d.profile, this.#d.storage, address, rootEv.id);

    if (table.status !== 'started') {
      const latest = this.#tables.get(address)?.event ?? tableEv;
      const started = await this.#sign(
        tableTemplate(
          { ...specOf(table), status: 'started' },
          Math.max(this.#d.now(), latest.created_at + 1),
        ),
      );
      this.#ingest(started);
      await this.#publishAll([started], table.relays, false);
    }
    return rootEv.id;
  }

  /* ----------------------------------------------------------------------------------------- internals */

  /** Run `task` unless one is already in flight for `address`, in which case return that one. */
  #once<T>(inFlight: Map<string, Promise<T>>, address: string, task: () => Promise<T>): Promise<T> {
    const held = inFlight.get(address);
    if (held !== undefined) return held;
    const p = task().finally(() => inFlight.delete(address));
    inFlight.set(address, p);
    return p;
  }

  async #sign(t: EventTemplate): Promise<NostrEvent> {
    return this.#d.signer.sign(t);
  }

  /**
   * Sign a Join with this table's saved keys, or with fresh keys saved first. Keys saved for another player key
   * are never reused (that would link the two keys publicly, D041), and never replaced (that would lose the
   * other key's seat): the join is refused instead.
   */
  async #signJoin(table: ParsedTable): Promise<NostrEvent> {
    const { profile, storage } = this.#d;
    if (!tableIsMine(profile, storage, table.address, this.#me)) throw new Error(OTHER_KEY_TABLE);
    const saved = loadSecrets(profile, storage, table.address);
    let keys: GameKeys;
    if (saved !== null) keys = keysFromSecrets(saved);
    else {
      keys = newGameKeys(this.#d.rnd);
      if (!saveSecrets(profile, storage, table.address, { ...secretsOf(keys), owner: this.#me }))
        throw new Error('Could not save the game keys in this browser.');
    }
    addToTableList(profile, storage, table.address, this.#me);
    this.#followMine();
    return this.#sign(buildJoinTemplate(table, this.#me, keys, this.#d.relays(), this.#d.rnd, this.#d.now()));
  }

  /** Publish to the table's relays and the player's own; throws when no relay took an event. */
  async #publishAll(events: NostrEvent[], tableRelays: readonly string[], required = true): Promise<void> {
    const urls = unionRelays(tableRelays, this.#d.relays());
    const results = await Promise.all(events.map((ev) => this.#d.pool.publish(ev, urls)));
    if (required && results.some((r) => !r.some((x) => x.ok)))
      throw new Error('No relay accepted the event. Check your relays and try again.');
  }

  /** One-shot query for a table, resolved at EOSE (or the pool's EOSE deadline). */
  #fetchTable(address: string): Promise<NostrEvent | null> {
    const tf = tableFilter(address);
    if (tf === null) return Promise.resolve(null);
    return new Promise((resolve) => {
      let unsub = (): void => {};
      unsub = this.#d.pool.subscribe(
        [tf, { kinds: [KIND.join, KIND.root], '#a': [address] }],
        (ev) => this.#ingest(ev),
        () => {
          unsub();
          resolve(this.#tables.get(address)?.event ?? null);
        },
      );
    });
  }

  #viewSignal(address: string): Signal<LobbyView | null> {
    let s = this.#views.get(address);
    if (s === undefined) {
      s = signal(this.#fold(address));
      this.#views.set(address, s);
    }
    return s;
  }

  #fold(address: string): LobbyView | null {
    if (this.#folds.has(address)) return this.#folds.get(address) ?? null;
    const t = this.#tables.get(address);
    if (t === undefined) return null;
    let view: LobbyView | null;
    try {
      view = foldLobby(t.event, [...(this.#lobby.get(address)?.values() ?? [])], this.#d.modules);
    } catch {
      view = null;
    }
    this.#folds.set(address, view);
    return view;
  }

  /** Take in any lobby event, from a relay or signed here. */
  #ingest(ev: NostrEvent): void {
    if (this.#disposed) return;
    let address: string | null = null;
    if (ev.kind === KIND.table) {
      const held = this.#tables.get(this.#addressGuess(ev) ?? '');
      if (held !== undefined && (held.event.id === ev.id || !supersedes(ev, held.event))) return;
      const table = tryParseTable(ev);
      if (table === null) return;
      this.#tables.set(table.address, { address: table.address, event: ev, table });
      address = table.address;
      this.#trimTables();
    } else if (ev.kind === KIND.join || ev.kind === KIND.root) {
      address = addressOf(ev);
      if (address === null || splitAddress(address) === null) return;
      let m = this.#lobby.get(address);
      if (m === undefined) {
        m = new Map();
        this.#lobby.set(address, m);
      }
      if (m.has(ev.id)) return;
      m.set(ev.id, ev);
      this.#folds.delete(address);
      this.#trimLobby(address, m);
    } else return;
    this.#folds.delete(address);
    this.#update(address);
  }

  /** The address a Table event claims, without a full parse (to skip stale versions cheaply). */
  #addressGuess(ev: NostrEvent): string | null {
    const d = ev.tags.find((t) => t[0] === 'd')?.[1];
    return d === undefined ? null : `${KIND.table}:${ev.pubkey}:${d}`;
  }

  /** Keep at most `MAX_TABLES`, dropping the oldest that are not this player's or being watched. */
  #trimTables(): void {
    if (this.#tables.size <= MAX_TABLES) return;
    const keep = new Set([...this.#myAddresses(), ...this.#watches.keys()]);
    const victims = [...this.#tables.values()]
      .filter((t) => !keep.has(t.address))
      .sort((a, b) => a.event.created_at - b.event.created_at);
    for (const t of victims.slice(0, this.#tables.size - MAX_TABLES)) {
      this.#tables.delete(t.address);
      this.#lobby.delete(t.address);
      this.#folds.delete(t.address);
    }
  }

  /** Keep at most `MAX_LOBBY_EVENTS` per table, dropping the oldest events that hold no seat and are no root. */
  #trimLobby(address: string, m: Map<string, NostrEvent>): void {
    if (m.size <= MAX_LOBBY_EVENTS) return;
    const view = this.#fold(address);
    const keep = new Set([...(view?.joins.map((j) => j.id) ?? []), ...(view?.root ? [view.root.id] : [])]);
    const victims = [...m.values()]
      .filter((ev) => !keep.has(ev.id))
      .sort((a, b) => a.created_at - b.created_at);
    for (const ev of victims.slice(0, m.size - MAX_LOBBY_EVENTS)) m.delete(ev.id);
    this.#folds.delete(address);
  }

  #update(address: string): void {
    const view = this.#fold(address);
    const s = this.#views.get(address);
    if (s !== undefined) s.value = view;
    if (view?.root?.seats.some((seat) => seat.npub === this.#me))
      saveRootId(this.#d.profile, this.#d.storage, address, view.root.id);
    this.#refreshOpen();
    this.#refreshMine();
  }

  #refreshOpen(): void {
    const out: TableEntry[] = [];
    // Current modules only: a table naming an `@` key (a kept older version) is no game to list (review L1).
    const games = currentModules(this.#d.modules);
    for (const entry of this.#tables.values()) {
      if (entry.table.status !== 'open' || !games.has(entry.table.game)) continue;
      out.push(entry);
    }
    out.sort((a, b) => b.event.created_at - a.event.created_at || (a.address < b.address ? -1 : 1));
    this.openTables.value = out;
  }

  /** Whether this browser's saved game keys for the table match a seat of `root` (`seatForGameKeys`), cached per root. */
  #savedSeat(address: string, root: NonNullable<LobbyView['root']> | null): boolean {
    if (root === null) return false;
    const cached = this.#savedSeats.get(root.id);
    if (cached !== undefined) return cached;
    const s = loadSecrets(this.#d.profile, this.#d.storage, address);
    const ok =
      s !== null && seatForGameKeys(root, s.sessionSk, BigInt(`0x${bytesToHex(s.deckSecret)}`)) !== null;
    this.#savedSeats.set(root.id, ok);
    return ok;
  }

  #myAddresses(): string[] {
    const mine = [...this.#tables.values()].filter((t) => t.table.creator === this.#me).map((t) => t.address);
    return unionRelays(loadTableList(this.#d.profile, this.#d.storage), mine);
  }

  #refreshMine(): void {
    const out: MyTable[] = [];
    const addresses = this.#myAddresses();
    for (const address of addresses) {
      const entry = this.#tables.get(address);
      if (entry === undefined) continue;
      const { event, table } = entry;
      const lobby = this.#fold(address);
      const otherKey = !tableIsMine(this.#d.profile, this.#d.storage, address, this.#me);
      out.push({
        address,
        event,
        table,
        role: table.creator === this.#me ? 'creator' : 'player',
        lobby,
        otherKey,
        savedKeys: otherKey && this.#savedSeat(address, lobby?.root ?? null),
        rootId: lobby?.root?.id ?? null,
      });
    }
    out.sort((a, b) => b.event.created_at - a.event.created_at || (a.address < b.address ? -1 : 1));
    this.myTables.value = out;
    // Follow the Joins of tables discovered since the last subscription.
    if (this.#listening && addresses.some((a) => !this.#mineAddresses.includes(a))) this.#followMine();
  }

  /** (Re)subscribe to my tables: those I authored, those in my stored list, and their Joins and roots. */
  #followMine(): void {
    if (!this.#listening || this.#disposed) return;
    const addresses = this.#myAddresses();
    this.#mineAddresses = addresses;
    const filters: Filter[] = [{ kinds: [KIND.table], authors: [this.#me] }];
    for (const a of addresses) {
      const tf = tableFilter(a);
      if (tf !== null && splitAddress(a)?.creator !== this.#me) filters.push(tf);
    }
    if (addresses.length > 0) filters.push({ kinds: [KIND.join, KIND.root], '#a': addresses });
    const previous = this.#mineUnsub;
    this.#mineUnsub = this.#d.pool.subscribe(filters, (ev) => this.#ingest(ev));
    previous?.();
  }
}

function specOf(t: ParsedTable): {
  tableId: string;
  game: string;
  version: string;
  seats: number;
  deadline: number;
  invited: Hex[];
  open: number;
  relays: string[];
  status: TableStatus;
  rules: unknown;
} {
  return {
    tableId: t.tableId,
    game: t.game,
    version: t.version,
    seats: t.seats,
    deadline: t.deadline,
    invited: [...t.invited],
    open: t.open,
    relays: [...t.relays],
    status: t.status,
    rules: t.rules,
  };
}
