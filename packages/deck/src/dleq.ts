import { secp256k1 } from '@noble/curves/secp256k1.js';
import type { Ciphertext } from './elgamal.ts';
import type { Point } from './encoding.ts';
import { hs } from './encoding.ts';
import { G, msm, q } from './group.ts';
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

function inRange(k: unknown): k is bigint {
  return typeof k === 'bigint' && k >= 0n && k < q;
}

function validPos(pos: unknown): pos is number {
  return typeof pos === 'number' && Number.isSafeInteger(pos) && pos >= 0;
}

function challenge(ctx: ShareCtx, X: Point, a: Point, D: Point, T1: Point, T2: Point): bigint {
  return hs('dleq', ctx.rootId, ctx.deckId, ctx.pos, X, a, D, T1, T2);
}

/**
 * Seat `x`'s decryption share of `ct` with its proof (PROTOCOL §5.4):
 * `D = x·a`, `T1 = w·G`, `T2 = w·a`, `c = HS("dleq", rootId, deckId, pos, X, a, D, T1, T2)`, `s = w + c·x mod q`.
 * Throws on a secret outside [1, q), an identity `a` (nothing to decrypt; verifiers reject it) or a bad `pos`.
 * All randomness comes from `rnd`; every multiplication of a secret is constant time.
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

/** Remove every seat's layer from `ct`: `b − ΣD`. With no shares this is `b`. Verify the shares first. */
export function combine(ct: Ciphertext, Ds: readonly Point[]): Point {
  let sum = PointClass.ZERO;
  for (const D of Ds) sum = sum.add(D);
  return ct.b.subtract(sum);
}
