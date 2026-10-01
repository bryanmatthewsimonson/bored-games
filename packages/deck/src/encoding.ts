import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const Point = secp256k1.Point;
export type Point = InstanceType<typeof Point>;

const q = Point.Fn.ORDER;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INDEX = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

/** Base64url without padding. `decode` is strict, so `encode(decode(s)) === s` for every accepted `s`. */
export const b64u = {
  encode(bytes: Uint8Array): string {
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
      out += ALPHABET[n >> 18] as string;
      out += ALPHABET[(n >> 12) & 63] as string;
      out += ALPHABET[(n >> 6) & 63] as string;
      out += ALPHABET[n & 63] as string;
    }
    const rest = bytes.length - i;
    if (rest === 1) {
      const n = (bytes[i] as number) << 16;
      out += (ALPHABET[n >> 18] as string) + (ALPHABET[(n >> 12) & 63] as string);
    } else if (rest === 2) {
      const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
      out +=
        (ALPHABET[n >> 18] as string) +
        (ALPHABET[(n >> 12) & 63] as string) +
        (ALPHABET[(n >> 6) & 63] as string);
    }
    return out;
  },

  decode(s: string): Uint8Array {
    if (typeof s !== 'string') throw new TypeError('base64url: not a string');
    if (s.length % 4 === 1) throw new RangeError('base64url: invalid length');
    const values: number[] = [];
    for (const c of s) {
      const v = INDEX.get(c);
      if (v === undefined) throw new RangeError('base64url: invalid character');
      values.push(v);
    }
    if (values.length !== s.length) throw new RangeError('base64url: invalid character');
    const out = new Uint8Array(Math.floor((s.length * 3) / 4));
    let o = 0;
    let i = 0;
    for (; i + 3 < values.length; i += 4) {
      const n =
        ((values[i] as number) << 18) |
        ((values[i + 1] as number) << 12) |
        ((values[i + 2] as number) << 6) |
        (values[i + 3] as number);
      out[o++] = n >> 16;
      out[o++] = (n >> 8) & 255;
      out[o++] = n & 255;
    }
    const rest = values.length - i;
    if (rest === 2) {
      const n = ((values[i] as number) << 6) | (values[i + 1] as number);
      if (n & 15) throw new RangeError('base64url: non-canonical final character');
      out[o++] = n >> 4;
    } else if (rest === 3) {
      const n = ((values[i] as number) << 12) | ((values[i + 1] as number) << 6) | (values[i + 2] as number);
      if (n & 3) throw new RangeError('base64url: non-canonical final character');
      out[o++] = n >> 10;
      out[o++] = (n >> 2) & 255;
    }
    return out;
  },
};

function scalarBytes(k: bigint): Uint8Array {
  if (typeof k !== 'bigint' || k < 0n || k >= q) throw new RangeError('scalar out of range [0, q)');
  const out = new Uint8Array(32);
  let v = k;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Wire encoding of a point: 44 characters. The identity has no wire encoding. */
export function encodePoint(P: Point): string {
  if (P.is0()) throw new RangeError('the identity point has no encoding');
  return b64u.encode(P.toBytes(true));
}

/** Strict inverse of `encodePoint`: canonical text, on the curve, never the identity. */
export function decodePoint(s: string): Point {
  if (typeof s !== 'string' || s.length !== 44) throw new RangeError('point: expected 44 characters');
  const bytes = b64u.decode(s);
  // `fromBytes` rejects the all-zero string, unknown prefixes and x coordinates off the curve.
  const P = Point.fromBytes(bytes);
  P.assertValidity();
  if (P.is0()) throw new RangeError('point: identity rejected');
  return P;
}

/** Wire encoding of a scalar in [0, q): 43 characters. */
export function encodeScalar(k: bigint): string {
  return b64u.encode(scalarBytes(k));
}

/** Strict inverse of `encodeScalar`: canonical text, value < q. */
export function decodeScalar(s: string): bigint {
  if (typeof s !== 'string' || s.length !== 43) throw new RangeError('scalar: expected 43 characters');
  const bytes = b64u.decode(s);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  if (v >= q) throw new RangeError('scalar: not below the group order');
  return v;
}

/** One input to `hs`. */
export type Part = Uint8Array | string | number | bigint | Point;

function u32be(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

/**
 * A lone surrogate: a high surrogate not followed by a low one, or a low surrogate not preceded by a high one.
 * The regex has no `u` flag, so it matches UTF-16 code units (`String.prototype.isWellFormed` is ES2024, past
 * the `lib` target).
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function partBytes(p: Part): Uint8Array {
  if (p instanceof Uint8Array) return p;
  if (typeof p === 'string') {
    // UTF-8 encoding would turn every lone surrogate into U+FFFD, so two different strings would hash alike.
    if (LONE_SURROGATE.test(p)) throw new RangeError('hs: string is not well-formed UTF-16');
    return utf8ToBytes(p);
  }
  if (typeof p === 'bigint') return scalarBytes(p);
  if (typeof p === 'number') {
    if (!Number.isSafeInteger(p)) throw new RangeError('hs: numbers must be safe integers');
    return utf8ToBytes(String(p));
  }
  // The identity is hashed as 33 zero bytes. This is for in-memory hashing only: `decodePoint` still rejects it.
  return p.is0() ? new Uint8Array(33) : p.toBytes(true);
}

/**
 * Hash to scalar: SHA-256 over `u32be(len) ‖ bytes` for each part, read big-endian, mod q. Throws on a string
 * that is not well-formed UTF-16, a number that is not a safe integer and a bigint outside [0, q).
 */
export function hs(...parts: Part[]): bigint {
  const chunks: Uint8Array[] = [];
  for (const p of parts) {
    const bytes = partBytes(p);
    chunks.push(u32be(bytes.length), bytes);
  }
  const digest = sha256(concatBytes(...chunks));
  let v = 0n;
  for (const b of digest) v = (v << 8n) | BigInt(b);
  return v % q;
}
