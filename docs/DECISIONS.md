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
- **Size:** 36,051 bytes of canonical JSON per shuffle step for 108 cards (deck 10,369 + proof 25,682), measured in Phase 2b.
- **Rejected:**
  - Bayer–Groth: smaller proofs, but much harder to implement correctly.
  - Cut-and-choose: megabyte-sized proofs.
  - Audit-only: catches tampering only after the game.
- **Cross-check (2026-10-01):** the Task 7 equations were compared against the CHVote Protocol Specification (IACR ePrint 2017/325), Alg. 8.41–8.47 (GenShuffle, GenPermutation, GenReEncryption, GenShuffleProof, GenPermutationCommitment, GenCommitmentChain, CheckShuffleProof). **Verdict:** every equation matches, up to the additive notation, our swapped ciphertext components (`a = r·G`, `b = M + r·X`), re-encryption randomness indexed by output (`Σ_j r̃_j u_j = Σ_i u_{ψ(i)} r'_i`) and the response sign (`s = ω + ch·secret`, so the verifier subtracts `ch·(…)`). **One structural difference, kept:** CHVote transmits `(ch, s, c, ĉ)` and the verifier recomputes `t`; PROTOCOL §5.3 transmits `t` and the verifier checks each equation plus `ch = HS(…t…)`. Both are standard Fiat–Shamir forms of the same Σ-protocol with equal soundness; ours costs about N + 5 more points (≈ 5.3 KB at N = 108), stays inside the 40,000-byte budget and matches the approved field names.
- **Cost (measured 2026-10-01, `pnpm --filter @bored-games/deck bench`, Node 22, single-threaded, on the development container's x64 CPU):** at N = 108, about 0.4 s for `shuffleDeck`, 1.7 s for `proveShuffle` and 1.0–1.1 s for `verifyShuffle`; a decryption share takes 6–7 ms to make and 10–11 ms to verify. Every client verifies every step once, so a 6-seat game costs about 7 s of verification at setup. Acceptable for asynchronous play; a phone may be several times slower (see D024 on `msm`).

## D020: Abandonment and deadlines (2026-10-01, owner)
- **Deadline:** the creator picks 1, 3 or 7 days per move (default 3), fixed for the game.
- **Timeout claims:** after the deadline, any seat may post a timeout claim.
- **Forfeit:**
  - The abandoner ranks last.
  - The others are ranked by `standings(state)`, the score as if the game ended now.
    - Chain Reaction: final scoring on a copy of the current state, except that bonuses already paid in the current merger are not paid again. A mid-merger standing still prices defunct chains at their pre-merger size and does not count the pending tile in the survivor; this is accepted as "if it ended now" (Phase 2c Task 2).
  - The game counts for stats.
  - Equivocation, a failed audit or a withheld deck secret are forfeits too.
- **Cancellation:** a stall before the first game action cancels the game with no result.

## D021: Seating (2026-10-01, owner)
The table lists invited npubs and/or open seats; anyone can claim an open seat until the table fills, and the creator then publishes the game root, which fixes the seat order. This covers friends now and public matchmaking later with no protocol change.

## D022: Initial hands are dealt at setup, in seat order (2026-10-01, protocol-driven)
- **Why:** the deal round needs every hand position assigned before any card is revealed (PROTOCOL §6.1).
- **Change:** Chain Reaction will assign hands at setup in seat order, instead of after the setup reveals starting from the first player. Fairness is unchanged, since positions are uniformly shuffled.
- **When:** shipped in Phase 2c Task 1. The engine version is now 0.3.0.
- **Shipped as:** `setupGame` assigns seat k the positions `S + 6k … S + 6k + 5` (S = seat count; 6 = `handSize`), and `deck.next` starts after them. In full mode the slots hold their tiles from setup; in view mode they are `null` until `learn`. The `tilesDealt` events are emitted in seat order once the setup tiles are revealed, after `firstPlayer`.

## D023: Crypto dependencies: @noble/curves and @noble/hashes (2026-10-01, Phase 2b)
- **Why:** the mental-poker deck (`packages/deck`) needs secp256k1 point arithmetic, hash-to-curve, multi-scalar multiplication and SHA-256. Hand-rolling elliptic-curve code is the wrong place to economize.
- **Choice:** exactly two runtime dependencies, both pinned to `2.4.0` with no caret:
  - `@noble/curves`: audited, zero-dependency and constant-time-minded. The v2 API gives `secp256k1.Point`, `secp256k1_hasher.hashToCurve` and `pippenger`.
  - `@noble/hashes`: audited and zero-dependency. It supplies `sha256` and byte helpers.
- **Why these two:** they are the primitives under nostr-tools, so the platform will trust the same authors and code for NOSTR signatures.
- **Supply chain (corrected after the Phase 2b review):** they are still new surface. Today they are the repo's only runtime dependencies, and nostr-tools pins a different version (below), so the platform will carry two copies unless 2c unifies them.
- **2c requirement: one noble copy.** nostr-tools 2.25.2, current on npm, pins `@noble/curves` and `@noble/hashes` at exactly `2.0.1`. Adding it beside the deck's `2.4.0` installs a second copy of each.
  - The deck's verifiers check `instanceof secp256k1.Point` against their own copy, so a point built with the other copy is silently rejected: `verifyShare` and the others return false.
  - 2c MUST do one of two things. Either add a pnpm `overrides` entry that resolves every `@noble/curves` and `@noble/hashes` to a single version, and check that nostr-tools works on it. Or route every point that reaches the deck through `decodePoint`, so it comes from the deck's own copy; wire input already does this.
  - The override is preferred, since it also removes the duplicate code. Whichever is chosen is recorded here.
- **Scope:** `src/` of the deck stays pure: randomness is injected (`RandomBytes`), and nothing imports Node or platform crypto. game-kit is a devDependency only, for the seeded test PRNG.
- **Identity point in hashes:** `hs` hashes the identity as 33 zero bytes so in-memory proof code never throws on a degenerate point. The wire decoder `decodePoint` still rejects the identity.

## D024: Deck implementation rulings (2026-10-01, Phase 2b)
- **Identity in hashes:** see D023. PROTOCOL §2 now states it.
- **Identity checks in `verifyShuffle`:** it rejects the identity in `X`, in any output ciphertext and in any proof point. Only the input deck may hold it, because the initial deck's `a` components are the identity. The wire decoders reject the identity everywhere.
- **Joint key:** `jointKey` may return the identity for adversarial keys, and `reEncrypt` under an identity `X` leaves `b` unchanged, so cards would stay readable. The protocol layer (2c) MUST reject a joint key equal to the identity before any shuffle. The deck package leaves that check to it; `proveShuffle` and `verifyShuffle` already refuse an identity `X`.
- **Tamper-suite scope:** at N = 8 the suite tampers every field at every index; at N = 108 every field at the first, middle and last index. Iterating every index at N = 108 would take minutes, and the code path does not depend on the index.
- **No `msm` fast path yet:** `msm` always uses noble's `pippenger`, which costs about 5–6 ms even for 2 or 3 terms, about 3× a plain sum of `multiplyUnsafe` products. `verifyShare` and the 108 three-term `t̂_i` checks in `verifyShuffle` pay this. A small-input fast path is a later, behavior-neutral optimization (PLAN).

## D025: Context-string forms and the decryption API (2026-10-01, Phase 2b final review)
- **Context strings (Ruling 6).** The transcripts hash these identifiers as the UTF-8 of their NOSTR hex text. PROTOCOL §3 and §5 state this.
  - `rootId` is the game root's event id: 64 lowercase hex characters.
  - `npub` and `sessionPub` are 64-character lowercase hex x-only pubkeys, not bech32.
  - `tableAddress` is the NIP-01 address `37450:<creator pubkey hex>:<d tag>`.
  - `deckId` is the module's deck id.
  - **Why:** these are the forms NOSTR tags carry, so a client hashes what it reads off the event with no conversion. Before this, the forms were unspecified, and the vectors used placeholders that no second implementation could learn from.
- **Well-formed strings.** `hs` throws on a string that is not well-formed UTF-16. UTF-8 encoders map every lone surrogate to U+FFFD, so `hs` would otherwise not be injective on JS strings. A user-chosen `d` tag inside `tableAddress` could carry one after `JSON.parse`. The verifiers catch the throw and return false.
- **Vectors.** `v1.json` was regenerated with seed-derived 64-hex ids and a NIP-01 table address. Each shuffle step also lists its transcript `d`, `u_i` and `ch` (Ruling 7), computed by `shuffleTranscript`, the verifier's own code path. It stays version 1, since nothing had been published.
- **Decryption API.** `decryptPosition(ct, ctx, keys, shares, table, own?)` is the one way protocol code turns shares into a card.
  - **Shares.** `shares` is keyed by seat, as an array with one slot per seat (`null` means missing) or a map, so a seat counts at most once. A seat may legitimately publish the same `D` twice with fresh proof randomness.
  - **Verification.** Every share is verified with `verifyShare` against its own seat's key and `ctx`.
  - **Coverage.** Every seat must be covered, by its share or by `own = {seat, D}`. `D` comes from `ownShare(x, ct) = x·a`, which needs no proof and no randomness.
  - **Result.** The card index, or `null` when any share is missing or invalid, or the point is not a card of `table`.
  - **Caller errors throw** a `RangeError`: no keys, a wrong array length, a map key that is not a seat, a bad `own`, or a share for `own.seat` alongside `own`. Peer data never makes it throw.
  - **Argument order.** `table` comes before `own` so that `own` can be a trailing optional parameter.
  - **`combine`** stays exported, documented as low level: it does not verify shares and does not detect duplicates.

## D026: Protocol signs and verifies with noble `schnorr`, not nostr-tools (2026-10-01, Phase 2c)
- **Decision.** `@bored-games/protocol` implements NIP-01 ids, signing and verification directly on `schnorr` from `@noble/curves` (BIP-340) and `sha256` from `@noble/hashes`. It does not use nostr-tools.
- **Why.** nostr-tools bundles its own noble copy, which would give the repo a second copy of the curve code. D023 already records that the deck verifiers check `instanceof` against one copy and fail on a point from another. The NIP-01 pieces needed here are small: the id hash, one signature and one verification.
- **Dependencies.** No new third-party dependency. `@noble/curves` and `@noble/hashes` stay pinned to `2.4.0` (D023), and the workspace packages `@bored-games/deck` and `@bored-games/game-kit` are added.
- **Behavior.** `verifyEvent` is stricter than NIP-01: exact key set, lowercase hex, `kind` in [0, 65535], `created_at` a non-negative safe integer, tags as arrays of strings. It returns false and never throws. `finalizeEvent` takes the 32 bytes of BIP-340 auxiliary randomness from an injected `RandomBytes`.

## D027: Lobby event parsing (2026-10-01, Phase 2c Task 4)
- **Order.** Parsers check the size cap before `verifyEvent`, so an oversized event is dropped before it is hashed. The rest follows PROTOCOL §4: kind, `proto`, required tags, canonical content, then the content's exact shape.
- **Errors.** Parsers throw only `ProtocolError`, with these codes: `too-large`, `invalid-event`, `wrong-kind`, `bad-proto`, `bad-tag`, `bad-content`, and `malformed` for anything unexpected. Deck wire errors and JSON errors are wrapped.
- **Tags.**
  - A listed tag has exactly the items PROTOCOL shows. A relay hint on a `p` tag, for example, is rejected.
  - Tags with other names are ignored, so clients may add `client` or `alt` tags.
- **Formats.**
  - `tableId` has 1–64 characters from `[A-Za-z0-9._-]`.
  - `game` and `v` have 1–64 characters.
  - Counts are decimal without leading zeros.
  - A relay URL is `ws://` or `wss://`, then a DNS-style host, an IPv4 address or a bracketed IPv6 address, an optional port up to 65535 and an optional printable-ASCII path, query or fragment, at most 256 characters in all. Userinfo is rejected. It is checked by hand, because the `URL` global is outside the pure packages' lib. Relay lists (Table, Join, root) have no duplicates.
  - A table has at most 64 seats.
  - A Join carries `rules-hash` and `v` tags committing it to the table's rules and version (PROTOCOL §4.2).
  - A Join's `relays` has one or more entries. A root `e` tag's relay hint is a relay URL or `""`.
- **`validateRoot` additions beyond PROTOCOL §4.3's original list:**
  - The root's rules must equal the table's rules. This only guarantees agreement with the version of the Table the client holds. The Table is addressable, so what stops a creator from switching rules after players join is the Join's `rules-hash` and `v` tags, which `validateRoot` checks against the root.
  - Each seated Join's `rules-hash` and `v` equal the root's.
  - A deck key's x-coordinate must differ from its session key (PROTOCOL §3), and no session key equals any seat's npub.
  - The joint key must not be the identity, which D024 assigns to the protocol layer. If every seat colludes, the seats can choose deck keys that sum to zero, each with a valid proof of knowledge. The cards would then be readable.
  - **OPEN:** `validateRoot` ignores `table.status`. The creator flips `status` after publishing the root, so the order of the two events is not fixed.

## D028: In-game event parsing (2026-10-01, Phase 2c Task 5)
- **Pipeline.** The Move, Shares, Timeout, Secret and Attestation parsers reuse the lobby pipeline (D027) and its error codes. Deck `DeckWireError` becomes `bad-content`.
- **`e` tags.** A Move has exactly one `["e", rootId, "", "root"]` and one `["e", prevId, "", "prev"]`. A Timeout claim has root and `["e", headId, "", "head"]`. Shares, Secret and Attest events have root only. Any other `e` tag, a relay hint, a repeated marker or a non-hex id is rejected. Tags with other names are ignored.
- **Numbers.** `seq` is a decimal integer of at least 1 and `seat` of at least 0, both without a sign or leading zeros.
- **Lists.** `reveals` and `shares` must each be strictly ascending by `pos`, so a position cannot repeat. An empty list is allowed. `parseMove` takes the deck size from its caller and rejects a shuffle step of any other size.
- **Chain link.** `seq` is 1 exactly when `prev` is the root, so a move cannot claim an arbitrary position in the chain.
- **Action.** `action` must be a JSON object. The module validates it later.
- **Attestation.** `audit` is `"pass"` or `{fail, reason}`, where `fail` is a non-empty, strictly ascending list of seats and `reason` has 1–500 code points. `outcome.places` are integers of at least 1, `outcome.scores` are safe integers, and the two lists have equal length. `logHash` is 64 hex characters.
- **`logHash`.** The SHA-256 hex of the UTF-8 of the move ids joined with `\n`. An empty log hashes the empty string.
- **Shape only.** Parsers do not verify proofs, owed shares or `x·G = X_k`. The session engine does (2d).

## D031: Phase 3 frontend dependencies (2026-10-01, Phase 3 Task 2)
- **Frontend (apps/web).** Preact + Signals + Vite (D014 option B), chosen by the controller during the owner-authorized overnight run because it keeps the TypeScript 7 toolchain; the owner may revisit. All three are pinned exactly:
  - `preact` `11.0.0` (the current stable release) and `@preact/signals` `2.11.3`. Together they are about 30 KB gzipped with the protocol code, and signals give the router, the settings and later the game state fine-grained updates without a store library.
  - `@preact/preset-vite` `2.10.6` (dev). It works with the repo's Vite `8.3.1` (its peer range includes `8.x`), so JSX goes through the preset with `jsxImportSource: 'preact'`. It also pulls in `@babel/core`, a dev-time transitive dependency of the build only.
  - `vite` `8.3.1`, the version the root already pins, is repeated in `apps/web` so the package builds on its own.
- **No other dependency.** Bech32 (BIP-173, for `npub` and `nsec`) is about 100 lines in `apps/web/src/bech32.ts`, tested against the NIP-19 vector. The `pnpm dev` launcher is a plain Node script (`scripts/dev.ts`) that spawns the relay and Vite.
- **Impure code.** `apps/web` is not a pure package, but the clock, randomness and storage enter only through `src/clock.ts`, `src/random.ts` and `src/storage.ts`. A repo guard enforces it. Everything else takes them as arguments, so the tests run in Node with fakes.
- **Identity.** A profile (`?profile=<name>`, default `default`) namespaces every key as `bg:<profile>:<name>`. The local secret key is stored as hex. NIP-07 is used only when the user chose it, and every event the extension returns is checked with `verifyEvent`, against the extension's own public key, and against the template that was sent.
- **Note.** Another branch also adds a D029, for `ws`; the two entries are to be merged under one number.

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

## D029: Phase 3 dependencies: `ws` for the dev relay, and the frontend toolchain (2026-10-01, Phase 3)
- **`ws` 8.22.0 (exact), with `@types/ws` 8.18.2 (dev).** Used only by `tools/dev-relay`, an in-memory NIP-01 relay for local development and tests (`pnpm relay`, port 7777). `ws` is the de-facto Node WebSocket server and has zero runtime dependencies. Node has a global WebSocket client but no server, so a hand-written one would be more code than the dependency. It is a dev tool: nothing shipped to browsers imports it.
- **`packages/relay` has no third-party dependency.** It takes the `WebSocket` constructor as an option (the browser's, Node's global, or a fake in tests) and verifies events with `@bored-games/protocol`. It is not a pure package (sockets, timers), so the purity guard does not cover it.
- **Dev relay semantics.** It verifies with protocol's `verifyEvent` and rejects events over `MAX_EVENT_BYTES`. Kinds 30000–39999 are addressable: the latest `created_at` per `(pubkey, kind, d)` wins and, on a tie, the lowest id (NIP-01). A stale version is answered `OK false "replaced: …"`. Other replaceable and ephemeral kinds are not implemented, because the protocol uses none.
- **Frontend dependencies.** This entry also covers the frontend dependencies added in later Phase 3 tasks (the UI framework chosen under D014 and its Vite plugins). Each is listed here with its justification when it is added.

## D032: The Chain Reaction screen components (2026-10-01, Phase 3 Task 5)
- **Props-driven components.** `ChainReactionGame` (exported from `apps/web/src/games/chain-reaction/index.ts`) renders a state, the viewer's legal actions and log lines given by its caller; it holds no game state. The Game route wires it in with the session controller (Task 3).
- **Forms pick from `legal`.** `model.ts` maps the legal list to one decision (`decisionFor`). Every submission is an element of that list, found by canonical JSON: the disposal form looks up `(sell, trade)`, and the end-of-turn form looks up the buy counts per chain plus the declare flag. When nothing matches, submit is disabled and the form says why. Dead-tile discards are not a choice (the engine requires every dead tile), so the form only lists them.
- **No double submission.** After a submission the controls stay locked until the state's `seq` changes or the caller's `busy` falls back to false, so a double click cannot send two moves.
- **Last placed tile.** The state does not record it after a placement resolves, so the caller passes `lastTile` (from `lastPlacedTile(events)`); a tile awaiting a founding or a merger is always marked.
- **Status bar inputs.** Protocol notes ("waiting for shares"), the formatted deadline and the claim-timeout callback are optional props; the component reads no clock.
- **`@bored-games/game-kit` is now a direct workspace dependency of `apps/web`** (canonical JSON for matching actions, the seeded PRNG for fixtures). It is first-party, not a new third-party dependency.
- **Dev preview.** `#/dev/board/<scene>` renders the component from scripted full-mode games (`fixture.ts`). It is rendered only when `import.meta.env.DEV` and is loaded by a dynamic import that production builds drop.
