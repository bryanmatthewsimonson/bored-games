/*
 * "You're watching this game" (D057): what the game screen says when the key in use holds none of the game's
 * seats. Pure: the screen reads the seats, the kept keys and the local record of the table, and passes them in.
 *
 * A key lives in one browser's storage, so a player who joined from an in-app browser, a private tab or a
 * home-screen copy and then opens the game in their usual browser arrives there with another key, and the app
 * silently made them a spectator. The notice says so, and names the key.
 */
import type { Hex } from '@bored-games/protocol';
import { npubEncode, shortNpub } from './bech32.ts';
import { type KeyValueStore, loadSecrets, loadTableList, tableIsMine, tableOwner } from './storage.ts';

/** What this profile's storage knows about the game's table (`storage.ts`). */
export interface LocalTableRecord {
  /** The table is in this profile's table list (created or joined from this browser). */
  listed: boolean;
  /** This profile holds game keys (secrets) for the table. */
  secrets: boolean;
  /** The player key the listing or the game keys belong to (`tableOwner`); null when none is recorded. */
  owner: Hex | null;
}

/**
 * - `kept`: one of this profile's kept keys (Settings → Other keys) holds a seat: switch to it to play.
 * - `other-key`: this profile holds game keys for the table made for `owner`, which is seated but is not a key this
 *   browser has: import it to play.
 * - `not-seated`: the table was joined from here with `owner`, but the game started without that key.
 * - `elsewhere`: the common case, and the incident behind D057: this key has no local record of the table and no
 *   table of its own in this browser (a fresh key), so the player probably joined from another app or browser.
 * - `visitor`: a key that plays other games here and has no record of this one: most likely watching on purpose.
 */
export type WatchNotice =
  | { kind: 'kept'; pubkey: Hex }
  | { kind: 'other-key'; owner: Hex }
  | { kind: 'not-seated'; owner: Hex }
  | { kind: 'elsewhere' }
  | { kind: 'visitor' };

export interface WatchInput {
  /** The game's seats (identity pubkeys), in seat order; empty until the game's start event is known. */
  seats: readonly Hex[];
  /** The key in use. */
  me: Hex;
  /** This profile's kept keys (`keptKeys`), newest first. */
  kept: readonly Hex[];
  record: LocalTableRecord;
  /** How many tables in this profile's list belong to the key in use (`tableIsMine`). */
  myTables: number;
}

/** The notice for a player whose key holds no seat, or null when it holds one (or the seats are not known yet). */
export function watchNotice(input: WatchInput): WatchNotice | null {
  const { seats, me, kept, record } = input;
  if (seats.length === 0 || seats.includes(me)) return null;
  const seatedKept = kept.find((k) => seats.includes(k));
  if (seatedKept !== undefined) return { kind: 'kept', pubkey: seatedKept };
  if (record.listed || record.secrets) {
    // A listing or game keys with no recorded owner belong to the key in use (`tableIsMine`).
    const owner = record.owner ?? me;
    if (owner !== me && seats.includes(owner)) return { kind: 'other-key', owner };
    return { kind: 'not-seated', owner };
  }
  return input.myTables === 0 ? { kind: 'elsewhere' } : { kind: 'visitor' };
}

const short = (pubkey: Hex): string => shortNpub(npubEncode(pubkey));

/** The notice as a lead sentence and an optional explanation, for the screen and its tests. */
export function watchText(notice: WatchNotice, me: Hex): { lead: string; body: string | null } {
  const watching = "You're watching this game.";
  switch (notice.kind) {
    case 'kept':
      return {
        lead: `You joined this game with ${short(notice.pubkey)} (kept in this browser).`,
        body: `This browser is using another key now (${short(me)}), so you are watching. Switch back to the key you joined with to play.`,
      };
    case 'other-key':
      return {
        lead: watching,
        body: `This browser holds your game keys for it, made for ${short(notice.owner)}, but it is using another key now (${short(me)}). To play, import the secret key of ${short(notice.owner)} in Settings → Use a secret key from elsewhere.`,
      };
    case 'not-seated':
      return {
        lead: watching,
        body:
          notice.owner === me
            ? `You joined its table with this key (${short(me)}), but the game started without it: this key holds none of its seats.`
            : `This browser joined its table with ${short(notice.owner)}, but the game started without that key, and this browser's key (${short(me)}) holds none of its seats either.`,
      };
    case 'elsewhere':
      return {
        lead: watching,
        body: `This browser's key (${short(me)}) isn't one of its players. If you joined from another app or browser on this device, open the game there: each one keeps its own key.`,
      };
    case 'visitor':
      return { lead: watching, body: null };
  }
}

/** What this profile's storage holds about the table at `address`. */
export function localTableRecord(profile: string, store: KeyValueStore, address: string): LocalTableRecord {
  const owner = tableOwner(profile, store, address);
  return {
    listed: loadTableList(profile, store).includes(address),
    secrets: loadSecrets(profile, store, address) !== null,
    owner: owner as Hex | null,
  };
}

/** How many tables in this profile's list belong to `me` (or to no recorded key, which means the key in use). */
export function myTableCount(profile: string, store: KeyValueStore, me: Hex): number {
  return loadTableList(profile, store).filter((a) => tableIsMine(profile, store, a, me)).length;
}

/**
 * The notice for a seat played with the game keys saved in this browser, while the key in use is another (D057):
 * "Playing seat 3 with the game keys saved in this browser (you joined as npub1…; this browser's key is now
 * npub1…)." The Result attestation is signed by the joining key, so this browser does not send it.
 */
export function recoveredText(
  seat: number,
  joined: Hex,
  me: Hex,
  kept = false,
): { lead: string; body: string } {
  const fix = kept
    ? `${short(joined)} is kept in this browser: switch back to it to sign the result too.`
    : 'To sign it too, import that key in Settings → Use a secret key from elsewhere.';
  return {
    lead: `Playing seat ${seat + 1} with the game keys saved in this browser (you joined as ${short(joined)}; this browser's key is now ${short(me)}).`,
    body: `Your moves are signed with those game keys, so you can play on. Only signing the final result needs the key you joined with, so this browser will not sign it: the result stands without it. ${fix}`,
  };
}
