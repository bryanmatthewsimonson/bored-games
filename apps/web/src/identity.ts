import {
  type EventTemplate,
  finalizeEvent,
  getPublicKey,
  type Hex,
  isHex64,
  type NostrEvent,
  verifyEvent,
} from '@bored-games/protocol';
import { decodeNostrKey, nsecEncode } from './bech32.ts';
import { bytesToHex, hexToBytes } from './hex.ts';
import type { RandomBytes } from './random.ts';
import {
  claimUnowned,
  isPersistentStore,
  type KeyValueStore,
  loadGameStatus,
  loadSecrets,
  loadTableList,
  readItem,
  removeItem,
  storageKey,
  tableIsMine,
  tableOwner,
  writeItem,
} from './storage.ts';

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

/* Key import and backup (D041). */

export type KeyInput = { ok: true; hex: string } | { ok: false; error: string };

export const KEY_ERRORS = {
  empty: 'Paste a secret key: it starts with nsec1.',
  npub: 'That is a public key (npub), which anyone can see. Paste the secret key instead: it starts with nsec1.',
  malformed: 'That is not a secret key. Paste a key that starts with nsec1, or 64 hexadecimal characters.',
  invalid: 'That secret key is not valid.',
  same: 'This profile already uses that key.',
  notSaved: 'This browser would not save the key, so nothing was changed.',
  notPersistent:
    'This browser is not saving site data (a private window, or site data blocked), so an imported key would be lost when the page reloads, and so would your current key. Use a normal window to import a key.',
} as const;

/** A pasted secret key: `nsec1…` or 64 hex characters. An npub is refused with its own message. */
export function parseSecretKeyInput(text: string): KeyInput {
  const t = text.trim();
  if (t === '') return { ok: false, error: KEY_ERRORS.empty };
  const d = decodeNostrKey(t);
  if (d?.type === 'npub') return { ok: false, error: KEY_ERRORS.npub };
  const hex = d?.type === 'nsec' ? d.hex : /^[0-9a-fA-F]{64}$/.test(t) ? t.toLowerCase() : null;
  if (hex === null) return { ok: false, error: KEY_ERRORS.malformed };
  if (validSecretKey(hex) === null) return { ok: false, error: KEY_ERRORS.invalid };
  return { ok: true, hex };
}

export type ImportResult = { ok: true; pubkey: Hex } | { ok: false; error: string };

/** A player key this profile used before, kept so the player can switch back to it (D041). */
export interface KeptKey {
  pubkey: Hex;
  /** The secret key, hex. */
  sk: string;
  /** When it was replaced (Unix seconds). */
  at: number;
}

/** Past this many kept keys, the oldest that are backed up and have no game in progress may be dropped. */
export const KEPT_KEYS_SOFT_CAP = 10;

const historyKey = (profile: string): string => storageKey(profile, 'sk-history');
/** Where an older version kept a single replaced key; read once and folded into the history. */
const legacyPreviousKey = (profile: string): string => storageKey(profile, 'sk-previous');

/** The keys this profile replaced, newest first. Malformed entries are skipped. */
export function keptKeys(profile: string, store: KeyValueStore): KeptKey[] {
  const out: KeptKey[] = [];
  const raw = readItem(store, historyKey(profile));
  let list: unknown = null;
  try {
    list = raw === null ? null : JSON.parse(raw);
  } catch {
    list = null;
  }
  const add = (sk: unknown, at: unknown) => {
    if (typeof sk !== 'string') return;
    const bytes = validSecretKey(sk);
    if (bytes === null) return;
    const pubkey = getPublicKey(bytes);
    if (out.some((k) => k.pubkey === pubkey)) return;
    out.push({ pubkey, sk, at: typeof at === 'number' && Number.isFinite(at) ? at : 0 });
  };
  if (Array.isArray(list)) for (const e of list) if (typeof e === 'object' && e !== null) add(e.sk, e.at);
  add(readItem(store, legacyPreviousKey(profile)), 0);
  const current = readItem(store, storageKey(profile, 'sk'));
  return out.filter((k) => k.sk !== current).sort((a, b) => b.at - a.at);
}

/**
 * Keep the list of replaced keys within `KEPT_KEYS_SOFT_CAP` by dropping the oldest ones that are backed up
 * and have no game in progress. A key that is not backed up, or still has a game, is never dropped, even past
 * the cap.
 */
export function pruneKeptKeys(list: readonly KeptKey[], droppable: (k: KeptKey) => boolean): KeptKey[] {
  const out = [...list].sort((a, b) => b.at - a.at);
  for (let i = out.length - 1; i >= 0 && out.length > KEPT_KEYS_SOFT_CAP; i--)
    if (droppable(out[i] as KeptKey)) out.splice(i, 1);
  return out;
}

function saveKeptKeys(profile: string, store: KeyValueStore, list: readonly KeptKey[]): boolean {
  const key = historyKey(profile);
  const pruned = pruneKeptKeys(
    list,
    (k) => isBackedUp(profile, store, k.pubkey) && gamesInProgress(profile, store, k.pubkey, false) === 0,
  );
  const json = JSON.stringify(pruned.map((k) => ({ pubkey: k.pubkey, sk: k.sk, at: k.at })));
  return writeItem(store, key, json) && readItem(store, key) === json;
}

/** Who the player is now and when, for a key change: the active signer's pubkey and Unix seconds. */
export interface KeyChangeContext {
  /** The pubkey the profile plays as right now (the extension's, when it is in use). */
  current: Hex;
  now: number;
}

/**
 * Replace the profile's local key with `nextSk` (hex, valid), keeping the old one in the history first, and
 * switch the signer to the local key. Every write is checked; on a failure nothing the player had is lost:
 * the old key is in the history before `sk` is overwritten.
 */
function replaceKey(
  profile: string,
  store: KeyValueStore,
  nextSk: string,
  ctx: KeyChangeContext,
): string | null {
  if (!isPersistentStore(store)) return KEY_ERRORS.notPersistent;
  // Tables and secrets listed so far belong to the key in use: record that before it changes.
  const known = new Set([ctx.current, ...keptKeys(profile, store).map((k) => k.pubkey)]);
  const creatorOf = (address: string): string | null => {
    const creator = address.split(':')[1] ?? '';
    return known.has(creator) ? creator : null;
  };
  if (!claimUnowned(profile, store, ctx.current, creatorOf)) return KEY_ERRORS.notSaved;
  const skKey = storageKey(profile, 'sk');
  const current = readItem(store, skKey);
  const history = keptKeys(profile, store).filter((k) => k.sk !== nextSk);
  const currentBytes = validSecretKey(current);
  if (current !== null && currentBytes !== null && current !== nextSk)
    history.unshift({ pubkey: getPublicKey(currentBytes), sk: current, at: ctx.now });
  if (!saveKeptKeys(profile, store, history)) return KEY_ERRORS.notSaved;
  removeItem(store, legacyPreviousKey(profile));
  if (!writeItem(store, skKey, nextSk) || readItem(store, skKey) !== nextSk) return KEY_ERRORS.notSaved;
  if (!writeSignerChoice(profile, store, 'local') || readSignerChoice(profile, store) !== 'local')
    return KEY_ERRORS.notSaved;
  return null;
}

/**
 * Make a pasted secret key this profile's key. The current local key joins the kept keys, never overwritten,
 * so the player can switch back to it; the profile signs with the local key from now on (not the extension).
 * Refused when this browser is not saving site data. The imported key counts as backed up (it exists
 * elsewhere). The page must reload afterwards.
 */
export function importSecretKey(
  profile: string,
  store: KeyValueStore,
  text: string,
  ctx: KeyChangeContext,
): ImportResult {
  if (!isPersistentStore(store)) return { ok: false, error: KEY_ERRORS.notPersistent };
  const input = parseSecretKeyInput(text);
  if (!input.ok) return input;
  const current = readItem(store, storageKey(profile, 'sk'));
  if (current === input.hex && readSignerChoice(profile, store) === 'local')
    return { ok: false, error: KEY_ERRORS.same };
  const error = replaceKey(profile, store, input.hex, ctx);
  if (error !== null) return { ok: false, error };
  const pubkey = getPublicKey(hexToBytes(input.hex));
  addToPubkeySet(store, importedKey(profile), pubkey);
  markBackedUp(profile, store, pubkey);
  return { ok: true, pubkey };
}

/** Switch to one of the kept keys; the current key joins the kept keys. The page must reload afterwards. */
export function switchToKeptKey(
  profile: string,
  store: KeyValueStore,
  pubkey: Hex,
  ctx: KeyChangeContext,
): ImportResult {
  const target = keptKeys(profile, store).find((k) => k.pubkey === pubkey);
  if (target === undefined) return { ok: false, error: 'That key is no longer kept in this browser.' };
  const error = replaceKey(profile, store, target.sk, ctx);
  return error === null ? { ok: true, pubkey } : { ok: false, error };
}

/**
 * Before switching between the local key and the extension: record the tables listed so far as the current
 * key's, so the other key never reuses their game keys.
 */
export function claimTablesFor(profile: string, store: KeyValueStore, current: Hex): boolean {
  return claimUnowned(profile, store, current);
}

/**
 * How many of this profile's tables that belong to `pubkey` are still going (not done or cancelled, as far as
 * the saved statuses say). Tables with no recorded owner count for the key in use (`current`).
 */
export function gamesInProgress(profile: string, store: KeyValueStore, pubkey: Hex, current = true): number {
  let n = 0;
  for (const address of loadTableList(profile, store)) {
    const owner = tableOwner(profile, store, address);
    if (owner === null ? !current : owner !== pubkey) continue;
    const rootId = loadSecrets(profile, store, address)?.rootId;
    const status = rootId === undefined ? null : loadGameStatus(profile, store, rootId)?.status;
    if (status !== 'done' && status !== 'cancelled') n++;
  }
  return n;
}

const backupKey = (profile: string): string => storageKey(profile, 'backup');
const importedKey = (profile: string): string => storageKey(profile, 'imported');

function pubkeySet(store: KeyValueStore, key: string): Hex[] {
  const raw = readItem(store, key);
  if (raw === null) return [];
  if (isHex64(raw)) return [raw]; // an older version kept one pubkey
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isHex64) : [];
  } catch {
    return [];
  }
}

/** Record that the player saved the secret key of `pubkey` (copied it, said so, or imported it). */
function addToPubkeySet(store: KeyValueStore, key: string, pubkey: Hex): boolean {
  const list = pubkeySet(store, key);
  if (list.includes(pubkey)) return true;
  return writeItem(store, key, JSON.stringify([...list, pubkey]));
}

export function markBackedUp(profile: string, store: KeyValueStore, pubkey: Hex): boolean {
  return addToPubkeySet(store, backupKey(profile), pubkey);
}

export function isBackedUp(profile: string, store: KeyValueStore, pubkey: Hex): boolean {
  return pubkeySet(store, backupKey(profile)).includes(pubkey);
}

/**
 * True for a key imported into this profile (`bg:<profile>:imported`), as opposed to one this app generated:
 * an imported key may already have a profile on relays this app does not use.
 */
export function isImportedKey(profile: string, store: KeyValueStore, pubkey: Hex): boolean {
  return pubkeySet(store, importedKey(profile)).includes(pubkey);
}

/** The Home backup reminder: a local key with at least one table of its own, until the key is backed up. */
export function backupReminderVisible(
  profile: string,
  store: KeyValueStore,
  signer: { kind: SignerKind; pubkey: Hex },
): boolean {
  return (
    signer.kind === 'local' &&
    loadTableList(profile, store).some((a) => tableIsMine(profile, store, a, signer.pubkey)) &&
    !isBackedUp(profile, store, signer.pubkey)
  );
}
