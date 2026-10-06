# Room for Doubt playable build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Room for Doubt playable on the live site as a beta, with exactly the information each player would have at a real table.

**Architecture:** Two opt-in platform features close the two information gaps that RULES.md records for path A.
- A **second shuffle round** (`DeckSpec.secondRound`) mixes the 18 hand cards after the Verdict is fixed, so a deck position no longer shows a card's kind.
- A **private show** (`GameModule.privateShow`) puts the shower's decryption share inside its own `show` move, encrypted to the submitter. Nobody else learns which card or which position was shown.

A pure engine in `packages/games/room-for-doubt` implements RULES.md on one 30-card deck plus the generic deck-and-dice beacon (PROTOCOL §13). The web app adds a board, a hand, a Docket and a rules page, and the game ships as `beta`.

**Tech Stack:** TypeScript run directly by Node ≥ 22.18 (type stripping, `.ts` imports), Vitest, Biome, Preact + Signals, Playwright for e2e (Chromium is preinstalled under `/opt/pw-browsers`). No new dependencies.

**Spec:** `docs/games/room-for-doubt/RULES.md` is the source of truth ("RULES §…" below). Read it with decisions D072 and D073 in `docs/DECISIONS.md`. The owner's standing instruction (D073) is: "The main concern is for the games to work exactly as they should." So no information gap may ship.

## Global Constraints

- **Toolchain.** Node ≥ 22.18, pnpm 10. If `node_modules` is missing, run `pnpm install --frozen-lockfile` first. After adding a workspace package or a dependency, run `pnpm install` and commit `pnpm-lock.yaml`; CI installs with `--frozen-lockfile`.
- **Style** (CLAUDE.md):
  - Biome: 2 spaces, single quotes, trailing commas, semicolons, line width 110.
  - Relative imports use `.ts` extensions; no enums; type-only imports use `import type`.
  - `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on, so index with a guard, never `!`, outside tests.
- **Pure code** (`packages/game-kit/src`, `packages/games/*/src`, `packages/deck/src`):
  - no `Math.random`, `Date`, timers, I/O, `node:` imports, `Intl` or locale APIs;
  - state is plain JSON and absent values are `null`;
  - `apply` never throws or mutates, and every move has exactly one accepted encoding.
- **Web code** (`apps/web/src`):
  - no `Math.random`, `Date`, `crypto`, storage or timers outside `clock.ts`, `random.ts` and `storage.ts`;
  - no `dangerouslySetInnerHTML`;
  - every CSS class starts with `rfd-`;
  - at a 390 px wide viewport the page never scrolls sideways.
- **Names** (D046):
  - no restricted name anywhere outside `docs/` and `licensed/`;
  - the reference title appears only as the one literal `'Compare to Clue'` in `packages/games/room-for-doubt/src/compare.ts`;
  - lowercase `clue` is an ordinary word.
- **Ids:**
  - game id `room-for-doubt`, engine version `0.1.0`, deck id `case`;
  - engine ids as in RULES §Glossary;
  - decisions D074 (second shuffle round), D075 (private show) and D076 (Room for Doubt built as a beta), all dated 2026-10-06.
- **Existing games fold byte-identically.**
  - A deck without `secondRound` keeps today's shuffle schedule and proof domains.
  - A module without `privateShow` keeps today's fold, audit and fuzz paths.
  - No existing test changes its expectations, except where a task says so.
- **Commits:**
  - small, on `claude/ecstatic-faraday-80wa85`;
  - signing is already configured, so never pass `--no-gpg-sign`;
  - the message names no model and ends with these two lines:
    ```
    Co-Authored-By: Claude <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01P9yDMQMsQVqiVj35Jq9cf6
    ```
- **Checks:** run `pnpm check` before the commit that ends each task, and save its output to a file rather than the terminal.

## Review Focus

1. **A rebuttal leaks to a third seat.** The shown card or its deck position must not be readable by any seat but the shower and the submitter, in any event, view state or screen. That holds after a reload, for a spectator who joins late, and when one seat shows the same card twice, which a third seat must not be able to link. Tests: Task 2 Step 1 (packets for the same position differ; the third seat and the spectator never learn the card) and Task 8 (the third page never names the card).
2. **Movement edge cases a player meets.** The full roll is blocked (P4 shortfall); a pawn on a doorstep blocks the door; every door of the starting room is blocked; a player tries to re-enter the room just left; a pawn is walled in at an Entrance. Tests: Task 3 Step 1.
3. **A closed app stalls the game.** A rebuttal, a dice contribution, a Verdict share or a sealed share is owed by a seat whose app is closed. The game's status line must name the deciding seat, and the generic waiting line must name the seat that owes a share. Test: Task 6 Step 1 (`statusText` cases).
4. **A second indictment after a wrong first one.** The first indicter's sealed share of the Verdict must reach the second indicter, who must then learn the Verdict. Tests: Task 4 (C34: the positions are re-dealt and sealed to the first indicter), Task 5 Step 3 (a `pnpm sim` game with two indictments over real crypto) and Task 8 (two indictments in the browser).
5. **Small screens and long names.** The board has 15 px squares at 390 px, and a name can be "Dimitra Alexandropoulou-Smith". Tests: Task 6 Step 1 (status text with a long name and the board's enlarge toggle) and Task 8 (390 px checks at four points).

## How this build refines RULES.md (rulings)

Task 9 writes each of these into RULES.md "as built" and into D076.

1. **Both information gaps close.** RULES §"Where the platform cannot be exact yet" listed the public hand mix and the visible shown position as unavoidable on path A. The second shuffle round (D074) closes the first and the private show (D075) the second. The owner's priority (D073) rules out shipping either gap.
2. **No `attend` move.**
   - Under D073 the deck sets `promptShares`. When an indictment deals the Verdict positions to the indicter, every other seat's open app sends its shares automatically.
   - A second indictment's sealed share also comes from the first indicter's app (the seal duty).
   - The indicter then announces `verdict`. RULES §"Resolving an indictment" is rewritten accordingly.
3. **An upheld verdict reveals nothing on the wire.** The indictment already names the three cards publicly, `verdict {upheld: true}` claims they match, and the end audit checks the claim, as it checks a dismissal.
4. **Trapped (P5).**
   - At the start of a turn, a Party with no free first step is offered `stay` instead of `roll`.
   - After a roll, P4 always leaves at least one destination, because a free first step guarantees a path of length ≥ 1.
5. **Indict after rolling.** RULES says "before it moves", so an indictment is also legal between the roll and the move.
6. **`dice: 'ahead'` is not built.** The rules object is `{ submit: 'optional' | 'required' }`, and `live` is how the game plays.
7. **Forced rebuttals.** When a rebutting seat has exactly one legal answer (`none`, or the one card it can show), the web screen sends it without a click, as Right of Way sends a forced sift.
8. **The spec-only guard.** `tests/catalog.test.ts` fails when a spec-only game's package **has `test/catalog/`**, not as soon as the package exists. This lets Task 3 land the board and movement with a green suite before the 45 catalog tests exist.
9. **The art moves into the game package.** The glyph markup moves from `scripts/room-for-doubt/glyphs.ts` to `packages/games/room-for-doubt/src/art.ts`, so the web game shows the same original art. The generator re-exports it, and the art sync test proves the SVG output is unchanged.

## Platform design (decided; Tasks 1 and 2 implement it)

### Second shuffle round (D074)

- **`DeckSpec.secondRound?`** is `readonly { readonly id: string; readonly positions: readonly number[] }[]`.
- **Valid only if:**
  - it holds 1–16 groups;
  - ids are non-empty, distinct, and not a partition id;
  - positions are safe integers in `[0, size)`, strictly ascending, at least 2 per group;
  - the groups are disjoint.

  Otherwise the session throws `ClientError('invalid deck second round')`.
- **Schedule:**
  - Round 1 is today's: the partitions (or the whole deck as one group), seat-major. Each seat shuffles every group in list order before the next seat starts.
  - Round 2 follows in the same seat-major way over the second-round groups.
  - N = (G1 + G2)·S. With 3 seats Room for Doubt has 15 steps.
- **A step over positions p1 < … < pn:**
  - its input is the ciphertexts at those positions, gathered in ascending order;
  - output i is written back to position pi, and every other position is unchanged;
  - the proof domain is `<deck id>/<group id>` (Room for Doubt: `case/mix`);
  - a first-round group's positions are `offset … offset + size − 1`, which reproduces today's slice rule exactly.
- **Parsing:** the parse size set adds each second-round group's size. Stall attribution names the seat of step `chain length` in this schedule.
- **What stays the same:** `packages/deck`, `packages/protocol`, `sim.ts` and `game-controller.ts` need no change, and the wire format is unchanged.

### Private show (D075)

- **Contract** (`packages/game-kit`):
  - `SHOW_DECK = 'shown'`, a pseudo-deck id that is never a real deck;
  - `interface PrivateShow { readonly id: number; readonly from: Seat; readonly to: Seat }`;
  - `privateShow?(state: S): PrivateShow | null`, non-null while seat `from` is deciding whether to show `to` a card.
- **Marker.** The legal list in `from`'s own view holds `{ type: 'show', actor: from, pos }`, one per deck position `from` holds and may show. `apply` never accepts a marker.
- **Wire.** `{ type: 'show', actor: from, id, packet }`, exact keys.
  - `packet` is one NIP-44 payload under the conversation key `getConversationKey(secretBytes(x_from), xonly(X_to))`. Deck keys are used because they are released at the end for the audit. The key is symmetric, so `from` and `to` can both open the packet.
  - The plaintext is canonical JSON `{after, c, d, from, id, pos, root, s, to}`:
    - `after` is the move's `prev`, and `root` the game root;
    - `pos` is a decimal string zero-padded to the digit count of `deckSize − 1`;
    - `d`, `c` and `s` are `encodePoint(D)`, `encodeScalar(c)` and `encodeScalar(s)` of `makeShare(x_from, deck[pos], shareCtx(pos), rnd)`.
  - The payload length is fixed by public data: `isNip44Payload(packet, n)`, where `n` is the length of that plaintext with placeholder share fields of the same encoded lengths.
- **Build** (session `actionEvent`): a marker whose `pos` has `from` as its latest dealt owner becomes the wire form. `revealsOf` of the wire is `[]`.
- **Fold** (session `checkAction`):
  - **Before `apply`:** while `privateShow(state)` is set, a `show` action that fails `showEnvelope` (shape, `actor === from`, `id`, exact length) rejects the move.
  - **After a successful `apply`, for `from` and `to` only:**
    1. open the packet and check its context (`root`, `after === prev`, `id`, `from`, `to`);
    2. check that the latest dealt owner of `pos` is `from`;
    3. put the packet's share into a copy of the slots of `pos`, and run `decryptPosition`, which also verifies the proof;
    4. call `module.learn(next, { deck: SHOW_DECK, pos: id, card })`.
  - **On any failure:** skip the learn and do not reject, so every client keeps one chain. The audit catches it.
  - **Caching:** cache the result per event id, because trial folds call `checkAction` again.
- **Audit** (`replay`), after an accepted `show` wire while `privateShow(before)` was set:
  1. call `auditShow`: open the packet with the released secrets, check the context and the holder, check `D == x_from · a_pos`, and decrypt the card with all secrets;
  2. learn the card in full mode; the module checks it is named and held.

  A failure is `{ fail: [from], reason: 'move N private show fails: …' }`.
- **Fuzz** (`packages/game-kit/src/fuzz.ts`):
  - markers are never probed with `apply`;
  - a chosen marker becomes `{type:'show', actor, id, packet:'fuzz-only'}`;
  - after the full `apply` and before the invariants, the fuzzer learns `{deck: SHOW_DECK, pos: id, card: order[pos]}` into the full state (logged);
  - after the views apply the wire, it learns the same record into the views of `from` and `to` (logged), then calls `syncViews`.
- **Module duties:**
  - `knownTo` never lists `SHOW_DECK` learns;
  - `view` keeps a shown card only for `from` and `to`;
  - `dealt` does not change when a card is shown.
- **What stays the same:** no new event kind, no new Move field, and `proto` stays `"1"` (D071). The payload is the module's own action (PROTOCOL §4.4).

---

### Task 1: Second shuffle round (D074)

**Files:**
- Modify: `packages/game-kit/src/types.ts` (`DeckSpec`, lines 28–36), `packages/game-kit/src/index.ts`
- Create: `packages/game-kit/src/packet.ts`; Test: `packages/game-kit/test/packet.test.ts`
- Modify: `packages/client/src/partitioned-deck.ts`, `packages/client/src/session.ts` (constructor 532–545, intake 686, `moveShape` 839–845, `foldMove` 1479–1496, `shuffleVerifies` 1687–1701, `partitionAt` 1704–1708, `nextShuffler` 1711–1713, `shuffleCtx` 1715–1719, `buildShuffle` 2948–2970, `view()`), `packages/client/src/types.ts` (`SessionView`, 70–80), `packages/client/src/audit.ts:32` (doc)
- Test: `packages/client/test/partitioned-deck.test.ts`
- Modify: `apps/web/src/screens/game.tsx` (`setupStep`, 166–178); Test: `apps/web/test/game-screen.test.ts` (175–194)
- Modify: `docs/PROTOCOL.md` (§4.4 lines 196–200, §5.5, §6.1 lines 384–387, §6.5 line 461, §6.6 line 482, §10 line 618), `docs/DECISIONS.md` (D074), `docs/ARCHITECTURE.md:141`, `docs/GAME-SYSTEMS.md:55`

**Interfaces:**
- **Produces:**
  - `DeckSpec.secondRound?: readonly { readonly id: string; readonly positions: readonly number[] }[]`
  - In game-kit: `packetOrder(deck: DeckSpec, rng: Rng): number[]` and `packetOrderFits(deck: DeckSpec, order: readonly number[]): boolean`
  - In client: `interface ShuffleGroup { readonly id: string; readonly positions: readonly number[] }` (`id` is the domain) and `interface ShuffleStep { readonly seat: number; readonly round: 1 | 2; readonly group: ShuffleGroup }`
  - `shuffleSchedule(deck: DeckSpec | null, seats: number): readonly ShuffleStep[]`
  - `SessionView.shuffleProgress: { readonly round: number; readonly rounds: number; readonly seatsDone: number } | null`

- [ ] **Step 1: Write the failing tests**

  **`packages/game-kit/test/packet.test.ts`**, with `deck = {id:'cards', size:12, partitions:[{id:'a',size:6},{id:'b',size:6}], secondRound:[{id:'mix', positions:[1,2,3,4,5,7,8,9,10,11]}]}`:
  - `it('draws a plain deck exactly as shuffle(range(size))')`: for the same seed, `packetOrder({id:'x', size:12}, rng)` equals `shuffle(range(12), rng2)`.
  - `it('shuffles each partition within itself, in group order')`: equals `[...shuffle(range(6), r), ...shuffle(range(6).map(n => n + 6), r)]` for the same seed.
  - `it('keeps positions outside the second round in their partition and mixes the rest')`:
    - over 50 seeds, `order[0] < 6` and `order[6] >= 6`;
    - the positions `[1..5, 7..11]` hold exactly the other 10 cards;
    - for at least one seed, a card below 6 sits at a position of 7–11.
  - `it('says which orders a packet can produce')`:
    - true for every `packetOrder` output above;
    - false for `[0,0,…]` (not a permutation);
    - false for an order with a card ≥ 6 at position 0;
    - false for an order where position 6 holds a card < 6.

  **`packages/client/test/partitioned-deck.test.ts`**, a new `describe('second shuffle round (D074)')`:
  - `it('schedules every first-round step before any second-round step')`: with the deck above and 2 seats:
    - `shuffleSchedule(deck, 2).map(s => s.seat)` is `[0, 0, 1, 1, 0, 1]`;
    - the group ids are `['cards/a','cards/b','cards/a','cards/b','cards/mix','cards/mix']`;
    - the rounds are `[1,1,1,1,2,2]`.
  - `it('keeps today’s schedule for plain and partitioned decks')`:
    - a plain deck gives seats `[0,1,2]` with group id `'cards'`;
    - the two-partition deck without a second round gives `[0,0,1,1]` and `['cards/a','cards/b','cards/a','cards/b']`.
    These are the existing arithmetic test's expectations, ported.
  - `it('refuses an invalid second round')`: each of these throws:
    - `[]`;
    - two groups with id `'mix'`;
    - id `'a'` (a partition id);
    - a position `12`, or `-1`;
    - positions `[3,1]`;
    - a single position `[1]`;
    - two groups sharing position `3`.
  - `it('plays a two-round shuffle to the deal; position 0 keeps its partition')`:
    - set the toy deck as the existing `table()` helper does, plus `secondRound`;
    - deliver `buildShuffle` from the seat that `waitingFor()` names, step by step, until `phase === 'deal'`;
    - check `view().shuffleSteps === 6`, and `shuffleProgress` equals `{round: 2, rounds: 2, seatsDone: 0}` after step 4;
    - after the deal, the spectator's toy state has `trump.card < 6`.
  - `it('rejects a second-round step that is proven or shaped as another step')`. At seq 5 each of these is `rejected`:
    - a 10-card shuffle proven under `cards/a`;
    - a 6-card contiguous slice;
    - a correct mix step signed by seat 1;
    - and at seq 1, a 10-card step.

  **`apps/web/test/game-screen.test.ts`**:
  - `it('words a two-round shuffle by round')`: `setupStep(viewOf({phase:'shuffle', shuffleSteps:15, shuffleProgress:{round:2, rounds:2, seatsDone:1}}), copy)` is `'Shuffling the deck (round 2 of 2): 1 of 3 players done.'`.
  - The existing single-round expectations stay.

- [ ] **Step 2: Run the tests to verify they fail**

  Run `pnpm vitest run --project game-kit test/packet.test.ts`, `pnpm vitest run --project client test/partitioned-deck.test.ts` and `pnpm vitest run --project web test/game-screen.test.ts`.
  Expected: FAIL (missing exports `packetOrder` and `shuffleSchedule`; `shuffleProgress` undefined).

- [ ] **Step 3: Implement `packetOrder` and `packetOrderFits` in `packages/game-kit/src/packet.ts`; add `secondRound` to `DeckSpec`**

  - `packetOrder` shuffles each partition in list order exactly as `railOrder` does (one `shuffle` call per group, in group order). It then permutes the cards at each second-round group's positions with one more `shuffle` per group.
  - `packetOrderFits` checks the order is a permutation of `0..size−1`. A position outside every second-round group must hold a card of its own partition. Each second-round group must hold exactly the cards that `identity` holds at its positions.
  - Export both from `index.ts`. Document `secondRound` on `DeckSpec` with the validity rules above.

- [ ] **Step 4: Implement `shuffleSchedule` in `packages/client/src/partitioned-deck.ts`, and switch the session to it**

  - **`partitioned-deck.ts`:**
    - keep `deckPartitions`;
    - add the second-round validation (`ClientError('invalid deck second round')`);
    - `parsePartitionMove` takes the sizes of all scheduled groups;
    - delete `shuffleStepSeat` and `shuffleStepGroup`, after `grep` shows the session is their only caller, and port their tests to `shuffleSchedule`.
  - **`session.ts`:**
    - `this.schedule = shuffleSchedule(deck, seats)` and `this.shuffleSteps = this.schedule.length`;
    - `stepAt(step)` replaces `partitionAt` and throws past the end;
    - `nextShuffler` is `this.schedule[this.chain.length]?.seat ?? null`;
    - `shuffleCtx` is `{ rootId, seat: step.seat, deckId: step.group.id }`;
    - `moveShape` checks the seat and `group.positions.length`;
    - `foldMove` scatters, while `shuffleVerifies` and `buildShuffle` gather:
      ```ts
      const next = prev.slice();
      group.positions.forEach((p, i) => { next[p] = output[i] as Ciphertext; });   // fold
      const input = group.positions.map((p) => deck[p] as Ciphertext);            // verify and build
      ```
    - `view()` sets `shuffleProgress` while `phase === 'shuffle'`, from the next step's round, the number of rounds, and the seat of the next step (`seatsDone`). Otherwise it is null.
  - **`client/src/types.ts`:** document `shuffleSteps` as the schedule's length, and add `shuffleProgress`.
  - **`setupStep`:** when `shuffleProgress?.rounds > 1`, return `` `${shuffling} (round ${round} of ${rounds}): ${seatsDone} of ${seats} players done.` ``. Otherwise keep the existing formula.

- [ ] **Step 5: Run the tests to verify they pass**

  Run the three commands of Step 2, then `pnpm vitest run --project client --project luster --project right-of-way --project driftwrights > $SCRATCH/t1.log 2>&1; tail -5 $SCRATCH/t1.log`.
  Expected: PASS everywhere. Luster, Right of Way and Driftwrights must still pass unchanged, which proves byte-identical folding.

- [ ] **Step 6: Write the protocol text and D074**

  **PROTOCOL.md:**
  - §5.5: add three paragraphs:
    - **Second round**: the validity rules above, and the domain `<deck id>/<group id>`;
    - **Step order**: N = (G1+G2)·S. Steps s < G1·S are unchanged. For t = s − G1·S, the seat is `floor(t/G2)` and the group is `t mod G2`;
    - **A step on positions p1<…<pn**: gather, scatter, and proof per §5.3 with the group's domain. It also says that a card outside every second-round group stays in its first-round group, and that full-mode setup MUST accept every order the rounds can produce.
  - §5.5: "a card never leaves its group" becomes "… until a second round".
  - §6.1: rewrite N and the shuffle phase with the round order.
  - §4.4, §6.5 and §6.6: the step's seat is "the seat §5.5 gives for that step", not "seat `seq−1`".
  - §10: one deck, which may be split into partitions and a second round.
  - Fix the stale `shuffleSteps` lines in `ARCHITECTURE.md:141` and `GAME-SYSTEMS.md:55`.

  **DECISIONS.md D074, "A second shuffle round mixes chosen positions after the partitions (opt-in)":**
  - **Context.** Room for Doubt's gap 1: partitions make each position's kind public, so a rebuttal would show which named card it was.
  - **Decision.** The field, the schedule, the domain, and no deck or protocol package change.
  - **What it costs.** S more sequential steps: a second pass round the table.
  - **Security.** Kinds stay hidden if one seat's round-2 permutation is honest, and the Verdict if one seat's round-1 permutation is. Round order is enforced by seq.
  - **Existing games.** Unchanged.

- [ ] **Step 7: Run `pnpm check` and commit**

```bash
pnpm check > $SCRATCH/check-t1.log 2>&1; tail -15 $SCRATCH/check-t1.log
git add packages/game-kit packages/client apps/web/src/screens/game.tsx apps/web/test/game-screen.test.ts docs/PROTOCOL.md docs/DECISIONS.md docs/ARCHITECTURE.md docs/GAME-SYSTEMS.md
git commit -m "Platform: a second shuffle round over chosen positions, after the partitions (D074)"
```

---

### Task 2: Private show (D075)

**Files:**
- Modify: `packages/game-kit/src/types.ts` (the `Learn` doc 38–43, the `knownTo` and `legalActions` docs, a new member after `privateSelection` at 140), `packages/game-kit/src/index.ts`, `packages/game-kit/src/fuzz.ts` (player branch 327–381)
- Create: `packages/game-kit/test/show-toy.ts` (a test module) and `packages/game-kit/test/fuzz-show.test.ts`
- Create: `packages/client/src/private-show.ts`; Test: `packages/client/test/private-show.test.ts`
- Modify: `packages/client/src/session.ts` (`checkAction` ~1540–1600, `actionEvent` ~3077), `packages/client/src/audit.ts` (`replay` 82–124)
- Modify: `docs/PROTOCOL.md` (new §14 "Private shows"; a §11 security note), `docs/DECISIONS.md` (D075)

**Interfaces:**
- **Consumes:** nothing from Task 1.
- **Produces (game-kit):**
  - `SHOW_DECK = 'shown'`
  - `interface PrivateShow { readonly id: number; readonly from: Seat; readonly to: Seat }`
  - `GameModule.privateShow?(state: S): PrivateShow | null`
  - the marker `{type:'show', actor, pos}` and the wire `{type:'show', actor, id, packet}`
  - the learn `{deck: SHOW_DECK, pos: id, card}`, delivered after the wire's `apply`, to `from`, to `to` and in full mode
- **Produces (client):**
  - `showEnvelope(raw: unknown, plan: PrivateShow, deckSize: number): boolean`
  - `makeShow(plan: PrivateShow, pos: number, secret: bigint, share: Share, keys: readonly string[], root: string, after: string, deckSize: number, rnd: RandomBytes): { type: 'show'; actor: number; id: number; packet: string }`
  - `readShow(raw: unknown, plan: PrivateShow, seat: number, secret: bigint, keys: readonly string[], root: string, after: string, deckSize: number): { pos: number; share: Share }` (throws on any mismatch)
  - `auditShow(raw: unknown, plan: PrivateShow, secrets: readonly bigint[], root: string, after: string, deck: readonly Ciphertext[], cards: ReadonlyMap<string, number>, holderOf: (pos: number) => number | null): Learn` (throws on any mismatch)

- [ ] **Step 1: Write the failing tests**

  **The test module, `packages/game-kit/test/show-toy.ts`.** "Show and tell" is a small `GameModule`:
  - 2–3 seats; `decks: () => [{ id: 'cards', size: 6 }]`;
  - setup deals position p to seat `floor(p/2)` for `p < 2·seats`;
  - at stage `'ask'` the turn seat t's only action is `{type:'ask', actor:t}`;
  - then `privateShow` is `{id: shows.length, from: (t+1)%n, to: t}`, and `from`'s legal list is one marker per position it holds;
  - `apply` accepts only the wire. It appends `{from, to, card: null}` to `shows` and passes the turn;
  - `learn(SHOW_DECK)` fills `shows[id].card`: in a view only for `from` and `to`; in full mode only if `from` holds that card;
  - after 4 shows the game is over;
  - `view` hides other hands and keeps a show's card for `from` and `to`; `knownTo` lists hand cards only.

  **`packages/game-kit/test/fuzz-show.test.ts`:**
  - `it('models a private show: only the two seats learn the card')`: `fuzzBatch(showToy, {seed:'show', games: 30, seatCounts:[2,3], checkViews: true})` has no failure.
  - `it('fails a module that leaks a shown card to a third seat')`: a variant whose `view` keeps every show's card fails with `view mismatch`.

  **`packages/client/test/private-show.test.ts`**, over real crypto with `makeModuleGame(showToy, 3, seed)` and the helpers of `sealed-redeal.test.ts`:
  - `it('only the shower and the submitter learn the card; the wire holds no position or card')`:
    - after the first show, the views of seats 0 and 1 have `shows[0].card` equal to the dealt card;
    - seat 2's view and the spectator's have `null`;
    - `JSON.stringify` of the signed event contains neither `"pos"` nor the card's number as a JSON value.
  - `it('makes two shows of one position unlinkable')`: the same position shown twice gives two packets that differ, both of the length `showEnvelope` expects.
  - `it('re-learns the card on reload')`: a fresh session for the submitter that receives every event has the same `shows[0].card`.
  - `it('rejects a malformed show and keeps one chain for a bad packet')`:
    - a wire with an extra key, or a packet of the wrong length, is `rejected` by every session;
    - a well-formed packet encrypted to the wrong seat is `accepted` everywhere, and the submitter learns nothing.
  - `it('audits shows: pass for honest play, fail for the shower otherwise')`:
    - an honest game's audit is `'pass'`;
    - a packet whose share was made with another seat's secret fails seat `from` with a reason starting `move `.

- [ ] **Step 2: Run the tests to verify they fail**

  Run `pnpm vitest run --project game-kit test/fuzz-show.test.ts` and `pnpm vitest run --project client test/private-show.test.ts`.
  Expected: FAIL (`SHOW_DECK` not exported; markers rejected as `legal action rejected`).

- [ ] **Step 3: Add the contract** to `types.ts` as in "Platform design", with docs:
  - `Learn` may carry `SHOW_DECK`, whose `pos` is a show id;
  - `knownTo` never lists `SHOW_DECK` learns;
  - `legalActions` may list `show` markers, which the session materializes before `apply`.

  Export `SHOW_DECK` and `PrivateShow` from `index.ts`.

- [ ] **Step 4: Implement the codec** `packages/client/src/private-show.ts`, alongside `private-transfer.ts` (reuse its `secretBytes` idea and the x-only key form). Notes:
  - `pos` padding width is `String(deckSize - 1).length`;
  - `readShow` checks the exact plaintext key set and every context field;
  - `auditShow` checks:
    - the context;
    - `holderOf(pos) === from`;
    - `share.D` equals `deck[pos].a` times `secrets[from]`;
    - the card is `cardOf(cards, decryptWithSecrets(deck[pos], secrets))`;

    and returns `{deck: SHOW_DECK, pos: plan.id, card}`.

- [ ] **Step 5: Wire it into the session, the audit and the fuzzer**, as "Platform design" says. In the session:
  - the learn runs inside `checkAction`, after the reveal checks and before `return { next, events }`;
  - `holderOf` is the latest `dealt(state)` entry for `pos`;
  - the cache key is `show:${m.id}`.

  In the audit, `holderOf` reads `module.dealt(state)` of the state before the show.

- [ ] **Step 6: Run the tests to verify they pass**

  Run the two commands of Step 2, then `pnpm vitest run --project client --project game-kit --project driftwrights > $SCRATCH/t2.log 2>&1; tail -5 $SCRATCH/t2.log`.
  Expected: PASS. Driftwrights' private transfer and the existing fuzz tests pass unchanged.

- [ ] **Step 7: Write PROTOCOL §14 "Private shows (D075)" and D075**

  **§14** specifies:
  - the hook, the marker, the wire (exact keys) and the plaintext (exact keys and padding);
  - the conversation key and the exact length;
  - who learns and when (after `apply`);
  - why there is no rejection after `apply` (one chain);
  - the audit checks, and that Resign must stay disabled (an early secret opens every packet to or from that seat).

  **§11** gains one line: an equivocating shower exposes two cards to the submitter, and is flagged and ranked last (the D071 residual).

  **D075, "A private show: the shower's share rides on its own move, encrypted to one seat":**
  - **Context.** Room for Doubt's gap 2: a public re-deal names the position, so repeated shows link and a third seat can deduce the card.
  - **Decision.** The design above, and why not a Sealed event (anyone can trial-verify a sealed share against the shower's few positions).
  - **What stays the same.** No new kind or field; `proto` 1.
  - **Residuals.** Packets open once the secrets are released at the end, as every hidden card does; Resign is disabled.

- [ ] **Step 8: Run `pnpm check` and commit**

```bash
pnpm check > $SCRATCH/check-t2.log 2>&1; tail -15 $SCRATCH/check-t2.log
git add packages/game-kit packages/client docs/PROTOCOL.md docs/DECISIONS.md
git commit -m "Platform: a private show, the shower's share sealed to the submitter inside its own move (D075)"
```

---

### Task 3: Engine foundations: package, ids, board and movement

**Files:**
- Create: `packages/games/room-for-doubt/{package.json,tsconfig.json,tsconfig.test.json}`, copied from Right of Way's (exports `.`, `./theme`, `./catalog`, `./compare`, `./brand`, `./art`; the dependency `@bored-games/game-kit`)
- Create: `src/ids.ts`, `src/board.ts`, `src/movement.ts`, `src/index.ts`
- Test: `test/board.test.ts`, `test/movement.test.ts`
- Modify: `vitest.config.ts` (a `room-for-doubt` project like `right-of-way`'s), `tests/catalog.test.ts` (ruling 8: the spec-only check looks for `test/catalog/`), `pnpm-lock.yaml` (`pnpm install`)

**Interfaces:**
- **Consumes:** `packetOrder` and `packetOrderFits` (Task 1) are used only from Task 4.
- **Produces, from `ids.ts`:**
  - `PARTIES = ['ashdown','brine','reeve','crowther','faulk','quarrel'] as const`
  - `EXHIBITS = ['gavel','scales','reports','carafe','manacles','clockhand'] as const`
  - `SCENES = ['courtroom','chambers','jury','robing','registry','store','cells','belfry','gallery'] as const`
  - the types `PartyId`, `ExhibitId` and `SceneId`
  - card numbers: 0–5 Parties, 6–11 Exhibits and 12–20 Scenes, each in list order; 21–29 are the room cards, where room card `21 + r` names `SCENES[r]`
  - `cardName(n): PartyId | ExhibitId | SceneId` for 0–20, and `kindOf(n): 'party' | 'exhibit' | 'scene' | 'room'`
  - `DECK_ID = 'case'` and `DECK_SIZE = 30`
  - `VERDICT_POSITIONS = [0, 6, 12]`
  - `HAND_POSITIONS = [1,2,3,4,5,7,8,9,10,11,13,14,15,16,17,18,19,20]`
  - `ROOM_POSITIONS = [21,22,23,24,25,26]`: exhibit `e` starts in the room that position `21 + e` names
  - `SEAT_PARTIES: Readonly<Record<3|4|5|6, readonly number[]>> = {3:[0,2,4], 4:[0,1,3,4], 5:[0,1,2,3,4], 6:[0,1,2,3,4,5]}` (P1)
- **Produces, from `board.ts`:**
  - `BOARD_ROWS: readonly string[]` (the 24 rows of `board.txt`)
  - `type Place = string`: a square name `'A1'…'X24'` (column letter A–X, then row 1–24) or a `SceneId`
  - `squareName(i: number): string` and `squareIndex(name: string): number | null`, where index = `y·24 + x`; the name has an uppercase letter and no leading zero
  - `ROOM_RECTS: Readonly<Record<SceneId, {x0,y0,x1,y1}>>`
  - `DOORS: readonly {room: SceneId; door: number; step: number}[]`
  - `CORRIDOR: ReadonlySet<number>`
  - `ENTRANCES: readonly string[]` (by party: `['H1','S1','X8','P24','G24','A13']`)
  - `ROTUNDA` (a rect)
  - `passageTo(room: SceneId): SceneId | null` (chambers↔store, belfry↔cells)
  - `doorRoomAt(square: number): SceneId | null` (the room whose doorstep this is)
- **Produces, from `movement.ts`:**
  - `destinations(from: Place, roll: number, occupied: ReadonlySet<number>): { places: Place[]; shortfall: boolean }`. Squares come first, ascending by index, then rooms in `SCENES` order. `shortfall` is true when P4's longest-path rule applied.
  - `canMove(from: Place, occupied: ReadonlySet<number>): boolean`: there is a free first step.

- [ ] **Step 1: Write the failing tests**

  **`test/board.test.ts`:**
  - `it('holds board.txt exactly')`: `BOARD_ROWS.join('\n') + '\n'` equals the file read with `node:fs`.
  - `it('agrees with the reviewed parser')`, using `parseBoard` from `../../../../scripts/room-for-doubt/board.ts`:
    - the corridor squares and the Entrances are the same;
    - each door's room and doorstep are the same;
    - each room's rect covers exactly its letter and door squares.
  - `it('names squares as the rules do')`:
    - `squareName(0) === 'A1'` and `squareName(575) === 'X24'`;
    - `squareIndex('H1') === 7`;
    - `squareIndex('h1')`, `squareIndex('H01')` and `squareIndex('Y1')` are `null`.
  - `it('joins the opposite corners')`:
    - `passageTo('chambers') === 'store'` and `passageTo('cells') === 'belfry'`;
    - `passageTo('courtroom') === null`;
    - `doorRoomAt(squareIndex('H3')) === 'courtroom'`.

  **`test/movement.test.ts`.** Write `occ(...names)` for a set of square indices:
  - `it('steps orthogonally (C10)')`: `destinations('H1', 2, occ()).places` is `['G2','H3']`.
  - `it('enters a room through its door and stops (C13, C15)')`:
    - with roll 3 from `'H1'`, the places include `'courtroom'`;
    - with roll 12 from `'H1'`, the places include `'courtroom'` and no square inside a room.
  - `it('never enters an occupied square (C11)')`: `destinations('H1', 2, occ('H2')).places` is `['G2']`.
  - `it('never repeats a square (C12)')`: for rolls 2–12, `'H1'` is not a destination of `'H1'`.
  - `it('cannot use a door whose doorstep is occupied (C14)')`:
    - `destinations('H1', 3, occ('H3'))` excludes `'courtroom'`;
    - every place of `destinations('courtroom', 2, occ('H3'))` is `'L7'`, `'N7'` or `'M8'`.
  - `it('never re-enters the room it left (C16)')`: for rolls 2–12, `'courtroom'` is not a destination of `'courtroom'`.
  - `it('falls short along the longest legal path (C19, P4)')`: `destinations('H1', 6, occ('G4','H3','G5','H5'))` is `{places: ['G1','H2','G3'], shortfall: true}`; with roll 3 it is `{places: ['G1','H2','G3'], shortfall: false}`.
  - `it('is walled in with no first step (C18)')`:
    - `canMove('G1', occ('H1','G2'))` is false, and `destinations('G1', 7, occ('H1','G2')).places` is `[]`;
    - `canMove('courtroom', occ('H3','M7'))` is false.

- [ ] **Step 2: Run the tests to verify they fail**

  Run `pnpm install && pnpm vitest run --project room-for-doubt`.
  Expected: FAIL (the modules are missing).

- [ ] **Step 3: Implement `ids.ts`, `board.ts` and `movement.ts`.** `board.ts` derives everything from `BOARD_ROWS` once, at module load, with the legend of RULES §The board. `destinations` is a depth-first search over self-avoiding paths:

```ts
// start: a square (visited) or a room (left: never re-entered; its free doorsteps are the first steps).
// From a corridor square: step to a free, unvisited corridor neighbour; or, when the square is a door's
// doorstep and that room is not the room left, enter the room (one step, the path ends there).
// Record: corridor squares reached with exactly `roll` steps; rooms entered within `roll` steps;
// the deepest length reached and the squares at that length.
// Result: exact ∪ rooms if non-empty, else the deepest squares (shortfall: true), else [] (walled in).
```

  Measured worst case: 31,257 nodes at roll 12. No memoisation is needed.

- [ ] **Step 4: Run the tests to verify they pass.** `pnpm vitest run --project room-for-doubt`. Expected: PASS.

- [ ] **Step 5: Run `pnpm check` and commit**

```bash
pnpm check > $SCRATCH/check-t3.log 2>&1; tail -15 $SCRATCH/check-t3.log
git add packages/games/room-for-doubt vitest.config.ts tests/catalog.test.ts pnpm-lock.yaml
git commit -m "Room for Doubt engine: ids, the board model and the movement search (D076)"
```

---

### Task 4: Engine rules, catalog and brand

**Files:**
- Create in `packages/games/room-for-doubt/src/`: `types.ts`, `engine.ts`, `invariants.ts`, `module.ts`, `theme.ts`, `catalog.ts`, `compare.ts`; update `index.ts`
- Test: `test/helpers.ts`, and in `test/catalog/`: `setup.test.ts` (C01–C07), `movement.test.ts` (C08–C19), `submission.test.ts` (C20–C25, C40), `rebuttal.test.ts` (C26–C31), `indictment.test.ts` (C32–C39), `protocol.test.ts` (C41–C45)
- Modify: `tests/catalog.test.ts` (remove `room-for-doubt` from `SPEC_ONLY`), `tests/restricted-names.ts` (`ALLOWED_PHRASE_HOMES`), `tests/repo-guards.test.ts` (the phrase games list 315–359, plus an exact-case variant of the "nothing else gets through" test), `tests/public-build.test.ts:69`

**Interfaces:**
- **Consumes:**
  - Task 1: `packetOrder`, `packetOrderFits`, `DeckSpec.secondRound`.
  - Task 2: `SHOW_DECK`, `PrivateShow`, the marker, wire and learn.
  - Task 3: every export.
- **Produces (`types.ts`):**
  ```ts
  export interface RfdRules { readonly submit: 'optional' | 'required' }
  export type Stage = 'reveal' | 'start' | 'roll' | 'walk' | 'moved' | 'rebut' | 'answered' | 'verdict' | 'over';
  export interface Slot { readonly pos: number; readonly card: number | null }
  export interface RfdPlayer { readonly party: number; readonly hand: readonly Slot[]; readonly dismissed: boolean;
    readonly indicted: boolean; /** RULES "the moved Party" */ readonly summoned: boolean }
  export interface Submission { readonly by: number; readonly party: PartyId; readonly exhibit: ExhibitId;
    readonly scene: SceneId; readonly passed: readonly number[]; readonly shownBy: number | null;
    /** The shown card: known to `by`, `shownBy` and the full state only. */ readonly card: number | null }
  export interface Indictment { readonly by: number; readonly party: PartyId; readonly exhibit: ExhibitId;
    readonly scene: SceneId; readonly upheld: boolean | null }
  export interface RfdState { readonly game: 'room-for-doubt'; readonly rules: RfdRules; readonly seats: number;
    readonly mode: 'full' | 'view'; readonly viewer: number | null; readonly order: readonly number[] | null;
    readonly dealt: readonly DealtPosition[]; readonly players: readonly RfdPlayer[];
    readonly pawns: readonly Place[];               // by party index, all six
    readonly exhibits: readonly (SceneId | null)[]; // by exhibit index; null until revealed
    readonly roomCards: readonly Slot[];            // ROOM_POSITIONS, public once revealed
    readonly verdict: readonly Slot[];              // VERDICT_POSITIONS
    readonly turn: number; readonly stage: Stage; readonly dice: readonly number[] | null;
    readonly entered: boolean; readonly asking: number | null;
    readonly submissions: readonly Submission[]; readonly indictments: readonly Indictment[];
    readonly rolls: readonly DiceRoll[]; readonly roll: number | null; readonly contributors: readonly number[];
    readonly result: Outcome | null; readonly seq: number }
  ```
- **Produces (actions, one accepted encoding each; exact key sets):**
  - `{type:'reveal', actor:'deck', deck:'case', pos, card}` (derived)
  - `{type:'roll', actor}`
  - `{type:'contribute', actor, id}`
  - `{type:'rolled', actor:'beacon', id, dice:[a,b]}` (derived)
  - `{type:'move', actor, to: Place}`
  - `{type:'passage', actor}`
  - `{type:'stay', actor}`
  - `{type:'submit', actor, party, exhibit}`
  - the show marker `{type:'show', actor, pos}` (legal list only)
  - the show wire `{type:'show', actor, id, packet}` (packet: a string of 1–4096 characters)
  - `{type:'none', actor}`
  - `{type:'indict', actor, party, exhibit, scene}`
  - `{type:'verdict', actor, upheld}`
  - `{type:'endTurn', actor}`
- **Produces (events):**
  - `revealed {exhibit, room}`
  - `rolled {seat, dice}`
  - `moved {seat, to, how: 'walk'|'shortfall'|'passage'|'stay'}`
  - `submitted {seat, party, exhibit, scene, summoned}`
  - `passed {seat}`
  - `shown {seat, to}`
  - `unrebutted {seat}`
  - `indicted {seat, party, exhibit, scene, again}`
  - `verdict {seat, upheld}`
  - `turn {seat}`
- **Produces (the module and its data):**
  - `CASE_DECK: DeckSpec` is
    ```ts
    {id:'case', size:30,
     partitions:[{id:'parties',size:6},{id:'exhibits',size:6},{id:'scenes',size:9},{id:'rooms',size:9}],
     secondRound:[{id:'mix', positions: HAND_POSITIONS}],
     promptShares: true}
    ```
  - `roomForDoubt: GameModule<RfdState, RfdEvent, RfdRules>` (id `'room-for-doubt'`, version `'0.1.0'`), with `DEFAULT_RULES = {submit:'optional'}` and `validateRules`
  - `ROOM_FOR_DOUBT_BRAND`, and `ROOM_FOR_DOUBT_THEME` with:
    - `title` and `tagline`;
    - `parties[i] = {name, role, monogram, emblem, accent, door}`;
    - `exhibits[i]` and `scenes[r]` (display names);
    - `verdict: 'the Verdict'` and `passage: 'Old Gaol Passage'`
  - `ROOM_FOR_DOUBT_CATALOG`, and `COMPARE_PHRASE = 'Compare to Clue'` with `COMPARE_TITLE`, `COMPARE_PREFIX` and `COMPARE_BGG_ID = 1294`

**The rules machine** (RULES §Setup, §Your turn and §End are the authority; this fixes the online form):

- **`setup`:**
  - seats must be 3–6;
  - full mode requires `packetOrderFits(CASE_DECK, deckOrders.case)`;
  - each player's party comes from `SEAT_PARTIES`, and each hand is `HAND_POSITIONS[i]` dealt to seat `i % n` (cards are known in full mode, `null` in views);
  - `dealt` is the 18 hand entries in that order, then `ROOM_POSITIONS` to `null`;
  - pawns stand on `ENTRANCES`, exhibits are `null`, and the room-card slots are `null` in both modes until revealed;
  - the verdict slots hold `order[pos]` in full mode and `null` in views;
  - the stage is `'reveal'`, with `turn: 0`.
- **`pending`:**

  | Stage | Pending |
  |---|---|
  | `'reveal'` | `{type:'reveal', deck:'case', positions: the unrevealed ROOM_POSITIONS}` |
  | `'roll'` with contributors left | `{type:'player', seat: contributors[0], decision:'contribute'}` |
  | `'roll'` with none left | `{type:'beacon', id: roll}` |
  | `'rebut'` | `{type:'player', seat: asking, decision:'rebut'}` |
  | `'over'` | `{type:'over'}` |
  | any other | `{type:'player', seat: turn, decision: stage}` |

- **`legalActions(s, seat)`** is `[]` unless `seat` is the pending player seat. It lists in this order:
  - `'start'`:
    - `roll` if `canMove`, else `stay`;
    - `passage` if the pawn stands in a corner room;
    - when `summoned` and in a room: the 36 submits, Parties outer, then Exhibits;
    - unless `indicted`: the 324 indicts, Parties × Exhibits × Scenes.
  - `'roll'`: exactly `[{type:'contribute', actor: seat, id: roll}]`.
  - `'walk'`: a move to each of `destinations(...).places`, then the indicts.
  - `'moved'`: the submits if `entered`; `endTurn` unless `entered` and `submit: 'required'`; then the indicts.
  - `'rebut'`: `[]` unless every hand card of `seat` is known. Then one marker per held named card, by position, or `[{type:'none', actor: seat}]` if it holds none.
  - `'answered'`: the indicts, then `endTurn`.
  - `'verdict'`: `[]` until all three verdict slots are known. Then exactly `[{type:'verdict', actor, upheld}]`, where `upheld` is whether the last indictment matches them.
- **`apply`** parses strictly, checks the pending seat and stage, then:
  - **`reveal`**: the card is a room card, and equals `order[pos]` in full mode. It fills the slot and sets `exhibits[pos − 21]`. After the last reveal the stage becomes `'start'`.
  - **`roll`** (requires `canMove`):
    - appends `{id: rolls.length, last: actor}` to `rolls` and sets `roll`;
    - contributors are every seat, from the seat after the roller round to the roller;
    - clears `summoned[actor]`;
    - stage becomes `'roll'`.
  - **`contribute`** pops the queue.
  - **`rolled`**: two faces 1–6 for the open id. It sets `dice`, `roll: null`, stage `'walk'`.
  - **`move`**: `to` must be one of the destinations. It moves the pawn; entering a room sets `entered: true`. Stage becomes `'moved'`.
  - **`passage`**: moves to `passageTo(room)`, sets `entered: true`, clears `summoned`, stage `'moved'`.
  - **`stay`** (requires `!canMove`): clears `summoned`, stage `'moved'`.
  - **`submit`**:
    - the named Party's pawn moves into the room unless it is there already. If it moved and is played by another seat, that seat becomes `summoned`;
    - the Exhibit token moves into the room;
    - append the submission; set `entered: false` and clear the actor's `summoned`;
    - `asking` becomes the next seat; stage `'rebut'`.
  - **`show` wire**:
    - from `asking`, with `id === submissions.length − 1`;
    - in full mode, the actor must hold at least one named card;
    - sets `shownBy`; stage `'answered'`; `asking: null`.
  - **`none`**:
    - rejected where the actor's hand is fully known and holds a named card;
    - appends to `passed`. The next seat is asked; if that is the submitter, emit `unrebutted` and the stage becomes `'answered'`.
  - **`indict`** (stages start, walk, moved, answered; once per seat):
    - appends the indictment and sets `indicted`;
    - clears `summoned` when the stage was `'start'`;
    - appends `VERDICT_POSITIONS` dealt to the actor;
    - stage `'verdict'`.
  - **`verdict`**:
    - in full mode, and in the actor's own view with the three cards known, `upheld` must equal the match;
    - **upheld**: `result = {places: winner 1, others 2; scores: winner 1, others 0; reason: 'upheld'}`, and the stage becomes `'over'`;
    - **otherwise**: `dismissed`, and a pawn on a doorstep moves into `doorRoomAt` (C38). If one undismissed seat is left it wins with reason `'last-standing'`. Otherwise the turn passes.
  - **`endTurn`**: from `'moved'` (unless a submission is required and owed) or from `'answered'`.
  - **Passing the turn**: the next undismissed seat after `turn`, stage `'start'`, `dice: null`, `entered: false`.
  - Every accepted action increments `seq`.
- **`view(s, v)`**:
  - `mode: 'view'`, `viewer: v`, `order: null`;
  - other seats' hand cards become `null`;
  - a submission's `card` becomes `null` unless `v` is its `by` or `shownBy`;
  - the verdict cards become `null` unless `players[v].indicted`.
- **`learn`:**
  - deck `'case'` fills the viewer's hand slot, or a verdict slot once the viewer has indicted, of the right kind;
  - deck `SHOW_DECK`: `pos` is a submission with `shownBy` set. In a view the viewer must be `by` or `shownBy`. In full mode the card must be named and held by `shownBy`. An equal re-learn is accepted;
  - anything else is rejected.
- **The other members:**
  - `knownTo(s, seat)`: the hand, plus the verdict slots once that seat has indicted;
  - `dealt: (s) => s.dealt`;
  - `revealsOf: () => []`;
  - `privateShow`: in stage `'rebut'`, `{id: submissions.length − 1, from: asking, to: by}`;
  - `rolls: (s) => s.rolls`;
  - `beaconOf`: the open `roll` for a `contribute` action, else `null`;
  - `resignAllowed: () => false`;
  - `outcome: (s) => s.result`;
  - `standings`: `result.scores`, or zeros.
- **`coverage`** tags:
  - `move:roll` (on `rolled`), `move:passage`, `move:stay`, `move:shortfall`, `move:room`;
  - `submit:entered`, `submit:summoned`;
  - `rebut:show`, `rebut:none`, `rebut:unrebutted`;
  - `indict:dismissed`, `indict:upheld`, `indict:again`.
- **Invariants:**
  - no two pawns share a square;
  - after the reveals, the six exhibits sit in six different rooms;
  - hand sizes follow P2;
  - `dealt` holds the setup entries and then only verdict positions dealt to indicters;
  - there are at least two undismissed seats unless the game is over;
  - the turn seat is undismissed;
  - each seat indicts at most once;
  - `result` is set exactly when the stage is `'over'`.

- [ ] **Step 1: Write the test helpers** (`test/helpers.ts`):
  - `caseOrder(rng)`: `packetOrder(CASE_DECK, rng)`.
  - `orderWith(verdict: [PartyId, ExhibitId, SceneId], hands?: readonly string[])`: the 30-card order. It puts the verdict at 0, 6 and 12 and `hands`, or else the remaining case cards ascending, in `HAND_POSITIONS` order. Room cards are in identity order, so gavel→courtroom, scales→chambers, reports→jury, carafe→robing, manacles→registry and clockhand→store.
  - `fresh(seats, order?, rules?)`: the frozen full state.
  - `started(seats, order?, rules?)`: after the six reveals.
  - `act(s, a)`: must be accepted.
  - `refused(s, a)`: the error message, or null.
  - `legal(s, seat?)`.
  - `withPawns(s, places)`.
  - `rollTo(s, [a,b])`: roll, every contribution, then `rolled`.
  - `showCard(s, pos)`: the wire plus the full-mode `SHOW_DECK` learn.
  - `testPolicy`, a `FuzzPolicy`:
    - prefer a room destination, else a random move;
    - submit when possible;
    - rebut with a random legal answer;
    - indict at random on its sixth turn or later;
    - otherwise end the turn.

- [ ] **Step 2: Write the 45 catalog tests**, one `it('Cnn …')` per RULES heading, with these assertions (the deal of `orderWith` makes every hand known):
  - **`setup.test.ts`**
    - **C01**: the ids and the card numbering; `ROOM_FOR_DOUBT_THEME` names `'Rosalind Ashdown'`, `'Clock Hand'` and `"Judge's Chambers"`; 6 pawns and 6 exhibit slots.
    - **C02**: `setup` with 2 and with 7 seats fails, 3–6 succeed, and `seatRange` is `{min:3, max:6}`.
    - **C03**: the verdict positions never appear in the setup `dealt`; they hold a Party, an Exhibit and a Scene for 20 `caseOrder` seeds; `setup` refuses `orderWith` output with positions 0 and 1 swapped.
    - **C04**: hand sizes are `[6,6,6]`, `[5,5,4,4]`, `[4,4,4,3,3]` and `[3,3,3,3,3,3]`; `dealt` is `HAND_POSITIONS` to `i % n`; each non-Verdict case card is held once.
    - **C05**: parties per `SEAT_PARTIES`; every pawn on its Entrance, unplayed ones included.
    - **C06**: pending reveals 21–26; after them the exhibits sit in six distinct rooms, the same in every seat's view and the spectator's.
    - **C07**: the turn passes 0 → 1 → 2 → 0 through `endTurn`.
  - **`movement.test.ts`**
    - **C08**: one turn's stages are start → roll → walk → moved → start; an action from a non-pending seat is refused at each stage.
    - **C09**: the faces are 1–6; contributions run from the seat after the roller to the roller; `{type:'rolled', actor:0,…}`, three dice and a 7 are each refused.
    - **C10–C16, C19**: the Task 3 cases, played through `move` in the engine (`withPawns` for blockers): the legal moves equal the destinations; any listed move is accepted and an unlisted one refused.
    - **C17**: passage legal from chambers and belfry only at `'start'`; it lands in store and cells with `entered` true.
    - **C18**: walled in at G1 gives `stay` and no `roll`; after `stay` there are no submits unless the seat is summoned; indicts stay legal.
  - **`submission.test.ts`**
    - **C20**: submits are legal after entering by roll or passage. Under `'required'` there is no `endTurn` until a submission; under `'optional'` there is.
    - **C21**: no submit in `'answered'`, or at the next `'start'`, unless the seat is summoned.
    - **C22**: a submission naming a played Party in another place sets `summoned`; that seat may submit at `'start'`; rolling clears it; a Party already in the room is not summoned.
    - **C23**: the record holds party, exhibit and scene equal to the room; 36 submit actions.
    - **C24**: the pawn and the token are in the room; naming items already there changes nothing.
    - **C25**: naming one's own card is legal.
    - **C40**: an unplayed Party (Brine at 3 seats) and a dismissed seat's Party move when named.
  - **`rebuttal.test.ts`**
    - **C26**: asking starts after the submitter; a dismissed seat is asked.
    - **C27**: a holder gets markers only, and the wire makes the stage `'answered'`.
    - **C28**: two named cards held give two markers.
    - **C29**: a non-holder gets `[none]`, which passes to the next seat; in full mode a holder's `none` is refused.
    - **C30**: all pass gives `'answered'` with `shownBy` null, and `endTurn` and the indicts are legal.
    - **C31**: after `showCard`, `view(s, by)` and `view(s, shownBy)` hold the card; every other seat's view and the spectator's hold `null`; the wire has no `pos` and no card.
  - **`indictment.test.ts`**
    - **C32**: indict is legal at start, walk, moved and answered; not in roll or rebut; never for another seat.
    - **C33**: after one indictment no indict is listed, and a second is refused.
    - **C34**:
      - the indict deals 0, 6 and 12 to the indicter;
      - the indicter's view lists nothing until it has learned all three, then exactly one correct `verdict`;
      - a second indictment deals them again. For each of 0, 6 and 12, `dealt` then holds an entry to the first indicter, then one to the second, and none to `null`. That is the shape the session seals from the first indicter (PROTOCOL §4.10, `sealedPositions`).
    - **C35**: upheld gives places `[1,2,2]`, scores `[1,0,0]` and reason `'upheld'`.
    - **C36**: a dismissed seat's turn is skipped, and other views keep the verdict `null`.
    - **C37**: a dismissed seat is asked to rebut and contributes to rolls; its pawn can be named.
    - **C38**: a dismissed Party on H3 moves into the Courtroom.
    - **C39**: at 3 seats, two dismissals give the third seat `'last-standing'`.
  - **`protocol.test.ts`**
    - **C41**: standings are all 0 before the end and `[1,0,0]` after an upheld verdict.
    - **C42**: a table of malformed actions is refused and leaves the state unchanged: an extra key, `to:'h3'`, `to:'H03'`, an unknown party, `upheld:'yes'`, a marker passed to `apply`, and a player-sent `rolled`.
    - **C43**: `fuzzGame(roomForDoubt, {seed, seats, rules: DEFAULT_RULES, deckOrder: (_d, r) => caseOrder(r), checkViews: true, policies: [testPolicy]})` passes for seeds `c43-0…c43-7` at 3–6 seats.
    - **C44**: in full mode these are refused:
      - a holder's `none`;
      - the wire from a seat holding none of the named cards;
      - a `SHOW_DECK` learn of an unnamed card, or of a card the shower does not hold;
      - a wrong `upheld`.
    - **C45**: `fuzzBatch` with 40 games at 3–6 seats and `testPolicy` reports no failure, and every outcome reason is `'upheld'` or `'last-standing'`.

- [ ] **Step 3: Run the tests to verify they fail**

  Run `pnpm vitest run --project room-for-doubt`.
  Expected: FAIL (`engine.ts` is missing).

- [ ] **Step 4: Implement `types.ts`, `engine.ts`, `invariants.ts`, `module.ts`, `theme.ts`, `catalog.ts` and `compare.ts`** as specified above.
  - **`theme.ts`:** the brand pack copy is RULES §"Brand pack (for the build)" verbatim. The party, exhibit and scene names, roles, monograms and door names come from RULES §Components and §The board.
  - **`catalog.ts`:** RULES §"Catalog entry (for the build)", plus:
    - `typicalTurns: 60`, `year: null`, `status: 'beta'`, `bggId: null`;
    - `tags: ['mystery', 'murder', 'courthouse', 'detective']`;
    - `modes: ['competitive']`, `turn: 'sequential'`.
  - **`compare.ts`:** like Right of Way's. The BoardGameGeek id 1294 is confirmed by opening `https://boardgamegeek.com/boardgame/1294` (WebFetch) before the commit. If the page names another game, stop and report.
  - **The phrase guards:**
    - add `'packages/games/room-for-doubt/src/compare.ts': 'Compare to Clue'` to `ALLOWED_PHRASE_HOMES`;
    - append a Room for Doubt entry to the `games` list with companies `['Hasbro', 'HASBRO', 'Parker Brothers', 'parker-brothers', 'ParkerBrothers', 'Waddington', 'Anthony Pratt', 'Anthony E. Pratt']`, and `exactCase: true`;
    - for that entry, the "nothing else gets through" test uses the exact-case list:
      - caught: `Clue`, `CLUE`, `compare to Clue`, `COMPARE TO CLUE`, `Compare  to Clue`, `xCompare to Clue`, `${phrase}, the Clue company`, `${phrase}-style`, `${phrase}’s` and `Clue Duel`;
      - not caught: `clue`, `clues` and `ClueAction`;
    - extend the exact `ALLOWED_PHRASES` list and `public-build.test.ts:69`.
  - **`tests/catalog.test.ts`:** remove `room-for-doubt` from `SPEC_ONLY`.

- [ ] **Step 5: Run the tests to verify they pass**

  Run `pnpm vitest run --project room-for-doubt --project repo > $SCRATCH/t4.log 2>&1; tail -8 $SCRATCH/t4.log`.
  Expected: PASS: 45 catalog tests plus the board and movement tests; the repo guards are green.

- [ ] **Step 6: Run `pnpm check` and commit**

```bash
pnpm check > $SCRATCH/check-t4.log 2>&1; tail -15 $SCRATCH/check-t4.log
git add packages/games/room-for-doubt tests
git commit -m "Room for Doubt engine: the rules, the catalog C01–C45 and the brand pack (D076)"
```

---

### Task 5: Fuzz target and simulated games

**Files:**
- Create: `tools/fuzz/src/room-for-doubt.ts`
- Modify: `tools/fuzz/src/index.ts` (`TARGETS`), `tools/fuzz/package.json`, `pnpm-lock.yaml`

**Interfaces:**
- **Consumes:** `roomForDoubt`, `CASE_DECK`, `packetOrder`, `RfdState`, and the ids and theme (Task 4).
- **Produces:**
  - `ROOM_FOR_DOUBT_POLICIES: readonly FuzzPolicy<RfdState>[]`, the two policies `detective` and `hasty`
  - `ROOM_FOR_DOUBT_EXPECTED_COVERAGE`
  - `roomForDoubtDeckOrder(deck: DeckSpec, rng: Rng): number[]`
  - the `TARGETS['room-for-doubt']` entry, with `defaultSeatCounts: [3, 4, 5, 6]`

- [ ] **Step 1: Write the policies.** Both read only what the seat may know: its own hand, and the shown cards whose `by` is the seat. In the sim they get a view state, so `null` cards must be skipped.
  - **`detective`:**
    - **Knowledge:** it tracks the cards it has seen.
    - **At start:** it uses a summons to submit. It takes the passage when the pawn is in a corner room and has already submitted in that room before. Otherwise it rolls, or stays when walled in.
    - **Walking:** it picks a room destination it has not submitted in this game. Failing that, it picks the square closest by board distance to the nearest door of such a room.
    - **Submitting:** it names an unseen Party and Exhibit.
    - **Indicting:** at start or answered, when exactly one unseen card of each kind is left, or on its 15th turn with a random unseen card of each kind.
    - **Rebutting:** a random legal answer.
  - **`hasty`:** walks at random, submits at random, and indicts at random on its third turn. This exercises dismissals, second indictments and last standing.
  - **Coverage:** `['move:roll','move:room','submit:entered','submit:summoned','rebut:show','rebut:none','indict:dismissed','indict:again']`.

- [ ] **Step 2: Run the fuzzer.**

  Run `pnpm fuzz --game room-for-doubt --games 2000 > $SCRATCH/fuzz.log 2>&1; tail -20 $SCRATCH/fuzz.log`.
  Expected:
  - 0 failures;
  - every expected tag covered;
  - `end:upheld` and `end:last-standing` both seen.

  A run that does not end is a policy or engine bug (D015): fix the cause, never add a stall rule.

- [ ] **Step 3: Run simulated games over real crypto.**

  Run these three, each to its own log in `$SCRATCH`, and read the tails:
  - `pnpm sim --game room-for-doubt --seats 3 --games 4`
  - `pnpm sim --game room-for-doubt --seats 6 --games 2`
  - `pnpm sim --game room-for-doubt --seats 3 --games 4 --policy hasty`

  Expected:
  - every game ends and its audit is `pass`;
  - the `hasty` run, where every seat indicts on its third turn, ends at least one game by `last-standing` after two indictments.

  This is Review Focus 4 over real sealed shares.

- [ ] **Step 4: Commit**

```bash
pnpm check > $SCRATCH/check-t5.log 2>&1; tail -15 $SCRATCH/check-t5.log
git add tools/fuzz pnpm-lock.yaml
git commit -m "Room for Doubt: fuzz target and policies; simulated games end and pass the audit (D076)"
```

---

### Task 6: Web game screen (not yet registered)

**Files:**
- Move the art: create `packages/games/room-for-doubt/src/art.ts` with `EMBLEMS`, `EXHIBIT_GLYPHS` and `SCENE_GLYPHS`, moved verbatim with the helpers they need. `scripts/room-for-doubt/glyphs.ts` re-exports them and keeps `glyph()`. `tests/room-for-doubt-art.test.ts` must stay green unchanged.
- Modify: `apps/web/package.json` (dependency `@bored-games/room-for-doubt`), `pnpm-lock.yaml`
- Create in `apps/web/src/games/room-for-doubt/`:
  - `model.ts` (pure)
  - `glyph-image.ts`
  - `cards.tsx`
  - `board.tsx`
  - `docket.tsx`
  - `forms.tsx`
  - `game.tsx`
  - `room-for-doubt.css`
- Test: `apps/web/test/room-for-doubt.test.ts`

**Interfaces:**
- **Consumes:**
  - `RfdState`, `RfdAction`, `Place`, `BOARD_ROWS`, `ROOM_RECTS`, `DOORS`, `CORRIDOR`, `ENTRANCES`, `ROTUNDA`, the ids, `ROOM_FOR_DOUBT_THEME` and `art.ts`;
  - `GameViewProps`;
  - `storageKey`, `readJson` and `writeJson` with `useApp().store` and `.profile`.
- **Produces:**
  - `RoomForDoubtGame(props: GameViewProps)`, the root `data-testid="rfd-game"` with attributes `data-stage`, `data-turn`, `data-seq`, `data-pending-seat` and `data-my-seat` (a number, or `spectator`)
  - every control that sends a move has `data-action={JSON.stringify(action)}`: buttons, board targets and card markers
  - the hand is a `<ul class="rfd-hand">`, rendered only for a seat
  - the public record is `<ol class="rfd-record">`
  - the audit line reads `Deck audit passed.` when `props.audit === 'pass'` and `Deck audit failed: <reason>` otherwise; `ClaimTimeout` is used as Right of Way uses it
  - for Task 7: `RoomForDoubtGame` and `ROOM_FOR_DOUBT_SETUP_COPY`

- [ ] **Step 1: Write the failing model tests** in `apps/web/test/room-for-doubt.test.ts`, on engine states from `started(...)` (the helpers are reached by relative import):
  - **`statusText(s, names, me)`** (Review Focus 3 and 5):
    - start: `"Ann's turn: roll the dice or take an action."` (and `"Your turn: …"` for `me`);
    - roll: `'Rolling the dice: waiting for every player’s app to add its share.'`;
    - rebut: `"Waiting for Bob to answer Ann's submission."` (and `"Your answer to Ann's submission: show a card or say you have none."` for Bob);
    - verdict, as the indicter: `'Opening the Verdict: waiting for the other players’ shares.'` until the cards are known; then `'The Verdict is open: announce it.'`;
    - over: `'Ann wins: the indictment is upheld.'` or `'Cleo wins: the last player standing.'`;
    - a 31-character name appears whole, inside `<bdi>` in the component.
  - **`recordLines(s, names)`**: one line per submission and indictment, for example:
    - `'Ann submitted Lucian Faulk with the Gavel in the Courtroom. Bob showed a card.'`
    - `'… Nobody could rebut.'`
    - for the submitter only: `'Bob showed you the Gavel.'`
    - for the shower only: `'You showed Ann the Gavel.'`
    - for any other viewer, the line never names the card (Review Focus 1).
  - **`docketRows(s, me)`**: 21 rows (6 Parties, 6 Exhibits, 9 Scenes). A held card is marked `'held'` in my column, and a card shown to me is marked `'shown'` in the shower's column.
  - **`CardFace`** renders a card's name and an `<img alt="">` whose `src` starts `data:image/svg+xml,`.
  - **`Board`** (hook-free):
    - with `targets` it renders one `[data-action]` per destination, rooms included, each with `role="button"` and an `aria-label` like `'Move to the Courtroom'` or `'Move to H3'`;
    - with `expanded` the root has class `rfd-board-expanded`.

- [ ] **Step 2: Run the tests to verify they fail**

  Run `pnpm vitest run --project web test/room-for-doubt.test.ts`.
  Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the screen.** Patterns to follow are in `apps/web/src/games/right-of-way/` (`game.tsx`, `board.tsx`) and `driftwrights/game.tsx`.
  - **`glyph-image.ts`:** `glyphUri(markup, color)` wraps the markup in `<svg xmlns viewBox="0 0 64 64">` with the art's stroke settings, and returns a data URI.
  - **`board.tsx`:**
    - one SVG, `viewBox="0 0 24 24"`, square units;
    - corridor squares as tiles;
    - rooms as tinted rects with their name and scene glyph;
    - doors as notches;
    - the Rotunda block;
    - numbered Entrances;
    - passage marks;
    - pawns as accent discs with a monogram; pawns in a room are laid out in a row inside its rect;
    - exhibit tokens as small brass squares;
    - destination targets as focusable `role="button"` groups (the Biome ignore comment as in Right of Way), with Enter and Space handling.
    - It sits in `.rfd-board-wrap { overflow: auto }`. An "Enlarge board" / "Fit board" toggle (`aria-pressed`) sets `.rfd-board-expanded { min-width: 720px }`.
  - **`cards.tsx`:** `CardFace` is a framed card with the glyph, the name and the kind.
  - **`docket.tsx`:**
    - auto marks come from `docketRows`;
    - a tap on a cell cycles blank → ✗ → ? → blank;
    - marks persist under `storageKey(profile, \`rfd-docket:${rootId}\`)`;
    - the record list sits below the grid.
  - **`forms.tsx`:**
    - the submission form: Party and Exhibit selects; the Scene is the current room; a Submit button;
    - the indictment form: three selects and a confirm step: "You can indict once. If you are wrong you are out of the running." Then "Indict".

    Both resolve to the listed legal action and send it through `onAct`.
  - **`game.tsx`:**
    - status, deadline, notice and lockedReason; the board with targets on my walk; my hand;
    - the action bar:
      - roll, passage, stay and end turn, from the legal list;
      - the rebuttal panel: the submission and one button per marker, labelled with my card's name;
      - "Announce: upheld" or "Announce: dismissed";
    - the Docket; the players aside (party emblem, monogram, hand size, dismissed);
    - the audit line and `ClaimTimeout`;
    - auto-send of a forced rebuttal (ruling 7), keyed by `view.head.id`.
  - **`room-for-doubt.css`:**
    - palette tokens on `.rfd-game` (RULES §Art direction hex values);
    - `main:has(.rfd-game) { max-width: 1180px }`;
    - a two-column layout that becomes one column under 860 px;
    - buttons at least 44 px high;
    - `:focus-visible` outlines;
    - `prefers-reduced-motion`.
  - **`ROOM_FOR_DOUBT_SETUP_COPY`**:
    - `shuffling: 'Shuffling the case files'`;
    - `dealing: 'Dealing the cards and placing the exhibits…'`;
    - `share: { act: 'send a share of the Verdict', owed: 'a share of the Verdict' }`.

- [ ] **Step 4: Run the tests to verify they pass**

  Run `pnpm vitest run --project web test/room-for-doubt.test.ts && pnpm vitest run --project repo tests/room-for-doubt-art.test.ts`.
  Expected: PASS.

- [ ] **Step 5: Run `pnpm check` and commit**

```bash
pnpm check > $SCRATCH/check-t6.log 2>&1; tail -15 $SCRATCH/check-t6.log
git add packages/games/room-for-doubt/src/art.ts scripts/room-for-doubt/glyphs.ts apps/web pnpm-lock.yaml
git commit -m "Room for Doubt web: board, hand, Docket and the game screen (D076)"
```

---

### Task 7: Web registration, table option and rules page

**Files:**
- Modify: `apps/web/src/net.ts` (`MODULES`, after `driftwrights`), `apps/web/src/games/ids.ts`, `apps/web/src/games/registry.ts`, `apps/web/src/game-names.ts`, `apps/web/src/games/catalog.ts`, `apps/web/src/components/new-table-form.tsx`
- Create: `apps/web/src/games/room-for-doubt/meta.ts`, `apps/web/src/games/room-for-doubt/rules-page.tsx`
- Modify tests:
  - `apps/web/test/prompt-shares.test.ts` (add `'room-for-doubt'`)
  - `apps/web/test/module-contract.test.ts`: the exempt list becomes `['luster','right-of-way','driftwrights','room-for-doubt']`, plus a Room for Doubt branch asserting `privateShow` and `rolls` are functions and `resignSeatCounts(module)` is `[]`
  - `apps/web/test/catalog-model.test.ts` (the hard-coded lists at 55–86)
  - `apps/web/test/compare-render.test.ts` (85–90)
  - `apps/web/test/room-for-doubt.test.ts` (rules page)

**Interfaces:**
- **Consumes:** `RoomForDoubtGame` and `ROOM_FOR_DOUBT_SETUP_COPY` (Task 6); `roomForDoubt`, `validateRules`, `DEFAULT_RULES`, the catalog and the brand (Task 4).
- **Produces:**
  - `ROOM_FOR_DOUBT_META`
  - `RoomForDoubtRulesPage`, `RoomForDoubtRulesContent` (hook-free) and `ROOM_FOR_DOUBT_RULES_SECTIONS`, whose ids are `goal`, `setup`, `turn`, `rebut`, `indict`, `end`, `board` and `online`
  - the "New table" option "Submissions on entering a room" with the choices "Optional" and "Required"

- [ ] **Step 1: Write the failing tests:**
  - **`room-for-doubt.test.ts`:**
    - `it('renders the rules from the engine’s numbers')`: the text of `RoomForDoubtRulesContent` contains `'21 cards'`, `'3 to 6 players'`, `'6, 6, 6'` and `'Old Gaol Passage'`, and has one `h2` per section id.
    - `it('offers the submit option and validates it')`: `validateRules({submit:'required'})` is ok, and `validateRules({submit:'sometimes'})` and `validateRules({})` are refused.
  - **The updated web tests listed in Files:** each must fail before the registration, for example `registry.test.ts` and the new exempt list.

- [ ] **Step 2: Run the tests to verify they fail**

  Run `pnpm vitest run --project web > $SCRATCH/t7-red.log 2>&1; tail -20 $SCRATCH/t7-red.log`.
  Expected: FAIL in the edited tests only.

- [ ] **Step 3: Register the game and write the rules page.**
  - Use the Right of Way entries as templates, including `setupCopy: () => ROOM_FOR_DOUBT_SETUP_COPY`.
  - The rules page follows `right-of-way/rules-page.tsx`: it imports `../chain-reaction/rules.css`, has a table of contents, and every section after RULES.md.
  - **"Playing on this site"** explains:
    - the automatic steps: dice shares, Verdict shares, sealed shares and forced rebuttals;
    - that only the submitter sees a shown card;
    - the Docket;
    - Enlarge board;
    - that Resign is not offered.
  - The new-table branch follows Driftwrights' (`windfall`): `rules: { submit }`.

- [ ] **Step 4: Run the tests to verify they pass.** `pnpm vitest run --project web`. Expected: PASS.

- [ ] **Step 5: Run `pnpm check` and commit**

```bash
pnpm check > $SCRATCH/check-t7.log 2>&1; tail -15 $SCRATCH/check-t7.log
git add apps/web
git commit -m "Room for Doubt web: registered with its rules page and the submission option (D076)"
```

---

### Task 8: End-to-end spec

**Files:**
- Create: `apps/web/e2e/room-for-doubt.spec.ts`

**Interfaces:**
- **Consumes:** the DOM hooks of Task 6, and the lobby flow of `apps/web/e2e/right-of-way.spec.ts` (its helpers `url`, `open` and `mobile`, copied).

- [ ] **Step 1: Write the spec**, `test('three players play Room for Doubt to the end')`, with `test.setTimeout(30 * 60_000)`. It collects `pageerror` events and asserts none at the end.
  1. **Set up the table.** Three player contexts (profiles `rfd-a`, `rfd-b`, `rfd-c`) and a spectator (`rfd-s`). The creator creates a 3-player table and the other two join; then start. Wait up to 600 s for `rfd-game` on every page.
  2. **Mobile check** (`mobile(page, 'start')`, 390 px, no side scroll).
  3. **The turn loop.** Find the acting page through `data-pending-seat` and `data-my-seat`. Choose the first enabled `[data-action]` in this preference order:
     1. a room move;
     2. a show marker;
     3. `none`;
     4. a submit (the submission form's default party and exhibit);
     5. `roll`;
     6. any `move`;
     7. `endTurn`;
     8. a `verdict`.

     Seat 0 indicts at its third turn start through the indictment form, and seat 1 at its third. Poll `data-seq` until it grows on every page and the spectator's. A forced rebuttal goes out by itself (ruling 7), so when the pending seat offers no enabled control, wait for `data-seq` to grow rather than failing.
  4. **Privacy** (Review Focus 1). After the first `show`, the submitter's record holds `showed you the`, and the shower's holds `You showed`. The third page's record never holds the card's name, and the spectator page has no `.rfd-hand`.
  5. **Reload.** At the 10th action, reload one page; its `data-seq` returns to the same value. Then `mobile(page, 'mid')`.
  6. **The end.** Every page shows `Deck audit passed.` and `Result confirmed: signed by all 3 players.` The winner is the last player standing, or the indicter if an indictment was upheld. Then run `mobile(page, 'end')`.
  7. **Rules page.** Open `#/rules/room-for-doubt/online`; the heading "Playing on this site" is visible. Run `mobile(page, 'rules')`.

- [ ] **Step 2: Run it**

  Run `E2E_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) pnpm e2e room-for-doubt.spec.ts > $SCRATCH/e2e.log 2>&1; tail -30 $SCRATCH/e2e.log`.
  Expected: 1 passed. On failure, read the trace under `apps/web/test-results/`, fix the cause in the owning task's code, and rerun.

- [ ] **Step 3: Run the other e2e specs once** (`pnpm e2e` with the same `E2E_CHROMIUM`). Expected: all pass. Tasks 1 and 2 changed the session every game uses.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/room-for-doubt.spec.ts
git commit -m "Room for Doubt: end-to-end spec with three players, privacy and mobile checks (D076)"
```

---

### Task 9: Docs and records

**Files:**
- Modify: `docs/games/room-for-doubt/RULES.md`, `tests/room-for-doubt-docs.test.ts`, `docs/DECISIONS.md` (D076), `docs/PLAN.md`, `CLAUDE.md`, `docs/PROTOCOL.md` (§6.3a, §10, §13)

- [ ] **Step 1: Update the docs test first.** Then watch it fail on the current RULES.md.
  - `it('records the build as beta (D076)')`: the status line matches `/^\*\*Status: beta \(D076\)\.\*\*/m`.
  - `it('says how the hidden information stays exact')`: the rules name "second shuffle round" with D074 and "private show" with D075, and no longer contain "Where the platform cannot be exact yet".
  - `it('has no attend action')`: the rules contain no `` `attend` ``.
  - The other existing assertions stay. The path A line, P4, C19, §6.3a, §13 and D071 are kept in the text.

- [ ] **Step 2: Rewrite RULES.md "as built":**
  - **Status:** beta (D076), naming the package, the web game, the fuzz target and the e2e spec.
  - **"What is hidden":** rows for the second round and the private show.
  - **"Resolving an indictment":** prompt shares and the seal, with no `attend`.
  - **Actions:** the list as built.
  - **Gaps:** the gaps section is replaced by "How the platform keeps it exact".
  - **Build paths:** path A is built, with both gaps closed (keep the path A paragraph, adding "Built (D076)").
  - **Dice and pace:** `ahead` is not built.
  - **C34:** "only once every other seat's share of it has arrived".
  - **"Online play on this site"**, with every ruling of "How this build refines RULES.md".

- [ ] **Step 3: Write the records:**
  - **D076, "Room for Doubt built as a beta, with exact hidden information":** the deck, D074, D075, prompt shares (D073), no `attend`, `live` dice, the `submit` option, Resign disabled, BGG 1294 confirmed, the e2e spec, and the rulings above.
  - **PLAN.md:** Room for Doubt becomes beta.
  - **CLAUDE.md:**
    - line 3: add Room for Doubt (D076) to the Compare exceptions;
    - the `pnpm test` project list;
    - the fuzz games list with "Room for Doubt's 3–6";
    - the e2e list;
    - the repo map entry for `packages/games/room-for-doubt/`;
    - "Hanabi is spec only";
    - "Adding a game": bullets for `secondRound` (D074) and `privateShow` (D075).
  - **PROTOCOL:**
    - §13 retitled "Deck plus dice (D069, D070, D076)", and worded for any module with a deck and rolls; the Driftwrights supply paragraphs stay as its example;
    - §6.3a's "v1 does not have one" sentence points to §13;
    - §10 allows deck plus dice.

- [ ] **Step 4: Run the docs test and `pnpm check`, then commit**

```bash
pnpm vitest run --project repo tests/room-for-doubt-docs.test.ts
pnpm check > $SCRATCH/check-t9.log 2>&1; tail -15 $SCRATCH/check-t9.log
git add docs CLAUDE.md tests/room-for-doubt-docs.test.ts
git commit -m "Room for Doubt: rules as built, decision D076, plan, protocol and CLAUDE.md"
```

---

### Task 10: Verify, review and ship

- [ ] **Step 1: Run the full verification:**
  - `pnpm check`;
  - `pnpm fuzz --games 2000` for each game whose fold Tasks 1–2 touched (`chain-reaction`, `luster`, `right-of-way`, `driftwrights`, `room-for-doubt`);
  - `pnpm sim --game room-for-doubt`;
  - the full `pnpm e2e`.

  Every log goes to `$SCRATCH`, and only the tails are read.
  Expected: everything passes.

- [ ] **Step 2: Final whole-branch review** on the most capable model, per the execution skill. Check each Review Focus line deliberately, then fix the Critical and Important findings test-first.

- [ ] **Step 3: Ship.**
  - Merge `origin/main` if it moved: resolve the conflicts, renumber the decisions if needed, rerun `pnpm check`.
  - Push with `git push -u origin claude/ecstatic-faraday-80wa85`.
  - Update PR #40's title and body for the build, and take it out of draft.
  - Watch CI to green.
