/*
 * The names that must never ship in a public build (CLAUDE.md, D017, D046), and the scanner both guards use: the
 * repo guard (repo-guards.test.ts) over the sources outside `licensed/` and `docs/`, and the public build scan
 * (public-build.test.ts, `pnpm scan:dist`) over the built files.
 *
 * Two kinds of term:
 * - the fixed list below (the reference game's name, its designer's, and its published editions' chain names),
 *   matched case-insensitively anywhere inside a word, so `cr-chain-x`, `X_CHAIN` and `XRules` are all caught;
 *   a handful of ordinary words that contain one (Preact's `hydrate`) are allowed;
 * - every string value of every licensed pack (`licensedPackStrings`), whatever it is: title, aliases, tagline,
 *   summary and chain names, matched case-insensitively as whole words or phrases. A new alias or a new pack is
 *   covered without touching this file.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RESTRICTED_NAMES: readonly string[] = [
  'Acquire',
  'Sackson',
  'Tower',
  'Luxor',
  'American',
  'Worldwide',
  'Festival',
  'Imperial',
  'Continental',
  'Zeta',
  'Hydra',
  'Fusion',
  'America',
  'Quantum',
  'Phoenix',
];

/** Ordinary words that contain a restricted name (lower case). Keep this short: each entry is a hole. */
export const ALLOWED_WORDS: ReadonlySet<string> = new Set([
  'hydrate',
  'hydrated',
  'hydrates',
  'hydrating',
  'hydration',
]);

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The words of `text` (letters and digits, joined by `_`) that contain a restricted name, not allowed ones. */
export function restrictedIn(text: string): string[] {
  const out = new Set<string>();
  const re = new RegExp(
    `[A-Za-z0-9_]*(?:${RESTRICTED_NAMES.map(escapeRegExp).join('|')})[A-Za-z0-9_]*`,
    'gi',
  );
  for (const m of text.matchAll(re)) if (!ALLOWED_WORDS.has(m[0].toLowerCase())) out.add(m[0]);
  return [...out];
}

/** The licensed strings `text` holds, each matched case-insensitively as a whole word or phrase. */
export function licensedIn(text: string, strings: readonly string[]): string[] {
  return strings.filter((s) =>
    new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(s)}(?![A-Za-z0-9])`, 'i').test(text),
  );
}

/** Everything restricted in `text`: names from the fixed list and licensed pack strings. */
export function findRestricted(text: string, strings: readonly string[]): string[] {
  return [...new Set([...restrictedIn(text), ...licensedIn(text, strings)])];
}

const SKIP = new Set(['node_modules', 'dist', 'dist-e2e', 'test-results', 'playwright-report', 'coverage']);

/** Every `licensed/` directory under the workspace packages of `root`. */
export function licensedDirs(root: string): string[] {
  const find = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (SKIP.has(name) || name.startsWith('.') || !statSync(p).isDirectory()) return [];
      return name === 'licensed' ? [p] : find(p);
    });
  return ['packages', 'apps', 'services', 'tools']
    .map((g) => join(root, g))
    .filter((d) => existsSync(d))
    .flatMap(find);
}

function stringsOf(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    if (value.trim() !== '' && !/^(original|safe)$/.test(value)) out.add(value.trim());
  } else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (typeof value === 'object' && value !== null)
    for (const v of Object.values(value)) stringsOf(v, out);
}

/**
 * Every string value exported by every licensed pack module (`licensed/*.ts`, tests excluded) under `root`: the
 * titles, aliases, taglines, summaries and chain names. Pack ids ('original') are left out: they are not names.
 */
export async function licensedPackStrings(root: string): Promise<string[]> {
  const out = new Set<string>();
  for (const dir of licensedDirs(root))
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const mod: Record<string, unknown> = await import(pathToFileURL(join(dir, name)).href);
      stringsOf(Object.values(mod), out);
    }
  return [...out].sort();
}

/** Binary formats a text scan cannot read; every other file is scanned as text. */
export const BINARY =
  /\.(png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav|wasm|zip|gz|br|pdf)$/i;

/** Every file under `dir`, recursively, skipping `skip` directory names. */
export function filesUnder(dir: string, skip: ReadonlySet<string> = new Set()): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (skip.has(name)) return [];
    return statSync(p).isDirectory() ? filesUnder(p, skip) : [p];
  });
}

/** Each non-binary file under `dir` that holds something restricted, with what it holds ("assets/x.js: …"). */
export function scanDir(dir: string, strings: readonly string[]): string[] {
  return filesUnder(dir)
    .filter((f) => !BINARY.test(f))
    .flatMap((f) => {
      const found = findRestricted(readFileSync(f, 'utf8'), strings);
      return found.length === 0 ? [] : [`${relative(dir, f)}: ${found.join(', ')}`];
    });
}
