/*
 * The public site names the published games Chain Reaction and Luster implement only inside the allowed phrases
 * "Compare to <title>" (D053, D060). The build scans prove no source or bundle holds the bare title as a literal; this test proves
 * the rendered catalog and game page do not show it either (a `{compareTo.title}` in the UI would pass the build
 * scans, since the title is cut from the phrase at run time). It renders them with the trademark-safe names, takes
 * every text and attribute, and runs the same scanner the guards use, which removes only the exact phrase.
 */
import { COMPARE_PHRASE } from '@bored-games/chain-reaction/compare';
import { COMPARE_PHRASE as LUSTER_COMPARE_PHRASE } from '@bored-games/luster/compare';
import { h } from 'preact';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  findRestricted,
  licensedPackStrings,
  withoutAllowedPhrases,
} from '../../../tests/restricted-names.ts';
import { chooseBranding, setLicensedPacks } from '../src/brands.ts';
import { catalogItems, GameCard } from '../src/components/game-catalog.tsx';
import { GameFacts, GameHead } from '../src/screens/game-page.tsx';
import { renderTree, spokenText } from './render-tree.ts';

const root = new URL('../../..', import.meta.url).pathname;

let strings: string[] = [];
beforeAll(async () => {
  strings = await licensedPackStrings(root);
});

/** Everything a render shows or carries: text, attributes and links. */
const textOf = (node: Parameters<typeof renderTree>[0]): string => JSON.stringify(renderTree(node));

describe('the rendered public pages', () => {
  it('show the published title only inside "Compare to <title>"', () => {
    chooseBranding('safe');
    setLicensedPacks(null);
    const items = catalogItems();
    const cr = items.find((i) => i.entry.id === 'chain-reaction');
    if (cr === undefined) throw new Error('Chain Reaction is in the catalog');
    const luster = items.find((i) => i.entry.id === 'luster');
    if (luster === undefined) throw new Error('Luster is in the catalog');
    const pages = [
      textOf(items.map((item) => h(GameCard, { item }))),
      ...items.flatMap((item) => [
        textOf(h(GameHead, { item })),
        textOf(h(GameFacts, { entry: item.entry })),
      ]),
    ];
    expect(strings.length).toBeGreaterThan(0);
    for (const text of pages) expect(findRestricted(text, strings)).toEqual([]);
    // The phrase is there, on the card and on the game page, and nothing restricted is left once it is removed.
    const crPage = textOf(h(GameFacts, { entry: cr.entry }));
    expect(pages[0]).toContain(COMPARE_PHRASE);
    expect(crPage).toContain(COMPARE_PHRASE);
    expect(crPage).toContain('the makers of that game');
    const lusterPage = textOf(h(GameFacts, { entry: luster.entry }));
    expect(pages[0]).toContain(LUSTER_COMPARE_PHRASE);
    expect(lusterPage).toContain(LUSTER_COMPARE_PHRASE);
    expect(lusterPage).toContain('https://boardgamegeek.com/boardgame/148228');
    expect(lusterPage).toContain('the makers of that game');
    expect(lusterPage).not.toContain(COMPARE_PHRASE);
    expect(findRestricted(withoutAllowedPhrases(pages.join('\n')), strings)).toEqual([]);
  });

  it("links a game's own BoardGameGeek entry (Chess, Bank), never alongside a Compare-to link", () => {
    const facts = (id: string) => {
      const game = catalogItems().find((i) => i.entry.id === id);
      if (game === undefined) throw new Error(id);
      return h(GameFacts, { entry: game.entry });
    };
    for (const [id, bgg] of [
      ['chess', 171],
      ['bank', 412804],
    ] as const) {
      expect(spokenText(renderTree(facts(id))), id).toContain('BoardGameGeek');
      expect(textOf(facts(id)), id).toContain(`https://boardgamegeek.com/boardgame/${bgg}`);
      expect(textOf(facts(id)), id).not.toContain('Compare to');
    }
    for (const id of ['chain-reaction', 'luster'])
      expect(spokenText(renderTree(facts(id))), id).not.toContain('BoardGameGeek');
  });

  it('would catch either title rendered on its own', () => {
    for (const id of ['chain-reaction', 'luster']) {
      const game = catalogItems().find((i) => i.entry.id === id);
      const title = game?.entry.compareTo?.title ?? '';
      expect(title, id).not.toBe('');
      expect(findRestricted(textOf(h('p', null, `Made by the makers of ${title}.`)), strings)).not.toEqual(
        [],
      );
    }
  });
});
