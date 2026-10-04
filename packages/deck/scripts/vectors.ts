/**
 * pnpm --filter @bored-games/deck vectors
 *
 * Writes test/vectors/v1.json: a complete 3-seat, 8-card deal from a fixed seed, wire-encoded (PROTOCOL §5.3),
 * with each shuffle step's transcript `{d, u, ch}` and context strings in their NOSTR hex forms (D025).
 * Secrets are included on purpose: these are test vectors. `test/vectors.test.ts` checks that regenerating
 * gives the file byte for byte, and verifies every proof in it from the JSON alone.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '@bored-games/game-kit';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { makeShareWithNonce } from '../src/dleq.ts';
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
  provePok,
  proveShuffle,
  randomScalar,
  type Share,
  shuffleDeck,
} from '../src/index.ts';
import { shuffleTranscript } from '../src/shuffle.ts';
import { seededRandom } from '../test/util.ts';

const SEED = 'bored-games/deck/v1';
const SEATS = 3;
const SIZE = 8;
const DECK_ID = 'vectors';

/**
 * A deterministic stand-in for a NOSTR id or x-only pubkey: 64 lowercase hex characters derived from the seed.
 * These are the textual forms PROTOCOL §3 and §5 hash (D025); they need not be real event ids or curve points.
 */
const fakeHex = (label: string): string => bytesToHex(sha256(utf8ToBytes(`${SEED}/${label}`)));

const ROOT_ID = fakeHex('root');
const NPUBS = Array.from({ length: SEATS }, (_, k) => fakeHex(`npub/${k}`));
const SESSIONS = Array.from({ length: SEATS }, (_, k) => fakeHex(`session/${k}`));
/** The NIP-01 address of the Table event: `37450:<creator pubkey hex>:<d tag>`; seat 0 is the creator. */
const TABLE = `37450:${NPUBS[0] as string}:vectors-table`;

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
    const npub = NPUBS[k] as string;
    const sessionPub = SESSIONS[k] as string;
    const pokCtx = [TABLE, npub, sessionPub];
    const pok = provePok(x, pokCtx, rnd);
    secrets.push(x);
    seats.push({
      seat: k,
      secret: encodeScalar(x),
      key: encodePoint(G.multiply(x)),
      npub,
      sessionPub,
      pokCtx,
      pok: encodePok(pok),
    });
  }
  const X = jointKey(secrets.map((x) => G.multiply(x)));

  const shuffles = [];
  let deck: Ciphertext[] = initialDeck(DECK_ID, SIZE);
  for (let k = 0; k < SEATS; k++) {
    const { out, psi, rPrime } = shuffleDeck(deck, X, rnd);
    const ctx = { rootId: ROOT_ID, seat: k, deckId: DECK_ID };
    const proof = proveShuffle(deck, out, X, psi, rPrime, ctx, rnd);
    // The verifier's Fiat–Shamir values, so a second implementation can check each hash on its own.
    const tr = shuffleTranscript(deck, out, X, proof, ctx);
    shuffles.push({
      seat: k,
      deck: encodeDeck(out),
      proof: encodeShuffleProof(proof),
      transcript: { d: encodeScalar(tr.d), u: tr.u.map(encodeScalar), ch: encodeScalar(tr.ch) },
    });
    deck = out;
  }

  const shares = [];
  const bySeat: Share[][] = Array.from({ length: SIZE }, () => []);
  for (let k = 0; k < SEATS; k++) {
    for (let pos = 0; pos < SIZE; pos++) {
      // The unhedged hook with `w = randomScalar(rnd)`: the draws `makeShare` made before its nonces were
      // hedged (T4), so this file still reproduces byte for byte. Production shares use `makeShare`.
      const share = makeShareWithNonce(
        secrets[k] as bigint,
        deck[pos] as Ciphertext,
        { rootId: ROOT_ID, deckId: DECK_ID, pos },
        randomScalar(rnd),
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
    tableAddress: TABLE,
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

// `import.meta.url` is the real path; argv[1] may go through a symlink (a symlinked checkout, macOS /tmp).
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main();
