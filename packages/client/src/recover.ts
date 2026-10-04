/*
 * Seat recovery from saved game keys (D057). A seat is held by three keys: the player key (npub) that joined, and
 * the per-game session key and deck secret made for that Join. Every game event a seat publishes (moves, Shares,
 * Timeout claims, Resigns and end-of-game secrets) is signed by the session key; only the Result attestation is
 * signed by the npub (PROTOCOL §7). So a browser that still holds a seat's session key and deck secret can play
 * that seat even after the player key itself was lost, and only that browser can: the keys never leave it.
 */
import { G } from '@bored-games/deck';
import { getPublicKey, type ParsedRoot } from '@bored-games/protocol';

/**
 * The seat whose session key is `sessionSk`'s public key AND whose deck key is `deckSecret`·G in the root, or null
 * when no seat matches both (or the keys are malformed). Both must match: the session key alone would let a seat
 * sign moves it could not deal or reveal for, and a root that copied one seat's session key into another seat is
 * refused by the root's own validation (each seat's keys are bound to its Join by a proof of knowledge).
 */
export function seatForGameKeys(
  root: Pick<ParsedRoot, 'seats'>,
  sessionSk: Uint8Array,
  deckSecret: bigint,
): number | null {
  let session: string;
  let deckKey: ReturnType<typeof G.multiply>;
  try {
    session = getPublicKey(sessionSk);
    deckKey = G.multiply(deckSecret);
  } catch {
    return null; // zero, out of range, or the wrong length
  }
  const seat = root.seats.findIndex((s) => s.session === session);
  if (seat < 0) return null;
  return root.seats[seat]?.deckKey.equals(deckKey) ? seat : null;
}

/**
 * The seat `npub` holds in the root when `sessionSk` and `deckSecret` are that very seat's keys, else null: the
 * check a key backup restored from the relays must pass (D065). The backup is decrypted with the player key, so it
 * can only be the player's own; this also refuses a backup of another game or another seat, and a damaged one.
 */
export function backupSeat(
  root: Pick<ParsedRoot, 'seats'>,
  npub: string,
  sessionSk: Uint8Array,
  deckSecret: bigint,
): number | null {
  const seat = seatForGameKeys(root, sessionSk, deckSecret);
  return seat !== null && root.seats[seat]?.npub === npub ? seat : null;
}
