/*
 * The Bank rules page, expanded without a DOM. Numbers come from the default rules.
 */
import { DEFAULT_RULES } from '@bored-games/bank';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { BANK_RULES_SECTIONS, BankRulesContent } from '../src/games/bank/rules-page.tsx';
import { findAll, renderTree, spokenText } from './render-tree.ts';

describe('BankRulesContent', () => {
  const tree = renderTree(h(BankRulesContent, {}));
  const text = spokenText(tree);

  it('renders every section, and each contents link targets its heading', () => {
    const h2 = findAll(tree, (el) => el.tag === 'h2');
    expect(h2.map((el) => spokenText([el]))).toEqual([
      'Contents',
      ...BANK_RULES_SECTIONS.map((s) => s.title),
    ]);
    const links = findAll(tree, (el) => el.tag === 'a').map((a) => a.attrs.href);
    for (const s of BANK_RULES_SECTIONS) {
      expect(links).toContain(`#/rules/bank/${s.id}`);
      expect(h2.some((el) => el.attrs.id === `rules-${s.id}`)).toBe(true);
    }
  });

  it('states the default rounds, the safe seven, the cap, and that the dice are one public roll', () => {
    expect(text).toContain(`${DEFAULT_RULES.rounds} rounds`);
    expect(text).toContain('70');
    expect(text).toContain(`${DEFAULT_RULES.maxRollsPerRound} rolls`);
    expect(text).toContain('nothing to hide');
    expect(text).toContain('no extra tap');
    expect(text).not.toContain('Show the dice');
    expect(text).not.toContain('Compare to');
  });

  it('draws the sample dice as pictures, not as a colour alone', () => {
    const dice = findAll(tree, (el) => el.attrs['data-testid'] === 'bank-dice');
    expect(dice).toHaveLength(1);
    expect(spokenText(dice)).toContain('Dice showing 3 and 4');
  });
});
