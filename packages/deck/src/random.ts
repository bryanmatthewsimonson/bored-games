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

/**
 * A uniform integer in [0, k) for 1 ≤ k ≤ 2^32, by rejection sampling: draw a big-endian u32 and redraw
 * when it falls in the biased tail at or above `floor(2^32 / k) * k`. Every draw goes through `rnd`.
 */
export function randomIndex(rnd: RandomBytes, k: number): number {
  if (!Number.isSafeInteger(k) || k < 1 || k > 2 ** 32)
    throw new RangeError('randomIndex: k must be an integer in [1, 2^32]');
  const limit = Math.floor(2 ** 32 / k) * k;
  for (;;) {
    const bytes = rnd(4);
    if (bytes.length !== 4) throw new RangeError('random source returned the wrong number of bytes');
    const v =
      (bytes[0] as number) * 2 ** 24 +
      (((bytes[1] as number) << 16) | ((bytes[2] as number) << 8) | (bytes[3] as number));
    if (v < limit) return v % k;
  }
}
