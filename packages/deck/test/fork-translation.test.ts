import { describe, expect, it } from 'vitest';
import { cardOf, cardTable } from '../src/cards.ts';
import { combine, makeShare, ownShare, type ShareCtx, verifyShare } from '../src/dleq.ts';
import { type Ciphertext, decryptWithSecrets, initialDeck, jointKey, reEncrypt } from '../src/elgamal.ts';
import type { Point } from '../src/encoding.ts';
import { G, q } from '../src/group.ts';
import { randomScalar } from '../src/random.ts';
import { shuffleDeck } from '../src/shuffle.ts';
import { seededRandom } from './util.ts';

/*
 * Review finding F7 (D056): a decryption share is not bound to a branch, and across two rival decks it is not even
 * bound to a ciphertext. The last shuffler knows the re-encryption randomness of both rival output decks, so it can
 * turn an honest seat's share of a card on deck A into that seat's share of the same card on deck B. Before D056 an
 * honest client dealt again after a shuffle fork (the web controller rebuilt an orphaned deal), so an equivocating
 * last shuffler could read the other seats' starting hands. D056 makes every seat deal at most once per game and
 * stalls the shuffle equivocator instead; this test keeps the algebra that makes the rule necessary.
 */
describe('cross-deck share translation by an equivocating last shuffler', () => {
  const rnd = seededRandom('fork-translation');
  const secrets = [randomScalar(rnd), randomScalar(rnd), randomScalar(rnd)];
  const keys = secrets.map((x) => G.multiply(x));
  const X = jointKey(keys);
  const N = 6;
  const deckId = 'tiles';
  const table = cardTable(deckId, N);
  // Seats 0 and 1 shuffle honestly; seat 2 is last.
  let input = initialDeck(deckId, N);
  for (let k = 0; k < 2; k++) input = shuffleDeck(input, X, rnd).out;
  // Seat 2 signs two rival steps on the same prev: A keeps the order, B rotates it by two. It keeps both
  // randomizer vectors (an honest shuffler discards them; a cheater need not).
  const rA = Array.from({ length: N }, () => randomScalar(rnd));
  const rB = Array.from({ length: N }, () => randomScalar(rnd));
  const permB = (j: number): number => (j + 2) % N; // B[j] holds the card of input[permB(j)] = A[permB(j)]
  const A: Ciphertext[] = input.map((c, i) => reEncrypt(c, X, rA[i] as bigint));
  const B: Ciphertext[] = input.map((_, j) => reEncrypt(input[permB(j)] as Ciphertext, X, rB[j] as bigint));
  const ctx = (pos: number): ShareCtx => ({ rootId: 'root', deckId, pos });
  // Hands: positions 0–1 seat 0, 2–3 seat 1, 4–5 seat 2, on either deck.
  const handOf = (pos: number): number => Math.floor(pos / 2);

  it('turns seat 0’s deal shares on deck A into its shares of its own hand on deck B', () => {
    // Seat 0 deals on A (every position not in its A-hand), as it does when it sees A first.
    const dealA0 = new Map<number, Point>();
    for (let i = 0; i < N; i++)
      if (handOf(i) !== 0) dealA0.set(i, makeShare(secrets[0] as bigint, A[i] as Ciphertext, ctx(i), rnd).D);
    // Seat 1 deals on B (every position not in its B-hand). Every share verifies.
    const dealB1 = new Map<number, Point>();
    for (let j = 0; j < N; j++) {
      if (handOf(j) === 1) continue;
      const s = makeShare(secrets[1] as bigint, B[j] as Ciphertext, ctx(j), rnd);
      expect(verifyShare(keys[1] as Point, B[j] as Ciphertext, s, ctx(j))).toBe(true);
      dealB1.set(j, s.D);
    }
    // Seat 0 never shares positions 0 and 1 of deck B: they are its own B-hand. Seat 2 reads them anyway.
    for (const j of [0, 1]) {
      const i = permB(j);
      expect(handOf(i)).not.toBe(0); // seat 0 shared position i on deck A
      const delta = ((rA[i] as bigint) - (rB[j] as bigint) + q) % q;
      // A[i].a = B[j].a + delta·G, so x_0·A[i].a = x_0·B[j].a + delta·X_0.
      const translated = (dealA0.get(i) as Point).subtract((keys[0] as Point).multiply(delta));
      expect(translated.equals((B[j] as Ciphertext).a.multiply(secrets[0] as bigint))).toBe(true);
      const seen = cardOf(
        table,
        combine(B[j] as Ciphertext, [
          translated,
          dealB1.get(j) as Point,
          ownShare(secrets[2] as bigint, B[j] as Ciphertext),
        ]),
      );
      expect(seen).toBe(cardOf(table, decryptWithSecrets(B[j] as Ciphertext, secrets)));
      expect(seen).not.toBe(null);
    }
  });
});
