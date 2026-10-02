/*
 * The public site names the published game Chain Reaction implements only inside the allowed phrase "Compare to
 * <title>" (D053). The build scans prove no source or bundle holds the bare title as a literal; this test proves
 * the rendered catalog and game page do not show it either (a `{compareTo.title}` in the UI would pass the build
 * scans, since the title is cut from the phrase at run time). It renders them with the trademark-safe names, takes
 * every text and attribute, and runs the same scanner the guards use, which removes only the exact phrase.
 */
import { COMPARE_PHRASE } from '@bored-games/chain-reaction/compare';
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
import { renderTree } from './render-tree.ts';

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
    expect(findRestricted(withoutAllowedPhrases(pages.join('\n')), strings)).toEqual([]);
  });

  it('would catch the title rendered on its own', () => {
    const cr = catalogItems().find((i) => i.entry.id === 'chain-reaction');
    const title = cr?.entry.compareTo?.title ?? '';
    expect(findRestricted(textOf(h('p', null, `Made by the makers of ${title}.`)), strings)).not.toEqual([]);
  });
});
