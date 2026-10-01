import { describe, expect, it } from 'vitest';
import { gameHref, parseRoute, route, rulesHref, startRouter, tableHref } from '../src/router.ts';

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

  it('ignores a trailing slash', () => {
    expect(parseRoute(`#/g/${B}/`)).toEqual({ name: 'game', rootId: B });
  });

  it('parses the rules page, with or without a section', () => {
    expect(parseRoute('#/rules')).toEqual({ name: 'rules', section: null });
    expect(parseRoute('#/rules/')).toEqual({ name: 'rules', section: null });
    expect(parseRoute('#/rules/price-card')).toEqual({ name: 'rules', section: 'price-card' });
    for (const h of ['#/rules/Mergers', '#/rules/a/b', '#/rulesx', `#/rules/${'x'.repeat(33)}`])
      expect(parseRoute(h), h).toEqual({ name: 'not-found', hash: h });
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
    expect(parseRoute(rulesHref())).toEqual({ name: 'rules', section: null });
    expect(parseRoute(rulesHref('mergers'))).toEqual({ name: 'rules', section: 'mergers' });
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
