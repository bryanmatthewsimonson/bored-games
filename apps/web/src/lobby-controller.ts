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
} from '@bored-games/client';
import { G } from '@bored-games/deck';
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
  verifyEvent,
} from '@bored-games/protocol';
import type { Filter } from '@bored-games/relay';
import { type Signal, signal } from '@preact/signals';
import { bytesToHex, hexToBytes } from './hex.ts';
import { type ControllerDeps, unionRelays } from './net.ts';
import {
  addToTableList,
  type GameSecrets,
  loadSecrets,
  loadTableList,
  readJson,
  saveRootId,
  saveSecrets,
  storageKey,
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
}

/** How many recent tables the open list asks each relay for. */
export const OPEN_TABLES_LIMIT = 200;

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
  /** The latest valid Table event per address. */
  readonly #tables = new Map<string, NostrEvent>();
  /** Joins and roots per table address, by id. */
  readonly #lobby = new Map<string, Map<string, NostrEvent>>();
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

  /** The latest known Table event at `address`. */
  tableEvent(address: string): NostrEvent | null {
    return this.#tables.get(address) ?? null;
  }

  /**
   * Create a table and the creator's Join: sign both, save the game secrets, then publish to the table's relays
   * and the player's relays. Returns the table address.
   */
  async createTable(spec: NewTable): Promise<string> {
    const game = spec.game ?? [...this.#d.modules.keys()][0];
    const module = game === undefined ? undefined : this.#d.modules.get(game);
    if (game === undefined || module === undefined) throw new Error('This game is not available.');
    const relays = [...(spec.relays ?? this.#d.relays())];
    const tableId = bytesToHex(this.#d.rnd(8));
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
        rules: module.defaultRules(),
      },
      this.#d.now(),
    );
    const tableEv = await this.#sign(template);
    const table = tryParseTable(tableEv);
    if (table === null) throw new Error('The table is not valid: check the seats, invitations and relays.');
    const joinEv = await this.#signJoin(table);
    this.#ingest(tableEv);
    this.#ingest(joinEv);
    await this.#publishAll([tableEv, joinEv], table.relays);
    return table.address;
  }

  /** Join an open table: sign a Join, save the game secrets, publish. Does nothing if already seated. */
  async join(address: string): Promise<void> {
    const tableEv = this.#tables.get(address) ?? (await this.#fetchTable(address));
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
   * with status `started`. A root already signed for this table is republished, never signed again. Returns
   * the root id, the game's id.
   */
  async start(address: string): Promise<string> {
    const tableEv = this.#tables.get(address) ?? (await this.#fetchTable(address));
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
      rootEv = await this.#sign(buildRootTemplate(view, table.relays, this.#d.now()));
      if (!writeJson(this.#d.storage, rootKey, rootEv))
        throw new Error('Could not save the game start in this browser.');
    }
    this.#ingest(rootEv);
    await this.#publishAll([rootEv], table.relays);
    saveRootId(this.#d.profile, this.#d.storage, address, rootEv.id);

    if (table.status !== 'started') {
      const latest = this.#tables.get(address) ?? tableEv;
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

  async #sign(t: EventTemplate): Promise<NostrEvent> {
    return this.#d.signer.sign(t);
  }

  /** Sign a Join with this table's saved keys, or with fresh keys saved first. */
  async #signJoin(table: ParsedTable): Promise<NostrEvent> {
    const saved = loadSecrets(this.#d.profile, this.#d.storage, table.address);
    let keys: GameKeys;
    if (saved !== null) keys = keysFromSecrets(saved);
    else {
      keys = newGameKeys(this.#d.rnd);
      if (!saveSecrets(this.#d.profile, this.#d.storage, table.address, secretsOf(keys)))
        throw new Error('Could not save the game keys in this browser.');
    }
    addToTableList(this.#d.profile, this.#d.storage, table.address);
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
          resolve(this.#tables.get(address) ?? null);
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
    const t = this.#tables.get(address);
    if (t === undefined) return null;
    try {
      return foldLobby(t, [...(this.#lobby.get(address)?.values() ?? [])], this.#d.modules);
    } catch {
      return null;
    }
  }

  /** Take in any lobby event, from a relay or signed here. */
  #ingest(ev: NostrEvent): void {
    if (this.#disposed) return;
    let address: string | null = null;
    if (ev.kind === KIND.table) {
      const t = tryParseTable(ev);
      if (t === null) return;
      const held = this.#tables.get(t.address);
      if (held !== undefined && (held.id === ev.id || !supersedes(ev, held))) return;
      this.#tables.set(t.address, ev);
      address = t.address;
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
    } else return;
    this.#update(address);
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
    for (const [address, event] of this.#tables) {
      const table = tryParseTable(event);
      if (table === null || table.status !== 'open' || !this.#d.modules.has(table.game)) continue;
      out.push({ address, event, table });
    }
    out.sort((a, b) => b.event.created_at - a.event.created_at || (a.address < b.address ? -1 : 1));
    this.openTables.value = out;
  }

  #myAddresses(): string[] {
    const mine = [...this.#tables.entries()]
      .filter(([, ev]) => ev.pubkey === this.#me)
      .map(([address]) => address);
    return unionRelays(loadTableList(this.#d.profile, this.#d.storage), mine);
  }

  #refreshMine(): void {
    const out: MyTable[] = [];
    const addresses = this.#myAddresses();
    for (const address of addresses) {
      const event = this.#tables.get(address);
      const table = event === undefined ? null : tryParseTable(event);
      if (event === undefined || table === null) continue;
      const lobby = this.#fold(address);
      out.push({
        address,
        event,
        table,
        role: table.creator === this.#me ? 'creator' : 'player',
        lobby,
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
