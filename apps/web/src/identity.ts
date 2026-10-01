import {
  type EventTemplate,
  finalizeEvent,
  getPublicKey,
  type Hex,
  isHex64,
  type NostrEvent,
  verifyEvent,
} from '@bored-games/protocol';
import { nsecEncode } from './bech32.ts';
import { bytesToHex, hexToBytes } from './hex.ts';
import type { RandomBytes } from './random.ts';
import { isPersistentStore, type KeyValueStore, readItem, storageKey, writeItem } from './storage.ts';

export type SignerKind = 'nip07' | 'local';

export interface Signer {
  pubkey: Hex;
  sign(t: EventTemplate): Promise<NostrEvent>;
  kind: SignerKind;
}

/** A loaded identity: its signer, and whether its key survives a reload (NIP-07 keys always do). */
export type LoadedSigner = Signer & { persistent: boolean };

/** The parts of the NIP-07 `window.nostr` object that this app uses. */
export interface Nip07 {
  getPublicKey(): Promise<string>;
  signEvent(t: EventTemplate): Promise<unknown>;
}

declare global {
  interface Window {
    nostr?: Nip07;
  }
}

const PROFILE = /^[A-Za-z0-9._-]{1,32}$/;
export const DEFAULT_PROFILE = 'default';

/**
 * The profile name from `?profile=<name>`. Names are 1 to 32 characters from `[A-Za-z0-9._-]`; anything else
 * (including a name with `:`, which could collide with another storage key) reads as the default profile.
 */
export function profileFromLocation(loc: { search: string }): string {
  const name = new URLSearchParams(loc.search).get('profile');
  return name !== null && PROFILE.test(name) ? name : DEFAULT_PROFILE;
}

/** The `?profile=` value when one was given but is not a valid name (so the default profile is used). */
export function invalidProfileName(loc: { search: string }): string | null {
  const name = new URLSearchParams(loc.search).get('profile');
  return name !== null && !PROFILE.test(name) ? name : null;
}

export function readSignerChoice(profile: string, store: KeyValueStore): SignerKind {
  return readItem(store, storageKey(profile, 'signer')) === 'nip07' ? 'nip07' : 'local';
}

export function writeSignerChoice(profile: string, store: KeyValueStore, choice: SignerKind): boolean {
  return writeItem(store, storageKey(profile, 'signer'), choice);
}

function validSecretKey(hex: string | null): Uint8Array | null {
  if (hex === null || !isHex64(hex)) return null;
  const sk = hexToBytes(hex);
  try {
    getPublicKey(sk);
    return sk;
  } catch {
    return null; // zero, or not below the curve order
  }
}

function newSecretKey(rnd: RandomBytes): Uint8Array {
  for (let i = 0; i < 8; i++) {
    const sk = rnd(32);
    if (sk.length !== 32) throw new RangeError('random source returned the wrong number of bytes');
    try {
      getPublicKey(sk);
      return sk;
    } catch {
      // Astronomically unlikely: draw again.
    }
  }
  throw new Error('random source produced no valid secret key');
}

function localSigner(sk: Uint8Array, rnd: RandomBytes): Signer {
  return {
    kind: 'local',
    pubkey: getPublicKey(sk),
    sign: async (t) => finalizeEvent(t, sk, rnd),
  };
}

async function nip07Signer(ext: Nip07): Promise<Signer> {
  const pubkey = await ext.getPublicKey();
  if (!isHex64(pubkey)) throw new Error('the browser extension returned a malformed public key');
  return {
    kind: 'nip07',
    pubkey,
    sign: async (t) => {
      // Hand the extension a plain copy so that it cannot alias our template.
      const template: EventTemplate = {
        kind: t.kind,
        created_at: t.created_at,
        tags: t.tags.map((tag) => [...tag]),
        content: t.content,
      };
      const ev = await ext.signEvent(template);
      if (!verifyEvent(ev)) throw new Error('the browser extension returned an invalid event');
      if (ev.pubkey !== pubkey) throw new Error('the browser extension signed with a different key');
      if (
        ev.kind !== t.kind ||
        ev.created_at !== t.created_at ||
        ev.content !== t.content ||
        JSON.stringify(ev.tags) !== JSON.stringify(t.tags)
      ) {
        throw new Error('the browser extension changed the event');
      }
      return ev;
    },
  };
}

/**
 * The signer for a profile: the NIP-07 extension when it exists and the user chose it, otherwise a local key
 * from `bg:<profile>:sk`, created on first use. A stored key that is malformed is replaced. When storage is
 * blocked the key lives in memory for this session only, and `persistent` is false.
 */
export async function loadIdentity(
  profile: string,
  store: KeyValueStore,
  rnd: RandomBytes,
  nostr?: Nip07,
): Promise<LoadedSigner> {
  if (nostr !== undefined && readSignerChoice(profile, store) === 'nip07')
    return { ...(await nip07Signer(nostr)), persistent: true };
  const key = storageKey(profile, 'sk');
  let sk = validSecretKey(readItem(store, key));
  if (sk === null) {
    sk = newSecretKey(rnd);
    writeItem(store, key, bytesToHex(sk));
  }
  // Persistent only if the key reads back from a store that outlives the page.
  const persistent = isPersistentStore(store) && readItem(store, key) === bytesToHex(sk);
  return { ...localSigner(sk, rnd), persistent };
}

/** The notice shown when the extension was chosen in Settings but is not there at load. */
export const EXTENSION_MISSING_NOTICE = "Browser extension not found; using this profile's local key.";

/**
 * The NIP-07 provider, waiting up to `ms` for an extension that injects `window.nostr` late (some do so after the
 * page's scripts start). `get` reads it, `sleep` waits; undefined when it never appears.
 */
export async function waitForNostr(
  get: () => Nip07 | undefined,
  ms: number,
  sleep: (ms: number) => Promise<void>,
): Promise<Nip07 | undefined> {
  const step = 100;
  for (let waited = 0; ; waited += step) {
    const nostr = get();
    if (nostr !== undefined || waited >= ms) return nostr;
    await sleep(step);
  }
}

/** The local secret key as `nsec1…`, or null when this profile has no valid local key stored. */
export function exportNsec(profile: string, store: KeyValueStore): string | null {
  const hex = readItem(store, storageKey(profile, 'sk'));
  return validSecretKey(hex) === null || hex === null ? null : nsecEncode(hex);
}
