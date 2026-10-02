/*
 * The public build scan (D046): build the web app as GitHub Pages gets it (`pnpm build:web`, no
 * VITE_LICENSED_BRANDS) and scan every file of apps/web/dist, source maps included, for the restricted names. A
 * control build with the flag on must contain them, which proves both the scan and the flag. Part of `pnpm test`,
 * so of `pnpm check` and CI; a build takes a couple of seconds.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ORIGINAL_BRAND } from '../packages/games/chain-reaction/licensed/original.ts';
import { restrictedIn } from './restricted-names.ts';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'apps/web/dist');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

/** Every built file holding a restricted name, with the names found. */
function scan(dir: string): string[] {
  return filesUnder(dir).flatMap((f) => {
    const found = restrictedIn(readFileSync(f, 'utf8'));
    return found.length === 0 ? [] : [`${relative(dir, f)}: ${found.join(', ')}`];
  });
}

/** The environment of a build: this process's, without the build flags unless given. */
function buildEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('VITE_')) delete env[k];
  return { ...env, ...extra };
}

const control = mkdtempSync(join(tmpdir(), 'bg-licensed-build-'));
afterAll(() => rmSync(control, { recursive: true, force: true }));

describe('public build', () => {
  it('holds none of the restricted names', () => {
    execFileSync('pnpm', ['build:web'], { cwd: root, env: buildEnv({}), stdio: 'pipe' });
    expect(existsSync(join(dist, 'index.html'))).toBe(true);
    expect(filesUnder(dist).some((f) => f.endsWith('.map'))).toBe(true);
    expect(scan(dist)).toEqual([]);
  }, 180_000);

  it('holds them in a build made with VITE_LICENSED_BRANDS=1 (the control)', () => {
    execFileSync('pnpm', ['exec', 'vite', 'build', '--outDir', control, '--emptyOutDir'], {
      cwd: join(root, 'apps/web'),
      env: buildEnv({ VITE_LICENSED_BRANDS: '1' }),
      stdio: 'pipe',
    });
    const found = scan(control).join('\n');
    expect(found).toContain(ORIGINAL_BRAND.gameTitle);
    for (const c of Object.values(ORIGINAL_BRAND.chains)) expect(found).toContain(c.name);
  }, 180_000);
});
