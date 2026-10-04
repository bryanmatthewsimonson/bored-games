/*
 * Impure entry point 3 of 3 (with random.ts and clock.ts): `localStorage` and `sessionStorage`. All other code takes a
 * `KeyValueStore`, so tests pass `memoryStorage()`. Every key is namespaced by profile: `bg:<profile>:<name>`,
 * which keeps two tabs with different `?profile=` values apart (they act as different players).
 */
import { bytesToHex, hexToBytes, isHex } from './hex.ts';

/** The part of the Web Storage API that this app uses. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const storageKey = (profile: string, name: string): string => `bg:${profile}:${name}`;

/** Stores that live in memory only: what they hold is lost with the page. */
const EPHEMERAL = new WeakSet<KeyValueStore>();

/** False for a memory store, including the fallback `browserStorage` returns when site data is blocked. */
export function isPersistentStore(store: KeyValueStore): boolean {
  return !EPHEMERAL.has(store);
}

export function memoryStorage(): KeyValueStore {
  const m = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
  EPHEMERAL.add(store);
  return store;
}

/** `localStorage` when it is usable, else a memory store (private windows, blocked site data). */
export function browserStorage(): KeyValueStore {
  try {
    const s = globalThis.localStorage;
    const probe = '__bg_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return memoryStorage();
  }
}

/**
 * `sessionStorage` when it is usable, else a memory store: state for this tab only that survives moving between
 * screens and a reload, such as the catalog's filters. Nothing that must last goes here.
 */
export function sessionStore(): KeyValueStore {
  try {
    const s = globalThis.sessionStorage;
    const probe = '__bg_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return memoryStorage();
  }
}

/** Reads never throw: a blocked store reads as empty. */
export function readItem(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/** Returns false when the value could not be saved. */
export function writeItem(store: KeyValueStore, key: string, value: string): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // Nothing useful to do: the key stays.
  }
}

/** Per-game secrets, kept so a reopened tab can carry on. Never leave the browser. */
export interface GameSecrets {
  sessionSk: Uint8Array;
  deckSecret: Uint8Array;
  /** The game root's id, once the game has started. */
  rootId?: string;
  /**
   * The pubkey (hex) of the player key these secrets were made for (D041). Absent on secrets saved before keys
   * could be imported; `claimUnowned` stamps those with the key in use before the key first changes.
   */
  owner?: string;
}

const secretsKey = (profile: string, tableAddress: string): string =>
  storageKey(profile, `secrets:${tableAddress}`);

export function saveSecrets(
  profile: string,
  store: KeyValueStore,
  tableAddress: string,
  secrets: GameSecrets,
): boolean {
  const json = JSON.stringify({
    sessionSk: bytesToHex(secrets.sessionSk),
    deckSecret: bytesToHex(secrets.deckSecret),
    ...(secrets.rootId === undefined ? {} : { rootId: secrets.rootId }),
    ...(secrets.owner === undefined ? {} : { owner: secrets.owner }),
  });
  return writeItem(store, secretsKey(profile, tableAddress), json);
}

/** Null when nothing is stored or what is stored is malformed. */
export function loadSecrets(profile: string, store: KeyValueStore, tableAddress: string): GameSecrets | null {
  const raw = readItem(store, secretsKey(profile, tableAddress));
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const { sessionSk, deckSecret, rootId, owner } = v as Record<string, unknown>;
    if (!isHex(sessionSk) || !isHex(deckSecret)) return null;
    const out: GameSecrets = { sessionSk: hexToBytes(sessionSk), deckSecret: hexToBytes(deckSecret) };
    if (isHex(rootId) && rootId.length === 64) out.rootId = rootId;
    if (isHex(owner) && owner.length === 64) out.owner = owner;
    return out;
  } catch {
    return null;
  }
}

/** Record the game's root id with the table's secrets. False when there are no secrets or the write fails. */
export function saveRootId(
  profile: string,
  store: KeyValueStore,
  tableAddress: string,
  rootId: string,
): boolean {
  const s = loadSecrets(profile, store, tableAddress);
  if (s === null) return false;
  if (s.rootId === rootId) return true;
  return saveSecrets(profile, store, tableAddress, { ...s, rootId });
}

/** The JSON value under `key`, or null when it is absent or malformed. */
export function readJson(store: KeyValueStore, key: string): unknown {
  const raw = readItem(store, key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Returns false when the value could not be saved. */
export function writeJson(store: KeyValueStore, key: string, value: unknown): boolean {
  return writeItem(store, key, JSON.stringify(value));
}

const tablesKey = (profile: string): string => storageKey(profile, 'tables');

/** The addresses of the tables this profile created or joined, oldest first. */
export function loadTableList(profile: string, store: KeyValueStore): string[] {
  const v = readJson(store, tablesKey(profile));
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

const ownersKey = (profile: string): string => storageKey(profile, 'table-owners');

/**
 * Which player key (pubkey hex) each listed table belongs to (D041). A table missing here was listed before
 * keys could be imported; it belongs to the key in use until `claimUnowned` stamps it.
 */
export function loadTableOwners(profile: string, store: KeyValueStore): Map<string, string> {
  const v = readJson(store, ownersKey(profile));
  const out = new Map<string, string>();
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const [address, owner] of Object.entries(v as Record<string, unknown>))
    if (isHex(owner) && owner.length === 64) out.set(address, owner);
  return out;
}

function saveTableOwners(profile: string, store: KeyValueStore, owners: Map<string, string>): boolean {
  return writeJson(store, ownersKey(profile), Object.fromEntries(owners));
}

/** List a table this profile created or joined, as belonging to the key `owner` (pubkey hex). */
export function addToTableList(
  profile: string,
  store: KeyValueStore,
  tableAddress: string,
  owner?: string,
): boolean {
  const list = loadTableList(profile, store);
  if (owner !== undefined) {
    const owners = loadTableOwners(profile, store);
    if (!owners.has(tableAddress)) {
      owners.set(tableAddress, owner);
      if (!saveTableOwners(profile, store, owners)) return false;
    }
  }
  if (list.includes(tableAddress)) return true;
  return writeJson(store, tablesKey(profile), [...list, tableAddress]);
}

/**
 * The key a listed table belongs to: its recorded owner, else its secrets' owner, else null (listed before
 * keys could be imported, so it belongs to the key in use).
 */
export function tableOwner(profile: string, store: KeyValueStore, tableAddress: string): string | null {
  return (
    loadTableOwners(profile, store).get(tableAddress) ??
    loadSecrets(profile, store, tableAddress)?.owner ??
    null
  );
}

/** True when the table, as listed here, belongs to `me` (or to nobody recorded, which means the key in use). */
export function tableIsMine(
  profile: string,
  store: KeyValueStore,
  tableAddress: string,
  me: string,
): boolean {
  const owner = tableOwner(profile, store, tableAddress);
  return owner === null || owner === me;
}

/**
 * Before the player key changes, record every listed table and saved secrets without an owner as belonging
 * to `owner`, the key in use until now (`creatorOf` may name a better owner for a table, from its address).
 * Afterwards nothing is unowned, so a table can never pass for the new key's. False when a write failed.
 */
export function claimUnowned(
  profile: string,
  store: KeyValueStore,
  owner: string,
  creatorOf: (tableAddress: string) => string | null = () => null,
): boolean {
  const owners = loadTableOwners(profile, store);
  let ok = true;
  let changed = false;
  for (const address of loadTableList(profile, store)) {
    const secrets = loadSecrets(profile, store, address);
    const who = owners.get(address) ?? secrets?.owner ?? creatorOf(address) ?? owner;
    if (!owners.has(address)) {
      owners.set(address, who);
      changed = true;
    }
    if (secrets !== null && secrets.owner === undefined)
      ok = saveSecrets(profile, store, address, { ...secrets, owner: who }) && ok;
  }
  return (changed ? saveTableOwners(profile, store, owners) : true) && ok;
}

/** The statuses a game controller reports, as stored. `syncing` is never saved. */
export const CACHED_STATUSES = ['working', 'stuck', 'waiting', 'your-turn', 'done', 'cancelled'] as const;
export type GameStatusName = (typeof CACHED_STATUSES)[number];

/**
 * A card reveal the game was waiting on when the status was saved (D060): the npubs of the seats that owe it,
 * whether this player's seat is one of them, and when their deadline passes (Unix seconds).
 */
export interface RevealCache {
  npubs: string[];
  mine: boolean;
  until: number;
}

/** What the Home screen may know of a game without running it: the last status a game screen saw. */
export interface GameStatusCache {
  status: GameStatusName;
  /** The head's seq when it was written. */
  seq: number;
  /** Unix seconds. */
  updatedAt: number;
  /** The card reveal the game waited on, if any (D060). */
  reveal?: RevealCache;
}

function revealOf(v: unknown): RevealCache | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const { npubs, mine, until } = v as Record<string, unknown>;
  if (!Array.isArray(npubs) || !npubs.every((n) => typeof n === 'string' && /^[0-9a-f]{64}$/.test(n)))
    return undefined;
  if (typeof mine !== 'boolean' || typeof until !== 'number' || !Number.isFinite(until)) return undefined;
  return { npubs: [...npubs] as string[], mine, until };
}

export const gameStatusKey = (profile: string, rootId: string): string =>
  storageKey(profile, `gamestatus:${rootId}`);

/** Returns false when the entry could not be saved. */
export function saveGameStatus(
  profile: string,
  store: KeyValueStore,
  rootId: string,
  entry: GameStatusCache,
): boolean {
  return writeJson(store, gameStatusKey(profile, rootId), {
    status: entry.status,
    seq: entry.seq,
    updatedAt: entry.updatedAt,
    ...(entry.reveal === undefined ? {} : { reveal: entry.reveal }),
  });
}

/** Null when nothing is stored or what is stored is malformed. */
export function loadGameStatus(
  profile: string,
  store: KeyValueStore,
  rootId: string,
): GameStatusCache | null {
  const v = readJson(store, gameStatusKey(profile, rootId));
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const { status, seq, updatedAt, reveal } = v as Record<string, unknown>;
  if (!(CACHED_STATUSES as readonly unknown[]).includes(status)) return null;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return null;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;
  const r = revealOf(reveal);
  return { status: status as GameStatusName, seq, updatedAt, ...(r === undefined ? {} : { reveal: r }) };
}

/* Persistent storage (D041): ask the browser not to evict this site's data under storage pressure. */

export type PersistState = 'persisted' | 'best-effort' | 'unsupported';

/** The part of `navigator.storage` used here. */
export interface StorageManagerLike {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

export function storageManager(): StorageManagerLike | null {
  const m = (globalThis as { navigator?: { storage?: Partial<StorageManagerLike> } }).navigator?.storage;
  return typeof m?.persist === 'function' && typeof m.persisted === 'function'
    ? (m as StorageManagerLike)
    : null;
}

export async function persistState(m: StorageManagerLike | null): Promise<PersistState> {
  if (m === null) return 'unsupported';
  try {
    return (await m.persisted()) ? 'persisted' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

/** Ask the browser to keep this site's data. Call it inside a click: Firefox shows a prompt. */
export async function requestPersistence(m: StorageManagerLike | null): Promise<PersistState> {
  if (m === null) return 'unsupported';
  try {
    return (await m.persist()) ? 'persisted' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

const persistAskedKey = (profile: string): string => storageKey(profile, 'persist-asked');

/**
 * On the first table created or joined, ask the browser to keep this site's data. Never on page load: some
 * browsers prompt. Later calls do nothing (Settings can ask again). Call it inside the click handler, before
 * any await.
 */
export function requestPersistenceOnce(
  profile: string,
  store: KeyValueStore,
  m: StorageManagerLike | null,
): boolean {
  if (m === null || readItem(store, persistAskedKey(profile)) !== null) return false;
  writeItem(store, persistAskedKey(profile), '1');
  void requestPersistence(m);
  return true;
}
