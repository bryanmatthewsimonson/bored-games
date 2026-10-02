/*
 * The rules catalogs of every game (CLAUDE.md, D045): each `#### Cnn` entry in docs/games/<id>/RULES.md has a test
 * in packages/games/<id>/test/catalog/ whose title starts with its id (`it('Cnn …')`), and every such test is
 * documented. Ids have 2 or 3 digits, and a heading or test title in any other form fails. A game with a RULES.md
 * must have a package and a catalog.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const docs = join(root, 'docs/games');
const games = readdirSync(docs).filter((id) => existsSync(join(docs, id, 'RULES.md')));

describe('rules catalogs', () => {
  it('covers every game with a RULES.md, Chain Reaction and Chess at least', () => {
    expect(games).toEqual(expect.arrayContaining(['chain-reaction', 'chess']));
  });

  for (const id of games) {
    it(`${id}: every catalog entry has a named test, and every catalog test is documented`, () => {
      const catalogDir = join(root, 'packages/games', id, 'test/catalog');
      expect(existsSync(catalogDir), `${catalogDir} is missing`).toBe(true);
      const rules = readFileSync(join(docs, id, 'RULES.md'), 'utf8');
      const documented = [...rules.matchAll(/^#### (C\d{2,3}) /gm)].map((m) => m[1]);
      // Any other "#### C…" heading (a colon, one digit, no space) would drop out of coverage unnoticed.
      const malformed = [...rules.matchAll(/^#### C.*$/gm)]
        .map((m) => m[0])
        .filter((h) => !/^#### C\d{2,3} /.test(h));
      expect(malformed).toEqual([]);
      const sources = readdirSync(catalogDir)
        .filter((f) => f.endsWith('.test.ts'))
        .map((f) => readFileSync(join(catalogDir, f), 'utf8'));
      const tested = sources.flatMap((src) => [...src.matchAll(/\bit\('(C\d{2,3}) /g)].map((m) => m[1]));
      // A catalog test titled another way (double quotes, a template string, no space) would not count.
      const loose = sources.flatMap((src) =>
        [...src.matchAll(/\bit\(\s*["'`]C\d+[^'"`]*/g)]
          .map((m) => m[0])
          .filter((t) => !/^it\('C\d{2,3} /.test(t)),
      );
      expect(loose).toEqual([]);
      expect(documented.length).toBeGreaterThan(0);
      expect(new Set(documented).size).toBe(documented.length);
      expect(new Set(tested).size).toBe(tested.length);
      expect(documented.filter((c) => !tested.includes(c))).toEqual([]);
      expect(tested.filter((c) => !documented.includes(c))).toEqual([]);
    });
  }
});
