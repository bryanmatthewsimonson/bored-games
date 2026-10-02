import { describe, expect, it } from 'vitest';
import {
  gameHref,
  gamePageHref,
  parseRoute,
  route,
  rulesHref,
  startRouter,
  tableHref,
} from '../src/router.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('parseRoute', () => {
  it('parses home in its spellings', () => {
    for (const h of ['', '#', '#/', '/']) expect(parseRoute(h)).toEqual({ name: 'home' });
  });

  it('parses a table', () => {
    expect(parseRoute(`#/t/${A}/my-table_1.x`)).toEqual({
      name: 'table',
      creator: A,
      tableId: 'my-table_1.x',
    });
  });

  it('parses a game', () => {
    expect(parseRoute(`#/g/${B}`)).toEqual({ name: 'game', rootId: B });
  });

  it("parses a game's catalog page (D046)", () => {
    expect(parseRoute('#/games/chess')).toEqual({ name: 'game-page', game: 'chess' });
    expect(parseRoute('#/games/chain-reaction/')).toEqual({ name: 'game-page', game: 'chain-reaction' });
    expect(parseRoute(gamePageHref('chess'))).toEqual({ name: 'game-page', game: 'chess' });
    expect(parseRoute('#/games/Chess').name).toBe('not-found');
    expect(parseRoute('#/games').name).toBe('not-found');
  });

  it('ignores a trailing slash', () => {
    expect(parseRoute(`#/g/${B}/`)).toEqual({ name: 'game', rootId: B });
  });

  it("parses a game's rules page, with or without a section", () => {
    expect(parseRoute('#/rules/chain-reaction')).toEqual({
      name: 'rules',
      game: 'chain-reaction',
      section: null,
    });
    expect(parseRoute('#/rules/chain-reaction/')).toEqual({
      name: 'rules',
      game: 'chain-reaction',
      section: null,
    });
    expect(parseRoute('#/rules/chess')).toEqual({ name: 'rules', game: 'chess', section: null });
    expect(parseRoute('#/rules/chess/special')).toEqual({ name: 'rules', game: 'chess', section: 'special' });
    expect(parseRoute('#/rules/chain-reaction/mergers')).toEqual({
      name: 'rules',
      game: 'chain-reaction',
      section: 'mergers',
    });
    // An unknown game with a section parses; the screen shows Page not found.
    expect(parseRoute('#/rules/go/ko')).toEqual({ name: 'rules', game: 'go', section: 'ko' });
    for (const h of ['#/rules/Mergers', '#/rules/a/b/c', '#/rulesx', `#/rules/${'x'.repeat(33)}`])
      expect(parseRoute(h), h).toEqual({ name: 'not-found', hash: h });
  });

  it('maps the old #/rules[/<section>] links to Chain Reaction', () => {
    expect(parseRoute('#/rules')).toEqual({ name: 'rules', game: 'chain-reaction', section: null });
    expect(parseRoute('#/rules/')).toEqual({ name: 'rules', game: 'chain-reaction', section: null });
    expect(parseRoute('#/rules/price-card')).toEqual({
      name: 'rules',
      game: 'chain-reaction',
      section: 'price-card',
    });
  });

  it('parses a dev preview page, with or without a scene', () => {
    expect(parseRoute('#/dev/board')).toEqual({ name: 'dev', page: 'board', scene: null });
    expect(parseRoute('#/dev/board/merger')).toEqual({ name: 'dev', page: 'board', scene: 'merger' });
    expect(parseRoute('#/dev/Board')).toEqual({ name: 'not-found', hash: '#/dev/Board' });
    expect(parseRoute('#/dev/a/b/c')).toEqual({ name: 'not-found', hash: '#/dev/a/b/c' });
  });

  it('rejects malformed routes as not-found', () => {
    for (const h of [
      '#/t/abc/x',
      `#/t/${A}`,
      `#/t/${A}/bad id`,
      `#/t/${A}/${'x'.repeat(65)}`,
      `#/t/${A.toUpperCase()}/x`,
      `#/g/${A}/extra`,
      '#/g/xyz',
      '#/nope',
    ]) {
      expect(parseRoute(h), h).toEqual({ name: 'not-found', hash: h });
    }
  });

  it('builds hrefs that parse back', () => {
    expect(parseRoute(tableHref(A, 't-1'))).toEqual({ name: 'table', creator: A, tableId: 't-1' });
    expect(parseRoute(gameHref(B))).toEqual({ name: 'game', rootId: B });
    expect(parseRoute(rulesHref('chain-reaction'))).toEqual({
      name: 'rules',
      game: 'chain-reaction',
      section: null,
    });
    expect(parseRoute(rulesHref('chain-reaction', 'mergers'))).toEqual({
      name: 'rules',
      game: 'chain-reaction',
      section: 'mergers',
    });
  });
});

describe('startRouter', () => {
  it('keeps the route signal in step with hashchange and stops when asked', () => {
    let hash = '';
    let listener: (() => void) | undefined;
    const win = {
      location: {
        get hash() {
          return hash;
        },
      },
      addEventListener: (_: 'hashchange', fn: () => void) => {
        listener = fn;
      },
      removeEventListener: () => {
        listener = undefined;
      },
    };
    const stop = startRouter(win);
    expect(route.value).toEqual({ name: 'home' });
    hash = `#/g/${B}`;
    listener?.();
    expect(route.value).toEqual({ name: 'game', rootId: B });
    stop();
    expect(listener).toBeUndefined();
  });
});
