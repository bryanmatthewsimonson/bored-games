import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

function files(dir: string, ext = /\.(ts|tsx|js|mjs|svelte|vue|html|css|json)$/): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'dist') return [];
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(name) ? [p] : [];
  });
}

/** Every `src` directory of every workspace package (packages/*, packages/games/*, apps/*, services/*, tools/*). */
function srcDirs(): string[] {
  const groups = ['packages', 'packages/games', 'apps', 'services', 'tools'];
  return groups.flatMap((g) => {
    const dir = join(root, g);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((name) => join(dir, name, 'src'))
      .filter((p) => existsSync(p));
  });
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('engine purity', () => {
  // Pure packages: no clock, randomness, I/O, platform globals or locale-dependent behavior.
  const pure = [
    join(root, 'packages/game-kit/src'),
    join(root, 'packages/deck/src'),
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

describe('branding', () => {
  // The reference game's name and its published editions' chain names must never appear in shipped code.
  const forbidden =
    /\b(Acquire|Sackson|Tower|Luxor|American|Worldwide|Festival|Imperial|Continental|Zeta|Hydra|Fusion|America|Quantum|Phoenix)\b/;
  it('no product source mentions the reference game or its chain names', () => {
    const offenders = srcDirs()
      .flatMap((d) => files(d))
      .filter((f) => forbidden.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });
});
