import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ART_FILES, renderAll } from '../scripts/room-for-doubt/art/index.ts';
import { PALETTE, SCENES } from '../scripts/room-for-doubt/data.ts';
import { isWellFormed } from '../scripts/room-for-doubt/svg.ts';
import { findRestricted, licensedPackStrings } from './restricted-names.ts';

const root = join(import.meta.dirname, '..');
const game = join(root, 'docs/games/room-for-doubt');
const boardText = readFileSync(join(game, 'board.txt'), 'utf8');
const rendered = renderAll(boardText);
const hex = Object.values(PALETTE).map((h) => h.toLowerCase());
let strings: string[] = [];
beforeAll(async () => {
  strings = await licensedPackStrings(root);
});

it('renders exactly the listed files', () => expect(Object.keys(rendered)).toEqual([...ART_FILES]));

for (const name of ART_FILES) {
  describe(name, () => {
    const svg = rendered[name] ?? '';
    it("on disk equals the generator's output (run: node scripts/room-for-doubt/cli.ts)", () =>
      expect(readFileSync(join(game, 'art', name), 'utf8')).toBe(svg));
    it('is well-formed, titled, CC0, palette-only and holds no restricted name', () => {
      expect(isWellFormed(svg)).toBe(true);
      expect(svg).toMatch(/<title>[^<]+<\/title>/);
      expect(svg).toContain('CC0-1.0');
      for (const c of svg.match(/#[0-9a-fA-F]{6}\b/g) ?? []) expect(hex).toContain(c.toLowerCase());
      expect(findRestricted(svg, strings)).toEqual([]);
    });
  });
}

describe('board.svg', () => {
  const svg = rendered['board.svg'] ?? '';
  it('draws every room, entrance, door and passage from the grid', () => {
    for (const s of SCENES) expect(svg).toContain(`id="room-${s.id}"`);
    for (let n = 1; n <= 6; n++) expect(svg).toContain(`id="entrance-${n}"`);
    expect(svg.match(/data-door="/g)).toHaveLength(19);
    for (const id of ['rotunda', 'passage-chambers-store', 'passage-belfry-cells'])
      expect(svg).toContain(`id="${id}"`);
  });
  it('carries the grid hash', () =>
    expect(svg).toContain(`board.txt sha256: ${createHash('sha256').update(boardText).digest('hex')}`));
});
