# Plan

## Open questions for the owner

1. **UI framework for apps/web**, needed before Phase 3. Proposal D014 in `docs/DECISIONS.md` offers two options: Svelte 5 or Preact + Signals.
2. ~~**Abandonment and timeouts.**~~ Decided (D020): the creator picks a 1-, 3- or 7-day deadline, and the abandoner forfeits.
3. ~~**Shuffle proofs.**~~ Decided (D019): zero-knowledge Wikström shuffle proofs from day one.
4. **Chain Reaction 2-player rules** remain OPEN, so 3–6 players only for now. Should 2-player be supported, and with which variant?
5. **Second game** (Phase 6). Which game should validate the contract?
6. **Final names.** The first game is now named **Chain Reaction** (owner, 2026-10-01). The platform name ("Bored Games") and the chain names (Jade, Lapis, Onyx, Quartz, Ruby, Sapphire, Topaz) are still placeholders. Other games already use the name "Chain Reaction"; a trademark check belongs to Phase 7.
7. **Relay URL** for your nostr-rs-relay, needed in Phase 2.
8. **Ratings scope.** Are global leaderboards wanted? Global boards mean someone runs an untrusted cache. The alternative is that each client computes ratings over the games it can see, optionally web-of-trust weighted.

## Status

| Phase | State |
|---|---|
| 0. Platform docs and scaffolding | **Done** |
| 1. Game kit plus Chain Reaction engine | **Done, at the checkpoint** |
| 2. Decentralized protocol | **2a spec written** (`docs/PROTOCOL.md`), awaiting owner review; **2b done** (`packages/deck`); **2c done** (`packages/protocol`); **2d in progress** (`packages/client`: session creation, shuffle, deal and game actions); 2e not started |
| 3. Web shell plus Chain Reaction UI | **In progress** (Preact + Signals, D031): relay pool and dev relay, identity and settings, Chain Reaction screen components, lobby and game controllers with the Game route (D034); Home and Table screens and the end-to-end test next |
| 4. Records | Not started |
| 5. Social | Not started |
| 6. Second game | Not started (needs open question 5) |
| 7. Polish | Not started |

**Last verified (2026-10-01, end of 2b):** `pnpm check` passes (typecheck, Biome, 379 tests, 254 of them in `deck`).

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
  - **2d progress (plan `docs/superpowers/plans/2026-10-01-phase-2d-session.md`, rulings D030).** Pure package `@bored-games/client`, covered by the purity guard.
    - `GameSession.create` checks the root with `validateRoot`, and that `me` holds its seat's session key and deck secret.
    - `receive` parses every event strictly and folds it to a fixpoint: moves wait in a pool keyed by `prev` until they link.
    - Shuffle phase: steps in seat order, each proof verified once per session against the previous deck.
    - Deal phase: one Shares event per seat covering every position dealt to another seat or public. Shares are verified against the final deck and kept once per (seat, position) in a `ShareStore`. The deal ends when every seat's owed positions are covered.
    - Derived reveals (PROTOCOL §6.3) go into an interleaved action log for the audit, and private learns (§6.4) decrypt with `decryptPosition` and `ownShare`.
    - Game actions (§6.5): the signer must be the pending seat, every share and reveal must verify, the module must accept the action, and each reveal must decrypt to the card `revealsOf` claims. A move missing only shares that another event may still bring (its owed shares, R1, or another seat's share of a revealed card) is buffered, then accepted when they arrive. `buildAction` attaches the owed shares and the reveal shares.
    - `pendingSince` is computed from the held events: the root, the accepted moves and, per kept share, its earliest verified copy. Arrival order does not change it.
    - Fork choice (D030 Ruling 5): the chain follows, at each prev, the successor heading the longest valid branch (ties to the lowest id), so a late rival on an old prev never displaces the main chain. Moves on a losing branch stay pooled; branches are compared by trial folds from the per-move snapshots.
    - Equivocation (R2, Rulings 3 and 5): two distinct moves on one (prev, seq) by one seat, both valid as of that prev on everything but R1, flag the seat in `view().equivocators`. An invalid move never counts. Play goes on; at the end the flagged seats move to the last places.
    - The `decide` duty (Ruling 4) is due when the pending decision is mine and the module lists legal actions; modules list none while legality depends on cards the seat has not learned (`GameModule.legalActions` contract). Out-of-turn merger disposals no longer wait for the whole hand.
    - End of game: when the module is over the phase is `end` and every seat owes its Secret reveal (`x·G = X_k`). With all secrets in, the R6 audit (`src/audit.ts`) replays the interleaved action log in full mode, and the phase is `done`. A failed audit or an equivocation moves those seats to the last places (`rankWithForfeits`). `attestTemplate(createdAt)` gives the unsigned Result attestation for the npub to sign; matching attestations are listed in `view().attested`.
    - Lobby: `foldLobby` seats Joins by priority slot with collision checks and recovery, and `buildRootTemplate` accepts an explicit seat list (D021). Joins prove possession of their session key (D033).
    - Next: timeouts and timeout forfeits (Task 5), then simulations and the D030 write-up (Task 7).
- **Acceptance:**
  - N simulated clients complete fuzzed async games over an in-memory relay, where each client is only "online" on its own turns.
  - Adversarial tests detect: bad shares, wrong reveals, equivocation, a dishonest `skipPlace`, an undeclared dead tile, and a tampered shuffle.
  - A smoke test runs against the owner's relay plus a public relay.

### Phase 3: Web shell plus Chain Reaction UI
- The framework is the owner's choice from D014.
- **Shell:** NIP-07 and NIP-46 login, profiles, lobby, games list, and an async "your turn" inbox.
- **Chain Reaction board:**
  - a hand that previews where each tile lands and marks dead and blocked tiles
  - a share and price panel, and the merger decision flow
  - chains distinguished by label and pattern, not color alone.
- **Layouts:** phone portrait, iPad landscape, desktop.
- **PWA:** manifest and offline shell; static output with relative paths (Capacitor-ready).

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
