import { readFileSync } from 'node:fs';
import { faces } from '@bored-games/dice';
import { canonicalJson } from '@bored-games/game-kit';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { FACE_SHAPES, generateRollVectors } from '../scripts/vectors-v2.ts';
import {
  decodePoint,
  decodeScalar,
  decodeShare,
  encodePoint,
  G,
  h2c,
  hs,
  makeMoveRollShare,
  moveRollCiphertext,
  moveRollPoint,
  type Point,
  q,
  ROLL_DECK,
  rollPoint,
  rollSeed,
  verifyMoveRollShare,
  verifyRollShare,
  verifyShare,
} from '../src/index.ts';
import { seededRandom } from './util.ts';

const FILE = new URL('./vectors/roll-v2.json', import.meta.url);

interface Contribution {
  seat: number;
  nonce: string;
  D: string;
  share: unknown;
  transcript: { T1: string; T2: string };
}
interface Roll {
  n: number;
  label: string;
  point: string;
  contributions: Contribution[];
  seed: string;
  faces: { count: number; sides: number; faces: number[] }[];
}
interface RollVectors {
  version: number;
  seed: string;
  rootId: string;
  deckId: string;
  seats: { seat: number; secret: string; key: string }[];
  moves: { move: string; prev: string; rolls: Roll[] }[];
}

const v = JSON.parse(readFileSync(FILE, 'utf8')) as RollVectors;
const keys = v.seats.map((s) => decodePoint(s.key));
const HEX64 = /^[0-9a-f]{64}$/;

describe('protocol v2 roll vectors (PROTOCOL-v2 §12.2 item 1)', () => {
  it('regenerating gives roll-v2.json byte for byte', () => {
    expect(`${canonicalJson(generateRollVectors())}\n`).toBe(readFileSync(FILE, 'utf8'));
  });

  it('V2-30 roll points are H2C("roll:" + rootId + ":" + M + ":" + n), bound to the requesting move', () => {
    expect(v.version).toBe(2);
    expect(v.rootId).toMatch(HEX64);
    expect(v.seats).toHaveLength(3);
    expect(v.moves).toHaveLength(2);
    const [a, b] = v.moves as [RollVectors['moves'][number], RollVectors['moves'][number]];
    // Two requesting moves on one prev: a fork by the requester. Each has its own points.
    expect(a.prev).toBe(b.prev);
    expect(a.move).not.toBe(b.move);
    for (const m of v.moves) {
      expect(m.move).toMatch(HEX64);
      expect(m.rolls.map((r) => r.n)).toEqual([0, 1, 2]);
      for (const r of m.rolls) {
        // The label, independently: decimal n, lowercase hex ids, colon-separated.
        expect(r.label).toBe(`roll:${v.rootId}:${m.move}:${String(r.n)}`);
        const H = h2c(r.label);
        expect(encodePoint(H)).toBe(r.point);
        expect(moveRollPoint(v.rootId, m.move, r.n).equals(H)).toBe(true);
        // Not the v1 counter-bound point for the same index.
        expect(rollPoint(v.rootId, r.n).equals(H)).toBe(false);
      }
    }
    const points = v.moves.flatMap((m) => m.rolls.map((r) => r.point));
    expect(new Set(points).size).toBe(6);
  });

  it('V2-30 moveRollPoint takes 64-hex ids and a decimal index, and throws on anything else', () => {
    const M = v.moves[0]?.move as string;
    expect(() => moveRollPoint(v.rootId.toUpperCase(), M, 0)).toThrow(RangeError);
    expect(() => moveRollPoint(v.rootId, M.slice(1), 0)).toThrow(RangeError);
    expect(() => moveRollPoint('game-root', M, 0)).toThrow(RangeError);
    expect(() => moveRollPoint(v.rootId, M, -1)).toThrow(RangeError);
    expect(() => moveRollPoint(v.rootId, M, 1.5)).toThrow(RangeError);
    expect(() => moveRollPoint(v.rootId, M, -0)).toThrow(RangeError);
    expect(() => moveRollPoint(v.rootId, M, 2 ** 53)).toThrow(RangeError);
    const ct = moveRollCiphertext(v.rootId, M, 4);
    expect(ct.a.equals(ct.b) && ct.a.equals(h2c(`roll:${v.rootId}:${M}:4`))).toBe(true);
  });

  it('V2-32 (partial) every contribution verifies with deck id roll at position n, from the JSON alone', () => {
    expect(v.deckId).toBe(ROLL_DECK);
    for (const [k, s] of v.seats.entries()) {
      expect(s.seat).toBe(k);
      expect(G.multiply(decodeScalar(s.secret)).equals(keys[k] as Point)).toBe(true);
    }
    for (const m of v.moves) {
      for (const r of m.rolls) {
        const H = decodePoint(r.point);
        expect(r.contributions.map((c) => c.seat)).toEqual([0, 1, 2]);
        for (const c of r.contributions) {
          const x = decodeScalar(v.seats[c.seat]?.secret as string);
          const X = keys[c.seat] as Point;
          const { pos, share } = decodeShare(c.share);
          expect(pos).toBe(r.n);
          expect(encodePoint(share.D)).toBe(c.D);
          expect(H.multiply(x).equals(share.D)).toBe(true);
          expect(verifyMoveRollShare(X, v.rootId, m.move, r.n, share)).toBe(true);
          // The DLEQ transcript, independently: T1 = w·G = s·G − c·X, T2 = w·H = s·H − c·D, and
          // c = HS("dleq", rootId, "roll", n, X, H, D, T1, T2), s = w + c·x.
          const w = decodeScalar(c.nonce);
          const T1 = decodePoint(c.transcript.T1);
          const T2 = decodePoint(c.transcript.T2);
          expect(G.multiply(w).equals(T1)).toBe(true);
          expect(H.multiply(w).equals(T2)).toBe(true);
          expect(hs('dleq', v.rootId, 'roll', r.n, X, H, share.D, T1, T2)).toBe(share.c);
          expect((w + share.c * x) % q).toBe(share.s);
        }
      }
    }
  });

  it('V2-32 (partial) a contribution fails for the rival requesting move, another index, seat, root or deck id', () => {
    const [a, b] = v.moves as [RollVectors['moves'][number], RollVectors['moves'][number]];
    const c = a.rolls[1]?.contributions[2] as Contribution;
    const { share } = decodeShare(c.share);
    const X = keys[2] as Point;
    expect(verifyMoveRollShare(X, v.rootId, a.move, 1, share)).toBe(true);
    expect(verifyMoveRollShare(X, v.rootId, b.move, 1, share)).toBe(false);
    expect(verifyMoveRollShare(X, v.rootId, a.move, 0, share)).toBe(false);
    expect(verifyMoveRollShare(X, v.rootId, a.move, 2, share)).toBe(false);
    expect(verifyMoveRollShare(keys[1] as Point, v.rootId, a.move, 1, share)).toBe(false);
    expect(verifyMoveRollShare(X, b.prev, a.move, 1, share)).toBe(false);
    expect(verifyRollShare(X, v.rootId, 1, share)).toBe(false);
    const ct = moveRollCiphertext(v.rootId, a.move, 1);
    expect(verifyShare(X, ct, share, { rootId: v.rootId, deckId: ROLL_DECK, pos: 1 })).toBe(true);
    expect(verifyShare(X, ct, share, { rootId: v.rootId, deckId: 'tiles', pos: 1 })).toBe(false);
    // Bad inputs are false, never a throw.
    expect(verifyMoveRollShare(X, v.rootId, 'zz', 1, share)).toBe(false);
    expect(verifyMoveRollShare(X, v.rootId, a.move, -1, share)).toBe(false);
    expect(verifyMoveRollShare(X, v.rootId, a.move, 1, { ...share, D: share.D.add(G) })).toBe(false);
  });

  it('the seed hashes the compressed D points in seat order; faces come from it by faces(seed, count, sides)', () => {
    for (const m of v.moves) {
      for (const r of m.rolls) {
        const Ds = r.contributions.map((c) => decodePoint(c.D));
        const seed = sha256(concatBytes(...Ds.map((D) => D.toBytes(true))));
        expect(bytesToHex(seed)).toBe(r.seed);
        expect(rollSeed(r.contributions.map((c) => decodeShare(c.share).share))).toEqual(seed);
        expect(r.faces.map((f) => [f.count, f.sides])).toEqual(FACE_SHAPES.map(([c, s]) => [c, s]));
        for (const f of r.faces) {
          expect(f.faces).toEqual(faces(seed, f.count, f.sides));
          expect(f.faces.every((face) => face >= 1 && face <= f.sides)).toBe(true);
        }
      }
    }
  });

  it('makeMoveRollShare: hedged proofs differ, D does not, and the seed does not depend on the proof', () => {
    const M = v.moves[0]?.move as string;
    const x = decodeScalar(v.seats[0]?.secret as string);
    const one = makeMoveRollShare(x, v.rootId, M, 0, seededRandom('one'));
    const two = makeMoveRollShare(x, v.rootId, M, 0, seededRandom('two'));
    expect(verifyMoveRollShare(keys[0] as Point, v.rootId, M, 0, one)).toBe(true);
    expect(verifyMoveRollShare(keys[0] as Point, v.rootId, M, 0, two)).toBe(true);
    expect(one.D.equals(two.D)).toBe(true);
    expect(one.c === two.c).toBe(false);
    expect(encodePoint(one.D)).toBe(v.moves[0]?.rolls[0]?.contributions[0]?.D);
    expect(() => makeMoveRollShare(x, v.rootId, 'not-hex', 0, seededRandom('x'))).toThrow(RangeError);
  });
});
