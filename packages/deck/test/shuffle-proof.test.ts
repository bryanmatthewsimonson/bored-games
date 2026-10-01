import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { cardOf, cardPoint, cardTable } from '../src/cards.ts';
import { type Ciphertext, decryptWithSecrets, initialDeck, jointKey, reEncrypt } from '../src/elgamal.ts';
import { hs, type Point } from '../src/encoding.ts';
import { G, generators, msm, q } from '../src/group.ts';
import { type RandomBytes, randomScalar } from '../src/random.ts';
import {
  commitmentChain,
  proveShuffle,
  type ShuffleCtx,
  type ShuffleProof,
  shuffleDeck,
  shuffleTranscript,
  verifyShuffle,
} from '../src/shuffle.ts';
import { seededRandom } from './util.ts';

const ZERO = secp256k1.Point.ZERO;
const DECK = 'tiles';

function keys(seed: string, seats = 3) {
  const rnd = seededRandom(seed);
  const secrets = Array.from({ length: seats }, () => randomScalar(rnd));
  return { rnd, secrets, X: jointKey(secrets.map((x) => G.multiply(x))) };
}

/** Shuffle `input` honestly and prove it. */
function honest(input: readonly Ciphertext[], X: Point, ctx: ShuffleCtx, seed: string) {
  const rnd = seededRandom(seed);
  const { out, psi, rPrime } = shuffleDeck(input, X, rnd);
  const proof = proveShuffle(input, out, X, psi, rPrime, ctx, rnd);
  return { out, psi, rPrime, proof };
}

const add1 = (s: bigint): bigint => (s + 1n) % q;
const setAt = <T>(xs: readonly T[], i: number, v: T): T[] => xs.map((x, j) => (j === i ? v : x));

/** A sparse copy of `xs` with a hole (not `undefined`, a missing index) at `i`; `.every` would skip it. */
function holeAt<T>(xs: readonly T[], i: number): T[] {
  const out = new Array<T>(xs.length);
  for (let k = 0; k < xs.length; k++) if (k !== i) out[k] = xs[k] as T;
  return out;
}

/**
 * Every single-field tamper of `p`: each scalar +1 and each point +G. Array fields are tampered at `idx`
 * (all indices when omitted).
 */
function tamperings(p: ShuffleProof, idx?: readonly number[]): [string, ShuffleProof][] {
  const at = (n: number): readonly number[] => idx ?? Array.from({ length: n }, (_, i) => i);
  const out: [string, ShuffleProof][] = [];
  for (const k of ['s1', 's2', 's3', 's4'] as const) {
    out.push([`s.${k} + 1`, { ...p, s: { ...p.s, [k]: add1(p.s[k]) } }]);
  }
  for (const k of ['sHat', 'sPrime'] as const) {
    for (const i of at(p.s[k].length)) {
      out.push([
        `s.${k}[${i}] + 1`,
        { ...p, s: { ...p.s, [k]: setAt(p.s[k], i, add1(p.s[k][i] as bigint)) } },
      ]);
    }
  }
  for (const k of ['t1', 't2', 't3'] as const) {
    out.push([`t.${k} + G`, { ...p, t: { ...p.t, [k]: p.t[k].add(G) } }]);
  }
  out.push(['t.t4[0] + G', { ...p, t: { ...p.t, t4: [p.t.t4[0].add(G), p.t.t4[1]] } }]);
  out.push(['t.t4[1] + G', { ...p, t: { ...p.t, t4: [p.t.t4[0], p.t.t4[1].add(G)] } }]);
  for (const i of at(p.t.tHat.length)) {
    out.push([
      `t.tHat[${i}] + G`,
      { ...p, t: { ...p.t, tHat: setAt(p.t.tHat, i, (p.t.tHat[i] as Point).add(G)) } },
    ]);
  }
  for (const k of ['c', 'cHat'] as const) {
    for (const i of at(p[k].length)) {
      out.push([`${k}[${i}] + G`, { ...p, [k]: setAt(p[k], i, (p[k][i] as Point).add(G)) }]);
    }
  }
  return out;
}

const modq = (k: bigint): bigint => ((k % q) + q) % q;

function modPow(b: bigint, e: bigint): bigint {
  let r = 1n;
  let x = modq(b);
  for (let k = e; k > 0n; k >>= 1n) {
    if (k & 1n) r = (r * x) % q;
    x = (x * x) % q;
  }
  return r;
}

/** The 0/1 matrix of an index map: `A[i][k] = 1` iff `map[i] = k`. */
const mapMatrix = (map: readonly number[]): bigint[][] =>
  map.map((mk) => map.map((_, k) => (k === mk ? 1n : 0n)));

/**
 * TEST-ONLY cheating prover: `proveShuffle` re-implemented step by step, except that the "permutation"
 * commitment is built for an ARBITRARY matrix `A` (`A[i][k]` = weight of input k in output i):
 * `c[k] = r_k·G + Σ_i A[i][k]·h_i` and `u′_i = Σ_k A[i][k]·u_k`. With a permutation matrix it is the honest prover
 * (a test checks that it verifies, so its hashing matches the real one); otherwise it is a non-permutation forgery.
 */
function forgeShuffleProof(
  input: readonly Ciphertext[],
  output: readonly Ciphertext[],
  X: Point,
  A: readonly (readonly bigint[])[],
  rPrime: readonly bigint[],
  ctx: ShuffleCtx,
  rnd: RandomBytes,
): ShuffleProof {
  const n = input.length;
  const { h, hs: H } = generators(n);
  const flat = (deck: readonly Ciphertext[]) => deck.flatMap((e) => [e.a, e.b]);
  const d = hs('shuffle-ctx', ctx.rootId, ctx.seat, ctx.deckId, X, ...flat(input), ...flat(output));
  const r = Array.from({ length: n }, () => randomScalar(rnd));
  const col = (k: number) => A.map((row) => modq(row[k] as bigint));
  const c = r.map((rk, k) => G.multiply(rk).add(msm(H, col(k))));
  const u = c.map((_, k) => hs('shuffle-u', d, ...c, k + 1));
  const uP = A.map((row) => modq(row.reduce((acc, aik, k) => acc + aik * (u[k] as bigint), 0n)));
  const { cHat, rHat } = commitmentChain(h, uP, rnd);
  const w = Array.from({ length: 4 }, () => randomScalar(rnd)) as [bigint, bigint, bigint, bigint];
  const wHat = Array.from({ length: n }, () => randomScalar(rnd));
  const wP = Array.from({ length: n }, () => randomScalar(rnd));
  let t3 = G.multiply(w[2]);
  let t41 = G.multiply(w[3]).negate();
  let t42 = X.multiply(w[3]).negate();
  const tHat: Point[] = [];
  for (let i = 0; i < n; i++) {
    const wi = wP[i] as bigint;
    t3 = t3.add((H[i] as Point).multiply(wi));
    t41 = t41.add((output[i] as Ciphertext).a.multiply(wi));
    t42 = t42.add((output[i] as Ciphertext).b.multiply(wi));
    const prev = i === 0 ? h : (cHat[i - 1] as Point);
    tHat.push(G.multiply(wHat[i] as bigint).add(prev.multiply(wi)));
  }
  const t = { t1: G.multiply(w[0]), t2: G.multiply(w[1]), t3, t4: [t41, t42] as const, tHat };
  const ch = hs('shuffle-c', d, X, ...c, ...cHat, t.t1, t.t2, t.t3, t41, t42, ...tHat);
  const sum = (xs: readonly bigint[]) => xs.reduce((a, b) => (a + b) % q, 0n);
  let v = 1n;
  const rHatV = new Array<bigint>(n);
  for (let i = n - 1; i >= 0; i--) {
    rHatV[i] = ((rHat[i] as bigint) * v) % q;
    v = (v * (uP[i] as bigint)) % q;
  }
  const resp = (wk: bigint, secret: bigint) => (wk + ch * secret) % q;
  return {
    c,
    cHat,
    t,
    s: {
      s1: resp(w[0], sum(r)),
      s2: resp(w[1], sum(rHatV)),
      s3: resp(w[2], sum(r.map((rk, k) => rk * (u[k] as bigint)))),
      s4: resp(w[3], sum(uP.map((x, i) => x * (rPrime[i] as bigint)))),
      sHat: wHat.map((x, i) => resp(x, rHat[i] as bigint)),
      sPrime: wP.map((x, i) => resp(x, uP[i] as bigint)),
    },
  };
}

/** Every proof array truncated and extended by one element. */
function resized(p: ShuffleProof): [string, ShuffleProof][] {
  const out: [string, ShuffleProof][] = [];
  const P = (p.c[0] as Point).add(G);
  out.push(['c truncated', { ...p, c: p.c.slice(0, -1) }], ['c extended', { ...p, c: [...p.c, P] }]);
  out.push(
    ['cHat truncated', { ...p, cHat: p.cHat.slice(0, -1) }],
    ['cHat extended', { ...p, cHat: [...p.cHat, P] }],
  );
  out.push(
    ['tHat truncated', { ...p, t: { ...p.t, tHat: p.t.tHat.slice(0, -1) } }],
    ['tHat extended', { ...p, t: { ...p.t, tHat: [...p.t.tHat, P] } }],
  );
  for (const k of ['sHat', 'sPrime'] as const) {
    out.push(
      [`${k} truncated`, { ...p, s: { ...p.s, [k]: p.s[k].slice(0, -1) } }],
      [`${k} extended`, { ...p, s: { ...p.s, [k]: [...p.s[k], 5n] } }],
    );
  }
  return out;
}

function failing(cases: [string, () => boolean][]): string[] {
  return cases.filter(([, f]) => f()).map(([name]) => name);
}

describe('proveShuffle / verifyShuffle: completeness', () => {
  for (const n of [1, 2, 3, 8]) {
    it(`an honest proof verifies for N = ${n}, from the initial deck and chained`, () => {
      const { secrets, X } = keys(`tw-comp-${n}`);
      const deck0 = initialDeck(DECK, n);
      const ctx0: ShuffleCtx = { rootId: 'root', seat: 0, deckId: DECK };
      const s0 = honest(deck0, X, ctx0, `tw-s0-${n}`);
      expect(verifyShuffle(deck0, s0.out, X, s0.proof, ctx0)).toBe(true);
      const ctx1: ShuffleCtx = { ...ctx0, seat: 1 };
      const s1 = honest(s0.out, X, ctx1, `tw-s1-${n}`);
      expect(verifyShuffle(s0.out, s1.out, X, s1.proof, ctx1)).toBe(true);
      // The final deck still decrypts to a permutation of the cards.
      const table = cardTable(DECK, n);
      const cards = s1.out.map((c) => cardOf(table, decryptWithSecrets(c, secrets)));
      expect([...cards].sort((a, b) => (a as number) - (b as number))).toEqual(
        Array.from({ length: n }, (_, i) => i),
      );
    });
  }

  it('an honest proof verifies for N = 108, from the initial deck and chained', { timeout: 60_000 }, () => {
    const { X } = keys('tw-comp-108');
    const deck0 = initialDeck(DECK, 108);
    const ctx0: ShuffleCtx = { rootId: 'root', seat: 0, deckId: DECK };
    let t = performance.now();
    const s0 = honest(deck0, X, ctx0, 'tw-s0-108');
    const prove0 = performance.now() - t;
    t = performance.now();
    expect(verifyShuffle(deck0, s0.out, X, s0.proof, ctx0)).toBe(true);
    const verify0 = performance.now() - t;
    const ctx1: ShuffleCtx = { ...ctx0, seat: 1 };
    t = performance.now();
    const s1 = honest(s0.out, X, ctx1, 'tw-s1-108');
    const prove1 = performance.now() - t;
    t = performance.now();
    expect(verifyShuffle(s0.out, s1.out, X, s1.proof, ctx1)).toBe(true);
    const verify1 = performance.now() - t;
    console.info(
      `N = 108: shuffle+prove ${prove0.toFixed(0)} / ${prove1.toFixed(0)} ms, verify ${verify0.toFixed(0)} / ${verify1.toFixed(0)} ms`,
    );
  });

  it('is deterministic under a seeded source', () => {
    const { X } = keys('tw-det');
    const deck = initialDeck(DECK, 3);
    const ctx: ShuffleCtx = { rootId: 'r', seat: 2, deckId: DECK };
    const a = honest(deck, X, ctx, 'same');
    const b = honest(deck, X, ctx, 'same');
    expect(a.proof.s).toEqual(b.proof.s);
    expect(a.proof.t.t1.equals(b.proof.t.t1)).toBe(true);
  });
});

describe('proveShuffle / verifyShuffle: soundness (N = 8)', () => {
  const n = 8;
  const { rnd, X } = keys('tw-sound');
  // Inputs that are already encrypted, so both a and b are non-trivial.
  const input = initialDeck(DECK, n).map((c) => reEncrypt(c, X, randomScalar(rnd)));
  const ctx: ShuffleCtx = { rootId: 'root-1', seat: 2, deckId: DECK };
  const { out, psi, rPrime, proof } = honest(input, X, ctx, 'tw-sound-prove');

  it('the honest proof verifies', () => {
    expect(verifyShuffle(input, out, X, proof, ctx)).toBe(true);
  });

  it('every scalar +1 and every point +G, at every index, fails', () => {
    const cases = tamperings(proof);
    expect(cases).toHaveLength(4 + 2 * n + 5 + 3 * n);
    const accepted = cases.filter(([, p]) => verifyShuffle(input, out, X, p, ctx)).map(([name]) => name);
    expect(accepted).toEqual([]);
  });

  it('a card replaced by a fresh encryption of a different card fails (Review Focus 3)', () => {
    const j = 3;
    const r = randomScalar(rnd);
    const fresh = reEncrypt({ a: ZERO, b: cardPoint(DECK, n + 5) }, X, r);
    const forged = setAt(out, j, fresh);
    // The honest proof does not transfer, and the cheater cannot prove the forged deck either.
    expect(verifyShuffle(input, forged, X, proof, ctx)).toBe(false);
    const cheat = proveShuffle(input, forged, X, psi, setAt(rPrime, j, r), ctx, rnd);
    expect(verifyShuffle(input, forged, X, cheat, ctx)).toBe(false);
  });

  it('two outputs swapped after proving fail', () => {
    const swapped = setAt(setAt(out, 1, out[5] as Ciphertext), 5, out[1] as Ciphertext);
    expect(verifyShuffle(input, swapped, X, proof, ctx)).toBe(false);
    // Proving the swapped deck under the original permutation fails too.
    const cheat = proveShuffle(input, swapped, X, psi, rPrime, ctx, rnd);
    expect(verifyShuffle(input, swapped, X, cheat, ctx)).toBe(false);
  });

  it('a duplicated card fails', () => {
    const dup = setAt(out, 6, out[2] as Ciphertext);
    expect(verifyShuffle(input, dup, X, proof, ctx)).toBe(false);
    const cheat = proveShuffle(input, dup, X, psi, setAt(rPrime, 6, rPrime[2] as bigint), ctx, rnd);
    expect(verifyShuffle(input, dup, X, cheat, ctx)).toBe(false);
  });

  it('the proof fails under another rootId, seat or deckId (Review Focus 2)', () => {
    const cases: [string, () => boolean][] = [
      ['rootId', () => verifyShuffle(input, out, X, proof, { ...ctx, rootId: 'root-2' })],
      ['seat', () => verifyShuffle(input, out, X, proof, { ...ctx, seat: 1 })],
      ['deckId', () => verifyShuffle(input, out, X, proof, { ...ctx, deckId: 'other' })],
    ];
    expect(failing(cases)).toEqual([]);
  });

  it('a wrong X fails', () => {
    const cases: [string, () => boolean][] = [
      ['X + G', () => verifyShuffle(input, out, X.add(G), proof, ctx)],
      ['other key', () => verifyShuffle(input, out, G.multiply(12345n), proof, ctx)],
      ['identity', () => verifyShuffle(input, out, ZERO, proof, ctx)],
    ];
    expect(failing(cases)).toEqual([]);
  });

  it('a tampered input deck fails', () => {
    const a = setAt(input, 4, { a: (input[4] as Ciphertext).a.add(G), b: (input[4] as Ciphertext).b });
    const b = setAt(input, 0, { a: (input[0] as Ciphertext).a, b: (input[0] as Ciphertext).b.add(G) });
    expect(verifyShuffle(a, out, X, proof, ctx)).toBe(false);
    expect(verifyShuffle(b, out, X, proof, ctx)).toBe(false);
  });

  it('every proof array truncated or extended by one fails', () => {
    const accepted = resized(proof)
      .filter(([, p]) => verifyShuffle(input, out, X, p, ctx))
      .map(([name]) => name);
    expect(accepted).toEqual([]);
  });

  it('decks truncated or extended by one fail, and so do input and output of different lengths', () => {
    const extra = out[0] as Ciphertext;
    const cases: [string, () => boolean][] = [
      ['both truncated', () => verifyShuffle(input.slice(0, -1), out.slice(0, -1), X, proof, ctx)],
      ['both extended', () => verifyShuffle([...input, extra], [...out, extra], X, proof, ctx)],
      ['output truncated', () => verifyShuffle(input, out.slice(0, -1), X, proof, ctx)],
      ['input truncated', () => verifyShuffle(input.slice(0, -1), out, X, proof, ctx)],
      ['output extended', () => verifyShuffle(input, [...out, extra], X, proof, ctx)],
    ];
    expect(failing(cases)).toEqual([]);
  });

  it('N = 0 fails', () => {
    const empty: ShuffleProof = {
      c: [],
      cHat: [],
      t: { ...proof.t, tHat: [] },
      s: { ...proof.s, sHat: [], sPrime: [] },
    };
    expect(verifyShuffle([], [], X, empty, ctx)).toBe(false);
  });

  it('rejects malformed values without throwing', () => {
    const anyP = (v: unknown) => v as Point;
    const anyS = (v: unknown) => v as bigint;
    const cases: [string, () => boolean][] = [
      ['s1 = q', () => verifyShuffle(input, out, X, { ...proof, s: { ...proof.s, s1: q } }, ctx)],
      ['s2 = -1', () => verifyShuffle(input, out, X, { ...proof, s: { ...proof.s, s2: -1n } }, ctx)],
      ['s3 a number', () => verifyShuffle(input, out, X, { ...proof, s: { ...proof.s, s3: anyS(1) } }, ctx)],
      [
        'sHat[0] = q',
        () =>
          verifyShuffle(input, out, X, { ...proof, s: { ...proof.s, sHat: setAt(proof.s.sHat, 0, q) } }, ctx),
      ],
      [
        'sPrime[7] a string',
        () =>
          verifyShuffle(
            input,
            out,
            X,
            { ...proof, s: { ...proof.s, sPrime: setAt(proof.s.sPrime, 7, anyS('1')) } },
            ctx,
          ),
      ],
      ['t1 identity', () => verifyShuffle(input, out, X, { ...proof, t: { ...proof.t, t1: ZERO } }, ctx)],
      [
        't4[1] identity',
        () => verifyShuffle(input, out, X, { ...proof, t: { ...proof.t, t4: [proof.t.t4[0], ZERO] } }, ctx),
      ],
      [
        'tHat[2] identity',
        () =>
          verifyShuffle(
            input,
            out,
            X,
            { ...proof, t: { ...proof.t, tHat: setAt(proof.t.tHat, 2, ZERO) } },
            ctx,
          ),
      ],
      ['c[0] identity', () => verifyShuffle(input, out, X, { ...proof, c: setAt(proof.c, 0, ZERO) }, ctx)],
      [
        'cHat[7] identity',
        () => verifyShuffle(input, out, X, { ...proof, cHat: setAt(proof.cHat, 7, ZERO) }, ctx),
      ],
      [
        'c[1] a string',
        () => verifyShuffle(input, out, X, { ...proof, c: setAt(proof.c, 1, anyP('x')) }, ctx),
      ],
      ['t2 null', () => verifyShuffle(input, out, X, { ...proof, t: { ...proof.t, t2: anyP(null) } }, ctx)],
      [
        'output a identity',
        () => verifyShuffle(input, setAt(out, 3, { a: ZERO, b: (out[3] as Ciphertext).b }), X, proof, ctx),
      ],
      [
        'output b identity',
        () => verifyShuffle(input, setAt(out, 3, { a: (out[3] as Ciphertext).a, b: ZERO }), X, proof, ctx),
      ],
      [
        'input not a point',
        () =>
          verifyShuffle(setAt(input, 1, { a: anyP(1), b: (input[1] as Ciphertext).b }), out, X, proof, ctx),
      ],
      ['X not a point', () => verifyShuffle(input, out, anyP({}), proof, ctx)],
      ['seat not an integer', () => verifyShuffle(input, out, X, proof, { ...ctx, seat: 2.5 })],
      [
        'seat a string',
        () => verifyShuffle(input, out, X, proof, { ...ctx, seat: '2' as unknown as number }),
      ],
      ['proof null', () => verifyShuffle(input, out, X, null as unknown as ShuffleProof, ctx)],
      [
        'proof.t missing',
        () => verifyShuffle(input, out, X, { ...proof, t: undefined } as unknown as ShuffleProof, ctx),
      ],
      ['output null', () => verifyShuffle(input, null as unknown as Ciphertext[], X, proof, ctx)],
      ['c sparse', () => verifyShuffle(input, out, X, { ...proof, c: holeAt(proof.c, 3) }, ctx)],
      ['cHat sparse', () => verifyShuffle(input, out, X, { ...proof, cHat: holeAt(proof.cHat, 0) }, ctx)],
      [
        'tHat sparse',
        () =>
          verifyShuffle(input, out, X, { ...proof, t: { ...proof.t, tHat: holeAt(proof.t.tHat, 7) } }, ctx),
      ],
      [
        'sHat sparse',
        () =>
          verifyShuffle(input, out, X, { ...proof, s: { ...proof.s, sHat: holeAt(proof.s.sHat, 2) } }, ctx),
      ],
      [
        'sPrime sparse',
        () =>
          verifyShuffle(
            input,
            out,
            X,
            { ...proof, s: { ...proof.s, sPrime: holeAt(proof.s.sPrime, 5) } },
            ctx,
          ),
      ],
      ['input sparse', () => verifyShuffle(holeAt(input, 1), out, X, proof, ctx)],
      ['output sparse', () => verifyShuffle(input, holeAt(out, 6), X, proof, ctx)],
    ];
    for (const [name, f] of cases) expect(f, name).not.toThrow();
    expect(failing(cases)).toEqual([]);
  });
});

/*
 * Cheating provers that each break exactly ONE verifier equation. Every forged deck is re-proved with the true
 * psi and rPrime, so all other equations still hold; removing the named check from `verifyShuffle` makes the
 * matching test fail (checked by hand, see the Task 7 report, fix round 1).
 */
describe('proveShuffle / verifyShuffle: targeted forgeries (N = 8)', () => {
  const n = 8;
  const { rnd, X, secrets } = keys('tw-forge');
  const input = initialDeck(DECK, n).map((c) => reEncrypt(c, X, randomScalar(rnd)));
  const ctx: ShuffleCtx = { rootId: 'root-f', seat: 1, deckId: DECK };
  const { out, psi, rPrime } = honest(input, X, ctx, 'tw-forge-prove');
  const table = cardTable(DECK, n);
  const j = 4;

  // Pins t4[1] == Σ s′_i·b′_i − s4·X − ch·Σ u_k·b_k: the deck-stacking attack changes only the message part.
  it('(a) b-only substitution: output j decrypts to a different card (pins t4[1])', () => {
    const m = psi[j] as number;
    const k = (m + 1) % n;
    const e = out[j] as Ciphertext;
    const forged = setAt(out, j, { a: e.a, b: e.b.add(cardPoint(DECK, k)).subtract(cardPoint(DECK, m)) });
    expect(cardOf(table, decryptWithSecrets(forged[j] as Ciphertext, secrets))).toBe(k);
    const proof = proveShuffle(input, forged, X, psi, rPrime, ctx, rnd);
    expect(verifyShuffle(input, forged, X, proof, ctx)).toBe(false);
  });

  // Pins t4[0] == Σ s′_i·a′_i − s4·G − ch·Σ u_k·a_k: only the randomness part is off.
  it('(b) a-only tamper: a′_j + G with b′_j unchanged (pins t4[0])', () => {
    const e = out[j] as Ciphertext;
    const forged = setAt(out, j, { a: e.a.add(G), b: e.b });
    const proof = proveShuffle(input, forged, X, psi, rPrime, ctx, rnd);
    expect(verifyShuffle(input, forged, X, proof, ctx)).toBe(false);
  });

  it('the test-only forging prover is honest when given a true permutation', () => {
    const proof = forgeShuffleProof(input, out, X, mapMatrix(psi), rPrime, ctx, rnd);
    expect(verifyShuffle(input, out, X, proof, ctx)).toBe(true);
  });

  // Pins t2 == s2·G − ch·(ĉ_N − (Π u_k)·h), the product check: the only equation that tells a permutation
  // matrix from any other matrix with row sums 1. A = M·P, where P is psi's permutation matrix and M mixes
  // outputs 0 and 1 with the block [[2, −1], [−1, 2]] (row sums 1, so t1 holds). The forged outputs are
  // e′ = (Mᵀ)⁻¹·(P·e) plus a re-encryption, i.e. e′_0 = (2f_0 + f_1)/3 and e′_1 = (f_0 + 2f_1)/3 for the honest
  // permuted inputs f_i = e_{psi[i]}. Then Aᵀ·e′ = e + re-encryption, so t3, t4[0], t4[1] and every t̂_i hold,
  // but with w_i = u_{psi[i]}, Π u′_i = (2w_0 − w_1)(2w_1 − w_0)·Π_{i≥2} w_i ≠ Π_i w_i = Π u_k.
  it('(c) non-permutation commitment matrix with row sums 1 (pins t2)', () => {
    const P = mapMatrix(psi);
    const A = P.map((row, i) => {
      if (i > 1) return row;
      const [self, other] = i === 0 ? [P[0], P[1]] : [P[1], P[0]];
      return row.map((_, k) => 2n * ((self as bigint[])[k] as bigint) - ((other as bigint[])[k] as bigint));
    });
    const third = modPow(3n, q - 2n);
    const f = psi.map((k) => input[k] as Ciphertext);
    const f0 = f[0] as Ciphertext;
    const f1 = f[1] as Ciphertext;
    const mix = (x: bigint, y: bigint): Ciphertext => ({
      a: msm([f0.a, f1.a], [modq(x * third), modq(y * third)]),
      b: msm([f0.b, f1.b], [modq(x * third), modq(y * third)]),
    });
    const base = f.map((e, i) => (i === 0 ? mix(2n, 1n) : i === 1 ? mix(1n, 2n) : e));
    const forged = base.map((e, i) => reEncrypt(e, X, rPrime[i] as bigint));
    const proof = forgeShuffleProof(input, forged, X, A, rPrime, ctx, rnd);
    expect(verifyShuffle(input, forged, X, proof, ctx)).toBe(false);
  });

  // A repeated index (outputs 0 and j both re-encrypt input psi[0]) is the naive non-permutation forgery. It is
  // caught by t2 first, but also by t4[0] and t4[1]: Σ u′_i·e′_i then sums a different multiset of inputs than
  // Σ u_k·e_k. So it does not isolate one equation; (c) above does.
  it('a repeated-index commitment duplicating a card fails', () => {
    const map = setAt(psi, j, psi[0] as number);
    const forged = out.map((_, i) =>
      reEncrypt(input[map[i] as number] as Ciphertext, X, rPrime[i] as bigint),
    );
    const proof = forgeShuffleProof(input, forged, X, mapMatrix(map), rPrime, ctx, rnd);
    expect(verifyShuffle(input, forged, X, proof, ctx)).toBe(false);
  });
});

describe('proveShuffle / verifyShuffle: soundness (N = 108)', () => {
  const n = 108;
  const { X } = keys('tw-sound-108');
  const input = initialDeck(DECK, n);
  const ctx: ShuffleCtx = { rootId: 'root-108', seat: 0, deckId: DECK };
  let fixture: ReturnType<typeof honest> | null = null;
  const get = () => {
    fixture ??= honest(input, X, ctx, 'tw-sound-108-prove');
    return fixture;
  };

  it('tampers at the first, middle and last index of each array fail', { timeout: 120_000 }, () => {
    const { out, proof } = get();
    expect(verifyShuffle(input, out, X, proof, ctx)).toBe(true);
    const cases = tamperings(proof, [0, 54, 107]);
    const accepted = cases.filter(([, p]) => verifyShuffle(input, out, X, p, ctx)).map(([name]) => name);
    expect(accepted).toEqual([]);
  });

  it('a replaced card, swapped outputs and a wrong context fail', { timeout: 60_000 }, () => {
    const { out, proof } = get();
    const fresh = reEncrypt({ a: ZERO, b: cardPoint(DECK, n) }, X, 99n);
    const cases: [string, () => boolean][] = [
      ['replaced', () => verifyShuffle(input, setAt(out, 107, fresh), X, proof, ctx)],
      [
        'swapped',
        () =>
          verifyShuffle(
            input,
            setAt(setAt(out, 0, out[107] as Ciphertext), 107, out[0] as Ciphertext),
            X,
            proof,
            ctx,
          ),
      ],
      ['seat', () => verifyShuffle(input, out, X, proof, { ...ctx, seat: 1 })],
    ];
    expect(failing(cases)).toEqual([]);
  });
});

describe('proveShuffle: input checks', () => {
  const { rnd, X } = keys('tw-throw');
  const input = initialDeck(DECK, 4);
  const ctx: ShuffleCtx = { rootId: 'r', seat: 0, deckId: DECK };
  const { out, psi, rPrime } = shuffleDeck(input, X, rnd);

  it('throws on an empty deck, length mismatches and a non-permutation', () => {
    expect(() => proveShuffle([], [], X, [], [], ctx, rnd)).toThrow(RangeError);
    expect(() => proveShuffle(input, out.slice(0, 3), X, psi, rPrime, ctx, rnd)).toThrow(RangeError);
    expect(() => proveShuffle(input, out, X, psi.slice(0, 3), rPrime, ctx, rnd)).toThrow(RangeError);
    expect(() => proveShuffle(input, out, X, psi, rPrime.slice(0, 3), ctx, rnd)).toThrow(RangeError);
    expect(() => proveShuffle(input, out, X, [0, 0, 1, 2], rPrime, ctx, rnd)).toThrow(RangeError);
    expect(() => proveShuffle(input, out, X, psi, setAt(rPrime, 0, 0n), ctx, rnd)).toThrow(RangeError);
  });
});

describe('shuffleTranscript', () => {
  const { X } = keys('tw-transcript');
  const input = initialDeck(DECK, 5);
  const ctx: ShuffleCtx = { rootId: 'r', seat: 1, deckId: DECK };
  const { out, proof } = honest(input, X, ctx, 'tw-transcript-1');

  it('gives d, every u_i and ch exactly as PROTOCOL §5.3 writes them', () => {
    const n = input.length;
    const ab = (deck: readonly Ciphertext[]) => deck.flatMap((e) => [e.a, e.b]);
    const d = hs('shuffle-ctx', ctx.rootId, ctx.seat, ctx.deckId, X, ...ab(input), ...ab(out));
    const u = Array.from({ length: n }, (_, k) => hs('shuffle-u', d, ...proof.c, k + 1));
    const { t } = proof;
    const ch = hs(
      'shuffle-c',
      d,
      X,
      ...proof.c,
      ...proof.cHat,
      t.t1,
      t.t2,
      t.t3,
      t.t4[0],
      t.t4[1],
      ...t.tHat,
    );
    expect(shuffleTranscript(input, out, X, proof, ctx)).toEqual({ d, u, ch });
  });

  it('follows the context: another seat gives another d, u and ch', () => {
    const a = shuffleTranscript(input, out, X, proof, ctx);
    const b = shuffleTranscript(input, out, X, proof, { ...ctx, seat: 2 });
    expect(b.d).not.toBe(a.d);
    expect(b.ch).not.toBe(a.ch);
    expect(b.u.some((x, i) => x === a.u[i])).toBe(false);
  });

  it('throws on input verifyShuffle would reject as malformed', () => {
    expect(() => shuffleTranscript(input, out.slice(1), X, proof, ctx)).toThrow(RangeError);
    expect(() => shuffleTranscript(input, out, ZERO, proof, ctx)).toThrow(RangeError);
    expect(() => shuffleTranscript(input, out, X, { ...proof, c: proof.c.slice(1) }, ctx)).toThrow(
      RangeError,
    );
    expect(() => shuffleTranscript(input, out, X, proof, { ...ctx, seat: -1 })).toThrow(RangeError);
  });
});
