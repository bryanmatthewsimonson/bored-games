/*
 * Rendered output of the Chain Reaction hand, expanded without a DOM by `renderTree` (the hand uses no hooks).
 */
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { Hand } from '../src/games/chain-reaction/hand.tsx';
import type { HandTile } from '../src/games/chain-reaction/model.ts';
import { classOf, findAll, renderTree, textOf } from './render-tree.ts';

const known: HandTile = {
  pos: 20,
  tile: 0,
  id: '1A',
  cls: { kind: 'lone' },
  badge: 'playable',
  preview: 'Placed alone',
};
const drawn: HandTile = {
  pos: 21,
  tile: null,
  id: null,
  cls: null,
  badge: null,
  preview: 'New tile, being revealed',
};

function render(tiles: readonly HandTile[]) {
  return renderTree(
    h(Hand, {
      tiles,
      placeable: new Set<number>(),
      showBadges: true,
      selected: null,
      disabled: false,
      onSelect: () => {},
      onPreview: () => {},
    }),
  );
}

describe('Hand', () => {
  it('shows a tile not revealed yet as a new tile being revealed, with a visible status note (D039)', () => {
    const tree = render([known, drawn]);
    const [unknown, ...rest] = findAll(tree, (el) => classOf(el).includes('cr-tile-unknown'));
    expect(rest).toEqual([]);
    expect(unknown?.attrs.role).toBe('img');
    expect(unknown?.attrs['aria-label']).toBe('New tile, being revealed');
    expect(String(unknown?.attrs.title)).toMatch(/^New tile, being revealed/);
    // A "…" glyph and a "new" badge, both for the eye only: the label speaks for them.
    expect(findAll([unknown as never], (el) => classOf(el).includes('cr-tile-id'))[0]?.children).toEqual([
      '…',
    ]);
    expect(findAll([unknown as never], (el) => classOf(el).includes('cr-tile-badge'))[0]?.children).toEqual([
      'new',
    ]);
    // Tooltips do not work on touch: a status note says the same in the page.
    const notes = findAll(tree, (el) => el.attrs.role === 'status');
    expect(notes).toHaveLength(1);
    expect(textOf(notes)).toBe(
      'Your new tile is being revealed. It shows once every other player’s browser has sent its part, ' +
        'usually within seconds while they have the game open.',
    );
    expect(textOf(tree)).not.toContain('?');
  });

  it('has no status note when every tile is known', () => {
    const tree = render([known]);
    expect(findAll(tree, (el) => classOf(el).includes('cr-tile-unknown'))).toEqual([]);
    expect(findAll(tree, (el) => el.attrs.role === 'status')).toEqual([]);
    expect(textOf(tree)).toContain('1A');
  });
});
