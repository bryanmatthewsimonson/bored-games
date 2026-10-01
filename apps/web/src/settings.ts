import { isRelayUrl } from '@bored-games/protocol';
import { type Signal, signal } from '@preact/signals';
import { type KeyValueStore, readItem, removeItem, storageKey, writeItem } from './storage.ts';

export const DEFAULT_RELAYS: readonly string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

/** The relay that `pnpm dev` starts locally. */
export const DEV_RELAY = 'ws://localhost:7777';

/** In development the local relay comes first. */
export function defaultRelays(dev: boolean): string[] {
  return dev ? [DEV_RELAY, ...DEFAULT_RELAYS] : [...DEFAULT_RELAYS];
}

export function parseRelayInput(text: string): { ok: true; url: string } | { ok: false; error: string } {
  const url = text.trim();
  return isRelayUrl(url)
    ? { ok: true, url }
    : { ok: false, error: 'Enter a relay URL starting with wss:// or ws://' };
}

function clean(list: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const x of list) if (isRelayUrl(x) && !out.includes(x)) out.push(x);
  return out;
}

/**
 * Relays from the page URL: `?relays=ws://localhost:7777,wss://relay.example` (comma separated, or the parameter
 * repeated). Invalid and duplicate entries are dropped; null when the parameter is absent or nothing valid is
 * left. The app saves such a list as this profile's relays on load, so a test or a local setup can point a
 * production build at its own relay without opening Settings.
 */
export function relaysFromLocation(loc: { search: string }): string[] | null {
  const raw = new URLSearchParams(loc.search)
    .getAll('relays')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim());
  const list = clean(raw);
  return list.length > 0 ? list : null;
}

export interface Settings {
  /** The relay list, in priority order. Never empty. */
  relays: Signal<string[]>;
  /**
   * Saves a cleaned list (invalid and duplicate entries dropped); an empty result restores the defaults.
   * The list applies to this page either way; returns false when it could not be saved for the next visit.
   */
  setRelays(list: readonly string[]): boolean;
  resetRelays(): boolean;
}

/** Settings persisted per profile under `bg:<profile>:relays`. */
export function createSettings(profile: string, store: KeyValueStore, dev: boolean): Settings {
  const key = storageKey(profile, 'relays');
  const load = (): string[] => {
    const raw = readItem(store, key);
    if (raw !== null) {
      try {
        const v: unknown = JSON.parse(raw);
        if (Array.isArray(v)) {
          const list = clean(v);
          if (list.length > 0) return list;
        }
      } catch {
        // Fall through to the defaults.
      }
    }
    return defaultRelays(dev);
  };
  const relays = signal(load());
  return {
    relays,
    setRelays(list) {
      const next = clean(list);
      if (next.length === 0) return this.resetRelays();
      const saved = writeItem(store, key, JSON.stringify(next));
      relays.value = next;
      return saved;
    },
    resetRelays() {
      removeItem(store, key);
      relays.value = defaultRelays(dev);
      return readItem(store, key) === null;
    },
  };
}
