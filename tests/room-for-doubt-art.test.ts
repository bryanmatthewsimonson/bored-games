import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CARD_H, CARD_LAYOUT, CARD_W } from '../scripts/room-for-doubt/art/cards.ts';
import { ART_FILES, renderAll } from '../scripts/room-for-doubt/art/index.ts';
import { EXHIBITS, PALETTE, PARTIES, SCENES } from '../scripts/room-for-doubt/data.ts';
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

describe('cards.svg', () => {
  const svg = rendered['cards.svg'] ?? '';
  it('holds the 21 faces, the back and the envelope, each once', () => {
    const ids = [
      ...PARTIES.map((p) => `card-${p.id}`),
      ...EXHIBITS.map((e) => `card-${e.id}`),
      ...SCENES.map((s) => `card-${s.id}`),
      'card-back',
      'verdict-envelope',
    ];
    for (const id of ids) expect(svg.split(`id="${id}"`), id).toHaveLength(2);
  });
  it('lays the 23 cards out inside the sheet with no overlap', () => {
    expect(CARD_LAYOUT).toHaveLength(23);
    for (const a of CARD_LAYOUT) {
      expect(a.x >= 0 && a.y >= 0 && a.x + CARD_W <= 2522 && a.y + CARD_H <= 1178, a.id).toBe(true);
      for (const b of CARD_LAYOUT)
        if (a !== b)
          expect(
            a.x + CARD_W <= b.x || b.x + CARD_W <= a.x || a.y + CARD_H <= b.y || b.y + CARD_H <= a.y,
            `${a.id}/${b.id}`,
          ).toBe(true);
    }
  });
  it('names every card through fitText with no squeezed text', () => expect(svg).not.toContain('textLength'));
});

describe('pieces.svg', () => {
  const svg = rendered['pieces.svg'] ?? '';
  it('draws six pawns, six tokens and six dice faces', () => {
    for (const p of PARTIES) expect(svg).toContain(`id="pawn-${p.id}"`);
    for (const e of EXHIBITS) expect(svg).toContain(`id="token-${e.id}"`);
    for (let n = 1; n <= 6; n++) expect(svg).toContain(`id="die-${n}"`);
    expect(svg).not.toContain('textLength');
  });
});

describe('docket.svg', () => {
  const svg = rendered['docket.svg'] ?? '';
  it('has a row for each of the 21 cards and a notes area', () => {
    for (const id of [...PARTIES.map((p) => p.id), ...EXHIBITS.map((e) => e.id), ...SCENES.map((s) => s.id)])
      expect(svg).toContain(`id="docket-row-${id}"`);
    expect(svg).toContain('id="docket-notes"');
    expect(svg).not.toContain('textLength');
  });
});
