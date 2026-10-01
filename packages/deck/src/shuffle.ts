import type { Ciphertext } from './elgamal.ts';
import { reEncrypt } from './elgamal.ts';
import type { Point } from './encoding.ts';
import { G, inRange } from './group.ts';
import { type RandomBytes, randomIndex, randomScalar } from './random.ts';

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
