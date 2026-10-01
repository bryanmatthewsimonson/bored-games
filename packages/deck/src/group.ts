import { pippenger } from '@noble/curves/abstract/curve.js';
import { secp256k1, secp256k1_hasher } from '@noble/curves/secp256k1.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import type { Point } from './encoding.ts';

const PointClass = secp256k1.Point;

/** The secp256k1 base point. */
export const G: Point = PointClass.BASE;

/** The prime order of the group. */
export const q: bigint = PointClass.Fn.ORDER;

const DST = 'bored-games/v1';

/** Hash a label to a curve point with unknown discrete log (RFC 9380, secp256k1_XMD:SHA-256_SSWU_RO_). Never the identity. */
export function h2c(label: string): Point {
  const P: Point = secp256k1_hasher.hashToCurve(utf8ToBytes(label), { DST });
  if (P.is0()) throw new Error('h2c: hashed to the identity');
  return P;
}

let cachedH: Point | null = null;
const cachedHs: Point[] = [];

/**
 * The independent generators `h` (label `gen:h`) and `hs[i-1]` (label `gen:<i>`, i = 1..n).
 * Computed lazily and cached. Each call returns a fresh array, so callers cannot corrupt the cache.
 */
export function generators(n: number): { h: Point; hs: Point[] } {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError('generators: n must be a non-negative safe integer');
  cachedH ??= h2c('gen:h');
  for (let i = cachedHs.length + 1; i <= n; i++) cachedHs.push(h2c(`gen:${i}`));
  return { h: cachedH, hs: cachedHs.slice(0, n) };
}

/**
 * Multi-scalar multiplication `Σ scalars[i]·points[i]` for PUBLIC scalars (not constant time).
 * Scalars must lie in [0, q). Zero scalars and identity points are allowed; the empty sum is the identity.
 */
export function msm(points: readonly Point[], scalars: readonly bigint[]): Point {
  if (points.length !== scalars.length) throw new RangeError('msm: points and scalars differ in length');
  for (const k of scalars) {
    if (typeof k !== 'bigint' || k < 0n || k >= q) throw new RangeError('msm: scalar out of range [0, q)');
  }
  // Zero terms contribute nothing; dropping them keeps pippenger's inputs well inside its documented domain.
  const ps: Point[] = [];
  const ks: bigint[] = [];
  for (let i = 0; i < points.length; i++) {
    const P = points[i] as Point;
    const k = scalars[i] as bigint;
    if (k === 0n || P.is0()) continue;
    ps.push(P);
    ks.push(k);
  }
  return pippenger(PointClass, ps, ks);
}
