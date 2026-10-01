import { secp256k1 } from '@noble/curves/secp256k1.js';
import type { Part, Point } from './encoding.ts';
import { hs } from './encoding.ts';
import { G, inRange, msm, q } from './group.ts';
import { type RandomBytes, randomScalar } from './random.ts';

const PointClass = secp256k1.Point;

/** Schnorr proof of knowledge of `x` with `X = x·G`. */
export interface PokProof {
  readonly c: bigint;
  readonly s: bigint;
}

/**
 * Prove knowledge of the deck secret `x` (PROTOCOL §3), bound to `ctx` (callers pass
 * `[tableAddress, npub, sessionPub]`). `T = w·G`, `c = HS("pok", ...ctx, X, T)`, `s = w + c·x mod q`.
 * All randomness comes from `rnd`; curve multiplications by secrets are constant time (bigint scalar arithmetic in JS is not).
 */
export function provePok(x: bigint, ctx: readonly Part[], rnd: RandomBytes): PokProof {
  if (typeof x !== 'bigint' || x < 1n || x >= q) throw new RangeError('provePok: x must lie in [1, q)');
  const X = G.multiply(x);
  const w = randomScalar(rnd);
  const T = G.multiply(w);
  const c = hs('pok', ...ctx, X, T);
  return { c, s: (w + c * x) % q };
}

/**
 * Verify a proof of knowledge of the key behind `X`. Returns false, never throws, on any malformed input
 * (identity `X`, `c` or `s` outside [0, q), unhashable context).
 */
export function verifyPok(X: Point, proof: PokProof, ctx: readonly Part[]): boolean {
  try {
    if (!(X instanceof PointClass) || X.is0()) return false;
    const { c, s } = proof;
    if (!inRange(c) || !inRange(s)) return false;
    // T' = s·G − c·X
    const T = msm([G, X], [s, (q - c) % q]);
    return hs('pok', ...ctx, X, T) === c;
  } catch {
    return false;
  }
}
