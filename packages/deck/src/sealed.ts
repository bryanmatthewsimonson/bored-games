import { secp256k1 } from '@noble/curves/secp256k1.js';
import { type ShareCtx, validPos } from './dleq.ts';
import type { Ciphertext } from './elgamal.ts';
import type { Part, Point } from './encoding.ts';
import { hs } from './encoding.ts';
import { G, inRange, msm, q } from './group.ts';
import type { RandomBytes } from './random.ts';

/*
 * Sealed shares (docs/proposals/prompt-reveal.md §7, GAME-SYSTEMS §4.1.5). The session uses them for one thing
 * only: a re-dealt private position's first holder seals its share to each later holder (PROTOCOL §4.10, owner
 * approval D066). Their use as prompt reveals (Phase K) stays unwired until the owner approves that (D055).
 *
 * Seat k's decryption share `D = x_k·R` of deck position j (ciphertext `(R, S)`) is ElGamal-encrypted to seat T's
 * deck key `X_T`: `(A, B) = (r·G, D + r·X_T)`. A generalized Chaum–Pedersen proof shows knowledge of `(x_k, r)`
 * with `X_k = x_k·G`, `A = r·G` and `B = x_k·R + r·X_T` (three equations, one challenge). Anyone can verify it;
 * only T can open it (`openAndVerify`), and T can later prove what it opened (`proveOpening`). There is no
 * unverified opening: `B − x_T·A` on a pair nobody checked opens to whatever a forger wants (round-3 review), so the
 * only way to open is `openAndVerify`, and the only way to publish an opening is `proveOpening`, which verifies.
 *
 * Nonces are hedged: each secret scalar is `HS(label, secret, transcript, fresh random bytes)`, so a broken or
 * repeating random source does not reuse a nonce across statements or secrets (round-2 review). The package's
 * older proofs (`dleq.ts`, `pok.ts`, `shuffle.ts`) still draw nonces from `rnd` alone; D055 lists that follow-up.
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

const isSecret = (x: unknown): x is bigint => typeof x === 'bigint' && x >= 1n && x < q;

function ctxOk(ctx: ShareCtx): boolean {
  return validPos(ctx.pos) && typeof ctx.rootId === 'string' && typeof ctx.deckId === 'string';
}

function ctOk(ct: Ciphertext): boolean {
  return typeof ct === 'object' && ct !== null && isPoint(ct.a) && ct.b instanceof PointClass;
}

/**
 * Hedged nonces: `HS("sealed-nonce", label, i, secret, ...transcript, z)` for i = 0..count-1, with 32 fresh bytes
 * `z` from `rnd`, redrawn in the (negligible) case of a zero. A repeated or biased `z` cannot repeat a nonce for
 * another statement or another secret, and an unpredictable `z` keeps the nonces unpredictable even to someone
 * who knows the transcript. Multiplications by these nonces are constant time; bigint arithmetic in JS is not.
 */
function hedged(
  label: string,
  count: number,
  secret: bigint,
  transcript: readonly Part[],
  rnd: RandomBytes,
): bigint[] {
  for (;;) {
    const z = rnd(32);
    if (z.length !== 32) throw new RangeError('random source returned the wrong number of bytes');
    const out: bigint[] = [];
    for (let i = 0; i < count; i++) out.push(hs('sealed-nonce', label, i, secret, ...transcript, z));
    if (out.every((k) => k !== 0n)) return out;
  }
}

/**
 * The Fiat–Shamir challenge. Everything the statement depends on is hashed: the context (root, deck, position),
 * the sender's key, the recipient's key, the whole ciphertext of the position, the sealed pair and the three
 * commitments. The label `sealed` separates it from every other transcript in the package (`dleq`, `pok`,
 * `shuffle-*`, `sealed-open`, `sealed-nonce`).
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
 * - `D = x·R` with `R = ct.a`; `A = r·G`, `B = D + r·XT`;
 * - commitments `T1 = w1·G`, `T2 = w2·G`, `T3 = w1·R + w2·XT`;
 * - `c = HS("sealed", rootId, deckId, pos, X, XT, R, ct.b, A, B, T1, T2, T3)`, `s1 = w1 + c·x`, `s2 = w2 + c·r`;
 * - `r`, `w1`, `w2` are hedged nonces over `x`, the context, `X`, `XT` and the ciphertext.
 *
 * Throws on a secret outside [1, q), an identity `R` or `XT`, a recipient key equal to the sender's own key (a
 * seat never seals to itself), or a bad `pos`.
 */
export function sealShare(
  x: bigint,
  ct: Ciphertext,
  XT: Point,
  ctx: ShareCtx,
  rnd: RandomBytes,
): SealedShare {
  if (!isSecret(x)) throw new RangeError('sealShare: x must lie in [1, q)');
  if (!validPos(ctx.pos)) throw new RangeError('sealShare: pos must be a non-negative safe integer');
  if (!isPoint(ct.a)) throw new RangeError('sealShare: ciphertext has an identity a');
  if (!(ct.b instanceof PointClass)) throw new RangeError('sealShare: ciphertext b is not a point');
  if (!isPoint(XT)) throw new RangeError('sealShare: the recipient key must be a non-identity point');
  const X = G.multiply(x);
  if (X.equals(XT)) throw new RangeError('sealShare: a seat does not seal to its own key');
  const R = ct.a;
  const [r, w1, w2] = hedged('seal', 3, x, [ctx.rootId, ctx.deckId, ctx.pos, X, XT, R, ct.b], rnd) as [
    bigint,
    bigint,
    bigint,
  ];
  const A = G.multiply(r);
  const B = R.multiply(x).add(XT.multiply(r));
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
    if (!ctOk(ct)) return false;
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
 * The recipient (secret `xT`) checks a sealed share from the seat with key `X` for `ct` in context `ctx`, and
 * opens it: `D = B − xT·A`, the sender's decryption share of the position. Returns null, never throws, when the
 * sealed share does not verify against this recipient's own key, or any input is malformed. Nothing is published.
 */
export function openAndVerify(
  xT: bigint,
  X: Point,
  ct: Ciphertext,
  sealed: SealedShare,
  ctx: ShareCtx,
): Point | null {
  try {
    if (!isSecret(xT)) return null;
    if (!verifySealedShare(X, ct, G.multiply(xT), sealed, ctx)) return null;
    const D = sealed.B.subtract(sealed.A.multiply(xT));
    return D.is0() ? null : D;
  } catch {
    return null;
  }
}

/**
 * The transferable opening's challenge: it binds the context, both keys, the whole ciphertext of the position,
 * the sealed pair and the sealed proof's own challenge, so an opening is tied to exactly one verified sealed share.
 */
function openingChallenge(
  ctx: ShareCtx,
  X: Point,
  XT: Point,
  ct: Ciphertext,
  sealed: SealedShare,
  E: Point,
  T1: Point,
  T2: Point,
): bigint {
  return hs(
    'sealed-open',
    ctx.rootId,
    ctx.deckId,
    ctx.pos,
    X,
    XT,
    ct.a,
    ct.b,
    sealed.A,
    sealed.B,
    sealed.c,
    E,
    T1,
    T2,
  );
}

/**
 * The transferable opening: the recipient (secret `xT`) proves `E = xT·A` (a DLEQ between `(G, XT)` and `(A, E)`),
 * bound to the context, the sender's key `X`, the ciphertext and the sealed share. Anyone then checks
 * `verifyOpening` and reads `D = B − E` without the recipient's secret or the sender being online.
 *
 * It verifies the sealed share first and throws if it does not verify, so it is never a decryption oracle: for a
 * verified share the sender proved it knows `log_G A`, so `xT·A` tells it nothing new, and everyone else learns
 * only `D`. Proving `xT·P` for an arbitrary `P` (a deck position's `a`, say) would reveal the recipient's own share.
 */
export function proveOpening(
  xT: bigint,
  X: Point,
  ct: Ciphertext,
  sealed: SealedShare,
  ctx: ShareCtx,
  rnd: RandomBytes,
): SealedOpening {
  if (!isSecret(xT)) throw new RangeError('proveOpening: xT must lie in [1, q)');
  const XT = G.multiply(xT);
  if (!verifySealedShare(X, ct, XT, sealed, ctx))
    throw new RangeError('proveOpening: the sealed share does not verify; refusing to open it');
  const E = sealed.A.multiply(xT);
  const [w] = hedged(
    'open',
    1,
    xT,
    [ctx.rootId, ctx.deckId, ctx.pos, X, XT, ct.a, ct.b, sealed.A, sealed.B, sealed.c],
    rnd,
  ) as [bigint];
  const T1 = G.multiply(w);
  const T2 = sealed.A.multiply(w);
  const c = openingChallenge(ctx, X, XT, ct, sealed, E, T1, T2);
  return { E, c, s: (w + c * xT) % q };
}

/**
 * Check a transferable opening of `sealed` (from the sender key `X` to the recipient key `XT`, for `ct`): the
 * sealed share must verify and the opening must prove `E = x_T·A`. Returns the opened share `D = B − E`, or `null`
 * when either fails or anything is malformed.
 */
export function verifyOpening(
  X: Point,
  XT: Point,
  ct: Ciphertext,
  sealed: SealedShare,
  opening: SealedOpening,
  ctx: ShareCtx,
): Point | null {
  try {
    if (!verifySealedShare(X, ct, XT, sealed, ctx)) return null;
    const { E, c, s } = opening;
    if (!isPoint(E) || !inRange(c) || !inRange(s)) return null;
    const negC = (q - c) % q;
    const T1 = msm([G, XT], [s, negC]); // s·G − c·XT
    const T2 = msm([sealed.A, E], [s, negC]); // s·A − c·E
    if (openingChallenge(ctx, X, XT, ct, sealed, E, T1, T2) !== c) return null;
    const D = sealed.B.subtract(E);
    return D.is0() ? null : D;
  } catch {
    return null;
  }
}
