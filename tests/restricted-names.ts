/*
 * The names that must never ship in a public build (CLAUDE.md, D017, D046), and the scanner both guards use: the
 * repo guard (repo-guards.test.ts) over the sources outside `licensed/` and `docs/`, and the public build scan
 * (public-build.test.ts, `pnpm scan:dist`) over the built files.
 *
 * Three kinds of term:
 * - the fixed list below (each reference game's name, its designer's, and for Chain Reaction its published
 *   editions' chain names; for Luster and Right of Way, also its publisher's; for Room for Doubt, its reference
 *   game's old title, publishers, designer, victim and the suspects' full names, each in its spaced, joined,
 *   hyphenated and underscored forms), matched case-insensitively anywhere inside a word, so `cr-chain-x`,
 *   `X_CHAIN` and `XRules` are all caught; a handful of ordinary words that contain one (Preact's `hydrate`) are
 *   allowed;
 * - the exact-case words (`RESTRICTED_EXACT_WORDS`, D074): Room for Doubt's reference title is an everyday English
 *   word, so only the whole word `Clue` or `CLUE` is restricted, and `clue`, `clues` and `ClueAction` pass (a
 *   Hanabi engine will use clues);
 * - every name and text string of every licensed pack (`licensedPackStrings`): title, aliases, tagline, summary
 *   and chain names, matched case-insensitively as whole words or phrases. A new alias or a new pack is covered
 *   without touching this file. A pack's `id` and its `looks` (label letters, colors, pattern words) are not
 *   names, and scanning for them would ban single letters and ordinary words.
 *
 * One exception (D053, D060, D066, D078): the exact phrases in `ALLOWED_PHRASES` ("Compare to" a reference title,
 * as a store brand says it; one per game that has one) are cut out of the text before both matchers run, so
 * `findRestricted` and everything built on it (the repo guard, the public build scan and `pnpm scan:dist`) let them
 * through. Only the whole phrase, spelled exactly: the title alone, in another case or inside another word is still
 * caught.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const FIXED_NAMES: readonly string[] = [
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
  // Luster's reference game (D060): its title, its publisher and its designer (with and without the accent).
  'Splendor',
  'Space Cowboys',
  'SpaceCowboys',
  'Space_Cowboys',
  'Space-Cowboys',
  'Marc André',
  'Marc Andre',
  'MarcAndre',
  'MarcAndré',
  'Marc-Andre',
  'Marc-André',
  'Marc_Andre',
  'Marc_André',
  // Right of Way's reference game (D066): its title, its publisher and its designer, as they are commonly written.
  'Ticket to Ride',
  'TicketToRide',
  'Ticket-to-Ride',
  'Ticket_to_Ride',
  'Days of Wonder',
  'DaysOfWonder',
  'Days-of-Wonder',
  'Days_of_Wonder',
  'Alan R. Moon',
  'Alan R Moon',
  'Alan Moon',
  'AlanMoon',
  'Alan-Moon',
  'Alan_Moon',
];

/**
 * The spaced, joined, hyphenated and underscored forms of `name`, with and without its periods ("Mrs. White" gives
 * "Mrs. White", "Mrs White", "MrsWhite", "Mrs-White" and "Mrs_White"), each once. A single word gives itself.
 */
export function nameForms(name: string): string[] {
  const words = name.split(/\s+/).map((w) => w.replaceAll('.', ''));
  return [...new Set([name, words.join(' '), words.join(''), words.join('-'), words.join('_')])];
}

/** Room for Doubt's reference game (D074): its old title, publishers, designer, victim and the suspects' full names. */
const ROOM_FOR_DOUBT_REFERENCE: readonly string[] = [
  'Cluedo',
  'Hasbro',
  'Parker Brothers',
  'Waddington',
  'Anthony Pratt',
  'Anthony E. Pratt',
  'Tudor Mansion',
  'Boddy',
  'Colonel Mustard',
  'Miss Scarlett',
  'Miss Scarlet',
  'Professor Plum',
  'Mrs. Peacock',
  'Mrs. White',
  'Mr. Green',
  'Reverend Green',
  'Dr. Orchid',
];

export const RESTRICTED_NAMES: readonly string[] = [
  ...FIXED_NAMES,
  ...ROOM_FOR_DOUBT_REFERENCE.flatMap(nameForms),
];

/**
 * Words restricted only as a whole word in exactly this case (D074, spec §8): Room for Doubt's reference title is
 * an everyday English word, so lowercase `clue`, `clues` and `ClueAction` are not restricted.
 */
export const RESTRICTED_EXACT_WORDS: readonly string[] = ['Clue', 'CLUE'];

/** Ordinary words that contain a restricted name (lower case). Keep this short: each entry is a hole. */
export const ALLOWED_WORDS: ReadonlySet<string> = new Set([
  'hydrate',
  'hydrated',
  'hydrates',
  'hydrating',
  'hydration',
]);

/**
 * The exact phrases the public site may show although they hold a restricted name (D053, D060, D066, D078),
 * case-sensitive: one per game, keyed by the package that stores it as one string literal in `src/compare.ts`, which
 * a guard test checks. Keep this to whole phrases: never add a bare title, here or to ALLOWED_WORDS.
 */
export const ALLOWED_PHRASE_HOMES: Readonly<Record<string, string>> = {
  'packages/games/chain-reaction/src/compare.ts': 'Compare to Acquire',
  'packages/games/luster/src/compare.ts': 'Compare to Splendor',
  'packages/games/right-of-way/src/compare.ts': 'Compare to Ticket to Ride',
  'packages/games/room-for-doubt/src/compare.ts': 'Compare to Clue',
};

/** The allowed phrases themselves (ALLOWED_PHRASE_HOMES' values). */
export const ALLOWED_PHRASES: readonly string[] = Object.values(ALLOWED_PHRASE_HOMES);

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `text` with every allowed phrase replaced by a space: only where it stands as a whole phrase, so a phrase run
 * into a longer word on either side ("Compare to Acquired"), or followed by a hyphen or a typographic apostrophe
 * ("…-style", "…’s"), is left for the matchers to catch. The ASCII `'` may follow: it closes a quoted literal.
 * Known and accepted gap: a phrase followed by a space and an unrestricted word ("Compare to <Title> Duel") is cut
 * like the phrase alone, so the word passes (repo-guards.test.ts documents it); each phrase is spelled only in its
 * own compare.ts, which a guard test checks.
 */
export function withoutAllowedPhrases(text: string): string {
  return ALLOWED_PHRASES.reduce(
    (t, p) => t.replace(new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(p)}(?![A-Za-z0-9_\\-\u2019])`, 'g'), ' '),
    text,
  );
}

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

/** The exact-case words (RESTRICTED_EXACT_WORDS) that `text` holds as whole words, each once. */
export function exactWordsIn(text: string): string[] {
  const re = new RegExp(
    `(?<![A-Za-z0-9_])(?:${RESTRICTED_EXACT_WORDS.map(escapeRegExp).join('|')})(?![A-Za-z0-9_])`,
    'g',
  );
  return [...new Set([...text.matchAll(re)].map((m) => m[0]))];
}

/** The licensed strings `text` holds, each matched case-insensitively as a whole word or phrase. */
export function licensedIn(text: string, strings: readonly string[]): string[] {
  return strings.filter((s) =>
    new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(s)}(?![A-Za-z0-9])`, 'i').test(text),
  );
}

/**
 * Everything restricted in `text`: names from the fixed list, exact-case words and licensed pack strings, once the
 * allowed phrases are cut out. Every scan goes through here.
 */
export function findRestricted(text: string, strings: readonly string[]): string[] {
  const t = withoutAllowedPhrases(text);
  return [...new Set([...restrictedIn(t), ...exactWordsIn(t), ...licensedIn(t, strings)])];
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

/** The top-level keys of a licensed pack whose values are not names: the pack id and the looks (D053). */
const NOT_NAMES: ReadonlySet<string> = new Set(['id', 'looks']);

/** Every non-empty string inside `value`, at any depth. */
function stringsOf(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    if (value.trim() !== '') out.add(value.trim());
  } else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (typeof value === 'object' && value !== null)
    for (const v of Object.values(value)) stringsOf(v, out);
}

/** The strings of one exported pack: every string but those under its top-level `id` and `looks`. */
export function packStrings(pack: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(pack)) for (const p of pack) packStrings(p, out);
  else if (typeof pack === 'object' && pack !== null) {
    for (const [k, v] of Object.entries(pack)) if (!NOT_NAMES.has(k)) stringsOf(v, out);
  } else stringsOf(pack, out);
  return out;
}

/**
 * Every name and text string exported by every licensed pack module (`licensed/*.ts`, tests excluded) under
 * `root`: the titles, aliases, taglines, summaries and chain names. Pack ids ('original') and looks (label
 * letters, colors, patterns) are left out: they are not names.
 */
export async function licensedPackStrings(root: string): Promise<string[]> {
  const out = new Set<string>();
  for (const dir of licensedDirs(root))
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const mod: Record<string, unknown> = await import(pathToFileURL(join(dir, name)).href);
      for (const pack of Object.values(mod)) packStrings(pack, out);
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
