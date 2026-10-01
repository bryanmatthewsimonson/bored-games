import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { cardPoint } from '../src/cards.ts';
import { type Ciphertext, decryptWithSecrets, initialDeck, jointKey, reEncrypt } from '../src/elgamal.ts';
import { G, q } from '../src/group.ts';
import { randomScalar } from '../src/random.ts';
import { seededRandom } from './util.ts';

const Point = secp256k1.Point;

describe('jointKey', () => {
  it('of one key is that key', () => {
    const X = G.multiply(12345n);
    expect(jointKey([X]).equals(X)).toBe(true);
  });

  it('is the sum of the keys', () => {
    const X = G.multiply(3n);
    const Y = G.multiply(5n);
    const Z = G.multiply(9n);
    expect(jointKey([X, Y, Z]).equals(G.multiply(17n))).toBe(true);
  });

  it('rejects an empty list', () => {
    expect(() => jointKey([])).toThrow(RangeError);
  });
});

describe('initialDeck', () => {
  it('is (O, M_i) for each card', () => {
    const deck = initialDeck('tiles', 5);
    expect(deck).toHaveLength(5);
    deck.forEach((c, i) => {
      expect(c.a.is0()).toBe(true);
      expect(c.b.equals(cardPoint('tiles', i))).toBe(true);
    });
  });

  it('allows an empty deck and rejects invalid sizes', () => {
    expect(initialDeck('tiles', 0)).toEqual([]);
    for (const n of [-1, 1.5, Number.NaN]) expect(() => initialDeck('tiles', n)).toThrow(RangeError);
  });
});

describe('reEncrypt and decryptWithSecrets', () => {
  const rnd = seededRandom('elgamal-1');
  const [x0, x1, x2] = [randomScalar(rnd), randomScalar(rnd), randomScalar(rnd)] as [bigint, bigint, bigint];
  const secrets = [x0, x1, x2];
  const X = jointKey(secrets.map((x) => G.multiply(x)));
  // Card 0 of the tiles deck, unencrypted: `(O, M_0)`.
  const card0 = (): Ciphertext => initialDeck('tiles', 1)[0] as Ciphertext;

  it('re-encrypting twice then decrypting with all three secrets gives the card (all 108)', () => {
    const deck = initialDeck('tiles', 108);
    for (let i = 0; i < 108; i++) {
      const c1 = reEncrypt(deck[i] as Ciphertext, X, randomScalar(rnd));
      const c2 = reEncrypt(c1, X, randomScalar(rnd));
      expect(decryptWithSecrets(c2, secrets).equals(cardPoint('tiles', i))).toBe(true);
    }
  });

  it('decrypting with only two of the three secrets does not give the card', () => {
    const c = reEncrypt(reEncrypt(card0(), X, randomScalar(rnd)), X, randomScalar(rnd));
    const M = cardPoint('tiles', 0);
    expect(decryptWithSecrets(c, [x0, x1]).equals(M)).toBe(false);
    expect(decryptWithSecrets(c, [x1, x2]).equals(M)).toBe(false);
    expect(decryptWithSecrets(c, []).equals(M)).toBe(false);
  });

  it('computes (a + r·G, b + r·X) and does not mutate its input', () => {
    const c = card0();
    const r = 77n;
    const out = reEncrypt(c, X, r);
    expect(out.a.equals(c.a.add(G.multiply(r)))).toBe(true);
    expect(out.b.equals(c.b.add(X.multiply(r)))).toBe(true);
    expect(c.a.is0()).toBe(true);
  });

  it('rejects randomness outside [1, q)', () => {
    for (const r of [0n, q, q + 1n, -1n]) expect(() => reEncrypt(card0(), X, r)).toThrow(RangeError);
  });

  it('decrypts with a secret sum of zero mod q (result is b)', () => {
    const c = reEncrypt(card0(), X, 5n);
    expect(decryptWithSecrets(c, [4n, q - 4n]).equals(c.b)).toBe(true);
  });

  it('rejects secrets outside [1, q)', () => {
    for (const x of [0n, q, -1n]) expect(() => decryptWithSecrets(card0(), [x])).toThrow(RangeError);
  });

  it('decrypting an initialDeck entry (identity a) returns b whatever the secrets', () => {
    for (let i = 0; i < 3; i++) {
      const c = initialDeck('tiles', 3)[i] as Ciphertext;
      expect(c.a.is0()).toBe(true);
      expect(c.b.is0()).toBe(false);
      expect(decryptWithSecrets(c, [3n]).equals(c.b)).toBe(true);
      expect(decryptWithSecrets(c, [3n]).equals(cardPoint('tiles', i))).toBe(true);
    }
  });

  it('handles the identity b', () => {
    expect(decryptWithSecrets({ a: Point.ZERO, b: Point.ZERO }, [3n]).is0()).toBe(true);
  });
});
