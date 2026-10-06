import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { boardStats, formatStats, parseBoard } from '../scripts/room-for-doubt/board.ts';
import { EXHIBITS, PARTIES, SCENES } from '../scripts/room-for-doubt/data.ts';
import { findRestricted, licensedPackStrings } from './restricted-names.ts';

const game = join(import.meta.dirname, '../docs/games/room-for-doubt');
const rules = readFileSync(join(game, 'RULES.md'), 'utf8');
const boardText = readFileSync(join(game, 'board.txt'), 'utf8');
const d068 =
  readFileSync(join(import.meta.dirname, '../docs/DECISIONS.md'), 'utf8').split(/^## D068: /m)[1] ?? '';

it('names every card exactly as the data does', () => {
  for (const n of [
    ...PARTIES.map((p) => p.name),
    ...EXHIBITS.map((e) => e.name),
    ...SCENES.map((s) => s.name),
  ])
    expect(rules, n).toContain(n);
});

it('has the catalog C01 to C45 in order, each with a body', () => {
  const heads = [...rules.matchAll(/^#### (C\d{2}) (.+)$/gm)];
  expect(heads.map((m) => m[1])).toEqual(
    Array.from({ length: 45 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`),
  );
  const bodies = rules.split(/^#### C\d{2} .+$/m).slice(1);
  for (const [i, body] of bodies.entries())
    expect(body.replace(/^## .*$[\s\S]*/m, '').trim().length, `C${i + 1}`).toBeGreaterThan(20);
});

it('quotes the board numbers the checker computes', () => {
  const stats = formatStats(boardStats(parseBoard(boardText)));
  expect(rules).toContain(`<!-- board-stats -->${stats}<!-- /board-stats -->`);
});

it('prints the grid of board.txt, so the file and the rules cannot drift', () =>
  expect(rules).toContain(`\`\`\`text\n${boardText.trimEnd()}\n\`\`\``));

it('holds no placeholder', () => expect(rules).not.toMatch(/\b(TBD|TODO|FIXME)\b/));

it('has no restricted name or licensed string in the board file or the art', async () => {
  const strings = await licensedPackStrings(join(import.meta.dirname, '..'));
  for (const f of ['board.txt', ...readdirSync(join(game, 'art')).map((n) => `art/${n}`)])
    expect(findRestricted(readFileSync(join(game, f), 'utf8'), strings), f).toEqual([]);
});

it('says what a second indictment costs on build path A: the first indicter seals its share', () => {
  const pathA = rules.match(/^- \*\*A\. Beta on today's pieces,\*\*.*$/m)?.[0] ?? '';
  expect(pathA).not.toContain('Indictment resolution needs no exception');
  for (const text of [pathA, d068]) {
    expect(text).toMatch(/second indictment/);
    expect(text).toMatch(/first indicter/);
    expect(text).toMatch(/seal/);
  }
});

it('states the roll shortfall precisely: a room entered early ends the move, else the longest legal path', () => {
  const p4 = rules.match(/^- \*\*P4 Shortfall\.\*\*.*$/m)?.[0] ?? '';
  expect(p4).toMatch(/enters? a room/);
  expect(p4).toMatch(/longest legal path/);
  const c19 = rules.split(/^#### C19 .+$/m)[1]?.split(/^#### C20 /m)[0] ?? '';
  expect(c19).toMatch(/room/);
  expect(c19).toMatch(/longest legal path/);
});
