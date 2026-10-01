import { secp256k1 } from '@noble/curves/secp256k1.js';

/** Source of secure random bytes, always injected (production: the platform CSPRNG; tests: a seeded PRNG). */
export type RandomBytes = (n: number) => Uint8Array;

const q = secp256k1.Point.Fn.ORDER;

/**
 * A uniform-enough scalar in [1, q-1]: 48 random bytes (384 bits, so the modulo bias is about 2^-128)
 * reduced mod q. Zero is rejected and redrawn.
 */
export function randomScalar(rnd: RandomBytes): bigint {
  for (;;) {
    const bytes = rnd(48);
    if (bytes.length !== 48) throw new RangeError('random source returned the wrong number of bytes');
    let v = 0n;
    for (const b of bytes) v = (v << 8n) | BigInt(b);
    const k = v % q;
    if (k !== 0n) return k;
  }
}
