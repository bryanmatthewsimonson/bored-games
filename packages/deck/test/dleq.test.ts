import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { cardOf, cardPoint, cardTable } from '../src/cards.ts';
import { combine, makeShare, type Share, type ShareCtx, verifyShare } from '../src/dleq.ts';
import { type Ciphertext, initialDeck, jointKey, reEncrypt } from '../src/elgamal.ts';
import { G, q } from '../src/group.ts';
import { randomScalar } from '../src/random.ts';
import { seededRandom } from './util.ts';

const Point = secp256k1.Point;
const rnd = seededRandom('dleq-1');
const secrets = [randomScalar(rnd), randomScalar(rnd), randomScalar(rnd)];
const keys = secrets.map((x) => G.multiply(x));
const X = jointKey(keys);
const ctx: ShareCtx = { rootId: 'root-1', deckId: 'tiles', pos: 7 };

function encryptTwice(m: number): Ciphertext {
  const c0 = initialDeck('tiles', m + 1)[m] as Ciphertext;
  return reEncrypt(reEncrypt(c0, X, randomScalar(rnd)), X, randomScalar(rnd));
}

describe('decryption shares', () => {
  const ct = encryptTwice(5);
  const shares = secrets.map((x) => makeShare(x, ct, ctx, rnd));

  it('shares from all 3 seats combine to the card point, and cardOf gives the index', () => {
    const table = cardTable('tiles', 108);
    for (const m of [0, 5, 107]) {
      const c = encryptTwice(m);
      const ds = secrets.map((x) => makeShare(x, c, ctx, rnd).D);
      const M = combine(c, ds);
      expect(M.equals(cardPoint('tiles', m))).toBe(true);
      expect(cardOf(table, M)).toBe(m);
    }
  });

  it('each share verifies against its own seat key', () => {
    for (const [i, sh] of shares.entries()) expect(verifyShare(keys[i] as typeof X, ct, sh, ctx)).toBe(true);
  });

  it('is deterministic under a seeded source', () => {
    const a = makeShare(secrets[0] as bigint, ct, ctx, seededRandom('d'));
    const b = makeShare(secrets[0] as bigint, ct, ctx, seededRandom('d'));
    expect(a.D.equals(b.D) && a.c === b.c && a.s === b.s).toBe(true);
  });

  it('each tampered field fails verification', () => {
    const sh = shares[0] as Share;
    const K = keys[0] as typeof X;
    const tampered: Record<string, () => boolean> = {
      'D + G': () => verifyShare(K, ct, { ...sh, D: sh.D.add(G) }, ctx),
      'c + 1': () => verifyShare(K, ct, { ...sh, c: (sh.c + 1n) % q }, ctx),
      's + 1': () => verifyShare(K, ct, { ...sh, s: (sh.s + 1n) % q }, ctx),
      'wrong X': () => verifyShare(keys[1] as typeof X, ct, sh, ctx),
      'X + G': () => verifyShare(K.add(G), ct, sh, ctx),
      'wrong pos': () => verifyShare(K, ct, sh, { ...ctx, pos: ctx.pos + 1 }),
      'wrong rootId': () => verifyShare(K, ct, sh, { ...ctx, rootId: 'root-2' }),
      'wrong deckId': () => verifyShare(K, ct, sh, { ...ctx, deckId: 'other' }),
      'a + G': () => verifyShare(K, { a: ct.a.add(G), b: ct.b }, sh, ctx),
    };
    for (const [name, run] of Object.entries(tampered)) expect(run(), name).toBe(false);
  });

  it('a share for position p verifies under its own ctx and fails under every other ctx field changed', () => {
    const p = makeShare(secrets[2] as bigint, ct, { rootId: 'r', deckId: 'd', pos: 3 }, rnd);
    const K = keys[2] as typeof X;
    expect(verifyShare(K, ct, p, { rootId: 'r', deckId: 'd', pos: 3 })).toBe(true);
    for (const other of [
      { rootId: 'r2', deckId: 'd', pos: 3 },
      { rootId: 'r', deckId: 'd2', pos: 3 },
      { rootId: 'r', deckId: 'd', pos: 4 },
      { rootId: 'r', deckId: 'd', pos: 0 },
      { rootId: 'd', deckId: 'r', pos: 3 },
    ])
      expect(verifyShare(K, ct, p, other), JSON.stringify(other)).toBe(false);
  });

  it('a share made with seat 1 checked against seat 0 key fails', () => {
    expect(verifyShare(keys[0] as typeof X, ct, shares[1] as Share, ctx)).toBe(false);
  });

  it('a share for one ciphertext does not verify for another', () => {
    expect(verifyShare(keys[0] as typeof X, encryptTwice(5), shares[0] as Share, ctx)).toBe(false);
  });

  it('a valid share with a tampered D (correctly re-proven against the wrong x) fails under the real X', () => {
    const forged = makeShare((secrets[0] as bigint) + 1n, ct, ctx, rnd);
    expect(verifyShare(keys[0] as typeof X, ct, forged, ctx)).toBe(false);
  });

  it('verifyShare returns false, never throws, on malformed input', () => {
    const sh = shares[0] as Share;
    const K = keys[0] as typeof X;
    for (const v of [q, q + 1n, -1n, 2n ** 300n]) {
      expect(verifyShare(K, ct, { ...sh, c: v }, ctx), `c=${v}`).toBe(false);
      expect(verifyShare(K, ct, { ...sh, s: v }, ctx), `s=${v}`).toBe(false);
    }
    expect(verifyShare(K, ct, { ...sh, c: 1 as unknown as bigint }, ctx)).toBe(false);
    expect(verifyShare(K, ct, { ...sh, s: '1' as unknown as bigint }, ctx)).toBe(false);
    expect(verifyShare(K, ct, null as unknown as Share, ctx)).toBe(false);
    expect(verifyShare(Point.ZERO, ct, sh, ctx)).toBe(false);
    expect(verifyShare(K, { a: Point.ZERO, b: ct.b }, sh, ctx)).toBe(false);
    expect(verifyShare(K, ct, { ...sh, D: Point.ZERO }, ctx)).toBe(false);
    expect(verifyShare(K, ct, { ...sh, D: undefined as unknown as typeof X }, ctx)).toBe(false);
    for (const pos of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '7' as unknown as number])
      expect(verifyShare(K, ct, sh, { ...ctx, pos }), `pos=${String(pos)}`).toBe(false);
    expect(verifyShare(K, ct, sh, null as unknown as ShareCtx)).toBe(false);
    expect(verifyShare(K, ct, sh, { ...ctx, rootId: 5 as unknown as string })).toBe(false);
  });

  it('the identity D with the identity-a ciphertext is rejected, not accepted as a trivial proof', () => {
    const c0 = initialDeck('tiles', 1)[0] as Ciphertext;
    expect(verifyShare(keys[0] as typeof X, c0, { D: Point.ZERO, c: 0n, s: 0n }, ctx)).toBe(false);
  });

  it('makeShare rejects bad secrets, an identity a, and a bad pos', () => {
    for (const bad of [0n, q, q + 1n, -1n]) expect(() => makeShare(bad, ct, ctx, rnd)).toThrow(RangeError);
    expect(() => makeShare(1n, initialDeck('tiles', 1)[0] as Ciphertext, ctx, rnd)).toThrow(RangeError);
    for (const pos of [-1, 1.5, Number.NaN]) expect(() => makeShare(1n, ct, { ...ctx, pos }, rnd)).toThrow();
  });
});

describe('combine', () => {
  const ct = encryptTwice(2);

  it('with no shares returns b', () => {
    expect(combine(ct, []).equals(ct.b)).toBe(true);
  });

  it('with a subset of shares does not give the card', () => {
    const ds = secrets.map((x) => makeShare(x, ct, ctx, rnd).D);
    expect(combine(ct, ds.slice(0, 2)).equals(cardPoint('tiles', 2))).toBe(false);
    expect(combine(ct, ds).equals(cardPoint('tiles', 2))).toBe(true);
  });

  it('is b − ΣD and does not depend on order', () => {
    const ds = [G.multiply(3n), G.multiply(4n), G.multiply(5n)];
    const expected = ct.b.subtract(G.multiply(12n));
    expect(combine(ct, ds).equals(expected)).toBe(true);
    expect(combine(ct, [...ds].reverse()).equals(expected)).toBe(true);
  });
});
