/*
 * The Chain Reaction theme is a parameter (D046): every chain name the model produces (board, hand, decisions,
 * status, log, price card) comes from the theme it is given. The looks are the safe ones unless the pack brings its
 * own (D053: the licensed original pack brings the original colors and initials), and the patterns never change.
 */

import { type ChainReactionAction, chainReaction, DEFAULT_RULES } from '@bored-games/chain-reaction';
import { ORIGINAL_BRAND } from '@bored-games/chain-reaction/licensed/original';
import {
  CHAIN_REACTION_THEME,
  CHAIN_SLOTS,
  type ChainReactionBrand,
  type ChainReactionTheme,
  type ChainSlot,
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
    // The looks belong to the slot: the pack's own when it has them, else the safe ones.
    const own = brand.looks?.[c.id as ChainSlot];
    expect([v.label, v.color, v.pattern]).toEqual(
      own === undefined ? [safe.label, safe.color, safe.pattern] : [own.label, own.color, own.pattern],
    );
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

  it('keeps the safe looks unchanged: letters outside A-I, distinct colors, one pattern each', () => {
    expect(SAFE_BRAND.looks).toBeUndefined();
    const looks = CHAIN_SLOTS.map((s) => CHAIN_REACTION_THEME.chains[s]);
    expect(looks.map((l) => l.label)).toEqual(['J', 'L', 'O', 'Q', 'R', 'S', 'T']);
    expect(looks.map((l) => l.color)).toEqual([
      '#2e9d6b',
      '#2f5fb3',
      '#3b3b44',
      '#c98bb9',
      '#b8333f',
      '#1d3f8f',
      '#d99a2b',
    ]);
    expect(looks.map((l) => l.pattern)).toEqual([
      'solid',
      'stripes',
      'dots',
      'grid',
      'diagonal',
      'waves',
      'checks',
    ]);
    // A pack without looks (the test pack) gets exactly the safe ones.
    for (const s of CHAIN_SLOTS) {
      const { name: _, ...look } = chainReactionTheme(TEST_BRAND).chains[s];
      const { name: __, ...safe } = CHAIN_REACTION_THEME.chains[s];
      expect(look).toEqual(safe);
    }
  });

  it("uses a pack's own looks for the slots it gives, and the safe looks for the others", () => {
    const own = { label: 'X', color: '#123456', pattern: 'dots' } as const;
    const theme = chainReactionTheme({ ...TEST_BRAND, looks: { s2: own } });
    expect(theme.chains.s2).toEqual({ name: 'Dune', ...own });
    for (const s of CHAIN_SLOTS.filter((x) => x !== 's2')) {
      const { name: _, ...look } = theme.chains[s];
      const { name: __, ...safe } = CHAIN_REACTION_THEME.chains[s];
      expect(look, s).toEqual(safe);
    }
  });

  it('gives the original pack a complete set of looks: initials, distinct colors, the safe patterns', () => {
    const theme = chainReactionTheme(ORIGINAL_BRAND);
    for (const s of CHAIN_SLOTS) {
      const look = ORIGINAL_BRAND.looks?.[s];
      expect(look, s).toBeDefined();
      expect(theme.chains[s]).toEqual({ name: ORIGINAL_BRAND.chains[s].name, ...look });
      expect(look?.label).toBe(ORIGINAL_BRAND.chains[s].name.charAt(0));
      expect(look?.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(look?.color).not.toBe(CHAIN_REACTION_THEME.chains[s].color);
      expect(look?.pattern).toBe(CHAIN_REACTION_THEME.chains[s].pattern);
    }
    const looks = CHAIN_SLOTS.map((s) => theme.chains[s]);
    expect(new Set(looks.map((l) => l.label)).size).toBe(7);
    expect(new Set(looks.map((l) => l.color)).size).toBe(7);
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
