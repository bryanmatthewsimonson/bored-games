/*
 * Holler faces and names, without a browser. The rules page shows one card of each suit and the active-suit
 * control. A suited card's left column is three copies, each at least 44 units, and seed dots there are radius 9.
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

function patterns(nodes: readonly Node[]): string[] {
  return [
    ...new Set(
      findAll(nodes, (el) => el.attrs['data-pattern'] !== undefined).map((el) =>
        String(el.attrs['data-pattern']),
      ),
    ),
  ].sort();
}

describe('holler cards', () => {
  it('names a suited card with its pattern, and Mark and Levy with no suit', () => {
    expect(cardLabel(HOLLER_THEME, numberCard(1, 7, 0))).toBe('Tide, waves, 7');
    expect(cardLabel(HOLLER_THEME, actionCard(1, 0, 0))).toBe('Tide Halt');
    expect(cardLabel(HOLLER_THEME, 100)).toBe('Mark');
    expect(cardLabel(HOLLER_THEME, 104)).toBe('Levy');
    const tide = suitLook(HOLLER_THEME, 1);
    expect(tide === null ? '' : suitLabel(tide)).toBe('Tide, waves');
  });

  it('keeps a Holler flag on the play the engine offered', () => {
    const card = numberCard(1, 7, 0);
    const plain = { type: 'play', actor: 0, pos: 4, card };
    const called = { type: 'play', actor: 0, pos: 4, card, holler: true as const };
    expect(playChoices(HOLLER_THEME, [plain, called]).map((play) => play.label)).toEqual([
      'Tide, waves, 7',
      'Holler!, Tide, waves, 7',
    ]);
    const mark = { type: 'play', actor: 0, pos: 1, card: 100, suit: 1 as const };
    expect(playChoices(HOLLER_THEME, [mark])[0]?.label).toBe('Tide, waves');
  });

  it('draws three tall column copies, and seed dots of radius 9', () => {
    const face = renderTree(h(CardFace, { theme: HOLLER_THEME, card: numberCard(2, 1, 0) }));
    const copies = findAll(face, (el) => String(el.attrs.class).split(/\s+/).includes('holler-column'));
    expect(copies).toHaveLength(3);
    for (const copy of copies) expect(Number(copy.attrs['data-copy-h'])).toBeGreaterThanOrEqual(44);
    const dots = findAll(face, (el) => el.tag === 'circle');
    expect(dots).toHaveLength(9);
    for (const dot of dots) {
      expect(Number(dot.attrs.r)).toBeGreaterThanOrEqual(8);
      expect(Number(dot.attrs.r)).toBeLessThanOrEqual(10);
    }
  });

  it('gives Mark and Levy an ink frame and no suit pattern', () => {
    for (const card of [100, 104]) {
      const face = renderTree(h(CardFace, { theme: HOLLER_THEME, card }));
      expect(patterns(face)).toEqual([]);
      const frame = findAll(face, (el) => el.tag === 'rect')[0];
      expect(frame?.attrs.stroke).toBe(HOLLER_THEME.ink);
      expect(frame?.attrs.fill).toBe(HOLLER_THEME.paper);
    }
    const levy = renderTree(h(CardFace, { theme: HOLLER_THEME, card: 104 }));
    const pull = renderTree(h(CardFace, { theme: HOLLER_THEME, card: actionCard(0, 2, 0) }));
    expect(strings(levy)).toContain('4');
    expect(strings(levy).join(' ')).not.toContain('+');
    expect(strings(pull)).toContain('2');
    expect(strings(pull).join(' ')).not.toContain('+');
  });

  it('shows four different patterns and a Tide waves control on the rules page', () => {
    const page = renderTree(h(HollerRulesContent, {}));
    expect(patterns(page)).toEqual(['chevron', 'diamond', 'seed', 'wave']);
    const active = findAll(page, (el) => el.attrs['data-testid'] === 'holler-active-suit');
    expect(active).toHaveLength(1);
    expect(active[0]?.attrs['aria-label']).toBe('Tide, waves');
    expect(active[0]?.attrs['data-pattern']).toBe('wave');
    expect(active[0]?.attrs['data-suit']).toBe('tide');
    expect(strings(page).join(' ')).not.toMatch(/\bUno\b|\bDOS\b|Phase 10|Skip-Bo/i);
  });
});
