import { expect, it } from 'vitest';
import {
  contrast,
  EXHIBITS,
  fitText,
  ON_ACCENT,
  PALETTE,
  PARTIES,
  SCENES,
  SEAT_PARTIES,
  TEXT_PAIRS,
} from '../scripts/room-for-doubt/data.ts';
import { EMBLEMS, EXHIBIT_GLYPHS, SCENE_GLYPHS } from '../scripts/room-for-doubt/glyphs.ts';
import { isWellFormed } from '../scripts/room-for-doubt/svg.ts';

it('has 6 parties, 6 exhibits and 9 scenes with unique ids, monograms and emblems', () => {
  expect([PARTIES.length, EXHIBITS.length, SCENES.length]).toEqual([6, 6, 9]);
  for (const key of ['id', 'monogram', 'emblem'] as const)
    expect(new Set(PARTIES.map((p) => p[key])).size).toBe(6);
  expect(SCENES.filter((s) => s.corner).map((s) => s.id)).toEqual(['chambers', 'store', 'cells', 'belfry']);
});

it('spreads the parties by seat count (P1)', () => {
  expect(SEAT_PARTIES[3]).toEqual(['ashdown', 'reeve', 'faulk']);
  expect(SEAT_PARTIES[4]).toEqual(['ashdown', 'brine', 'crowther', 'faulk']);
  expect(SEAT_PARTIES[5]).toEqual(['ashdown', 'brine', 'reeve', 'crowther', 'faulk']);
  expect(SEAT_PARTIES[6]).toEqual(PARTIES.map((p) => p.id));
});

it('keeps every text pair at WCAG AA (4.5) and every party accent readable', () => {
  for (const [fg, bg] of TEXT_PAIRS)
    expect(contrast(PALETTE[fg], PALETTE[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  for (const p of PARTIES)
    expect(contrast(PALETTE[ON_ACCENT[p.accent]], PALETTE[p.accent]), p.id).toBeGreaterThanOrEqual(4.5);
});

it('draws every emblem, exhibit and scene, well-formed, in palette colours only, under 3 KB', () => {
  const all = [
    ...Object.entries(EMBLEMS),
    ...Object.entries(EXHIBIT_GLYPHS),
    ...Object.entries(SCENE_GLYPHS),
  ];
  expect(all).toHaveLength(21);
  const hex = Object.values(PALETTE).map((h) => h.toLowerCase());
  for (const [id, markup] of all) {
    expect(isWellFormed(`<svg>${markup}</svg>`), id).toBe(true);
    expect(markup.length, id).toBeLessThan(3000);
    for (const c of markup.match(/#[0-9a-fA-F]{6}\b/g) ?? []) expect(hex, id).toContain(c.toLowerCase());
  }
});

it('fits every display name at its layout size without squeezing (fitText)', () => {
  expect(fitText('Gavel', 24, 210)).toEqual({ size: 24 });
  expect(fitText('Barnaby Crowther', 24, 210).textLength).toBeUndefined();
  expect(fitText('x'.repeat(80), 24, 210)).toEqual({ size: 12, textLength: 210 });
  for (const n of [
    ...PARTIES.map((p) => p.name),
    ...EXHIBITS.map((e) => e.name),
    ...SCENES.map((s) => s.name),
  ])
    expect(fitText(n, 24, 210).textLength, n).toBeUndefined();
});

it('isWellFormed accepts balanced markup and rejects the rest', () => {
  expect(isWellFormed('<svg a="1"><g><path d="M0 0"/></g><!-- c --></svg>')).toBe(true);
  for (const bad of ['<svg><g></svg>', '<svg></g></svg>', '<svg>a & b</svg>', '<svg><</svg>'])
    expect(isWellFormed(bad), bad).toBe(false);
});
