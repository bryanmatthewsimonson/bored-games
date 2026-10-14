# Setup without a relay race: shuffle in any order, from any page (design)

**Date:** 2026-10-14. **Status:** approved by the owner on 2026-10-14 ("Approved, 45s is fine, cancel with no flags"). The implementation plan follows from it.

**Scope:** (A) a protocol change that lets the seats take their setup shuffle steps in any order, opted into by new game roots, and (B) a web-app change that does a seat's setup work (its shuffle and its deal) from any open page of the app, not only that game's page. Play-phase reshuffles (epochs) keep seat order.

## 1. The problem and what success looks like

The owner reported games stuck in setup: *"The shuffling doesn't happen until the game is started leaving some games stranded when the game is not open at the same time across all players' clients."* A 6-player Chain Reaction game showed "Shuffling the deck: 1 of 6 players done. Waiting for Huy … to shuffle. Their app must be open on this game." It was the second such game.

Two causes:
1. **Setup is a relay race in seat order.** Step `s` must be signed by seat `s` (PROTOCOL §5.2, §5.5), so seat 2 can do nothing until seat 1 has shuffled. Six people must open the game one after another, in order. Anyone who opens it early can do nothing, and must come back.
2. **Only the game's page does the work.** A seat's shuffle and deal run in the `GameController` of `screens/game.tsx`. Home never runs one, so a player who opens the app on Home does not help.

One limit can't be removed: with no trusted dealer, every seat must add its own secret shuffle (§11, "Hidden cards"), so every player must have the app open at least once after the start.

**Done when:**
1. In a new game, each seat's app shuffles as soon as it is open, on whatever deck is current. No seat waits for a particular other seat, except while a seat finishes a multi-group block it has started (§3.1).
2. A player whose app is open on any page (Home, a table, another game) does their shuffle and deal for every game in setup where their seat is due. They don't need to open that game.
3. When everyone is online, setup takes about as long as today and goes in seat order. A seat that is away is skipped after a short wait, not waited for.
4. Games started before the change finish under the current rules.
5. `pnpm check`, the sims (including a new racing adversary) and the e2e specs pass. A new e2e spec shows a 4-player game whose seat 1 is away at the start completing setup once seat 1 opens Home.

## 2. Decisions

| Decision | Choice | Set aside |
|---|---|---|
| Who may sign the next step | any seat that has not taken its block in the current round, or the seat finishing its own block | a fixed order with "skips"; parallel shuffles (they cannot compose) |
| Unit of work | a **block**: one seat's steps for every group of a round, in group order, back to back | interleaving seats per group (the step's group would no longer follow from its `seq`) |
| Opt-in | a root tag `["shuffle-order","any"]` written by every new root | a `proto` bump (`proto` 2 is taken by the abandoned v2, D071); a rules option (it is not a game rule) |
| Race avoidance | a client-side stagger: the lowest-numbered waiting seat goes at once, the others wait 45 s per rank | consensus rules based on time (`created_at` proves nothing, §11) |
| Races that happen anyway | ordinary fork choice: longer branch, then lowest id; the loser shuffles again on the winner | claim events before shuffling (one more event kind for little gain) |
| The deal | still once per seat (D056 F7). A client waits 15 s before dealing when it holds a rival branch. A deal split by an honest race cancels the game with no forfeits (owner) | dealing again after a switch (unsafe, §4.3); flagging the seats that dealt on the losing deck |
| Background work | a page-wide **setup runner** that keeps up to 3 setup-only `GameController`s alive | a Web Worker (no worker infrastructure yet; can come later for cost) |
| Play-phase epochs | unchanged: seat order | any order there too (later, if games stall mid-play) |

## 3. Protocol (A)

### 3.1 Step order in an any-order game

A game is **any-order** when its root carries the tag `["shuffle-order","any"]` (exactly once; any other value, or a repeat, makes the root invalid). Without the tag, every rule stays as today.

The rounds, groups and step count are unchanged (§5.5): `N = (G1 + G2)·S`, steps `s < G1·S` are round 1 and shuffle group `s mod G1`, and the rest are round 2 and shuffle second-round group `(s − G1·S) mod G2`. So a step's round, group, input positions and output size still follow from its `seq` alone. **Only the signer changes.** A step at `seq = s+1` on a chain whose first `s` steps are known is valid only if its signer is:
- **mid-block** (`s` is not a multiple of the round's group count): the signer of step `s − 1`, finishing its block;
- **at a block boundary:** any seat with no block yet in the current round on that chain.

Round 2 starts only after every seat has a round-1 block, as now (`seq` forces it). Each seat therefore shuffles every group exactly once per round, as in fixed order. Only the order of the seats' blocks within each round varies.

### 3.2 The proof binds the signer

The proof context (§5.3) already binds `k`, "the shuffling seat's 0-based index", and no step index. In an any-order game `k` is the signer's seat. For fixed-order games that is the same value as today, so old games verify unchanged and the test vectors stand. The input of step `s` is still the current packet's slice at that step's positions.

### 3.3 Validity, equivocation and candidates

- **Shape** (judged without the chain, `moveShape`): a shuffle step needs `type: "shuffle"`, a seated signer, and an output of its step's group size. The signer check moves to linking time (`foldMove`, `judgeAtPrev`), where the prefix is known.
- **Equivocation is unchanged:** two well-formed steps by one seat on one prev. Well-formed now also requires the signer to be eligible at that prev (§3.1), which is known once the prev links. An honest seat signs one step per prev. A seat that lost a race signs again on a *different* prev, which is not equivocation, because the candidate key is still `prev:seq:signer`.
- **Candidates and acknowledgements:** unchanged. There are at most 3 unacknowledged steps per `prev:seq:signer`, so per prev at most 3·S candidates are verified.

### 3.4 Honest races and fork choice

Two eligible seats can sign on the same prev, which today only an equivocator can cause. Fork choice is unchanged (§6.6): settled or over first, then length, then over, then the lowest successor id. In the shuffle phase no branch is over. A branch is settled once every seat other than its first signer has signed on it since the fork, which can happen when a race at the root is followed by everyone else's blocks. Otherwise the longer branch wins, then the lower id. Every rank is a function of the events held, so clients that hold the same events agree. The race loser's client sees the winner, discards its own step (the web client's outbox verdict already says "the game went another way") and, still eligible, shuffles again on the new head. Nobody is flagged. §6.6's sentence "every fork is a same-seat equivocation" gets an exception for honest shuffle races in any-order games.

### 3.5 Who is stalled

- **Mid-block:** the block's signer, as today.
- **At a block boundary:** every seat with no block yet in this round. A timeout then forfeits all of them and cancels the game (before its first action, §8.2). Any chain move restarts the deadline for all of them (§8.1).
- **At the root nobody has shuffled, so every seat is stalled and nobody can claim.** A game that no one ever opens simply sits, as a table that never fills does. The creator's app shuffles when it starts the game, so in practice step 1 lands at once.
- **The deal:** unchanged (§8.1). That includes D056's rule that a held fork stalls the shuffle equivocators. An honest race flags nobody, so it never triggers that rule.
- **A split deal (owner's decision):** the case where, in an any-order game, no shuffle equivocator is held and some seat's held deal fails against the canonical final deck. That seat dealt on a rival deck and can never deal again. Stall attribution is unchanged: the seats missing deal shares on the canonical deck. But a timeout accepted while the deal is split **cancels the game with no seat forfeiting**: no flags, no result, no rating change. The cancellation is a function of the events the client holds when it accepts the claim, as every timeout is (§8.1). Fixed-order games keep today's rule.

### 3.6 The deal after a race

A seat still deals once (D056 F7, §4.3 below). A seat that dealt on a final deck that later loses fork choice can't deal again, so the game stalls on it, and a timeout then cancels it with no forfeits (§3.5).

Two complete rival decks need a race at a block boundary, plus a delivery delay that lets the remaining seats finish both branches. To make that rarer, a client that holds any rival shuffle step at a prev of its chain waits **15 s** after the chain completes before dealing, then deals only if that chain is still canonical. A client that holds no rival deals at once, as today, so a normal setup is no slower.

## 4. Security

1. **Hidden cards:** unchanged. Every seat still adds one secret permutation per group per round, and the final deck is their composition, in any order.
2. **Proof replay:** each proof binds the root, the signer's seat, the group's domain and both full decks (§5.3). It can't be reused at another prev, because its input would differ.
3. **Why the deal stays once per seat.** Two complete rival decks that share a prefix up to a fork P are related by the permutations of the seats that shuffled after P on both branches. In an any-order game a coalition of exactly those seats can build both branches *without equivocating*. If an honest seat that shuffled before P dealt on both decks, the coalition could translate its shares between them and read hands, as in F7. So "a seat deals once" must hold whatever caused the fork. Without it a coalition of fewer than all-but-one seats would break hidden cards.
4. **Griefing:**
   - A seat can race on purpose. That costs its own CPU and the others one extra shuffle each. A race loser is never flagged.
   - A coalition can deliberately finish two complete decks and split the honest deals, which cancels the game before its first action. It could already cancel by stalling (D056 "Griefing"), so this adds no new power.
   - A seat that signs many steps on many prevs is bounded by the candidate rule (§3.3), at 3 per prev.
5. **Denial of service:** unchanged bounds. Per prev, the verified candidates go from at most 3 to at most 3·S.

**Residuals (document in PROTOCOL §11):**
- In the rare case where honest seats deal on two complete decks, the game is cancelled by timeout with no forfeits (§3.5).
- **An unblamed cancel.** A coalition made up of every seat that shuffles after some fork can build two complete decks on purpose and split the honest deals. That cancels the game with no one blamed. It could already cancel the game by stalling or resigning, at the cost of the blame; this way costs it nothing. It follows from the owner's choice to cancel a split deal with no flags, which spares honest seats.
- A client that has not reloaded since this change ignores the root tag, so it folds an any-order game in seat order. It rejects out-of-order steps and shows the game stuck until its tab reloads. Its stray timeout claims name an old head, so other clients reject them (§8.1).

## 5. Client behaviour

### 5.1 Session (`packages/client`)

- Parse the tag into `ParsedRoot.shuffleOrder: 'seat' | 'any'`. `rootTemplate` writes `any` for every new root. The sim writes it too, and has a flag to test `seat`.
- `shuffleSchedule` keeps rounds and groups. A new function gives the eligible signers at a prefix (block continuation, or seats with no block in the round). It replaces every read of `step.seat`:
  - `moveShape` (the check moves into `foldMove` and `judgeAtPrev`)
  - `foldMove`
  - `shuffleCtx` (`k` = the actual signer)
  - `nextShuffler` (it becomes `shufflersDue`, a list)
  - `progressOfShuffle`
- `duties()` gives every eligible seat a `{kind:'shuffle', rank}` duty. `rank` is the seat's place among the eligible seats in seat order, and 0 means "go now".
- `stalled()`, `waitingFor()` and `pending()` follow §3.5. `shuffleProgress` reports how many seats have finished a block in the current round, and the round. Today it reports "the seat of the next step".

### 5.2 The web controller

- **Stagger.** A `shuffle` duty with rank `r > 0` waits until the head has been held unchanged for `r × 45 s`, measured from the head's persisted first-seen time. So a reload doesn't reset the wait, and a new head resets it for everyone.
- **Deal settle** (§3.6): the deal waits 15 s while a rival is held.
- **The deal race between two controllers of one profile:** before building a deal, re-read the stored outbox (as `#reusable` already does for moves) and adopt a deal another controller saved. Today the second controller builds, `#commit` refuses it, and the game shows "Stuck". The deal is still never sent twice; the change only removes the false "stuck".

### 5.3 The setup runner (B)

A page-wide service, `setupRunnerFor(deps)` (the `WeakMap<ControllerDeps, …>` singleton used by `lobbyFor`), started in `main.tsx` after the first render, so it survives every route change.

- **Candidates:** `LobbyController.myTables` entries that meet all of these:
  - they have a root where this profile's key holds a seat, or its saved game keys hold one (`seatForGameKeys`);
  - this browser has the seat's game keys, so no restore prompt is needed;
  - their cached status is not `done` or `cancelled`;
  - their cached `phase`, a new `GameStatusCache` field, is missing or `setup`.
- **Work:** up to 3 controllers at once, oldest game first, each `new GameController(rootId, deps, { mode: 'setup' })`. Setup mode:
  - runs only the `shuffle` and `deal` duties;
  - never restores keys, attests, backs up keys or makes an automatic move, so it never prompts with NIP-07;
  - writes the status cache with `phase`.
- **Hand-off:** `GameScreen` registers its root id in a page-wide set. The runner disposes its controller for a game whose page is open, and takes the game back when the page closes, if setup isn't done.
- **Done:** dispose when the session leaves setup, or when this seat's blocks in every round are on the canonical chain and its deal is published.
- **Home:** the runner exposes a signal of status lines per root, which Home's table list shows in place of the cached detail:
  - "Shuffling your part…"
  - "Dealing…"
  - "Waiting for Huy and Ann to shuffle"
- **Cost:** a runner controller verifies every shuffle proof on load, as the game page does. That is acceptable for a few games in setup. A Web Worker can come later.

### 5.4 Copy

- The game screen and Home say "Waiting for Huy and Ann to shuffle. Each needs to open the app once; the order doesn't matter." in place of "Their app must be open on this game." That wording stays for fixed-order games and play-phase reveals.
- TESTING.md, the rules pages' setup paragraph if it names the order, and the "Every player's window must be open on the game" line are updated.

## 6. Testing

- **`packages/client`:**
  - any-order eligibility at block boundaries and mid-block, with partitions and a second round (Luster, Room for Doubt shapes);
  - `k` = the signer;
  - a step by an ineligible seat is refused;
  - an honest race resolves by length, then id, and flags no one;
  - the loser re-shuffles;
  - two steps by one seat on one prev still flag it;
  - the stalled set at a boundary;
  - a timeout forfeits every remaining seat;
  - the 15 s deal settle;
  - the honest double-complete deal: a timeout cancels it with no forfeits, while a held equivocation still blames the equivocator;
  - roots without the tag fold exactly as before. The existing fixed-order tests stay, pinned to `shuffle-order` absent.
- **Sim:**
  - `pnpm sim --game <id>` for every deck game in any-order mode;
  - a new `race` adversary that makes every eligible seat shuffle at once on the same head;
  - `--vanish-at` for a seat that is away during setup and returns.
- **Protocol model** (`tools/protocol-model`): its setup steps allow any eligible seat.
- **Web:**
  - the stagger and settle timings, with injected timers;
  - setup mode does no restore, attest or backup;
  - the runner hand-off to and from the game page;
  - two controllers on one storage do not both deal;
  - Home's runner line.
- **e2e:** a new spec. Four players; seat 1's browser stays on Home with its tab closed at the start. Seats 0, 2 and 3 shuffle; then seat 1 opens Home, its runner shuffles and deals, and every player reaches the play screen. Seats 2 and 3 never open the game page before play.

## 7. Documents

- PROTOCOL §4.3 (the tag), §4.4, §5.2, §5.3 (`k` = signer), §5.5, §6.1, §6.6 (races), §8.1 (stalls), §11 (races, the deal residual, stale clients) and §12.
- DECISIONS D093. PLAN status and the open question on Join binding. TESTING.
- CLAUDE.md: the e2e list.

## 8. Out of scope

- **Play-phase reshuffles (epochs, D073):** still in seat order.
- **Notifications** (NIP-17, Phase 5): needed for players whose app is closed entirely.
- **A deployed-version check** that reloads stale tabs (D056 follow-up): it would remove the stale-client residual.
- **A Web Worker** for proof verification.
- **Running other owed duties from the background** (play-phase reveals, dice): this runner runs setup duties only.

## 9. The owner's decisions (2026-10-14)

1. **The stagger stays at 45 s per rank.**
2. **A split deal cancels with no flags** (§3.5): no seat forfeits when the timeout comes while the deal is split.
