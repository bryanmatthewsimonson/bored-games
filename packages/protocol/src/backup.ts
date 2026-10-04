/*
 * The encrypted self-backup of a seat's game keys (PROTOCOL §3, D065): a NIP-78 app-data event (kind 30078) by the
 * player's npub, addressable by the table, whose content is NIP-44 v2 encrypted to the player's own npub. Another
 * device holding the same player key fetches it, decrypts it, and plays the seat once both keys match the seat in
 * the root (`seatForGameKeys`). Pure: encryption happens where the player key is (the app's signer).
 */
import { ProtocolError } from './errors.ts';
import { KIND } from './kinds.ts';
import { type EventTemplate, type Hex, isHex64, type NostrEvent, verifyEvent } from './nostr.ts';

/** The `d` tag of a seat's key backup: one per table, so the backup made at the Join is replaced once the game starts. */
export function keyBackupD(tableAddress: string): string {
  return `bored-games/keys/${tableAddress}`;
}

/** What a key backup holds: exactly what seat recovery needs. */
export interface KeyBackup {
  /** The table address (PROTOCOL §3), which the `d` tag names too. */
  table: string;
  /** The seat's session secret key, hex. */
  sessionSk: Hex;
  /** The seat's deck secret `x_k`, as 64 hex characters. */
  deckSecret: Hex;
  /** The game root's id, once the game has started; null in the backup made at the Join. */
  rootId: Hex | null;
  /** The seat in that root, or null before it. */
  seat: number | null;
}

/** The plaintext: `{"v":1,"table":…,"session":…,"deck":…,"root":…|null,"seat":…|null}`. */
export function encodeKeyBackup(b: KeyBackup): string {
  return JSON.stringify({
    v: 1,
    table: b.table,
    session: b.sessionSk,
    deck: b.deckSecret,
    root: b.rootId,
    seat: b.seat,
  });
}

function fail(message: string): never {
  throw new ProtocolError('bad-backup', message);
}

/** Parse a decrypted backup; throws `ProtocolError` on anything else. */
export function parseKeyBackup(text: string): KeyBackup {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    fail('the backup is not JSON');
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('the backup is not an object');
  const o = v as Record<string, unknown>;
  if (o.v !== 1) fail('unknown backup version');
  const { table, session, deck, root, seat } = o;
  if (typeof table !== 'string' || !/^37450:[0-9a-f]{64}:[A-Za-z0-9._-]{1,64}$/.test(table))
    fail('bad table address');
  if (!isHex64(session)) fail('bad session key');
  if (!isHex64(deck)) fail('bad deck secret');
  if (root !== null && !isHex64(root)) fail('bad root id');
  if (seat !== null && (typeof seat !== 'number' || !Number.isInteger(seat) || seat < 0 || seat > 63))
    fail('bad seat');
  return {
    table,
    sessionSk: session,
    deckSecret: deck,
    rootId: root as Hex | null,
    seat: seat as number | null,
  };
}

/** The unsigned backup event for `tableAddress`, with `content` already NIP-44 encrypted to the signer's own npub. */
export function keyBackupTemplate(tableAddress: string, content: string, createdAt: number): EventTemplate {
  return { kind: KIND.backup, created_at: createdAt, tags: [['d', keyBackupD(tableAddress)]], content };
}

/**
 * Whether `ev` is a valid key backup of `tableAddress` by `pubkey`: a signed kind 30078 event of that author whose
 * `d` tag names the table. Relays are not trusted to filter. The content is still to be decrypted and checked.
 */
export function isKeyBackupEvent(ev: unknown, pubkey: Hex, tableAddress: string): ev is NostrEvent {
  if (!verifyEvent(ev)) return false;
  if (ev.kind !== KIND.backup || ev.pubkey !== pubkey) return false;
  const d = ev.tags.find((t) => t[0] === 'd')?.[1];
  return d === keyBackupD(tableAddress);
}
