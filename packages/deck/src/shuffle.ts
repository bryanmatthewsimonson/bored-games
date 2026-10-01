import { secp256k1 } from '@noble/curves/secp256k1.js';
import type { Ciphertext } from './elgamal.ts';
import { reEncrypt } from './elgamal.ts';
import { hs, type Point } from './encoding.ts';
import { G, generators, inRange, msm, q } from './group.ts';
import { type RandomBytes, randomIndex, randomScalar } from './random.ts';

const PointClass = secp256k1.Point;

/*
 * Prover-side shuffle building blocks. Everything here is secret (the permutation is revealed by the order of
 * u′), so curve multiplications by these scalars use the constant-time `multiply`, never `multiplyUnsafe` or `msm`.
 *
 * Index convention (binding for the proof): `psi[i]` is the INPUT index of output `i`, so
 * `out[i] = reEncrypt(deck[psi[i]], X, rPrime[i])` and `rPrime` is indexed by output. The permutation commitment
 * `c` and its randomness `r` are indexed by INPUT: `c[psi[i]] = r[psi[i]]·G + hs[i]`.
 */

/** Uniform Fisher–Yates permutation of 0..n-1, every draw through `rnd`. */
function randomPermutation(n: number, rnd: RandomBytes): number[] {
  const psi = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = randomIndex(rnd, i + 1);
    const t = psi[i] as number;
    psi[i] = psi[j] as number;
    psi[j] = t;
  }
  return psi;
}

function isPermutation(psi: readonly number[], n: number): boolean {
  if (psi.length !== n) return false;
  const seen = new Array<boolean>(n).fill(false);
  for (const v of psi) {
    if (!Number.isSafeInteger(v) || v < 0 || v >= n || seen[v]) return false;
    seen[v] = true;
  }
  return true;
}

/**
 * Permute `deck` by a fresh uniform permutation and re-encrypt every card under `X`:
 * `out[i] = reEncrypt(deck[psi[i]], X, rPrime[i])` with `rPrime[i]` uniform in [1, q). Throws on an empty deck.
 * Does not mutate `deck`. All randomness comes from `rnd`.
 */
export function shuffleDeck(
  deck: readonly Ciphertext[],
  X: Point,
  rnd: RandomBytes,
): { out: Ciphertext[]; psi: number[]; rPrime: bigint[] } {
  const n = deck.length;
  if (n === 0) throw new RangeError('shuffleDeck: empty deck');
  const psi = randomPermutation(n, rnd);
  const rPrime: bigint[] = [];
  const out: Ciphertext[] = [];
  for (let i = 0; i < n; i++) {
    const r = randomScalar(rnd);
    rPrime.push(r);
    out.push(reEncrypt(deck[psi[i] as number] as Ciphertext, X, r));
  }
  return { out, psi, rPrime };
}

/**
 * Pedersen-style commitment to the permutation matrix, one point per INPUT index:
 * `c[psi[i]] = r[psi[i]]·G + hs[i]` with `r[k]` uniform in [1, q). Throws unless `psi` is a permutation of
 * 0..N-1 with `N = hs.length ≥ 1`.
 */
export function permutationCommitment(
  psi: readonly number[],
  hs: readonly Point[],
  rnd: RandomBytes,
): { c: Point[]; r: bigint[] } {
  const n = hs.length;
  if (n === 0) throw new RangeError('permutationCommitment: no generators');
  if (!isPermutation(psi, n))
    throw new RangeError('permutationCommitment: psi is not a permutation of 0..N-1');
  const c = new Array<Point>(n);
  const r = new Array<bigint>(n);
  for (let i = 0; i < n; i++) {
    const k = psi[i] as number;
    const rk = randomScalar(rnd);
    r[k] = rk;
    c[k] = G.multiply(rk).add(hs[i] as Point);
  }
  return { c, r };
}

/**
 * The commitment chain `ĉ_i = r̂_i·G + u′_i·ĉ_{i−1}` with `ĉ_0 = h`, for i = 1..N. `cHat[i-1] = ĉ_i`
 * (ĉ_0 = h is implicit and not in the array) and `rHat[i-1] = r̂_i` is uniform in [1, q). Throws on an empty list
 * or any `u′` outside [1, q).
 */
export function commitmentChain(
  h: Point,
  uPrime: readonly bigint[],
  rnd: RandomBytes,
): { cHat: Point[]; rHat: bigint[] } {
  if (uPrime.length === 0) throw new RangeError('commitmentChain: empty list');
  for (const u of uPrime) {
    if (!inRange(u) || u === 0n) throw new RangeError('commitmentChain: u′ must lie in [1, q)');
  }
  const cHat: Point[] = [];
  const rHat: bigint[] = [];
  let prev = h;
  for (const u of uPrime) {
    const r = randomScalar(rnd);
    prev = G.multiply(r).add(prev.multiply(u));
    cHat.push(prev);
    rHat.push(r);
  }
  return { cHat, rHat };
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Terelius–Wikström shuffle proof (PROTOCOL §5.3; CHVote GenShuffleProof / CheckShuffleProof, Alg. 8.44 and
 * 8.47, in additive notation with `s = ω + ch·secret`). The comments use the 1-based indices of the math:
 * output i is array index i−1, `ψ(i)` is `psi[i-1] + 1`, and `u′_i = u_{ψ(i)}`.
 * ------------------------------------------------------------------------------------------------------------ */

/** What a shuffle proof is bound to: the game root, the shuffling seat and the deck. */
export interface ShuffleCtx {
  readonly rootId: string;
  readonly seat: number;
  readonly deckId: string;
}

/** The proof object of PROTOCOL §5.3. Every array has one entry per card. */
export interface ShuffleProof {
  /** Permutation commitments, indexed by INPUT. */
  readonly c: readonly Point[];
  /** Chained commitments: `cHat[i-1] = ĉ_i`; ĉ_0 = h is implicit. */
  readonly cHat: readonly Point[];
  readonly t: {
    readonly t1: Point;
    readonly t2: Point;
    readonly t3: Point;
    readonly t4: readonly [Point, Point];
    readonly tHat: readonly Point[];
  };
  readonly s: {
    readonly s1: bigint;
    readonly s2: bigint;
    readonly s3: bigint;
    readonly s4: bigint;
    readonly sHat: readonly bigint[];
    readonly sPrime: readonly bigint[];
  };
}

/** `d = HS("shuffle-ctx", rootId, seat, deckId, X, a_1, b_1, …, a_N, b_N, a′_1, b′_1, …, a′_N, b′_N)`. */
function contextHash(
  ctx: ShuffleCtx,
  X: Point,
  input: readonly Ciphertext[],
  output: readonly Ciphertext[],
): bigint {
  const parts: Point[] = [];
  for (const e of input) parts.push(e.a, e.b);
  for (const e of output) parts.push(e.a, e.b);
  return hs('shuffle-ctx', ctx.rootId, ctx.seat, ctx.deckId, X, ...parts);
}

/**
 * `u_i = HS("shuffle-u", d, c_1..c_N, i)` for i = 1..N; `u[k]` belongs to input k. Each `c_k` is encoded once
 * (a 33-byte part hashes exactly like the point, identity included), not N times.
 */
function challenges(d: bigint, c: readonly Point[]): bigint[] {
  const cBytes = c.map((P) => (P.is0() ? new Uint8Array(33) : P.toBytes(true)));
  return c.map((_, k) => hs('shuffle-u', d, ...cBytes, k + 1));
}

/** `ch = HS("shuffle-c", d, X, c_1..c_N, ĉ_1..ĉ_N, t1, t2, t3, t4[0], t4[1], t̂_1..t̂_N)`. */
function mainChallenge(
  d: bigint,
  X: Point,
  c: readonly Point[],
  cHat: readonly Point[],
  t: ShuffleProof['t'],
): bigint {
  return hs('shuffle-c', d, X, ...c, ...cHat, t.t1, t.t2, t.t3, t.t4[0], t.t4[1], ...t.tHat);
}

const mod = (k: bigint): bigint => ((k % q) + q) % q;

/**
 * Prove that `output[i] = reEncrypt(input[psi[i]], X, rPrime[i])` for a secret permutation `psi` (the index
 * convention of `shuffleDeck`), in context `ctx`. Throws on inconsistent inputs: an empty deck, length
 * mismatches, `psi` not a permutation, `rPrime` outside [1, q) or an identity `X`. It does not check that
 * `output` really is that shuffle; a wrong one yields a proof that fails verification.
 *
 * Every curve multiplication by a secret scalar (ω's, r's, r̂'s, and anything multiplied by u′ or ω′, since the
 * order of u′ leaks ψ) is a constant-time `multiply`, term by term. All randomness comes from `rnd`.
 */
export function proveShuffle(
  input: readonly Ciphertext[],
  output: readonly Ciphertext[],
  X: Point,
  psi: readonly number[],
  rPrime: readonly bigint[],
  ctx: ShuffleCtx,
  rnd: RandomBytes,
): ShuffleProof {
  const n = input.length;
  if (n === 0) throw new RangeError('proveShuffle: empty deck');
  if (output.length !== n || psi.length !== n || rPrime.length !== n)
    throw new RangeError('proveShuffle: input, output, psi and rPrime differ in length');
  if (!isPermutation(psi, n)) throw new RangeError('proveShuffle: psi is not a permutation of 0..N-1');
  for (const r of rPrime) {
    if (!inRange(r) || r === 0n) throw new RangeError('proveShuffle: rPrime must lie in [1, q)');
  }
  if (X.is0()) throw new RangeError('proveShuffle: X is the identity');

  const { h, hs: H } = generators(n);
  const d = contextHash(ctx, X, input, output);

  // Permutation commitment (by input index) and its challenges.
  const { c, r } = permutationCommitment(psi, H, rnd);
  const u = challenges(d, c);
  const uPrime = psi.map((k) => u[k] as bigint); // u′_i = u_{ψ(i)}
  const { cHat, rHat } = commitmentChain(h, uPrime, rnd);

  // Commitments.
  const w1 = randomScalar(rnd);
  const w2 = randomScalar(rnd);
  const w3 = randomScalar(rnd);
  const w4 = randomScalar(rnd);
  const wHat = Array.from({ length: n }, () => randomScalar(rnd));
  const wPrime = Array.from({ length: n }, () => randomScalar(rnd));

  const t1 = G.multiply(w1);
  const t2 = G.multiply(w2);
  let t3 = G.multiply(w3);
  let t41 = G.multiply(w4).negate();
  let t42 = X.multiply(w4).negate();
  const tHat: Point[] = [];
  for (let i = 0; i < n; i++) {
    const wp = wPrime[i] as bigint;
    const out = output[i] as Ciphertext;
    t3 = t3.add((H[i] as Point).multiply(wp));
    t41 = t41.add(out.a.multiply(wp));
    t42 = t42.add(out.b.multiply(wp));
    const prev = i === 0 ? h : (cHat[i - 1] as Point);
    tHat.push(G.multiply(wHat[i] as bigint).add(prev.multiply(wp)));
  }
  const t: ShuffleProof['t'] = { t1, t2, t3, t4: [t41, t42], tHat };
  const ch = mainChallenge(d, X, c, cHat, t);

  // Secrets: Σ r_k, Σ r̂_i·v_i (v_N = 1, v_{i−1} = u′_i·v_i), Σ u_k·r_k, Σ u′_i·r′_i.
  let rBar = 0n;
  let rTilde = 0n;
  for (let k = 0; k < n; k++) {
    rBar = (rBar + (r[k] as bigint)) % q;
    rTilde = (rTilde + (u[k] as bigint) * (r[k] as bigint)) % q;
  }
  let rHatSum = 0n;
  let v = 1n;
  for (let i = n - 1; i >= 0; i--) {
    rHatSum = (rHatSum + (rHat[i] as bigint) * v) % q;
    v = (v * (uPrime[i] as bigint)) % q;
  }
  let rPrimeSum = 0n;
  for (let i = 0; i < n; i++) rPrimeSum = (rPrimeSum + (uPrime[i] as bigint) * (rPrime[i] as bigint)) % q;

  const s: ShuffleProof['s'] = {
    s1: mod(w1 + ch * rBar),
    s2: mod(w2 + ch * rHatSum),
    s3: mod(w3 + ch * rTilde),
    s4: mod(w4 + ch * rPrimeSum),
    sHat: wHat.map((w, i) => mod(w + ch * (rHat[i] as bigint))),
    sPrime: wPrime.map((w, i) => mod(w + ch * (uPrime[i] as bigint))),
  };
  return { c, cHat, t, s };
}

const isPoint = (P: unknown): P is Point => P instanceof PointClass;
const isNonZeroPoint = (P: unknown): P is Point => P instanceof PointClass && !P.is0();

function pointList(xs: unknown, n: number): xs is readonly Point[] {
  return Array.isArray(xs) && xs.length === n && xs.every(isNonZeroPoint);
}

function scalarList(xs: unknown, n: number): xs is readonly bigint[] {
  return Array.isArray(xs) && xs.length === n && xs.every(inRange);
}

/** Structural check of everything public, before any arithmetic. */
function wellFormed(
  input: readonly Ciphertext[],
  output: readonly Ciphertext[],
  X: Point,
  proof: ShuffleProof,
  ctx: ShuffleCtx,
): boolean {
  if (!Array.isArray(input) || !Array.isArray(output)) return false;
  const n = input.length;
  if (n === 0 || output.length !== n) return false;
  // The input deck may hold identities (the initial deck has a = O); the output may not.
  if (!input.every((e) => e !== null && typeof e === 'object' && isPoint(e.a) && isPoint(e.b))) return false;
  if (!output.every((e) => e !== null && typeof e === 'object' && isNonZeroPoint(e.a) && isNonZeroPoint(e.b)))
    return false;
  if (!isNonZeroPoint(X)) return false;
  if (ctx === null || typeof ctx !== 'object') return false;
  if (typeof ctx.rootId !== 'string' || typeof ctx.deckId !== 'string') return false;
  if (typeof ctx.seat !== 'number' || !Number.isSafeInteger(ctx.seat) || ctx.seat < 0) return false;
  if (proof === null || typeof proof !== 'object') return false;
  const { t, s } = proof;
  if (t === null || typeof t !== 'object' || s === null || typeof s !== 'object') return false;
  if (!pointList(proof.c, n) || !pointList(proof.cHat, n) || !pointList(t.tHat, n)) return false;
  if (!isNonZeroPoint(t.t1) || !isNonZeroPoint(t.t2) || !isNonZeroPoint(t.t3)) return false;
  if (!Array.isArray(t.t4) || t.t4.length !== 2 || !isNonZeroPoint(t.t4[0]) || !isNonZeroPoint(t.t4[1]))
    return false;
  if (!inRange(s.s1) || !inRange(s.s2) || !inRange(s.s3) || !inRange(s.s4)) return false;
  return scalarList(s.sHat, n) && scalarList(s.sPrime, n);
}

/**
 * Verify that `output` is a re-encrypted permutation of `input` under `X`, in context `ctx`. Everything here
 * is public, so every sum is an `msm`. Returns false, never throws, on malformed input: N = 0, length
 * mismatches, scalars outside [0, q), non-points, or the identity in `X`, an output ciphertext or the proof.
 * The input deck may contain the identity (the initial deck).
 */
export function verifyShuffle(
  input: readonly Ciphertext[],
  output: readonly Ciphertext[],
  X: Point,
  proof: ShuffleProof,
  ctx: ShuffleCtx,
): boolean {
  try {
    if (!wellFormed(input, output, X, proof, ctx)) return false;
    const n = input.length;
    const { c, cHat, t, s } = proof;
    const { h, hs: H } = generators(n);

    const d = contextHash(ctx, X, input, output);
    const u = challenges(d, c);
    const ch = mainChallenge(d, X, c, cHat, t);
    const negCh = mod(-ch);
    const negChU = u.map((uk) => mod(-ch * uk));
    const ones = (k: bigint) => Array.from({ length: n }, () => k);
    let uProd = 1n;
    for (const uk of u) uProd = (uProd * uk) % q;

    // t1 == s1·G − ch·(Σc_k − Σh_i)
    if (!t.t1.equals(msm([G, ...c, ...H], [s.s1, ...ones(negCh), ...ones(ch)]))) return false;
    // t2 == s2·G − ch·(ĉ_N − (Πu_k)·h)
    const cHatN = cHat[n - 1] as Point;
    if (!t.t2.equals(msm([G, cHatN, h], [s.s2, negCh, mod(ch * uProd)]))) return false;
    // t3 == s3·G + Σ s′_i·h_i − ch·Σ u_k·c_k
    if (!t.t3.equals(msm([G, ...H, ...c], [s.s3, ...s.sPrime, ...negChU]))) return false;
    // t4[0] == Σ s′_i·a′_i − s4·G − ch·Σ u_k·a_k
    const negS4 = mod(-s.s4);
    const t41 = msm(
      [...output.map((e) => e.a), G, ...input.map((e) => e.a)],
      [...s.sPrime, negS4, ...negChU],
    );
    if (!t.t4[0].equals(t41)) return false;
    // t4[1] == Σ s′_i·b′_i − s4·X − ch·Σ u_k·b_k
    const t42 = msm(
      [...output.map((e) => e.b), X, ...input.map((e) => e.b)],
      [...s.sPrime, negS4, ...negChU],
    );
    if (!t.t4[1].equals(t42)) return false;
    // t̂_i == ŝ_i·G + s′_i·ĉ_{i−1} − ch·ĉ_i, with ĉ_0 = h
    for (let i = 0; i < n; i++) {
      const prev = i === 0 ? h : (cHat[i - 1] as Point);
      const expected = msm([G, prev, cHat[i] as Point], [s.sHat[i] as bigint, s.sPrime[i] as bigint, negCh]);
      if (!(t.tHat[i] as Point).equals(expected)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
