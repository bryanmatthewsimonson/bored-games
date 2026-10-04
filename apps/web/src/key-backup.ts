/*
 * The encrypted self-backup of a seat's game keys (ARCHITECTURE §Backup, PROTOCOL §3, D065).
 *
 * A seat's session key and deck secret are made in the browser that joins, and lived only there: the same player key
 * on a second device could only watch (owner report, 2026-10-03). After a Join (and once the game has started) the
 * app publishes them as a NIP-78 app-data event (kind 30078, `d` = `bored-games/keys/<table address>`), signed by the
 * player key and NIP-44 v2 encrypted to the player's own npub. A device that finds the player seated but holds no
 * game keys fetches it from the root's relays and the player's own, decrypts it, and keeps it only if both keys are
 * that seat's in the root (`backupSeat`, the same check as seat recovery, D057). The restored device then plays as a
 * second device of the seat: the check before signing and the deterministic builds apply (D063).
 */
import { backupSeat } from '@bored-games/client';
import {
  encodeKeyBackup,
  type Hex,
  isKeyBackupEvent,
  isNip44Payload,
  KIND,
  keyBackupD,
  keyBackupTemplate,
  type NostrEvent,
  type ParsedRoot,
  parseKeyBackup,
} from '@bored-games/protocol';
import type { EoseInfo } from '@bored-games/relay';
import type { Timers } from './clock.ts';
import { bytesToHex, hexToBytes } from './hex.ts';
import type { Nip44, Signer, SignerKind } from './identity.ts';
import { type PoolLike, unionRelays } from './net.ts';
import {
  addToTableList,
  type GameSecrets,
  type KeyValueStore,
  loadSecrets,
  readJson,
  saveSecrets,
  storageKey,
  writeJson,
} from './storage.ts';

/** Why a backup cannot be made or read with an extension that has no NIP-44 (D065). */
export const BACKUP_NO_NIP44 =
  "Your browser extension can't encrypt (it has no NIP-44 support), so game keys can't be backed up or restored with it.";

/**
 * For extension users (review L3): the backup is decrypted by the player key, so whatever may decrypt with it can take
 * the seat.
 */
export const EXTENSION_DECRYPT_NOTE =
  'Your game keys are backed up encrypted to your key. Any site you let your extension decrypt for (NIP-44) could read them, play your seats and see your hidden cards: allow that only for sites you trust.';

/** The signer's NIP-44, or the reason there is none. */
export function backupUnavailable(signer: Pick<Signer, 'nip44'>): string | null {
  return signer.nip44 === undefined ? BACKUP_NO_NIP44 : null;
}

/** What this profile recorded about the backup of a table's game keys: when it was published, and for which root. */
export interface BackupRecord {
  at: number;
  rootId: Hex | null;
  /** The backup event's id, once known (a record made before review M1, or by a restore, has none). */
  id?: Hex;
}

export const backupRecordKey = (profile: string, tableAddress: string): string =>
  storageKey(profile, `keybackup:${tableAddress}`);

export function loadBackupRecord(
  profile: string,
  store: KeyValueStore,
  tableAddress: string,
): BackupRecord | null {
  const v = readJson(store, backupRecordKey(profile, tableAddress));
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const { at, rootId, id } = v as Record<string, unknown>;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  const hex = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
  return { at, rootId: hex(rootId) ? rootId : null, ...(hex(id) ? { id } : {}) };
}

function saveBackupRecord(profile: string, store: KeyValueStore, address: string, r: BackupRecord): boolean {
  return writeJson(store, backupRecordKey(profile, address), r);
}

/**
 * Whether the backup is still to be published from this profile: none recorded. A backup made at the Join, before the
 * root, is enough: a restore checks the keys against the seat in the root, not the root id.
 */
export function backupDue(profile: string, store: KeyValueStore, tableAddress: string): boolean {
  return loadBackupRecord(profile, store, tableAddress) === null;
}

/**
 * Why `content` must not be published as the encryption of `plaintext`, or null (review L2). A browser extension's
 * NIP-44 is not trusted: one that returned the plaintext, or a NIP-04 string, would publish the seat's keys in the
 * clear. The content must be a NIP-44 v2 payload of exactly that length and contain neither secret; then it is
 * decrypted once, if the signer allows, and must give the plaintext back.
 */
export async function ciphertextProblem(
  nip44: Nip44,
  pubkey: Hex,
  content: string,
  plaintext: string,
  secrets: readonly string[],
  timers: Timers,
): Promise<string | null> {
  const refused = 'Your signer returned something that is not a NIP-44 encryption, so nothing was published.';
  if (!isNip44Payload(content, new TextEncoder().encode(plaintext).length)) return refused;
  if (secrets.some((x) => content.toLowerCase().includes(x))) return refused;
  let back: string | typeof TIMED_OUT;
  try {
    back = await withTimeout(nip44.decrypt(pubkey, content), timers, DECRYPT_MS);
  } catch {
    return null; // not allowed to decrypt: the shape checks above stand
  }
  if (back === TIMED_OUT) return null;
  return back === plaintext ? null : refused;
}

/** What publishing and restoring need: a slice of `ControllerDeps`. */
export interface BackupDeps {
  timers: Timers;
  pool: PoolLike;
  signer: Signer;
  storage: KeyValueStore;
  profile: string;
  relays: () => readonly string[];
  now: () => number;
}

export type BackupResult = { ok: true; event: NostrEvent } | { ok: false; error: string };

/**
 * Publish the backup of this browser's game keys for `tableAddress` to the table's relays and the player's own.
 * Refused when the keys are not here, belong to another player key (they would be encrypted to the wrong npub and
 * could not be restored by it), or the signer cannot encrypt.
 */
export async function publishKeyBackup(
  deps: BackupDeps,
  tableAddress: string,
  opts: { tableRelays: readonly string[]; rootId?: Hex | null; seat?: number | null },
): Promise<BackupResult> {
  const { signer, storage, profile } = deps;
  const secrets = loadSecrets(profile, storage, tableAddress);
  if (secrets === null) return { ok: false, error: 'This browser holds no game keys for this game.' };
  if (secrets.owner !== undefined && secrets.owner !== signer.pubkey)
    return {
      ok: false,
      error: 'These game keys belong to another of your keys, so they cannot be backed up with this one.',
    };
  const nip44 = signer.nip44;
  if (nip44 === undefined) return { ok: false, error: BACKUP_NO_NIP44 };
  const rootId = opts.rootId ?? secrets.rootId ?? null;
  try {
    const plaintext = encodeKeyBackup({
      table: tableAddress,
      sessionSk: bytesToHex(secrets.sessionSk),
      deckSecret: bytesToHex(secrets.deckSecret).padStart(64, '0'),
      rootId,
      seat: opts.seat ?? null,
    });
    const content = await withTimeout(nip44.encrypt(signer.pubkey, plaintext), deps.timers, DECRYPT_MS);
    if (content === TIMED_OUT)
      return { ok: false, error: 'Your signer did not answer the request to encrypt.' };
    const problem = await ciphertextProblem(
      nip44,
      signer.pubkey,
      content,
      plaintext,
      [bytesToHex(secrets.sessionSk), bytesToHex(secrets.deckSecret).padStart(64, '0')],
      deps.timers,
    );
    if (problem !== null) return { ok: false, error: problem };
    const event = await signer.sign(keyBackupTemplate(tableAddress, content, deps.now()));
    const results = await deps.pool.publish(event, unionRelays(opts.tableRelays, deps.relays()));
    // Only the game's own relays count (review M1): every device of the seat asks them, while the player's own relays
    // may differ from device to device.
    if (!results.some((r) => r.ok && opts.tableRelays.includes(r.url)))
      return {
        ok: false,
        error: "None of this game's relays accepted the backup. Check your connection and try again.",
      };
    saveBackupRecord(profile, storage, tableAddress, { at: event.created_at, rootId, id: event.id });
    return { ok: true, event };
  } catch (e) {
    return { ok: false, error: `The backup failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** How long a backup query waits for the relays before it settles for what it has. */
export const BACKUP_QUERY_MS = 15_000;

/** What a backup query found: the events, those a root relay sent, and whether the answer is complete. */
export interface BackupQuery {
  events: NostrEvent[];
  /** The events that at least one of the root's relays sent (the relays every seat's devices ask). */
  onRoot: NostrEvent[];
  /**
   * Every root relay answered (EOSE) before the pool's deadline and ours (`BACKUP_QUERY_MS`): only then does "no
   * backup" mean none is there, rather than relays that were slow or down.
   */
  complete: boolean;
}

/** Whether `info` is a complete answer from every relay in `rootRelays` (D065, review L1). */
export function completeAnswer(info: EoseInfo | null, rootRelays: readonly string[]): boolean {
  if (info === null || info.timedOut) return false;
  if (info.eosedUrls === undefined) return info.eose === info.relays;
  const eosed = new Set(info.eosedUrls);
  return rootRelays.every((u) => eosed.has(u));
}

/**
 * Ask the pool's relays (the caller adds the root's and the player's own) for the player's backups of `tableAddress`.
 * Relays are not trusted to filter: only valid backups of that author and table are kept.
 */
export function fetchKeyBackups(
  pool: PoolLike,
  timers: Timers,
  pubkey: Hex,
  tableAddress: string,
  rootRelays: readonly string[],
  ms = BACKUP_QUERY_MS,
): Promise<BackupQuery> {
  return new Promise((resolve) => {
    const events = new Map<string, NostrEvent>();
    const onRoot = new Map<string, NostrEvent>();
    const roots = new Set(rootRelays);
    let settled = false;
    let stop: (() => void) | null = null;
    let cancel: (() => void) | null = null;
    const finish = (info: EoseInfo | null): void => {
      if (settled) return;
      settled = true;
      stop?.();
      cancel?.();
      resolve({
        events: [...events.values()],
        onRoot: [...onRoot.values()],
        complete: completeAnswer(info, rootRelays),
      });
    };
    const s = pool.subscribe(
      [{ kinds: [KIND.backup], authors: [pubkey], '#d': [keyBackupD(tableAddress)] }],
      (ev, url) => {
        if (!isKeyBackupEvent(ev, pubkey, tableAddress)) return;
        events.set(ev.id, ev);
        if (roots.has(url)) onRoot.set(ev.id, ev);
      },
      finish,
    );
    if (settled) s();
    else stop = s;
    const c = timers.later(ms, () => finish(null));
    if (settled) c();
    else cancel = c;
  });
}

/**
 * - `restored`: the newest backup that decrypts and whose keys are the player's seat in `root`;
 * - `none`: no backup event found;
 * - `unreadable`: backups found, but none decrypts (another key, or damaged);
 * - `mismatch`: a backup decrypts, but its keys are not this seat's in this game;
 * - `refused`: the browser extension refused (or failed) to decrypt: a rejected prompt is not a bad backup;
 * - `timeout`: the signer did not answer within `DECRYPT_MS` (an extension prompt left open).
 */
export type RestoreResult =
  | { kind: 'restored'; seat: number; secrets: GameSecrets }
  | { kind: 'none' }
  | { kind: 'unreadable' }
  | { kind: 'mismatch' }
  | { kind: 'refused' }
  | { kind: 'timeout' };

/** How long one decryption (or encryption) by the signer may take: an extension prompt waits for the player. */
export const DECRYPT_MS = 60_000;

const TIMED_OUT = Symbol('timed out');

/** `p`, or `TIMED_OUT` after `ms` (review L4): an unanswered extension prompt must not hang the screen. */
export function withTimeout<T>(p: Promise<T>, timers: Timers, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const cancel = timers.later(ms, () => resolve(TIMED_OUT));
    p.then(
      (v) => {
        cancel();
        resolve(v);
      },
      (e: unknown) => {
        cancel();
        reject(e);
      },
    );
  });
}

/** Decrypt and check the backups `events` against the player's seat in `root` (newest first). */
export async function restoreKeyBackup(
  signer: Pick<Signer, 'pubkey' | 'nip44'> & { kind?: SignerKind },
  root: Pick<ParsedRoot, 'id' | 'tableAddress' | 'seats'>,
  events: readonly NostrEvent[],
  timers: Timers,
  ms = DECRYPT_MS,
): Promise<RestoreResult> {
  const nip44 = signer.nip44;
  const mine = events
    .filter((ev) => isKeyBackupEvent(ev, signer.pubkey, root.tableAddress))
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
  if (mine.length === 0 || nip44 === undefined) return { kind: 'none' };
  let worst: RestoreResult = { kind: 'unreadable' };
  for (const ev of mine) {
    let text: string | typeof TIMED_OUT;
    try {
      text = await withTimeout(nip44.decrypt(signer.pubkey, ev.content), timers, ms);
    } catch {
      // An extension that throws may have been refused by the player: say so, and ask nothing more.
      if (signer.kind === 'nip07') return { kind: 'refused' };
      continue;
    }
    if (text === TIMED_OUT) return { kind: 'timeout' };
    let backup: ReturnType<typeof parseKeyBackup>;
    try {
      backup = parseKeyBackup(text);
    } catch {
      continue;
    }
    worst = { kind: 'mismatch' };
    if (backup.table !== root.tableAddress || (backup.rootId !== null && backup.rootId !== root.id)) continue;
    const sessionSk = hexToBytes(backup.sessionSk);
    const deckSecret = BigInt(`0x${backup.deckSecret}`);
    const seat = backupSeat(root, signer.pubkey, sessionSk, deckSecret);
    if (seat === null) continue;
    return {
      kind: 'restored',
      seat,
      secrets: {
        sessionSk,
        deckSecret: hexToBytes(backup.deckSecret),
        rootId: root.id,
        owner: signer.pubkey,
      },
    };
  }
  return worst;
}

/**
 * Whether the game's relays hold a usable backup of this seat's keys (review M1), from a query of them (`onRoot`):
 * - with a local key, one decrypts, passes `backupSeat` for `seat`, and holds exactly the keys saved here;
 * - with an extension, which would prompt to decrypt, the backup this profile published (the recorded id) is there;
 *   with no recorded id (an older record), any backup of the table is taken as it.
 */
export async function backupHealthy(
  signer: Pick<Signer, 'pubkey' | 'nip44' | 'kind'>,
  root: Pick<ParsedRoot, 'id' | 'tableAddress' | 'seats'>,
  seat: number,
  saved: GameSecrets,
  onRoot: readonly NostrEvent[],
  record: BackupRecord | null,
  timers: Timers,
): Promise<boolean> {
  if (onRoot.length === 0) return false;
  if (signer.kind !== 'local') return record?.id === undefined || onRoot.some((ev) => ev.id === record.id);
  const r = await restoreKeyBackup(signer, root, onRoot, timers);
  return (
    r.kind === 'restored' &&
    r.seat === seat &&
    bytesToHex(r.secrets.sessionSk) === bytesToHex(saved.sessionSk) &&
    bytesToHex(r.secrets.deckSecret) === bytesToHex(saved.deckSecret).padStart(64, '0')
  );
}

/** Record a backup found healthy on the game's relays (`backupHealthy`) when none was recorded. */
export function noteBackup(
  profile: string,
  store: KeyValueStore,
  tableAddress: string,
  ev: NostrEvent,
  rootId: Hex,
): void {
  const r = loadBackupRecord(profile, store, tableAddress);
  if (r?.id !== ev.id)
    saveBackupRecord(profile, store, tableAddress, { at: ev.created_at, rootId, id: ev.id });
}

/**
 * Keep restored game keys in this profile: the secrets (owned by the player key) and the table in the list, so Home
 * shows the game. A restored backup counts as published. False when storage refused the write; existing game keys
 * for the table are never overwritten.
 */
export function saveRestored(
  profile: string,
  store: KeyValueStore,
  tableAddress: string,
  secrets: GameSecrets,
  at: number,
): boolean {
  if (loadSecrets(profile, store, tableAddress) !== null) return false;
  if (!saveSecrets(profile, store, tableAddress, secrets)) return false;
  if (loadSecrets(profile, store, tableAddress) === null) return false;
  addToTableList(profile, store, tableAddress, secrets.owner);
  saveBackupRecord(profile, store, tableAddress, { at, rootId: secrets.rootId ?? null });
  return true;
}

/* What the game screen says (D065). */

export const RESTORE_TEXT = {
  restoring: 'Restoring your game keys from your backup…',
  restored:
    'Your game keys were restored from your backup, so you can play your seat here. Play on one device at a time: two devices acting at the same moment can sign two rival moves, which counts against your seat. A turn saved on the other device but never sent is dropped once this one has played it.',
  none: "You're watching this game: this browser does not hold your game keys for it, and no backup of them was found on its relays. Open the game on the device you joined with: when it opens the game it looks for its backup there and publishes it again if it is missing (with a browser extension, tap its backup button there). Then try again here.",
  incomplete:
    "You're watching this game: this browser does not hold your game keys for it, and your relays did not answer in time to find a backup. Try again, or open the game on the device you joined with.",
  unreadable:
    "You're watching this game: a backup of your game keys was found, but it could not be decrypted with this key. Open the game on the device you joined with.",
  mismatch:
    "You're watching this game: the backup found does not hold the keys of your seat in this game. Open the game on the device you joined with: when it opens the game it checks its backup and publishes the right keys again (with a browser extension, tap its backup button there). Then try again here.",
  failed:
    "You're watching this game: your game keys were found in your backup, but this browser would not save them.",
  refused:
    "You're watching this game: your browser extension did not decrypt the backup of your game keys (the request was refused, or it failed). Try again and allow it.",
  timeout:
    "You're watching this game: your browser extension did not answer the request to decrypt the backup of your game keys. Try again and allow it.",
} as const;
