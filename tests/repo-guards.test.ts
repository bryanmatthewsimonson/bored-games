import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORIGINAL_BRAND } from '../packages/games/chain-reaction/licensed/original.ts';
import { RESTRICTED, restrictedIn } from './restricted-names.ts';

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
  const TEXT = /\.(ts|tsx|js|mjs|cjs|svelte|vue|html|css|json|md|txt|webmanifest|svg)$/;

  /** Every text file of every workspace package and of scripts/, outside licensed/ and the skipped dirs. */
  function shippedFiles(): string[] {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (SKIP.has(name) || name === LICENSED) return [];
        return statSync(p).isDirectory() ? walk(p) : TEXT.test(name) ? [p] : [];
      });
    return [...packageDirs(), join(root, 'scripts')].filter((d) => existsSync(d)).flatMap(walk);
  }

  /** Every `licensed/` directory under a workspace package. */
  function licensedDirs(): string[] {
    const find = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (SKIP.has(name) || !statSync(p).isDirectory()) return [];
        return name === LICENSED ? [p] : find(p);
      });
    return packageDirs().flatMap(find);
  }

  it('scans every package, its tests and e2e included', () => {
    expect(srcDirs().map((d) => relative(root, d))).toContain('apps/web/src');
    const scanned = shippedFiles().map((f) => relative(root, f));
    for (const f of [
      'apps/web/src/main.tsx',
      'apps/web/test/brands.test.ts',
      'apps/web/e2e/play.spec.ts',
      'packages/games/chain-reaction/src/theme.ts',
      'packages/games/chain-reaction/package.json',
      'scripts/dev.ts',
    ])
      expect(scanned).toContain(f);
    expect(scanned.some((f) => f.split('/').includes(LICENSED))).toBe(false);
  });

  // The reference game's name and its published editions' chain names never appear outside licensed/.
  it('no file outside licensed/ mentions the reference game or its chain names', () => {
    const offenders = shippedFiles()
      .filter((f) => RESTRICTED.test(readFileSync(f, 'utf8')))
      .map((f) => `${relative(root, f)}: ${restrictedIn(readFileSync(f, 'utf8')).join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('exempts only licensed/ directories, and the licensed pack is covered by the list', () => {
    expect(licensedDirs().map((d) => relative(root, d))).toEqual(['packages/games/chain-reaction/licensed']);
    const pack = [ORIGINAL_BRAND.gameTitle, ...Object.values(ORIGINAL_BRAND.chains).map((c) => c.name)];
    for (const name of pack) expect(restrictedIn(name), name).toEqual([name]);
  });

  it('no source file imports a licensed/ pack statically', () => {
    const staticImport =
      /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"][^'"]*\blicensed\/|\bimport\s*['"][^'"]*\blicensed\//;
    const offenders = srcDirs()
      .flatMap((d) => files(d))
      .filter((f) => staticImport.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });

  it('loads a licensed/ pack only behind the build flag', () => {
    const dynamicImport = /\bimport\(\s*['"][^'"]*\blicensed\//;
    const loaders = srcDirs()
      .flatMap((d) => files(d))
      .filter((f) => dynamicImport.test(stripComments(readFileSync(f, 'utf8'))));
    expect(loaders.map((f) => relative(root, f))).toEqual(['apps/web/src/licensed-brands.ts']);
    for (const f of loaders) {
      const code = stripComments(readFileSync(f, 'utf8'));
      // The import sits inside the flag check, which Vite replaces with a constant at build time.
      // The block's lines are indented deeper than the `if`, up to the import.
      const guarded =
        /( *)if \(import\.meta\.env\.VITE_LICENSED_BRANDS === '1'\) \{\n(?:\1 {2,}.*\n)*?\1 {2,}.*\bimport\(/;
      expect(guarded.test(code), relative(root, f)).toBe(true);
    }
  });
});
