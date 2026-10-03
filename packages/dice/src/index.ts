import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';

/**
 * Faces of fair dice from a seed (D058). Each face is drawn by rejection sampling over a SHA-256 stream, so a
 * remainder (`256 % sides`) never makes some faces more likely. The seed is the dice beacon's roll seed: the
 * session hashes the seats' compressed share points and passes the digest here. This package does not roll on
 * its own and has no clock.
 */

const COUNTER_CAP = 10_000;

function inRange(n: unknown, min: number, max: number): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && !Object.is(n, -0) && n >= min && n <= max;
}

/** A 4-byte big-endian counter, so each block of the stream has its own input. */
function counterBytes(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

/**
 * `count` faces in `1..sides` from `seed`. `count` is 1..64 and `sides` is 2..256, both safe integers; `seed`
 * is a non-empty byte string. Throws `RangeError` on a bad argument. A stream that does not yield enough
 * accepted bytes is a bug in this function, not a player's action.
 */
export function faces(seed: Uint8Array, count: number, sides: number): number[] {
  if (!(seed instanceof Uint8Array) || seed.length === 0)
    throw new RangeError('faces: seed must be a non-empty byte string');
  if (!inRange(count, 1, 64)) throw new RangeError('faces: count must be a safe integer from 1 to 64');
  if (!inRange(sides, 2, 256)) throw new RangeError('faces: sides must be a safe integer from 2 to 256');
  // Bytes at or above `limit` are dropped. `limit` is the greatest multiple of `sides` that fits in a byte,
  // so the remaining residues are equally likely.
  const limit = Math.floor(256 / sides) * sides;
  const out: number[] = [];
  let counter = 0;
  while (out.length < count) {
    if (counter >= COUNTER_CAP) throw new Error('faces: rejection sampling did not finish');
    const block = sha256(concatBytes(seed, counterBytes(counter)));
    counter += 1;
    for (const byte of block) {
      if (byte >= limit) continue;
      out.push((byte % sides) + 1);
      if (out.length === count) break;
    }
  }
  return out;
}
