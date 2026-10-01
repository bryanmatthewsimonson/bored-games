/**
 * pnpm --filter @bored-games/deck vectors
 *
 * Writes test/vectors/v1.json: a complete 3-seat, 8-card deal from a fixed seed, wire-encoded (PROTOCOL §5.3).
 * Secrets are included on purpose: these are test vectors. `test/vectors.test.ts` checks that regenerating
 * gives the file byte for byte, and verifies every proof in it from the JSON alone.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '@bored-games/game-kit';
import {
  type Ciphertext,
  cardPoint,
  cardTable,
  decryptPosition,
  encodeDeck,
  encodePoint,
  encodePok,
  encodeScalar,
  encodeShare,
  encodeShuffleProof,
  G,
  generators,
  initialDeck,
  jointKey,
  makeShare,
  provePok,
  proveShuffle,
  randomScalar,
  type Share,
  shuffleDeck,
} from '../src/index.ts';
import { seededRandom } from '../test/util.ts';

const SEED = 'bored-games/deck/v1';
const SEATS = 3;
const SIZE = 8;
const ROOT_ID = 'vectors-root-v1';
const DECK_ID = 'vectors';
const TABLE = '37450:vectors-table-author:vectors-table';

/**
 * Every random draw comes from one `seededRandom(SEED)` stream, in this order: each seat's key and proof of
 * knowledge, each shuffle step (permutation and randomizers, then its proof), then the shares seat by seat,
 * position by position.
 */
export function generateVectors(): unknown {
  const rnd = seededRandom(SEED);

  const seats = [];
  const secrets: bigint[] = [];
  for (let k = 0; k < SEATS; k++) {
    const x = randomScalar(rnd);
    const pokCtx = [TABLE, `npub-vectors-seat-${k}`, `session-vectors-seat-${k}`];
    const pok = provePok(x, pokCtx, rnd);
    secrets.push(x);
    seats.push({
      seat: k,
      secret: encodeScalar(x),
      key: encodePoint(G.multiply(x)),
      pokCtx,
      pok: encodePok(pok),
    });
  }
  const X = jointKey(secrets.map((x) => G.multiply(x)));

  const shuffles = [];
  let deck: Ciphertext[] = initialDeck(DECK_ID, SIZE);
  for (let k = 0; k < SEATS; k++) {
    const { out, psi, rPrime } = shuffleDeck(deck, X, rnd);
    const proof = proveShuffle(deck, out, X, psi, rPrime, { rootId: ROOT_ID, seat: k, deckId: DECK_ID }, rnd);
    shuffles.push({ seat: k, deck: encodeDeck(out), proof: encodeShuffleProof(proof) });
    deck = out;
  }

  const shares = [];
  const bySeat: Share[][] = Array.from({ length: SIZE }, () => []);
  for (let k = 0; k < SEATS; k++) {
    for (let pos = 0; pos < SIZE; pos++) {
      const share = makeShare(
        secrets[k] as bigint,
        deck[pos] as Ciphertext,
        { rootId: ROOT_ID, deckId: DECK_ID, pos },
        rnd,
      );
      shares.push({ seat: k, share: encodeShare({ pos, share }) });
      (bySeat[pos] as Share[])[k] = share;
    }
  }

  const table = cardTable(DECK_ID, SIZE);
  const keys = secrets.map((x) => G.multiply(x));
  const cards = deck.map((ct, pos) => {
    const ctx = { rootId: ROOT_ID, deckId: DECK_ID, pos };
    const m = decryptPosition(ct, ctx, keys, bySeat[pos] as Share[], table);
    if (m === null) throw new Error(`vectors: position ${pos} does not decrypt to a card`);
    return m;
  });

  const gens = generators(SIZE);
  return {
    version: 1,
    seed: SEED,
    rootId: ROOT_ID,
    deckId: DECK_ID,
    size: SIZE,
    generators: { h: encodePoint(gens.h), hs: gens.hs.map(encodePoint) },
    cardPoints: Array.from({ length: SIZE }, (_, m) => encodePoint(cardPoint(DECK_ID, m))),
    seats,
    jointKey: encodePoint(X),
    shuffles,
    shares,
    cards,
  };
}

function main(): void {
  const dir = new URL('../test/vectors/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = new URL('v1.json', dir);
  const text = `${canonicalJson(generateVectors())}\n`;
  writeFileSync(file, text);
  console.info(`wrote ${fileURLToPath(file)} (${text.length} bytes)`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main();
