import { type CardSlot, luster } from '@bored-games/luster';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { WorkshopCard } from '../src/games/luster/game.tsx';
import { exactTokens, statusText, tokenText } from '../src/games/luster/model.ts';
import { LusterRulesContent } from '../src/games/luster/rules-page.tsx';
import { findAll, renderTree, spokenText } from './render-tree.ts';

describe('Luster public presentation', () => {
  it('private cards expose no identity, cost, bonus or score to a spectator', () => {
    const slot: CardSlot = { deck: 'tier-3', pos: 4, card: null, private: true };
    const tree = renderTree(h(WorkshopCard, { slot }));
    const text = spokenText(tree);
    expect(text).toContain('Private reservation');
    expect(text).toContain('Only its owner');
    expect(text).not.toContain('Discount');
    expect(text).not.toContain('Cost');
    expect(findAll(tree, (e) => e.tag === 'article')[0]?.attrs['data-card']).toBe('hidden');
  });
  it('color names, costs and radiance remain readable without artwork or color', () => {
    const tree = renderTree(h(WorkshopCard, { slot: { deck: 'tier-1', pos: 1, card: 1, private: false } }));
    expect(spokenText(tree)).toContain('Cost Ivory 1 Ink 2');
    expect(spokenText(tree)).toContain('Discount +1 Azure');
    expect(findAll(tree, (e) => e.tag === 'svg').every((e) => e.attrs['aria-hidden'] === 'true')).toBe(true);
    expect(tokenText([1, 0, 0, 0, 2, 1])).toBe('1 Ivory, 2 Ink, 1 Prism');
  });
  it('rules explain all component counts, payment, reservations and the tiebreak', () => {
    const text = spokenText(renderTree(h(LusterRulesContent, {})));
    for (const phrase of [
      '40 Study',
      '30 Studio',
      '20 Atelier',
      '40 tokens',
      'ten commissions',
      'at most three reservations',
      'at most ten tokens',
      'at least four',
      'fewer purchased workshops',
      'Resigning is currently unavailable',
      'A starting player is chosen at random',
      'player immediately before the starting player',
    ])
      expect(text).toContain(phrase);
  });
  it('controls match exact token encodings and spectator status uses public turn data', () => {
    const a = { type: 'take' as const, actor: 0, tokens: [1, 1, 1, 0, 0, 0] };
    expect(exactTokens([a], 'take', [1, 1, 1, 0, 0, 0])).toEqual(a);
    expect(exactTokens([a], 'take', [1, 1, 0, 0, 0, 0])).toBeUndefined();
    const s = luster.setup({ rules: luster.defaultRules(), seats: 2, mode: 'view', viewer: null });
    if (!s.ok) throw new Error(s.error.message);
    expect(statusText(s.value, null, ['A', 'B'], false)).toBe('Choosing a starting player…');
    expect(statusText({ ...s.value, startingSeat: 1, turn: 1 }, null, ['A', 'B'], false)).toBe(
      "B's turn: gather, reserve, or purchase.",
    );
  });
});
