import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_BRAND } from '../packages/games/chain-reaction/licensed/original.ts';
import { CHAIN_REACTION_CATALOG } from '../packages/games/chain-reaction/src/catalog.ts';
import {
  COMPARE_BGG_ID,
  COMPARE_PHRASE,
  COMPARE_PREFIX,
  COMPARE_TITLE,
} from '../packages/games/chain-reaction/src/compare.ts';
import { LUSTER_CATALOG } from '../packages/games/luster/src/catalog.ts';
import * as LUSTER_COMPARE from '../packages/games/luster/src/compare.ts';
import { RIGHT_OF_WAY_CATALOG } from '../packages/games/right-of-way/src/catalog.ts';
import * as RIGHT_OF_WAY_COMPARE from '../packages/games/right-of-way/src/compare.ts';
import { ROOM_FOR_DOUBT_CATALOG } from '../packages/games/room-for-doubt/src/catalog.ts';
import * as ROOM_FOR_DOUBT_COMPARE from '../packages/games/room-for-doubt/src/compare.ts';
import {
  ALLOWED_PHRASE_HOMES,
  ALLOWED_PHRASES,
  ALLOWED_WORDS,
  BINARY,
  filesUnder,
  findRestricted,
  licensedDirs,
  licensedPackStrings,
  packStrings,
  restrictedIn,
} from './restricted-names.ts';

const root = join(import.meta.dirname, '..');

function files(dir: string, ext = /\.(ts|tsx|js|mjs|svelte|vue|html|css|json)$/): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'dist') return [];
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(name) ? [p] : [];
  });
}

/** Every workspace package directory (packages/*, packages/games/*, apps/*, services/*, tools/*). */
function packageDirs(): string[] {
  const groups = ['packages', 'packages/games', 'apps', 'services', 'tools'];
  return groups.flatMap((g) => {
    const dir = join(root, g);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((name) => join(dir, name))
      .filter((p) => existsSync(join(p, 'package.json')));
  });
}

/** Every `src` directory of every workspace package. */
function srcDirs(): string[] {
  return packageDirs()
    .map((p) => join(p, 'src'))
    .filter((p) => existsSync(p));
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('engine purity', () => {
  // Pure packages: no clock, randomness, I/O, platform globals or locale-dependent behavior.
  const pure = [
    join(root, 'packages/game-kit/src'),
    join(root, 'packages/dice/src'),
    join(root, 'packages/deck/src'),
    join(root, 'packages/protocol/src'),
    join(root, 'packages/client/src'),
    ...readdirSync(join(root, 'packages/games')).map((g) => join(root, 'packages/games', g, 'src')),
  ];
  const banned: [string, RegExp][] = [
    ['Math.random', /Math\.random/],
    ['Date', /\bDate\b/],
    ['performance', /\bperformance\b/],
    ['crypto', /\bcrypto\b/],
    ['timers', /\b(setTimeout|setInterval|setImmediate|queueMicrotask|requestAnimationFrame)\b/],
    ['node: imports', /from\s+['"]node:/],
    ['process', /\bprocess\./],
    ['network', /\b(fetch|WebSocket|XMLHttpRequest)\b/],
    ['storage', /\b(localStorage|sessionStorage|indexedDB)\b/],
    ['locale', /\b(Intl|localeCompare|toLocale\w*)\b/],
  ];
  for (const dir of pure) {
    for (const file of files(dir, /\.ts$/)) {
      it(`${relative(root, file)} is pure`, () => {
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const [label, re] of banned)
          expect(re.test(code), `${label} in ${relative(root, file)}`).toBe(false);
      });
    }
  }
});

describe('promptShares (D050, D075)', () => {
  // Any game may switch on the automatic share and seal duties in play: a standing exception to D050 (D075). Outside
  // the type that declares the flag and the session that reads it, only game modules may name it, so no shared code
  // can switch it on for every game (apps/web/test/prompt-shares.test.ts records which registered games set it).
  const CORE = ['packages/game-kit/src/types.ts', 'packages/client/src/session.ts'];
  const GAME_SOURCE = /^packages\/games\/[^/]+\/src\//;
  it('is named only by the type, the session and game modules in any package source', () => {
    const named = srcDirs()
      .flatMap((d) => files(d, /\.(ts|tsx)$/))
      .filter((f) => /\bpromptShares\b/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(root, f));
    for (const f of CORE) expect(named, f).toContain(f);
    expect(named.filter((f) => !CORE.includes(f) && !GAME_SOURCE.test(f))).toEqual([]);
  });
});

describe('web app impurity', () => {
  // apps/web is not a pure package, but clock, randomness and storage enter only through three files.
  const allowed = ['clock.ts', 'random.ts', 'storage.ts'];
  const banned: [string, RegExp][] = [
    ['Math.random', /Math\.random/],
    ['Date', /\bDate\b/],
    ['crypto', /\bcrypto\b/],
    ['storage', /\b(localStorage|sessionStorage|indexedDB)\b/],
    ['timers', /\b(setTimeout|setInterval)\b/],
  ];
  for (const file of files(join(root, 'apps/web/src'), /\.tsx?$/)) {
    if (allowed.includes(file.slice(file.lastIndexOf('/') + 1))) continue;
    it(`${relative(root, file)} reaches no clock, randomness or storage directly`, () => {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const [label, re] of banned)
        expect(re.test(code), `${label} in ${relative(root, file)}`).toBe(false);
    });
  }
});

describe('branding', () => {
  /** Directories never scanned: dependencies, build output and test reports. */
  const SKIP = new Set(['node_modules', 'dist', 'dist-e2e', 'test-results', 'playwright-report', 'coverage']);
  /** The only directories that may hold restricted names: licensed brand packs (D046). */
  const LICENSED = 'licensed';

  let strings: string[] = [];
  beforeAll(async () => {
    strings = await licensedPackStrings(root);
  });

  /** Every non-binary file of every workspace package and of scripts/, outside licensed/ and the skipped dirs. */
  function shippedFiles(): string[] {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (SKIP.has(name) || name === LICENSED) return [];
        return statSync(p).isDirectory() ? walk(p) : BINARY.test(name) ? [] : [p];
      });
    return [...packageDirs(), join(root, 'scripts')].filter((d) => existsSync(d)).flatMap(walk);
  }

  /** Every source file of every package `src`, any extension but binary ones. */
  const srcFiles = (): string[] =>
    srcDirs().flatMap((d) => filesUnder(d, SKIP).filter((f) => !BINARY.test(f)));

  it('scans every package, its tests and e2e included', () => {
    expect(srcDirs().map((d) => relative(root, d))).toContain('apps/web/src');
    const scanned = shippedFiles().map((f) => relative(root, f));
    for (const f of [
      'apps/web/src/main.tsx',
      'apps/web/test/brands.test.ts',
      'apps/web/e2e/play.spec.ts',
      'apps/web/index.html',
      'packages/games/chain-reaction/src/theme.ts',
      'packages/games/chain-reaction/package.json',
      'scripts/dev.ts',
    ])
      expect(scanned).toContain(f);
    expect(scanned.some((f) => f.split('/').includes(LICENSED))).toBe(false);
  });

  // The reference game's name, its editions' chain names and every licensed pack string never appear outside
  // licensed/ (and docs/), in any case or inside a longer identifier.
  it('no file outside licensed/ mentions the reference game, its chain names or a licensed pack string', () => {
    const offenders = shippedFiles().flatMap((f) => {
      const found = findRestricted(readFileSync(f, 'utf8'), strings);
      return found.length === 0 ? [] : [`${relative(root, f)}: ${found.join(', ')}`];
    });
    expect(offenders).toEqual([]);
  });

  it('catches the names in any case and inside identifiers, but not in the allowed words', () => {
    for (const text of ['TOWER', 'cr-chain-luxor', 'LuxorChain', 'acquireRules', 'american_x'])
      expect(findRestricted(text, []), text).not.toEqual([]);
    expect(findRestricted('hydrate(app, root); hydrated', [])).toEqual([]);
    expect(findRestricted('see the HOTEL CHAINS here', ['hotel chains'])).toEqual(['hotel chains']);
    expect(findRestricted('hotel chainsaw', ['hotel chains'])).toEqual([]);
  });

  it("catches Right of Way's reference title, publisher and designer as commonly written (D066)", () => {
    for (const text of [
      'a Ticket to Ride map',
      'TICKET TO RIDE',
      'ticket-to-ride',
      'ticketToRideRules',
      'days_of_wonder',
      'DaysOfWonder',
      'by Alan R. Moon',
      'alan moon',
      'AlanMoon',
    ])
      expect(findRestricted(text, []), text).not.toEqual([]);
    expect(findRestricted('Right of Way: a ticket, a ride, days of play', [])).toEqual([]);
  });

  it("catches Room for Doubt's reference publisher, designer, victim and suspects as commonly written (D074)", () => {
    for (const text of [
      'Cluedo',
      'CLUEDO',
      'cluedo-rules',
      'ClueDoBoard',
      'Hasbro',
      'by hasbro games',
      'Parker Brothers',
      'parker-brothers',
      'ParkerBrothers',
      'parker_brothers',
      'Waddingtons',
      'waddington',
      'Anthony Pratt',
      'AnthonyPratt',
      'Anthony E. Pratt',
      'anthony-e-pratt',
      'Tudor Mansion',
      'tudor_mansion',
      'Mr. Boddy',
      'boddy',
      'Colonel Mustard',
      'COLONEL MUSTARD',
      'colonel_mustard',
      'ColonelMustard',
      'Miss Scarlett',
      'Miss Scarlet',
      'miss-scarlett',
      'Professor Plum',
      'professorPlum',
      'Mrs. Peacock',
      'Mrs Peacock',
      'MrsPeacock',
      'Mrs. White',
      'Mrs White',
      'mrs_white',
      'Mr. Green',
      'Mr Green',
      'MrGreen',
      'Reverend Green',
      'reverend-green',
      'Dr. Orchid',
      'dr_orchid',
    ])
      expect(findRestricted(text, []), text).not.toEqual([]);
  });

  it('restricts the bare title only as an exact-case whole word (D074)', () => {
    for (const [text, found] of [
      ['Clue', 'Clue'],
      ['CLUE', 'CLUE'],
      ['a Clue board', 'Clue'],
      ['"Clue"', 'Clue'],
      ['Clue.', 'Clue'],
      ['Clue-style', 'Clue'],
      ['Clue’s', 'Clue'],
    ] as const)
      expect(findRestricted(text, []), text).toEqual([found]);
    for (const text of [
      'clue',
      'clues',
      'a clue to the bug',
      'ClueAction',
      'HintClue',
      'clue_token',
      'unclued',
      'Clues',
      'CLUES',
    ])
      expect(findRestricted(text, []), text).toEqual([]);
  });

  it('leaves ordinary colour words and other games alone (D074)', () => {
    expect(
      findRestricted('plum, green, white, black, peacock, mustard, scarlet; Plum cargo; Right of Way', []),
    ).toEqual([]);
  });

  describe('the allowed phrases (D053, D060, D066, D078)', () => {
    const crCompanies = [
      ...Object.values(ORIGINAL_BRAND.chains).map((c) => c.name),
      'Sackson',
      'Zeta',
      'Hydra',
      'Fusion',
      'America',
      'Quantum',
      'Phoenix',
    ];
    /** Luster's reference game's publisher and designer, as they are commonly written (D060). */
    const lusterCompanies = [
      'Space Cowboys',
      'SPACE COWBOYS',
      'space-cowboys',
      'space_cowboys',
      'SpaceCowboys',
      'Marc André',
      'MARC ANDRÉ',
      'Marc Andre',
      'marc andre',
      'MarcAndre',
      'Marc-Andre',
      'Marc-André',
      'Marc_Andre',
      'Marc_André',
    ];
    const games = [
      {
        game: 'Chain Reaction',
        home: 'packages/games/chain-reaction/src/compare.ts',
        phrase: 'Compare to Acquire',
        compare: { COMPARE_BGG_ID, COMPARE_PHRASE, COMPARE_PREFIX, COMPARE_TITLE },
        entry: CHAIN_REACTION_CATALOG,
        bggId: 5,
        companies: crCompanies,
      },
      {
        game: 'Luster',
        home: 'packages/games/luster/src/compare.ts',
        phrase: 'Compare to Splendor',
        compare: LUSTER_COMPARE,
        entry: LUSTER_CATALOG,
        bggId: 148228,
        companies: lusterCompanies,
      },
      {
        game: 'Right of Way',
        home: 'packages/games/right-of-way/src/compare.ts',
        phrase: 'Compare to Ticket to Ride',
        compare: RIGHT_OF_WAY_COMPARE,
        entry: RIGHT_OF_WAY_CATALOG,
        bggId: 9209,
        companies: [
          'Days of Wonder',
          'DAYS OF WONDER',
          'days-of-wonder',
          'DaysOfWonder',
          'Alan R. Moon',
          'Alan Moon',
          'AlanMoon',
        ],
      },
      {
        game: 'Room for Doubt',
        home: 'packages/games/room-for-doubt/src/compare.ts',
        phrase: 'Compare to Clue',
        compare: ROOM_FOR_DOUBT_COMPARE,
        entry: ROOM_FOR_DOUBT_CATALOG,
        bggId: 1294,
        companies: [
          'Hasbro',
          'HASBRO',
          'Parker Brothers',
          'parker-brothers',
          'ParkerBrothers',
          'Waddington',
          'Anthony Pratt',
          'Anthony E. Pratt',
        ],
        // An everyday word, restricted only as the exact-case whole words `Clue` and `CLUE` (D074).
        exactCase: true,
      },
    ];

    it('are exactly one "Compare to" phrase per game, each keyed by its home', () => {
      expect(ALLOWED_PHRASE_HOMES).toEqual(Object.fromEntries(games.map((g) => [g.home, g.phrase])));
      expect(ALLOWED_PHRASES).toEqual([
        'Compare to Acquire',
        'Compare to Splendor',
        'Compare to Ticket to Ride',
        'Compare to Clue',
      ]);
      expect(COMPARE_TITLE).toBe(ORIGINAL_BRAND.gameTitle);
    });

    for (const g of games) {
      const { phrase } = g;
      const title = g.compare.COMPARE_TITLE;

      it(`${g.game}: "${phrase.slice(0, 11)}…" is stored once, in ${g.home}, and nowhere else in a package`, () => {
        expect(g.compare.COMPARE_PHRASE).toBe(phrase);
        expect(g.compare.COMPARE_PREFIX + title).toBe(phrase);
        expect(g.entry.bggId).toBeNull();
        expect(g.entry.compareTo).toEqual({ title, bggId: g.compare.COMPARE_BGG_ID });
        expect(g.compare.COMPARE_BGG_ID).toBe(g.bggId);
        // compare.ts writes the phrase as one literal and never the title on its own.
        const code = readFileSync(join(root, g.home), 'utf8');
        expect(code.split(`'${phrase}'`)).toHaveLength(2);
        expect(findRestricted(code.replace(`'${phrase}'`, ''), strings)).toEqual([]);
        // The other game's phrase is not in it either (it would pass the scan, since the guard cuts it).
        for (const other of ALLOWED_PHRASES.filter((p) => p !== phrase)) expect(code).not.toContain(other);
        // No other package file spells the phrase: everything else builds it from the catalog entry.
        const elsewhere = shippedFiles()
          .filter((f) => relative(root, f) !== g.home && readFileSync(f, 'utf8').includes(phrase))
          .map((f) => relative(root, f));
        expect(elsewhere).toEqual([]);
      });

      it(`${g.game}: the phrase passes the guard, alone and in code, with the licensed strings in the scan`, () => {
        for (const text of [
          phrase,
          `const p = "${phrase}";`,
          `\`${phrase}\`.replace(/^Compare to /, \`\`)`,
          `<a>${phrase}</a> and '${phrase}'`,
        ])
          expect(findRestricted(text, strings), text).toEqual([]);
      });

      it(`${g.game}: nothing else gets through: the bare title, other cases, other words and every company`, () => {
        expect(ALLOWED_WORDS.has(title.toLowerCase())).toBe(false);
        const upper = title.toUpperCase();
        const lower = title.toLowerCase();
        // A title on the fixed list is caught in any case and inside a word; an everyday word that is a title
        // (`exactCase`) only as the exact-case whole word, so it stays an ordinary word in lower case (D074).
        const caught = g.exactCase
          ? [
              title,
              upper,
              `compare to ${title}`,
              `COMPARE TO ${upper}`,
              `Compare  to ${title}`,
              `xCompare to ${title}`,
              `${phrase}, the ${title} company`,
              `${phrase}-style`,
              `${phrase}’s`,
              `${title} Duel`,
            ]
          : [
              title,
              lower,
              upper,
              `${lower}s`,
              `re${lower}d`,
              `${title}Rules`,
              `cr-${lower}-x`,
              `compare to ${title}`,
              `Compare to ${lower}`,
              `COMPARE TO ${upper}`,
              `Compare  to ${title}`,
              `Compare to ${title}d`,
              `Compare to ${title}_x`,
              `xCompare to ${title}`,
              `${phrase}, the ${title} company`,
              // An unrestricted word run into the phrase: caught only because the cut needs a word boundary.
              `${phrase}Duel`,
              `${phrase}-style`,
              `${phrase}’s`,
              `${title} Duel`,
            ];
        for (const text of caught) expect(findRestricted(text, strings), text).not.toEqual([]);
        if (g.exactCase)
          for (const text of [lower, `${lower}s`, `${title}Action`])
            expect(findRestricted(text, strings), text).toEqual([]);
        for (const name of g.companies) {
          expect(findRestricted(name, strings), name).not.toEqual([]);
          expect(findRestricted(`Compare to ${name}`, strings), name).not.toEqual([]);
          for (const p of ALLOWED_PHRASES)
            expect(findRestricted(`${p} ${name}`, strings), `${p} ${name}`).not.toEqual([]);
        }
      });
    }

    // Known and accepted gap: the cut removes the whole phrase wherever it stands alone, so a phrase followed by
    // a space and an unrestricted word ("Compare to <Title> Duel", a product name) passes. Only restricted words
    // after it are caught. The phrase is spelled in its compare.ts alone (tested above), so this needs a new
    // literal somewhere, which review would see.
    it('lets "Compare to <Title> <unrestricted word>" through, for both games (known gap)', () => {
      for (const phrase of ALLOWED_PHRASES)
        for (const word of ['Duel', 'Edition', 'Board'])
          expect(findRestricted(`${phrase} ${word}`, strings), `${phrase} ${word}`).toEqual([]);
    });

    it("does not let one game's phrase stand for the other's title", () => {
      expect(findRestricted('Compare to Acquire Splendor', strings)).toEqual(['Splendor']);
      expect(findRestricted('Compare to Splendor Acquire', strings)).toEqual(['Acquire']);
      expect(findRestricted('Compare to Splendor and Compare to Acquire', strings)).toEqual([]);
      expect(findRestricted('Compare to Clue Splendor', strings)).toEqual(['Splendor']);
      expect(findRestricted('Compare to Splendor Clue', strings)).toEqual(['Clue']);
    });
  });

  it('exempts only licensed/ directories, and the fixed list covers every name in the packs', () => {
    expect(licensedDirs(root).map((d) => relative(root, d))).toEqual([
      'packages/games/chain-reaction/licensed',
    ]);
    // Every string of the pack is scanned for: title, aliases, tagline, summary and chain names.
    const pack = [
      ORIGINAL_BRAND.gameTitle,
      ORIGINAL_BRAND.tagline,
      ORIGINAL_BRAND.summary,
      ...ORIGINAL_BRAND.aliases,
      ...Object.values(ORIGINAL_BRAND.chains).map((c) => c.name),
    ];
    for (const value of pack) expect(strings, value).toContain(value);
    // Only those: not the pack id, and not the looks (D053), whose label letters, colors and pattern words would
    // otherwise be banned everywhere.
    expect(strings).toEqual([...new Set(pack)].sort());
    const looks = Object.values(ORIGINAL_BRAND.looks ?? {}).flatMap((l) => [l.label, l.color]);
    expect(looks.length).toBe(14);
    for (const value of [...looks, ORIGINAL_BRAND.id]) expect(strings, value).not.toContain(value);
    // Only a pack's own top-level `id` and `looks` are skipped: the same keys deeper down are scanned.
    const nested = {
      id: 'p',
      looks: { b1: { label: 'Q' } },
      chains: { b1: { name: 'N', id: 'Deep', looks: 'Too' } },
    };
    expect([...packStrings(nested)].sort()).toEqual(['Deep', 'N', 'Too']);
    // The proper names (the title, capitalised aliases and the chains) are on the fixed list too, so they are
    // caught in any case and inside identifiers, not only as the pack spells them.
    const names = [
      ORIGINAL_BRAND.gameTitle,
      ...ORIGINAL_BRAND.aliases.filter((a) => /^[A-Z]/.test(a)),
      ...Object.values(ORIGINAL_BRAND.chains).map((c) => c.name),
    ];
    for (const name of names) expect(restrictedIn(name), name).toEqual([name]);
  });

  /** Ways a file can reach a licensed/ module: imports, `import()`, `import.meta.glob`, `new URL`, `require`. */
  const REACH =
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\bimport\.meta\.glob\(\s*\[?\s*|\bnew URL\(\s*|\brequire\(\s*)['"`][^'"`]*\blicensed\//g;

  it('no source file imports a licensed/ pack statically, by glob, URL or require', () => {
    const offenders = srcFiles().flatMap((f) => {
      const code = stripComments(readFileSync(f, 'utf8'));
      const sites = [...code.matchAll(REACH)].filter((m) => !/^import\s*\(/.test(m[0]));
      return sites.length === 0 ? [] : [relative(root, f)];
    });
    expect(offenders).toEqual([]);
  });

  it('loads a licensed/ pack only behind the build flag, at every import site', () => {
    const loaders = srcFiles().filter(
      (f) => [...stripComments(readFileSync(f, 'utf8')).matchAll(REACH)].length > 0,
    );
    expect(loaders.map((f) => relative(root, f))).toEqual(['apps/web/src/licensed-brands.ts']);
    for (const f of loaders) {
      const code = stripComments(readFileSync(f, 'utf8'));
      const sites = [...code.matchAll(REACH)].length;
      // Each import sits inside the flag check, which Vite replaces with a constant at build time: the block's
      // lines are indented deeper than the `if`, up to the import.
      const guarded =
        /( *)if \(import\.meta\.env\.VITE_LICENSED_BRANDS === '1'\) \{\n(?:\1 {2,}.*\n)*?\1 {2,}.*\bimport\(\s*'[^']*\blicensed\//g;
      expect([...code.matchAll(guarded)].length, relative(root, f)).toBe(sites);
      expect(sites).toBeGreaterThan(0);
    }
  });

  it('maps no package export or tsconfig path into licensed/ except the pack itself', () => {
    const mappings: string[] = [];
    for (const dir of [root, ...packageDirs()]) {
      for (const name of readdirSync(dir).filter(
        (n) => n === 'package.json' || /^tsconfig.*\.json$/.test(n),
      )) {
        const text = readFileSync(join(dir, name), 'utf8');
        for (const m of text.matchAll(/"([^"]*)"\s*:\s*\[?\s*"([^"]*licensed\/[^"]*)"/g))
          mappings.push(`${relative(root, join(dir, name))} ${m[1]} -> ${m[2]}`);
      }
    }
    expect(mappings).toEqual([
      'packages/games/chain-reaction/package.json ./licensed/original -> ./licensed/original.ts',
    ]);
  });

  it('builds the deployed site with the flag off and scans it before upload', () => {
    const workflows = join(root, '.github/workflows');
    for (const f of readdirSync(workflows)) {
      const text = readFileSync(join(workflows, f), 'utf8');
      for (const m of text.matchAll(/VITE_LICENSED_BRANDS\s*[:=]\s*['"]?([^'"\s]*)/g))
        expect(m[1], f).toBe('0');
    }
    const pages = readFileSync(join(workflows, 'pages.yml'), 'utf8');
    const build = pages.indexOf('run: pnpm build:web');
    const scan = pages.indexOf('run: pnpm scan:dist');
    const upload = pages.indexOf('upload-pages-artifact');
    expect(build).toBeGreaterThan(0);
    expect(scan).toBeGreaterThan(build);
    expect(upload).toBeGreaterThan(scan);
    expect(pages.slice(build - 200, build)).toMatch(/VITE_LICENSED_BRANDS: '0'/);
  });
});
