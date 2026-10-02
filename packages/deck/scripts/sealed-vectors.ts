/**
 * pnpm --filter @bored-games/deck vectors
 *
 * Writes test/vectors/sealed-v1.json: sealed shares and transferable openings (docs/proposals/prompt-reveal.md
 * §7, round 2: hedged nonces, openings bound to the ciphertext and the sealed proof) on a 3-seat, 5-card deck from a fixed seed, wire-encoded. Secrets are included on purpose: these are test
 * vectors. `test/sealed-vectors.test.ts` checks that regenerating gives the file byte for byte, and verifies every
 * proof and every decryption from the JSON alone. Reference only: the session does not use sealed shares yet.
 *
 * Two flows, each on one deck position:
 * - `viewers`: position 2 is seat 0's card, visible to every seat but its owner (Hanabi). Seat 0 publishes an
 *   ordinary share; seats 1 and 2 seal theirs to each other; each viewer opens, proves its opening and decrypts.
 * - `show`: position 3 is seat 0's card; seats 1 and 2 have published ordinary shares; seat 0 seals its own share
 *   to seat 1 ("show your card to one player"), and seat 1 decrypts.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '@bored-games/game-kit';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  type Ciphertext,
  cardOf,
  cardTable,
  combine,
  encodeDeck,
  encodePoint,
  encodeScalar,
  encodeSealedOpening,
  encodeSealedShare,
  encodeShare,
  G,
  initialDeck,
  jointKey,
  makeShare,
  openAndVerify,
  ownShare,
  type Point,
  proveOpening,
  randomScalar,
  sealShare,
  shuffleDeck,
} from '../src/index.ts';
import { seededRandom } from '../test/util.ts';

const SEED = 'bored-games/deck/sealed/v1';
const SEATS = 3;
const SIZE = 5;
const DECK_ID = 'sealed-vectors';
const ROOT_ID = bytesToHex(sha256(utf8ToBytes(`${SEED}/root`)));

/**
 * Every random draw comes from one `seededRandom(SEED)` stream, in this order: the seats' secrets, the three
 * shuffles (no proofs: `v1.json` covers those), then the flows in the order they are listed.
 */
export function generateSealedVectors(): unknown {
  const rnd = seededRandom(SEED);
  const secrets = Array.from({ length: SEATS }, () => randomScalar(rnd));
  const keys = secrets.map((x) => G.multiply(x));
  const X = jointKey(keys);
  let deck: Ciphertext[] = initialDeck(DECK_ID, SIZE);
  for (let k = 0; k < SEATS; k++) deck = shuffleDeck(deck, X, rnd).out;
  const table = cardTable(DECK_ID, SIZE);
  const sk = (k: number): bigint => secrets[k] as bigint;
  const pk = (k: number): Point => keys[k] as Point;
  const ctxOf = (pos: number) => ({ rootId: ROOT_ID, deckId: DECK_ID, pos });

  // viewers: position 2, owner seat 0, viewers 1 and 2.
  const vp = 2;
  const vct = deck[vp] as Ciphertext;
  const ownerShare = makeShare(sk(0), vct, ctxOf(vp), rnd);
  const sealedV = [
    { from: 1, to: 2 },
    { from: 2, to: 1 },
  ].map(({ from, to }) => {
    const sealed = sealShare(sk(from), vct, pk(to), ctxOf(vp), rnd);
    const opened = openAndVerify(sk(to), pk(from), vct, sealed, ctxOf(vp)) as Point;
    const opening = proveOpening(sk(to), pk(from), vct, sealed, ctxOf(vp), rnd);
    return { from, to, sealed, opened, opening };
  });
  const viewerCards = [1, 2].map((v) => {
    const s = sealedV.find((x) => x.to === v);
    if (s === undefined) throw new Error('vectors: missing sealed share');
    return cardOf(table, combine(vct, [ownerShare.D, s.opened, ownShare(sk(v), vct)]));
  });

  // show: position 3, owner seat 0 shows it to seat 1, who holds seat 2's public share and its own layer.
  const sp = 3;
  const sct = deck[sp] as Ciphertext;
  const publicShares = [1, 2].map((k) => ({ seat: k, share: makeShare(sk(k), sct, ctxOf(sp), rnd) }));
  const shown = sealShare(sk(0), sct, pk(1), ctxOf(sp), rnd);
  const shownD = openAndVerify(sk(1), pk(0), sct, shown, ctxOf(sp)) as Point;
  const seat2 = publicShares[1]?.share.D as Point;
  const shownCard = cardOf(table, combine(sct, [shownD, seat2, ownShare(sk(1), sct)]));

  if (sealedV.some((x) => x.opened === null) || shownD === null)
    throw new Error('vectors: a sealed share does not open');
  if (viewerCards.some((m) => m === null) || shownCard === null)
    throw new Error('vectors: a flow does not decrypt to a card');

  return {
    version: 1,
    seed: SEED,
    rootId: ROOT_ID,
    deckId: DECK_ID,
    size: SIZE,
    seats: secrets.map((x, seat) => ({ seat, secret: encodeScalar(x), key: encodePoint(G.multiply(x)) })),
    jointKey: encodePoint(X),
    deck: encodeDeck(deck),
    viewers: {
      pos: vp,
      owner: 0,
      ownerShare: encodeShare({ pos: vp, share: ownerShare }),
      sealed: sealedV.map((s) => ({
        from: s.from,
        share: encodeSealedShare({ pos: vp, to: s.to, sealed: s.sealed }),
        opened: encodePoint(s.opened),
        opening: encodeSealedOpening({ pos: vp, from: s.from, opening: s.opening }),
      })),
      cards: viewerCards,
    },
    show: {
      pos: sp,
      owner: 0,
      publicShares: publicShares.map((s) => ({
        seat: s.seat,
        share: encodeShare({ pos: sp, share: s.share }),
      })),
      sealed: {
        from: 0,
        share: encodeSealedShare({ pos: sp, to: 1, sealed: shown }),
        opened: encodePoint(shownD),
      },
      card: shownCard,
    },
  };
}

function main(): void {
  const dir = new URL('../test/vectors/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = new URL('sealed-v1.json', dir);
  const text = `${canonicalJson(generateSealedVectors())}\n`;
  writeFileSync(file, text);
  console.info(`wrote ${fileURLToPath(file)} (${text.length} bytes)`);
}

// `import.meta.url` is the real path; argv[1] may go through a symlink (a symlinked checkout, macOS /tmp).
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main();
