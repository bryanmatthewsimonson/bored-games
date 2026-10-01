import { readFileSync } from 'node:fs';
import { canonicalJson } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { generateVectors } from '../scripts/vectors.ts';
import {
  type Ciphertext,
  cardOf,
  cardPoint,
  cardTable,
  combine,
  decodeDeck,
  decodePoint,
  decodePok,
  decodeScalar,
  decodeShare,
  decodeShuffleProof,
  decryptWithSecrets,
  encodePoint,
  G,
  generators,
  initialDeck,
  jointKey,
  type Point,
  verifyPok,
  verifyShare,
  verifyShuffle,
} from '../src/index.ts';

const FILE = new URL('./vectors/v1.json', import.meta.url);

/** The file's shape. Values are left as `unknown` where the src decoders do the parsing. */
interface Vectors {
  version: number;
  seed: string;
  rootId: string;
  deckId: string;
  size: number;
  generators: { h: string; hs: string[] };
  cardPoints: string[];
  seats: { seat: number; secret: string; key: string; pokCtx: string[]; pok: unknown }[];
  jointKey: string;
  shuffles: { seat: number; deck: unknown; proof: unknown }[];
  shares: { seat: number; share: unknown }[];
  cards: number[];
}

describe('test vectors v1', () => {
  it('regenerating gives the file byte for byte', () => {
    const text = readFileSync(FILE, 'utf8');
    expect(`${canonicalJson(generateVectors())}\n`).toBe(text);
  });

  it('every value and proof in the file verifies from the JSON alone', () => {
    const v = JSON.parse(readFileSync(FILE, 'utf8')) as Vectors;
    expect(v.version).toBe(1);
    const { rootId, deckId, size } = v;
    const n = v.seats.length;

    // Generators and card points (H2C).
    const gens = generators(size);
    expect(v.generators.h).toBe(encodePoint(gens.h));
    expect(v.generators.hs).toEqual(gens.hs.map(encodePoint));
    expect(v.cardPoints).toEqual(Array.from({ length: size }, (_, m) => encodePoint(cardPoint(deckId, m))));

    // Keys: secret ↔ key, and every proof of knowledge.
    const keys: Point[] = [];
    const secrets: bigint[] = [];
    for (const [k, s] of v.seats.entries()) {
      expect(s.seat).toBe(k);
      const x = decodeScalar(s.secret);
      const X_k = decodePoint(s.key);
      expect(G.multiply(x).equals(X_k)).toBe(true);
      expect(verifyPok(X_k, decodePok(s.pok), s.pokCtx), `pok ${k}`).toBe(true);
      keys.push(X_k);
      secrets.push(x);
    }
    const X = decodePoint(v.jointKey);
    expect(jointKey(keys).equals(X)).toBe(true);

    // Shuffle chain from the (never transmitted) initial deck.
    expect(v.shuffles).toHaveLength(n);
    let deck: Ciphertext[] = initialDeck(deckId, size);
    for (const [k, step] of v.shuffles.entries()) {
      expect(step.seat).toBe(k);
      const out = decodeDeck(step.deck, size);
      const proof = decodeShuffleProof(step.proof, size);
      expect(verifyShuffle(deck, out, X, proof, { rootId, seat: k, deckId }), `shuffle ${k}`).toBe(true);
      deck = out;
    }

    // One share per (seat, position); together they decrypt every position to the listed card.
    expect(v.shares).toHaveLength(n * size);
    const Ds: Point[][] = Array.from({ length: size }, () => []);
    for (const entry of v.shares) {
      const { pos, share } = decodeShare(entry.share);
      const ctx = { rootId, deckId, pos };
      expect(verifyShare(keys[entry.seat] as Point, deck[pos] as Ciphertext, share, ctx)).toBe(true);
      Ds[pos]?.push(share.D);
    }
    const table = cardTable(deckId, size);
    const viaShares = deck.map((ct, pos) => cardOf(table, combine(ct, Ds[pos] as Point[])));
    const viaSecrets = deck.map((ct) => cardOf(table, decryptWithSecrets(ct, secrets)));
    expect(viaShares).toEqual(v.cards);
    expect(viaSecrets).toEqual(v.cards);
    expect([...v.cards].sort((a, b) => a - b)).toEqual(Array.from({ length: size }, (_, m) => m));
  });
});
