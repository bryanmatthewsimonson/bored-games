import { readFileSync } from 'node:fs';
import { canonicalJson } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { generateSealedVectors } from '../scripts/sealed-vectors.ts';
import { msm, q } from '../src/group.ts';
import {
  type Ciphertext,
  cardOf,
  cardTable,
  combine,
  decodeDeck,
  decodePoint,
  decodeScalar,
  decodeSealedOpening,
  decodeSealedShare,
  decodeShare,
  decryptWithSecrets,
  G,
  hs,
  jointKey,
  type Point,
  verifyOpening,
  verifySealedShare,
  verifyShare,
} from '../src/index.ts';

const FILE = new URL('./vectors/sealed-v1.json', import.meta.url);

interface SealedEntry {
  from: number;
  share: unknown;
  opened: string;
  opening?: unknown;
}

interface Vectors {
  version: number;
  rootId: string;
  deckId: string;
  size: number;
  seats: { seat: number; secret: string; key: string }[];
  jointKey: string;
  deck: unknown;
  viewers: { pos: number; owner: number; ownerShare: unknown; sealed: SealedEntry[]; cards: number[] };
  show: {
    pos: number;
    owner: number;
    publicShares: { seat: number; share: unknown }[];
    sealed: SealedEntry;
    card: number;
  };
}

describe('sealed-share vectors v1', () => {
  it('regenerating gives the file byte for byte', () => {
    expect(`${canonicalJson(generateSealedVectors())}\n`).toBe(readFileSync(FILE, 'utf8'));
  });

  it('every proof, opening and decryption verifies from the JSON alone', () => {
    const v = JSON.parse(readFileSync(FILE, 'utf8')) as Vectors;
    expect(v.version).toBe(1);
    const { rootId, deckId, size } = v;
    const keys: Point[] = [];
    const secrets: bigint[] = [];
    for (const [k, s] of v.seats.entries()) {
      expect(s.seat).toBe(k);
      const x = decodeScalar(s.secret);
      const K = decodePoint(s.key);
      expect(G.multiply(x).equals(K)).toBe(true);
      keys.push(K);
      secrets.push(x);
    }
    expect(jointKey(keys).equals(decodePoint(v.jointKey))).toBe(true);
    const deck = decodeDeck(v.deck, size);
    const table = cardTable(deckId, size);
    const key = (k: number) => keys[k] as Point;
    const ctxOf = (pos: number) => ({ rootId, deckId, pos });

    /** Check a sealed entry at `ct`, recompute its challenge independently, and return the opened share. */
    const check = (entry: SealedEntry, ct: Ciphertext, pos: number): { to: number; D: Point } => {
      const { pos: p, to, sealed } = decodeSealedShare(entry.share);
      expect(p).toBe(pos);
      expect(verifySealedShare(key(entry.from), ct, key(to), sealed, ctxOf(pos))).toBe(true);
      // PROTOCOL-style recomputation: T1 = s1·G − c·X_k, T2 = s2·G − c·A, T3 = s1·R + s2·X_T − c·B.
      const negC = (q - sealed.c) % q;
      const T1 = msm([G, key(entry.from)], [sealed.s1, negC]);
      const T2 = msm([G, sealed.A], [sealed.s2, negC]);
      const T3 = msm([ct.a, key(to), sealed.B], [sealed.s1, sealed.s2, negC]);
      expect(
        hs(
          'sealed',
          rootId,
          deckId,
          pos,
          key(entry.from),
          key(to),
          ct.a,
          ct.b,
          sealed.A,
          sealed.B,
          T1,
          T2,
          T3,
        ),
      ).toBe(sealed.c);
      const D = decodePoint(entry.opened);
      // The opened share is the sender's decryption layer, and the recipient's secret opens it.
      expect(D.equals(ct.a.multiply(secrets[entry.from] as bigint))).toBe(true);
      expect(sealed.B.subtract(sealed.A.multiply(secrets[to] as bigint)).equals(D)).toBe(true);
      if (entry.opening !== undefined) {
        const o = decodeSealedOpening(entry.opening);
        expect(o.pos).toBe(pos);
        expect(o.from).toBe(entry.from);
        expect(verifyOpening(key(entry.from), key(to), sealed, o.opening, ctxOf(pos))?.equals(D)).toBe(true);
      }
      return { to, D };
    };

    // viewers: the owner's public share plus each viewer's opened sealed share and own layer.
    const vct = deck[v.viewers.pos] as Ciphertext;
    const owner = decodeShare(v.viewers.ownerShare);
    expect(verifyShare(key(v.viewers.owner), vct, owner.share, ctxOf(v.viewers.pos))).toBe(true);
    const viewerCards = v.viewers.sealed.map((e) => {
      const { to, D } = check(e, vct, v.viewers.pos);
      return cardOf(table, combine(vct, [owner.share.D, D, vct.a.multiply(secrets[to] as bigint)]));
    });
    const truth = cardOf(table, decryptWithSecrets(vct, secrets));
    expect(truth).not.toBe(null);
    expect(viewerCards).toEqual([truth, truth]);
    expect(v.viewers.cards).toEqual([truth, truth]);

    // show: seat 0 shows its card to seat 1.
    const sct = deck[v.show.pos] as Ciphertext;
    const pub = v.show.publicShares.map((e) => {
      const { share } = decodeShare(e.share);
      expect(verifyShare(key(e.seat), sct, share, ctxOf(v.show.pos))).toBe(true);
      return { seat: e.seat, D: share.D };
    });
    const { to, D } = check(v.show.sealed, sct, v.show.pos);
    const others = pub.filter((p) => p.seat !== to).map((p) => p.D);
    const card = cardOf(table, combine(sct, [D, ...others, sct.a.multiply(secrets[to] as bigint)]));
    expect(card).toBe(v.show.card);
    expect(card).toBe(cardOf(table, decryptWithSecrets(sct, secrets)));
  });
});
