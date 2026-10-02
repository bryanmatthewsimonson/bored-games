/*
 * The Chain Reaction hand and its "?" popover, expanded without a DOM by `renderTree` (the hand and
 * `UnknownTile` use no hooks; the popover state lives in the game component), plus the popover's pure reducer.
 */
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import {
  Hand,
  HIDDEN_TILE_HELP,
  HIDDEN_TILE_NOTE,
  NOT_REVEALED,
  TIP_CLOSED,
  type TipEvent,
  type TipState,
  tipId,
  tipReducer,
} from '../src/games/chain-reaction/hand.tsx';
import type { HandTile } from '../src/games/chain-reaction/model.ts';
import { classOf, type El, findAll, renderTree, spokenText, textOf } from './render-tree.ts';

const known: HandTile = {
  pos: 20,
  tile: 0,
  id: '1A',
  cls: { kind: 'lone' },
  badge: 'playable',
  preview: 'Stays unincorporated',
};
const drawn: HandTile = { pos: 21, tile: null, id: null, cls: null, badge: null, preview: 'Hidden tile' };

function render(
  tiles: readonly HandTile[],
  opts: { ended?: boolean; tip?: TipState; onTip?: (e: TipEvent) => void } = {},
) {
  return renderTree(
    h(Hand, {
      tiles,
      placeable: new Set<number>(),
      showBadges: true,
      selected: null,
      disabled: false,
      onSelect: () => {},
      onPreview: () => {},
      ended: opts.ended ?? false,
      tip: opts.tip ?? TIP_CLOSED,
      onTip: opts.onTip ?? (() => {}),
    }),
  );
}

const unknownButton = (tree: ReturnType<typeof render>): El => {
  const [b, ...rest] = findAll(tree, (el) => el.tag === 'button' && classOf(el).includes('cr-tile-unknown'));
  expect(rest).toEqual([]);
  if (!b) throw new Error('no "?" button');
  return b;
};
const popover = (tree: ReturnType<typeof render>): El => {
  const [p] = findAll(tree, (el) => el.attrs.role === 'tooltip');
  if (!p) throw new Error('no popover');
  return p;
};

describe('Hand: the "?" tile', () => {
  it('is a focusable button described by its popover, which is hidden until opened', () => {
    const tree = render([known, drawn]);
    const b = unknownButton(tree);
    expect(b.attrs.type).toBe('button');
    expect(b.attrs['aria-label']).toBe('Hidden tile');
    expect(b.attrs['aria-expanded']).toBe(false);
    const tip = popover(tree);
    expect(tip.attrs.id).toBe(tipId(21));
    expect(b.attrs['aria-describedby']).toBe(tip.attrs.id);
    expect(b.attrs['aria-controls']).toBe(tip.attrs.id);
    expect(tip.attrs.hidden).toBe(true);
    expect(textOf([tip])).toBe(HIDDEN_TILE_HELP);
    // The "?" and "new" are for the eye only: the label and the description speak for them.
    expect(spokenText([b])).toBe('');
    expect(textOf([b])).toContain('?');
  });

  it('says why the tile is hidden and that it is revealed before the next turn', () => {
    expect(HIDDEN_TILE_HELP).toMatch(/^Your new tile\. It’s yours already/);
    expect(HIDDEN_TILE_HELP).toContain('until every other player has made their next move');
    expect(HIDDEN_TILE_HELP).toContain('not even the app');
    expect(HIDDEN_TILE_HELP).toMatch(/always revealed before your next turn\.$/);
  });

  it('shows the popover and marks the button expanded when its tile is the open one', () => {
    const tree = render([known, drawn], { tip: { pos: 21, pinned: true } });
    expect(unknownButton(tree).attrs['aria-expanded']).toBe(true);
    expect(popover(tree).attrs.hidden).toBe(false);
    // Another tile's open state does not open this one.
    const other = render([known, drawn], { tip: { pos: 99, pinned: false } });
    expect(popover(other).attrs.hidden).toBe(true);
  });

  it('sends click, blur, Escape and mouse hover events to the parent; touch hover is ignored', () => {
    const sent: TipEvent[] = [];
    const tree = render([drawn], { tip: { pos: 21, pinned: true }, onTip: (e) => sent.push(e) });
    const b = unknownButton(tree);
    const call = (el: El, name: string, ev: unknown) => (el.attrs[name] as (e: unknown) => void)(ev);
    call(b, 'onClick', {});
    call(b, 'onBlur', {});
    const esc = { key: 'Escape', preventDefault: () => {}, stopPropagation: () => {} };
    call(b, 'onKeyDown', esc);
    call(b, 'onKeyDown', { ...esc, key: 'a' });
    const [wrap] = findAll(tree, (el) => classOf(el).includes('cr-unknown'));
    if (!wrap) throw new Error('no wrapper');
    call(wrap, 'onPointerEnter', { pointerType: 'mouse' });
    call(wrap, 'onPointerLeave', { pointerType: 'mouse' });
    call(wrap, 'onPointerEnter', { pointerType: 'touch' });
    call(wrap, 'onPointerLeave', { pointerType: 'pen' });
    expect(sent).toEqual([
      { type: 'click', pos: 21 },
      { type: 'close' },
      { type: 'close' },
      { type: 'enter', pos: 21 },
      { type: 'leave', pos: 21 },
    ]);
  });

  it('shows a one-line note under the hand while a tile is hidden, and none otherwise', () => {
    const note = (tree: ReturnType<typeof render>) =>
      findAll(tree, (el) => classOf(el).includes('cr-hidden-note')).map((el) => textOf([el]));
    expect(note(render([known, drawn]))).toEqual([HIDDEN_TILE_NOTE]);
    expect(note(render([known]))).toEqual([]);
    expect(note(render([known, drawn], { ended: true }))).toEqual([]);
  });

  it('is a plain "?" with no popover once the game has ended without its reveal', () => {
    const tree = render([known, drawn], { ended: true });
    expect(findAll(tree, (el) => el.attrs.role === 'tooltip')).toEqual([]);
    const [img] = findAll(tree, (el) => classOf(el).includes('cr-tile-unknown'));
    expect(img?.tag).toBe('span');
    expect(img?.attrs.role).toBe('img');
    expect(img?.attrs['aria-label']).toBe(NOT_REVEALED);
  });

  it('keeps known tiles as buttons with their badge', () => {
    const tree = render([known, drawn]);
    const tiles = findAll(tree, (el) => el.tag === 'button');
    expect(tiles).toHaveLength(2);
    expect(tiles[0]?.attrs['aria-label']).toBe('1A, playable: Stays unincorporated');
  });
});

describe('tipReducer', () => {
  const open = (pos: number, pinned: boolean): TipState => ({ pos, pinned });

  it('opens on hover and closes when the pointer leaves', () => {
    const s = tipReducer(TIP_CLOSED, { type: 'enter', pos: 3 });
    expect(s).toEqual(open(3, false));
    expect(tipReducer(s, { type: 'leave', pos: 3 })).toEqual(TIP_CLOSED);
    // Leaving another tile does not close this one.
    expect(tipReducer(s, { type: 'leave', pos: 4 })).toBe(s);
  });

  it('pins on a click or tap, and a second click on the same tile closes it', () => {
    const pinned = tipReducer(TIP_CLOSED, { type: 'click', pos: 3 });
    expect(pinned).toEqual(open(3, true));
    expect(tipReducer(pinned, { type: 'click', pos: 3 })).toEqual(TIP_CLOSED);
    // A click while hovering pins the hover popover, so it stays after the pointer leaves.
    const hovered = tipReducer(TIP_CLOSED, { type: 'enter', pos: 3 });
    const kept = tipReducer(hovered, { type: 'click', pos: 3 });
    expect(kept).toEqual(open(3, true));
    expect(tipReducer(kept, { type: 'leave', pos: 3 })).toBe(kept);
    // Clicking another hidden tile moves the pinned popover there.
    expect(tipReducer(pinned, { type: 'click', pos: 4 })).toEqual(open(4, true));
  });

  it('ignores hovers while pinned, and closes on Escape, blur or a tap elsewhere', () => {
    const pinned = open(3, true);
    expect(tipReducer(pinned, { type: 'enter', pos: 4 })).toBe(pinned);
    expect(tipReducer(pinned, { type: 'close' })).toEqual(TIP_CLOSED);
    expect(tipReducer(open(3, false), { type: 'close' })).toEqual(TIP_CLOSED);
  });
});
