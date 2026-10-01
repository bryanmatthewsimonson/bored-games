import { createRng } from '@bored-games/game-kit';
import type { RandomBytes } from '../src/random.ts';

/** Deterministic byte source for tests, built on game-kit's seeded PRNG. Never used in production code. */
export function seededRandom(seed: string): RandomBytes {
  const rng = createRng(seed);
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = rng.int(256);
    return out;
  };
}
