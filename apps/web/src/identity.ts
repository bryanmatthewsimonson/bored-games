import {
  type EventTemplate,
  finalizeEvent,
  getConversationKey,
  getPublicKey,
  type Hex,
  isHex64,
  type NostrEvent,
  nip44Decrypt,
  nip44Encrypt,
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
  /**
   * The local key this page signs with, as `nsec1…`, from memory (D057): it works when storage refuses writes or
   * holds another key now. Absent for the extension.
   */
  exportNsec?: () => string;
  /** Keep this page's local key among the kept keys if storage no longer holds it (`LoadedSigner.rescue`). */
  rescue?: () => boolean;
  /**
   * NIP-44 v2 encryption with the player key (the game key backup, D065): the local key's, or the extension's
   * `window.nostr.nip44` when it has one. Absent for an extension without it: backups are then unavailable.
   */
  nip44?: Nip44;
}

/** NIP-44 v2 encryption to and from `pubkey` with the player key (NIP-07's `nip44` object has this shape). */
export interface Nip44 {
  encrypt(pubkey: Hex, plaintext: string): Promise<string>;
  decrypt(pubkey: Hex, payload: string): Promise<string>;
}

/** NIP-44 with the local secret key `sk`; each message's 32-byte nonce comes from `rnd`. */
export function localNip44(sk: Uint8Array, rnd: RandomBytes): Nip44 {
  return {
    encrypt: async (pubkey, plaintext) => {
      const nonce = rnd(32);
      if (nonce.length !== 32) throw new RangeError('random source returned the wrong number of bytes');
      return nip44Encrypt(plaintext, getConversationKey(sk, pubkey), nonce);
    },
    decrypt: async (pubkey, payload) => nip44Decrypt(payload, getConversationKey(sk, pubkey)),
  };
}

/** The parts of the Web Locks API (`navigator.locks`) that `loadIdentity` uses. */
export interface LockManagerLike {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T> | T): Promise<T>;
}

/** What `loadIdentity` may be given besides the store: the Web Locks manager and the clock (Unix seconds). */
export interface IdentityOptions {
  locks?: LockManagerLike | undefined;
  now?: () => number;
}

/**
 * A loaded identity: its signer, whether its key survives a reload (NIP-07 keys always do), whether a lost key is
 * still to be reported (`lostKeyReported`, D057), and `rescue`, which keeps this page's local key among the kept
 * keys when storage no longer holds it (another page replaced or removed it; a no-op otherwise).
 */
export type LoadedSigner = Signer & { persistent: boolean; lostPrevious: boolean; rescue: () => boolean };

/** The parts of the NIP-07 `window.nostr` object that this app uses. */
export interface Nip07 {
  getPublicKey(): Promise<string>;
  signEvent(t: EventTemplate): Promise<unknown>;
  /** NIP-07's optional NIP-44 methods; not every extension has them. */
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<unknown>;
    decrypt(pubkey: string, payload: string): Promise<unknown>;
  };
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

/** A local signer that asks `problem` before every signature, and refuses with its message (D057, item 10). */
function guardedLocalSigner(
  sk: Uint8Array,
  rnd: RandomBytes,
  problem: () => string | null,
  rescue: () => boolean,
): Signer {
  return {
    kind: 'local',
    pubkey: getPublicKey(sk),
    sign: async (t) => {
      const p = problem();
      if (p !== null) {
        // Keep this page's key before refusing, so the player can switch back to it (Settings → Other keys).
        rescue();
        throw new Error(p);
      }
      return finalizeEvent(t, sk, rnd);
    },
    exportNsec: () => nsecEncode(bytesToHex(sk)),
    nip44: localNip44(sk, rnd),
  };
}

/** The extension's NIP-44 methods, checked, or undefined when it has none (D065). */
function extensionNip44(ext: Nip07): Nip44 | undefined {
  const n = ext.nip44;
  if (typeof n?.encrypt !== 'function' || typeof n.decrypt !== 'function') return undefined;
  const text = (v: unknown, what: string): string => {
    if (typeof v !== 'string') throw new Error(`the browser extension returned no ${what}`);
    return v;
  };
  return {
    encrypt: async (pubkey, plaintext) => text(await n.encrypt(pubkey, plaintext), 'ciphertext'),
    decrypt: async (pubkey, payload) => text(await n.decrypt(pubkey, payload), 'plaintext'),
  };
}

async function nip07Signer(ext: Nip07): Promise<Signer> {
  const pubkey = await ext.getPublicKey();
  if (!isHex64(pubkey)) throw new Error('the browser extension returned a malformed public key');
  const nip44 = extensionNip44(ext);
  return {
    kind: 'nip07',
    pubkey,
    ...(nip44 === undefined ? {} : { nip44 }),
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
  opts: IdentityOptions = {},
): Promise<LoadedSigner> {
  if (nostr !== undefined && readSignerChoice(profile, store) === 'nip07')
    return {
      ...(await nip07Signer(nostr)),
      persistent: true,
      lostPrevious: lostKeyReported(profile, store),
      rescue: () => false,
    };
  const key = storageKey(profile, 'sk');
  // Two pages of the site starting at once on a fresh browser (D057, item 10) could each find no key and each make
  // one. Where the Web Locks API exists, finding and making the key is one critical section across every tab and
  // process of the origin, so the second page finds the first page's key. Without it, the key is read back after
  // the write (which catches a write already visible here), and the signer and the storage event guard the rest.
  const ensure = (): Uint8Array => {
    const found = validSecretKey(readItem(store, key));
    if (found !== null) return found;
    // A new key where this profile has traces of an older one: that key was lost (D057). Say so until dismissed.
    if (previousKeyTraces(profile, store)) writeItem(store, lostKey(profile), '1');
    const made = newSecretKey(rnd);
    writeItem(store, key, bytesToHex(made));
    // A write refused by the browser reads back as nothing: ours stays.
    return validSecretKey(readItem(store, key)) ?? made;
  };
  let sk = validSecretKey(readItem(store, key));
  if (sk === null)
    sk = opts.locks === undefined ? ensure() : await opts.locks.request(key, { mode: 'exclusive' }, ensure);
  const hex = bytesToHex(sk);
  // Persistent only if the key reads back from a store that outlives the page.
  const persistent = isPersistentStore(store) && readItem(store, key) === hex;
  const saved = readItem(store, key) === hex;
  const now = opts.now ?? (() => 0);
  const rescue = (): boolean => keepReplacedKey(profile, store, hex, now());
  const signer = guardedLocalSigner(sk, rnd, () => storedKeyProblem(profile, store, hex, saved), rescue);
  // Which local key this profile had, so that its loss can be told from a profile that never had one.
  if (readItem(store, localPubKey(profile)) !== signer.pubkey)
    writeItem(store, localPubKey(profile), signer.pubkey);
  return { ...signer, persistent, lostPrevious: lostKeyReported(profile, store), rescue };
}

/**
 * Keep the local key `hex` among this profile's kept keys (`sk-history`) when storage no longer holds it as the
 * current key (D057): another page replaced or removed it while this page played with it. Then Settings → Other
 * keys, Switch and the recovered-seat notice can always bring it back. Nothing is written when it is the stored key
 * or already kept; false only when a needed write failed.
 */
export function keepReplacedKey(profile: string, store: KeyValueStore, hex: string, at: number): boolean {
  const bytes = validSecretKey(hex);
  if (bytes === null || readItem(store, storageKey(profile, 'sk')) === hex) return true;
  const list = keptKeys(profile, store);
  if (list.some((k) => k.sk === hex)) return true;
  return saveKeptKeys(profile, store, [{ pubkey: getPublicKey(bytes), sk: hex, at }, ...list]);
}

/** Refused when another page of this site changed the profile's key (D057, item 10). */
export const KEY_CHANGED = 'Your key changed in this browser; reload.';

/**
 * Why the local key `hex` must not sign now, or null (D057, item 10): storage holds another valid key (another page
 * of the site made or imported one), or a key that was stored (`saved`) is gone. A key that was never stored (site
 * data blocked) is checked against nothing.
 */
export function storedKeyProblem(
  profile: string,
  store: KeyValueStore,
  hex: string,
  saved: boolean,
): string | null {
  const now = readItem(store, storageKey(profile, 'sk'));
  if (now === hex) return null;
  if (validSecretKey(now) !== null) return KEY_CHANGED;
  return saved ? KEY_NOT_SAVED : null;
}

const lostKey = (profile: string): string => storageKey(profile, 'key-lost');
/** The public key of the local key this profile last loaded (D057). */
const localPubKey = (profile: string): string => storageKey(profile, 'sk-pub');

/**
 * Whether this profile shows signs of a local key it no longer has (D057), read before a new key is made: a stored
 * key that is malformed, the recorded public key of a local key, kept keys (or the older single kept key), a
 * backup record, or tables listed while the extension was never chosen (a profile that switched from the extension
 * has tables of the extension's key, so its tables alone say nothing). A profile that never had a key has none.
 */
export function previousKeyTraces(profile: string, store: KeyValueStore): boolean {
  return (
    readItem(store, storageKey(profile, 'sk')) !== null ||
    readItem(store, localPubKey(profile)) !== null ||
    readItem(store, historyKey(profile)) !== null ||
    readItem(store, legacyPreviousKey(profile)) !== null ||
    readItem(store, backupKey(profile)) !== null ||
    (readItem(store, storageKey(profile, 'signer')) === null && loadTableList(profile, store).length > 0)
  );
}

/** True while the "previous key was not found" banner is due: set when a key is lost, cleared by dismissing it. */
export function lostKeyReported(profile: string, store: KeyValueStore): boolean {
  return readItem(store, lostKey(profile)) === '1';
}

export function dismissLostKey(profile: string, store: KeyValueStore): void {
  removeItem(store, lostKey(profile));
}

/** The rest of the page banner for a key that is not being saved (D057: a reload loses it too). */
export const UNSAVED_KEY_BANNER =
  'This browser is blocking site storage, so a reload or a closed tab loses your key and your seats. Allow site data, or back up your key from Settings.';

/** The lost-key banner (D057). */
export const LOST_KEY_NOTICE =
  'Your previous key was not found in this browser, so a new one was made. Games you joined before may need it.';

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

/**
 * Before joining a table or creating one (D057): ask a player whose local key was never backed up to copy it first,
 * since the seat belongs to that key, unless they chose "Don't ask again for this key". Never for the extension,
 * which keeps its own key.
 */
export function joinBackupNeeded(
  profile: string,
  store: KeyValueStore,
  signer: { kind: SignerKind; pubkey: Hex },
): boolean {
  return (
    signer.kind === 'local' &&
    !isBackedUp(profile, store, signer.pubkey) &&
    !pubkeySet(store, backupSkipKey(profile)).includes(signer.pubkey)
  );
}

const backupSkipKey = (profile: string): string => storageKey(profile, 'backup-skip');

/** "Don't ask again for this key" (D057): no backup prompt before joins or new tables with `pubkey`. */
export function skipBackupPrompt(profile: string, store: KeyValueStore, pubkey: Hex): boolean {
  return addToPubkeySet(store, backupSkipKey(profile), pubkey);
}

/** Refused at a join or a table creation when the key in use is no longer the one stored (D057). */
export const KEY_NOT_SAVED = 'Your key is no longer saved in this browser. Reload, then back it up.';

/** Shown before a join or a table creation when this browser is not saving site data (D057). */
export const UNSAVED_KEY =
  "This browser isn't saving your key, so you could lose your seat. Allow site data (not a private tab), or back up your key first.";

/**
 * Whether the key in use is still the one stored for this profile (`bg:<profile>:sk`), read again now: a seat
 * taken with a key that is gone from storage is lost on the next reload. Always true for the extension.
 */
export function keyStillSaved(
  profile: string,
  store: KeyValueStore,
  signer: { kind: SignerKind; pubkey: Hex },
): boolean {
  return keyProblem(profile, store, signer) === null;
}

/**
 * Why the key in use cannot take a seat now, or null: storage holds another valid key (`KEY_CHANGED`: another
 * page made or imported one), or no key (`KEY_NOT_SAVED`). Never for the extension.
 */
export function keyProblem(
  profile: string,
  store: KeyValueStore,
  signer: { kind: SignerKind; pubkey: Hex },
): string | null {
  if (signer.kind !== 'local') return null;
  const sk = validSecretKey(readItem(store, storageKey(profile, 'sk')));
  if (sk === null) return KEY_NOT_SAVED;
  return getPublicKey(sk) === signer.pubkey ? null : KEY_CHANGED;
}

/**
 * What happens when the player asks to join a table or create one (D057):
 * - `refuse`: the key in use is no longer the stored one (`KEY_CHANGED`) or none is stored (`KEY_NOT_SAVED`);
 * - `unsaved`: this browser is not saving site data: only after copying the key and confirming (`UNSAVED_KEY`);
 * - `backup`: a local key never backed up: "Copy your secret key first?" (a new table seats its creator, so it is
 *   asked too);
 * - `go`: go ahead.
 */
export type JoinGate =
  | { kind: 'go' }
  | { kind: 'refuse'; error: string }
  | { kind: 'unsaved' }
  | { kind: 'backup' };

export function joinGate(
  profile: string,
  store: KeyValueStore,
  signer: { kind: SignerKind; pubkey: Hex },
  persistent: boolean,
): JoinGate {
  const problem = keyProblem(profile, store, signer);
  if (problem !== null) return { kind: 'refuse', error: problem };
  if (signer.kind === 'local' && !persistent) return { kind: 'unsaved' };
  if (joinBackupNeeded(profile, store, signer)) return { kind: 'backup' };
  return { kind: 'go' };
}

/** The part of a `StorageEvent` that `keyChangedElsewhere` reads. */
export interface StorageChange {
  /** The changed key; null when the whole storage was cleared. */
  key: string | null;
  newValue: string | null;
}

/**
 * Whether a change another page made to this site's storage (a `storage` event on `localStorage`) means this page
 * no longer plays as the key it loaded with (D057, item 10): the profile's key was replaced, removed or cleared
 * while this page signs with it, or the signer choice (local key or extension) changed. A write of the same key, or
 * any other profile's or item's change, is not.
 */
export function keyChangedElsewhere(
  change: StorageChange,
  profile: string,
  signer: { kind: SignerKind; pubkey: Hex },
): boolean {
  if (change.key === null) return true;
  if (change.key === storageKey(profile, 'signer'))
    return (change.newValue === 'nip07' ? 'nip07' : 'local') !== signer.kind;
  if (change.key !== storageKey(profile, 'sk') || signer.kind !== 'local') return false;
  const sk = validSecretKey(change.newValue);
  return sk === null || getPublicKey(sk) !== signer.pubkey;
}

/** The notice when another page of this site changed the key (D057, item 10). */
export const KEY_CHANGED_ELSEWHERE = 'Your key changed in another tab of this site. Reload to continue.';

/** `signer`, refusing to sign once `blocked()` (the key changed in another page). */
export function blockableSigner<S extends Signer>(signer: S, blocked: () => boolean): S {
  return {
    ...signer,
    sign: async (t: EventTemplate) => {
      if (blocked()) throw new Error(KEY_CHANGED_ELSEWHERE);
      return signer.sign(t);
    },
  };
}
