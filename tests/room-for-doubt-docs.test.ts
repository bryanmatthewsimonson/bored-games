import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { boardStats, formatStats, parseBoard } from '../scripts/room-for-doubt/board.ts';
import { EXHIBITS, PARTIES, SCENES } from '../scripts/room-for-doubt/data.ts';
import { findRestricted, licensedPackStrings } from './restricted-names.ts';

const game = join(import.meta.dirname, '../docs/games/room-for-doubt');
const rules = readFileSync(join(game, 'RULES.md'), 'utf8');
const boardText = readFileSync(join(game, 'board.txt'), 'utf8');
const decisions = readFileSync(join(import.meta.dirname, '../docs/DECISIONS.md'), 'utf8');
const decision = decisions.split(/^## D072: /m)[1] ?? '';

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
  for (const text of [pathA, decision]) {
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

it('records the design once, as D072: no decision number is used twice', () => {
  const heads = [...decisions.matchAll(/^## (D\d{3}): /gm)].map((m) => m[1]);
  expect(new Set(heads).size, 'a decision number appears twice').toBe(heads.length);
  expect(decisions).toMatch(/^## D072: Room for Doubt/m);
});

it('counts every game allowed prompt shares on build path A: Luster, Right of Way and Driftwrights', () => {
  const pathA = rules.match(/^- \*\*A\. Beta on today's pieces,\*\*.*$/m)?.[0] ?? '';
  expect(pathA).toMatch(/Luster, Right of Way and Driftwrights/);
  expect(pathA).toMatch(/fourth owner exception/);
  expect(decision).toMatch(/fourth `promptShares` exception/);
});

it('says the game both deals and rolls, and what the platform offers for that (PROTOCOL 6.3a, 13)', () => {
  expect(rules).toMatch(/both deals cards and rolls dice/);
  expect(rules).toContain('PROTOCOL §6.3a');
  expect(rules).toContain('PROTOCOL §13');
  expect(rules).not.toContain("the roller's beacon share rides on the roll");
  expect(decision).toMatch(/deals and rolls/);
});

it('records that protocol 1 and the trusted-dealer direction (D071) bear on the build path', () => {
  expect(rules).toContain('D071');
  expect(decision).toContain('D071');
});
