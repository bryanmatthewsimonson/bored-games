import { cyrb53 } from './hash.ts';

/**
 * Seeded PRNG (sfc32) for tests, fuzzing and local deck orders. Never used for
 * production shuffles, which come from each player's own secure randomness.
 */
export interface Rng {
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform float in [0, 1). */
  float(): number;
  pick<T>(items: readonly T[]): T;
  /** Derives an independent stream (e.g. one per game in a batch). */
  fork(label: string): Rng;
}

export function createRng(seed: string | number): Rng {
  const s = String(seed);
  const words = [0, 1, 2, 3].map((i) => Number.parseInt(cyrb53(s, i).slice(-8), 16) >>> 0);
  let a = words[0] ?? 0;
  let b = words[1] ?? 0;
  let c = words[2] ?? 0;
  let d = words[3] ?? 0;
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 15; i++) next();
  const rng: Rng = {
    int(n) {
      if (!Number.isInteger(n) || n <= 0) throw new RangeError(`int(${n})`);
      // Rejection sampling avoids modulo bias.
      const limit = 4294967296 - (4294967296 % n);
      let x = next();
      while (x >= limit) x = next();
      return x % n;
    },
    float() {
      return next() / 4294967296;
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick from empty list');
      return items[rng.int(items.length)] as (typeof items)[number];
    },
    fork(label) {
      return createRng(`${s}/${label}`);
    },
  };
  return rng;
}

/** Fisher-Yates shuffle into a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

export function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}
