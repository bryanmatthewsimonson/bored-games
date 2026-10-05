/*
 * Protocol v2 conformance traceability (PROTOCOL-v2 §12.1, build plan T1). Every requirement `**V2-nn**` in §12.1
 * needs a test somewhere in the repo whose title starts with its id: `it('V2-nn …')` (or `test(`, or `.each(…)(`),
 * several ids separated by commas (`it('V2-14, V2-50 …')`). Until a task covers an id it stays in ALLOWLIST with the
 * build task(s) that will cover it; V2-48 is deferred with its reason.
 *
 * The guard fails when an id is neither covered nor allowlisted, when an allowlisted id is covered (remove it: the
 * allowlist only shrinks), when a test names an id §12.1 does not have, and when a test title names an id in any
 * other form (it would not count).
 *
 * A test that covers one half of a requirement says so in its title, right after the ids: `(v1 half)` or
 * `(v1 halves)` for the v1 side (the golden corpus: v1 games keep folding by v1 rules), `(partial)` otherwise. Such a
 * test does not cover the id, which stays allowlisted, and its allowlist entry must name the half that is covered.
 *
 * Comments are stripped before the scan, and a counted title must open its line (after indentation), so a title in
 * a comment or inside a string does not count. A test-like V2 title anywhere else on a line fails as loose.
 *
 * Only vitest files (`*.test.ts`) are scanned: Playwright specs (`apps/web/e2e/*.spec.ts`) are not, so a UI
 * requirement (V2-49, V2-52, V2-55) must be covered by a vitest test (a component or controller test), even when an
 * e2e spec also exercises it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

interface Allowed {
  /** The build task(s) that will cover the id, or why it is deferred. */
  until: string;
  /** For an id a test already covers in part: which part. */
  partial?: string;
  deferred?: true;
}

/** Every id not yet covered. Each task removes the ids it covers; nothing is ever added back. */
const ALLOWLIST: Record<string, Allowed> = {
  'V2-52': {
    until:
      'T17 (the own-forfeit dialog: "You were timed out: accept?", Play by default, the local deadline shown)',
    partial:
      'the session half: no claim forfeiting only this seat counts before its own deadline without the ' +
      "player's confirmation (confirmOwnForfeit, confirmedForfeits after a reload), view.ownForfeit asks only on a " +
      "device that was not watching the head, and otherwise v1's own-clock rule (the N2 Chess trace and the " +
      'returning client: packages/client/test/v2/claims-resign.test.ts)',
  },
  'V2-55': {
    until: 'T17 (the game screen and the list of games show "audit incomplete" and "secret withheld")',
    partial:
      'the session view and the stats record (gameRecord) carry "audit incomplete" and each "secret withheld" ' +
      'seat after a stop (packages/client/test/v2/after-stop.test.ts, packages/client/test/v2/record.test.ts)',
  },
  'V2-44': {
    until:
      'T16 (the controller publishes the rebroadcast set to the root relays and its own, once after first holding ' +
      'and after each sync to the relays that lack it)',
    partial:
      "the session half: `rebroadcast()` lists the fork certificate, the chain, this seat's Shares events and end " +
      'attestations, and every other held event within the §9.1 bounds, valid-looking moves first, named moves ' +
      'regardless of the cap (packages/client/test/v2/outbox.test.ts)',
  },
  'V2-45': {
    until:
      'T16 (the controller vets every saved event through `vetSaved` after a full answer, and acts on it)',
    partial:
      'the session half: `vetSaved` decides send, wait or discard for saved Moves, the deal, releases, roll ' +
      'Shares events, end attestations, Resigns and Secret reveals (packages/client/test/v2/outbox.test.ts)',
  },
  'V2-46': { until: 'T16' },
  'V2-47': { until: 'T16' },
  'V2-48': {
    until:
      'deferred to the first module that declares audit `none` (PROTOCOL-v2 §9.5, PLAN): no current module does, ' +
      'so there is no game for one playing device per seat to apply to; a guard test (T2) fails once a module ' +
      'declares it, and §9.5 is built with that module',
    deferred: true,
  },
  'V2-49': { until: 'T17' },
};

/**
 * Test vectors of PROTOCOL-v2 §12.2 deferred by the owner's scope choice (PLAN, Phase v2, 2026-10-05: "finish v2 with
 * less ceremony"; D071). Their scenarios are session tests already; only the JSON files are not written. Vectors 1–4,
 * 6 and 7 exist (packages/deck, packages/protocol, packages/client test/vectors).
 */
const DEFERRED_VECTORS: Record<number, string> = {
  5: 'fold scenarios as JSON: the T10–T12 session tests hold every scenario, each in several arrival orders',
  8: 'outbox scenarios as JSON: packages/client/test/v2/outbox.test.ts holds the three cases',
  9: 'model traces as session tests: the T11 cutoff traces were checked against tools/protocol-model (PLAN T11)',
};

/** The ids §12.1 requires, in order. */
function specIds(): { ids: string[]; malformed: string[] } {
  const doc = readFileSync(join(root, 'docs/PROTOCOL-v2.md'), 'utf8');
  const start = doc.indexOf('### 12.1');
  const end = doc.indexOf('### 12.2');
  if (start < 0 || end < start) throw new Error('PROTOCOL-v2.md has no §12.1 before §12.2');
  const section = doc.slice(start, end);
  const ids = [...section.matchAll(/^- \*\*(V2-\d{2})\*\* /gm)].map((m) => m[1] as string);
  const malformed = [...section.matchAll(/^- \*\*V2-.*$/gm)]
    .map((m) => m[0])
    .filter((line) => !/^- \*\*V2-\d{2}\*\* /.test(line));
  return { ids, malformed };
}

/** Every `*.test.ts` file of the repo but this one, outside dependencies, builds and worktrees. */
function testFiles(dir = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'dist-e2e', '.git', '.claude', 'coverage'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(path));
    else if (entry.name.endsWith('.test.ts') && path !== import.meta.filename) out.push(path);
  }
  return out;
}

interface Title {
  file: string;
  ids: string[];
  partial: boolean;
}

/**
 * A counted title: at the start of a line after indentation, `it(` or `test(`, optionally through `.each(…)`, then
 * a quote and the ids, then a half marker or not, then a space or a colon.
 */
const COUNTED =
  /^[ \t]*(?:it|test)(?:\.each\((?:[^()]|\([^()]*\))*\))?\(\s*['"`]((?:V2-\d{2}, )*V2-\d{2})( \((?:v1 half|v1 halves|partial)\))?[ :]/gm;
/** Any test-like call whose title starts with something like a V2 id. */
const ANY = /\b(?:it|test)\b[\w.]*(?:\((?:[^()'"`]|\([^()]*\))*\))?\(\s*['"`]\s*v2-/gi;

/** `code` without its comments, keeping its line breaks (a `//` after a colon, as in a URL, is kept). */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const lineOf = (src: string, index: number): number => src.slice(0, index).split('\n').length;

function scan(): { titles: Title[]; loose: string[] } {
  const titles: Title[] = [];
  const loose: string[] = [];
  for (const path of testFiles()) {
    const src = stripComments(readFileSync(path, 'utf8'));
    const file = relative(root, path);
    const counted = new Set<number>();
    for (const m of src.matchAll(COUNTED)) {
      counted.add(lineOf(src, m.index));
      titles.push({ file, ids: (m[1] as string).split(', '), partial: m[2] !== undefined });
    }
    for (const m of src.matchAll(ANY)) {
      const line = lineOf(src, m.index);
      if (!counted.has(line))
        loose.push(`${file}:${line}: ${src.slice(m.index, m.index + 80).split('\n')[0]}`);
    }
  }
  return { titles, loose };
}

describe('protocol v2 conformance traceability (PROTOCOL-v2 §12.1)', () => {
  const spec = specIds();
  const { titles, loose } = scan();
  const full = new Set(titles.filter((t) => !t.partial).flatMap((t) => t.ids));
  const partial = new Set(titles.filter((t) => t.partial).flatMap((t) => t.ids));

  it('reads every requirement id of §12.1, each once and well formed', () => {
    expect(spec.malformed).toEqual([]);
    expect(spec.ids.length).toBeGreaterThanOrEqual(55);
    expect(new Set(spec.ids).size).toBe(spec.ids.length);
  });

  it('every requirement has a test titled with its id, or is allowlisted', () => {
    const missing = spec.ids.filter((id) => !full.has(id) && ALLOWLIST[id] === undefined);
    expect(missing).toEqual([]);
  });

  it('the allowlist only shrinks: no allowlisted id is covered, and every one is a requirement', () => {
    const covered = Object.keys(ALLOWLIST).filter((id) => full.has(id));
    expect(covered, 'covered now: remove these from ALLOWLIST').toEqual([]);
    expect(Object.keys(ALLOWLIST).filter((id) => !spec.ids.includes(id))).toEqual([]);
  });

  it('a half-covered id says which half, and only such an id says so', () => {
    for (const id of partial) {
      expect(ALLOWLIST[id]?.partial, `${id} has a (v1 half) or (partial) test: name the half`).toBeDefined();
    }
    for (const [id, a] of Object.entries(ALLOWLIST)) {
      if (a.partial !== undefined)
        expect(partial.has(id), `${id} claims a covered half, but no test has it`).toBe(true);
    }
  });

  it('V2-48 stays deferred, with its reason, and is the only deferred id', () => {
    const deferred = Object.entries(ALLOWLIST).filter(([, a]) => a.deferred === true);
    expect(deferred.map(([id]) => id)).toEqual(['V2-48']);
    expect(ALLOWLIST['V2-48']?.until).toMatch(/audit `none`/);
  });

  it('the deferred §12.2 vectors are exactly 5, 8 and 9, each with its note (D071)', () => {
    expect(Object.keys(DEFERRED_VECTORS).map(Number)).toEqual([5, 8, 9]);
    for (const note of Object.values(DEFERRED_VECTORS)) expect(note.length).toBeGreaterThan(20);
  });

  it('test titles name only §12.1 ids, and only in the counted form', () => {
    const unknown = titles.flatMap((t) =>
      t.ids.filter((id) => !spec.ids.includes(id)).map((id) => `${t.file}: ${id}`),
    );
    expect(unknown).toEqual([]);
    expect(loose).toEqual([]);
  });
});
