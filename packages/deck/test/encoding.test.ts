import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { b64u, decodePoint, decodeScalar, encodePoint, encodeScalar, hs } from '../src/encoding.ts';
import { randomScalar } from '../src/random.ts';
import { seededRandom } from './util.ts';

const Point = secp256k1.Point;
const q = Point.Fn.ORDER;
const G = Point.BASE;

function be32(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

describe('b64u', () => {
  it('round-trips random bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 100 }), (bytes) => {
        expect(b64u.decode(b64u.encode(bytes))).toEqual(bytes);
      }),
    );
  });

  it('encode(decode(s)) === s for every accepted string', () => {
    fc.assert(
      fc.property(
        fc.string({
          unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'),
          maxLength: 20,
        }),
        (s) => {
          let decoded: Uint8Array;
          try {
            decoded = b64u.decode(s);
          } catch {
            return;
          }
          expect(b64u.encode(decoded)).toBe(s);
        },
      ),
    );
  });

  it('encodes without padding using the url-safe alphabet', () => {
    expect(b64u.encode(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(b64u.encode(new Uint8Array([]))).toBe('');
    expect(b64u.encode(new Uint8Array([0]))).toBe('AA');
  });

  it('rejects padding, + and /', () => {
    expect(() => b64u.decode('AA==')).toThrow();
    expect(() => b64u.decode('AA=')).toThrow();
    expect(() => b64u.decode('+_8')).toThrow();
    expect(() => b64u.decode('-/8')).toThrow();
  });

  it('rejects other characters', () => {
    expect(() => b64u.decode('AA A')).toThrow();
    expect(() => b64u.decode('AA\n')).toThrow();
    expect(() => b64u.decode('é')).toThrow();
  });

  it('rejects length 1 mod 4', () => {
    expect(() => b64u.decode('A')).toThrow();
    expect(() => b64u.decode('AAAAA')).toThrow();
  });

  it('rejects a final character with non-zero spare bits', () => {
    // 'AB' would decode to byte 0x00 with spare bits 0b0001; the canonical form is 'AA'.
    expect(b64u.decode('AA')).toEqual(new Uint8Array([0]));
    expect(() => b64u.decode('AB')).toThrow();
    // 3 chars: 2 bytes, 2 spare bits; '-_9' has spare bits 0b01.
    expect(b64u.decode('-_8')).toEqual(new Uint8Array([0xfb, 0xff]));
    expect(() => b64u.decode('-_9')).toThrow();
  });
});

describe('point codec', () => {
  it('decodePoint(encodePoint(G·k)) equals G·k', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: q - 1n }), (k) => {
        const P = G.multiply(k);
        const s = encodePoint(P);
        expect(s).toHaveLength(44);
        expect(decodePoint(s).equals(P)).toBe(true);
      }),
    );
  });

  it('rejects the 33-byte zero string (identity)', () => {
    expect(() => decodePoint(b64u.encode(new Uint8Array(33)))).toThrow();
  });

  it('rejects a 33-byte value with prefix 0x05', () => {
    const bytes = G.toBytes(true);
    bytes[0] = 0x05;
    expect(() => decodePoint(b64u.encode(bytes))).toThrow();
  });

  it('rejects an x coordinate off the curve', () => {
    // x = 5 is not on secp256k1 (5^3 + 7 = 132 is a non-residue); search to be sure.
    let found = 0;
    for (let x = 1n; found < 3 && x < 200n; x++) {
      const bytes = new Uint8Array(33);
      bytes[0] = 0x02;
      bytes.set(be32(x), 1);
      let onCurve = true;
      try {
        Point.fromBytes(bytes).assertValidity();
      } catch {
        onCurve = false;
      }
      if (onCurve) continue;
      found++;
      expect(() => decodePoint(b64u.encode(bytes))).toThrow();
    }
    expect(found).toBe(3);
  });

  it('rejects wrong lengths and non-canonical text', () => {
    const s = encodePoint(G);
    expect(() => decodePoint(s.slice(0, 43))).toThrow();
    expect(() => decodePoint(`${s}A`)).toThrow();
    expect(() => decodePoint('')).toThrow();
    // Standard-alphabet and padded variants are not accepted.
    expect(() => decodePoint(`${s.slice(0, 43)}=`)).toThrow();
    expect(() => decodePoint(`${s.slice(0, 43)}+`)).toThrow();
  });

  it('encodePoint rejects the identity', () => {
    expect(() => encodePoint(Point.ZERO)).toThrow();
  });
});

describe('scalar codec', () => {
  it('round-trips and is 43 characters', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: q - 1n }), (k) => {
        const s = encodeScalar(k);
        expect(s).toHaveLength(43);
        expect(decodeScalar(s)).toBe(k);
      }),
    );
  });

  it('rejects q and q+1, accepts q-1', () => {
    expect(() => decodeScalar(b64u.encode(be32(q)))).toThrow();
    expect(() => decodeScalar(b64u.encode(be32(q + 1n)))).toThrow();
    expect(decodeScalar(b64u.encode(be32(q - 1n)))).toBe(q - 1n);
  });

  it('rejects 2^256-1, wrong lengths and non-canonical text', () => {
    expect(() => decodeScalar(b64u.encode(new Uint8Array(32).fill(0xff)))).toThrow();
    const s = encodeScalar(5n);
    expect(() => decodeScalar(s.slice(0, 42))).toThrow();
    expect(() => decodeScalar(`${s}A`)).toThrow();
    expect(() => decodeScalar(`${s.slice(0, 42)}B`)).toThrow();
  });

  it('encodeScalar rejects values outside [0, q)', () => {
    expect(() => encodeScalar(q)).toThrow();
    expect(() => encodeScalar(-1n)).toThrow();
  });
});

describe('hs', () => {
  it('length-prefixes each part', () => {
    expect(hs('a', 'b')).not.toBe(hs('ab'));
    expect(hs('a', 'b')).not.toBe(hs('', 'ab'));
  });

  it('is deterministic and always < q', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string(), fc.uint8Array(), fc.integer()), { maxLength: 5 }),
        (parts) => {
          const h = hs(...parts);
          expect(h).toBe(hs(...parts));
          expect(h >= 0n && h < q).toBe(true);
        },
      ),
    );
  });

  it('encodes strings as UTF-8, numbers as decimal strings, bigints as 32 bytes', () => {
    expect(hs('é')).toBe(hs(new Uint8Array([0xc3, 0xa9])));
    expect(hs(42)).toBe(hs('42'));
    expect(hs(-7)).toBe(hs('-7'));
    expect(hs(5n)).toBe(hs(be32(5n)));
    expect(hs(G)).toBe(hs(G.toBytes(true)));
  });

  it('rejects non-integer numbers and out-of-range bigints', () => {
    expect(() => hs(1.5)).toThrow();
    expect(() => hs(Number.NaN)).toThrow();
    expect(() => hs(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => hs(2 ** 53)).toThrow();
    expect(() => hs(-1n)).toThrow();
    expect(() => hs(q)).toThrow();
    expect(() => hs(q - 1n)).not.toThrow();
  });

  it('accepts the identity point (33 zero bytes, in-memory only) and distinguishes it from other points', () => {
    expect(hs(Point.ZERO)).toBe(hs(new Uint8Array(33)));
    expect(hs(Point.ZERO)).not.toBe(hs(G));
  });

  it('matches an independent SHA-256 computation', () => {
    const digest = (bytes: number[]): bigint =>
      BigInt(`0x${createHash('sha256').update(Uint8Array.from(bytes)).digest('hex')}`) % q;
    expect(hs('a')).toBe(digest([0, 0, 0, 1, 0x61]));
    expect(hs('a', new Uint8Array([1, 2]))).toBe(digest([0, 0, 0, 1, 0x61, 0, 0, 0, 2, 1, 2]));
    expect(hs()).toBe(digest([]));
  });
});

describe('randomScalar', () => {
  it('is reproducible from a seeded source and never 0', () => {
    expect(randomScalar(seededRandom('x'))).toBe(randomScalar(seededRandom('x')));
    expect(randomScalar(seededRandom('x'))).not.toBe(randomScalar(seededRandom('y')));
    const rnd = seededRandom('stream');
    for (let i = 0; i < 200; i++) {
      const k = randomScalar(rnd);
      expect(k > 0n && k < q).toBe(true);
    }
  });

  it('rejects 0 and draws again', () => {
    const calls: number[] = [];
    const zeroThenOne: (n: number) => Uint8Array = (n) => {
      calls.push(n);
      const out = new Uint8Array(n);
      if (calls.length > 1) out[n - 1] = 1;
      return out;
    };
    expect(randomScalar(zeroThenOne)).toBe(1n);
    expect(calls).toEqual([48, 48]);
  });

  it('rejects a byte source that returns the wrong length', () => {
    expect(() => randomScalar(() => new Uint8Array(47))).toThrow();
  });
});
