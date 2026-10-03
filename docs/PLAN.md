# Plan

## Open questions for the owner

1. ~~**UI framework for apps/web.**~~ Answered by controller ruling D031 during the owner-authorized overnight run: Preact + Signals + Vite (D014 option B). The owner may revisit.
2. ~~**Abandonment and timeouts.**~~ Decided (D020): the creator picks a 1-, 3- or 7-day deadline, and the abandoner forfeits. D030 measures deadlines on each client's clock.
3. ~~**Shuffle proofs.**~~ Decided (D019): zero-knowledge Wikström shuffle proofs from day one.
4. **Chain Reaction 2-player rules** remain OPEN, so 3–6 players only for now. Should 2-player be supported, and with which variant?
5. ~~**Second game** (Phase 6).~~ Answered by the multi-game plan (2026-10-02): Chess. Its engine is done (D047) and the platform hosts it (D045); the full Chess UI is done (Phase D2, D048).
6. **Final names.** The first game is now named **Chain Reaction** (owner, 2026-10-01). The platform name ("Bored Games") and the chain names (Jade, Lapis, Onyx, Quartz, Ruby, Sapphire, Topaz) are still placeholders. Other games already use the name "Chain Reaction"; a trademark check belongs to Phase 7.
7. **Relay URL.** Answered: the default relay is `wss://relay.primal.net` for everybody (D038), which accepted 36 and 60 KB events in a probe. An owner-run nostr-rs-relay stays optional.
8. **Ratings scope.** Are global leaderboards wanted? Global boards mean someone runs an untrusted cache. The alternative is that each client computes ratings over the games it can see, optionally web-of-trust weighted.
9. **Protocol review.** `docs/PROTOCOL.md`, now with the session rulings (D030), awaits your review before anything is published under version 1. Its open points:
   - What counts as timeout progress was ruled overnight (D030, Ruling 11): only events that change who is stalled.
   - The claim race (§11) is accepted as a residual risk.
   - Clients ignore the table's `status` when validating a root (§4.3).
   - **Join binding of `deadline` and `seats` (D036).** The Table is addressable, so its creator can republish it after the start. Clients now save the Table they validated, but a fresh client that only sees a republished version cannot load the game. Binding `deadline` and `seats` into the Join, so the root validates without the mutable Table, needs a protocol change.
   - **Rival shuffle steps (D030, Ruling 12).** The arrival-order split in the old rival-shuffle cap is fixed: two well-formed steps by one seat on a chain prev flag it without proofs, and past 3 steps per prev only steps another seat acknowledged are fork-choice candidates. Owner to confirm the residuals: colluders can acknowledge junk, and the last shuffler can withdraw its step (stalling and flagging itself) until another seat moves.
   - **Shared GitHub Pages origin (D036).** A project site at `<owner>.github.io/<repo>` shares `localStorage`, and with it the keys, with the owner's other Pages sites. Choose a dedicated origin (a custom domain, or a Pages user or organization site for this app only) before sharing widely.

10. ~~**Prompt shares and tile exposure (D039).**~~ Answered: the owner rejected the residual risk, and D039 was reverted. A future fast reveal must be cheat-proof (D042); the candidate "acknowledge, then share" design is in `docs/proposals/fast-reveal.md`. It is not yet cheat-proof: the review found a late-Ack attack, the recommended "ack implies lock" amendment leaves honest splits open, and it needs an adversarial review before anyone builds it. **Owner (2026-10-02):** *"Agreed: Before building, we will need to make it cheat-proof"*, and no prompt shares anywhere until then, co-op games included (D050). Phase K designs the cheat-proof prompt-reveal protocol (research only).
11. ~~**Resign beyond 2-seat games without a deck (D045, PROTOCOL §8.3).**~~ Answered (owner, 2026-10-02) and built (Phase G, D052): with 3 or more players a Resign ends the game for everyone, ranked as if it ended now with the resigner last; the result is unrated and records who ended it. In deck games the Resign carries the resigner's deck secret, the others publish theirs, and a partial audit checks every action up to the resign.
12. ~~**Game systems (`docs/GAME-SYSTEMS.md` §7).**~~ Answered (owner, 2026-10-02, D049–D051): Hanabi is the next game (public name "Hanabi"; spec first, build blocked on Phase K); no prompt duties anywhere until Phase K passes adversarial review (D050); asynchronous play first, live play later; games with no hidden claims never reveal folded or unplayed private cards unless the player chooses to show them (a per-game reveal policy); retiring seats may reveal their cards, per game; solo play stays verifiable with no third parties; Dominion, One Night Ultimate Werewolf and Secret Hitler are in scope, real-time games later, and variants that need human judgement later, if ever; shared pure libraries are welcome (D051).
13. ~~**Smaller items (2026-10-02).**~~ Answered: the licensed pack may stay visible in the public repository for now (D046); FIDE 6.9 stays OPEN in Chess (approved, D047); the catalog's time buckets and complexity cutoffs stay; the public site shows "Compare to" the original title with a BoardGameGeek link, as store brands do, and with the original names switched on (licensed builds) the original looks come too (D053).

## Status

| Phase | State |
|---|---|
| 0. Platform docs and scaffolding | **Done** |
| 1. Game kit plus Chain Reaction engine | **Done, at the checkpoint** |
| 2. Decentralized protocol | **2a spec written** (`docs/PROTOCOL.md`, with the session rulings), awaiting owner review (open question 9); **2b done** (`packages/deck`); **2c done** (`packages/protocol`); **2d done** (`packages/client`: the session engine, the lobby fold, the memory relay and async simulations; rulings D030); **2e done** for relay transport (`packages/relay` pool, `tools/dev-relay`); the NIP-78 secret backup and the smoke test against the owner's relay are still open |
| 3. Web shell plus Chain Reaction UI | **Playable end to end** (Preact + Signals, D031): identity and settings, Home, Table and Game screens, lobby and game controllers (D034), the end-to-end browser test (`pnpm e2e`), CI, and GitHub Pages deployment. Final polish (D035): the game log, confirmed timeout claims, profile names, and `?relays=` limited to local relays. The owner's guide is `docs/TESTING.md`. Remaining: NIP-46 login, a live "your turn" inbox, and the offline PWA shell |
| 4. Records | Not started |
| 5. Social | Not started |
| 6. Second game | **Chess playable end to end** with the full Chess UI (D045, D047, D048); **the catalog and brand packs are built** (Phase E, D046) |
| 7. Polish | Not started |

**Next (owner's answers, round 2, 2026-10-02, D049–D051):**
- **Phase K: a cheat-proof prompt-reveal protocol and sealed shares** (research and design, no gameplay code): threat model, every source of reorganisation, candidate designs (including the proposal that proven equivocation ends the game, unrated, cheater recorded), an executable model of event orderings, a reference `sealed.ts` in `packages/deck` that no game uses, and adversarial review rounds. Until K passes review there are no prompt duties anywhere (D050).
- **Phase J0: the Hanabi rules spec** (`docs/games/hanabi/RULES.md`), public name "Hanabi". No engine or UI until K is resolved and the owner approves.

**v1 safety fixes (phase v1safe, 2026-10-03, D056):** two fixes to the shipped protocol v1, no format change. **F7:** a seat deals at most once per game (the session owes no deal once it holds its own deal on a rival deck; the web client never rebuilds a deal a relay confirmed and republishes the deck it dealt on), and during the deal a held shuffle fork makes the shuffle equivocator the stalled seat, so the game is cancelled with only the equivocator forfeiting; an equivocating last shuffler can no longer translate honest shares between rival decks to read hands. **Stale outbox:** a saved move, deal or Resign that no relay confirmed is republished only after the relays have answered, and only if it still fits (a move on the current head with no other move of the seat on its parent, no other deal or Resign of the seat); otherwise it is discarded and logged, and an open tab that folded it in rebuilds its session. Investigated and documented (PROTOCOL §11, "A stale rival"): a late rival from the same seat flags it and changes a finished game's attested result, and one that ends the game reorganizes a game still in play back to that old position. Verified 2026-10-03: `pnpm check` passes (1498 tests in 91 files, 12 skipped); `pnpm test:sim` passes its 19 tests (about 15 minutes); `pnpm e2e` passes all three specs (about 2.3 minutes). **Fix round (review CHANGES NEEDED):** a deal this seat signed is never discarded or rebuilt, sent or not (I1); saved events are vetted only once every relay has answered every page, and held while the session is visibly behind (I2); a saved move waits while its parent is not held, and a saved Resign need not name the head (I3); "Sync notes" on the game screen; the deal waits for its deck echo. **Consensus change (PROTOCOL §6.6):** an ending side branch no longer beats a longer live chain that every other seat has played on since the fork ("settled"), unless a seat other than the forker has revealed its deck secret (the freeze); this ends the unbounded late-ending rewind (rated kingmaking), with coalition residuals in D056. Verified after the fix round: `pnpm check` passes (1505 tests in 91 files, 12 skipped), `pnpm test:sim` 19/19, `pnpm e2e` 3/3.

**"Compare to" and the original looks (Phases H and I, 2026-10-02, D053):** catalog entries gain `compareTo {title, bggId}`. The public site shows Chess's BoardGameGeek link, and for Chain Reaction "Compare to" the published game it implements, linked to its BoardGameGeek page (id 5) with a not-affiliated note, on the game page and the catalog card; catalog search matches that title. The trademark guard allows exactly that phrase (`ALLOWED_PHRASES`, cut out before every scan), stored as one literal in `packages/games/chain-reaction/src/compare.ts`; the bare title, other cases, other words and every company name still fail. In licensed builds the original pack brings the original hotel colors and initials over the safe patterns (`ChainReactionBrand.looks`), and the guard collects only the pack's names and text. Verified 2026-10-02: `pnpm check` passes (1446 tests in 86 files, 7 skipped, about 9.5 minutes on a shared machine, after the review fixes), the public build holds the phrase and no other restricted name, and `pnpm e2e` passes all three specs (about 1.7 minutes).

**Resign in every game (Phase G, 2026-10-02, D052):** any seat of any game may resign. With 3 or more seats the game ends for everyone, ranked by `standings` with the resigner last, and the outcome carries `unrated: true` and `endedBy` (attested; absent everywhere else, so other attestations are byte-identical, pinned for Chess). In a game with a deck the Resign carries the resigner's deck secret (`{"secret":…,"type":"resign"}`, checked `x·G = X_k`); the others owe their secrets, a withheld one is claimed as at the end, and `auditPrefix` replays the log up to the resign with no outcome comparison. A Resign naming a head before the first game action, by a seat with no action held, cancels the game (the other seats still publish their secrets, harmlessly). Resign is refused in 2-seat deck games and where the module opts out. After a counted Resign the fold goes on (so an equivocation that moves the chain off the named head converges, Phase K finding F8), and the result is scored at a bounded scoring position: just after the resigner's last action plus the next seat's raced turn; a game over there keeps its rules result. The resigner is strictly last, and a client that counts a Resign republishes it. The web app shows Resign in every game, the 3+ seat confirm text and "Ended early: <name> resigned · unrated", and Chain Reaction's results table after any early end. Verified 2026-10-02 after the second review fix round: `pnpm check` passes (1465 tests in 87 files, 12 skipped); `pnpm test:sim` passes its 19 tests (about 11 minutes); `pnpm e2e` passes all three specs (about 1.3 minutes), the Chain Reaction one ending with a resign; `pnpm sim --game chain-reaction --full-sync --policy quick` with a resigning seat (seats 0–2 at their first decision, which cancels some games, and at chain lengths 12 and 30; 20 games, 3–6 seats), and `pnpm sim --game chess --adversary resign --full-sync` (8 games) are all ok.

**Catalog and brand packs (Phase E, 2026-10-02, D046):** each game package exports a pure `catalog.ts` entry (types and vocabularies in game-kit), checked against its module for every registered game. Home is Your games, the Game catalog (search, player-count chips, genre, mode, length and complexity filters, a live result count) and the open tables of every game; each game has a page `#/games/<id>` with its summary, facts, How to play, the New table form (moved off Home) and its own tables. Chain Reaction's theme is a parameter of every model function and component. Brand packs: the trademark-safe one in `src/theme.ts` and the licensed original names in `packages/games/chain-reaction/licensed/`, loaded only by builds made with `VITE_LICENSED_BRANDS=1`; Settings → Game names switches between them per profile, live. The repo guard exempts only `licensed/`, and a public build scan in `pnpm check` proves `apps/web/dist` holds no restricted name. **Owner:** the original names stay off the public site until they are licensed. Verified 2026-10-02: `pnpm check` passes (1404 tests in 84 files, 7 skipped, about 8 minutes on a shared machine), the public build scan is clean, and `pnpm e2e` passes all three specs (about 1.2 minutes); with `VITE_LICENSED_BRANDS=1 pnpm dev`, switching Game names live changed the board, panels, decisions, log, price card, rules page and catalog.

**More than one game (Phase C, 2026-10-02, D045):** `GameSession` runs deckless games (`shuffleSteps` = 0: no shuffle, deal, shares or secrets; the audit replays with `deckOrders: {}`), so Chess plays end to end. Resign is a platform event (kind 7457, PROTOCOL §4.9, §8.3), limited to 2-seat games without a deck until the owner decides the multi-seat and deck-game questions (D045): it counts once the head it names is on the chain, is final for the client like an accepted timeout, and the resigner is last. The two review fix rounds made it unretractable (no flood-and-reclaim), final (no rescue of a timed-out seat), head-gated (no honest split, no false cancel) and scoped. The web app has a game registry (`apps/web/src/games/registry.ts`), a generic game screen with a Resign button and the attestation count, game-aware rules routes (`#/rules/<gameId>`, old links to Chain Reaction), a game picker on Home, and a placeholder Chess board (click a piece, then a square; promotion select, draw offers, SAN move list, result) for Phase D2 to replace. `pnpm sim --game chess` and one catalog meta-test for every game. Verified 2026-10-02: `pnpm check` passes (1338 tests in 77 files, 7 skipped, about 5 minutes); `pnpm test:sim` passes its 14 tests (about 7.5 minutes); `pnpm e2e` passes all three specs (Chain Reaction, profiles, Chess) in about 1.5 minutes. `pnpm sim --game chess --seed big`: 40 honest games, 20 with an equivocator, 40 with a resigning seat (at once and after one move, with full syncs) and 20 with a vanishing seat, all ok.

**Fast reveal reverted, "?" explained, holdings panel (2026-10-02, D039 reverted, D042, D043):** D039's prompt sharing is reverted, so a drawn tile again shows "?" until every other player has made their next move. The "?" is now a button with a popover explaining why (hover, tap or keyboard), with a one-line note under the hand; the candidate "acknowledge, then share" design is written up as a proposal (`docs/proposals/fast-reveal.md`), not built and not yet cheat-proof (open: honest splits). A "Your cash and shares" panel below the tiles shows cash, each chain held with its count, price and value, the share value and the net worth.

**Names, avatars and keys (2026-10-02, D040, D041):** players set a name, about line and picture (upload, gallery or link, stored on a Blossom server) in Settings, shown with the short npub in the header, the Home cards, the table seats and the game (status line, log, Players panel and results, all read from one page-wide ProfileStore). Everybody has a generated pattern avatar, and Home nudges players without a name. Secret keys can be imported (with Switch back), the browser is asked to keep site data on the first create or join, and Home reminds local keys to back up. Last verified 2026-10-02 after the game screen moved to the ProfileStore: `pnpm check` passes (1161 tests in 61 files, 7 skipped), and `pnpm e2e` passes both specs (about 1 minute).

**Game systems (2026-10-02, D044):** `docs/GAME-SYSTEMS.md` sorts every concern into platform, shared systems and per-game code, with status and API sketches. It covers private hands (the grant model, several decks, reshuffles, sealed shares), playing cards, dice (a beacon keyed to the deck keys), sealed choices, boards, teams and co-op, turn structures and clocks, and maps eleven game families to them. Its roadmap followed Chess with a trick-taking game for the deck extensions; after the owner's answers to its §7 (D049–D051) the next game is Hanabi, after the prompt-reveal research (Phase K). Docs only; nothing in it is built yet.

**Chess engine (Phase D1, 2026-10-02, D047):** `packages/games/chess` is a pure `GameModule` (2 seats, seat 0 White): full legal move generation, automatic draws (stalemate, threefold with the legal-en-passant key, fifty moves, insufficient material), UCI moves with draw offers riding on them, `acceptDraw`, SAN history, FEN import and export, and UI helpers. `docs/games/chess/RULES.md` has catalog C01–C57, each with a named test. Phase C (D045) put it in the web app's `MODULES` and registry. Verified 2026-10-02: `pnpm check` passes (1277 tests in 73 files, 7 skipped).
- **Perft** (`pnpm check` runs start d4, Kiwipete d3, position 3 d5, positions 4 and 4-mirrored d4, position 5 d4, position 6 d3). The deep run, `CHESS_PERFT_DEEP=1 pnpm vitest run --project chess test/perft.test.ts`, matched every published count in about 2 minutes: start d6 119,060,324 (16 s); Kiwipete d5 193,690,690 (29 s); position 3 d7 178,633,661 (31 s); positions 4 and 4-mirrored d5 15,833,292; position 5 d5 89,941,194 (14 s); position 6 d5 164,075,551 (21 s).
- **Fuzz:** `pnpm fuzz --game chess --games 10000 --seed chess-d1` (4 workers, 672 s on a shared machine, view checks on): **0 failures**, and all 10,000 games ended. Ends: 4,091 insufficient material, 1,980 stalemate, 1,363 checkmate, 1,328 fifty-move, 1,057 agreement, 181 repetition. Moves: 479 kingside and 201 queenside castlings, 302 en passant captures, 4,966 queen promotions and 14,954 underpromotions (1,545 promotions with a capture); 21,024 draw offers, 19,967 declined by a move. The coverage report lists no unreached tags.

**Chess UI (Phase D2, 2026-10-02, D048):** the Cburnett pieces (BSD-3-Clause, credits page `#/credits`), a board of labelled buttons with dots and rings for targets, last-move and check highlights, click, drag or keyboard moves, a promotion dialog, captured pieces and material, the draw offer and Accept draw, a results panel (score from places), and a full `#/rules/chess`. Review fixes M1 (void offer not in the history) and M3 (FIDE 6.9 OPEN). Verified 2026-10-02: `pnpm check` passes (1350 tests in 78 files, 7 skipped); `pnpm e2e` passes all three specs, the Chess one now with three games (mate, resign in check, promotion and an agreed draw).

**Hanabi spec (Phase J0, 2026-10-02, D054):** `docs/games/hanabi/RULES.md` is written (56-entry catalog C01–C56; no engine, UI or package). `tests/catalog.test.ts` lists `hanabi` as spec only (`SPEC_ONLY`, which fails once the package exists). **The build is blocked on Phase K** (sealed shares plus a prompt-reveal protocol; GAME-SYSTEMS §4.1.10). OPEN rules points are marked in the spec, among them the third-fuse score being kept as an option, hand-order and clue-mark display, the co-op win label, and variants.

**Phase 2d simulations (2026-10-01):** `pnpm sim --games 4 --seats 3-4 --seed night`: 4/4 done, audit pass. All 11 sim tests (4 memory-relay tests and 7 game scenarios, adversaries included) pass under `pnpm test:sim`. Request 3 (4 to 6 players) added 3: a 6-seat cancel in the shuffle (in `pnpm check`) and honest 4- and 6-seat whole games (`pnpm test:sim` only); all 14 pass in about 8 minutes, the 4- and 6-seat games taking about 72 s and 162 s.

**Last verified (2026-10-01, Phase 2d final review fixes):** `pnpm check` passes (typecheck, Biome, 1039 tests in 53 files, 5 skipped, about 5.5 minutes). `pnpm test:sim` passes its 11 tests in about 4 minutes. `pnpm e2e` passes in about 1 minute. Three browser contexts create, join and start a table through the UI. They shuffle and deal in about 15 s, then play past two full rounds until a merger disposal, with one player reloading mid-game. They converge on the same board and turn. With `E2E_FINISH=1`, a whole game played to its declared end and a passed audit took about 2.5 minutes.

**Earlier (end of 2b):** `pnpm check` passed (379 tests, 254 of them in `deck`).

**Earlier (Phase 1):** after the stall rule was removed (engine 0.2.0), `pnpm fuzz --games 10000 --seed no-stall-rule` gave 0 failures, and all 10,000 games ended by declaration.

## Phases and acceptance criteria

### Phase 0: Platform docs and scaffolding (done)
- pnpm workspace with strict TypeScript, Vitest + fast-check, and Biome.
- `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/PLAN.md` and `docs/games/chain-reaction/RULES.md`, plus a `CLAUDE.md` under 60 lines.
- Repo guards: engine purity scan; no reference-game names in any `src`.

### Phase 1: Game kit plus Chain Reaction engine (done, at the checkpoint)
- `@bored-games/game-kit`:
  - the `GameModule` contract, canonical JSON, hashing, PRNG, replay
  - the generic fuzzer, tested on a toy hidden-hand game, including detection of five kinds of planted bugs.
- `@bored-games/chain-reaction`: the full rules engine, implementing every RULES.md rule and option.
- **Acceptance:**
  - every RULES.md catalog entry (C01–C58) has a named test, enforced by a meta-test
  - `pnpm check` is green
  - `pnpm fuzz --games 10000` reports zero failures, with the coverage report reviewed.
- **Result** (`pnpm fuzz --games 10000`, 4 workers, about 225 s per run). Two independent runs (seeds `checkpoint-1` and `no-stall-verify`) gave **zero invariant failures and zero stalls**: 10,000 / 10,000 games ended by declaration (6,260 by the 41-tile condition, 3,740 by all-safe).
  - **Mergers:** 59,561 two-way, 1,427 three-way, 6 four-way; 4,286 survivor ties and 358 defunct ties.
  - **Every bonus case.** 58,284 trades were capped by supply. 21,121 chains were refounded while players still held kept shares. The founder got no share twice (players held all 25).
  - **Tiles:** 38,241 dead-tile discards; 34 turns with no playable tile; the bag emptied in 4,784 games.
  - **Stalls are bugs (owner, 2026-10-01).** The first checkpoint run showed 1,067 stalls. Root-cause analysis found an end condition declarable in every one, for 25+ turns. The fuzzer's simulated players kept declining it after the last tile was played; the rules and engine were not at fault.
  - **Fix:** simulated players declare once the bag is empty, and the 6 formerly stalled seeds are regression tests (`tools/fuzz/test/no-stall.test.ts`).
  - **Stall rule removed (D016).** The owner removed the house rule, so the game ends only by declaration (engine 0.2.0). A game that never ends fails the fuzzer's termination check.
  - `pnpm fuzz --one "<seed>" --players N` reproduces a single game deterministically (verified).

### Phase 2: Decentralized protocol
- **First,** write `docs/PROTOCOL.md` as a NIP-style draft covering:
  - kinds, chosen after checking the NIPs registry and avoiding 30050–30055 and 30100–30105
  - game root, join and session-key authorization, the deck setup and shuffle round
  - moves with piggybacked shares, reveals, equivocation proofs
  - audit reveal, result attestation, timeout claims, encrypted secret backup.
- **`packages/deck`:** secp256k1 ElGamal, hash-to-curve card points, a proven shuffle (Terelius–Wikström), DLEQ shares with verified decryption, and proofs of knowledge. The end-of-game audit itself belongs to 2c; the deck supplies `decryptWithSecrets` for it. Dependencies: `@noble/curves`, `@noble/hashes`.
  - **2b result (done, 2026-10-01).** Pure package: ElGamal, card points, proof of knowledge, DLEQ shares, shuffle with the Terelius–Wikström proof (cross-checked against CHVote, D019), strict wire codecs, and verified decryption (`decryptPosition`, `ownShare`; D025). 279 tests, including a tamper suite, hostile wire values, and an end-to-end flow at 3 and 6 seats that decrypts every position to a permutation of the 108 tiles, both by shares and after the secret reveal. Test vectors: `packages/deck/test/vectors/v1.json`, with hex context strings and each step's transcript. Rulings: D023, D024, D025.
  - **Final review fixes (2026-10-01):** verified decryption helpers, pinned context-string forms (PROTOCOL §3, §5), transcript intermediates in the vectors, stricter validation (`-0`, a required `n`, the prover's `ctx`, an identity `X`), and doc drift (D023, D025).
  - **Bench** (`pnpm --filter @bored-games/deck bench`, N = 108, Node 22): `shuffleDeck` about 0.4 s, `proveShuffle` 1.7 s, `verifyShuffle` 1.0–1.1 s; a share takes 6–7 ms to make and 10–11 ms to verify. A shuffle step is 36,051 bytes of content (deck 10,369 + proof 25,682), under the 40,000-byte budget; a share is 170 bytes.
  - **Follow-up (not needed for 2c):** `msm` always runs `pippenger`, about 3× slower than a plain sum for 2–3 terms. A small-input fast path would make `verifyShare` 2–3× faster and take roughly a third off `verifyShuffle` (D024).
  - **Carried into 2c:**
    - Reject a joint key equal to the identity (D024).
    - ~~The engine change D022~~ (done in 2c Task 1, engine 0.3.0), and ~~`GameModule.standings`~~ (done in 2c Task 2, with `dealt` and `revealsOf`; the fuzzer checks all three on every step).
    - **One noble copy (D023).** nostr-tools 2.25.2 pins `@noble/curves` and `@noble/hashes` 2.0.1, while the deck pins 2.4.0. A second copy's points fail the deck's `instanceof` checks, so its verifiers would silently return false. Add a pnpm override to a single version, or route every point through `decodePoint`.
    - Hash context strings in their NOSTR hex forms (D025), and decrypt only through `decryptPosition`.
- **`packages/protocol`:** event builders and parsers, and validation.
  - **2c result (done, 2026-10-01).** Pure package `@bored-games/protocol`, with no new third-party dependency (D026).
    - NIP-01 layer: event ids, BIP-340 signing with injected randomness, a strict `verifyEvent` that never throws, and the 262144-byte size cap.
    - Lobby events: Table, Join (with its proof of knowledge) and Game root, plus `validateRoot` (D027).
    - In-game events: Move (shuffle step and action, with decoded deck types), Shares, Timeout claim, Secret reveal and Result attestation, plus `logHash` (D028). Every parser runs the same pipeline and throws only `ProtocolError`.
    - A real 108-card shuffle move (about 36 KB) parses under the size cap.
    - The purity guard covers `packages/protocol/src`.
    - Not in 2c: the session engine (folding the log, owed shares, deadlines, equivocation, the audit), relay transport and the NIP-78 key backup. These are 2d and 2e.
- **`packages/client`:** a session engine over a pluggable relay transport.
  - **2d result (done, 2026-10-01; plan `docs/superpowers/plans/2026-10-01-phase-2d-session.md`, rulings D030).** Pure package `@bored-games/client`, covered by the purity guard.
    - **Session.** `GameSession.create` checks the root with `validateRoot`, and that `me` holds its seat's session key and deck secret. `receive(ev, now)` parses every event strictly and folds it to a fixpoint; it never throws on peer input. Moves wait in a pool keyed by `prev` until they link, so every client that holds the same events reaches the same state, whatever their order.
    - **Shuffle and deal.** Shuffle steps in seat order, each proof verified once per session. One Shares event per seat for every position dealt to another seat or public, kept once per (seat, position).
    - **Play (PROTOCOL §6).** Owed shares are monotone, and a move missing only shares is buffered (R1). Derived reveals and game actions go into the interleaved action log; private learns start with the play phase. `buildAction` attaches the owed shares and the reveal shares.
    - **Decide gate (Ruling 4).** `decide` is due when the decision is mine and the module lists legal actions, which modules keep exact or empty.
    - **Equivocation and fork choice (Rulings 3, 5 and 9).** Two valid-looking moves on one (prev, seq) flag the seat, who ranks last at the end; nothing is rewound. The chain follows the best branch by (reaches over, length, lowest id), so a finished game cannot be reopened. Fork trials are bounded.
    - **End of game.** Secrets (`x·G = X_k`), the R6 audit over the interleaved log, R5 forfeits, and `attestTemplate` for the npub to sign; matching attestations are listed in `view().attested`.
    - **Timeouts (Ruling 10).** Deadlines run on each client's first-seen times, which the web controller persists. An accepted claim forfeits every stalled seat (R4), and acceptance is final for that client. Forfeit endings are attestable (Ruling 7), and claims are capped per signer.
    - **Lobby.** `foldLobby` seats Joins by priority slot with collision checks and recovery, and `buildRootTemplate` accepts an explicit seat list (D021). Joins prove possession of their session key (D033).
    - **Simulation.** `MemoryRelay` and `simulateGame`: independent clients and a spectator sync at random moments of a simulated clock, receive events shuffled and duplicated, and must agree on everything. Adversaries (test tooling only): `badShare`, `badShuffle`, `forgedSkip`, `equivocate` and `vanish`. `pnpm sim` runs whole games across workers; `pnpm test:sim` runs the scenarios.
- **Acceptance:**
  - N simulated clients complete fuzzed async games over an in-memory relay, where each client is only "online" on its own turns. **Met** (2d).
  - Adversarial tests detect: bad shares, wrong reveals, equivocation, a dishonest `skipPlace`, an undeclared dead tile, and a tampered shuffle. **Met** (2d: the sims plus `play`, `end` and `shuffle-phase` tests).
  - A smoke test runs against the owner's relay plus a public relay. **Open** (2e; needs open question 7).

### Phase 3: Web shell plus Chain Reaction UI
- The framework is Preact + Signals (D031, the controller's ruling on D014).
- **Shell:** NIP-07 and NIP-46 login, profiles, lobby, games list, and an async "your turn" inbox.
- **Chain Reaction board:**
  - a hand that previews where each tile lands and marks dead and blocked tiles
  - a share and price panel, and the merger decision flow
  - chains distinguished by label and pattern, not color alone.
- **Layouts:** phone portrait, iPad landscape, desktop.
- **PWA:** manifest and offline shell; static output with relative paths (Capacitor-ready).
- **Acceptance (Phase 3 plan Task 6):** `pnpm e2e` plays a three-player game through the UI against the dev relay. `.github/workflows/pages.yml` deploys `apps/web/dist` to GitHub Pages once CI passes on `main`, and `.github/workflows/ci.yml` runs `pnpm check` on pushes to `main` and on pull requests.
  - **Status (2026-10-01):** met.
  - **Hidden holdings (D037, 2026-10-01):** done. The UI shows other players' holdings as chains only and their cash as "has cash" / "no cash", and the log keeps their numbers for the last two turns; engine and protocol unchanged.
  - **Player rules and price card (2026-10-01):** done. `#/rules` explains the game to players (numbers from `DEFAULT_RULES`, names from the theme), and a Price card dialog in the game marks each chain's current price row. The default relay is relay.primal.net (D038).
  - **4 to 6 players (2026-10-01):** supported and tested. The New table form offers 3 to 6; `E2E_SEATS=4|5|6 pnpm e2e` plays through the UI, and the sim tests cover 6 seats (a cancel in the shuffle, always) and whole 4- and 6-seat games (`pnpm test:sim`). Setup grows with the seats because each player shuffles in turn: measured from the start to the first move with all windows on one 4-core machine, about 11 s (3 players), 16 s (4), 28 s (5) and 43 s (6). The player copy says so.
  - **Owner to-do:** Pages is enabled with the source "GitHub Actions"; keep `main` the default branch, then follow `docs/TESTING.md` §2.

### Phase 4: Records
Verified history, games played, wins and scores per game, and deterministic ratings, all client-side. An optional untrusted cache for leaderboards.

### Phase 5: Social
Friends (NIP-02), seeks and matchmaking, invites, turn notifications (NIP-17), and moderation (NIP-56).

### Phase 6: Second game
Validates the contract and the deck primitive on a different design.

### Phase 7: Polish
Final names and theme, accessibility pass, Capacitor packaging.

## Risks
See the risks table in `docs/ARCHITECTURE.md`. The top three are:
1. Correctness of the zero-knowledge shuffle proof implementation (D019). Mitigated in 2b: the equations were cross-checked against CHVote, and there are tamper tests and test vectors.
2. Verification cost on phones. A shuffle step takes about 1 s to verify, measured in the dev container (x64, Node 22); a phone may be several times slower (D019, D024).
3. Contract fit for the second game (Phase 6).
