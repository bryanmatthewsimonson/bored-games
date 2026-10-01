import { secp256k1 } from '@noble/curves/secp256k1.js';
import { cardOf } from './cards.ts';
import type { Ciphertext } from './elgamal.ts';
import type { Point } from './encoding.ts';
import { hs } from './encoding.ts';
import { G, inRange, msm, q } from './group.ts';
import { type RandomBytes, randomScalar } from './random.ts';

const PointClass = secp256k1.Point;

/** A decryption share `D = x·a` with a Chaum–Pedersen proof `(c, s)` that `log_G X = log_a D`. */
export interface Share {
  readonly D: Point;
  readonly c: bigint;
  readonly s: bigint;
}

/** What a share is bound to: the game root, the deck and the deck position. */
export interface ShareCtx {
  readonly rootId: string;
  readonly deckId: string;
  readonly pos: number;
}

/** A deck position or seat index: a non-negative safe integer, never `-0` (canonical JSON has no `-0`). */
export function validPos(pos: unknown): pos is number {
  return typeof pos === 'number' && Number.isSafeInteger(pos) && pos >= 0 && !Object.is(pos, -0);
}

function challenge(ctx: ShareCtx, X: Point, a: Point, D: Point, T1: Point, T2: Point): bigint {
  return hs('dleq', ctx.rootId, ctx.deckId, ctx.pos, X, a, D, T1, T2);
}

/**
 * Seat `x`'s decryption share of `ct` with its proof (PROTOCOL §5.4):
 * `D = x·a`, `T1 = w·G`, `T2 = w·a`, `c = HS("dleq", rootId, deckId, pos, X, a, D, T1, T2)`, `s = w + c·x mod q`.
 * Throws on a secret outside [1, q), an identity `a` (nothing to decrypt; verifiers reject it) or a bad `pos`.
 * All randomness comes from `rnd`; curve multiplications by secrets are constant time (bigint scalar arithmetic in JS is not).
 */
export function makeShare(x: bigint, ct: Ciphertext, ctx: ShareCtx, rnd: RandomBytes): Share {
  if (typeof x !== 'bigint' || x < 1n || x >= q) throw new RangeError('makeShare: x must lie in [1, q)');
  if (!validPos(ctx.pos)) throw new RangeError('makeShare: pos must be a non-negative safe integer');
  if (ct.a.is0()) throw new RangeError('makeShare: ciphertext has an identity a');
  const X = G.multiply(x);
  const D = ct.a.multiply(x);
  const w = randomScalar(rnd);
  const T1 = G.multiply(w);
  const T2 = ct.a.multiply(w);
  const c = challenge(ctx, X, ct.a, D, T1, T2);
  return { D, c, s: (w + c * x) % q };
}

/**
 * Verify that `share.D = x·a` for the `x` behind `X`, in context `ctx`. Returns false, never throws, on any
 * malformed input (identity `X`, `a` or `D`, `c` or `s` outside [0, q), a bad `pos`).
 */
export function verifyShare(X: Point, ct: Ciphertext, share: Share, ctx: ShareCtx): boolean {
  try {
    if (!(X instanceof PointClass) || X.is0()) return false;
    const a = ct.a;
    if (!(a instanceof PointClass) || a.is0()) return false;
    const { D, c, s } = share;
    if (!(D instanceof PointClass) || D.is0()) return false;
    if (!inRange(c) || !inRange(s)) return false;
    if (!validPos(ctx.pos) || typeof ctx.rootId !== 'string' || typeof ctx.deckId !== 'string') return false;
    const negC = (q - c) % q;
    const T1 = msm([G, X], [s, negC]); // s·G − c·X
    const T2 = msm([a, D], [s, negC]); // s·a − c·D
    return challenge(ctx, X, a, D, T1, T2) === c;
  } catch {
    return false;
  }
}

/**
 * LOW LEVEL: `b − ΣD` over bare points; with no shares this is `b`. Nothing here is verified: not the shares'
 * proofs, not which seat or ciphertext they belong to, and not duplicates (the same `D` twice is subtracted
 * twice). Protocol code decrypts with `decryptPosition` (others' shares) and `ownShare` (its own layer) instead.
 */
export function combine(ct: Ciphertext, Ds: readonly Point[]): Point {
  let sum = PointClass.ZERO;
  for (const D of Ds) sum = sum.add(D);
  return ct.b.subtract(sum);
}

/**
 * The owner's own layer of `ct`, `x·a`, for decrypting its private card locally: no proof and no randomness,
 * so nothing is published. Throws on a secret outside [1, q) or an identity `a`. Constant-time multiplication.
 */
export function ownShare(x: bigint, ct: Ciphertext): Point {
  if (typeof x !== 'bigint' || x < 1n || x >= q) throw new RangeError('ownShare: x must lie in [1, q)');
  if (!(ct.a instanceof PointClass) || ct.a.is0())
    throw new RangeError('ownShare: ciphertext has an identity a');
  return ct.a.multiply(x);
}

/** Shares collected for one position, keyed by seat: an array indexed by seat (`null` = missing) or a map. */
export type SharesBySeat = ReadonlyMap<number, Share> | readonly (Share | null | undefined)[];

/**
 * Decrypt deck position `ctx.pos` (ciphertext `ct`) to a card index of `table` (PROTOCOL §5.4, §6.3, §6.4).
 *
 * - `keys` are the seats' deck keys in seat order; there are `S = keys.length` seats.
 * - `shares` holds at most one share per seat, keyed by seat, so a seat that publishes the same share twice
 *   (fresh proof randomness, same `D`) cannot be counted twice. Every share is verified against its own seat's
 *   key and `ctx` before use.
 * - `own` is the caller's own layer for a position it owns (`D = ownShare(x, ct)`); it stands in for that
 *   seat's share and is not verified.
 * - Every seat must be covered, by exactly one share or by `own`.
 *
 * Returns the card index, or `null` when a seat's share is missing or fails verification, or the decrypted point
 * is not a card of `table` (with every share verified, that means a corrupt deck or a wrong `own.D`).
 * Throws a `RangeError` on caller errors: no keys, a share array whose length is not `S`, a map key that is not
 * a seat in [0, S), a bad `own`, or a share for `own.seat` as well as `own`. Never mutates its arguments.
 */
export function decryptPosition(
  ct: Ciphertext,
  ctx: ShareCtx,
  keys: readonly Point[],
  shares: SharesBySeat,
  table: ReadonlyMap<string, number>,
  own?: { readonly seat: number; readonly D: Point },
): number | null {
  const n = keys.length;
  if (n === 0) throw new RangeError('decryptPosition: no seat keys');
  const isSeat = (k: unknown): k is number => validPos(k) && k < n;
  const bySeat = new Array<Share | null>(n).fill(null);
  if (Array.isArray(shares)) {
    if (shares.length !== n)
      throw new RangeError('decryptPosition: the share array must have one slot per seat');
    for (let k = 0; k < n; k++) bySeat[k] = (shares[k] as Share | null | undefined) ?? null;
  } else {
    for (const [k, share] of shares as ReadonlyMap<number, Share>) {
      if (!isSeat(k)) throw new RangeError(`decryptPosition: share key ${String(k)} is not a seat`);
      bySeat[k] = (share as Share | null | undefined) ?? null;
    }
  }
  if (own !== undefined) {
    if (!isSeat(own.seat)) throw new RangeError('decryptPosition: own.seat is not a seat');
    if (!(own.D instanceof PointClass) || own.D.is0())
      throw new RangeError('decryptPosition: own.D is not a point');
    if (bySeat[own.seat] !== null) throw new RangeError('decryptPosition: own seat also has a share');
  }

  if (typeof ct !== 'object' || ct === null) return null;
  if (!(ct.a instanceof PointClass) || ct.a.is0() || !(ct.b instanceof PointClass)) return null;
  const Ds: Point[] = [];
  for (let k = 0; k < n; k++) {
    if (own !== undefined && k === own.seat) {
      Ds.push(own.D);
      continue;
    }
    const share = bySeat[k];
    if (share === null || share === undefined) return null;
    if (!verifyShare(keys[k] as Point, ct, share, ctx)) return null;
    Ds.push(share.D);
  }
  return cardOf(table, combine(ct, Ds));
}
