import { describe, expect, it } from 'vitest';
import { cardOf, cardTable } from '../src/cards.ts';
import { type Ciphertext, decryptWithSecrets, initialDeck, jointKey, reEncrypt } from '../src/elgamal.ts';
import { G, generators, msm, q } from '../src/group.ts';
import { randomScalar } from '../src/random.ts';
import { commitmentChain, permutationCommitment, shuffleDeck } from '../src/shuffle.ts';
import { seededRandom } from './util.ts';

const sum = (xs: readonly bigint[]): bigint => xs.reduce((s, x) => (s + x) % q, 0n);

function isPermutation(psi: readonly number[], n: number): boolean {
  return (
    psi.length === n && new Set(psi).size === n && psi.every((v) => Number.isInteger(v) && v >= 0 && v < n)
  );
}

function setup(seed: string, seats = 3) {
  const rnd = seededRandom(seed);
  const secrets = Array.from({ length: seats }, () => randomScalar(rnd));
  const X = jointKey(secrets.map((x) => G.multiply(x)));
  return { rnd, secrets, X };
}

describe('shuffleDeck', () => {
  it('outputs a re-encrypted permutation: out[i] = reEncrypt(deck[psi[i]], X, rPrime[i])', () => {
    const { rnd, X } = setup('shuffle-def');
    const deck = initialDeck('d', 10);
    const { out, psi, rPrime } = shuffleDeck(deck, X, rnd);
    expect(isPermutation(psi, 10)).toBe(true);
    expect(out).toHaveLength(10);
    expect(rPrime).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      const e = reEncrypt(deck[psi[i] as number] as Ciphertext, X, rPrime[i] as bigint);
      expect((out[i] as Ciphertext).a.equals(e.a)).toBe(true);
      expect((out[i] as Ciphertext).b.equals(e.b)).toBe(true);
    }
  });

  it('decrypts (all secrets) to the input cards permuted by psi', () => {
    const { rnd, secrets, X } = setup('shuffle-dec');
    const table = cardTable('d', 12);
    // Encrypt the initial deck once under X so the inputs are not trivial.
    const deck = initialDeck('d', 12).map((c) => reEncrypt(c, X, randomScalar(rnd)));
    const { out, psi } = shuffleDeck(deck, X, rnd);
    for (let i = 0; i < 12; i++) {
      const got = cardOf(table, decryptWithSecrets(out[i] as Ciphertext, secrets));
      expect(got).toBe(psi[i]);
    }
  });

  it('works on the initial deck (every input a is the identity)', () => {
    const { rnd, secrets, X } = setup('shuffle-init');
    const table = cardTable('d', 8);
    const { out, psi } = shuffleDeck(initialDeck('d', 8), X, rnd);
    const cards = out.map((c) => cardOf(table, decryptWithSecrets(c, secrets)));
    expect(cards).toEqual(psi);
    for (const c of out) expect(c.a.is0()).toBe(false);
  });

  it('is deterministic under a seeded source', () => {
    const { X } = setup('shuffle-det');
    const deck = initialDeck('d', 9);
    const a = shuffleDeck(deck, X, seededRandom('same'));
    const b = shuffleDeck(deck, X, seededRandom('same'));
    expect(a.psi).toEqual(b.psi);
    expect(a.rPrime).toEqual(b.rPrime);
    expect(a.out.every((c, i) => c.a.equals((b.out[i] as Ciphertext).a))).toBe(true);
    const c = shuffleDeck(deck, X, seededRandom('different'));
    expect(c.psi).not.toEqual(a.psi);
  });

  it('draws permutations uniformly enough (all 6 of N = 3 appear)', () => {
    const { X } = setup('shuffle-uni');
    const rnd = seededRandom('uni');
    const deck = initialDeck('d', 3);
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) seen.add(shuffleDeck(deck, X, rnd).psi.join(','));
    expect(seen.size).toBe(6);
  });

  it('does not mutate its input and handles N = 1', () => {
    const { rnd, X } = setup('shuffle-one');
    const deck = initialDeck('d', 1);
    const before = deck[0] as Ciphertext;
    const { out, psi } = shuffleDeck(deck, X, rnd);
    expect(psi).toEqual([0]);
    expect(out).toHaveLength(1);
    expect(deck[0]).toBe(before);
    expect(deck).toHaveLength(1);
  });

  it('rejects an empty deck', () => {
    const { rnd, X } = setup('shuffle-empty');
    expect(() => shuffleDeck([], X, rnd)).toThrow(RangeError);
  });

  it('rejects an identity or non-point X, which proveShuffle would refuse anyway', () => {
    const { rnd } = setup('shuffle-x');
    const deck = initialDeck('tiles', 3);
    expect(() => shuffleDeck(deck, G.subtract(G), rnd)).toThrow(RangeError);
    expect(() => shuffleDeck(deck, null as unknown as typeof G, rnd)).toThrow(RangeError);
    expect(() => shuffleDeck(deck, 5n as unknown as typeof G, rnd)).toThrow(RangeError);
  });
});

describe('permutationCommitment', () => {
  it('commits at the input index: c[psi[i]] = r[psi[i]]·G + hs[i]', () => {
    const rnd = seededRandom('pc-def');
    const n = 7;
    const { hs } = generators(n);
    const psi = [3, 0, 6, 1, 5, 2, 4];
    const { c, r } = permutationCommitment(psi, hs, rnd);
    expect(c).toHaveLength(n);
    expect(r).toHaveLength(n);
    for (let i = 0; i < n; i++) {
      const k = psi[i] as number;
      expect(
        (c[k] as (typeof c)[number]).equals(G.multiply(r[k] as bigint).add(hs[i] as (typeof hs)[number])),
      ).toBe(true);
    }
  });

  it('Σ c_k − Σ h_i = (Σ r_k)·G', () => {
    for (const n of [1, 2, 5, 12]) {
      const rnd = seededRandom(`pc-sum-${n}`);
      const { hs } = generators(n);
      const { psi } = shuffleDeck(initialDeck('d', n), G.multiply(5n), rnd);
      const { c, r } = permutationCommitment(psi, hs, rnd);
      const lhs = msm(
        c,
        c.map(() => 1n),
      ).subtract(
        msm(
          hs,
          hs.map(() => 1n),
        ),
      );
      expect(lhs.equals(G.multiply(sum(r)))).toBe(true);
    }
  });

  it('rejects non-permutations and length mismatches', () => {
    const rnd = seededRandom('pc-bad');
    const { hs } = generators(4);
    expect(() => permutationCommitment([0, 1, 1, 3], hs, rnd)).toThrow(RangeError);
    expect(() => permutationCommitment([0, 1, 2, 4], hs, rnd)).toThrow(RangeError);
    expect(() => permutationCommitment([0, 1, 2, -1], hs, rnd)).toThrow(RangeError);
    expect(() => permutationCommitment([0, 1, 2, 1.5], hs, rnd)).toThrow(RangeError);
    expect(() => permutationCommitment([0, 1, 2], hs, rnd)).toThrow(RangeError);
    expect(() => permutationCommitment([0, 1, 2, 3, 4], hs, rnd)).toThrow(RangeError);
    expect(() => permutationCommitment([], [], rnd)).toThrow(RangeError);
  });
});

describe('commitmentChain', () => {
  it('chains: ĉ_i = r̂_i·G + u′_i·ĉ_{i−1} with ĉ_0 = h', () => {
    const rnd = seededRandom('cc-def');
    const n = 6;
    const { h } = generators(0);
    const uPrime = Array.from({ length: n }, () => randomScalar(rnd));
    const { cHat, rHat } = commitmentChain(h, uPrime, rnd);
    expect(cHat).toHaveLength(n);
    expect(rHat).toHaveLength(n);
    let prev = h;
    for (let i = 0; i < n; i++) {
      const expected = G.multiply(rHat[i] as bigint).add(prev.multiply(uPrime[i] as bigint));
      expect((cHat[i] as (typeof cHat)[number]).equals(expected)).toBe(true);
      prev = cHat[i] as (typeof cHat)[number];
    }
  });

  it('ĉ_N − (Π u′_i)·h = (Σ r̂_i·v_i)·G with v_i = Π_{j>i} u′_j, for N in {1, 2, 8}', () => {
    for (const n of [1, 2, 8]) {
      const rnd = seededRandom(`cc-v-${n}`);
      const { h } = generators(0);
      const uPrime = Array.from({ length: n }, () => randomScalar(rnd));
      const { cHat, rHat } = commitmentChain(h, uPrime, rnd);
      // v_i for 1-based i; arrays are 0-based, so v[i-1] = Π_{j>i} u′_j and v_N = 1.
      const v: bigint[] = new Array<bigint>(n);
      let acc = 1n;
      for (let i = n; i >= 1; i--) {
        v[i - 1] = acc;
        acc = (acc * (uPrime[i - 1] as bigint)) % q;
      }
      const prod = acc; // Π u′_i
      const lhs = (cHat[n - 1] as (typeof cHat)[number]).subtract(h.multiply(prod));
      const rhs = G.multiply(sum(rHat.map((r, i) => (r * (v[i] as bigint)) % q)));
      expect(lhs.equals(rhs)).toBe(true);
    }
  });

  it('rejects scalars outside [1, q) and an empty list', () => {
    const rnd = seededRandom('cc-bad');
    const { h } = generators(0);
    expect(() => commitmentChain(h, [1n, 0n], rnd)).toThrow(RangeError);
    expect(() => commitmentChain(h, [q], rnd)).toThrow(RangeError);
    expect(() => commitmentChain(h, [-1n], rnd)).toThrow(RangeError);
    expect(() => commitmentChain(h, [], rnd)).toThrow(RangeError);
  });
});
