/*
 * The Chain Reaction theme is a parameter (D046): every chain name the model produces (board, hand, decisions,
 * status, log, price card) comes from the theme it is given, and the looks stay the same under every pack.
 */

import { type ChainReactionAction, chainReaction, DEFAULT_RULES } from '@bored-games/chain-reaction';
import { ORIGINAL_BRAND } from '@bored-games/chain-reaction/licensed/original';
import {
  CHAIN_REACTION_THEME,
  CHAIN_SLOTS,
  type ChainReactionBrand,
  type ChainReactionTheme,
  chainReactionTheme,
  SAFE_BRAND,
} from '@bored-games/chain-reaction/theme';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { playUntil, randomLegal } from '../src/games/chain-reaction/fixture.ts';
import {
  boardCells,
  chainView,
  decisionFor,
  handTiles,
  logLines,
  nameOfChainId,
  priceCard,
  statusLine,
} from '../src/games/chain-reaction/model.ts';
import { PriceCard } from '../src/games/chain-reaction/price-card.tsx';
import { RulesContent } from '../src/games/chain-reaction/rules-page.tsx';
import { renderTree, spokenText } from './render-tree.ts';

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];

/** A made-up pack, to tell its names from the safe ones. */
const TEST_BRAND: ChainReactionBrand = {
  id: 'test',
  gameTitle: 'Test Title',
  tagline: 'Test tagline.',
  summary: 'Test summary.',
  aliases: ['Test Alias'],
  chains: {
    b1: { name: 'Amber' },
    b2: { name: 'Birch' },
    s1: { name: 'Cedar' },
    s2: { name: 'Dune' },
    s3: { name: 'Elm' },
    p1: { name: 'Fern' },
    p2: { name: 'Grove' },
  },
};

const nameList = (b: ChainReactionBrand): string[] => CHAIN_SLOTS.map((s) => b.chains[s].name);
const mentions = (text: string, names: readonly string[]): string[] =>
  names.filter((n) => new RegExp(`\\b${n}\\b`).test(text));

/** The names that appear in `text`, even run together with the next word (inline spans). */
const contains = (text: string, names: readonly string[]): string[] => names.filter((n) => text.includes(n));

/** Everything the model writes about one game, under `theme`: board, hands, decisions, status and log. */
function textOfGame(theme: ChainReactionTheme): string {
  const out: string[] = [];
  const g = playUntil(
    'theme',
    4,
    randomLegal,
    (g) => {
      const s = g.state;
      out.push(JSON.stringify(boardCells(theme, s, g.lastTile)));
      for (let seat = 0; seat < 4; seat++) out.push(JSON.stringify(handTiles(theme, s, seat)));
      const p = chainReaction.pending(s);
      if (p.type === 'player') {
        const legal = chainReaction.legalActions(s, p.seat) as ChainReactionAction[];
        out.push(JSON.stringify(decisionFor(theme, s, legal)));
      }
      out.push(statusLine(theme, s, NAMES, null));
      return s.phase.kind === 'over';
    },
    5000,
  );
  if (g === null) throw new Error('the scripted game did not end');
  expect(g.state.phase.kind).toBe('over');
  out.push(...logLines(g.events, { theme, mySeat: null, over: true, names: NAMES }));
  out.push(...logLines(g.events, { theme, mySeat: 0, over: false, names: NAMES }, Number.POSITIVE_INFINITY));
  return out.join('\n');
}

/** Checks that the model names chains from `brand` only, never from `other`. */
function expectNamesFrom(brand: ChainReactionBrand, other: ChainReactionBrand): void {
  const theme = chainReactionTheme(brand);
  const text = textOfGame(theme);
  expect(mentions(text, nameList(brand)).length).toBeGreaterThanOrEqual(3);
  expect(mentions(text, nameList(other))).toEqual([]);

  const card = priceCard(theme, DEFAULT_RULES);
  expect(card.tiers.flatMap((t) => t.chains.map((c) => c.name))).toEqual(nameList(brand));
  DEFAULT_RULES.chains.forEach((c, i) => {
    const v = chainView(theme, DEFAULT_RULES, i);
    const safe = chainView(CHAIN_REACTION_THEME, DEFAULT_RULES, i);
    expect(v.name).toBe(brand.chains[c.id as keyof ChainReactionBrand['chains']].name);
    expect(nameOfChainId(theme, c.id)).toBe(v.name);
    // The looks belong to the slot, whatever the names.
    expect([v.label, v.color, v.pattern]).toEqual([safe.label, safe.color, safe.pattern]);
  });
  expect(theme.title).toBe(brand.gameTitle);
}

describe('the theme as a parameter', () => {
  it('names chains from the safe pack', () => expectNamesFrom(SAFE_BRAND, TEST_BRAND));
  it('names chains from another pack', () => expectNamesFrom(TEST_BRAND, SAFE_BRAND));
  it('names chains from the licensed original pack, and only from it', () => {
    expectNamesFrom(ORIGINAL_BRAND, SAFE_BRAND);
    expectNamesFrom(SAFE_BRAND, ORIGINAL_BRAND);
  });

  it('builds the safe theme from the safe pack', () => {
    expect(chainReactionTheme(SAFE_BRAND)).toEqual(CHAIN_REACTION_THEME);
    expect(CHAIN_REACTION_THEME.brand).toBe('safe');
  });

  it('renders the rules page and the price card in the pack given', () => {
    for (const [brand, other] of [
      [ORIGINAL_BRAND, SAFE_BRAND],
      [SAFE_BRAND, ORIGINAL_BRAND],
    ] as const) {
      const theme = chainReactionTheme(brand);
      const rules = spokenText(renderTree(h(RulesContent, { theme })));
      expect(rules).toContain(`How to play ${brand.gameTitle}`);
      expect(contains(rules, nameList(brand))).toEqual(nameList(brand));
      expect(contains(rules, [...nameList(other), other.gameTitle])).toEqual([]);
      const card = spokenText(
        renderTree(h(PriceCard, { theme, rules: DEFAULT_RULES, sizes: [2, 0, 0, 0, 0, 0, 3] })),
      );
      expect(contains(card, nameList(brand))).toEqual(nameList(brand));
      expect(contains(card, nameList(other))).toEqual([]);
    }
  });
});
