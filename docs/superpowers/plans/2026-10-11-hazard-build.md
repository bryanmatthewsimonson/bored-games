# Hazard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Hazard, a trademark-safe world-conquest game with the classic rules' exact mechanics, playable by 3–6 players on the site, with original art, screenshots and a "Compare to" link.

**Architecture:** A pure `GameModule` in `packages/games/hazard` (dice beacon for battles, one hidden 44-card deck `pile` with prompt shares, two-step public reveals for cashed sets, play-phase epochs for reshuffles, sealed re-deals on elimination). Three small generic fixes in `packages/client` make that combination work. A Preact game screen in `apps/web/src/games/hazard` draws an SVG hex atlas from a shared ASCII grid.

**Tech Stack:** TypeScript (erasable syntax, `.ts` imports), Vitest, Preact + Signals, Playwright, pnpm workspaces. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-hazard-design.md`

## Global Constraints

- Pure package rules (CLAUDE.md): no `Math.random`, `Date`, timers, I/O, `node:` imports, `Intl`; state is plain JSON; absent values are `null`; `apply` never throws or mutates; one accepted encoding per action.
- Relative imports end in `.ts`; no enums; `import type` for types.
- The reference title, its publishers and designer never appear outside `docs/`, except the exact phrase in `packages/games/hazard/src/compare.ts`. Avoid the word "risk" in any sense anywhere in the hazard package and web folder (a whole-word scan, Task 1).
- Module id `hazard`, engine version `0.1.0`, seats 3–6, default rules `{ defense: 'choose' }`.
- Deck spec: `{ id: 'pile', size: 44, promptShares: true }`. Epoch positions are `128·k + i`.
- Catalog: `bggId: null`, `compareTo: { title: <from compare.ts>, bggId: 181 }`, `year: null`, `status: 'beta'`, players `{min: 3, max: 6, best: [4, 5]}`, `playMinutes {min: 120, max: 240}`, `typicalTurns: 120`, `weight: 2.1`, `luck: 4`, genre `wargame`, mechanisms `['area-control', 'dice-rolling', 'set-collection', 'capture-elimination']`, modes `['competitive']`, turn `sequential`, `hiddenInfo: true`, `randomness: true`, tags `['conquest', 'map', 'dice', 'armies', 'world']`, `minAge: 10`, art `{ credit: 'Original Meridian atlas and charter artwork by Bored Games', license: 'CC0-1.0' }`.
- Run `pnpm check` before every commit (use `VITEST_MAX_WORKERS=2` on this container). Commit messages end with the session's attribution lines.

## Review Focus

1. A reconnecting or late-joining seat whose captured charters are still sealed: `legalActions` must be `[]` (never a partial list) until every card in that hand is learned, so the screen waits instead of offering wrong sets.
2. An eliminated seat closes its tab: every roll and every reshuffle needs its share, so the game stalls on it. The UI and the rules page must say so ("eliminated players' apps still roll dice"). A timeout claim is the way out.
3. The draw pile and the discard are both empty when a card is earned: there's no card and no epoch, and the turn goes on to the march (C23).
4. A muster that is entered as many small placements: each `muster` action must keep the pool exact, and the stage must turn to attack exactly when the pool reaches 0, never early or late.
5. A conquest that eliminates a seat holding 0 charters, and a conquest that wins the game: there are no re-deals and no trade-down, and the game ends after the advance.

Each line has a test in its owning task (Tasks 4, 6, 5, 3 and 6, in that order).

---

## File Structure

```
packages/games/hazard/
  package.json, tsconfig.json, tsconfig.test.json, ART-LICENSE.md
  src/map.ts         provinces, realms, links, lanes (engine data; ids only)
  src/atlas.ts       the ASCII hex grid and lane list (drawing data, shared by web and tests)
  src/cards.ts       charter kinds, set validity, set values
  src/types.ts       HazardRules, HazardState, HazardAction, HazardEvent
  src/engine.ts      validateRules, setupGame, pendingOf, legalActions, applyAction, parse
  src/battle.ts      attack / defend / rolled / advance / march helpers
  src/charters.ts    cash, reveal, draw, epoch, transfer helpers
  src/view.ts        viewOf, knownTo, learnCard, dealtOf
  src/invariants.ts  checkInvariants, coverageOf
  src/module.ts      the GameModule
  src/theme.ts       HAZARD_THEME (all names) and HAZARD_BRAND
  src/catalog.ts, src/compare.ts, src/index.ts
  test/helpers.ts, test/map.test.ts, test/atlas.test.ts, test/catalog/*.test.ts
packages/client/src/mixed-beacon.ts, session.ts, sim.ts   (Tasks 8–10)
packages/client/test/hazard-session.test.ts
tools/fuzz/src/hazard.ts, tools/fuzz/src/index.ts
apps/web/src/games/hazard/  meta.ts, model.ts, atlas.tsx, charters.tsx, dice.tsx, game.tsx, rules-page.tsx, cover.tsx, hazard.css
apps/web/test/hazard.test.ts
apps/web/e2e/hazard.spec.ts
docs/games/hazard/RULES.md, docs/games/hazard/art/ (cover.svg, thumb.svg)
```

---

### Task 1: Package, map, names and guards

**Files:**
- Create: `packages/games/hazard/{package.json,tsconfig.json,tsconfig.test.json,ART-LICENSE.md}`, `src/{map,atlas,theme,compare,catalog,index}.ts`, `test/map.test.ts`, `test/atlas.test.ts`
- Modify: `vitest.config.ts` (project `hazard`), `tests/restricted-names.ts`, `tests/repo-guards.test.ts`, `tests/public-build.test.ts` (as Gilt & Guile's commit f9e4a1d did), root `CLAUDE.md` command list

**Interfaces (Produces):**
- `map.ts`: `PROVINCES: readonly ProvinceId[]` (42 ids in order `a1…a9, b1…b4, c1…c7, d1…d6, e1…e12, f1…f4`); `type ProvinceId`; `REALMS: readonly {id: 'a'|'b'|'c'|'d'|'e'|'f'; bonus: number; provinces: readonly ProvinceId[]}[]` with bonuses a 5, b 2, c 5, d 3, e 7, f 2; `LINKS: readonly (readonly [ProvinceId, ProvinceId])[]` (the 83 links of the spec's graph, listed in `docs/superpowers/specs` scratch edges); `neighbors(p: ProvinceId): readonly ProvinceId[]`; `adjacent(a, b): boolean`; `provinceIndex(p): number`; `isProvince(x: unknown): x is ProvinceId`.
- `atlas.ts`: `ATLAS_ROWS: readonly string[]` (49 × 25, odd rows offset right, `.` sea, one character per province), `ATLAS_KEY: Readonly<Record<string, ProvinceId>>`, `ATLAS_LANES: readonly (readonly [ProvinceId, ProvinceId])[]` (every link that is not a land contact; `a1–e4` is drawn off both edges), `hexNeighbors(x, y): [number, number][]`.
- `theme.ts`: `HAZARD_THEME = { title: 'Hazard', tagline: 'Six realms. Forty-two provinces. Every roll a hazard.', world: 'the Meridian', realms: Record<RealmId, string>, provinces: Record<ProvinceId, string>, kinds: { spear: 'Spear', horse: 'Horse', cannon: 'Cannon', crown: 'Crown' }, words: {...} }` and `HAZARD_BRAND: BrandNames` (aliases: `['conquest', 'world conquest', 'armies', 'map', 'dice war', 'territory']`).
- `compare.ts`: `COMPARE_PHRASE`, `COMPARE_TITLE`, `COMPARE_BGG_ID = 181`, same shape as Driftwrights'.

Names (exact copy):

| id | name | id | name | id | name |
|---|---|---|---|---|---|
| a1 | Wolfsgate | b1 | Orchid Coast | d1 | Dunesea |
| a2 | Longwinter | b2 | Greatcanopy | d2 | Reedmouth |
| a3 | Rimeholm | b3 | Condor Heights | d3 | Rift Highlands |
| a4 | Elkridge | b4 | Windtail | d4 | Deepgreen |
| a5 | Heartwood | c1 | Ashfall Isle | d5 | Cape Ember |
| a6 | Fogmere | c2 | Fenhallow | d6 | Spice Isle |
| a7 | Sunder Plains | c3 | Fjordmark | f1 | Steppingstones |
| a8 | Lanternshore | c4 | Gildmoor | f2 | Birdwing |
| a9 | Serpent's Neck | c5 | Vintner's Reach | f3 | Redsand |
| e1 | Ironspine | c6 | Marblecoast | f4 | Coralrun |
| e2 | Whitewaste | c7 | Ryegate Steppe | | |
| e3 | Frostfang | e4 | Smoke Cape | e5 | Lakehold |
| e6 | Horsewind | e7 | Cherrystone Isles | e8 | Highpass |
| e9 | Jade Basin | e10 | Caravan Gate | e11 | Monsoon Coast |
| e12 | Tigerfen | | | | |

Realms: a Hollowpine, b Verdance, c the Old Crowns, d Sunscorch, e the Vast, f Farshore.

- [ ] **Step 1: Write the failing tests.** `map.test.ts`: `PROVINCES.length === 42`; `LINKS.length === 83`; no duplicate or self link; `neighbors` symmetric; realm sizes `[9, 4, 7, 6, 12, 4]`, bonuses `[5, 2, 5, 3, 7, 2]`; the graph is connected; degree sequence equals the reference's (sorted: `[2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4,4,4,5,5,5,5,5,5,6,6,6,6,6,6]`; recompute from the edge list and paste the literal). `atlas.test.ts`: every province char appears; each province's hexes are contiguous; land contacts ∪ `ATLAS_LANES` equals `LINKS` exactly; no lane is also a land contact.
- [ ] **Step 2:** Run `pnpm vitest run --project hazard`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement `map.ts` and `atlas.ts` (grid from the scratch `world.txt`, re-keyed to readable characters; hex adjacency as the scratch `check.ts`), `theme.ts`, `compare.ts`, `catalog.ts` (export `HAZARD_CATALOG`; import `HAZARD_ID` from `module.ts` once Task 7 lands; until then a local constant `'hazard'`), and the guards:
  - `FIXED_NAMES` gains `'Lamorisse'` (the designer), with a comment;
  - `ALLOWED_PHRASE_HOMES` gains `'packages/games/hazard/src/compare.ts'`;
  - a whole-word scan, like Holler's at `tests/repo-guards.test.ts:526`, over `packages/games/hazard` and `apps/web/src/games/hazard` for `/\brisk\b/i` after cutting the phrase.
- [ ] **Step 4:** `pnpm vitest run --project hazard tests` → PASS.
- [ ] **Step 5:** Commit "Hazard: package, map, atlas grid, names and guards".

### Task 2: Types, rules, setup, first-player roll, claim and place

**Files:** Create `src/types.ts`, `src/cards.ts`, `src/engine.ts`, `test/helpers.ts`, `test/catalog/setup.test.ts`.

**Interfaces (Produces):**
- `type HazardRules = { readonly defense: 'choose' | 'auto' }`; `DEFAULT_RULES`; `validateRules(raw): Result<HazardRules>` (exact key set).
- `type Stage = 'order' | 'orderRoll' | 'claim' | 'place' | 'muster' | 'reveal' | 'attack' | 'defend' | 'roll' | 'advance' | 'shuffle' | 'march' | 'over'`.
- `HazardState` (all fields plain JSON):
  `rules, seats, viewer: number | null` (null in full mode and for spectators), `full: boolean`, `stage`, `turn`, `owner: (number|null)[42]`, `troops: number[42]`, `reserve: number[]` (unplaced starting troops), `tied: number[]` (seats in the first-player roll), `rolls: DiceRoll[]`, `roll: number | null`, `contributors: number[]`, `rollKind: 'order' | 'battle' | null`, `pool: number`, `midTurn: boolean` (a muster after an elimination), `bonusUsed: boolean`, `captured: boolean`, `battle: {from, to, attack: number, defend: number | null} | null`, `advance: {from, to, min, max} | null`, `hands: {pos: number, card: number | null, holders: number[]}[][]`, `pile: number[]` (positions not yet drawn, in draw order), `discard: {pos, card}[]`, `epoch: number`, `cashes: number`, `cashing: {seat, positions: [n,n,n], bonus: ProvinceId | null} | null`, `revealed: {pos, card}[]`, `out: number[]` (eliminated seats, in order), `fouls: number[]`, `dealt: DealtPosition[]`, `result: Outcome | null`.
- Actions (exact keys): `{type:'roll', actor}`, `{type:'contribute', actor, id}`, `{type:'rolled', actor:'beacon', id, dice}`, `{type:'claim', actor, province}`, `{type:'place', actor, province}`, `{type:'muster', actor, province, count}`, `{type:'cash', actor, positions, bonus}`, `{type:'reveal', actor:'deck', deck:'pile', pos, card}`, `{type:'attack', actor, from, to, dice}`, `{type:'defend', actor, dice}`, `{type:'advance', actor, count}`, `{type:'endAttack', actor}`, `{type:'march', actor, from, to, count}`, `{type:'endTurn', actor}`, `{type:'epoch', actor:'deck', epoch, size}`.
- `cards.ts`: `CARD_COUNT = 44`; `kindOf(card): 'spear'|'horse'|'cannon'|'crown'` (`card < 42 ? ['spear','horse','cannon'][card % 3] : 'crown'`); `provinceOfCard(card): ProvinceId | null`; `isSet(cards: readonly number[]): boolean`; `setValue(n: number): number` (n = sets cashed before: 4, 6, 8, 10, 12, 15, then 15 + 5·(n − 5)).
- Engine exports: `setupGame`, `pendingOf`, `legalActions`, `applyAction`, `parseAction`.
- Rolls follow Room for Doubt (`room-for-doubt/src/engine.ts:612-632`): the requesting action appends `{id: rolls.length, last: requester}`; `contributors` are every seat from the one after the requester round to the requester; `beaconOf` returns the open roll id for `contribute` only; then `{type:'beacon', id}`. `rollShape` = `{count: tied.length, sides: 6}` for an order roll and `{count: attack + defend, sides: 6}` for a battle.

Setup: full mode reads `deckOrders.pile` (a permutation of 0..43); view mode leaves cards null. `pile = [0..43]`; `reserve` from `{3: 35, 4: 30, 5: 25, 6: 20}`; stage `order`, `tied = all seats`, the pending decision is `roll` for `tied[0]`. After `rolled`: the seats with the highest face stay in `tied`; one left → `turn` = it, stage `claim`; otherwise stage `order` again for the new `tied[0]`. A claim puts one troop on an empty province, `reserve − 1`, the turn passes to the next seat; when 42 are held, stage `place` continues from the next seat; seats with `reserve 0` are skipped; when all are 0 the first claimer's turn starts (`startTurn`, Task 3).

- [ ] **Step 1: Write the failing tests** in `test/catalog/setup.test.ts`, one `it('Cnn …')` each: **C01** seats and reserves (35/30/25/20; 2 and 7 seats rejected); **C02** first-player roll (faces `[3,6,6,2]` leave `tied [1,2]`, then `[5,4]` gives turn 1; check `rollShape`); **C03** claim order from the winner, one troop, reserve −1; **C04** claiming a held province is rejected and the state is unchanged; **C05** placement starts at the seat after the last claimer, skips empty reserves; **C06** after the last troop the first claimer's turn starts in `muster`. `helpers.ts` provides `fullGame(seats, order?)`, `act(s, action)` (asserts ok), `rollWith(s, faces)` (contributes for every seat, then applies `rolled`), `claimAll(s)` and `placeAll(s)` (deterministic: lowest-index province).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement types, cards, rules, setup, the order roll, claim and place.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit "Hazard engine: setup, first-player roll, claim and place (C01–C06)".

### Task 3: Turn start and muster

**Files:** Modify `src/engine.ts`; Test `test/catalog/muster.test.ts`.

**Interfaces:** `reinforcements(s, seat): number` = `max(3, ⌊held/3⌋) + Σ bonuses of whole realms`; `startTurn(s, seat)` sets `pool`, `bonusUsed false`, `captured false`, stage `muster`, and emits `{type:'turn', seat}` and `{type:'mustered', seat, troops}`.
`legalActions` in `muster`: `[]` if any card in the seat's hand is `null`; with 5+ cards (not `midTurn`) only `cash` actions; otherwise every legal `cash`, and `muster` actions with `count ∈ {1, pool}` for each held province. `validateIntent(s, seat, raw)` accepts any parsed action that `applyAction` accepts (Quill's pattern, `quill-and-quarry/src/module.ts:42-47`). A `muster` places `count` (1..pool); at `pool 0` the stage becomes `attack` (or back to `attack` when `midTurn`).

- [ ] **Step 1: Failing tests:** **C07** 11 → 3, 14 → 4, 17 → 5, 5 → 3; **C08** each realm bonus counts only when the whole realm is held at turn start; **C09** a split muster (`count 2`, then the rest) works, `attack` stays unavailable until pool 0, and `count 0` and `count > pool` are rejected. **Review Focus 4:** many single placements keep the pool exact and switch to `attack` on the last one, not before.
- [ ] **Steps 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit "Hazard engine: reinforcements and muster (C07–C09)".

### Task 4: Battles

**Files:** Create `src/battle.ts`; modify `src/engine.ts`; Test `test/catalog/battle.test.ts`.

**Interfaces:** `attack` (from held with ≥2 troops, to an enemy neighbor, `dice ∈ 1..min(3, troops−1)`): sets `battle`; with `defense 'auto'` or a 1-troop defender, `defend = min(2, troops)` and the roll starts at once (requester = attacker); else stage `defend`, decision for the defender, `dice ∈ 1..min(2, troops)`, and the defend action requests the roll (requester = defender). `rolled`: the first `attack` faces are the attacker's, the rest the defender's; each side sorted descending; compare pairwise for `min(attack, defend)` pairs, ties to the defender; emit `{type:'battle', seat, from, to, attack: faces, defend: faces, lost: [attackerLost, defenderLost]}`. Defender at 0: the owner changes, `captured = true`, and `advance = {min: attack dice, max: from troops − 1}`; when `min === max` the move happens at once (no stage); otherwise stage `advance`. `advance` lists every count `min..max`.
`legalActions` in `attack`: every legal attack (all dice counts) plus `endAttack`.

- [ ] **Step 1: Failing tests:** **C10** adjacency with lanes and the edge lane (`a1` attacks `e4`), and a 1-troop or own-province attack is rejected; **C11** the attacker's dice bounds; **C12** the defender's choice and a 1-troop defender skipping the decision; **C13** `defense: 'auto'` rolls `min(2, troops)` with no decision; **C14** `[6,3,1]` v `[3,3]` → each loses one; `[2]` v `[2]` → the attacker loses one; **C15** capture: the move-in bounds, and the automatic move when only one count is legal.
- [ ] **Steps 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit "Hazard engine: attacks, dice and capture (C10–C15)".

### Task 5: Charters: draw, cash, reveal, reshuffle

**Files:** Create `src/charters.ts`; modify `src/engine.ts`; Test `test/catalog/charters.test.ts`.

**Interfaces:**
- `endAttack`: if `captured`, draw: if `pile` is empty and `discard` is non-empty, stage `shuffle` (pending `{type:'shuffle', deck:'pile', epoch: epoch + 1, from: discard positions}`); after `{type:'epoch', epoch, size}` the `pile` is `[128·epoch + i for i < size]`, the discard is cleared, and the draw continues. Drawing deals `pile[0]` to the seat (`dealt` gets `{deck:'pile', pos, to: seat}`; a hand slot `{pos, card: full ? order card : null, holders: [seat]}`). Then stage `march`. `installDeckOrder(s, epoch, order)` (full mode only) records the plaintexts for the new positions; `shufflePlaintexts(s)` returns the discard cards in `from` order.
- `cash` (stage `muster`): three distinct held positions, ascending; `bonus` is a province or null. Appends `{to: null}` for the three to `dealt`, sets `cashing`, stage `reveal` (pending `{type:'reveal', deck:'pile', positions}`). Each `reveal` fills `revealed`; when all three are in: the slots leave the hand, the cards go to `discard`; if `isSet` then `pool += setValue(cashes)`, `cashes += 1`, and the bonus applies if `bonus` names a held province shown on one of the three cards and `!bonusUsed` (+2 troops there, `bonusUsed = true`). A non-set, or a `bonus` that does not qualify, or `null` when one qualified, adds the seat to `fouls` (a valid set still pays). Back to `muster`. Emit `{type:'cashed', seat, cards, troops, bonus}`.
- `legalActions` lists a cash for each 3-subset forming a set × each qualifying bonus province (or `null` only when none qualifies or the bonus was used).

- [ ] **Step 1: Failing tests:** **C16** a card on ending attacks after a capture, before the march; **C17** no card without a capture; **C18** set validity (3 alike, 1 each, 2 + crown, crown + crown + any) and an invalid triple is not offered; **C19** values over six successive cashes by different seats: 4, 6, 8, 10, 12, 15, then 20, 25; **C20** the +2 goes on the named held province, once per turn, chosen among matches; **C21** 5 cards at turn start: only cash actions, and a second set is optional; **C22** troops come after the reveal, and the positions are dealt to `null`; **C23** an empty pile reshuffles the cashed charters (positions `128 + i`); with an empty discard too, no card. **Review Focus 3** is C23's second half.
- [ ] **Steps 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit "Hazard engine: charters, cashing and reshuffles (C16–C23)".

### Task 6: Elimination, win, march, end of turn

**Files:** Modify `src/charters.ts`, `src/engine.ts`, `src/battle.ts`; Test `test/catalog/end.test.ts`.

**Interfaces:**
- After a capture's advance: if the defender holds no province, they join `out` and every hand slot moves to the conqueror (`dealt` gets `{pos, to: conqueror}`; `holders` grows; the card stays known in full mode, `null` in the conqueror's view until learned). If the conqueror then holds 6+, stage `muster` with `midTurn = true`: only `cash` until the hand is 4 or fewer; then `muster` for the pool; at pool 0, `attack`. If the conqueror holds all 42: stage `over`, `result` with places (the winner 1, then by elimination, the last one out 2nd), and fouled seats moved to shared last places; `scores` = provinces held.
- `march` (stage `march`): from a held province to an adjacent held one, `count 1..troops−1`; lists `count ∈ {1, max}`, with others through `validateIntent`. It ends the turn. `endTurn` ends it without a move. The next turn goes to the next seat not in `out`.
- `standingsOf(s)`: provinces held per seat.

- [ ] **Step 1: Failing tests:** **C24** captured charters are re-dealt to the conqueror (`dealt` entries, unknown in its view until `learn`); **C25** 6+ forces cash-down to ≤4, then stops, places, and attacks again; **C26** fewer than 6: no cash until the next turn; **C27** march bounds and adjacency, then the next turn; **C28** `endTurn`; **C29** a win at 42 and the places by elimination order; **C30** eliminated seats are skipped in turn order but still contribute to rolls; **C31** a forged set (only buildable in a test) is discarded for nothing and the seat ranks last. **Review Focus 1:** with a captured card still `null`, the conqueror's `legalActions` in a forced cash-down is `[]`. **Review Focus 5:** eliminating a seat with no charters adds no `dealt` entries; the winning capture ends the game after the advance.
- [ ] **Steps 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit "Hazard engine: elimination, victory and the march (C24–C31)".

### Task 7: Module, views, invariants, rules document

**Files:** Create `src/view.ts`, `src/invariants.ts`, `src/module.ts`, `src/index.ts` exports, `test/catalog/module.test.ts`, `docs/games/hazard/RULES.md`.

**Interfaces:** `hazard: GameModule<HazardState, HazardEvent, HazardRules>` with `id 'hazard'`, `version '0.1.0'`, `decks: () => [PILE]`, `rolls`, `beaconOf`, `rollShape`, `installDeckOrder`, `shufflePlaintexts`, `validateIntent`, `revealsOf: () => []`, `resignAllowed: () => false`, `dealt: s => s.dealt`. `viewOf(s, viewer)` hides every hand card whose slot's `holders` lacks the viewer; `knownTo(s, seat)` lists every position the seat ever held whose card is still private; `learnCard` fills a slot (or `revealed`); `checkInvariants` checks troops ≥ 1 on held provinces after the claim, card conservation (pile + hands + discard + cashing = 44 live cards), hand positions unique, `pool ≥ 0`.

- [ ] **Step 1: Failing tests:** **C32** one accepted encoding (wrong keys, extra keys, string numbers, `-0`, unsorted positions all rejected without throwing); **C33** views: other hands' cards hidden, counts public, and the old holder still sees a re-dealt card; **C34** the map facts (re-uses `map.test.ts` assertions under the catalog name). Plus a short fuzz smoke (`fuzzGame` with `uniformPolicy`, 3 seats, 20 seeds, `maxSteps 3000`) that must report no failure (games need not end here).
- [ ] **Step 2:** Write `RULES.md` in new prose: name, glossary, sources (the 1993 book; every rule **verified**/**platform**/**OPEN**), the map table, the full rules, "Online play on this site", and `#### C01`–`#### C34` matching the tests. `tests/catalog.test.ts` then checks the pairing.
- [ ] **Steps 3–4:** Implement and run `pnpm vitest run --project hazard tests/catalog.test.ts` → PASS.
- [ ] **Step 5:** Commit "Hazard: module, views, invariants and RULES.md (C32–C34)".

### Task 8: Platform: roll positions beside epochs

**Files:** Modify `packages/client/src/mixed-beacon.ts`, `packages/client/src/session.ts` (`:1748`, `:1979-1986`, `:2646`, `:2855`, `:3646`, and every `pos < this.deckSize` / `pos >= this.deckSize` that means card-or-roll); Test `packages/client/test/mixed-beacon.test.ts`, `packages/client/test/hazard-session.test.ts`.

**Interfaces:** `beaconPosition(deckSize: number, id: number, stride: number | null = null): number`: with `stride` null, unchanged (`deckSize + id`); with a stride, `stride·⌊id/(stride − deckSize)⌋ + deckSize + id mod (stride − deckSize)`. It equals the old value for `id < stride − deckSize`, so no existing game moves. `isRollPosition(pos, deckSize, stride | null): boolean`. The session passes `stride = epochStride(deckSize)` exactly when `usesEpochs() && usesBeacon()`, and its share sorting in `actionEvent` sorts card and roll shares together by position.

- [ ] **Step 1: Failing tests:** `beaconPosition(44, 83, 128) === 127`, `(44, 84, 128) === 172`, `isRollPosition(128, 44, 128) === false`; `beaconPosition(25, 7)` unchanged. In `hazard-session.test.ts`: three real sessions over the memory relay (the pattern of `gilt-and-guile-session.test.ts`), driven by a scripted policy through 90 battle rolls and one reshuffle; every client's state hash agrees and the dice are those `packages/dice` derives.
- [ ] **Steps 2–4:** fail, implement, pass; also `pnpm vitest run --project client` (all existing session suites).
- [ ] **Step 5:** Commit "Client: roll positions skip epoch slots when a game has both (D087)".

### Task 9: Platform: sealed shares for epoch positions

**Files:** Modify `packages/client/src/session.ts` (`intakeSealed` `:965`, `sealedVerifies` `:992`, `buildSealed` `:3514-3520`); Test `packages/client/test/hazard-session.test.ts`.

**Interfaces:** each uses `ciphertextAt(pos)` instead of `deck[pos]`, and rejects a position with no ciphertext (`position N has no card`) instead of `pos >= deckSize`.

- [ ] **Step 1: Failing test:** a scripted game where a charter drawn after a reshuffle (`pos ≥ 128`) is captured: the conqueror's session learns it, and the others never do.
- [ ] **Steps 2–4:** fail, implement, pass; client project green.
- [ ] **Step 5:** Commit "Client: sealed shares reach charters drawn after a reshuffle (D087)".

### Task 10: Platform: the simulator reshuffles; fuzz target

**Files:** Modify `packages/client/src/sim.ts` (`:430`: a `shuffle` duty in play builds `buildEpoch`, as `apps/web/src/game-controller.ts:1937-1943` decides); create `tools/fuzz/src/hazard.ts`; modify `tools/fuzz/src/index.ts`, `tools/fuzz/package.json`.

**Interfaces:** `HAZARD_POLICIES: FuzzPolicy<HazardState>[]`:
- `general`: places on border provinces; attacks while its troops exceed the defender's by 2 or more, with the most dice; advances everything; cashes as soon as it may; marches toward the front.
- `cautious`: attacks only at 3:1, and always cashes the bonus.

Both pick a random legal action when nothing applies. The `TARGETS.hazard` entry has `expectedCoverage ['end:conquest', 'move:reshuffle', 'move:transfer', 'move:cashDown']` and `defaultSeatCounts [3, 4, 5, 6]`. `coverageOf` (Task 7) emits those tags.

- [ ] **Step 1:** `pnpm fuzz --game hazard --games 2000` → every game ends by conquest, with no failures and all four coverage tags. If games run out of `maxSteps`, fix the policies, not the rules (D015, D016).
- [ ] **Step 2:** `pnpm sim --game hazard` for 3 and 5 seats → done, the audit passes, at least one Sealed event and one epoch.
- [ ] **Step 3:** Commit "Hazard: fuzz target and policies; the sim reshuffles (D087)".

### Task 11: Web game

**Files:** Create `apps/web/src/games/hazard/{meta.ts,model.ts,atlas.tsx,charters.tsx,dice.tsx,game.tsx,rules-page.tsx,hazard.css}`; modify `net.ts`, `games/ids.ts`, `games/registry.ts`, `game-names.ts`, `games/catalog.ts`, `components/new-table-form.tsx` (a Defense radio: "Defenders choose their dice" / "Defenders always roll the most dice", with a hint), `apps/web/package.json`; tests `apps/web/test/hazard.test.ts`, and the lists in `prompt-shares.test.ts`, `module-contract.test.ts` (exempt list plus a beacon branch like Room for Doubt's at `:50-65`), `catalog-model.test.ts`, `compare-render.test.ts`, `registry.test.ts`.

**Interfaces:** `model.ts` (pure): `atlasCells(state, theme)` → per hex `{x, y, province, owner, border edges}`; `provinceRows(state)`; `decisionFor(state, legal, seat)` → one of `{kind:'order'|'claim'|'place'|'muster'|'cash'|'attack'|'defend'|'advance'|'march'|'wait', …}`; `statusLine(state, names)`; `logLine(event, names, theme)`. `HazardGame(props: GameViewProps)`: the atlas in the main column (click a province to claim, place, muster, choose an attacker then a target, or march from–to), the right rail with players (color, provinces, troops, charter count, out), the pool and set value, the dice tray of the last battle, my charters (`charters.tsx`: the province's hex silhouette and kind glyph; the Crown for wilds) with set selection, and the log. Seat colors: crimson `#b23a3a`, cobalt `#2f5fa8`, moss `#4f7d3a`, saffron `#d19a1f`, plum `#7a4a8c`, slate `#4d5a63`, each with a pattern (stripe, dot, cross-hatch, chevron, ring, plain) so color is never the only cue. SVG tab stops use lowercase `tabindex` (D081). The setup copy: `{ shuffling: 'Shuffling the charters', dealing: 'Unrolling the atlas…', share: { act: 'unseal a charter', owed: 'a charter share' } }`.

- [ ] **Step 1: Failing tests** (`hazard.test.ts`): `decisionFor` for each stage on scripted states; render `HazardGame` for a mid-game state and check the hex count, `aria-label`s ("Fenhallow, crimson, 4 troops"), no hidden card in a spectator's render, and the defense option sent by the New table form.
- [ ] **Steps 2–4:** fail, implement, pass `pnpm vitest run --project web`; then `pnpm dev` and play the opening by hand at 1280 px and 390 px (no sideways scroll).
- [ ] **Step 5:** Commit "Hazard web: atlas, charters, battles and the rules page".

### Task 12: Art: cover, thumbnail, previews

**Files:** Create `apps/web/src/games/hazard/cover.tsx`, `docs/games/hazard/art/{cover.svg,thumb.svg}`, `packages/games/hazard/ART-LICENSE.md` text; modify `games/covers.tsx`, `games/previews.ts`, `apps/web/scripts/previews/capture.ts` (`{ game: 'hazard', seed: 'preview-1', seats: 4, at: [0.1, 0.5, 0.85] }`), and add `apps/web/public/previews/hazard-{1,2,3}.jpg`.

Cover (600 × 360, inline SVG): a parchment atlas fragment of three realms in seat colors, troop tokens, three crimson and two ivory dice mid-tumble, and "Hazard" on a ribbon banner with the tagline; the thumbnail is the dice over the atlas, without text.

- [ ] **Step 1:** Implement the cover and the thumbnail; `pnpm previews hazard`; write the captions from the pictures (the opening claim, a battle, a late game with charters).
- [ ] **Step 2:** `pnpm vitest run --project web` (`previews.test.ts` checks the files and sizes) → PASS.
- [ ] **Step 3:** Commit "Hazard: cover, thumbnail and screens in play (D086)".

### Task 13: End-to-end spec

**Files:** Create `apps/web/e2e/hazard.spec.ts` (Room for Doubt's spec is the pattern).

- [ ] **Step 1:** Three players: create with `defense: 'auto'` for speed. The first-player roll, the full claim and placement through a helper that clicks provinces, then a turn's muster and an attack until a capture, `endAttack`, and a charter that only its holder sees (spectator and other pages checked for its name). Then a reload, and no sideways scroll at 390 px.
- [ ] **Step 2:** `pnpm e2e hazard.spec.ts --trace=off` → PASS.
- [ ] **Step 3:** Commit "Hazard e2e: three players, a capture and a private charter".

### Task 14: Decisions, plan, protocol, final check

**Files:** Modify `docs/DECISIONS.md` (**D087**: the platform fixes of Tasks 8–10; **D088**: Hazard built as beta: name, map twin, art, rules sources, options, two-step cash, Resign off, prompt shares under D075), `docs/PLAN.md`, `docs/PROTOCOL.md` (§6.3a roll positions beside epochs; §4.10 sealed shares at epoch positions), `CLAUDE.md` (repo map, fuzz and e2e lists, the Compare phrase list).

- [ ] **Step 1:** Write the entries.
- [ ] **Step 2:** `VITEST_MAX_WORKERS=2 pnpm check` → PASS; `pnpm build:web && pnpm scan:dist` → no restricted names.
- [ ] **Step 3:** Commit "Hazard: decisions D087–D088, plan and protocol notes", push, open a draft PR.
