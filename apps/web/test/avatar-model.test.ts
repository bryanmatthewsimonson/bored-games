import { describe, expect, it } from 'vitest';
import { PRESETS, patternAvatar, presetDataUrl } from '../src/avatar-model.ts';

const PK1 = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
const PK2 = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';

describe('patternAvatar', () => {
  it('is deterministic and differs between keys', () => {
    expect(patternAvatar(PK1)).toEqual(patternAvatar(PK1));
    expect(patternAvatar(PK1)).not.toEqual(patternAvatar(PK2));
  });

  it('is a mirrored 5×5 grid that is neither empty nor full', () => {
    for (const pk of [PK1, PK2, '0'.repeat(64), 'f'.repeat(64)]) {
      const { cells, fg, bg } = patternAvatar(pk);
      expect(cells).toHaveLength(25);
      for (let row = 0; row < 5; row++) {
        expect(cells[row * 5]).toBe(cells[row * 5 + 4]);
        expect(cells[row * 5 + 1]).toBe(cells[row * 5 + 3]);
      }
      const on = cells.filter(Boolean).length;
      expect(on).toBeGreaterThanOrEqual(4);
      expect(on).toBeLessThanOrEqual(22);
      expect(fg).toMatch(/^hsl\(\d+ 55% 42%\)$/);
      expect(bg).toMatch(/^hsl\(\d+ 50% 88%\)$/);
    }
  });
});

describe('PRESETS', () => {
  it('has twelve distinct presets with SVG markup', () => {
    expect(PRESETS.map((p) => p.label)).toEqual([
      'Fox',
      'Owl',
      'Cat',
      'Whale',
      'Cactus',
      'Moon',
      'Sun',
      'Leaf',
      'Wave',
      'Mountain',
      'Balloon',
      'Kite',
    ]);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(12);
    for (const p of PRESETS) {
      expect(p.svg).toMatch(
        /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="256" height="256" viewBox="0 0 64 64">.*<\/svg>$/,
      );
      expect(p.svg).not.toMatch(/<script|href=|on\w+=/i);
      expect(presetDataUrl(p).startsWith('data:image/svg+xml,%3Csvg')).toBe(true);
    }
  });
});
