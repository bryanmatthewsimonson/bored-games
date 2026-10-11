/*
 * Holler faces and names, without a browser (D085). A suit is shown as a color with its name; a colored card is
 * that color, and Mark and Levy are ink cards with the four-color wheel.
 */
import { actionCard, numberCard } from '@bored-games/holler';
import { HOLLER_THEME } from '@bored-games/holler/theme';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { CardFace } from '../src/games/holler/cards.tsx';
import { cardLabel, playChoices, suitLabel, suitLook } from '../src/games/holler/model.ts';
import { HollerRulesContent } from '../src/games/holler/rules-page.tsx';
import { findAll, isEl, type Node, renderTree } from './render-tree.ts';

function strings(nodes: readonly Node[]): string[] {
  return nodes.flatMap((node) => (isEl(node) ? strings(node.children) : [node]));
}

function colors(nodes: readonly Node[]): string[] {
  return [
    ...new Set(
      findAll(nodes, (el) => el.attrs['data-suit'] !== undefined).map((el) => String(el.attrs['data-suit'])),
    ),
  ].sort();
}

describe('holler cards', () => {
  it('names a card by its color, and Mark and Levy with no color', () => {
    expect(cardLabel(HOLLER_THEME, numberCard(3, 7, 0))).toBe('Blue 7');
    expect(cardLabel(HOLLER_THEME, actionCard(3, 0, 0))).toBe('Blue Halt');
    expect(cardLabel(HOLLER_THEME, 100)).toBe('Mark');
    expect(cardLabel(HOLLER_THEME, 104)).toBe('Levy');
    const blue = suitLook(HOLLER_THEME, 3);
    expect(blue === null ? '' : suitLabel(blue)).toBe('Blue');
  });

  it('keeps a Holler flag on the play the engine offered', () => {
    const card = numberCard(3, 7, 0);
    const plain = { type: 'play', actor: 0, pos: 4, card };
    const called = { type: 'play', actor: 0, pos: 4, card, holler: true as const };
    expect(playChoices(HOLLER_THEME, [plain, called]).map((play) => play.label)).toEqual([
      'Blue 7',
      'Holler!, Blue 7',
    ]);
    const mark = { type: 'play', actor: 0, pos: 1, card: 100, suit: 3 as const };
    expect(playChoices(HOLLER_THEME, [mark])[0]?.label).toBe('Blue');
  });

  it('fills a colored card with its color and tags it with the color id', () => {
    for (const [suit, color] of HOLLER_THEME.colors.entries()) {
      for (const card of [numberCard(suit, 5, 0), actionCard(suit, 2, 0)]) {
        const face = renderTree(h(CardFace, { theme: HOLLER_THEME, card }));
        expect(colors(face)).toEqual([color.id]);
        expect(findAll(face, (el) => el.tag === 'rect')[1]?.attrs.fill).toBe(color.hue);
      }
    }
  });

  it('draws Mark and Levy as ink cards with every color and no color of their own', () => {
    for (const card of [100, 104]) {
      const face = renderTree(h(CardFace, { theme: HOLLER_THEME, card }));
      expect(colors(face)).toEqual([]);
      expect(findAll(face, (el) => el.tag === 'rect')[1]?.attrs.fill).toBe(HOLLER_THEME.ink);
      const fills = new Set(
        findAll(face, (el) => el.tag === 'path' || el.tag === 'rect').map((el) => el.attrs.fill),
      );
      for (const color of HOLLER_THEME.colors) expect(fills.has(color.hue)).toBe(true);
    }
    const levy = renderTree(h(CardFace, { theme: HOLLER_THEME, card: 104 }));
    const pull = renderTree(h(CardFace, { theme: HOLLER_THEME, card: actionCard(0, 2, 0) }));
    expect(strings(levy)).toContain('4');
    expect(strings(levy).join(' ')).not.toContain('+');
    expect(strings(pull)).toContain('2');
    expect(strings(pull).join(' ')).not.toContain('+');
  });

  it('shows the four colors and a Blue control on the rules page', () => {
    const page = renderTree(h(HollerRulesContent, {}));
    expect(colors(page)).toEqual(['blue', 'green', 'red', 'yellow']);
    const active = findAll(page, (el) => el.attrs['data-testid'] === 'holler-active-suit');
    expect(active).toHaveLength(1);
    expect(active[0]?.attrs['aria-label']).toBe('Blue');
    expect(active[0]?.attrs['data-suit']).toBe('blue');
    expect(strings(page).join(' ')).not.toMatch(/\bUno\b|\bDOS\b|Phase 10|Skip-Bo/i);
  });
});
