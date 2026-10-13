/*
 * Sticks & Stones' artwork (D089), without a browser: every card, monument, good, symbol, figure, die face, tool,
 * spot vignette and the cover render to an <svg>; the cards' and monuments' spoken labels come from
 * `discoveryLabel` and `monumentLabel`, one label per distinct component; and nothing rendered names the reference
 * game, its designer or its publishers (CLAUDE.md, D046).
 */
import { DISCOVERIES, MONUMENTS, SPOTS } from '@bored-games/sticks-and-stones';
import { type ComponentChildren, h } from 'preact';
import { describe, expect, it } from 'vitest';
import { findRestricted } from '../../../tests/restricted-names.ts';
import {
  CLAN_COLORS,
  Die,
  DiscoveryCard,
  discoveryLabel,
  FigureGlyph,
  GoodIcon,
  MonumentTile,
  monumentLabel,
  PersonIcon,
  SpareToolIcon,
  SpotArt,
  SticksCover,
  SymbolGlyph,
  ToolIcon,
} from '../src/games/sticks-and-stones/art.tsx';
import { findAll, type Node, renderTree, textOf } from './render-tree.ts';

const svgs = (tree: readonly Node[]) => findAll(tree, (el) => el.tag === 'svg');

/** The root svg's spoken name, and the whole tree as text for the name scan. */
function rendered(node: ComponentChildren): { label: string; text: string } {
  const tree = renderTree(node);
  const roots = svgs(tree);
  expect(roots.length).toBeGreaterThan(0);
  return { label: String(roots[0]?.attrs['aria-label'] ?? ''), text: JSON.stringify(tree) };
}

function clean(text: string): void {
  expect(findRestricted(text, [])).toEqual([]);
  expect(text.toLowerCase()).not.toMatch(/stone\W?age/);
}

const SPOT_ART = ['hunt', 'wood', 'brick', 'stone', 'gold', 'tools', 'hut', 'field'] as const;

describe('Sticks & Stones art', () => {
  it('draws every discovery with its label, one label per distinct card', () => {
    const byContent = new Map<string, string>();
    for (let c = 0; c < DISCOVERIES.length; c++) {
      for (const small of [false, true]) {
        const { label, text } = rendered(h(DiscoveryCard, { card: c, small }));
        expect(label).toBe(discoveryLabel(c));
        clean(text);
      }
      const label = discoveryLabel(c);
      expect(label.length).toBeGreaterThan(0);
      const key = JSON.stringify(DISCOVERIES[c]);
      expect(byContent.get(key) ?? label).toBe(label);
      byContent.set(key, label);
    }
    expect(new Set(byContent.values()).size).toBe(byContent.size);
    expect(DISCOVERIES.length).toBe(36);
    const back = rendered(h(DiscoveryCard, { card: null }));
    expect(back.label).toBe('A face-down discovery');
  });

  it('names cards in the game’s words', () => {
    expect(discoveryLabel(4)).toBe('Pottery: 7 food');
    expect(discoveryLabel(24)).toBe('Knapper ×2: Gifts of the dice');
    expect(discoveryLabel(0)).toBe('Glyphs: a face-down discovery');
    expect(discoveryLabel(6)).toBe('Cave Painting: roll 2 dice for amber');
    expect(discoveryLabel(31)).toBe('Elder ×1: 1 amber');
  });

  it('draws every monument with its label, one label per distinct price', () => {
    const byContent = new Map<string, string>();
    for (let m = 0; m < MONUMENTS.length; m++) {
      for (const small of [false, true]) {
        const { label, text } = rendered(h(MonumentTile, { monument: m, small }));
        expect(label).toBe(monumentLabel(m));
        clean(text);
      }
      const label = monumentLabel(m);
      expect(label.length).toBeGreaterThan(0);
      const key = JSON.stringify(MONUMENTS[m]);
      expect(byContent.get(key) ?? label).toBe(label);
      byContent.set(key, label);
    }
    expect(new Set(byContent.values()).size).toBe(byContent.size);
    expect(MONUMENTS.length).toBe(28);
    expect(monumentLabel(0)).toBe('Monument: 2 wood, 1 clay, 10 points');
    expect(monumentLabel(18)).toBe('Monument: 4 goods of exactly 2 kinds');
    expect(monumentLabel(25)).toBe('Monument: 1 to 7 goods of any kinds');
    expect(rendered(h(MonumentTile, { monument: null })).label).toBe('A face-down monument');
  });

  it('draws the goods, people, tools, dice, symbols and figures', () => {
    for (const good of [-1, 0, 1, 2, 3]) {
      const hidden = renderTree(h(GoodIcon, { good }));
      expect(svgs(hidden)[0]?.attrs['aria-hidden']).toBe('true');
      const named = renderTree(h(GoodIcon, { good, size: 32, title: `good ${good}` }));
      expect(svgs(named)[0]?.attrs.role).toBe('img');
      expect(textOf(named)).toContain(`good ${good}`);
    }
    for (const c of CLAN_COLORS) rendered(h(PersonIcon, { color: c.fill }));
    expect(CLAN_COLORS).toHaveLength(4);
    expect(new Set(CLAN_COLORS.map((c) => c.fill)).size).toBe(4);
    for (let v = 1; v <= 4; v++) {
      rendered(h(ToolIcon, { value: v }));
      rendered(h(ToolIcon, { value: v, used: true }));
      rendered(h(SpareToolIcon, { value: v }));
    }
    for (let v = 1; v <= 6; v++) expect(rendered(h(Die, { value: v })).label).toBe(`Die: ${v}`);
    const symbols = Array.from({ length: 8 }, (_, s) => rendered(h(SymbolGlyph, { symbol: s })).label);
    expect(new Set(symbols).size).toBe(8);
    const figures = Array.from({ length: 4 }, (_, f) => rendered(h(FigureGlyph, { figure: f })).label);
    expect(figures).toEqual(['Grower', 'Knapper', 'Builder', 'Elder']);
  });

  it('draws a vignette for every gathering and village spot', () => {
    for (const spot of SPOT_ART) {
      expect(SPOTS).toContain(spot);
      const tree = renderTree(h(SpotArt, { spot, width: 200, height: 100 }));
      const root = svgs(tree)[0];
      expect(root?.attrs.width).toBe(200);
      expect(root?.attrs['aria-hidden']).toBe('true');
      clean(JSON.stringify(tree));
    }
  });

  it('draws the cover, with the title, and the thumbnail without it', () => {
    const cover = rendered(h(SticksCover, { thumb: false }));
    expect(cover.label).toMatch(/^Sticks & Stones artwork/);
    expect(cover.text).toContain('Sticks & Stones');
    expect(cover.text).toContain('leave a mark that lasts');
    clean(cover.text);
    const thumb = renderTree(h(SticksCover, { thumb: true }));
    expect(svgs(thumb)[0]?.attrs.preserveAspectRatio).toBe('xMidYMid slice');
    expect(findAll(thumb, (el) => el.tag === 'text')).toEqual([]);
    clean(JSON.stringify(thumb));
  });
});
