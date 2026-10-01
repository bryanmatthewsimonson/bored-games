/*
 * Impure entry point 3 of 3 (with random.ts and clock.ts): `localStorage`. All other code takes a
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
    const { sessionSk, deckSecret, rootId } = v as Record<string, unknown>;
    if (!isHex(sessionSk) || !isHex(deckSecret)) return null;
    const out: GameSecrets = { sessionSk: hexToBytes(sessionSk), deckSecret: hexToBytes(deckSecret) };
    if (isHex(rootId) && rootId.length === 64) out.rootId = rootId;
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

export function addToTableList(profile: string, store: KeyValueStore, tableAddress: string): boolean {
  const list = loadTableList(profile, store);
  if (list.includes(tableAddress)) return true;
  return writeJson(store, tablesKey(profile), [...list, tableAddress]);
}
