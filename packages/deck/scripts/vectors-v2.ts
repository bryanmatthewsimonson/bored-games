/**
 * pnpm --filter @bored-games/deck vectors
 *
 * Writes the protocol v2 deck vectors (PROTOCOL-v2 §12.2 items 1 and 2), each from its own fixed seed:
 * - `test/vectors/roll-v2.json`: move-bound roll points `H(M, n)` (§6.2) for two requesting moves on one prev and
 *   n = 0, 1, 2; per seat of a 3-seat game the secret, the contribution `D`, its proof, the nonce and the DLEQ
 *   transcript; the seed, and the faces for (2, 6) and (3, 4).
 * - `test/vectors/partitioned-v1.json`: a 2-seat, 2-group (5 + 3) partitioned shuffle (PROTOCOL §5.5), with every
 *   step's group, seat, domain, input slice, output, proof and transcript, the full packet after each step, one
 *   share per seat and position, and the decrypted cards. It is a v1 feature (a v1 gap, D060), so conforming v1
 *   clients must reproduce it too.
 *
 * Secrets and nonces are included on purpose: these are test vectors. Shares are made with the internal unhedged
 * hook (`makeShareWithNonce`, the nonce drawn as `randomScalar(rnd)`) so that the nonce can be listed and the files
 * stay byte-stable; production shares hedge the nonce (`makeShare`), and verification is the same for both.
 * `test/roll-v2.test.ts` and `test/partitioned-vectors.test.ts` check that regenerating gives the files byte for
 * byte, and verify every value in them from the JSON alone.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { faces } from '@bored-games/dice';
import { canonicalJson } from '@bored-games/game-kit';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { makeShareWithNonce } from '../src/dleq.ts';
import { msm, q } from '../src/group.ts';
import {
  type Ciphertext,
  cardPoint,
  cardTable,
  decryptPosition,
  encodePoint,
  encodeScalar,
  encodeShare,
  encodeShuffleProof,
  G,
  initialDeck,
  jointKey,
  moveRollCiphertext,
  moveRollPoint,
  type Point,
  proveShuffle,
  ROLL_DECK,
  randomScalar,
  rollSeed,
  type Share,
  shuffleDeck,
} from '../src/index.ts';
import { shuffleTranscript } from '../src/shuffle.ts';
import { seededRandom } from '../test/util.ts';

/** A deterministic stand-in for a NOSTR event id: 64 lowercase hex characters from a label (D025 text forms). */
const fakeHex = (seed: string, label: string): string => bytesToHex(sha256(utf8ToBytes(`${seed}/${label}`)));

/** The DLEQ transcript of a share as a verifier recomputes it: `T1 = s·G − c·X`, `T2 = s·a − c·D` (PROTOCOL §5.4). */
function dleqTranscript(X: Point, a: Point, share: Share): { T1: string; T2: string } {
  const negC = (q - share.c) % q;
  return {
    T1: encodePoint(msm([G, X], [share.s, negC])),
    T2: encodePoint(msm([a, share.D], [share.s, negC])),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Vector 1: roll points

export const ROLL_SEED = 'bored-games/deck/roll/v2';
const ROLL_SEATS = 3;
const ROLL_INDICES = [0, 1, 2] as const;
/** The (count, sides) pairs faces are listed for: Bank's two six-sided dice, and one other. */
export const FACE_SHAPES = [
  [2, 6],
  [3, 4],
] as const;

/**
 * Every random draw comes from one `seededRandom(ROLL_SEED)` stream: each seat's secret, then for each requesting
 * move, each roll index and each seat in order, that contribution's nonce.
 */
export function generateRollVectors(): unknown {
  const rnd = seededRandom(ROLL_SEED);
  const rootId = fakeHex(ROLL_SEED, 'root');
  const prev = fakeHex(ROLL_SEED, 'prev');
  // Two requesting moves on the same prev (a fork by the requesting seat): each has its own points.
  const moveIds = [fakeHex(ROLL_SEED, 'move/a'), fakeHex(ROLL_SEED, 'move/b')];

  const secrets = Array.from({ length: ROLL_SEATS }, () => randomScalar(rnd));
  const keys = secrets.map((x) => G.multiply(x));
  const seats = secrets.map((x, k) => ({
    seat: k,
    secret: encodeScalar(x),
    key: encodePoint(keys[k] as Point),
  }));

  const moves = moveIds.map((moveId) => ({
    move: moveId,
    prev,
    rolls: ROLL_INDICES.map((n) => {
      const H = moveRollPoint(rootId, moveId, n);
      const ct: Ciphertext = moveRollCiphertext(rootId, moveId, n);
      const shares: Share[] = [];
      const contributions = secrets.map((x, k) => {
        const w = randomScalar(rnd);
        const share = makeShareWithNonce(x, ct, { rootId, deckId: ROLL_DECK, pos: n }, w);
        shares.push(share);
        return {
          seat: k,
          nonce: encodeScalar(w),
          D: encodePoint(share.D),
          share: encodeShare({ pos: n, share }),
          transcript: dleqTranscript(keys[k] as Point, H, share),
        };
      });
      const seed = rollSeed(shares);
      return {
        n,
        label: `roll:${rootId}:${moveId}:${n}`,
        point: encodePoint(H),
        contributions,
        seed: bytesToHex(seed),
        faces: FACE_SHAPES.map(([count, sides]) => ({ count, sides, faces: faces(seed, count, sides) })),
      };
    }),
  }));

  return {
    version: 2,
    seed: ROLL_SEED,
    rootId,
    deckId: ROLL_DECK,
    seats,
    moves,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Vector 2: a partitioned shuffle

export const PARTITION_SEED = 'bored-games/deck/partitioned/v1';
const PARTITION_SEATS = 2;
export const PARTITION_DECK = 'vectors';
export const PARTITION_GROUPS = [
  { id: 'large', size: 5 },
  { id: 'small', size: 3 },
] as const;

/**
 * One packet entry: a position still holding its initial trivial encryption `(O, M_m)` is written as the card
 * index `m` (the identity `a` has no wire encoding), any other as the wire pair `[a, b]`.
 */
type Entry = number | [string, string];

function encodeEntries(cts: readonly Ciphertext[], deckId: string): Entry[] {
  return cts.map((ct) => {
    if (ct.a.is0()) {
      for (let m = 0; ; m++) {
        if (cardPoint(deckId, m).equals(ct.b)) return m;
        if (m > 1024) throw new Error('vectors-v2: an identity a over a non-card');
      }
    }
    return [encodePoint(ct.a), encodePoint(ct.b)];
  });
}

/**
 * Every random draw comes from one `seededRandom(PARTITION_SEED)` stream: each seat's secret, then each shuffle
 * step (permutation and randomizers, then its proof), then each share seat by seat, position by position.
 */
export function generatePartitionedVectors(): unknown {
  const rnd = seededRandom(PARTITION_SEED);
  const rootId = fakeHex(PARTITION_SEED, 'root');
  const size = PARTITION_GROUPS.reduce((sum, g) => sum + g.size, 0);

  const secrets = Array.from({ length: PARTITION_SEATS }, () => randomScalar(rnd));
  const keys = secrets.map((x) => G.multiply(x));
  const X = jointKey(keys);

  let offset = 0;
  const groups = PARTITION_GROUPS.map((g) => {
    const out = { id: g.id, size: g.size, offset, domain: `${PARTITION_DECK}/${g.id}` };
    offset += g.size;
    return out;
  });

  const G_ = groups.length;
  const steps = [];
  let packet: Ciphertext[] = initialDeck(PARTITION_DECK, size);
  for (let s = 0; s < G_ * PARTITION_SEATS; s++) {
    const group = groups[s % G_] as (typeof groups)[number];
    const seat = Math.floor(s / G_);
    const input = packet.slice(group.offset, group.offset + group.size);
    const { out, psi, rPrime } = shuffleDeck(input, X, rnd);
    const ctx = { rootId, seat, deckId: group.domain };
    const proof = proveShuffle(input, out, X, psi, rPrime, ctx, rnd);
    const tr = shuffleTranscript(input, out, X, proof, ctx);
    packet = [...packet.slice(0, group.offset), ...out, ...packet.slice(group.offset + group.size)];
    steps.push({
      step: s,
      move: s + 1,
      group: group.id,
      seat,
      domain: group.domain,
      offset: group.offset,
      size: group.size,
      input: encodeEntries(input, PARTITION_DECK),
      output: encodeEntries(out, PARTITION_DECK),
      proof: encodeShuffleProof(proof),
      transcript: { d: encodeScalar(tr.d), u: tr.u.map(encodeScalar), ch: encodeScalar(tr.ch) },
      packet: encodeEntries(packet, PARTITION_DECK),
    });
  }

  // Shares and decryption use global packet positions and the deck id (not a group domain), PROTOCOL §5.5.
  const shares = [];
  const bySeat: Share[][] = Array.from({ length: size }, () => []);
  for (let k = 0; k < PARTITION_SEATS; k++) {
    for (let pos = 0; pos < size; pos++) {
      const share = makeShareWithNonce(
        secrets[k] as bigint,
        packet[pos] as Ciphertext,
        { rootId, deckId: PARTITION_DECK, pos },
        randomScalar(rnd),
      );
      shares.push({ seat: k, share: encodeShare({ pos, share }) });
      (bySeat[pos] as Share[])[k] = share;
    }
  }
  const table = cardTable(PARTITION_DECK, size);
  const cards = packet.map((ct, pos) => {
    const m = decryptPosition(
      ct,
      { rootId, deckId: PARTITION_DECK, pos },
      keys,
      bySeat[pos] as Share[],
      table,
    );
    if (m === null) throw new Error(`vectors-v2: position ${pos} does not decrypt to a card`);
    return m;
  });

  return {
    version: 1,
    seed: PARTITION_SEED,
    rootId,
    deckId: PARTITION_DECK,
    size,
    groups,
    cardPoints: Array.from({ length: size }, (_, m) => encodePoint(cardPoint(PARTITION_DECK, m))),
    seats: secrets.map((x, k) => ({ seat: k, secret: encodeScalar(x), key: encodePoint(keys[k] as Point) })),
    jointKey: encodePoint(X),
    steps,
    shares,
    cards,
  };
}

function main(): void {
  const dir = new URL('../test/vectors/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const [name, gen] of [
    ['roll-v2.json', generateRollVectors],
    ['partitioned-v1.json', generatePartitionedVectors],
  ] as const) {
    const file = new URL(name, dir);
    const text = `${canonicalJson(gen())}\n`;
    writeFileSync(file, text);
    console.info(`wrote ${fileURLToPath(file)} (${text.length} bytes)`);
  }
}

// `import.meta.url` is the real path; argv[1] may go through a symlink (a symlinked checkout, macOS /tmp).
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main();
