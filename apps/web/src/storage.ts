/*
 * Impure entry point 3 of 3 (with random.ts and clock.ts): `localStorage`. All other code takes a
 * `KeyValueStore`, so tests pass `memoryStorage()`. Every key is namespaced by profile: `bg:<profile>:<name>`,
 * which keeps two tabs with different `?profile=` values apart (they act as different players).
 */
import { bytesToHex, hexToBytes, isHex } from './hex.ts';

/** The part of the Web Storage API that this app uses. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const storageKey = (profile: string, name: string): string => `bg:${profile}:${name}`;

export function memoryStorage(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
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
    const { sessionSk, deckSecret } = v as Record<string, unknown>;
    if (!isHex(sessionSk) || !isHex(deckSecret)) return null;
    return { sessionSk: hexToBytes(sessionSk), deckSecret: hexToBytes(deckSecret) };
  } catch {
    return null;
  }
}
