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
  'V2-01': {
    until:
      'T12 (the session builders for the Resign and Timeout claim), ' +
      'T14 (the controller creates tables and joins at proto 2)',
    partial:
      'protocol templates at proto 2 (packages/protocol/test/game-v2.test.ts), the lobby helpers carrying ' +
      "the table's proto (packages/client/test/lobby.test.ts), and the v2 session's move, end attestation and " +
      'stats attestation (packages/client/test/v2/core-deckless.test.ts), shuffle step, deal, release and Secret ' +
      'reveal (packages/client/test/v2/deck.test.ts), roll Shares event (packages/client/test/v2/dice.test.ts)',
  },
  'V2-04': { until: 'T14' },
  'V2-05': {
    until: 'T14: the lobby filters tables with validateTable',
    partial:
      'validateTable and validateRoot reject a (module, engine version) that does not support the proto, and the ' +
      'session refuses such a root (packages/protocol/test/lobby.test.ts, packages/client/test/bank-versions.test.ts); ' +
      'createTable refuses to publish one (apps/web/test/controllers.test.ts)',
  },
  'V2-56': {
    until: 'T13 (the rebroadcast reads the held set)',
    partial:
      'the session holds every Shares event and end attestation with a seated signer whatever its validity, in ' +
      'any arrival order, and keeps validity apart (packages/client/test/v2/core-deckless.test.ts); card Shares ' +
      'events that fail against the final deck or lie outside it stay held (packages/client/test/v2/deck.test.ts); ' +
      'rule (b) of the cutoff reads every held event, an inapplicable Shares variant and an end attestation naming ' +
      'a non-seat included (packages/client/test/v2/cutoff.test.ts)',
  },
  'V2-17': {
    until: 'T12 (the identities of the claims and Resigns this client counts itself, with no fork held)',
    partial:
      'the identity and clock-free validity of the attested results the cutoff reads: over, claim (no clock, no ' +
      'stall check) and resign (named head, S, the cancel rule) (packages/client/test/v2/cutoff.test.ts)',
  },
  'V2-20': {
    until: 'T13 (the order harness: incremental against from-scratch on random arrival orders)',
    partial:
      'every cutoff and standing-result scenario replayed in several arrival orders with duplicates, into every ' +
      'seat and a spectator (packages/client/test/v2/cutoff.test.ts, packages/client/test/v2/standing.test.ts); ' +
      'the claim and Resign caps in every order of their units (packages/client/test/v2/caps.test.ts, D069)',
  },
  'V2-23': { until: 'T12' },
  'V2-52': { until: 'T12, T17' },
  'V2-25': {
    until: 'T15 (the controller publishes only what the session owes)',
    partial:
      'the session owes and builds no card Shares event while it holds a fork, after its result, or before the ' +
      'final deck (packages/client/test/v2/prompt-release.test.ts)',
  },
  'V2-29': {
    until: 'T15 (the controller publishes the release at once)',
    partial:
      'the session owes one release of every granted position as soon as it links the granting move ' +
      '(packages/client/test/v2/prompt-release.test.ts)',
  },
  'V2-34': {
    until: 'T15 (the controller publishes the contribution at once, only what the session owes)',
    partial:
      'the session owes and builds a contribution only once the requesting move is on its chain, never while it ' +
      'holds a fork, the requester after its own move (packages/client/test/v2/dice.test.ts)',
  },
  'V2-37': {
    until: 'T15 (the controller publishes the end attestation at once, with no prompt)',
    partial:
      'the session owes and builds an end attestation of its own result only, signed by the session key, and ' +
      'none while it holds a fork (packages/client/test/v2/core-deckless.test.ts)',
  },
  'V2-38': {
    until: 'T15 (the controller publishes only what the session owes)',
    partial:
      'the session owes and builds no end or stats attestation for a stop or a cancelled game ' +
      '(packages/client/test/v2/fork-stop.test.ts, packages/client/test/v2/after-stop.test.ts)',
  },
  'V2-39': {
    until: 'T12 (the claims and Resigns this client counts itself)',
    partial:
      'over in a deckless game: the audit runs on the result at once and a failed seat forfeits in places and ' +
      'scores, the identity unchanged (packages/client/test/v2/core-deckless.test.ts); over with a deck: the ' +
      'full audit once every secret is in, a failed seat forfeiting (packages/client/test/v2/deck.test.ts); over ' +
      'in a dice game: the audit replays the logged rolls (packages/client/test/v2/dice.test.ts); a result ' +
      'standing against a fork: the full audit on it fails a cheat (packages/client/test/v2/standing.test.ts)',
  },
  'V2-55': {
    until: 'T17 (the game screen and the list of games show "audit incomplete" and "secret withheld")',
    partial:
      'the session view and the stats record (gameRecord) carry "audit incomplete" and each "secret withheld" ' +
      'seat after a stop (packages/client/test/v2/after-stop.test.ts, packages/client/test/v2/record.test.ts)',
  },
  'V2-42': { until: 'T12' },
  'V2-43': { until: 'T12' },
  'V2-44': { until: 'T13, T16' },
  'V2-45': { until: 'T13, T16' },
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
  'V2-53': {
    until: 'T14 (the lobby never creates or joins a proto-1 Luster or Bank table)',
    partial:
      'proto-1 games in progress keep folding, Bank 0.1.0 and Luster included: the golden corpus and the Bank ' +
      '0.1.0 fixtures (packages/games/bank/test/golden-v1.test.ts); the app ships Bank 0.1.0 under bank@0.1.0 ' +
      'beside Bank 0.2.0 and a v1 Bank root resolves to it (apps/web/test/module-contract.test.ts, T5)',
  },
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

  it('test titles name only §12.1 ids, and only in the counted form', () => {
    const unknown = titles.flatMap((t) =>
      t.ids.filter((id) => !spec.ids.includes(id)).map((id) => `${t.file}: ${id}`),
    );
    expect(unknown).toEqual([]);
    expect(loose).toEqual([]);
  });
});
