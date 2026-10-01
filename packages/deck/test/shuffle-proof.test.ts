import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { cardOf, cardPoint, cardTable } from '../src/cards.ts';
import { type Ciphertext, decryptWithSecrets, initialDeck, jointKey, reEncrypt } from '../src/elgamal.ts';
import type { Point } from '../src/encoding.ts';
import { G, q } from '../src/group.ts';
import { randomScalar } from '../src/random.ts';
import {
  proveShuffle,
  type ShuffleCtx,
  type ShuffleProof,
  shuffleDeck,
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
    ];
    for (const [name, f] of cases) expect(f, name).not.toThrow();
    expect(failing(cases)).toEqual([]);
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
