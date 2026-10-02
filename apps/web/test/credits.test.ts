/*
 * The credits page (#/credits): the piece set's copyright notice and the whole BSD-3 text, the same as the
 * LICENSE.txt shipped beside the images.
 */
import { readFileSync } from 'node:fs';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { CBURNETT_CREDIT } from '../src/games/chess/pieces/credit.ts';
import { creditsHref, parseRoute } from '../src/router.ts';
import { CreditsScreen } from '../src/screens/credits.tsx';
import { findAll, renderTree, spokenText } from './render-tree.ts';

const words = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('credits', () => {
  it('has a route', () => {
    expect(creditsHref()).toBe('#/credits');
    expect(parseRoute('#/credits')).toEqual({ name: 'credits' });
    expect(parseRoute('#/credits/')).toEqual({ name: 'credits' });
  });

  it('shows the piece set with its copyright notice and the full BSD 3-Clause text', () => {
    const tree = renderTree(h(CreditsScreen, {}));
    const text = words(spokenText(tree));
    expect(text).toContain('Colin M. L. Burnett');
    expect(text).toContain('Copyright (c) 2006, Colin M. L. Burnett');
    expect(text).toContain('BSD 3-Clause License');
    for (const t of CBURNETT_CREDIT.text) expect(text).toContain(words(t));
    expect(findAll(tree, (el) => el.tag === 'h1').map((el) => spokenText([el]))).toEqual(['Credits']);
  });

  it('matches the LICENSE.txt beside the images', () => {
    const file = words(
      readFileSync(new URL('../src/games/chess/pieces/LICENSE.txt', import.meta.url), 'utf8'),
    );
    expect(file).toContain(CBURNETT_CREDIT.copyright);
    for (const t of CBURNETT_CREDIT.text) expect(file).toContain(words(t));
  });
});
