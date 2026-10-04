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
 * That is the v1 point (PROTOCOL §6.3a); protocol v2 binds the point to the requesting move (`moveRollPoint`,
 * below). `rollSeed` serves both.
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

/*
 * Protocol v2 (PROTOCOL-v2 §6.2): the roll point is bound to the requesting move, not to a counter. Roll (M, n),
 * the n-th roll the game action of Move M requested, is `H(M, n) = H2C("roll:" + rootId + ":" + M + ":" + n)`.
 * A rival requesting move has another id, so another point, and a contribution to one says nothing about the
 * other. The contribution is the same Chaum–Pedersen share with the context deck id `roll` and position `n`.
 * The v1 functions above are unchanged and keep serving v1 games.
 */

const HEX64 = /^[0-9a-f]{64}$/;

function hex64(s: unknown): s is string {
  return typeof s === 'string' && HEX64.test(s);
}

/**
 * `H(M, n)` for roll index `n` of requesting move `moveId` in game `rootId`. Both ids are 64 lowercase hex
 * characters and `n` is a non-negative safe integer, in decimal in the label. Throws a `RangeError` otherwise.
 */
export function moveRollPoint(rootId: string, moveId: string, n: number): Point {
  if (!hex64(rootId)) throw new RangeError('moveRollPoint: rootId must be 64 lowercase hex characters');
  if (!hex64(moveId)) throw new RangeError('moveRollPoint: moveId must be 64 lowercase hex characters');
  if (!rollIdOk(n)) throw new RangeError('moveRollPoint: n must be a non-negative safe integer');
  return h2c(`roll:${rootId}:${moveId}:${n}`);
}

/** The ciphertext shape `makeShare` expects for roll (M, n): both points are `H(M, n)`, so `D = x·H(M, n)`. */
export function moveRollCiphertext(rootId: string, moveId: string, n: number): Ciphertext {
  const H = moveRollPoint(rootId, moveId, n);
  return { a: H, b: H };
}

/**
 * Seat secret `x`'s contribution to roll (moveId, n), with its proof, bound to the context deck id `roll` at
 * position `n`. The nonce is hedged (`makeShare`); randomness comes from `rnd`. Throws on a bad id or `n`.
 */
export function makeMoveRollShare(
  x: bigint,
  rootId: string,
  moveId: string,
  n: number,
  rnd: RandomBytes,
): Share {
  return makeShare(x, moveRollCiphertext(rootId, moveId, n), { rootId, deckId: ROLL_DECK, pos: n }, rnd);
}

/**
 * Whether `share` is `X`'s contribution to roll (moveId, n). Returns false, never throws, on a bad id, a bad `n`
 * or a share that does not verify, including a share made for another requesting move or another index.
 */
export function verifyMoveRollShare(
  X: Point,
  rootId: string,
  moveId: string,
  n: number,
  share: Share,
): boolean {
  try {
    if (!hex64(rootId) || !hex64(moveId) || !rollIdOk(n)) return false;
    return verifyShare(X, moveRollCiphertext(rootId, moveId, n), share, {
      rootId,
      deckId: ROLL_DECK,
      pos: n,
    });
  } catch {
    return false;
  }
}
