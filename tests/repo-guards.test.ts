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
import {
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

  describe('the one allowed phrase (D053)', () => {
    const companies = [
      ...Object.values(ORIGINAL_BRAND.chains).map((c) => c.name),
      'Sackson',
      'Zeta',
      'Hydra',
      'Fusion',
      'America',
      'Quantum',
      'Phoenix',
    ];

    it('is exactly "Compare to" the reference title, stored once in compare.ts', () => {
      expect(ALLOWED_PHRASES).toEqual(['Compare to Acquire']);
      expect(ALLOWED_PHRASES).toEqual([COMPARE_PHRASE]);
      expect(COMPARE_PREFIX + COMPARE_TITLE).toBe(COMPARE_PHRASE);
      expect(COMPARE_TITLE).toBe(ORIGINAL_BRAND.gameTitle);
      expect(CHAIN_REACTION_CATALOG.compareTo).toEqual({ title: COMPARE_TITLE, bggId: COMPARE_BGG_ID });
      expect(COMPARE_BGG_ID).toBe(5);
      // compare.ts writes the phrase as one literal and never the title on its own.
      const code = readFileSync(join(root, 'packages/games/chain-reaction/src/compare.ts'), 'utf8');
      expect(code.split(`'${COMPARE_PHRASE}'`)).toHaveLength(2);
      expect(findRestricted(code.replace(`'${COMPARE_PHRASE}'`, ''), strings)).toEqual([]);
    });

    it('passes the guard, alone and in code, with the licensed strings in the scan', () => {
      expect(strings).toContain(COMPARE_TITLE);
      for (const text of [
        'Compare to Acquire',
        'const p = "Compare to Acquire";',
        '`Compare to Acquire`.replace(/^Compare to /, ``)',
        "<a>Compare to Acquire</a> and 'Compare to Acquire'",
      ])
        expect(findRestricted(text, strings), text).toEqual([]);
    });

    it('lets nothing else through: the bare title, other cases, other words and every company', () => {
      expect(ALLOWED_WORDS.has(COMPARE_TITLE.toLowerCase())).toBe(false);
      for (const text of [
        'Acquire',
        'acquire',
        'ACQUIRE',
        'acquires',
        'reacquired',
        'AcquireRules',
        'compare to Acquire',
        'Compare to acquire',
        'COMPARE TO ACQUIRE',
        'Compare  to Acquire',
        'Compare to Acquired',
        'Compare to Acquire_x',
        'xCompare to Acquire',
        'Compare to Acquire, the Acquire company',
        'Compare to Acquire Tower',
        'Compare to Acquire-style',
        'Compare to Acquire’s',
      ])
        expect(findRestricted(text, strings), text).not.toEqual([]);
      for (const name of companies) {
        expect(findRestricted(name, strings), name).not.toEqual([]);
        expect(findRestricted(`Compare to ${name}`, strings), name).not.toEqual([]);
        expect(findRestricted(`Compare to Acquire ${name}`, strings), name).not.toEqual([]);
      }
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
