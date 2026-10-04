/*
 * The public build scan (D046): build the web app as the Pages workflow does (`VITE_LICENSED_BRANDS=0`, no other
 * `VITE_*` variable) and scan every file, source maps included, for every restricted name and every licensed pack
 * string (restricted-names.ts). A control build with the flag on must contain every one of those strings, which
 * proves the scan, the pack coverage and the flag; the public build must hold each allowed phrase (D053, D060). Both
 * build into temporary directories, so `apps/web/dist` and a concurrent run are left alone. Part of `pnpm test`,
 * so of `pnpm check` and CI; a build takes a few seconds.
 * `pnpm scan:dist` runs the same scan on an existing build (the Pages workflow runs it before uploading).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPARE_PHRASE } from '../packages/games/chain-reaction/src/compare.ts';
import { COMPARE_PHRASE as LUSTER_COMPARE_PHRASE } from '../packages/games/luster/src/compare.ts';
import {
  ALLOWED_PHRASES,
  BINARY,
  filesUnder,
  findRestricted,
  licensedPackStrings,
  scanDir,
} from './restricted-names.ts';

const root = join(import.meta.dirname, '..');
const web = join(root, 'apps/web');

/** This process's environment without any `VITE_*` variable, plus `flag` for VITE_LICENSED_BRANDS. */
function buildEnv(flag: '0' | '1'): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('VITE_')) delete env[k];
  return { ...env, VITE_LICENSED_BRANDS: flag };
}

function build(outDir: string, flag: '0' | '1'): void {
  execFileSync('pnpm', ['exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: web,
    env: buildEnv(flag),
    stdio: 'pipe',
  });
}

const tmp = mkdtempSync(join(tmpdir(), 'bg-build-scan-'));
let strings: string[] = [];
beforeAll(async () => {
  strings = await licensedPackStrings(root);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('public build', () => {
  it('scans for the licensed pack: title, aliases, tagline, summary and chain names', () => {
    // At least the original pack's title, one tagline, one summary and seven chains.
    expect(strings.length).toBeGreaterThanOrEqual(10);
  });

  it('holds none of the restricted names or licensed strings, in any case', () => {
    const dist = join(tmp, 'public');
    build(dist, '0');
    expect(existsSync(join(dist, 'index.html'))).toBe(true);
    expect(filesUnder(dist).some((f) => f.endsWith('.map'))).toBe(true);
    expect(scanDir(dist, strings)).toEqual([]);
    // The allowed mentions (D053, D060) ship, each as one literal in the bundle, and the scan let them through.
    const js = filesUnder(join(dist, 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    expect(ALLOWED_PHRASES).toEqual([COMPARE_PHRASE, LUSTER_COMPARE_PHRASE]);
    for (const phrase of ALLOWED_PHRASES) expect(js).toContain(phrase);
    // The scan is not blind to the titles: the same bundle with each bare title written out would fail it.
    for (const phrase of ALLOWED_PHRASES) {
      const title = phrase.replace(/^Compare to /, '');
      expect(findRestricted(`${js}\n"${title}"`, strings), title).toEqual([title]);
    }
  }, 180_000);

  it('holds every one of them in a build made with VITE_LICENSED_BRANDS=1 (the control)', () => {
    const dist = join(tmp, 'licensed');
    build(dist, '1');
    const text = filesUnder(dist)
      .filter((f) => !BINARY.test(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const found = findRestricted(text, strings);
    for (const s of strings) expect(found, s).toContain(s);
  }, 180_000);
});
