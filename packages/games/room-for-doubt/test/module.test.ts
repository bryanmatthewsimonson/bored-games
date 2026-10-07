import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogProblems, type FuzzPolicy, fuzzBatch } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { ROOM_FOR_DOUBT_CATALOG } from '../src/catalog.ts';
import { COMPARE_BGG_ID, COMPARE_PHRASE, COMPARE_PREFIX, COMPARE_TITLE } from '../src/compare.ts';
import { DEFAULT_RULES, namedCards } from '../src/engine.ts';
import { EXHIBITS, PARTIES, SCENES } from '../src/ids.ts';
import * as pkg from '../src/index.ts';
import { roomForDoubt } from '../src/module.ts';
import { ROOM_FOR_DOUBT_BRAND, ROOM_FOR_DOUBT_THEME } from '../src/theme.ts';
import type { RfdAction, RfdState } from '../src/types.ts';
import { caseOrder, started, testPolicy } from './helpers.ts';

const root = join(import.meta.dirname, '../../../..');
const rules = readFileSync(join(root, 'docs/games/room-for-doubt/RULES.md'), 'utf8');
/** The text of a RULES.md section, up to the next heading. */
const section = (heading: string): string => rules.split(`### ${heading}\n`)[1]?.split(/^#/m)[0] ?? '';

describe('the brand pack, the catalog entry and the phrase', () => {
  it('copies the brand pack of RULES.md word for word', () => {
    const pack = section('Brand pack (for the build)');
    const line = (key: string): string => pack.match(new RegExp(`^- \`${key}\`: (.*)$`, 'm'))?.[1] ?? '';
    expect(ROOM_FOR_DOUBT_BRAND.id).toBe('safe');
    expect(ROOM_FOR_DOUBT_BRAND.gameTitle).toBe(line('gameTitle'));
    expect(`"${ROOM_FOR_DOUBT_BRAND.tagline}"`).toBe(line('tagline'));
    expect(`"${ROOM_FOR_DOUBT_BRAND.summary}"`).toBe(line('summary'));
    expect(ROOM_FOR_DOUBT_BRAND.aliases.join(', ')).toBe(line('aliases'));
    expect([ROOM_FOR_DOUBT_THEME.title, ROOM_FOR_DOUBT_THEME.tagline]).toEqual([
      ROOM_FOR_DOUBT_BRAND.gameTitle,
      ROOM_FOR_DOUBT_BRAND.tagline,
    ]);
    // One display name for each engine id, as the Components tables give them.
    expect(ROOM_FOR_DOUBT_THEME.parties).toHaveLength(PARTIES.length);
    expect(ROOM_FOR_DOUBT_THEME.exhibits).toHaveLength(EXHIBITS.length);
    expect(ROOM_FOR_DOUBT_THEME.scenes).toHaveLength(SCENES.length);
    for (const [i, p] of ROOM_FOR_DOUBT_THEME.parties.entries()) {
      expect(rules).toContain(`| ${p.name} (\`${PARTIES[i]}\`) | ${p.role} |`);
      expect(rules).toContain(`| ${p.name} | ${p.door} |`);
    }
    for (const [i, name] of ROOM_FOR_DOUBT_THEME.exhibits.entries())
      expect(rules).toContain(`${name} (\`${EXHIBITS[i]}\`)`);
    for (const [i, name] of ROOM_FOR_DOUBT_THEME.scenes.entries())
      expect(rules).toContain(`${name} (\`${SCENES[i]}\`)`);
    expect(rules).toContain(ROOM_FOR_DOUBT_THEME.verdict);
    expect(rules).toContain(ROOM_FOR_DOUBT_THEME.passage);
  });

  it('agrees with the module and with the catalog entry of RULES.md', () => {
    expect(catalogProblems(ROOM_FOR_DOUBT_CATALOG, roomForDoubt)).toEqual([]);
    const entry = section('Catalog entry (for the build)');
    const c = ROOM_FOR_DOUBT_CATALOG;
    expect(entry).toContain(
      `\`players {min: ${c.players.min}, max: ${c.players.max}, best: [${c.players.best}]}\``,
    );
    expect(entry).toContain(`\`playMinutes {min: ${c.playMinutes.min}, max: ${c.playMinutes.max}}\``);
    expect(entry).toContain(`\`weight\` ${c.weight}, \`luck\` ${c.luck}, \`genre: '${c.genre}'\``);
    expect(entry).toContain(`\`mechanisms: [${c.mechanisms.map((m) => `'${m}'`).join(', ')}]\``);
    expect(entry).toContain(`\`minAge: ${c.minAge}\``);
    expect(entry).toContain(`"${c.art?.credit}", ${c.art?.license}`);
    expect([c.id, c.status, c.year, c.bggId, c.typicalTurns]).toEqual([
      'room-for-doubt',
      'beta',
      null,
      null,
      60,
    ]);
    expect([c.modes, c.turn, c.hiddenInfo, c.randomness]).toEqual([
      ['competitive'],
      'sequential',
      true,
      true,
    ]);
    expect(c.tags).toEqual(['mystery', 'murder', 'courthouse', 'detective']);
    // "Compare to" the reference game, with its BoardGameGeek id: the phrase is the prefix and the title.
    expect(c.compareTo).toEqual({ title: COMPARE_TITLE, bggId: COMPARE_BGG_ID });
    expect(COMPARE_PREFIX + COMPARE_TITLE).toBe(COMPARE_PHRASE);
    expect(entry).toContain(`"${COMPARE_PHRASE}" with BoardGameGeek ${COMPARE_BGG_ID}`);
    expect(COMPARE_BGG_ID).toBe(1294);
    expect([roomForDoubt.id, roomForDoubt.version]).toEqual(['room-for-doubt', '0.1.0']);
  });

  it('exports the module, the deck and the rules from the index, and its entry points from package.json', () => {
    for (const name of [
      'roomForDoubt',
      'CASE_DECK',
      'DEFAULT_RULES',
      'validateRules',
      'cardOf',
      'legalActions',
    ])
      expect(pkg, name).toHaveProperty(name);
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as {
      exports: Record<string, string>;
    };
    expect(manifest.exports).toEqual({
      '.': './src/index.ts',
      './theme': './src/theme.ts',
      './catalog': './src/catalog.ts',
      './compare': './src/compare.ts',
      './brand': './src/theme.ts',
    });
    for (const file of Object.values(manifest.exports))
      expect(existsSync(join(import.meta.dirname, '..', file)), file).toBe(true);
  });
});

describe('the fuzzer', () => {
  /** A seat that knows the Verdict (the full state does) indicts it on its third turn: upheld games, every view. */
  const informed: FuzzPolicy<RfdState> = {
    name: 'informed',
    choose(s, seat, legal, rng) {
      if (s.stage === 'start' && s.rolls.filter((r) => r.last === seat).length >= 2) {
        const right = (legal as readonly RfdAction[]).find(
          (a) =>
            a.type === 'indict' &&
            JSON.stringify(namedCards(a)) === JSON.stringify(s.verdict.map((v) => v.card)),
        );
        if (right !== undefined) return right;
      }
      return testPolicy.choose(s, seat, legal, rng);
    },
  };

  it('ends games by an upheld indictment, every seat and spectator folding the same state', () => {
    const report = fuzzBatch(roomForDoubt, {
      seed: 'informed',
      games: 8,
      seatCounts: [3, 4, 5, 6],
      rules: DEFAULT_RULES,
      deckOrder: (_d, r) => caseOrder(r),
      checkViews: true,
      policies: [informed, testPolicy],
    });
    expect(report.failures).toEqual([]);
    expect(report.coverage['end:upheld']).toBeGreaterThan(0);
  });

  it('reaches the events a game is made of', () => {
    const report = fuzzBatch(roomForDoubt, {
      seed: 'coverage',
      games: 24,
      seatCounts: [3, 4, 5, 6],
      rules: { submit: 'required' },
      deckOrder: (_d, r) => caseOrder(r),
      checkViews: false,
      policies: [testPolicy],
    });
    expect(report.failures).toEqual([]);
    for (const tag of [
      'move:roll',
      'move:room',
      'move:passage',
      'submit:entered',
      'submit:summoned',
      'rebut:show',
      'rebut:none',
      'rebut:unrebutted',
      'indict:dismissed',
      'indict:again',
    ])
      expect(report.coverage[tag] ?? 0, tag).toBeGreaterThan(0);
    // The rare tags, from the events that make them.
    const s = started(3);
    expect(
      roomForDoubt.coverage?.(s, [
        { type: 'moved', seat: 0, to: 'G1', how: 'stay' },
        { type: 'moved', seat: 0, to: 'G3', how: 'shortfall' },
        { type: 'verdict', seat: 0, upheld: true },
      ]),
    ).toEqual(['move:stay', 'move:shortfall', 'indict:upheld']);
  });
});
