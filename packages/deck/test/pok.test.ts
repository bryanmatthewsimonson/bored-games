import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { G, q } from '../src/group.ts';
import { provePok, verifyPok } from '../src/pok.ts';
import { randomScalar } from '../src/random.ts';
import { seededRandom } from './util.ts';

const Point = secp256k1.Point;
const ctx = ['tableaddr', 'npub1abc', 'sessionpub'];

describe('proof of knowledge of the deck key', () => {
  const rnd = seededRandom('pok-1');
  const x = randomScalar(rnd);
  const X = G.multiply(x);
  const proof = provePok(x, ctx, rnd);

  it('a valid proof verifies', () => {
    expect(verifyPok(X, proof, ctx)).toBe(true);
  });

  it('is deterministic under a seeded source', () => {
    expect(provePok(x, ctx, seededRandom('pok-det'))).toEqual(provePok(x, ctx, seededRandom('pok-det')));
  });

  it('verifies for many keys', () => {
    for (let i = 0; i < 20; i++) {
      const k = randomScalar(rnd);
      expect(verifyPok(G.multiply(k), provePok(k, ctx, rnd), ctx)).toBe(true);
    }
  });

  it('fails for a different X', () => {
    expect(verifyPok(G.multiply(x + 1n), proof, ctx)).toBe(false);
    expect(verifyPok(G.multiply(randomScalar(rnd)), proof, ctx)).toBe(false);
  });

  it('fails for X = BASE with a proof made for another key', () => {
    expect(verifyPok(G, proof, ctx)).toBe(false);
  });

  it('fails when any one of the three context parts changes', () => {
    for (let i = 0; i < ctx.length; i++) {
      const other = ctx.map((p, j) => (j === i ? `${p}x` : p));
      expect(verifyPok(X, proof, other), `ctx part ${i}`).toBe(false);
    }
  });

  it('fails when the context parts are reordered, dropped or extended', () => {
    expect(verifyPok(X, proof, [ctx[1] as string, ctx[0] as string, ctx[2] as string])).toBe(false);
    expect(verifyPok(X, proof, [ctx[2] as string, ctx[1] as string, ctx[0] as string])).toBe(false);
    expect(verifyPok(X, proof, ctx.slice(0, 2))).toBe(false);
    expect(verifyPok(X, proof, [...ctx, 'extra'])).toBe(false);
  });

  it('fails for c + 1 and s + 1', () => {
    expect(verifyPok(X, { c: (proof.c + 1n) % q, s: proof.s }, ctx)).toBe(false);
    expect(verifyPok(X, { c: proof.c, s: (proof.s + 1n) % q }, ctx)).toBe(false);
  });

  it('returns false, never throws, on malformed input', () => {
    const bad = [q, q + 1n, -1n, 2n ** 300n];
    for (const v of bad) {
      expect(verifyPok(X, { c: v, s: proof.s }, ctx), `c=${v}`).toBe(false);
      expect(verifyPok(X, { c: proof.c, s: v }, ctx), `s=${v}`).toBe(false);
    }
    expect(verifyPok(X, { c: 1 as unknown as bigint, s: proof.s }, ctx)).toBe(false);
    expect(verifyPok(X, { c: proof.c, s: '1' as unknown as bigint }, ctx)).toBe(false);
    expect(verifyPok(X, null as unknown as { c: bigint; s: bigint }, ctx)).toBe(false);
    expect(verifyPok(Point.ZERO, proof, ctx)).toBe(false); // identity X
    expect(verifyPok(null as unknown as typeof G, proof, ctx)).toBe(false);
    expect(verifyPok({ is0: () => false } as unknown as typeof G, proof, ctx)).toBe(false); // not a Point
    expect(verifyPok(X, proof, [Number.NaN])).toBe(false);
  });

  it('rejects the all-zero proof', () => {
    expect(verifyPok(X, { c: 0n, s: 0n }, ctx)).toBe(false);
  });

  it('prover rejects secrets outside [1, q)', () => {
    for (const bad of [0n, q, q + 1n, -1n]) expect(() => provePok(bad, ctx, rnd)).toThrow(RangeError);
  });
});
