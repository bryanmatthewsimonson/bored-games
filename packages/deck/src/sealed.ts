import { secp256k1 } from '@noble/curves/secp256k1.js';
import { type ShareCtx, validPos } from './dleq.ts';
import type { Ciphertext } from './elgamal.ts';
import type { Point } from './encoding.ts';
import { hs } from './encoding.ts';
import { G, inRange, msm, q } from './group.ts';
import { type RandomBytes, randomScalar } from './random.ts';

/*
 * Sealed shares (docs/proposals/prompt-reveal.md §7, GAME-SYSTEMS §4.1.5). REFERENCE ONLY: nothing in the
 * session or the protocol uses these yet; they stay unwired until the owner approves (D055).
 *
 * Seat k's decryption share `D = x_k·R` of deck position j (ciphertext `(R, S)`) is ElGamal-encrypted to seat T's
 * deck key `X_T`: `(A, B) = (r·G, D + r·X_T)`. A generalized Chaum–Pedersen proof shows knowledge of `(x_k, r)`
 * with `X_k = x_k·G`, `A = r·G` and `B = x_k·R + r·X_T` (three equations, one challenge). Anyone can verify it;
 * only T can open it, `D = B − x_T·A`, and T can later prove what it opened (`proveOpening`).
 */

const PointClass = secp256k1.Point;

/** A sealed share: `(A, B) = (r·G, x_k·R + r·X_T)` with the proof `(c, s1, s2)`. */
export interface SealedShare {
  readonly A: Point;
  readonly B: Point;
  readonly c: bigint;
  readonly s1: bigint;
  readonly s2: bigint;
}

/** A transferable opening: T's DLEQ proof that `E = x_T·A`, so `D = B − E` is checkable without T's secret. */
export interface SealedOpening {
  readonly E: Point;
  readonly c: bigint;
  readonly s: bigint;
}

const isPoint = (P: unknown): P is Point => P instanceof PointClass && !P.is0();

function ctxOk(ctx: ShareCtx): boolean {
  return validPos(ctx.pos) && typeof ctx.rootId === 'string' && typeof ctx.deckId === 'string';
}

/**
 * The Fiat–Shamir challenge. Everything the statement depends on is hashed: the context (root, deck, position),
 * the sender's key, the recipient's key, the whole ciphertext of the position, the sealed pair and the three
 * commitments. The label `sealed` separates it from every other transcript in the package (`dleq`, `pok`,
 * `shuffle-*`, `sealed-open`).
 */
function challenge(
  ctx: ShareCtx,
  Xk: Point,
  XT: Point,
  ct: Ciphertext,
  A: Point,
  B: Point,
  T1: Point,
  T2: Point,
  T3: Point,
): bigint {
  return hs('sealed', ctx.rootId, ctx.deckId, ctx.pos, Xk, XT, ct.a, ct.b, A, B, T1, T2, T3);
}

/**
 * Seat secret `x` seals its share of `ct` (position `ctx.pos`) to the recipient key `XT`:
 * - `D = x·R` with `R = ct.a`; `A = r·G`, `B = D + r·XT` for a fresh `r`;
 * - commitments `T1 = w1·G`, `T2 = w2·G`, `T3 = w1·R + w2·XT`;
 * - `c = HS("sealed", rootId, deckId, pos, X, XT, R, ct.b, A, B, T1, T2, T3)`, `s1 = w1 + c·x`, `s2 = w2 + c·r`.
 *
 * Throws on a secret outside [1, q), an identity `R` or `XT`, a recipient key equal to the sender's own key (a
 * seat never seals to itself), or a bad `pos`. All randomness comes from `rnd`; multiplications by secrets are
 * constant time (bigint scalar arithmetic in JS is not).
 */
export function sealShare(
  x: bigint,
  ct: Ciphertext,
  XT: Point,
  ctx: ShareCtx,
  rnd: RandomBytes,
): SealedShare {
  if (typeof x !== 'bigint' || x < 1n || x >= q) throw new RangeError('sealShare: x must lie in [1, q)');
  if (!validPos(ctx.pos)) throw new RangeError('sealShare: pos must be a non-negative safe integer');
  if (!isPoint(ct.a)) throw new RangeError('sealShare: ciphertext has an identity a');
  if (!(ct.b instanceof PointClass)) throw new RangeError('sealShare: ciphertext b is not a point');
  if (!isPoint(XT)) throw new RangeError('sealShare: the recipient key must be a non-identity point');
  const X = G.multiply(x);
  if (X.equals(XT)) throw new RangeError('sealShare: a seat does not seal to its own key');
  const R = ct.a;
  const r = randomScalar(rnd);
  const A = G.multiply(r);
  const B = R.multiply(x).add(XT.multiply(r));
  const w1 = randomScalar(rnd);
  const w2 = randomScalar(rnd);
  const T1 = G.multiply(w1);
  const T2 = G.multiply(w2);
  const T3 = R.multiply(w1).add(XT.multiply(w2));
  const c = challenge(ctx, X, XT, ct, A, B, T1, T2, T3);
  return { A, B, c, s1: (w1 + c * x) % q, s2: (w2 + c * r) % q };
}

/**
 * Verify a sealed share from the seat with key `X` to the seat with key `XT`, for `ct` in context `ctx`:
 * recompute `T1 = s1·G − c·X`, `T2 = s2·G − c·A`, `T3 = s1·R + s2·XT − c·B` and check `c`. Returns false, never
 * throws, on any malformed input: an identity or foreign point, `X` equal to `XT`, a scalar outside [0, q), a
 * bad context. Holding a verified sealed share proves that `B − x_T·A` is exactly the sender's decryption share.
 */
export function verifySealedShare(
  X: Point,
  ct: Ciphertext,
  XT: Point,
  sealed: SealedShare,
  ctx: ShareCtx,
): boolean {
  try {
    if (!isPoint(X) || !isPoint(XT) || X.equals(XT)) return false;
    if (typeof ct !== 'object' || ct === null || !isPoint(ct.a) || !(ct.b instanceof PointClass))
      return false;
    const { A, B, c, s1, s2 } = sealed;
    if (!isPoint(A) || !isPoint(B)) return false;
    if (!inRange(c) || !inRange(s1) || !inRange(s2)) return false;
    if (!ctxOk(ctx)) return false;
    const negC = (q - c) % q;
    const T1 = msm([G, X], [s1, negC]); // s1·G − c·X
    const T2 = msm([G, A], [s2, negC]); // s2·G − c·A
    const T3 = msm([ct.a, XT, B], [s1, s2, negC]); // s1·R + s2·XT − c·B
    return challenge(ctx, X, XT, ct, A, B, T1, T2, T3) === c;
  } catch {
    return false;
  }
}

/**
 * The recipient opens a sealed share addressed to its key: `D = B − xT·A`, the sender's decryption share of the
 * position. Callers MUST verify the sealed share first (`verifySealedShare`); an unverified pair opens to
 * garbage. Throws on a secret outside [1, q), a malformed pair, or an opening at the identity (impossible for a
 * verified share). Constant-time multiplication; nothing is published.
 */
export function openSealedShare(xT: bigint, sealed: Pick<SealedShare, 'A' | 'B'>): Point {
  if (typeof xT !== 'bigint' || xT < 1n || xT >= q)
    throw new RangeError('openSealedShare: xT must lie in [1, q)');
  if (!isPoint(sealed.A) || !(sealed.B instanceof PointClass))
    throw new RangeError('openSealedShare: A and B must be points, A not the identity');
  const D = sealed.B.subtract(sealed.A.multiply(xT));
  if (D.is0()) throw new RangeError('openSealedShare: opened to the identity');
  return D;
}

function openingChallenge(
  ctx: ShareCtx,
  X: Point,
  XT: Point,
  A: Point,
  B: Point,
  E: Point,
  T1: Point,
  T2: Point,
): bigint {
  return hs('sealed-open', ctx.rootId, ctx.deckId, ctx.pos, X, XT, A, B, E, T1, T2);
}

/**
 * The transferable opening: the recipient (secret `xT`) proves `E = xT·A` (a DLEQ between `(G, XT)` and
 * `(A, E)`), bound to the context, the sender's key `X` and the sealed pair. Anyone then checks
 * `verifyOpening` and reads `D = B − E` without the recipient's secret or the sender being online.
 *
 * Open only a sealed share you verified: the sealed proof shows the sender knows `log_G A`, so `xT·A` tells it
 * nothing it could not compute, and nobody else learns more than `D`. Proving `xT·P` for an arbitrary `P` would
 * be a decryption oracle (for example `P` = a deck position's `a`). Throws on caller errors.
 */
export function proveOpening(
  xT: bigint,
  X: Point,
  sealed: Pick<SealedShare, 'A' | 'B'>,
  ctx: ShareCtx,
  rnd: RandomBytes,
): SealedOpening {
  if (typeof xT !== 'bigint' || xT < 1n || xT >= q)
    throw new RangeError('proveOpening: xT must lie in [1, q)');
  if (!validPos(ctx.pos)) throw new RangeError('proveOpening: pos must be a non-negative safe integer');
  if (!isPoint(X) || !isPoint(sealed.A) || !isPoint(sealed.B))
    throw new RangeError('proveOpening: X, A and B must be non-identity points');
  const XT = G.multiply(xT);
  const E = sealed.A.multiply(xT);
  const w = randomScalar(rnd);
  const T1 = G.multiply(w);
  const T2 = sealed.A.multiply(w);
  const c = openingChallenge(ctx, X, XT, sealed.A, sealed.B, E, T1, T2);
  return { E, c, s: (w + c * xT) % q };
}

/**
 * Check a transferable opening of `sealed` (from the sender key `X` to the recipient key `XT`) and return the
 * opened share `D = B − E`, or `null` when the opening does not verify or is malformed. It does not re-verify the
 * sealed share itself: callers check `verifySealedShare` too, or already hold it verified.
 */
export function verifyOpening(
  X: Point,
  XT: Point,
  sealed: Pick<SealedShare, 'A' | 'B'>,
  opening: SealedOpening,
  ctx: ShareCtx,
): Point | null {
  try {
    if (!isPoint(X) || !isPoint(XT) || !isPoint(sealed.A) || !isPoint(sealed.B)) return null;
    const { E, c, s } = opening;
    if (!isPoint(E) || !inRange(c) || !inRange(s) || !ctxOk(ctx)) return null;
    const negC = (q - c) % q;
    const T1 = msm([G, XT], [s, negC]); // s·G − c·XT
    const T2 = msm([sealed.A, E], [s, negC]); // s·A − c·E
    if (openingChallenge(ctx, X, XT, sealed.A, sealed.B, E, T1, T2) !== c) return null;
    const D = sealed.B.subtract(E);
    return D.is0() ? null : D;
  } catch {
    return null;
  }
}
