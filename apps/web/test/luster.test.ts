import { type CardSlot, luster } from '@bored-games/luster';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { WorkshopCard } from '../src/games/luster/game.tsx';
import { exactTokens, nextTokens, statusText, tokenText } from '../src/games/luster/model.ts';
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
  it('gem names, costs and prestige remain readable without artwork or color', () => {
    const tree = renderTree(h(WorkshopCard, { slot: { deck: 'tier-1', pos: 1, card: 1, private: false } }));
    expect(spokenText(tree)).toContain('Cost Diamond 1 Onyx 2');
    expect(spokenText(tree)).toContain('Discount +1 Sapphire');
    expect(findAll(tree, (e) => e.tag === 'svg').every((e) => e.attrs['aria-hidden'] === 'true')).toBe(true);
    expect(tokenText([1, 0, 0, 0, 2, 1])).toBe('1 Diamond, 2 Onyx, 1 Gold');
  });
  it('rules explain all component counts, payment, reservations and the tiebreak', () => {
    const text = spokenText(renderTree(h(LusterRulesContent, {})));
    for (const phrase of [
      '40 Mines',
      '30 Workshops',
      '20 Guilds',
      '40 tokens',
      'ten nobles',
      'at most three reservations',
      'at most ten tokens',
      'at least four',
      'fewer purchased developments',
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
      "B's turn: take gems, reserve, or buy.",
    );
  });
  it('card faces are the keyboard-accessible selection target', () => {
    const select = () => undefined;
    const tree = renderTree(
      h(WorkshopCard, { slot: { deck: 'tier-1', pos: 1, card: 1, private: false }, onSelect: select }),
    );
    const buttons = findAll(tree, (e) => e.tag === 'button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.attrs['aria-label']).toBe('Select Sapphire card, tier 1, position 2');
    expect(buttons[0]?.attrs.onClick).toBe(select);
    expect(spokenText(buttons)).toContain('Cost Diamond 1 Onyx 2');
  });
  it('gem clicks allow a pair or distinct colors and cannot exceed a completable move', () => {
    const legal = [
      { type: 'take' as const, actor: 0, tokens: [2, 0, 0, 0, 0, 0] },
      { type: 'take' as const, actor: 0, tokens: [1, 1, 1, 0, 0, 0] },
    ];
    const single = nextTokens(legal, 'take', [0, 0, 0, 0, 0, 0], 0);
    expect(single).toEqual([1, 0, 0, 0, 0, 0]);
    const pair = nextTokens(legal, 'take', single, 0);
    expect(pair).toEqual([2, 0, 0, 0, 0, 0]);
    expect(nextTokens(legal, 'take', pair, 0)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(nextTokens(legal, 'take', pair, 1)).toEqual(pair);
    const distinct = nextTokens(legal, 'take', nextTokens(legal, 'take', single, 1), 2);
    expect(distinct).toEqual([1, 1, 1, 0, 0, 0]);
    expect(nextTokens(legal, 'take', distinct, 3)).toEqual(distinct);
    expect(nextTokens(legal, 'take', single, 5)).toEqual(single);
    const returns = [{ type: 'return' as const, actor: 0, tokens: [1, 0, 0, 0, 0, 2] }];
    expect(nextTokens(returns, 'return', [1, 0, 0, 0, 0, 1], 5)).toEqual([1, 0, 0, 0, 0, 2]);
    expect(nextTokens(returns, 'return', [1, 0, 0, 0, 0, 1], 0)).toEqual([0, 0, 0, 0, 0, 1]);
  });
});
