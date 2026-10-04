import { type CardSlot, GEM_RULES, luster } from '@bored-games/luster';
import { LUSTER_THEME } from '@bored-games/luster/theme';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { PlayerSidebar, ReservedCards, WorkshopCard } from '../src/games/luster/game.tsx';
import { exactTokens, nextTokens, statusText, tokenText } from '../src/games/luster/model.ts';
import { LusterRulesContent } from '../src/games/luster/rules-page.tsx';
import { findAll, renderTree, spokenText, textOf } from './render-tree.ts';

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
  it('every opponent reservation is face down even when its identity was previously public', () => {
    const slots: CardSlot[] = [
      { deck: 'tier-1', pos: 0, card: 1, private: false },
      { deck: 'tier-3', pos: 4, card: 4, private: true },
    ];
    const tree = renderTree(h(ReservedCards, { slots, owner: false, onSelect: () => undefined }));
    expect(findAll(tree, (e) => e.tag === 'article').map((e) => e.attrs['data-card'])).toEqual([
      'hidden',
      'hidden',
    ]);
    expect(findAll(tree, (e) => e.tag === 'button' || e.tag === 'svg')).toHaveLength(0);
    const text = textOf(tree);
    for (const hidden of ['Cost', 'Discount', 'prestige', 'Sapphire', 'Gold', 'development'])
      expect(text).not.toContain(hidden);
    expect(slots[0]?.card).toBe(1);
  });
  it('the owner can see and select both market and blind reservations in their hand', () => {
    const slots: CardSlot[] = [
      { deck: 'tier-1', pos: 0, card: 1, private: false },
      { deck: 'tier-3', pos: 4, card: 4, private: true },
    ];
    const selected: CardSlot[] = [];
    const tree = renderTree(
      h(ReservedCards, { slots, owner: true, onSelect: (slot) => selected.push(slot) }),
    );
    const buttons = findAll(tree, (e) => e.tag === 'button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) (button.attrs.onClick as () => void)();
    expect(selected).toEqual(slots);
    expect(findAll(tree, (e) => e.tag === 'article').map((e) => e.attrs['data-card'])).toEqual([1, 4]);
    expect(spokenText(tree)).toContain('Cost');
  });
  it('the score sidebar exposes public resources but only backs for reserved cards', () => {
    const setup = luster.setup({ rules: luster.defaultRules(), seats: 2, mode: 'view', viewer: null });
    if (!setup.ok) throw new Error(setup.error.message);
    const state = {
      ...setup.value,
      players: setup.value.players.map((p) => ({
        ...p,
        reserved: [{ deck: 'tier-1' as const, pos: 0, card: 1, private: false }],
      })),
    };
    for (const mySeat of [null, 0, 1]) {
      const tree = renderTree(
        h(PlayerSidebar, { state, mySeat, names: ['Alice', 'Bob'], avatars: [], ended: false }),
      );
      expect(findAll(tree, (e) => e.tag === 'aside')).toHaveLength(1);
      expect(spokenText(tree)).toContain('Alice');
      expect(spokenText(tree)).toContain('Bob');
      expect(spokenText(tree)).toContain('Gems');
      expect(spokenText(tree)).toContain('Discounts');
      expect(findAll(tree, (e) => e.tag === 'article').every((e) => e.attrs['data-card'] === 'hidden')).toBe(
        true,
      );
    }
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
  it('offers each gem rule under New table, published first and by default (C11)', () => {
    expect(GEM_RULES).toEqual(['published', 'any']);
    expect(luster.defaultRules().gems).toBe(GEM_RULES[0]);
    for (const gems of GEM_RULES) {
      expect(LUSTER_THEME.gems[gems].length).toBeGreaterThan(0);
      expect(luster.validateRules({ target: 15, gems })).toEqual({ ok: true, value: { target: 15, gems } });
    }
    const page = spokenText(renderTree(h(LusterRulesContent, {})));
    expect(page).toContain('take one token in each of three different regular colors');
    expect(page).toContain('any number of different colors');
  });
});
