import { canonicalJson } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import {
  type Ciphertext,
  cardOf,
  cardTable,
  combine,
  decodeDeck,
  decodePoint,
  decodePok,
  decodeScalar,
  decodeShare,
  decodeShuffleProof,
  decryptPosition,
  decryptWithSecrets,
  encodeDeck,
  encodePoint,
  encodePok,
  encodeScalar,
  encodeShare,
  encodeShuffleProof,
  G,
  initialDeck,
  jointKey,
  makeShare,
  ownShare,
  type Point,
  provePok,
  proveShuffle,
  randomScalar,
  type Share,
  type ShuffleCtx,
  shuffleDeck,
  verifyPok,
  verifyShare,
  verifyShuffle,
} from '../src/index.ts';
import { seededRandom } from './util.ts';

/*
 * Review focus 5: a whole multi-seat deal, with every step going through the wire codecs. Positions follow
 * Chain Reaction (D022): positions 0..S−1 are the public setup tiles, one per seat, then 6 consecutive
 * positions per seat in seat order.
 */

const SIZE = 108;
const HAND = 6;
const DECK_ID = 'tiles';
const ROOT = 'root-flow';
const TABLE = '37450:table-author-pubkey:flow-table';

/** What an honest peer sends: canonical JSON, parsed back on the other side. */
const overTheWire = (v: unknown): unknown => JSON.parse(canonicalJson(v)) as unknown;

/** The seat that privately owns `pos`, or null for a public setup position. */
function ownerOf(pos: number, seats: number): number | null {
  if (pos < seats) return null;
  const k = Math.floor((pos - seats) / HAND);
  return k < seats ? k : null;
}

function runFlow(seats: number, seed: string): void {
  const rnd = seededRandom(seed);
  const table = cardTable(DECK_ID, SIZE);

  // 1. Each seat makes its deck key and a proof of knowledge; every proof verifies from its wire form.
  const secrets: bigint[] = [];
  const keys: Point[] = [];
  for (let k = 0; k < seats; k++) {
    const x = randomScalar(rnd);
    const ctx = [TABLE, `npub-seat-${k}`, `session-pub-${k}`];
    const pok = provePok(x, ctx, rnd);
    const msg = overTheWire({ key: encodePoint(G.multiply(x)), pok: encodePok(pok) }) as {
      key: unknown;
      pok: unknown;
    };
    const X_k = decodePoint(msg.key as string);
    expect(verifyPok(X_k, decodePok(msg.pok), ctx), `pok of seat ${k}`).toBe(true);
    // The proof is bound to its context: another seat's npub fails.
    expect(verifyPok(X_k, decodePok(msg.pok), [TABLE, `npub-seat-${k + 1}`, `session-pub-${k}`])).toBe(false);
    secrets.push(x);
    keys.push(X_k);
  }

  // 2. The joint key.
  const X = jointKey(keys);
  expect(X.is0()).toBe(false);

  // 3. Seats shuffle in order; each step is proved, sent, decoded and verified against the previous deck.
  let deck: Ciphertext[] = initialDeck(DECK_ID, SIZE);
  for (let k = 0; k < seats; k++) {
    const ctx: ShuffleCtx = { rootId: ROOT, seat: k, deckId: DECK_ID };
    const { out, psi, rPrime } = shuffleDeck(deck, X, rnd);
    const proof = proveShuffle(deck, out, X, psi, rPrime, ctx, rnd);
    const msg = overTheWire({ deck: encodeDeck(out), proof: encodeShuffleProof(proof) }) as {
      deck: unknown;
      proof: unknown;
    };
    const next = decodeDeck(msg.deck, SIZE);
    expect(verifyShuffle(deck, next, X, decodeShuffleProof(msg.proof, SIZE), ctx), `shuffle ${k}`).toBe(true);
    // The same proof claimed by another seat does not verify.
    expect(verifyShuffle(deck, next, X, decodeShuffleProof(msg.proof, SIZE), { ...ctx, seat: k + 1 })).toBe(
      false,
    );
    deck = next;
  }

  // 4. Positions: setup tiles, then 6 per seat.
  const dealt = seats + seats * HAND;
  expect(ownerOf(0, seats)).toBe(null);
  expect(ownerOf(seats, seats)).toBe(0);
  expect(ownerOf(dealt - 1, seats)).toBe(seats - 1);

  // 5. Deal: every seat shares every position not its own (setup positions included). Every share is sent,
  //    decoded and verified against the sharer's key, then kept by (position, seat).
  const shares: (Share | null)[][] = Array.from({ length: dealt }, () =>
    new Array<Share | null>(seats).fill(null),
  );
  for (let k = 0; k < seats; k++) {
    for (let pos = 0; pos < dealt; pos++) {
      if (ownerOf(pos, seats) === k) continue;
      const ct = deck[pos] as Ciphertext;
      const share = makeShare(secrets[k] as bigint, ct, { rootId: ROOT, deckId: DECK_ID, pos }, rnd);
      const back = decodeShare(overTheWire(encodeShare({ pos, share })));
      expect(back.pos).toBe(pos);
      const ctx = { rootId: ROOT, deckId: DECK_ID, pos: back.pos };
      expect(verifyShare(keys[k] as Point, ct, back.share, ctx), `share ${k}@${pos}`).toBe(true);
      // Bound to the position: the same share claimed for the next position fails.
      if (pos === 0) expect(verifyShare(keys[k] as Point, ct, back.share, { ...ctx, pos: 1 })).toBe(false);
      (shares[pos] as (Share | null)[])[k] = back.share;
    }
  }

  // 6. Each owner decrypts its private cards from the others' shares plus its own layer (`ownShare`: no proof,
  //    no randomness). Without its own layer the others' shares reveal nothing that maps to a card.
  const learned = new Map<number, number>();
  for (let pos = seats; pos < dealt; pos++) {
    const k = ownerOf(pos, seats) as number;
    const ct = deck[pos] as Ciphertext;
    const ctx = { rootId: ROOT, deckId: DECK_ID, pos };
    const bySeat = shares[pos] as (Share | null)[];
    expect(bySeat.filter((s) => s !== null)).toHaveLength(seats - 1);
    expect(bySeat[k]).toBe(null);
    const others = bySeat.filter((s): s is Share => s !== null).map((s) => s.D);
    expect(cardOf(table, combine(ct, others)), `pos ${pos} without its owner`).toBe(null);
    expect(decryptPosition(ct, ctx, keys, bySeat, table), `pos ${pos} needs its owner`).toBe(null);
    const own = { seat: k, D: ownShare(secrets[k] as bigint, ct) };
    const card = decryptPosition(ct, ctx, keys, bySeat, table, own);
    expect(card, `private card at ${pos}`).not.toBe(null);
    learned.set(pos, card as number);
  }

  // 7. Public setup positions take all S shares.
  for (let pos = 0; pos < seats; pos++) {
    const bySeat = shares[pos] as (Share | null)[];
    expect(bySeat.every((s) => s !== null)).toBe(true);
    const ctx = { rootId: ROOT, deckId: DECK_ID, pos };
    const card = decryptPosition(deck[pos] as Ciphertext, ctx, keys, bySeat, table);
    expect(card, `setup card at ${pos}`).not.toBe(null);
    learned.set(pos, card as number);
  }
  expect(new Set(learned.values()).size).toBe(dealt);

  // 8. Secret reveal (scalars over the wire), then the audit decrypts the whole final deck.
  const revealed = (overTheWire(secrets.map(encodeScalar)) as string[]).map(decodeScalar);
  for (const [k, x] of revealed.entries()) expect(G.multiply(x).equals(keys[k] as Point)).toBe(true);
  const order = deck.map((ct) => cardOf(table, decryptWithSecrets(ct, revealed)));
  expect([...order].sort((a, b) => (a as number) - (b as number))).toEqual(
    Array.from({ length: SIZE }, (_, m) => m),
  );
  for (const [pos, card] of learned) expect(order[pos], `audit agrees at ${pos}`).toBe(card);
}

describe('end-to-end deck flow', () => {
  it('3 seats: keys, shuffles, deal, private and public cards, audit', { timeout: 180_000 }, () => {
    runFlow(3, 'flow-3');
  });

  it('6 seats: keys, shuffles, deal, private and public cards, audit', { timeout: 300_000 }, () => {
    runFlow(6, 'flow-6');
  });
});
