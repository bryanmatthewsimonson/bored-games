# Decision log

Newest decisions at the bottom. Each entry gives the decision, why, and the alternatives considered. "Owner" is the product owner; dates are when decided.

## D001: A multi-game platform, not a single game (2026-10-01, owner)
The repo hosts many online board games, BoardGameArena-style. The Acquire-style game is the first.
- **Consequence:** a game-agnostic kit (`packages/game-kit`) and the `GameModule` contract come first, and the first game is built against them.

## D002: Human multiplayer only, online only (2026-10-01, owner)
- There are no AI players, so the bots phase was removed.
- There is no local pass-and-play, so no hand-off screens are needed.
- A seeded random-move **fuzzer** is allowed strictly as a test tool, and is never exposed as a player.

## D003: Fully decentralized, with only players and relays (2026-10-01, owner)
- There is no referee, dealer or stats server. The players' clients deal hidden cards (D011), sequence moves and ratify results.
- **Alternatives:**
  - A self-hosted referee or dealer: considered, then rejected by the owner.
  - Player co-signed results with an authority: unnecessary, because results are derivable from the verified log.

## D004: Asynchronous play is primary (2026-10-01, owner)
No one may be required online outside their own turn. This rules out synchronous mental poker, where every draw waits for all players (D011).

## D005: Tooling
| Choice | Why | Alternatives |
|---|---|---|
| **pnpm 10 workspaces** | Strict dependency isolation (a package cannot import what it does not declare), fast, standard for monorepos | npm workspaces: hoisting hides undeclared deps |
| **TypeScript 7.0.2**, pinned exactly | Current release; native compiler is fast. We use only the `tsc` CLI. Fallback is 6.0.3. apps/web may need 6.x if its framework tooling uses the TS programmatic API, which 7.0 does not expose stably. | 6.0.3 |
| **Strict flags** | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (string unions instead of enums; fits plain-JSON state), `allowImportingTsExtensions`, `module: nodenext` | |
| **No build step** | Packages export `src/index.ts`. Scripts run on Node ≥ 22.18 built-in type stripping, which works across pnpm workspace symlinks (verified). | `tsx` (kept as fallback), `tsc` emit |
| **Vitest 5** (+ `vite` 8 pinned as its required peer) | Fast, ESM-native, workspace projects | Jest: slower, ESM friction |
| **fast-check 4** | Property tests for pricing, bonuses, canonical JSON, PRNG | Hand-rolled generators |
| **Biome 2** | Lint and format in one dependency | ESLint + typescript-eslint + Prettier: 3+ dependencies and plugins |
| **@types/node** | Tests and the fuzz CLI only. Pure packages typecheck with `types: []`. | |

Runtime dependencies so far: **none**. Phase 2 will add `@noble/curves` and `@noble/hashes`: audited, zero-dependency, and already the basis of the NOSTR ecosystem.

## D006: Repo layout and names
- **Layout:** `packages/game-kit`, `packages/games/<game>`, `packages/brand`, `tools/fuzz`, `docs/`. Later: `packages/deck`, `packages/protocol`, `packages/client`, `apps/web`.
- **Package scope:** `@bored-games/*`, independent of any product name.
- **Working names** (placeholders, all in one file each):
  - platform "Bored Games" in `packages/brand/src/brand.ts`
  - first game "Chain Reaction" in `packages/games/chain-reaction/src/theme.ts`, with chain display names Jade, Lapis, Onyx, Quartz, Ruby, Sapphire, Topaz.
- **Theme labels:** each chain has a letter label and a fill pattern, so color is never the only cue. Label letters avoid A–I, which are board row letters.
- **Engine ids** (`chain-reaction`, `b1 b2 s1 s2 s3 p1 p2`) are neutral and permanent, because they appear in network events.

## D007: Engine API and state
- **Pure functions over plain-JSON state.** `apply(state, unknown)` returns `{ok, state, events}` or `{ok:false, error}`. It never throws and never mutates; tests and the fuzzer deep-freeze inputs to prove it.
- **Canonical actions.** Exact key sets, integer fields, buys in chain order, discards in position order.
- **Integer money.** Every amount is a multiple of $100. Absent values are `null`, never missing keys.
- **The pending decision is the phase.** `pending()` derives who acts: a seat or a public deck reveal. `legalActions` returns only that seat's choices.
- **Automatic steps run inside `apply`.** A bounded `advance()` loop handles bonuses, skipping holders with no shares, flood-fill relabels, turn advance and scoring.
- **Rule options.** Every OPEN rule is a `ChainReactionRules` option with a documented default.

## D008: Hidden cards are deck positions, with private learns and public reveals
- Draws assign deck positions; identities live only in full states or in a viewer's learned cards. This one model serves:
  - fuzzing and audits (full mode)
  - live clients (view mode)
  - the mental-poker protocol, which supplies learns and reveals.
- Dead-tile discards are part of the turn-ending action, because only the hand's owner can evaluate them. Completeness and "no playable tile" claims are checked at the end-of-game audit.

## D009: Rule interpretations for Chain Reaction (2026-10-01, owner)
Details are in `docs/games/chain-reaction/RULES.md` under "Sources and interpretations":
- The owner-pasted officialgamerules.org text is the primary reference.
- First player is decided row-then-column.
- Declaring the end is optional, and the declarer finishes their turn.
- Dead tiles held during a turn are replaced at its end, once per turn.
- The game ends only by declaration. The kickoff's empty-bag stall house rule was later removed (D016).
- Bonus splits round up to $100.

## D010: Fuzzer instead of bots
- The kit's generic fuzzer plays seeded random legal moves on any module and checks after every action:
  - invariants, immutability and JSON-safety
  - that the pending seat has a legal action, and that legal actions apply
  - that impostor actions are rejected
  - per-seat and spectator view consistency
  - at the end, replay equality.
- Game-specific weighting policies and deck orders (in `tools/fuzz`) steer play toward rare rules; a coverage report shows anything never reached.
- Game *i* of a batch uses seed `<seed>#<i>`, so every failure reproduces on its own.

## D011: Async mental-poker dealing with turn-piggybacked shares
This is the scheme detailed in `docs/ARCHITECTURE.md`.
- **Cryptography:** ElGamal on secp256k1 with a joint key, sequential re-randomize-and-permute shuffles with committed secrets, and DLEQ-proven decryption shares.
- **Async delivery:** each client publishes shares for other seats' new cards with its own next action. That's enough because every seat acts between any player's draw and that player's next turn.
- **Audit:** an end-of-game reveal verifies everything.
- **Alternatives:**
  - Synchronous dealing: breaks async play.
  - Per-player pre-dealt streams: allow peeking and change bag exhaustion.
  - A trusted dealer: rejected in D003.

## D012: Results are ratified by replay and attestation
- Outcomes are recomputed by every client from the verified log.
- After the audit, each player's client publishes a signed attestation. A result is valid when its log verifies, and finalized when everyone attests and the audit passes.
- Stats and ratings are computed client-side, deterministically, from valid and audited games.

## D013: Hashing
- `stateHash` is cyrb53 over canonical JSON. It is a fast, non-cryptographic fingerprint for tests and logs.
- Network integrity relies on signed NOSTR event ids (SHA-256), not on this hash.

## D015: Games never stall; a stall is a bug (2026-10-01, owner)
- **Owner ruling:** a correct game always ends by one of the rules' end conditions, so every stalled game indicates a bug.
- **Investigation** (Superpowers systematic debugging) of all 1,067 stalls in the first 10,000-game run:
  - In every stall, an end condition was declarable (877 by the 41-tile condition, 190 by all-safe) and had been for 25+ turns.
  - The bag and hands were empty, and every empty space was dead.
- **Root cause:** fuzz policies that rarely or never declare kept declining an available end. The rules and engine were correct.
- **Fix:**
  - The fuzz target reported any stall outcome as a failure (`checkOutcome` in the kit). This was superseded by D016, which removed the stall ending.
  - Simulated players declare once the bag is empty.
  - The formerly stalled seeds are regression tests.
- The engine's stall house rule was then removed entirely (D016).

## D016: Stall rule removed (2026-10-01, owner)
- **Ruling:** the game ends only by declaration, as in the reference rules. The kickoff's house rule (bag empty plus a full round with no tile placed) is gone, along with its `stallRule` option, the `stall` counter and the per-turn `placed` flag.
- **Engine version:** bumped to 0.2.0, because the ending rules changed.
- **If a game ever fails to end,** the fuzzer reports "no termination within N steps" with a reproducible seed. That is a bug to fix, not an ending.

## D017: The first game is named Chain Reaction (2026-10-01, owner)
- **Before:** the game was called Tilestock, a working codename.
- **Renamed everywhere,** not just the display name: nothing had been published on NOSTR yet, so the internal id could still change for free. That covers the package `@bored-games/chain-reaction`, the module id `chain-reaction`, the folders, the docs path `docs/games/chain-reaction/` and the code names (`ChainReactionState`, …).
- **Unchanged:** the chain ids (`b1`…`p2`) and the engine version (0.2.0).

## D018: Protocol version 1 and event kinds (2026-10-01, owner-approved design)
- **Spec:** `docs/PROTOCOL.md`.
- **Event kinds** (unused in the NIPs registry; the owner's 30050–30055 and 30100–30105 are avoided):
  - 37450 Table
  - 7450 Game root
  - 7451 Join
  - 7452 Move
  - 7453 Shares
  - 7454 Timeout claim
  - 7455 Secret reveal
  - 7456 Result attestation
  - 30078 (NIP-78) key backups
- **Keys:** the npub signs only the join, the game root and the attestation. A per-game session key signs moves, and a separate per-game deck key is published with a proof of knowledge.
- **Auditing:** the end-of-game audit replays the whole log in full mode with every deck secret revealed.

## D019: Zero-knowledge shuffle proofs from day one (2026-10-01, owner)
- **Choice:** Terelius–Wikström shuffle proof, following the CHVote specification's GenShuffleProof / CheckShuffleProof algorithms, translated to secp256k1. It is used in real elections and specified step by step.
- **Size:** about 34 KB per shuffle step for 108 cards.
- **Rejected:**
  - Bayer–Groth: smaller proofs, but much harder to implement correctly.
  - Cut-and-choose: megabyte-sized proofs.
  - Audit-only: catches tampering only after the game.

## D020: Abandonment and deadlines (2026-10-01, owner)
- **Deadline:** the creator picks 1, 3 or 7 days per move (default 3), fixed for the game.
- **Timeout claims:** after the deadline, any seat may post a timeout claim.
- **Forfeit:**
  - The abandoner ranks last.
  - The others are ranked by `standings(state)`, the score as if the game ended now.
  - The game counts for stats.
  - Equivocation, a failed audit or a withheld deck secret are forfeits too.
- **Cancellation:** a stall before the first game action cancels the game with no result.

## D021: Seating (2026-10-01, owner)
The table lists invited npubs and/or open seats; anyone can claim an open seat until the table fills, and the creator then publishes the game root, which fixes the seat order. This covers friends now and public matchmaking later with no protocol change.

## D022: Initial hands are dealt at setup, in seat order (2026-10-01, protocol-driven)
- **Why:** the deal round needs every hand position assigned before any card is revealed (PROTOCOL §6.1).
- **Change:** Chain Reaction will assign hands at setup in seat order, instead of after the setup reveals starting from the first player. Fairness is unchanged, since positions are uniformly shuffled.
- **When:** this ships with Phase 2b/2c and bumps the engine version.

## D023: Crypto dependencies: @noble/curves and @noble/hashes (2026-10-01, Phase 2b)
- **Why:** the mental-poker deck (`packages/deck`) needs secp256k1 point arithmetic, hash-to-curve, multi-scalar multiplication and SHA-256. Hand-rolling elliptic-curve code is the wrong place to economize.
- **Choice:** exactly two runtime dependencies, both pinned to `2.4.0` with no caret:
  - `@noble/curves`: audited, zero-dependency and constant-time-minded. The v2 API gives `secp256k1.Point`, `secp256k1_hasher.hashToCurve` and `pippenger`.
  - `@noble/hashes`: audited and zero-dependency. It supplies `sha256` and byte helpers.
- **Why these two:** they are the primitives under nostr-tools, so the platform already trusts them for NOSTR signatures. This adds no new supply-chain surface in practice.
- **Scope:** `src/` of the deck stays pure: randomness is injected (`RandomBytes`), and nothing imports Node or platform crypto. game-kit is a devDependency only, for the seeded test PRNG.
- **Identity point in hashes:** `hs` hashes the identity as 33 zero bytes so in-memory proof code never throws on a degenerate point. The wire decoder `decodePoint` still rejects the identity.

## D014: Proposed, awaiting the owner: UI framework for apps/web (Phase 3)
Two options, to be chosen before Phase 3 starts.

| | **A. Svelte 5 + Vite** | **B. Preact + Signals + Vite** |
|---|---|---|
| Size and speed | Compiled, very small bundles, fast | ~4 KB runtime, fine-grained signals, fast |
| Ergonomics | Concise components, built-in transitions; great for a board, animations, merger dialogs | JSX; React-like patterns, very familiar |
| Typing | Needs `svelte-check`, which uses the TypeScript programmatic API, so apps/web would pin TS 6.x | Plain `tsc` checks JSX, so TS 7 works as-is |
| Ecosystem | Smaller, but good PWA support (vite-plugin-pwa) | Can use most React libraries via `preact/compat` |
| Mobile / Capacitor | Static output, works | Static output, works |
| Risk | Toolchain split (TS 6 for web) | Easier to write unidiomatic code; more manual animation work |

Either keeps the client a static SPA with relative asset paths, ready for Capacitor.
