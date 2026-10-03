import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { makeShare, type Share, verifyShare } from './dleq.ts';
import type { Ciphertext } from './elgamal.ts';
import type { Point } from './encoding.ts';
import { h2c } from './group.ts';
import type { RandomBytes } from './random.ts';

/**
 * The dice beacon (GAME-SYSTEMS §4.3, D058). A roll is the point `H_i = h2c('roll:' + rootId + ':' + i)`. Every
 * seat publishes `D = x·H_i` with the same Chaum–Pedersen share a card decryption uses, bound to the reserved
 * deck id `roll`. The seed is the SHA-256 of those `D` points in seat order, as compressed SEC1 bytes (the 33-byte
 * form `encodePoint` then base64-encodes). The hash is over the bytes, not the text, so it does not depend on the
 * base64 alphabet. `packages/dice` turns the seed into faces. This file does not know the rules of any game.
 */

/** Deck id reserved for dice rolls. A share at position `i` is the contribution to roll `i`, not a card. */
export const ROLL_DECK = 'roll';

function rollIdOk(id: unknown): id is number {
  return typeof id === 'number' && Number.isSafeInteger(id) && !Object.is(id, -0) && id >= 0;
}

/** `H_i` for roll `id` of game `rootId`. Throws on a bad id or an empty root id. */
export function rollPoint(rootId: string, id: number): Point {
  if (typeof rootId !== 'string' || rootId.length === 0)
    throw new RangeError('rollPoint: rootId must be a non-empty string');
  if (!rollIdOk(id)) throw new RangeError('rollPoint: id must be a non-negative safe integer');
  return h2c(`roll:${rootId}:${id}`);
}

/** The ciphertext shape `makeShare` expects: both points are `H_i`, so `D = x·H_i`. */
export function rollCiphertext(rootId: string, id: number): Ciphertext {
  const H = rollPoint(rootId, id);
  return { a: H, b: H };
}

/** Seat secret `x`'s contribution to roll `id`, with its proof. All randomness comes from `rnd`. */
export function makeRollShare(x: bigint, rootId: string, id: number, rnd: RandomBytes): Share {
  return makeShare(x, rollCiphertext(rootId, id), { rootId, deckId: ROLL_DECK, pos: id }, rnd);
}

/**
 * Whether `share` is `X`'s contribution to roll `id`. Returns false, never throws, on a bad id, a bad root or a
 * share that does not verify.
 */
export function verifyRollShare(X: Point, rootId: string, id: number, share: Share): boolean {
  try {
    if (typeof rootId !== 'string' || rootId.length === 0 || !rollIdOk(id)) return false;
    return verifyShare(X, rollCiphertext(rootId, id), share, { rootId, deckId: ROLL_DECK, pos: id });
  } catch {
    return false;
  }
}

/**
 * The roll seed: SHA-256 of each share's `D`, compressed, in the order given (seat order). Throws when `shares`
 * is empty. Two proofs of the same `D` (fresh proof randomness) produce the same seed.
 */
export function rollSeed(shares: readonly Share[]): Uint8Array {
  if (shares.length === 0) throw new RangeError('rollSeed: no shares');
  return sha256(concatBytes(...shares.map((share) => share.D.toBytes(true))));
}
