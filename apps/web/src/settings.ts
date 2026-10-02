import { isRelayUrl } from '@bored-games/protocol';
import { type Signal, signal } from '@preact/signals';
import { DEFAULT_BLOSSOM, parseBlossomServer } from './blossom.ts';
import { type KeyValueStore, readItem, removeItem, storageKey, writeItem } from './storage.ts';

/** The owner's choice of default relay for everybody (D038). Players can add more in Settings. */
export const DEFAULT_RELAYS: readonly string[] = ['wss://relay.primal.net'];

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

/** A relay on this machine: `ws://localhost[:port]` or `ws://127.0.0.1[:port]`, with no path. */
export function isLocalRelayUrl(url: string): boolean {
  return /^ws:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/?$/.test(url) && isRelayUrl(url);
}

/** The one-line notice shown when `?relays=` named a relay that is not local. */
export const IGNORED_RELAYS_NOTICE = 'Ignored relays from the link; change relays in Settings.';

/**
 * The `?relays=` parameter (comma separated, or repeated):
 * - `absent`: no parameter, or only empty entries
 * - `local`: every entry is a local relay (`isLocalRelayUrl`); the list, without duplicates
 * - `ignored`: some entry is anything else, or links may not set relays in this build (`allowed` false). A link
 *   must not be able to move a player onto a stranger's relays, so only local relays are honoured, and only in a
 *   dev server (`pnpm dev`) or a build made with `VITE_ALLOW_LINK_RELAYS=1` (`pnpm e2e`). In a production build
 *   even a local relay is refused: it would silently cut the player off from their games.
 *
 * The app saves a `local` list as this profile's relays on load, as if edited in Settings.
 */
export type RelaysParam = { kind: 'absent' } | { kind: 'local'; relays: string[] } | { kind: 'ignored' };

export function relaysFromLocation(loc: { search: string }, allowed: boolean): RelaysParam {
  const raw = new URLSearchParams(loc.search)
    .getAll('relays')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v !== '');
  if (raw.length === 0) return { kind: 'absent' };
  if (!allowed || !raw.every(isLocalRelayUrl)) return { kind: 'ignored' };
  return { kind: 'local', relays: clean(raw) };
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
  /** The Blossom server that profile pictures are uploaded to (D040). */
  blossom: Signal<string>;
  /** Saves a server URL; null or an invalid URL restores the default. Returns false when it was not saved. */
  setBlossom(url: string | null): boolean;
}

/** Settings persisted per profile under `bg:<profile>:relays` and `bg:<profile>:blossom`. */
export function createSettings(profile: string, store: KeyValueStore, dev: boolean): Settings {
  const key = storageKey(profile, 'relays');
  const blossomKey = storageKey(profile, 'blossom');
  const blossom = signal(parseBlossomServer(readItem(store, blossomKey) ?? '') ?? DEFAULT_BLOSSOM);
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
    blossom,
    setBlossom(url) {
      const next = url === null ? null : parseBlossomServer(url);
      if (next === null || next === DEFAULT_BLOSSOM) {
        removeItem(store, blossomKey);
        blossom.value = DEFAULT_BLOSSOM;
        return readItem(store, blossomKey) === null;
      }
      blossom.value = next;
      return writeItem(store, blossomKey, next);
    },
  };
}
