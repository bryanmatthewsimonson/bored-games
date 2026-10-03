import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { faces } from '../src/index.ts';

function counterBytes(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

/** The same rejection rule as `faces`, over an explicit byte stream, so the test is not the implementation. */
function accept(
  bytes: readonly number[],
  count: number,
  sides: number,
): { faces: number[]; skipped: boolean } {
  const limit = Math.floor(256 / sides) * sides;
  const out: number[] = [];
  let skipped = false;
  for (const byte of bytes) {
    if (byte >= limit) {
      skipped = true;
      continue;
    }
    out.push((byte % sides) + 1);
    if (out.length === count) break;
  }
  return { faces: out, skipped };
}

describe('faces', () => {
  it('is stable for a known seed and stays inside 1..sides', () => {
    const seed = utf8ToBytes('bank-roll-1');
    const once = faces(seed, 2, 6);
    expect(once).toEqual([3, 3]);
    expect(faces(seed, 2, 6)).toEqual(once);
    for (const face of faces(Uint8Array.of(9), 8, 6)) {
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(6);
    }
    const wide = faces(Uint8Array.of(3), 1, 256);
    expect(wide[0]).toBeGreaterThanOrEqual(1);
    expect(wide[0]).toBeLessThanOrEqual(256);
  });

  it('does not repeat a modulo reduction that a remainder would bias', () => {
    // 256 = 42 * 6 + 4, so `byte % 6` makes 0..3 one count more likely than 4 and 5.
    const counts = [0, 0, 0, 0, 0, 0];
    for (let byte = 0; byte < 256; byte++) counts[byte % 6] = (counts[byte % 6] ?? 0) + 1;
    expect(counts.slice(0, 4)).toEqual([43, 43, 43, 43]);
    expect(counts.slice(4)).toEqual([42, 42]);

    let differed = false;
    for (let i = 0; i < 256; i++) {
      const seed = Uint8Array.of(i);
      const block = [...sha256(concatBytes(seed, counterBytes(0)))];
      const naive = block.slice(0, 2).map((byte) => (byte % 6) + 1);
      const fair = accept(block, 2, 6);
      expect(faces(seed, 2, 6)).toEqual(fair.faces);
      if (fair.skipped && fair.faces.join() !== naive.join()) differed = true;
    }
    expect(differed).toBe(true);
  });

  it('rejects a bad count, a bad side count and an empty seed', () => {
    const seed = Uint8Array.of(1);
    expect(() => faces(new Uint8Array(), 1, 6)).toThrow(RangeError);
    expect(() => faces(seed, 0, 6)).toThrow(RangeError);
    expect(() => faces(seed, 65, 6)).toThrow(RangeError);
    expect(() => faces(seed, 1.5, 6)).toThrow(RangeError);
    expect(() => faces(seed, -0, 6)).toThrow(RangeError);
    expect(() => faces(seed, 1, 1)).toThrow(RangeError);
    expect(() => faces(seed, 1, 257)).toThrow(RangeError);
    expect(() => faces(seed, 1, 6.5)).toThrow(RangeError);
  });
});
