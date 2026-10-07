/*
 * The rules catalogs of every game (CLAUDE.md, D045): each `#### Cnn` entry in docs/games/<id>/RULES.md has a test
 * in packages/games/<id>/test/catalog/ whose title starts with its id (`it('Cnn …')`), and every such test is
 * documented. Ids have 2 or 3 digits, and a heading or test title in any other form fails. A game with a RULES.md
 * must have a package and a catalog, except the games listed in SPEC_ONLY: a rules spec written before its engine
 * (Hanabi, D054; Room for Doubt, D072). A spec-only game must have no `test/catalog/` directory yet: its package
 * may exist, holding the engine's foundations and their own tests (Room for Doubt's board and movement land before
 * its 45 catalog tests). The entry fails once the directory appears and must then be removed, and the game's
 * catalog is checked for well-formed, unique ids only until then.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const docs = join(root, 'docs/games');
const games = readdirSync(docs).filter((id) => existsSync(join(docs, id, 'RULES.md')));
/** Games with a rules spec and no catalog tests yet. Remove an id here the moment its `test/catalog/` is created. */
const SPEC_ONLY: readonly string[] = ['hanabi', 'room-for-doubt'];

describe('rules catalogs', () => {
  it('covers every game with a RULES.md, Chain Reaction and Chess at least', () => {
    expect(games).toEqual(expect.arrayContaining(['chain-reaction', 'chess']));
  });

  it('SPEC_ONLY lists only games that have a RULES.md and no catalog tests yet', () => {
    for (const id of SPEC_ONLY) {
      expect(games, `${id} has no docs/games/${id}/RULES.md`).toContain(id);
      expect(
        existsSync(join(root, 'packages/games', id, 'test/catalog')),
        `packages/games/${id}/test/catalog exists: remove "${id}" from SPEC_ONLY so its catalog tests are required`,
      ).toBe(false);
    }
  });

  for (const id of games.filter((g) => SPEC_ONLY.includes(g))) {
    it(`${id}: spec only (no catalog tests yet), its catalog is well formed and no tests are required`, () => {
      const rules = readFileSync(join(docs, id, 'RULES.md'), 'utf8');
      const documented = [...rules.matchAll(/^#### (C\d{2,3}) /gm)].map((m) => m[1]);
      const malformed = [...rules.matchAll(/^#### C.*$/gm)]
        .map((m) => m[0])
        .filter((h) => !/^#### C\d{2,3} /.test(h));
      expect(malformed).toEqual([]);
      expect(documented.length).toBeGreaterThan(0);
      expect(new Set(documented).size).toBe(documented.length);
    });
  }

  for (const id of games.filter((g) => !SPEC_ONLY.includes(g))) {
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
