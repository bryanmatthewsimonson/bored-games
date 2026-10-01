import { type Share, validPos } from './dleq.ts';
import type { Ciphertext } from './elgamal.ts';
import { decodePoint, decodeScalar, encodePoint, encodeScalar, type Point } from './encoding.ts';
import type { PokProof } from './pok.ts';
import type { ShuffleProof } from './shuffle.ts';

/*
 * Strict JSON codecs for what travels in NOSTR event content (PROTOCOL §4.4, §5.3, §5.4). Peers are
 * adversarial, so the decoders are a security boundary: they accept exactly one shape, name the path of
 * the first defect and never return a partially valid value. They only parse; callers verify the proofs.
 */

/** Thrown by every decoder on any shape, key-set, length or encoding defect. The message names the path. */
export class DeckWireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeckWireError';
  }
}

const fail = (path: string, why: string): never => {
  throw new DeckWireError(`${path}: ${why}`);
};

/** A plain object (prototype `Object.prototype` or `null`) with exactly `keys` as own, enumerable data properties. */
function record(v: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(path, 'expected an object');
  const proto = Object.getPrototypeOf(v) as unknown;
  if (proto !== Object.prototype && proto !== null) return fail(path, 'expected a plain object');
  const own = Reflect.ownKeys(v);
  for (const k of own) {
    if (typeof k !== 'string') return fail(path, 'unexpected symbol key');
    if (!keys.includes(k)) return fail(path, `unexpected key "${k}"`);
  }
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (d === undefined) return fail(path, `missing key "${k}"`);
    if (!('value' in d) || d.enumerable !== true) return fail(`${path}.${k}`, 'expected a data property');
    out[k] = d.value as unknown;
  }
  return out;
}

/** A real, dense array of exactly `len` entries. Walks indices, never `.every`. */
function list(v: unknown, path: string, len: number): unknown[] {
  if (!Array.isArray(v)) return fail(path, 'expected an array');
  if (v.length !== len) return fail(path, `expected ${len} entries, got ${v.length}`);
  if (Reflect.ownKeys(v).length !== v.length + 1) return fail(path, 'sparse array or extra properties');
  const out: unknown[] = [];
  for (let i = 0; i < v.length; i++) {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (d === undefined || !('value' in d)) return fail(`${path}[${i}]`, 'missing entry');
    out.push(d.value as unknown);
  }
  return out;
}

/**
 * Run `f`, turning anything it throws other than a `DeckWireError` into one at `path`. Every decoder body runs
 * inside this, so hostile input that throws while being inspected (a Proxy trap, a revoked Proxy) is still a
 * `DeckWireError`.
 */
function withPath<T>(path: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (isWireError(e)) throw e;
    return fail(path, reason(e));
  }
}

/** `instanceof` itself can throw on a hostile thrown value (a Proxy with a throwing trap). */
function isWireError(e: unknown): boolean {
  try {
    return e instanceof DeckWireError;
  } catch {
    return false;
  }
}

function reason(e: unknown): string {
  try {
    if (e instanceof Error && typeof e.message === 'string') return e.message;
  } catch {
    // fall through
  }
  return 'invalid value';
}

const point = (v: unknown, path: string): Point =>
  withPath(path, () => {
    if (typeof v !== 'string') throw new TypeError('expected a base64url string');
    return decodePoint(v);
  });

const scalar = (v: unknown, path: string): bigint =>
  withPath(path, () => {
    if (typeof v !== 'string') throw new TypeError('expected a base64url string');
    return decodeScalar(v);
  });

const points = (v: unknown, path: string, len: number): Point[] =>
  list(v, path, len).map((x, i) => point(x, `${path}[${i}]`));

const scalars = (v: unknown, path: string, len: number): bigint[] =>
  list(v, path, len).map((x, i) => scalar(x, `${path}[${i}]`));

function size(n: number, who: string): void {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`${who}: n must be a positive safe integer`);
}

/* ------------------------------------------------------------------------------------------- wire types */

/** A deck on the wire: one `[a, b]` pair of base64url points per card. */
export type DeckWire = [string, string][];

/** A shuffle proof on the wire (PROTOCOL §5.3): points and scalars as base64url. */
export interface ShuffleProofWire {
  c: string[];
  cHat: string[];
  s: { s1: string; s2: string; s3: string; s4: string; sHat: string[]; sPrime: string[] };
  t: { t1: string; t2: string; t3: string; t4: [string, string]; tHat: string[] };
}

/** A decryption share on the wire (PROTOCOL §4.4). */
export interface ShareWire {
  d: string;
  pos: number;
  proof: { c: string; s: string };
}

/** A proof of knowledge on the wire (PROTOCOL §3). */
export interface PokWire {
  c: string;
  s: string;
}

/* ------------------------------------------------------------------------------------------------ deck */

/** `[[a, b], …]` with every point as base64url. Throws on an identity component (honest decks have none). */
export function encodeDeck(deck: readonly Ciphertext[]): DeckWire {
  return deck.map((e) => [encodePoint(e.a), encodePoint(e.b)]);
}

/**
 * Strict inverse of `encodeDeck` for a deck of exactly `n ≥ 1` cards. Callers take `n` from the input deck (or
 * the module's deck size), never from the message. Throws a `RangeError` on a bad `n`.
 */
export function decodeDeck(v: unknown, n: number): Ciphertext[] {
  size(n, 'decodeDeck');
  return withPath('deck', () => {
    return list(v, 'deck', n).map((row, i) => {
      const pair = list(row, `deck[${i}]`, 2);
      return { a: point(pair[0], `deck[${i}][0]`), b: point(pair[1], `deck[${i}][1]`) };
    });
  });
}

/* ------------------------------------------------------------------------------------------ shuffle proof */

/** The wire form of a shuffle proof. Throws on an identity point or a scalar outside [0, q). */
export function encodeShuffleProof(p: ShuffleProof): ShuffleProofWire {
  const pts = (xs: readonly Point[]): string[] => xs.map(encodePoint);
  const scs = (xs: readonly bigint[]): string[] => xs.map(encodeScalar);
  return {
    c: pts(p.c),
    cHat: pts(p.cHat),
    s: {
      s1: encodeScalar(p.s.s1),
      s2: encodeScalar(p.s.s2),
      s3: encodeScalar(p.s.s3),
      s4: encodeScalar(p.s.s4),
      sHat: scs(p.s.sHat),
      sPrime: scs(p.s.sPrime),
    },
    t: {
      t1: encodePoint(p.t.t1),
      t2: encodePoint(p.t.t2),
      t3: encodePoint(p.t.t3),
      t4: [encodePoint(p.t.t4[0]), encodePoint(p.t.t4[1])],
      tHat: pts(p.t.tHat),
    },
  };
}

/** Strict inverse of `encodeShuffleProof` for a deck of `n ≥ 1` cards. Parses only; does not verify. */
export function decodeShuffleProof(v: unknown, n: number): ShuffleProof {
  size(n, 'decodeShuffleProof');
  return withPath('proof', () => decodeShuffleProofBody(v, n));
}

function decodeShuffleProofBody(v: unknown, n: number): ShuffleProof {
  const root = record(v, 'proof', ['c', 'cHat', 's', 't']);
  const s = record(root.s, 'proof.s', ['s1', 's2', 's3', 's4', 'sHat', 'sPrime']);
  const t = record(root.t, 'proof.t', ['t1', 't2', 't3', 't4', 'tHat']);
  const t4 = points(t.t4, 'proof.t.t4', 2);
  return {
    c: points(root.c, 'proof.c', n),
    cHat: points(root.cHat, 'proof.cHat', n),
    t: {
      t1: point(t.t1, 'proof.t.t1'),
      t2: point(t.t2, 'proof.t.t2'),
      t3: point(t.t3, 'proof.t.t3'),
      t4: [t4[0] as Point, t4[1] as Point],
      tHat: points(t.tHat, 'proof.t.tHat', n),
    },
    s: {
      s1: scalar(s.s1, 'proof.s.s1'),
      s2: scalar(s.s2, 'proof.s.s2'),
      s3: scalar(s.s3, 'proof.s.s3'),
      s4: scalar(s.s4, 'proof.s.s4'),
      sHat: scalars(s.sHat, 'proof.s.sHat', n),
      sPrime: scalars(s.sPrime, 'proof.s.sPrime', n),
    },
  };
}

/* -------------------------------------------------------------------------------------------------- share */

/** `{d, pos, proof: {c, s}}` (PROTOCOL §4.4). Throws on an identity `D`, a bad `pos` or a scalar outside [0, q). */
export function encodeShare(x: { pos: number; share: Share }): ShareWire {
  if (!validPos(x.pos)) throw new RangeError('encodeShare: pos must be a non-negative safe integer');
  return {
    d: encodePoint(x.share.D),
    pos: x.pos,
    proof: { c: encodeScalar(x.share.c), s: encodeScalar(x.share.s) },
  };
}

/** Strict inverse of `encodeShare`. Parses only; does not verify the proof. */
export function decodeShare(v: unknown): { pos: number; share: Share } {
  return withPath('share', () => {
    const root = record(v, 'share', ['d', 'pos', 'proof']);
    const proof = record(root.proof, 'share.proof', ['c', 's']);
    if (!validPos(root.pos)) return fail('share.pos', 'expected a non-negative safe integer');
    return {
      pos: root.pos,
      share: {
        D: point(root.d, 'share.d'),
        c: scalar(proof.c, 'share.proof.c'),
        s: scalar(proof.s, 'share.proof.s'),
      },
    };
  });
}

/* --------------------------------------------------------------------------------------------------- pok */

/** `{c, s}` (PROTOCOL §3). */
export function encodePok(proof: PokProof): PokWire {
  return { c: encodeScalar(proof.c), s: encodeScalar(proof.s) };
}

/** Strict inverse of `encodePok`. Parses only; does not verify. */
export function decodePok(v: unknown): PokProof {
  return withPath('pok', () => {
    const root = record(v, 'pok', ['c', 's']);
    return { c: scalar(root.c, 'pok.c'), s: scalar(root.s, 'pok.s') };
  });
}
