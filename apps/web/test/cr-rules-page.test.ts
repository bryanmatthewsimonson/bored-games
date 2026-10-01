/*
 * Rendered output of the rules page and the price card, expanded without a DOM by `renderTree`.
 */
import { chainIndex, DEFAULT_RULES } from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { formatMoney } from '../src/games/chain-reaction/model.ts';
import { PriceCard } from '../src/games/chain-reaction/price-card.tsx';
import { RULES_SECTIONS, RulesContent } from '../src/games/chain-reaction/rules-page.tsx';
import { classOf, type El, findAll, renderTree, spokenText } from './render-tree.ts';

const THEME = CHAIN_REACTION_THEME.chains as Record<string, { name: string; label: string }>;

describe('RulesContent', () => {
  const tree = renderTree(h(RulesContent, { rules: DEFAULT_RULES }));
  const text = spokenText(tree);

  it('renders a title and every section heading, each the target of a contents link', () => {
    expect(findAll(tree, (el) => el.tag === 'h1')).toHaveLength(1);
    const h2 = findAll(tree, (el) => el.tag === 'h2');
    const titles = h2.map((el) => spokenText([el]));
    expect(titles).toEqual(['Contents', ...RULES_SECTIONS.map((s) => s.title)]);
    expect(RULES_SECTIONS.map((s) => s.title)).toEqual([
      'Goal',
      'Components',
      'Setup',
      'Your turn',
      'Placing a tile',
      'Mergers',
      'Buying shares',
      'Ending the game',
      'Price card',
      'What you can see',
      'Playing online',
    ]);
    const links = findAll(tree, (el) => el.tag === 'a').map((a) => a.attrs.href);
    for (const s of RULES_SECTIONS) {
      expect(links).toContain(`#/rules/${s.id}`);
      expect(h2.some((el) => el.attrs.id === `rules-${s.id}`)).toBe(true);
    }
  });

  it('interpolates the default rules', () => {
    const r = DEFAULT_RULES;
    for (const fragment of [
      `hidden hand of ${r.handSize} tiles`,
      `starts with ${formatMoney(r.startingCash)}`,
      `${r.sharesPerChain} shares in the bank`,
      `up to ${r.maxBuyPerTurn} shares`,
      `${r.safeSize} or more tiles is safe`,
      `${r.endSize} or more tiles`,
      `${r.majorityMultiplier}× the share price`,
      `${r.minorityMultiplier}×`,
      `${r.minPlayers} to ${r.maxPlayers} players`,
      `${r.founderShares} free share`,
      `all ${r.chains.length} chains are on the board`,
      '12 columns',
      '108 spaces',
    ])
      expect(text, fragment).toContain(fragment);
  });

  it('states the tie, merger, buying and ending rules of RULES.md', () => {
    for (const fragment of [
      'both bonuses are pooled and split evenly among the tied holders. No minority bonus is paid',
      'the minority bonus is split evenly among the tied holders',
      'Every split portion rounds up to the next $100',
      'largest first',
      'the mergemaker chooses their order',
      'trade 2 for 1',
      'as many survivor shares as the bank has left',
      'once per turn',
      'stays in your hand',
      'A chain founded this turn can be bought this turn',
      'Declaring is the only way the game ends',
      // The worked examples, at the budget price of 3 tiles: $300.
      'gets $3,000, the second $1,500',
      'The pool of $4,500 splits as $2,250, rounded up to $2,300 each',
      'split $1,500 as $750, rounded up to $800 each',
    ])
      expect(text, fragment).toContain(fragment);
  });

  it('names all seven theme chains and never an engine id', () => {
    for (const id of DEFAULT_RULES.chains.map((c) => c.id)) expect(text).toContain(THEME[id]?.name);
    expect(text).not.toMatch(/\b[bsp]\d\b/);
  });

  it('embeds the price card without marks', () => {
    expect(findAll(tree, (el) => el.tag === 'table' && classOf(el).includes('cr-pc-table'))).toHaveLength(1);
    expect(findAll(tree, (el) => classOf(el).includes('cr-pc-here'))).toHaveLength(0);
    expect(findAll(tree, (el) => classOf(el).includes('cr-pc-chip'))).toHaveLength(0);
  });
});

describe('PriceCard', () => {
  const idx = (id: string): number => chainIndex(DEFAULT_RULES, id) ?? -1;
  const rowsOf = (tree: ReturnType<typeof renderTree>): El[] =>
    findAll(tree, (el) => el.tag === 'tbody').flatMap((b) => findAll(b.children, (el) => el.tag === 'tr'));

  it('heads its rows and columns for screen readers', () => {
    const tree = renderTree(h(PriceCard, { rules: DEFAULT_RULES }));
    const ths = findAll(tree, (el) => el.tag === 'th');
    expect(ths.every((th) => ['col', 'colgroup', 'row'].includes(String(th.attrs.scope)))).toBe(true);
    const groups = ths.filter((th) => th.attrs.scope === 'colgroup').map((th) => spokenText([th]));
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatch(/Budget/);
    expect(groups[2]).toMatch(/Premium/);
    for (const id of ['b1', 'b2']) expect(groups[0]).toContain(THEME[id]?.name);
    const rows = rowsOf(tree);
    expect(rows.map((tr) => spokenText(findAll([tr], (el) => el.tag === 'th')))).toEqual([
      '2',
      '3',
      '4',
      '5',
      '6–10',
      '11–20',
      '21–30',
      '31–40',
      '41+',
    ]);
    expect(spokenText([rows[8] as El])).toBe(
      [
        '41+',
        '$1,000',
        '$10,000',
        '$5,000',
        '$1,100',
        '$11,000',
        '$5,500',
        '$1,200',
        '$12,000',
        '$6,000',
      ].join(' '),
    );
  });

  it("marks each chain on the board in its current bracket's row, in its tier", () => {
    const sizes = new Array<number>(DEFAULT_RULES.chains.length).fill(0);
    sizes[idx('b2')] = 2;
    sizes[idx('s1')] = 14;
    sizes[idx('s3')] = 6;
    sizes[idx('p1')] = 45;
    sizes[idx('b1')] = 1; // not a chain on the board
    const tree = renderTree(h(PriceCard, { rules: DEFAULT_RULES, sizes }));
    const rows = rowsOf(tree);
    const chipsIn = (row: number): string[] =>
      findAll([rows[row] as El], (el) => classOf(el).includes('cr-pc-chip')).map((c) => spokenText([c]));
    const name = (id: string): string => THEME[id]?.name ?? '?';
    expect(chipsIn(0)).toEqual([`${name('b2')}, 2 tiles:`]);
    expect(chipsIn(4)).toEqual([`${name('s3')}, 6 tiles:`]);
    expect(chipsIn(5)).toEqual([`${name('s1')}, 14 tiles:`]);
    expect(chipsIn(8)).toEqual([`${name('p1')}, 45 tiles:`]);
    for (const row of [1, 2, 3, 6, 7]) expect(chipsIn(row)).toEqual([]);
    // Each chip sits in its tier's price cell, which reads "<chain>, <size> tiles: <price>".
    const priceCellOf = (row: number, tier: number): El | undefined =>
      findAll([rows[row] as El], (el) => classOf(el).includes('cr-pc-price'))[tier];
    expect(spokenText([priceCellOf(4, 1) as El])).toBe(`${name('s3')}, 6 tiles: $700`);
    expect(spokenText([priceCellOf(8, 2) as El])).toBe(`${name('p1')}, 45 tiles: $1,200`);
    // The chip shows the chain's letter, so color is never the only cue.
    const chip = findAll([priceCellOf(5, 1) as El], (el) => classOf(el).includes('cr-swatch'))[0];
    expect(chip?.children).toEqual([THEME.s1?.label]);
    // The marked tier's three cells are outlined; nothing else is.
    const here = (row: number): number =>
      findAll([rows[row] as El], (el) => classOf(el).includes('cr-pc-here')).length;
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(here)).toEqual([3, 0, 0, 0, 3, 3, 0, 0, 3]);
    expect(rows.map((tr) => classOf(tr).includes('cr-pc-current'))).toEqual([
      true,
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it('puts two chains of one tier in the same row side by side', () => {
    const sizes = new Array<number>(DEFAULT_RULES.chains.length).fill(0);
    sizes[idx('s1')] = 7;
    sizes[idx('s2')] = 9;
    const rows = rowsOf(renderTree(h(PriceCard, { rules: DEFAULT_RULES, sizes })));
    const chips = findAll([rows[4] as El], (el) => classOf(el).includes('cr-pc-chip')).map((c) =>
      spokenText([c]),
    );
    expect(chips).toEqual([`${THEME.s1?.name}, 7 tiles:`, `${THEME.s2?.name}, 9 tiles:`]);
  });
});
