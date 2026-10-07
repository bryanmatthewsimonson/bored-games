# Room for Doubt design package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the design package of the spec: a rules spec, a proven board, five original SVG art files, name guards and decision-log entries for Room for Doubt, with no engine or UI.

**Architecture:** One plain-text grid (`board.txt`) is the single source for the board. A small pure TypeScript toolkit in `scripts/room-for-doubt/` parses it, proves its properties (also as a repo test) and renders all five SVG files from shared data (names, ids, palette, glyphs). Tests keep each generated file, RULES.md and the guards in sync.

**Tech Stack:** TypeScript run directly by Node 22.18+ (type stripping, `.ts` imports), Vitest (`repo` project), Biome, SVG. Chromium through Playwright for visual QA only. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-06-room-for-doubt-design.md` (read it first; this plan cites its sections as "spec §n").

## Global Constraints

- Node ≥ 22.18 and pnpm 10; `node_modules` is absent, so Task 1 starts with `pnpm install --frozen-lockfile`.
- Style: Biome (2 spaces, single quotes, trailing commas, semicolons, line width 110). Relative imports use `.ts` extensions, no enums, `import type` for types (CLAUDE.md). `noUncheckedIndexedAccess` is on, so index with a guard, never `!`.
- No new dependencies.
- The reference game's names appear only in `docs/`. No file under `scripts/`, `packages/`, `apps/` or `tools/` may hold a restricted name (the repo guard scans them). The bare title is restricted only as the exact-case whole word `Clue` or `CLUE` (spec §8).
- Art is original SVG dedicated CC0-1.0, uses only the nine palette colours of spec §6 (tints by opacity), generic font stacks only, and is deterministic (no `Math.random`, no `Date`).
- Game id `room-for-doubt`; decision id D074; date 2026-10-06. Engine ids are those of spec §4.1; display names live only in `data.ts` and the docs.
- Every commit ends with two trailer lines and names no model: `Co-Authored-By: Claude <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01P9yDMQMsQVqiVj35Jq9cf6`.
- `pnpm check` passes before the final push. Keep `docs/PLAN.md` and `docs/DECISIONS.md` current.

## Review Focus

1. A restricted name in another spelling or case (`Mr Green`, `COLONEL MUSTARD`, `parker_brothers`) gets past the guard, or the ordinary words `clue`, `Plum`, `green` get blocked. Tested in Task 1.
2. A `board.txt` edit that looks right but breaks play: a door facing a wall, a doorstep serving two doors, a dead-end square, an Entrance off the ring, CRLF line endings. Tested in Task 2.
3. A generated SVG hand-edited, or the generator changed without regenerating, so the art no longer matches the grid and data. Tested in Tasks 4–7 by the sync test.
4. A long name or role overflowing its card, pawn or docket row. Tested in Tasks 3, 5 and 6 (`fitText`, plus the visual check).
5. RULES.md drifting from the data and the board: a renamed card, stale board numbers, a gap in the catalog numbering. Tested in Task 8.

## How this plan refines the spec

- **Toolkit directory.** Spec §8 names one file, `scripts/room-for-doubt-art.ts`. This plan uses the directory `scripts/room-for-doubt/` (one responsibility per file), and its generator renders all five art files from shared data, so emblems and pictograms are drawn once.
- **Sync test.** Tests regenerate the art in memory and compare it with the files on disk, which is stronger than a hash comment; `board.svg` still carries the grid's SHA-256 in a comment.
- **Trip band (spec §5 item 7).** The 24 × 24 board's longest trips are the two diagonal corner pairs, which the passages exist to shortcut (prototyped: 28 and 29 on foot). The maximum therefore applies to pairs not joined by a passage (24 or less), and each passage pair must be at least 24 on foot. The median band 9–14 stays.
- **Final grid.** The grid below was prototyped and meets every band: 19 doors, 197 corridor squares, median trip 13.5, longest trip off the passages 22, passage trips 28 and 29, 7 trips of 7 or fewer.

## File Structure

| File | Responsibility |
|---|---|
| `tests/restricted-names.ts` (modify), `tests/repo-guards.test.ts` (modify) | the new restricted names and the exact-case title rule, with tests |
| `docs/games/room-for-doubt/board.txt` | the grid, the single source for the board |
| `scripts/room-for-doubt/board.ts` | parse the grid, prove spec §5, compute trips and stats (pure) |
| `scripts/room-for-doubt/data.ts` | ids, display names, palette, seat spread, contrast, `fitText` |
| `scripts/room-for-doubt/svg.ts` | SVG document and element helpers, `isWellFormed` |
| `scripts/room-for-doubt/glyphs.ts` | the 21 line-art glyphs |
| `scripts/room-for-doubt/art/{board,cards,pieces,docket,cover,index}.ts` | one renderer per art file; `index.ts` lists them and renders all |
| `scripts/room-for-doubt/cli.ts` | `node scripts/room-for-doubt/cli.ts` writes the art files |
| `docs/games/room-for-doubt/art/*.svg` | the generated art (never edited by hand) |
| `docs/games/room-for-doubt/RULES.md` | the source of truth |
| `tests/room-for-doubt-{board,data,art,docs}.test.ts` | the proofs of each part |
| `tests/catalog.test.ts` (modify), `docs/DECISIONS.md`, `docs/PLAN.md`, `CLAUDE.md` (modify) | spec-only listing and records |

Visual QA uses a scratch renderer kept in the session scratchpad (`$SCRATCH`), never committed. Create `$SCRATCH/render.mjs` once, in Task 3 Step 4.

---

### Task 1: Name guards

**Files:**
- Modify: `tests/restricted-names.ts`
- Modify: `tests/repo-guards.test.ts` (inside `describe('branding')`, after the Right of Way guard test)

**Interfaces:**
- Produces: `nameForms(name: string): string[]` (the name as given, without periods, joined, hyphenated and underscored, deduplicated); `RESTRICTED_EXACT_WORDS: readonly string[]` = `['Clue', 'CLUE']`; `exactWordsIn(text: string): string[]`; `findRestricted` additionally returns exact-word hits; `RESTRICTED_NAMES` additionally holds `nameForms` of: `Cluedo`, `Hasbro`, `Parker Brothers`, `Waddington`, `Anthony Pratt`, `Anthony E. Pratt`, `Tudor Mansion`, `Boddy`, `Colonel Mustard`, `Miss Scarlett`, `Miss Scarlet`, `Professor Plum`, `Mrs. Peacock`, `Mrs. White`, `Mr. Green`, `Reverend Green`, `Dr. Orchid`.
- Consumes: nothing.

- [ ] **Step 1: Install and baseline**

Run: `pnpm install --frozen-lockfile && pnpm vitest run --project repo tests/repo-guards.test.ts`
Expected: install succeeds; the guard test file PASSES.

- [ ] **Step 2: Write the failing tests** (three, in `repo-guards.test.ts`)

```ts
it("catches Room for Doubt's reference publisher, designer, victim and suspects as commonly written (D074)", () => {
  for (const text of [
    'Cluedo', 'CLUEDO', 'cluedo-rules', 'ClueDoBoard', 'Hasbro', 'by hasbro games',
    'Parker Brothers', 'parker-brothers', 'ParkerBrothers', 'parker_brothers', 'Waddingtons', 'waddington',
    'Anthony Pratt', 'AnthonyPratt', 'Anthony E. Pratt', 'anthony-e-pratt', 'Tudor Mansion', 'tudor_mansion',
    'Mr. Boddy', 'boddy', 'Colonel Mustard', 'COLONEL MUSTARD', 'colonel_mustard', 'ColonelMustard',
    'Miss Scarlett', 'Miss Scarlet', 'miss-scarlett', 'Professor Plum', 'professorPlum',
    'Mrs. Peacock', 'Mrs Peacock', 'MrsPeacock', 'Mrs. White', 'Mrs White', 'mrs_white',
    'Mr. Green', 'Mr Green', 'MrGreen', 'Reverend Green', 'reverend-green', 'Dr. Orchid', 'dr_orchid',
  ])
    expect(findRestricted(text, []), text).not.toEqual([]);
});

it('restricts the bare title only as an exact-case whole word (D074)', () => {
  for (const [text, found] of [
    ['Clue', 'Clue'], ['CLUE', 'CLUE'], ['a Clue board', 'Clue'], ['"Clue"', 'Clue'],
    ['Clue.', 'Clue'], ['Clue-style', 'Clue'], ['Clue’s', 'Clue'],
  ] as const)
    expect(findRestricted(text, []), text).toEqual([found]);
  for (const text of ['clue', 'clues', 'a clue to the bug', 'ClueAction', 'HintClue', 'clue_token', 'unclued', 'Clues', 'CLUES'])
    expect(findRestricted(text, []), text).toEqual([]);
});

it('leaves ordinary colour words and other games alone (D074)', () => {
  expect(findRestricted('plum, green, white, black, peacock, mustard, scarlet; Plum cargo; Right of Way', [])).toEqual([]);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run --project repo tests/repo-guards.test.ts`
Expected: the first two new tests FAIL (names not restricted, `Clue` not matched); the third passes.

- [ ] **Step 4: Implement in `tests/restricted-names.ts`**

Keep the existing literal as `FIXED_NAMES` and export `RESTRICTED_NAMES = [...FIXED_NAMES, ...REFERENCE_NAMES.flatMap(nameForms)]` with a comment citing D074. `exactWordsIn` uses one case-sensitive global regex `(?<![A-Za-z0-9_])(?:Clue|CLUE)(?![A-Za-z0-9_])` and returns the distinct hits; `findRestricted` unions it with `restrictedIn` and `licensedIn`. Update the file's header comment to describe the third kind of term (exact-case words) and why (an everyday word, spec §8).

- [ ] **Step 5: Run the whole repo project**

Run: `pnpm vitest run --project repo`
Expected: PASS, including `tests/public-build.test.ts`. If the public build scan reports `Clue`/`CLUE` inside a bundled dependency, stop and report it to the owner; do not add an allowance.

- [ ] **Step 6: Lint and commit**

Run: `pnpm exec biome check tests` (expected: clean).
```bash
git add tests/restricted-names.ts tests/repo-guards.test.ts
git commit -m "Guard the reference game of Room for Doubt: names in any form, the title as an exact-case word (D074)"
```

---

### Task 2: The board

**Files:**
- Create: `docs/games/room-for-doubt/board.txt`
- Create: `scripts/room-for-doubt/board.ts`
- Test: `tests/room-for-doubt-board.test.ts`

**Interfaces:**
- Produces (`board.ts`):
  - `SIZE = 24`; `type Square = { readonly x: number; readonly y: number }`; `type Dir = '^' | 'v' | '<' | '>'`.
  - `type RoomId = 'courtroom' | 'chambers' | 'jury' | 'robing' | 'registry' | 'store' | 'cells' | 'belfry' | 'gallery'`; `ROOM_ORDER: readonly RoomId[]` in that order; `ROOM_LETTERS: Readonly<Record<string, RoomId>>` (`C` courtroom, `H` chambers, `J` jury, `R` robing, `Y` registry, `E` store, `L` cells, `B` belfry, `P` gallery); `PASSAGES = [['chambers','store'],['belfry','cells']]`.
  - `interface Door { room: RoomId; door: Square; step: Square; dir: Dir }`; `interface Board { rows: readonly string[]; rooms: Readonly<Record<RoomId, readonly Square[]>>; doors: readonly Door[]; corridor: readonly Square[]; entrances: readonly Square[]; rotunda: { x0: number; y0: number; x1: number; y1: number } }` (`entrances[0]` is Entrance 1; `rooms` holds letter squares and door squares).
  - `parseBoard(text: string): Board` (reads CRLF; drops one trailing newline; throws `Error` if the grid is not 24 × 24 of legal characters).
  - `boardProblems(text: string): string[]` (every violated property of spec §5 plus the trip band above; `[]` when sound; stops after the shape and character checks if those fail).
  - `tripLengths(board: Board): Readonly<Record<string, number>>` keyed `` `${a}-${b}` `` with `a` before `b` in `ROOM_ORDER`: 1 step out + corridor steps between doorsteps + 1 step in, minimised over doors; passages never used.
  - `interface BoardStats { doors: number; corridorSquares: number; median: number; longestOffPassages: number; passageTrips: readonly [number, number]; atMost7: number; within12: Readonly<Record<RoomId, number>> }`; `boardStats(board: Board): BoardStats` (`passageTrips` is chambers–store then belfry–cells); `formatStats(s: BoardStats): string`.
- Consumes: nothing.

**The grid** (`board.txt`, 24 lines of 24 characters, one trailing newline; legend: `.` corridor, `#` Rotunda, letters rooms, `^ v < >` a door on a room's edge square pointing at its doorstep, `1`–`6` Entrances):

```
HHHHHH.1CCCCCCCCC.2BBBBB
HHHHHH..CCCCCCCCC..BBBBB
HHHHHH..<CCCCCCCC..BBBBB
HHHHH>..CCCCCCCCC..BBBBB
HHHHHH..CCCCCCCCC..BBBBB
HvHHHH..CCCCvCCCC..<BBBB
...................BBvBB
.......................3
........................
..JJJ^JJ.######..PPP^PPP
..JJJJJJ.######..<PPPPPP
..<JJJJJ.######..PPPPPPP
6.JJJJJ>.######..PPPPPPP
..JJJJJJ.######..<YYYYYY
..JJJJJJ.######..YYYYYYY
.................<YYYYYY
.................YYYYYYY
L^LLLL............EEEEEE
LLLLLL..RR^RRRR...<EEEEE
LLLLLL..RRRRRRR...EEEEEE
LLLLL>..RRRRRRR...EEEEEE
LLLLLL..RRRRRR>...<EEEEE
LLLLLL..RRRRRRR...EEEEEE
LLLLLL5.RRRRRRR4..EEEEEE
```

**Problem messages** (exact text, `${…}` filled in): `grid is not 24 x 24`; `illegal character '${c}' at ${x},${y}`; `the # squares are not one rectangle`; `the Rotunda is ${w} x ${h} (want 5 to 7 a side)`; `the Rotunda is not centred`; `door at ${x},${y} has no room behind it`; `doorstep ${sx},${sy} of the door at ${x},${y} is not a corridor square`; `doorstep ${sx},${sy} serves two doors`; `room ${id} is not one connected region`; `room ${id} does not touch its corner`; `room ${id} has ${n} doors (want 1 to ${max})` (max 2 for the four corner rooms, else 4); `${n} doors in all (want 17 to 19)`; `${n} corridor squares (want 190 to 230)`; `dead end at ${x},${y}` (a corridor square with fewer than two neighbours among corridor squares and the room behind its door); `corridor squares are not all connected`; `entrance ${n} is missing`; `entrance ${n} is not on the outer ring`; `entrances are not in clockwise order`; `entrances ${a} and ${b} are only ${g} apart (want 6 or more)`; `${a} and ${b} cannot reach each other`; `median trip ${m} (want 9 to 14)`; `trip from ${a} to ${b} is ${t} (want 24 or less when no passage joins them)`; `passage from ${a} to ${b} is only ${t} on foot (want 24 or more)`; `only ${n} trips of 7 or fewer (want 5 or more)`; `${room} has ${n} rooms within 12 (want 3 or more)`. Clockwise position along the 92-square outer ring runs from the north-west corner along the top, down the east side, back along the bottom and up the west side; Entrances need a gap of at least 6 around the ring, including from 6 back to 1.

- [ ] **Step 1: Write the failing test** (`tests/room-for-doubt-board.test.ts`)

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardProblems, boardStats, formatStats, parseBoard } from '../scripts/room-for-doubt/board.ts';

const text = readFileSync(join(import.meta.dirname, '../docs/games/room-for-doubt/board.txt'), 'utf8');
/** The grid with the square at (x, y) replaced by `c`. */
const set = (t: string, x: number, y: number, c: string): string => {
  const rows = t.split('\n');
  rows[y] = (rows[y] ?? '').slice(0, x) + c + (rows[y] ?? '').slice(x + 1);
  return rows.join('\n');
};

describe('board.txt', () => {
  it('satisfies every property of spec section 5', () => expect(boardProblems(text)).toEqual([]));
  it('has the measured numbers RULES.md quotes', () => {
    const stats = boardStats(parseBoard(text));
    expect(stats).toEqual({
      doors: 19, corridorSquares: 197, median: 13.5, longestOffPassages: 22, passageTrips: [28, 29], atMost7: 7,
      within12: { courtroom: 4, chambers: 3, jury: 4, robing: 4, registry: 4, store: 3, cells: 3, belfry: 3, gallery: 4 },
    });
    expect(formatStats(stats)).toBe(
      '19 doors · 197 corridor squares · median trip 13.5 · longest trip off the passages 22 · passage trips 28 and 29 · 7 trips of 7 or fewer',
    );
  });
  it('reads CRLF line endings as the same board', () =>
    expect(parseBoard(text.replaceAll('\n', '\r\n'))).toEqual(parseBoard(text)));

  const mutations: [string, (t: string) => string, RegExp][] = [
    ['a missing row', (t) => t.split('\n').slice(1).join('\n'), /grid is not 24 x 24/],
    ['an illegal character', (t) => set(t, 3, 3, 'Z'), /illegal character 'Z' at 3,3/],
    ['a hole in the Rotunda', (t) => set(t, 10, 10, '.'), /the # squares are not one rectangle/],
    ['a door with no room behind it', (t) => set(t, 3, 7, '<'), /door at 3,7 has no room behind it/],
    ['a doorstep inside a room', (t) => set(t, 6, 3, 'H'), /doorstep 6,3 of the door at 5,3 is not a corridor square/],
    ['a doorstep serving two doors', (t) => set(set(set(t, 17, 15, 'Y'), 17, 16, 'v'), 18, 17, '<'), /doorstep 17,17 serves two doors/],
    ['a dead end', (t) => set(t, 18, 1, 'B'), /dead end at 18,0/],
    ['a room with no doors', (t) => set(set(t, 19, 5, 'B'), 21, 6, 'B'), /room belfry has 0 doors \(want 1 to 2\)/],
    ['entrances out of order', (t) => set(set(t, 7, 0, '2'), 18, 0, '1'), /entrances are not in clockwise order/],
    ['an entrance off the outer ring', (t) => set(set(t, 0, 12, '.'), 1, 12, '6'), /entrance 6 is not on the outer ring/],
    ['a corner room away from its corner', (t) => set(t, 0, 0, '.'), /room chambers does not touch its corner/],
    ['too few corridor squares', (t) => Array.from({ length: 17 }, (_, x) => x).reduce((a, x) => set(a, x, 8, 'C'), t), /corridor squares \(want 190 to 230\)/],
  ];
  for (const [name, mutate, message] of mutations)
    it(`rejects ${name}`, () => expect(boardProblems(mutate(text)).join('\n')).toMatch(message));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project repo tests/room-for-doubt-board.test.ts`
Expected: FAIL (cannot find `scripts/room-for-doubt/board.ts`).

- [ ] **Step 3: Create `board.txt`** with exactly the grid above.

Run: `sha256sum docs/games/room-for-doubt/board.txt`
Expected: `0a5e3b73a826038722f075beed8d8110b624f49ff0cb50217c5cce44209d321a`.

- [ ] **Step 4: Implement `scripts/room-for-doubt/board.ts`** to the signatures and messages above. Approach: classify each character once; an arrow's room is the letter behind it and its doorstep the square it points at; corridor distances by breadth-first search over corridor squares; the median is over all 36 room pairs. `formatStats` joins the parts with ` · ` exactly as the test expects.

- [ ] **Step 5: Run the test**

Run: `pnpm vitest run --project repo tests/room-for-doubt-board.test.ts`
Expected: PASS (all 15 tests).

- [ ] **Step 6: Lint, typecheck, commit**

Run: `pnpm exec biome check scripts tests && pnpm exec tsc -p tests/tsconfig.json` (expected: clean).
```bash
git add docs/games/room-for-doubt/board.txt scripts/room-for-doubt/board.ts tests/room-for-doubt-board.test.ts
git commit -m "Room for Doubt: the board grid and the checker that proves its properties (D074)"
```

---

### Task 3: Shared data, SVG helpers and glyphs

**Files:**
- Create: `scripts/room-for-doubt/data.ts`, `scripts/room-for-doubt/svg.ts`, `scripts/room-for-doubt/glyphs.ts`
- Test: `tests/room-for-doubt-data.test.ts`

**Interfaces:**
- Consumes: `RoomId`, `ROOM_ORDER`, `ROOM_LETTERS` from `board.ts`.
- Produces (`data.ts`):
  - `type PartyId = 'ashdown' | 'brine' | 'reeve' | 'crowther' | 'faulk' | 'quarrel'`; `type ExhibitId = 'gavel' | 'scales' | 'reports' | 'carafe' | 'manacles' | 'clockhand'`; `type EmblemId = 'wig' | 'bowler' | 'pincenez' | 'whistle' | 'broadarrow' | 'quill'`; `type Accent = 'oxblood' | 'umber' | 'ivory' | 'slate' | 'ochre' | 'teal'`.
  - `PARTIES: readonly { id: PartyId; name: string; role: string; monogram: string; emblem: EmblemId; accent: Accent; entrance: string }[]` in party order, from spec §4.1 (Ashdown wig oxblood; Brine bowler umber; Reeve pincenez ivory; Crowther whistle slate; Faulk broadarrow ochre; Quarrel quill teal), monograms `RA HB OR BC LF DQ`.
  - `EXHIBITS: readonly { id: ExhibitId; name: string }[]`; `SCENES: readonly { id: RoomId; name: string; corner: boolean }[]` in `ROOM_ORDER`.
  - `PALETTE: Readonly<Record<PaletteName, string>>` with `type PaletteName = 'ink' | 'parchment' | 'oxblood' | 'brass' | 'slate' | 'teal' | 'ochre' | 'umber' | 'ivory'` (hex values of spec §6); `ON_ACCENT: Readonly<Record<Accent, 'ink' | 'ivory'>>` (oxblood, umber, slate, teal take ivory; ivory, ochre take ink); `TEXT_PAIRS: readonly (readonly [PaletteName, PaletteName])[]` of every foreground/background pair the art uses as text (include ink/parchment, ink/ivory, ivory/ink, parchment/ink, ink/brass, and each accent with its `ON_ACCENT`); `FONT_SERIF`, `FONT_SANS` (generic stacks).
  - `SEAT_PARTIES: Readonly<Record<3 | 4 | 5 | 6, readonly PartyId[]>>` per spec §4.3 P1.
  - `contrast(a: string, b: string): number` (WCAG ratio of two `#rrggbb` colours); `estimateWidth(s: string, size: number): number` = `s.length * size * 0.56`; `fitText(s: string, size: number, maxWidth: number, minSize = 12): { size: number; textLength?: number }` (shrinks the size until the estimate fits; at `minSize` still too wide, returns `textLength: maxWidth`).
- Produces (`svg.ts`): `type Attrs = Record<string, string | number | undefined>`; `el(tag: string, attrs?: Attrs, ...children: (string | undefined)[]): string` (omits undefined attrs, self-closes with no children); `text(content: string, attrs?: Attrs): string` (escapes `& < >`); `svgDocument(opts: { width: number; height: number; title: string; desc: string; comment?: string }, body: string): string` (XML declaration, a comment naming CC0-1.0 and `opts.comment`, `role="img"`, `viewBox="0 0 w h"`, `<title>`, `<desc>`); `isWellFormed(svg: string): boolean` (balanced tags, no stray `<`, no unescaped `&`).
- Produces (`glyphs.ts`): `EMBLEMS: Readonly<Record<EmblemId, string>>`, `EXHIBIT_GLYPHS: Readonly<Record<ExhibitId, string>>`, `SCENE_GLYPHS: Readonly<Record<RoomId, string>>` (markup for a 64 × 64 box, line art drawn in `currentColor`); `glyph(markup: string, x: number, y: number, size: number, color: string): string` (a `<g>` that places and scales it, setting `color`, `fill="none"`, `stroke="currentColor"`, `stroke-width` 3 and round caps and joins).

**Glyph subjects** (recognisable at 32 px, solid parts allowed, stroke weight consistent): emblems: `wig` a barrister's wig with curled rolls and a queue; `bowler` a bowler hat; `pincenez` pince-nez with a chain; `whistle` a whistle on a ring; `broadarrow` the convict broad arrow; `quill` a feather quill with a nib. Exhibits: `gavel` a mallet on its block; `scales` brass balance scales; `reports` a thick bound volume with a ribbon; `carafe` a water carafe with a stopper; `manacles` two open cuffs on a chain; `clockhand` an ornate spade-shaped clock hand. Scenes: `courtroom` a bench with a witness rail; `chambers` an armchair behind a desk with a lamp; `jury` a round table ringed by twelve chairs; `robing` hooks with a gown and a wig stand; `registry` a filing cabinet with labelled drawers; `store` shelves with tagged boxes; `cells` a barred arched window; `belfry` a bell in an arched louvred opening; `gallery` stepped benches with a rail.

- [ ] **Step 1: Write the failing test** (`tests/room-for-doubt-data.test.ts`)

```ts
it('has 6 parties, 6 exhibits and 9 scenes with unique ids, monograms and emblems', () => {
  expect([PARTIES.length, EXHIBITS.length, SCENES.length]).toEqual([6, 6, 9]);
  for (const key of ['id', 'monogram', 'emblem'] as const) expect(new Set(PARTIES.map((p) => p[key])).size).toBe(6);
  expect(SCENES.filter((s) => s.corner).map((s) => s.id)).toEqual(['chambers', 'store', 'cells', 'belfry']);
});
it('spreads the parties by seat count (P1)', () => {
  expect(SEAT_PARTIES[3]).toEqual(['ashdown', 'reeve', 'faulk']);
  expect(SEAT_PARTIES[4]).toEqual(['ashdown', 'brine', 'crowther', 'faulk']);
  expect(SEAT_PARTIES[5]).toEqual(['ashdown', 'brine', 'reeve', 'crowther', 'faulk']);
  expect(SEAT_PARTIES[6]).toEqual(PARTIES.map((p) => p.id));
});
it('keeps every text pair at WCAG AA (4.5) and every party accent readable', () => {
  for (const [fg, bg] of TEXT_PAIRS) expect(contrast(PALETTE[fg], PALETTE[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  for (const p of PARTIES) expect(contrast(PALETTE[ON_ACCENT[p.accent]], PALETTE[p.accent]), p.id).toBeGreaterThanOrEqual(4.5);
});
it('draws every emblem, exhibit and scene, well-formed, in palette colours only, under 3 KB', () => {
  const all = [...Object.entries(EMBLEMS), ...Object.entries(EXHIBIT_GLYPHS), ...Object.entries(SCENE_GLYPHS)];
  expect(all).toHaveLength(21);
  const hex = Object.values(PALETTE).map((h) => h.toLowerCase());
  for (const [id, markup] of all) {
    expect(isWellFormed(`<svg>${markup}</svg>`), id).toBe(true);
    expect(markup.length, id).toBeLessThan(3000);
    for (const c of markup.match(/#[0-9a-fA-F]{6}\b/g) ?? []) expect(hex, id).toContain(c.toLowerCase());
  }
});
it('fits every display name at its layout size without squeezing (fitText)', () => {
  expect(fitText('Gavel', 24, 210)).toEqual({ size: 24 });
  expect(fitText('Barnaby Crowther', 24, 210).textLength).toBeUndefined();
  expect(fitText('x'.repeat(80), 24, 210)).toEqual({ size: 12, textLength: 210 });
  for (const n of [...PARTIES.map((p) => p.name), ...EXHIBITS.map((e) => e.name), ...SCENES.map((s) => s.name)])
    expect(fitText(n, 24, 210).textLength, n).toBeUndefined();
});
it('isWellFormed accepts balanced markup and rejects the rest', () => {
  expect(isWellFormed('<svg a="1"><g><path d="M0 0"/></g><!-- c --></svg>')).toBe(true);
  for (const bad of ['<svg><g></svg>', '<svg></g></svg>', '<svg>a & b</svg>', '<svg><</svg>']) expect(isWellFormed(bad), bad).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project repo tests/room-for-doubt-data.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `data.ts` and `svg.ts`** to the signatures above, with the spec's exact names, roles, entrances (Counsel's Door, Jurors' Door, Infirmary Door, Staff Door, Prisoners' Door, Press Door) and palette hexes.

- [ ] **Step 4: Implement `glyphs.ts`** (21 glyphs, subjects above). Then make the scratch renderer and inspect a contact sheet. Create `$SCRATCH/render.mjs`:

```js
// node render.mjs <svg path> <png path> [scale]: screenshots an SVG file with Chromium (QA only).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/home/user/bored-games/apps/web/package.json');
const { chromium } = require('@playwright/test');
const [svg, png, scale = '1'] = process.argv.slice(2);
const m = readFileSync(svg, 'utf8').match(/viewBox="0 0 (\d+) (\d+)"/);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(m[1]), height: Number(m[2]) }, deviceScaleFactor: Number(scale) });
await page.goto(`file://${svg}`);
await page.screenshot({ path: png });
await browser.close();
```

Write `$SCRATCH/contact.mjs` that imports the three glyph records and `glyph`/`svgDocument` from `/home/user/bored-games/scripts/room-for-doubt/` (Node loads the `.ts` files directly), lays all 21 out at 96 px with their ids in a grid on a parchment background, and writes `$SCRATCH/contact.svg`; render it with `node render.mjs $SCRATCH/contact.svg $SCRATCH/contact.png` and open the PNG with the Read tool.
Expected, by eye: every glyph is recognisable as its subject, none clipped by the 64 × 64 box, line weight is even across the sets. Redraw any that fail.

- [ ] **Step 5: Run the tests, lint, typecheck**

Run: `pnpm vitest run --project repo tests/room-for-doubt-data.test.ts && pnpm exec biome check scripts tests && pnpm exec tsc -p tests/tsconfig.json`
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add scripts/room-for-doubt/data.ts scripts/room-for-doubt/svg.ts scripts/room-for-doubt/glyphs.ts tests/room-for-doubt-data.test.ts
git commit -m "Room for Doubt: shared data, SVG helpers and the 21 glyphs (D074)"
```

---

### Task 4: Board art and the generator

**Files:**
- Create: `scripts/room-for-doubt/art/board.ts`, `scripts/room-for-doubt/art/index.ts`, `scripts/room-for-doubt/cli.ts`
- Create (generated): `docs/games/room-for-doubt/art/board.svg`
- Test: `tests/room-for-doubt-art.test.ts`

**Interfaces:**
- Consumes: `parseBoard`, `Board` from `board.ts`; `PARTIES`, `SCENES`, `PALETTE`, `ON_ACCENT`, `FONT_SERIF`, `FONT_SANS`, `fitText` from `data.ts`; `svgDocument`, `el`, `text` from `svg.ts`; the glyph records and `glyph` from `glyphs.ts`.
- Produces: `CELL = 48`, `MARGIN = 60` and `renderBoard(board: Board, boardText: string): string` from `art/board.ts`; from `art/index.ts`: `ART_FILES: readonly string[]` (now `['board.svg']`; later tasks append) and `renderAll(boardText: string): Record<string, string>`; `cli.ts` reads `board.txt`, writes each rendered file into `docs/games/room-for-doubt/art/` and prints the names.

**Board art** (`viewBox` 1272 × 1272 = 24 × 48 + 2 × 60): parchment frame; corridor squares ivory with brass grid lines at low opacity; each room a tinted block (tints by `opacity` over palette colours) with its scene glyph (64 px), its name in `FONT_SERIF` (via `fitText`) and a brass arch for each door; the Rotunda a dome ring set into its 6 × 6 block with a strongbox and the word VERDICT; the two Old Gaol Passages drawn as dashed ink lines under the rooms between their corner rooms, with a hatch icon in each corner room; each Entrance a numbered brass disc with the party's emblem and monogram, its door name outside the board edge; the Colonnade suggested by column outlines in the margin beside the west corridor. Groups carry `id="room-<sceneId>"` (nine), `id="rotunda"`, `id="entrance-<n>"` (six), `id="passage-chambers-store"`, `id="passage-belfry-cells"`; every door element carries `data-door="<sceneId>"` (19 in all). The file includes the comment `board.txt sha256: <hex>`.

- [ ] **Step 1: Write the failing test** (`tests/room-for-doubt-art.test.ts`)

```ts
const root = join(import.meta.dirname, '..');
const game = join(root, 'docs/games/room-for-doubt');
const boardText = readFileSync(join(game, 'board.txt'), 'utf8');
const rendered = renderAll(boardText);
const hex = Object.values(PALETTE).map((h) => h.toLowerCase());
let strings: string[] = [];
beforeAll(async () => {
  strings = await licensedPackStrings(root);
});

it('renders exactly the listed files', () => expect(Object.keys(rendered)).toEqual([...ART_FILES]));
for (const name of ART_FILES) {
  describe(name, () => {
    const svg = rendered[name] ?? '';
    it("on disk equals the generator's output (run: node scripts/room-for-doubt/cli.ts)", () =>
      expect(readFileSync(join(game, 'art', name), 'utf8')).toBe(svg));
    it('is well-formed, titled, CC0, palette-only and holds no restricted name', () => {
      expect(isWellFormed(svg)).toBe(true);
      expect(svg).toMatch(/<title>[^<]+<\/title>/);
      expect(svg).toContain('CC0-1.0');
      for (const c of svg.match(/#[0-9a-fA-F]{6}\b/g) ?? []) expect(hex).toContain(c.toLowerCase());
      expect(findRestricted(svg, strings)).toEqual([]);
    });
  });
}
describe('board.svg', () => {
  const svg = rendered['board.svg'] ?? '';
  it('draws every room, entrance, door and passage from the grid', () => {
    for (const s of SCENES) expect(svg).toContain(`id="room-${s.id}"`);
    for (let n = 1; n <= 6; n++) expect(svg).toContain(`id="entrance-${n}"`);
    expect(svg.match(/data-door="/g)).toHaveLength(19);
    for (const id of ['rotunda', 'passage-chambers-store', 'passage-belfry-cells']) expect(svg).toContain(`id="${id}"`);
  });
  it('carries the grid hash', () =>
    expect(svg).toContain(`board.txt sha256: ${createHash('sha256').update(boardText).digest('hex')}`));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project repo tests/room-for-doubt-art.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `art/board.ts`, `art/index.ts` and `cli.ts`**, then generate: `node scripts/room-for-doubt/cli.ts`.
Expected: prints `board.svg`; `docs/games/room-for-doubt/art/board.svg` exists.

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run --project repo tests/room-for-doubt-art.test.ts`
Expected: PASS.

- [ ] **Step 5: Visual QA** — `node $SCRATCH/render.mjs $PWD/docs/games/room-for-doubt/art/board.svg $SCRATCH/board.png 0.75`, open the PNG.
Expected, by eye: squares and doors are legible; no label overlaps a door or Entrance; every room name fits; the nine glyphs are distinct; Entrance discs read 1–6 clockwise; the passages are visible without hiding squares.

- [ ] **Step 6: Lint, typecheck, commit**

Run: `pnpm exec biome check scripts tests && pnpm exec tsc -p tests/tsconfig.json`
```bash
git add scripts/room-for-doubt tests/room-for-doubt-art.test.ts docs/games/room-for-doubt/art/board.svg
git commit -m "Room for Doubt: the board art and the generator that draws it from the grid (D074)"
```

---

### Task 5: Card art

**Files:**
- Create: `scripts/room-for-doubt/art/cards.ts`; modify `art/index.ts` (append `cards.svg` to `ART_FILES` and `renderAll`)
- Create (generated): `docs/games/room-for-doubt/art/cards.svg`
- Modify: `tests/room-for-doubt-art.test.ts`

**Interfaces:**
- Consumes: Task 3 modules.
- Produces: `CARD_W = 250`, `CARD_H = 350`; `CARD_LAYOUT: readonly { id: string; x: number; y: number }[]` (27 slots; `id` is the element id: `card-<party, exhibit or scene id>`, `card-back`, `verdict-envelope`); `renderCards(): string`.

**Cards art**: one sheet, three rows of nine slots (gap 24, margin 40, so `viewBox` 2522 × 1178): row 1 the six Party cards then the card back; row 2 the six Exhibit cards then the Verdict envelope; row 3 the nine Scene cards. Each face is a 250 × 350 rounded card with a 4 px ink border; a top band (Party: its accent; Exhibit: brass; Scene: slate) with the category in small capitals in the band's `ON_ACCENT`-style text colour; the monogram (Parties) or a 28 px glyph (others) in the top-left and, rotated 180°, the bottom-right corner; the 128 px glyph centred; the name in `FONT_SERIF` through `fitText(name, 24, 210)`; a footer line (Party: role through `fitText(…, 14, 210)`; others "Exhibit" or "Scene"). The back is oxblood with a double brass border and a brass seal bearing "R·D". The envelope is a parchment envelope with an oxblood wax seal and the words THE VERDICT. Each slot is `<g id="card-<id>">` (back `card-back`, envelope `verdict-envelope`).

- [ ] **Step 1: Add failing tests** (in `room-for-doubt-art.test.ts`)

```ts
describe('cards.svg', () => {
  const svg = rendered['cards.svg'] ?? '';
  it('holds the 21 faces, the back and the envelope, each once', () => {
    const ids = [
      ...PARTIES.map((p) => `card-${p.id}`),
      ...EXHIBITS.map((e) => `card-${e.id}`),
      ...SCENES.map((s) => `card-${s.id}`),
      'card-back',
      'verdict-envelope',
    ];
    for (const id of ids) expect(svg.split(`id="${id}"`), id).toHaveLength(2);
  });
  it('lays the 27 slots out inside the sheet with no overlap', () => {
    expect(CARD_LAYOUT).toHaveLength(27);
    for (const a of CARD_LAYOUT) {
      expect(a.x >= 0 && a.y >= 0 && a.x + CARD_W <= 2522 && a.y + CARD_H <= 1178, a.id).toBe(true);
      for (const b of CARD_LAYOUT) if (a !== b) expect(a.x + CARD_W <= b.x || b.x + CARD_W <= a.x || a.y + CARD_H <= b.y || b.y + CARD_H <= a.y, `${a.id}/${b.id}`).toBe(true);
    }
  });
  it('names every card through fitText with no squeezed text', () => expect(svg).not.toContain('textLength'));
});
```
- [ ] **Step 2: Run to verify it fails**, **Step 3: implement `cards.ts`, register it, regenerate** (`node scripts/room-for-doubt/cli.ts`), **Step 4: run** `pnpm vitest run --project repo tests/room-for-doubt-art.test.ts` (expected PASS).

- [ ] **Step 5: Visual QA** — render `cards.svg` at 0.5 and open it; also crop-check a Party card, an Exhibit and a Scene at 1.0.
Expected: every name and role fits inside its card, glyphs are centred and clear, corner indices are legible at card size, no two cards overlap, the back and envelope read as such.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
git add scripts/room-for-doubt docs/games/room-for-doubt/art/cards.svg tests/room-for-doubt-art.test.ts
git commit -m "Room for Doubt: the 21 card faces, the card back and the Verdict envelope (D074)"
```

---

### Task 6: Pieces and docket

**Files:**
- Create: `scripts/room-for-doubt/art/pieces.ts`, `scripts/room-for-doubt/art/docket.ts`; modify `art/index.ts` (append `pieces.svg`, `docket.svg`)
- Create (generated): `docs/games/room-for-doubt/art/pieces.svg`, `docket.svg`
- Modify: `tests/room-for-doubt-art.test.ts`

**Interfaces:**
- Consumes: Task 3 modules.
- Produces: `renderPieces(): string`, `renderDocket(): string`.

**Pieces**: sheet `viewBox` 1000 × 560: row 1 the six party pawns as 120 px discs (accent fill, the emblem glyph in the `ON_ACCENT` colour, the monogram beneath in a brass ring, the name through `fitText(…, 16, 150)`); row 2 the six Exhibit tokens as 120 px brass rounded squares with the ink glyph and name; row 3 the six faces of a die (pips in ink on ivory, 96 px). Ids: `pawn-<party>`, `token-<exhibit>`, `die-1`…`die-6`.
**Docket**: A4 portrait `viewBox` 794 × 1123: header (DOCKET, the Aldermoor Assize Courts, a Name line), then Parties (6 rows), Exhibits (6) and Scenes (9), each row a small glyph, the name through `fitText(…, 16, 200)` and six tick boxes (one per other player, with a "mine" box first), and a notes area. Ids `docket-row-<card id>` (21) and `docket-notes`.

- [ ] **Step 1: Add failing tests**

```ts
describe('pieces.svg', () => {
  const svg = rendered['pieces.svg'] ?? '';
  it('draws six pawns, six tokens and six dice faces', () => {
    for (const p of PARTIES) expect(svg).toContain(`id="pawn-${p.id}"`);
    for (const e of EXHIBITS) expect(svg).toContain(`id="token-${e.id}"`);
    for (let n = 1; n <= 6; n++) expect(svg).toContain(`id="die-${n}"`);
    expect(svg).not.toContain('textLength');
  });
});
describe('docket.svg', () => {
  const svg = rendered['docket.svg'] ?? '';
  it('has a row for each of the 21 cards and a notes area', () => {
    for (const id of [...PARTIES.map((p) => p.id), ...EXHIBITS.map((e) => e.id), ...SCENES.map((s) => s.id)]) expect(svg).toContain(`id="docket-row-${id}"`);
    expect(svg).toContain('id="docket-notes"');
    expect(svg).not.toContain('textLength');
  });
});
```

- [ ] **Step 2: Run to verify it fails**, **Step 3: implement both renderers, register, regenerate**, **Step 4: run the art test file** (expected PASS).

- [ ] **Step 5: Visual QA** — render both (`pieces.svg` at 1.0, `docket.svg` at 0.8).
Expected: pawns are told apart without colour (emblem and monogram), names fit, dice pips are correct, docket rows align and nothing is clipped at the page edge.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
git add scripts/room-for-doubt docs/games/room-for-doubt/art/pieces.svg docs/games/room-for-doubt/art/docket.svg tests/room-for-doubt-art.test.ts
git commit -m "Room for Doubt: pawns, tokens, dice and the printable docket (D074)"
```

---

### Task 7: Cover art

**Files:**
- Create: `scripts/room-for-doubt/art/cover.ts`; modify `art/index.ts` (append `cover.svg`)
- Create (generated): `docs/games/room-for-doubt/art/cover.svg`
- Modify: `tests/room-for-doubt-art.test.ts`

**Interfaces:**
- Consumes: Task 3 modules.
- Produces: `renderCover(): string`.

**Cover**: `viewBox` 1200 × 800; a night scene of the Aldermoor Assize Courts (a columned portico and steps, a lit belfry with a clock face, storm clouds and rain lines, the lamp's long shadow across the steps) in the palette; the title ROOM FOR DOUBT in `FONT_SERIF` and the tagline "Leave no room for doubt." Group `id="cover"`.

- [ ] **Step 1: Add a failing test**

```ts
describe('cover.svg', () => {
  const svg = rendered['cover.svg'] ?? '';
  it('shows the title and tagline', () => {
    expect(svg).toContain('id="cover"');
    expect(svg).toContain('ROOM FOR DOUBT');
    expect(svg).toContain('Leave no room for doubt.');
  });
});
```

- [ ] **Step 2: Run to verify it fails**, **Step 3: implement, register, regenerate**, **Step 4: run the art test file** (expected PASS).

- [ ] **Step 5: Visual QA** — render at 0.75.
Expected: the title and tagline are legible against the scene, the building reads as a courthouse, nothing is clipped, the mood is night and storm.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
git add scripts/room-for-doubt docs/games/room-for-doubt/art/cover.svg tests/room-for-doubt-art.test.ts
git commit -m "Room for Doubt: the cover (D074)"
```

---

### Task 8: RULES.md, the spec-only listing and the docs test

**Files:**
- Create: `docs/games/room-for-doubt/RULES.md`
- Modify: `tests/catalog.test.ts` (`SPEC_ONLY` becomes `['hanabi', 'room-for-doubt']`, and the header comment lists "Room for Doubt, D074")
- Test: `tests/room-for-doubt-docs.test.ts`

**Interfaces:**
- Consumes: `PARTIES`, `EXHIBITS`, `SCENES` from `data.ts`; `parseBoard`, `boardStats`, `formatStats` from `board.ts`; `findRestricted` from `restricted-names.ts`.

**RULES.md outline** (new prose throughout, never a paraphrase of the reference rulebook; mirror `docs/games/right-of-way/RULES.md`; draw the content from the spec section given):
1. `# Room for Doubt rules` — what it is, source of truth, status "spec only (D074)".
2. `## Name, brand and what is original` — `### The name` (pun, tagline, fallback, clearance; spec §2, §4.1), `### What is the same, and why it may be` (the 17 U.S.C. §102(b) paragraph as in Right of Way, then the table of spec §4.2), `### Glossary` (Room for Doubt term, reference term, engine id), `### Brand pack (for the build)` (the four strings of spec §4.1).
3. `## Sources and interpretations` — the sources and the basis table (spec §3).
4. `## Components`; 5. `## The board` — legend, the grid in a fenced block, the rooms table (letter, name, corner, door count), the Entrances table (number, party, door name, square), the passages, the originality note (spec §5), and one line between the markers `<!-- board-stats -->` and `<!-- /board-stats -->` holding exactly `formatStats(...)`.
6. `## Setup`; 7. `## Your turn` (`### 1. Move`, `### 2. Submit`, `### Rebutting a submission`, `### 3. Indict`, `### A turn with no possible move`); 8. `## End of the game`.
9. `## Rule options` (spec §4.4); 10. `## Platform rules` (P1–P7, spec §4.3).
11. `## Online play and hidden information` — spec §7 in full: the hidden-things table, indictment resolution, actions, the two gaps, build paths A, B, C with the recommendation, dice and pace, Resign, the catalog entry, interface notes.
12. `## Art direction` (spec §6); 13. `## Verification catalog` with the 45 entries below, each `#### Cnn Title` then its statement as the body.

**Catalog statements** (use as the body of each entry, in prose of your own where it helps):

| Id | Title | Statement |
|---|---|---|
| C01 | Components | 21 cards (6 Parties, 6 Exhibits, 9 Scenes) with the ids of the data tables, 6 party pawns, 6 Exhibit tokens, 2 dice, and the board of `board.txt`. |
| C02 | Seats | Three to six seats are accepted; two and seven are rejected. |
| C03 | The Verdict | One Party, one Exhibit and one Scene are sealed at setup and dealt to no seat. |
| C04 | The deal | The other 18 cards are dealt from seat 0 in the P2 counts, each card held by exactly one seat. |
| C05 | Parties and Entrances | Seats take parties per P1; every pawn, played or not, starts on its Entrance. |
| C06 | Exhibit start | Six distinct rooms from the public setup hold one Exhibit each, identically on every client. |
| C07 | First player | Seat 0 (the Prosecutor) moves first and play passes in seat order. |
| C08 | Turn shape | A turn is movement (or its alternative), then a submission if entitled, then the end; an indictment may come at any point and ends the turn; nothing is accepted out of turn. |
| C09 | Roll | Two dice, sum 2 to 12; a player never sends the dice. |
| C10 | Orthogonal movement | Movement is one orthogonal step at a time; never diagonal. |
| C11 | Occupied squares | A pawn may not enter or end on a square holding any pawn, including unplayed and dismissed parties. |
| C12 | Repeated squares | A square may not be entered twice in one turn. |
| C13 | Doors | A door is passed in one step between its doorstep and the room; the doorway is not a square. |
| C14 | Blocked doors | A door whose doorstep holds a pawn cannot be used, in either direction. |
| C15 | Room entry | Entering a room ends the move whatever roll remains. |
| C16 | No re-entry | A party may not enter the room it left earlier in the same turn. |
| C17 | Old Gaol Passages | From a corner room at the start of a turn, instead of rolling, a party moves to the opposite corner room (Chambers–Evidence Store, Belfry–Holding Cells) and counts as having entered it. |
| C18 | Trapped | A party with no legal move passes its move and may still submit (if moved) or indict. |
| C19 | Roll shortfall | If no path of the full roll exists, the party moves as far as it can (P4). |
| C20 | Submission on entry | After entering a room by roll or passage a party may submit (`submit: 'optional'`) or must (`'required'`). |
| C21 | One submission per entry | A party may not submit twice in a room without leaving and re-entering or being moved there again. |
| C22 | The moved party | A party moved by another's submission may submit in that room at the start of its next turn instead of rolling, or leave normally. |
| C23 | Submission contents | A submission names a Party, an Exhibit and the room the submitter stands in; any Party and Exhibit may be named. |
| C24 | Named items move | The named pawn and token move into the room (nothing moves if already there); a room holds any number. |
| C25 | Own cards | A submission may name cards the submitter holds. |
| C26 | Rebuttal order | The other seats are asked in turn order from the seat after the submitter; a dismissed seat is asked like any other. |
| C27 | One card | A seat holding a named card shows exactly one, privately to the submitter, and the asking stops. |
| C28 | Choice | A seat holding several named cards chooses which to show. |
| C29 | Passing | A seat holding none says so (`none`) and the next seat is asked. |
| C30 | No rebuttal | If every other seat passes, the submission stands and the submitter may end the turn or indict. |
| C31 | Rebuttal privacy | Only the submitter learns which card was shown; every seat sees that one was shown and by whom. |
| C32 | Indict timing | A seat that is not dismissed may indict at any point of its own turn. |
| C33 | Indict once | A seat may indict once per game; a second is rejected. |
| C34 | The Verdict check | An indictment names any Party, Exhibit and Scene; only the indicting seat can read the Verdict, after every other seat has attended. |
| C35 | Upheld | An indictment matching all three ends the game and the indicting seat wins. |
| C36 | Dismissed | Any mismatch dismisses the seat: it may not move, submit or indict, and the Verdict stays sealed to everyone else. |
| C37 | A dismissed seat's duties | It still rebuts and attends, and its pawn can still be named. |
| C38 | A pawn blocking a door | A dismissed party's pawn standing on a doorstep moves into that room at once. |
| C39 | Last standing | When every seat but one is dismissed, the last wins at once. |
| C40 | Named parties move | A Party named in a submission moves whether played, unplayed or dismissed. |
| C41 | Standings | The winner is place 1 with score 1, every other seat shares place 2 with score 0; before the end every standing is 0. |
| C42 | Invalid input | Malformed, out-of-turn or illegal actions are rejected without changing state; each legal action has one accepted encoding. |
| C43 | Determinism and fold | Replaying the same actions from the same setup gives the same state for every seat and spectator. |
| C44 | Audit of hidden claims | At the end every `none`, every shown card and the indictment outcome is checked against the decrypted hands and the Verdict; a false claim fails its seat. |
| C45 | Games end | Every game ends by an upheld indictment or the last standing seat; a game in which no seat ever indicts is a policy bug, not a rules gap (D015). |

- [ ] **Step 1: Write the failing docs test** (`tests/room-for-doubt-docs.test.ts`)

```ts
const game = join(import.meta.dirname, '../docs/games/room-for-doubt');
const rules = readFileSync(join(game, 'RULES.md'), 'utf8');

it('names every card exactly as the data does', () => {
  for (const n of [...PARTIES.map((p) => p.name), ...EXHIBITS.map((e) => e.name), ...SCENES.map((s) => s.name)])
    expect(rules, n).toContain(n);
});
it('has the catalog C01 to C45 in order, each with a body', () => {
  const heads = [...rules.matchAll(/^#### (C\d{2}) (.+)$/gm)];
  expect(heads.map((m) => m[1])).toEqual(Array.from({ length: 45 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`));
  const bodies = rules.split(/^#### C\d{2} .+$/m).slice(1);
  for (const [i, body] of bodies.entries()) expect(body.replace(/^## .*$[\s\S]*/m, '').trim().length, `C${i + 1}`).toBeGreaterThan(20);
});
it('quotes the board numbers the checker computes', () => {
  const stats = formatStats(boardStats(parseBoard(readFileSync(join(game, 'board.txt'), 'utf8'))));
  expect(rules).toContain(`<!-- board-stats -->${stats}<!-- /board-stats -->`);
});
it('holds no placeholder', () => expect(rules).not.toMatch(/\b(TBD|TODO|FIXME)\b/));
it('has no restricted name or licensed string in the board file or the art', async () => {
  const strings = await licensedPackStrings(join(import.meta.dirname, '..'));
  for (const f of ['board.txt', ...readdirSync(join(game, 'art')).map((n) => `art/${n}`)])
    expect(findRestricted(readFileSync(join(game, f), 'utf8'), strings), f).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project repo tests/room-for-doubt-docs.test.ts`
Expected: FAIL (`RULES.md` missing).

- [ ] **Step 3: Write `RULES.md`** to the outline and catalog above. Mark every rule in the sources table **verified**, **recalled**, **platform** or **OPEN**, exactly as spec §3 does. Put the board-stats line between its markers.

- [ ] **Step 4: Update `tests/catalog.test.ts`** (`SPEC_ONLY` and its header comment).

- [ ] **Step 5: Run the docs test and the catalog test**

Run: `pnpm vitest run --project repo tests/room-for-doubt-docs.test.ts tests/catalog.test.ts`
Expected: PASS (the catalog test reports `room-for-doubt: spec only`).

- [ ] **Step 6: Lint, typecheck, commit**

Run: `pnpm exec biome check scripts tests && pnpm exec tsc -p tests/tsconfig.json`
```bash
git add docs/games/room-for-doubt/RULES.md tests/catalog.test.ts tests/room-for-doubt-docs.test.ts
git commit -m "Room for Doubt: the rules spec and its verification catalog; listed as spec only (D074)"
```

---

### Task 9: Records

**Files:**
- Modify: `docs/DECISIONS.md` (append D074 after D067), `docs/PLAN.md` (new status paragraph), `CLAUDE.md` (docs line of the repo map)

- [ ] **Step 1: Append D074 to `docs/DECISIONS.md`** with the heading `## D074: Room for Doubt rules spec, an original board and art; build waits on the hidden-card path (owner request, 2026-10-06)` and bullets, in the style of D066: the owner's request quoted; name, clearance and the fallback; mechanics kept exactly and what is replaced; sources and the verified, platform and OPEN split; platform rules P1–P7 and the two OPEN options; the board (generated from `board.txt`, proven by `tests/room-for-doubt-board.test.ts`, its numbers, and the trip-band reword with its reason); the art (five CC0 files, one generator); the hidden-card gaps and build paths A, B and C with the recommendation (A then B), marked as the owner's decision; the guards (names, the exact-case title and its Hanabi consequence); Resign disabled; "No new dependencies."

- [ ] **Step 2: Add the PLAN paragraph** after the Right of Way block (after its `- **Resign:** disabled.` line) and before the Hanabi spec paragraph: `**Room for Doubt (2026-10-06, D074): rules spec, original board and art; the build waits on the hidden-card path.**` followed by bullets: the package (RULES.md with C01–C45, the board test, five art files), the guards, "Open for the owner" (the hidden-card path A, B or C; name clearance; confirm BoardGameGeek 1294) and "Resign: disabled".

- [ ] **Step 3: Edit `CLAUDE.md`**: in the `docs/` line of the repo map replace `Hanabi is spec only)` with `Hanabi and Room for Doubt are spec only)`. Leave the "Compare to" sentence unchanged (it lists the game once its package exists, spec §8).

- [ ] **Step 4: Commit**

```bash
git add docs/DECISIONS.md docs/PLAN.md CLAUDE.md
git commit -m "Room for Doubt: decision D074, the status entry and the repo map (D074)"
```

---

### Task 10: Verify and publish

- [ ] **Step 1: The generator is in sync**

Run: `node scripts/room-for-doubt/cli.ts && git status --short`
Expected: no changes (the files on disk equal the generator's output).

- [ ] **Step 2: The full check**

Run: `pnpm check`
Expected: PASS (typecheck, Biome and every Vitest project, including the new guard, catalog, board, data, art and docs tests and the public build scan). Allow several minutes.

- [ ] **Step 3: Final visual pass** — render all five art files once more (board 0.75, cards 0.5, pieces 1.0, docket 0.8, cover 0.75) and open each.
Expected: nothing clipped, overlapping or unreadable; the five read as one family.

- [ ] **Step 4: Push and update the draft pull request**

Run: `git push -u origin claude/ecstatic-faraday-80wa85`. Then update the body of bryanmatthewsimonson/bored-games#40 (`mcp__github__update_pull_request`): replace "Still to come" with what is now in it (RULES.md, board and proof, five art files, guards, D074), keep the "For the owner" section (hidden-card path; name clearance; BoardGameGeek 1294), tick the test plan, keep it a draft, and end the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and the session URL.
Expected: the push succeeds and CI starts; the PR stays subscribed for CI and review events.
