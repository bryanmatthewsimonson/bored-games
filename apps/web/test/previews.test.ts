/*
 * The game-page screenshots (D086): every hosted game has three, each file is in public/previews/ at the size its
 * entry gives, and the page shows them with their captions.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { GamePreviews } from '../src/components/game-previews.tsx';
import { GAME_IDS } from '../src/games/ids.ts';
import { GAME_PREVIEWS, previewSrc } from '../src/games/previews.ts';
import { findAll, renderTree } from './render-tree.ts';

const dir = fileURLToPath(new URL('../public/previews/', import.meta.url));

/** A JPEG's width and height, from its first start-of-frame marker. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let i = 2;
  while (i < bytes.length) {
    const marker = bytes[i + 1] ?? 0;
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0),
        width: ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0),
      };
    }
    i += 2 + length;
  }
  throw new Error('no frame header');
}

describe('game previews', () => {
  it('lists three pictures for every hosted game, and only for them', () => {
    expect(Object.keys(GAME_PREVIEWS).sort()).toEqual([...GAME_IDS].sort());
    for (const id of GAME_IDS) expect(GAME_PREVIEWS[id]).toHaveLength(3);
  });

  it('has each file at the size its entry gives', () => {
    for (const previews of Object.values(GAME_PREVIEWS)) {
      for (const p of previews) {
        const size = jpegSize(readFileSync(`${dir}${p.file}`));
        expect(size, p.file).toEqual({ width: p.width, height: p.height });
      }
    }
  });

  it('shows each picture with its caption and a name for screen readers', () => {
    const tree = renderTree(h(GamePreviews, { game: 'holler', title: 'Holler' }));
    const imgs = findAll(tree, (el) => el.tag === 'img');
    expect(imgs.map((img) => img.attrs.src)).toEqual((GAME_PREVIEWS.holler ?? []).map(previewSrc));
    for (const img of imgs) expect(String(img.attrs.alt)).toMatch(/^Holler in progress: /);
    expect(findAll(tree, (el) => el.tag === 'figcaption')).toHaveLength(3);
  });
});
