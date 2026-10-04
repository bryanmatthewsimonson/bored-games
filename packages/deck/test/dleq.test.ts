import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { cardOf, cardPoint, cardTable } from '../src/cards.ts';
import {
  combine,
  decryptPosition,
  makeShare,
  makeShareWithNonce,
  ownShare,
  type Share,
  type ShareCtx,
  verifyShare,
} from '../src/dleq.ts';
import { type Ciphertext, initialDeck, jointKey, reEncrypt } from '../src/elgamal.ts';
import type { Point as Pt } from '../src/encoding.ts';
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
    for (const pos of [-1, -0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '7' as unknown as number])
      expect(verifyShare(K, ct, sh, { ...ctx, pos }), `pos=${String(pos)}`).toBe(false);
    expect(verifyShare(K, ct, sh, null as unknown as ShareCtx)).toBe(false);
    expect(verifyShare(K, ct, sh, { ...ctx, rootId: 5 as unknown as string })).toBe(false);
  });

  it('position -0 is rejected (verifyShare false, makeShare throws), while position 0 works', () => {
    const at0 = { ...ctx, pos: 0 };
    const sh = makeShare(secrets[0] as bigint, ct, at0, rnd);
    expect(verifyShare(keys[0] as typeof X, ct, sh, at0)).toBe(true);
    expect(verifyShare(keys[0] as typeof X, ct, sh, { ...ctx, pos: -0 })).toBe(false);
    expect(() => makeShare(secrets[0] as bigint, ct, { ...ctx, pos: -0 }, rnd)).toThrow(RangeError);
  });

  it('the identity D with the identity-a ciphertext is rejected, not accepted as a trivial proof', () => {
    const c0 = initialDeck('tiles', 1)[0] as Ciphertext;
    expect(verifyShare(keys[0] as typeof X, c0, { D: Point.ZERO, c: 0n, s: 0n }, ctx)).toBe(false);
  });

  it('makeShare rejects bad secrets, an identity a, and a bad pos', () => {
    for (const bad of [0n, q, q + 1n, -1n]) expect(() => makeShare(bad, ct, ctx, rnd)).toThrow(RangeError);
    expect(() => makeShare(1n, initialDeck('tiles', 1)[0] as Ciphertext, ctx, rnd)).toThrow(RangeError);
    for (const pos of [-1, -0, 1.5, Number.NaN])
      expect(() => makeShare(1n, ct, { ...ctx, pos }, rnd), String(pos)).toThrow(RangeError);
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

describe('ownShare', () => {
  const ct = encryptTwice(4);

  it('is x·a, the same D that makeShare publishes, with no randomness', () => {
    for (const x of secrets) {
      expect(ownShare(x, ct).equals(ct.a.multiply(x))).toBe(true);
      expect(ownShare(x, ct).equals(makeShare(x, ct, ctx, rnd).D)).toBe(true);
    }
  });

  it('rejects secrets outside [1, q) and an identity a', () => {
    for (const bad of [0n, q, q + 1n, -1n, 1 as unknown as bigint])
      expect(() => ownShare(bad, ct), String(bad)).toThrow(RangeError);
    expect(() => ownShare(1n, initialDeck('tiles', 1)[0] as Ciphertext)).toThrow(RangeError);
  });
});

describe('decryptPosition', () => {
  const table = cardTable('tiles', 108);
  const m = 9;
  const ct = encryptTwice(m);
  const shares = secrets.map((x) => makeShare(x, ct, ctx, rnd));
  const s0 = shares[0] as Share;
  const s1 = shares[1] as Share;
  const s2 = shares[2] as Share;
  const own = (seat: number) => ({ seat, D: ownShare(secrets[seat] as bigint, ct) });

  it('decrypts to the card with one verified share per seat, as an array or a map', () => {
    expect(decryptPosition(ct, ctx, keys, [s0, s1, s2], table)).toBe(m);
    expect(
      decryptPosition(
        ct,
        ctx,
        keys,
        new Map([
          [2, s2],
          [0, s0],
          [1, s1],
        ]),
        table,
      ),
    ).toBe(m);
  });

  it('the owner decrypts with its own D in place of a share', () => {
    expect(decryptPosition(ct, ctx, keys, [s0, null, s2], table, own(1))).toBe(m);
    expect(
      decryptPosition(
        ct,
        ctx,
        keys,
        new Map([
          [0, s0],
          [1, s1],
        ]),
        table,
        own(2),
      ),
    ).toBe(m);
  });

  it('a second valid share from the same seat (fresh proof randomness) is the same D: keyed by seat, no harm', () => {
    const again = makeShare(secrets[0] as bigint, ct, ctx, seededRandom('again'));
    expect(again.c).not.toBe(s0.c);
    expect(verifyShare(keys[0] as typeof X, ct, again, ctx)).toBe(true);
    // Collected per event, the duplicate D breaks a bare combine.
    expect(cardOf(table, combine(ct, [s0.D, again.D, s1.D, s2.D]))).toBe(null);
    // Keyed by seat, the later one replaces the earlier one.
    const bySeat = new Map([
      [0, s0],
      [1, s1],
      [2, s2],
    ]);
    bySeat.set(0, again);
    expect(decryptPosition(ct, ctx, keys, bySeat, table)).toBe(m);
  });

  it('a duplicated share under another seat fails that seat’s key', () => {
    expect(decryptPosition(ct, ctx, keys, [s0, s0, s2], table)).toBe(null);
    expect(decryptPosition(ct, ctx, keys, [s0, s1, s1], table)).toBe(null);
  });

  it('a missing seat gives null', () => {
    expect(decryptPosition(ct, ctx, keys, [s0, null, s2], table)).toBe(null);
    expect(decryptPosition(ct, ctx, keys, [s0, undefined, s2], table)).toBe(null);
    expect(
      decryptPosition(
        ct,
        ctx,
        keys,
        new Map([
          [0, s0],
          [2, s2],
        ]),
        table,
      ),
    ).toBe(null);
    // The owner's own D does not cover another seat.
    expect(decryptPosition(ct, ctx, keys, [s0, null, null], table, own(2))).toBe(null);
  });

  it('an invalid share gives null', () => {
    expect(decryptPosition(ct, ctx, keys, [s0, { ...s1, s: (s1.s + 1n) % q }, s2], table)).toBe(null);
    expect(decryptPosition(ct, ctx, keys, [s0, { ...s1, D: s1.D.add(G) }, s2], table)).toBe(null);
    // Bound to the ctx: the right shares under another position fail.
    expect(decryptPosition(ct, { ...ctx, pos: ctx.pos + 1 }, keys, [s0, s1, s2], table)).toBe(null);
    expect(decryptPosition(ct, { ...ctx, rootId: 'root-2' }, keys, [s0, s1, s2], table)).toBe(null);
  });

  it('shares checked against the wrong seat keys give null', () => {
    expect(decryptPosition(ct, ctx, keys, [s1, s0, s2], table)).toBe(null);
    expect(decryptPosition(ct, ctx, [keys[1], keys[0], keys[2]] as typeof keys, [s0, s1, s2], table)).toBe(
      null,
    );
  });

  it('a point that is not a card of the table gives null', () => {
    // Every share verifies, but this table does not hold card 9.
    expect(decryptPosition(ct, ctx, keys, [s0, s1, s2], cardTable('tiles', 9))).toBe(null);
    // A wrong own D (another seat's secret) decrypts to a non-card.
    const wrong = { seat: 1, D: ownShare(secrets[0] as bigint, ct) };
    expect(decryptPosition(ct, ctx, keys, [s0, null, s2], table, wrong)).toBe(null);
  });

  it('an identity or malformed ciphertext gives null', () => {
    const c0 = initialDeck('tiles', 1)[0] as Ciphertext;
    expect(decryptPosition(c0, ctx, keys, [s0, s1, s2], table)).toBe(null);
    expect(decryptPosition({ a: ct.a, b: null as unknown as typeof X }, ctx, keys, [s0, s1, s2], table)).toBe(
      null,
    );
  });

  it('a non-object ciphertext gives null, not a TypeError', () => {
    for (const bad of [null, undefined, 7, 'ct', true])
      expect(decryptPosition(bad as unknown as Ciphertext, ctx, keys, [s0, s1, s2], table), String(bad)).toBe(
        null,
      );
  });

  it('a Map value of undefined is a missing share, like null', () => {
    const holey = new Map<number, Share>([
      [0, s0],
      [1, undefined as unknown as Share],
      [2, s2],
    ]);
    expect(decryptPosition(ct, ctx, keys, holey, table)).toBe(null);
    // With the owner's own D for that seat it is not an "own seat also has a share" error.
    expect(decryptPosition(ct, ctx, keys, holey, table, own(1))).toBe(m);
  });

  it('throws on caller errors: no keys, a wrong array length, an out-of-range seat, a bad own', () => {
    expect(() => decryptPosition(ct, ctx, [], [], table)).toThrow(RangeError);
    expect(() => decryptPosition(ct, ctx, keys, [s0, s1], table)).toThrow(RangeError);
    expect(() => decryptPosition(ct, ctx, keys, [s0, s1, s2, s2], table)).toThrow(RangeError);
    // (A Map stores a -0 key as 0, so only the `own` path can see -0.)
    for (const seat of [-1, 3, 1.5, Number.NaN])
      expect(() => decryptPosition(ct, ctx, keys, new Map([[seat, s0]]), table), String(seat)).toThrow(
        RangeError,
      );
    for (const seat of [-1, 3, 1.5, -0])
      expect(
        () => decryptPosition(ct, ctx, keys, [s0, s1, s2], table, { seat, D: s0.D }),
        String(seat),
      ).toThrow(RangeError);
    expect(() => decryptPosition(ct, ctx, keys, [s0, null, s2], table, { seat: 1, D: Point.ZERO })).toThrow(
      RangeError,
    );
    // Exactly one share per seat: the owner's seat may not also hold a share.
    expect(() => decryptPosition(ct, ctx, keys, [s0, s1, s2], table, own(1))).toThrow(RangeError);
  });

  it('does not mutate the shares', () => {
    const arr = [s0, null, s2];
    const map = new Map([
      [0, s0],
      [2, s2],
    ]);
    decryptPosition(ct, ctx, keys, arr, table, own(1));
    decryptPosition(ct, ctx, keys, map, table, own(1));
    expect(arr).toEqual([s0, null, s2]);
    expect([...map.keys()]).toEqual([0, 2]);
  });
});

describe('hedged share nonces (D055 follow-up, protocol v2 T4)', () => {
  const ct = encryptTwice(3);
  const zeros = () => () => new Uint8Array(32);

  it('a constant random source still gives valid, distinct proofs per statement and per secret', () => {
    const a = makeShare(secrets[0] as bigint, ct, ctx, zeros());
    const b = makeShare(secrets[0] as bigint, ct, { ...ctx, pos: 8 }, zeros());
    const c = makeShare(secrets[1] as bigint, ct, ctx, zeros());
    const d = makeShare(secrets[0] as bigint, encryptTwice(3), ctx, zeros());
    expect(verifyShare(keys[0] as Pt, ct, a, ctx)).toBe(true);
    expect(verifyShare(keys[0] as Pt, ct, b, { ...ctx, pos: 8 })).toBe(true);
    expect(verifyShare(keys[1] as Pt, ct, c, ctx)).toBe(true);
    // A repeated nonce over two statements with one secret would leak it: s1 − s2 = (c1 − c2)·x. Here the
    // commitments differ, so the nonces did.
    const T1 = (sh: Share, K: Pt) => G.multiply(sh.s).subtract(K.multiply(sh.c));
    const nonces = [
      T1(a, keys[0] as Pt),
      T1(b, keys[0] as Pt),
      T1(c, keys[1] as Pt),
      T1(d, keys[0] as Pt),
    ].map((P) => P.toHex());
    expect(new Set(nonces).size).toBe(4);
  });

  it('is deterministic for a deterministic source, and still draws from it', () => {
    const x = secrets[0] as bigint;
    const one = makeShare(x, ct, ctx, seededRandom('hedge'));
    const again = makeShare(x, ct, ctx, seededRandom('hedge'));
    const other = makeShare(x, ct, ctx, seededRandom('hedge-2'));
    expect(one.c === again.c && one.s === again.s).toBe(true);
    expect(one.D.equals(other.D)).toBe(true);
    expect(one.c === other.c || one.s === other.s).toBe(false);
  });

  it('the nonce is not the unhedged draw: makeShare and makeShareWithNonce(randomScalar) differ, both verify', () => {
    const x = secrets[2] as bigint;
    const hedged = makeShare(x, ct, ctx, seededRandom('same'));
    const plain = makeShareWithNonce(x, ct, ctx, randomScalar(seededRandom('same')));
    expect(hedged.D.equals(plain.D)).toBe(true);
    expect(hedged.c === plain.c).toBe(false);
    expect(verifyShare(keys[2] as Pt, ct, hedged, ctx)).toBe(true);
    expect(verifyShare(keys[2] as Pt, ct, plain, ctx)).toBe(true);
  });

  it('checks its arguments: a short random read, and a nonce outside [1, q) for the internal hook', () => {
    const x = secrets[0] as bigint;
    expect(() => makeShare(x, ct, ctx, () => new Uint8Array(31))).toThrow(RangeError);
    expect(() => makeShareWithNonce(x, ct, ctx, 0n)).toThrow(RangeError);
    expect(() => makeShareWithNonce(x, ct, ctx, q)).toThrow(RangeError);
    expect(() => makeShareWithNonce(0n, ct, ctx, 1n)).toThrow(RangeError);
    expect(() => makeShareWithNonce(x, ct, { ...ctx, pos: -1 }, 1n)).toThrow(RangeError);
  });
});
