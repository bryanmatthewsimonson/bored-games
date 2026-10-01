import { readFileSync } from 'node:fs';
import { canonicalJson } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { generateVectors } from '../scripts/vectors.ts';
import {
  type Ciphertext,
  cardOf,
  cardPoint,
  cardTable,
  decodeDeck,
  decodePoint,
  decodePok,
  decodeScalar,
  decodeShare,
  decodeShuffleProof,
  decryptPosition,
  decryptWithSecrets,
  encodePoint,
  G,
  generators,
  hs,
  initialDeck,
  jointKey,
  type Point,
  type Share,
  verifyPok,
  verifyShare,
  verifyShuffle,
} from '../src/index.ts';
import { shuffleTranscript } from '../src/shuffle.ts';

const FILE = new URL('./vectors/v1.json', import.meta.url);

/** The file's shape. Values are left as `unknown` where the src decoders do the parsing. */
interface Vectors {
  version: number;
  seed: string;
  rootId: string;
  tableAddress: string;
  deckId: string;
  size: number;
  generators: { h: string; hs: string[] };
  cardPoints: string[];
  seats: {
    seat: number;
    secret: string;
    key: string;
    npub: string;
    sessionPub: string;
    pokCtx: string[];
    pok: unknown;
  }[];
  jointKey: string;
  shuffles: {
    seat: number;
    deck: unknown;
    proof: unknown;
    transcript: { d: string; u: string[]; ch: string };
  }[];
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

    // Context strings in their NOSTR text forms (PROTOCOL §3, §5; D025).
    const HEX64 = /^[0-9a-f]{64}$/;
    expect(rootId).toMatch(HEX64);
    expect(v.tableAddress).toBe(`37450:${v.seats[0]?.npub}:vectors-table`);
    for (const s of v.seats) {
      expect(s.npub).toMatch(HEX64);
      expect(s.sessionPub).toMatch(HEX64);
      expect(s.pokCtx).toEqual([v.tableAddress, s.npub, s.sessionPub]);
    }

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
      const ctx = { rootId, seat: k, deckId };
      expect(verifyShuffle(deck, out, X, proof, ctx), `shuffle ${k}`).toBe(true);
      // The listed transcript is the verifier's, and also what PROTOCOL §5.3 writes, hashed independently.
      const listed = {
        d: decodeScalar(step.transcript.d),
        u: step.transcript.u.map(decodeScalar),
        ch: decodeScalar(step.transcript.ch),
      };
      expect(shuffleTranscript(deck, out, X, proof, ctx), `transcript ${k}`).toEqual(listed);
      const ab = (cts: readonly Ciphertext[]) => cts.flatMap((e) => [e.a, e.b]);
      const d = hs('shuffle-ctx', rootId, k, deckId, X, ...ab(deck), ...ab(out));
      const { c, cHat, t } = proof;
      expect(listed.d, `d ${k}`).toBe(d);
      expect(listed.u, `u ${k}`).toEqual(c.map((_, i) => hs('shuffle-u', d, ...c, i + 1)));
      expect(listed.ch, `ch ${k}`).toBe(
        hs('shuffle-c', d, X, ...c, ...cHat, t.t1, t.t2, t.t3, t.t4[0], t.t4[1], ...t.tHat),
      );
      deck = out;
    }

    // One share per (seat, position); together they decrypt every position to the listed card.
    expect(v.shares).toHaveLength(n * size);
    const bySeat = Array.from({ length: size }, () => new Map<number, Share>());
    for (const entry of v.shares) {
      const { pos, share } = decodeShare(entry.share);
      const ctx = { rootId, deckId, pos };
      expect(verifyShare(keys[entry.seat] as Point, deck[pos] as Ciphertext, share, ctx)).toBe(true);
      const at = bySeat[pos] as Map<number, Share>;
      expect(at.has(entry.seat), `one share per seat at ${pos}`).toBe(false);
      at.set(entry.seat, share);
    }
    const table = cardTable(deckId, size);
    const viaShares = deck.map((ct, pos) =>
      decryptPosition(ct, { rootId, deckId, pos }, keys, bySeat[pos] as Map<number, Share>, table),
    );
    const viaSecrets = deck.map((ct) => cardOf(table, decryptWithSecrets(ct, secrets)));
    expect(viaShares).toEqual(v.cards);
    expect(viaSecrets).toEqual(v.cards);
    expect([...v.cards].sort((a, b) => a - b)).toEqual(Array.from({ length: size }, (_, m) => m));
  });
});
