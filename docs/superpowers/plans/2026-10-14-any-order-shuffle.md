# Any-Order Setup Shuffle and Background Setup Work: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New games let each seat take its setup shuffle blocks in any order, and any open page of the app does a seat's setup shuffle and deal. Setup no longer stalls on players opening the game in seat order.

**Architecture:**
- **Protocol:** a root tag `["shuffle-order","any"]` opts a game in. In the client session, one pure function `shuffleSigners` decides who may sign each setup step, and it replaces every read of the fixed `ShuffleStep.seat`. Races go through the existing fork choice. A split deal cancels the game with no forfeits.
- **Web:** the game controller staggers non-first seats by 45 s per rank and gets a `setup` mode. A page-wide `SetupRunner` keeps up to 3 setup-mode controllers alive for this profile's games in setup, and hands each game to its page when that page is open.

**Tech Stack:** TypeScript (Node ≥ 22.18, pnpm 10), Vitest, Preact + Signals, Playwright, NOSTR events. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-any-order-shuffle-design.md` (approved 2026-10-14). Read it with this plan: the plan says what to build, and the spec says why.

## Global Constraints

- Root tag: exactly `["shuffle-order","any"]`. If it is absent, the game is `seat` order. Any other value, or the tag twice, makes the root invalid.
- Stagger: `SHUFFLE_STAGGER_S = 45` seconds per rank. Deal settle: `DEAL_SETTLE_S = 15` seconds. Both are exported from `packages/client`.
- Runner: at most 3 setup controllers at once (`SETUP_RUNNER_MAX = 3`), oldest game first.
- **Fixed-order games** (roots without the tag) fold exactly as today. Every existing test stays green, unedited, except where a task here says otherwise.
- **Unchanged:** play-phase epochs keep seat order, and the deal stays once per seat (D056 F7).
- **A split deal** (an any-order game, deal phase, no shuffle equivocator held, and some seat's deal fails against the canonical deck): a timeout accepted then forfeits no seat.
- **Pure packages:** no clocks, timers or I/O in `packages/protocol` or `packages/client/src` (the timing constants are just numbers). Relative imports use `.ts`; type-only imports use `import type`; no enums.
- **Wording:** no reference-game names outside `docs/`. Copy is fixed by the tasks below.
- `pnpm check` passes before every commit. Each commit message ends with the session's attribution lines.

## Review Focus

1. **A reload during the stagger wait.** The wait counts from the head's persisted first-seen time, so reloading must not restart the 45 s. Test: Task 6.
2. **A background tab with throttled timers.** A wake timer can fire late or not at all. The 30 s tick must still run a stagger-waiting shuffle once `now` passes its time. Test: Task 6.
3. **The head moves during the wait.** Another seat shuffles, so the rank and the wait are recomputed from the new head's first-seen time, and nothing is built on the old head. Test: Task 6.
4. **Seat keys held only on another device.** The runner must skip the game with no restore and no prompt. Test: Task 8.
5. **The game page opens in the same tab mid-proof.** The runner disposes its controller. The page's controller adopts the stored outbox event and builds nothing twice. Test: Task 8.

---

### Task 1: The root tag (protocol)

**Files:**
- Modify: `packages/protocol/src/lobby.ts`, at:
  - `RootSpec` (~:76)
  - `ParsedRoot` (~:84)
  - `rootTemplate` (~:487)
  - `parseRoot` (~:514)
- Modify: `packages/protocol/src/index.ts` (the export)
- Test: `packages/protocol/test/lobby.test.ts`

**Interfaces:**
- Produces:
  - `export type ShuffleOrder = 'seat' | 'any'`
  - `RootSpec.shuffleOrder?: ShuffleOrder`, default `'seat'`
  - `ParsedRoot.shuffleOrder: ShuffleOrder`

- [ ] **Step 1: Write the failing tests** in a new `describe('root shuffle order (D093)')`:
  - `'writes the tag only for any-order roots'`: `rootTemplate({...spec, shuffleOrder: 'any'}, t).tags` contains `['shuffle-order','any']`. The default spec's tags contain no `shuffle-order` tag.
  - `'parses the order'`: `parseRoot(signed any-order root).shuffleOrder === 'any'`; an untagged root gives `'seat'`.
  - `'refuses a bad order tag'`: `parseRoot` throws `ProtocolError` for `['shuffle-order','seat']`, for `['shuffle-order','x']` and for the `any` tag twice.
- [ ] **Step 2: Run** `pnpm vitest run --project protocol test/lobby.test.ts`. Expected: FAIL (`shuffleOrder` undefined).
- [ ] **Step 3: Implement** the template and parse in `lobby.ts`. Read the tag with `many(tags, 'shuffle-order')`: 0 entries means `'seat'`; exactly one entry `'any'` means `'any'`; anything else is `badTag('"shuffle-order" must be "any", at most once')`. `validateRoot` is unchanged.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `pnpm vitest run --project protocol`: PASS.
- [ ] **Step 5: Commit** `Protocol: the shuffle-order root tag (D093)`.

### Task 2: Who may sign a setup step (pure)

**Files:**
- Modify: `packages/client/src/partitioned-deck.ts`
- Create: `packages/client/src/setup-timing.ts`
- Modify: `packages/client/src/index.ts`
- Test: `packages/client/test/partitioned-deck.test.ts`

**Interfaces:**
- Consumes: `ShuffleOrder` (Task 1); `ShuffleStep`, `shuffleSchedule`.
- Produces:
  - `export function shuffleSigners(schedule: readonly ShuffleStep[], seats: number, order: ShuffleOrder, signers: readonly number[]): readonly number[]`. It returns the seats that may sign step `signers.length` (0-based), in ascending order, given the seats that signed steps `0..signers.length-1`. It returns `[]` past the end of the schedule.
  - `export const SHUFFLE_STAGGER_S = 45` and `export const DEAL_SETTLE_S = 15` in `setup-timing.ts`, both re-exported from `index.ts`.

- [ ] **Step 1: Write the failing tests** in `describe('shuffleSigners (D093)')`, using `toy.decks()[0]` (2 partitions) and a second round `[{id:'mix', positions:[1,2,3]}]`, with 3 seats:
  - `'seat order gives the schedule seat'`: for every `s`, `shuffleSigners(sched, 3, 'seat', sched.slice(0, s).map(x => x.seat))` equals `[sched[s].seat]`.
  - `'any order: every seat at the root, the block signer mid-block'`:
    - `shuffleSigners(sched, 3, 'any', [])` → `[0,1,2]`
    - `[2]` → `[2]` (mid-block, 2 groups per block)
    - `[2,2]` → `[0,1]`
    - `[2,2,0,0]` → `[1]`
  - `'round 2 starts over once every seat has a round-1 block'`: after six round-1 signers `[1,1,2,2,0,0]` → `[0,1,2]`. Round 2 has one group, so `[...six, 2]` → `[0,1]`.
  - `'empty past the end'`: all nine signers given → `[]`.
- [ ] **Step 2: Run** `pnpm vitest run --project client test/partitioned-deck.test.ts`. Expected: FAIL (not exported).
- [ ] **Step 3: Implement `shuffleSigners`.**
  - Find the step's round: `schedule[step].round`. The round starts at the first index of a step with that round, and `G` is that round's group count (round size ÷ `seats`).
  - Let `t = step − start`. If `t % G !== 0`, return `[signers[step − 1]]`.
  - Otherwise return the ascending seats not in `{ signers[start + j·G] : j < t/G }`.
  - `'seat'` returns `[schedule[step].seat]`.
- [ ] **Step 4: Run** the same file. Expected: PASS.
- [ ] **Step 5: Commit** `Client: shuffleSigners, the setup step's eligible signers (D093)`.

### Task 3: The session folds any-order setup

**Files:**
- Modify: `packages/client/src/session.ts`. The entry points to change: `moveShape`, `foldMove`, `judgeAtPrev`, `shuffleVerifies`, `shuffleCtx`, `nextShuffler`, `buildShuffle`, `stalled`, `pending`, `duties`, `progressOfShuffle`, `equivocators`.
- Modify: `packages/client/src/types.ts` (`Duty`, `SessionView`)
- Modify: `packages/client/src/lobby.ts` (`buildRootTemplate`)
- Modify: `packages/client/test/helpers.ts` (`makeModuleGame`)
- Create: `packages/client/test/any-order.test.ts`

**Interfaces:**
- Consumes: `shuffleSigners` (Task 2); `ParsedRoot.shuffleOrder` (Task 1).
- Produces:
  - `Duty`'s shuffle member becomes `{ kind: 'shuffle'; readonly rank: number }`. `rank` is the seat's index in the eligible list; it is always `0` for seat order and for play-phase epochs.
  - `SessionView.shuffleOrder: ShuffleOrder`.
  - `SessionView.shuffleRivals: boolean`: true while a candidate step by another signer, or a second step by the chain step's own signer, is held on a shuffle prev of the canonical chain.
  - `buildRootTemplate(view, relays, createdAt, seats?, opts: { shuffleOrder?: ShuffleOrder } = {})`.
  - `makeModuleGame(module, seats, seed, rules?, opts?: { shuffleOrder?: ShuffleOrder })`.
  - `waitingFor()` during the shuffle returns every eligible seat.

- [ ] **Step 1: Write the failing tests** in `any-order.test.ts`. Use a 3-seat Chain Reaction any-order game and the partitioned toy of `partitioned-deck.test.ts`.
  - `'any eligible seat may take the first step, and its proof binds its own seat'`: seat 2's `buildShuffle` on the root is accepted by every session. `view().head.seq === 1`.
  - `'an ineligible signer is refused'`: after seat 2's step, a second step by seat 2 (plain deck, one group) is rejected with reason `shuffle step 2 may not be signed by seat 2`.
  - `'duties rank the eligible seats'`: at the root the duties are `[{kind:'shuffle', rank:0}]`, `[{kind:'shuffle', rank:1}]` and `[{kind:'shuffle', rank:2}]`. After seat 0's step, seat 1 has rank 0 and seat 2 has rank 1.
  - `'stalled and waitingFor name every remaining seat at a block boundary, and the block signer mid-block'`, with the partitioned toy at 3 seats.
  - `'shuffleProgress counts finished blocks'`: after blocks by seats 2 and 0, `seatsDone === 2`.
  - `'at the root every seat is stalled, so no seat can claim'`: past the deadline, `timeoutTarget(now)` is `null` for every seat's session.
  - `'seat order is unchanged'`: an untagged game still refuses seat 1 at step 1 with `shuffle step 1 must be signed by seat 0`. `view().shuffleOrder === 'seat'`.
  - `'a whole any-order game shuffles in order 2,0,1, deals and reaches play'`: the final deck decrypts at the end (reuse `shuffleAll`'s flow, with a given seat order).
- [ ] **Step 2: Run** `pnpm vitest run --project client test/any-order.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `private dueShufflers(): readonly number[]`. It calls `shuffleSigners` over the canonical chain's signers (via `seatOf`), and replaces `nextShuffler`.
  - `moveShape` keeps the type and group-size checks. It checks the signer only for `seat` order, with today's message.
  - `foldMove` and `judgeAtPrev` check eligibility at `at = seq − 1` from the chain prefix, refusing with `shuffle step ${seq} may not be signed by seat ${seat}` (any-order) or today's message (seat order).
  - Thread the signer through `shuffleVerifies(id, step, signer, output, proof)` and `shuffleCtx(step, signer)`. `buildShuffle` passes `me.seat`.
  - `stalled()` returns `dueShufflers()` during the shuffle.
  - `pending()` names `dueShufflers()[0]`.
  - `duties()` returns `{kind:'shuffle', rank: due.indexOf(me.seat)}` when `me.seat` is due; the epoch duty gets `rank: 0`.
  - In `equivocators`, flag a shuffle rival's seat only if that seat is eligible at its prev.
  - `shuffleRivals` comes from the candidate map.
  - `buildRootTemplate` passes `shuffleOrder` to `rootTemplate`.
- [ ] **Step 4: Run** the new file, then `pnpm vitest run --project client`. Expected: PASS. If a consumer of `Duty` fails typecheck, add `rank: 0` where it builds one.
- [ ] **Step 5: Commit** `Client: any-order setup shuffle in the session (D093)`.

### Task 4: Races, settled branches and the split deal

**Files:**
- Modify: `packages/client/src/session.ts` (`decideTimeouts`; a new `private splitDeal(): boolean`)
- Test: `packages/client/test/any-order.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces: no new public API. `view().forfeits` is `[]` after a timeout accepted while the deal is split.

- [ ] **Step 1: Write the failing tests:**
  - `'an honest race resolves by fork choice and flags no one'`:
    - Seats 1 and 2 both build on the root. Every session ends on the same head: the lower id at equal length.
    - `view().equivocators` is `[]`.
    - The loser's `duties()` now shows a shuffle on the new head.
    - `view().shuffleRivals` is `true`.
  - `'a longer branch beats a lower id'`: the higher-id branch is extended by the third seat, and it wins.
  - `'two steps by one eligible seat on one prev still flag it'`.
  - `'a split deal times out with no forfeits'`:
    - Build two complete rival decks: race at the root, then let the remaining seats finish both branches.
    - Seat A deals on the losing deck, seen before the winner.
    - After the deadline, another seat's claim is accepted: `phase === 'cancelled'` and `forfeits` is `[]`.
  - `'a held shuffle equivocation still blames the equivocator in the deal'`: the existing D056 case on an any-order root still gives `forfeits = [equivocator]`.
- [ ] **Step 2: Run** `pnpm vitest run --project client test/any-order.test.ts`. Expected: the split-deal test FAILS (`forfeits` holds seat A). Fix any of the others that also fail in Step 3.
- [ ] **Step 3: Implement** `splitDeal()`: `shuffleOrder === 'any' && phase === 'deal' && equivocators(true).length === 0 && some seat k has dealtElsewhere(k)`. In `decideTimeouts`, record `seats: this.splitDeal() ? [] : this.stalled()`.
- [ ] **Step 4: Run** the client project. Expected: PASS.
- [ ] **Step 5: Commit** `Client: honest shuffle races, and a split deal cancels with no forfeits (D093)`.

### Task 5: The simulator

**Files:**
- Modify: `packages/client/src/sim.ts` (`SimOptions`, `performDuties`, root building)
- Modify: `tools/sim/src/cli.ts`
- Test: `packages/client/test/sim.test.ts`

**Interfaces:**
- Consumes: `SHUFFLE_STAGGER_S`, `DEAL_SETTLE_S` (Task 2); the duty `rank` and `view().shuffleRivals` (Task 3).
- Produces:
  - `SimOptions.shuffleOrder?: ShuffleOrder`, default `'seat'`, so the existing sim tests are unchanged.
  - `SimOptions.shuffleRace?: boolean`, default `false`.
  - CLI flags: `--shuffle-order any|seat` (default `any`) and `--race`.

- [ ] **Step 1: Write the failing tests:**
  - `'any order: a seat that vanishes in setup is skipped, then times out'`:
    - 4 seats, any order, seat 1 vanishes at `atSeq` 1.
    - Seats 0, 2 and 3 have shuffled: `r.moves === 3`.
    - The game is cancelled with `forfeits [1]`.
  - `'any order with races completes and flags no one'`: `shuffleRace: true`, 4 seats, Chain Reaction. `phase === 'done'`, `audit pass`, `equivocators []`.
- [ ] **Step 2: Run** `pnpm vitest run --project client test/sim.test.ts -t "any order"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Each client keeps the sim-clock time at which it first saw its current head.
  - A shuffle duty with `rank r > 0` is performed only once `clock − seenAt ≥ r · SHUFFLE_STAGGER_S`. With `shuffleRace`, rank is ignored.
  - A deal waits `DEAL_SETTLE_S` while `shuffleRivals` holds.
  - A race loser's own step answering `stored` is not a failure. Its outbox slot is keyed by prev, so it builds anew on the new head.
- [ ] **Step 4: Run** `pnpm vitest run --project client`. Expected: PASS.
- [ ] **Step 5: Commit** `Sim: any-order setup, stagger, races (D093)`.

### Task 6: The web controller, the lobby and the copy

**Files:**
- Modify: `apps/web/src/game-controller.ts`:
  - `#nextAuto`
  - `#runDuties` waits
  - `#single` (the deal race)
  - `GameControllerOptions`
- Modify: `apps/web/src/lobby-controller.ts` (`#start`: pass `{ shuffleOrder: 'any' }`)
- Modify: `apps/web/src/waiting-model.ts` (`waitingLine`)
- Modify: `apps/web/src/screens/game.tsx` (pass `shuffleOrder`)
- Test:
  - `apps/web/test/waiting-model.test.ts`
  - a new `apps/web/test/any-order-controller.test.ts`, using `net-harness.ts` with an injected `now` and `Timers`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces:
  - `WaitingInput.shuffleOrder?: ShuffleOrder`.
  - Any-order shuffle copy:
    - for one seat: `Waiting for ${who} to shuffle. They need to open the app once.`
    - for several seats: `Waiting for ${who} to shuffle. Each needs to open the app once; the order doesn't matter.`
  - New roots from the lobby carry the tag.

- [ ] **Step 1: Write the failing tests:**
  - `waiting-model`: both any-order lines exactly as above. The seat-order line is unchanged.
  - Controller tests (3 seats, seat 1's controller never started, injected clock):
    - `'seat 2 shuffles 45 s after seat 0's step when seat 1 is away'`: nothing at +44 s; seat 2's step on the relay at +45 s.
    - `'the wait survives a reload'`: dispose seat 2's controller at +30 s and build a new one on the same storage. It shuffles at +45 s, not +75 s.
    - `'a late wake timer: the tick runs the duty'`: wake timers are dropped, and the duty runs on the next 30 s tick once `now ≥` its time.
    - `'a new head resets the wait'`: seat 1 shuffles at +20 s, so seat 2 becomes rank 0 and shuffles at once.
    - `'two controllers of one seat on one storage deal once and neither shows Stuck'`.
    - `'the deal waits 15 s while a rival step is held'`. Publish a rival last step to the relay, built by a separate `GameSession` of that seat as `deal-two-devices.test.ts` does. No deal is published before +15 s; one is published after.
    - `'a game started from the lobby is any-order'`: the parsed root has `shuffleOrder 'any'`.
- [ ] **Step 2: Run** `pnpm vitest run --project web test/waiting-model.test.ts test/any-order-controller.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `#nextAuto`, a shuffle duty with `rank > 0` sets `#waits['shuffle@<head>'] = seen(head) + rank · SHUFFLE_STAGGER_S` and arms one wake timer, as dated builds do.
  - A deal while `view.shuffleRivals` waits until `seen(head) + DEAL_SETTLE_S`.
  - `#single` re-reads the stored outbox slot before building and commits a stored event it finds.
  - The lobby passes `{ shuffleOrder: 'any' }`.
  - `game.tsx` passes `view.shuffleOrder` into `waitingLine`.
- [ ] **Step 4: Run** `pnpm vitest run --project web`. Expected: PASS.
- [ ] **Step 5: Commit** `Web: stagger, deal settle and copy for any-order setup; new roots are any-order (D093)`.

### Task 7: The controller's setup mode and the status phase

**Files:**
- Modify: `apps/web/src/game-controller.ts` (`GameControllerOptions.mode`, `#identity`, `#offerBackup`, `#nextAuto`, `#autoMove`, `#cacheStatus`)
- Modify: `apps/web/src/storage.ts` (`GameStatusCache.phase`, its reader)
- Test: `apps/web/test/any-order-controller.test.ts`, `apps/web/test/storage.test.ts`

**Interfaces:**
- Produces:
  - `GameControllerOptions.mode?: 'full' | 'setup'`, default `'full'`.
  - `GameStatusCache.phase?: 'setup' | 'play' | 'end'`, written by every controller. The value comes from `SessionView.phase`: `shuffle` and `deal` become `setup`, and `done` and `cancelled` become `end`.

- [ ] **Step 1: Write the failing tests:**
  - `'setup mode shuffles and deals only'`: a 3-seat game where every seat runs in setup mode reaches `play`. No attestation, Secret, backup or Resign echo is published, and the signer's `nip44` is never called.
  - `'setup mode never restores keys'`: a profile without the game keys loads the game and publishes nothing; `recovered` stays null.
  - `'the status cache records the phase'`: `loadGameStatus(...).phase` reads `'setup'`, then `'play'`.
  - storage: a cache entry with a bad `phase` reads back without it.
- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement.** In setup mode:
  - `AUTO` is `['shuffle','deal']`;
  - `#startRestore`, `#offerBackup`, `#echoResign` and `#autoMove` return at once;
  - `attest` is never chosen.
- [ ] **Step 4: Run** `pnpm vitest run --project web`. Expected: PASS.
- [ ] **Step 5: Commit** `Web: a setup-only game controller mode, and the phase in the status cache (D093)`.

### Task 8: The setup runner, its hand-off and Home's line

**Files:**
- Create: `apps/web/src/setup-runner.ts`
- Modify:
  - `apps/web/src/main.tsx` (start the runner after the first render)
  - `apps/web/src/screens/game.tsx` (claim the root while mounted)
  - `apps/web/src/components/table-lists.tsx` (the detail line)
- Test: `apps/web/test/setup-runner.test.ts`

**Interfaces:**
- Consumes: `lobbyFor(deps)` (`lobby-hooks.ts`); `GameController` with `mode: 'setup'` (Task 7); `loadSecrets` and `seatForGameKeys`; `loadGameStatus`.
- Produces:
  - `export const SETUP_RUNNER_MAX = 3`
  - `export interface SetupLine { kind: 'shuffling' | 'dealing' | 'waiting'; who: readonly string[]; what: 'shuffle' | 'deal' }`. `who` holds npubs, for `waiting` only.
  - `export class SetupRunner { constructor(deps: ControllerDeps); start(): void; dispose(): void; readonly lines: Signal<ReadonlyMap<string, SetupLine>>; claim(rootId: string): () => void }`
  - `export function setupRunnerFor(deps: ControllerDeps): SetupRunner`, a `WeakMap` page singleton like `lobbyFor`.
  - `export function setupLineText(line: SetupLine, names: (npub: string) => string): string`. Exact copy:
    - `Shuffling your part…`
    - `Dealing…`
    - `Waiting for ${who} to shuffle`
    - `Waiting for ${who} to deal`

    `who` goes through `listNames`.

- [ ] **Step 1: Write the failing tests:**
  - `'shuffles from Home'`: seat 1's profile runs only a `SetupRunner`, with no game page. After seat 0's step, seat 1's step appears, and its line goes `shuffling`, then `waiting` with seat 2's npub.
  - `'skips a game whose keys are not in this browser'`: no controller is built, and nothing is signed or prompted.
  - `'skips games whose cached phase is play or end, and status done or cancelled'`.
  - `'hands a game to its page and takes it back'`: `claim(rootId)` disposes the runner's controller mid-setup. The page controller on the same storage finishes without a second build of the same slot (assert one event per `move:` slot on the relay). Calling the returned release before setup ends restarts the runner's controller.
  - `'runs at most 3 at once, oldest first'`: with 4 candidate games, the fourth starts once one finishes.
  - `'stops when this seat's setup work is done'`: the controller is disposed once this seat's blocks for every round are on the chain and its deal is published, or once the phase leaves setup.
  - `setupLineText` gives each exact string.
- [ ] **Step 2: Run** `pnpm vitest run --project web test/setup-runner.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The runner listens to `lobbyFor(deps).myTables` and picks the candidates set out in spec §5.3.
  - Each candidate becomes `new GameController(rootId, deps, { mode: 'setup' })`, and the runner reads its `view` and `status` signals to set `lines`.
  - `table-lists.tsx` shows `setupLineText(...)` in place of the cached detail when the runner has a line for the root.
  - `main.tsx` calls `setupRunnerFor(deps).start()` after `render`.
- [ ] **Step 4: Run** `pnpm vitest run --project web`. Expected: PASS.
- [ ] **Step 5: Commit** `Web: the setup runner does a seat's shuffle and deal from any page (D093)`.

### Task 9: End to end, documents and full verification

**Files:**
- Create: `apps/web/e2e/any-order-setup.spec.ts`
- Modify:
  - `docs/PROTOCOL.md`: §4.3, §4.4, §5.2, §5.3, §5.5, §6.1, §6.6, §8.1, §8.2, §11, §12
  - `docs/DECISIONS.md` (D093)
  - `docs/PLAN.md`
  - `docs/TESTING.md`
  - `CLAUDE.md` (the e2e list)
  - the spec's §6 line on the protocol model: the model's setup steps belong to the abandoned v2 `stop3` design, so it is unaffected

**Interfaces:** none new.

- [ ] **Step 1: Write the e2e spec**, `'four players: seat 1 is away at the start, opens Home later, and everyone reaches play'`:
  1. Players a–d create, join and start a 4-seat Chain Reaction table.
  2. Close b's page before the start. c and d stay on Home.
  3. Assert that a, c and d are past their shuffles within `3 × 45 s + SETUP_MS`, and that the game page shows "Waiting for b… to shuffle".
  4. Reopen b on Home: b's runner shuffles and deals.
  5. Every player opens the game and reaches the play screen.
  6. Check 390 px: no sideways scroll.
- [ ] **Step 2: Run** `pnpm e2e any-order-setup.spec.ts`. Expected: PASS. Then run `pnpm e2e` (all specs). Expected: PASS.
- [ ] **Step 3: Write the documents.**
  - PROTOCOL follows spec §3–§4.
  - D093 records the request, the decisions table, the owner's two rulings and the residuals.
  - PLAN gets a dated status section.
  - TESTING replaces "Every player's window must be open on the game" with the any-order wording, and lists the new e2e spec.
  - Rules pages: `grep -rn "shuffle" apps/web/src/games/*/rules-page.tsx` for setup paragraphs that state the seat order or say the game page must be open. Reword them in the spec's §5.4 terms.
- [ ] **Step 4: Verify everything:**
  - `pnpm check` passes.
  - `pnpm sim --game <id> --shuffle-order any --games 2`, then the same with `--race`, for each deck game: chain-reaction, luster, right-of-way, driftwrights, holler, room-for-doubt, quill-and-quarry, gilt-and-guile, hazard and sticks-and-stones. Every game ends `done` or as its adversary expects, with no failures.
  - `pnpm sim --game chain-reaction --shuffle-order seat --games 2`: unchanged.
- [ ] **Step 5: Commit** `Docs and e2e: any-order setup shuffle and the setup runner (D093)`. Push, and update PR #53's description from design-only to the implementation.
