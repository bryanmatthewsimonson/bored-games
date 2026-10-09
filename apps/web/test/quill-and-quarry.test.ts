import { catalogProblems } from '@bored-games/game-kit';
import { quillAndQuarry } from '@bored-games/quill-and-quarry';
import { QUILL_CATALOG } from '@bored-games/quill-and-quarry/catalog';
import { createElement } from 'preact';
import { expect, it } from 'vitest';
import { QuarryArt } from '../src/games/quill-and-quarry/art.tsx';
import { QuillRulesContent } from '../src/games/quill-and-quarry/rules-page.tsx';
import { findAll, renderTree, spokenText } from './render-tree.ts';

it('explains the exact dictionary and challenge contract before a player joins', () => {
  const tree = renderTree(createElement(QuillRulesContent, {})),
    text = spokenText(tree);
  expect(text).toContain('It does not contain a word list');
  expect(text).toContain('six consecutive scoreless turns');
  expect(text).toContain('50 points');
  expect(text).toContain('at least seven tiles');
  expect(text).toContain('an unsuccessful challenge costs your next turn');
  expect(findAll(tree, (e) => e.tag === 'h2').map((e) => e.attrs.id)).toEqual([
    'rules-start',
    'rules-play',
    'rules-score',
    'rules-challenge',
    'rules-end',
    'rules-online',
  ]);
});
it('provides original vector artwork and a consistent catalog entry', () => {
  expect(catalogProblems(QUILL_CATALOG, quillAndQuarry)).toEqual([]);
  const art = renderTree(createElement(QuarryArt, {}));
  expect(findAll(art, (e) => e.tag === 'svg')).toHaveLength(1);
  expect(findAll(art, (e) => e.tag === 'image')).toHaveLength(0);
  expect(findAll(art, (e) => e.tag === 'path').length).toBeGreaterThan(5);
});
