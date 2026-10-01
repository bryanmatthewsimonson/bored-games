import { secp256k1 } from '@noble/curves/secp256k1.js';
import { cardPoint } from './cards.ts';
import type { Point } from './encoding.ts';
import { G, q } from './group.ts';

const PointClass = secp256k1.Point;

/** An ElGamal ciphertext `(a, b) = (r·G, M + r·X)`. Either component may be the identity in memory. */
export interface Ciphertext {
  readonly a: Point;
  readonly b: Point;
}

function checkSecret(k: bigint, what: string): void {
  if (typeof k !== 'bigint' || k < 1n || k >= q) throw new RangeError(`${what} must lie in [1, q)`);
}

/** The joint public key: the sum of the seats' deck keys. The sum may be the identity for adversarial input; callers handle that. */
export function jointKey(keys: readonly Point[]): Point {
  if (keys.length === 0) throw new RangeError('jointKey: no keys');
  let sum = PointClass.ZERO;
  for (const K of keys) sum = sum.add(K);
  return sum;
}

/** The unencrypted deck `(O, M_i)` for `i = 0..size-1`. Computed locally, never transmitted. */
export function initialDeck(deckId: string, size: number): Ciphertext[] {
  if (!Number.isSafeInteger(size) || size < 0)
    throw new RangeError('initialDeck: size must be a non-negative safe integer');
  const out: Ciphertext[] = [];
  for (let i = 0; i < size; i++) out.push({ a: PointClass.ZERO, b: cardPoint(deckId, i) });
  return out;
}

/** Re-encrypt under the joint key `X` with secret randomness `r` in [1, q): `(a + r·G, b + r·X)`. Constant-time multiplications. */
export function reEncrypt(c: Ciphertext, X: Point, r: bigint): Ciphertext {
  checkSecret(r, 'reEncrypt: r');
  return { a: c.a.add(G.multiply(r)), b: c.b.add(X.multiply(r)) };
}

/** Remove every layer at once: `b − (Σx)·a`. For tests and the audit, where the secrets are known. */
export function decryptWithSecrets(c: Ciphertext, secrets: readonly bigint[]): Point {
  let sum = 0n;
  for (const x of secrets) {
    checkSecret(x, 'decryptWithSecrets: secret');
    sum = (sum + x) % q;
  }
  // `multiply` rejects 0, and a zero sum (or an identity `a`) removes nothing.
  if (sum === 0n || c.a.is0()) return c.b;
  return c.b.subtract(c.a.multiply(sum));
}
