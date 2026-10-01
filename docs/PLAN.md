# Plan

## Open questions for the owner

1. **UI framework for apps/web**, needed before Phase 3. Proposal D014 in `docs/DECISIONS.md` offers two options: Svelte 5 or Preact + Signals.
2. **Abandonment and timeouts.** When a player stops taking turns, the game cannot continue, because their decryption shares are needed. What per-move time limit should apply, what does a timeout claim do (forfeit? game void?), and how should it count in ratings?
3. **Shuffle proofs.** Shuffle cheating is detected at the end-of-game audit, not prevented live. Is post-game detection plus forfeit acceptable at launch, or should zero-knowledge shuffle proofs come first?
4. **Tilestock 2-player rules** remain OPEN, so 3–6 players only for now. Should 2-player be supported, and with which variant?
5. **Second game** (Phase 6). Which game should validate the contract?
6. **Final names.** The platform ("Bored Games"), the first game ("Tilestock") and its chain names (Jade, Lapis, Onyx, Quartz, Ruby, Sapphire, Topaz) are placeholders.
7. **Relay URL** for your nostr-rs-relay, needed in Phase 2.
8. **Ratings scope.** Are global leaderboards wanted? Global boards mean someone runs an untrusted cache. The alternative is that each client computes ratings over the games it can see, optionally web-of-trust weighted.

## Status

| Phase | State |
|---|---|
| 0. Platform docs and scaffolding | **Done** |
| 1. Game kit plus Tilestock engine | **Done, at the checkpoint** |
| 2. Decentralized protocol | Not started |
| 3. Web shell plus Tilestock UI | Not started (needs open question 1) |
| 4. Records | Not started |
| 5. Social | Not started |
| 6. Second game | Not started (needs open question 5) |
| 7. Polish | Not started |

**Last verified:** `pnpm check` passes (typecheck, Biome, 108 tests). `pnpm fuzz --games 10000 --seed checkpoint-1` reports no invariant failures; numbers are in the Phase 1 section below.

## Phases and acceptance criteria

### Phase 0: Platform docs and scaffolding (done)
- pnpm workspace with strict TypeScript, Vitest + fast-check, and Biome.
- `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/PLAN.md` and `docs/games/tilestock/RULES.md`, plus a `CLAUDE.md` under 60 lines.
- Repo guards: engine purity scan; no reference-game names in any `src`.

### Phase 1: Game kit plus Tilestock engine (done, at the checkpoint)
- `@bored-games/game-kit`:
  - the `GameModule` contract, canonical JSON, hashing, PRNG, replay
  - the generic fuzzer, tested on a toy hidden-hand game, including detection of five kinds of planted bugs.
- `@bored-games/tilestock`: the full rules engine, implementing every RULES.md rule and option.
- **Acceptance:**
  - every RULES.md catalog entry (C01–C58) has a named test, enforced by a meta-test
  - `pnpm check` is green
  - `pnpm fuzz --games 10000` reports zero failures, with the coverage report reviewed.
- **Result:**
  - 10,000 games (3–6 seats) with zero invariant failures.
  - Rare paths reached: 4-way mergers, survivor and defunct ties, safe-absorbs-unsafe, every bonus case, trades capped by supply, refounding with kept shares, dead and blocked tiles held, all-unplayable hands, both declaration conditions, stall endings, the bag emptying.
  - Reached only by catalog tests: "founder gets no share because players hold all 25" (C07). Random play essentially never collects all 25 shares of an inactive chain.

### Phase 2: Decentralized protocol
- **First,** write `docs/PROTOCOL.md` as a NIP-style draft covering:
  - kinds, chosen after checking the NIPs registry and avoiding 30050–30055 and 30100–30105
  - game root, join and session-key authorization, the deck setup and shuffle round
  - moves with piggybacked shares, reveals, equivocation proofs
  - audit reveal, result attestation, timeout claims, encrypted secret backup.
- **`packages/deck`:** secp256k1 ElGamal, hash-to-curve card points, shuffle with commitments, DLEQ shares, audit. Dependencies: `@noble/curves`, `@noble/hashes`.
- **`packages/protocol`:** event builders and parsers, and validation.
- **`packages/client`:** a session engine over a pluggable relay transport.
- **Acceptance:**
  - N simulated clients complete fuzzed async games over an in-memory relay, where each client is only "online" on its own turns.
  - Adversarial tests detect: bad shares, wrong reveals, equivocation, a dishonest `skipPlace`, an undeclared dead tile, and a tampered shuffle.
  - A smoke test runs against the owner's relay plus a public relay.

### Phase 3: Web shell plus Tilestock UI
- The framework is the owner's choice from D014.
- **Shell:** NIP-07 and NIP-46 login, profiles, lobby, games list, and an async "your turn" inbox.
- **Tilestock board:**
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
1. Abandonment policy (open question 2).
2. Audit-only shuffle integrity (open question 3).
3. Contract fit for the second game (Phase 6).
