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
- After the audit, each player's client publishes an attestation signed by its npub. A result is valid when its log verifies, and finalized when everyone attests and the audit passes. Forfeit endings are attested too (D030).
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
- **Amended by D030:** deadlines are measured on each client's clock from the first-seen time of the last progress; an accepted claim forfeits every seat stalled at the head; forfeit endings are attested with the forfeits as the audit verdict.

## D021: Seating (2026-10-01, owner)
The table lists invited npubs and/or open seats; anyone can claim an open seat until the table fills, and the creator then publishes the game root, which fixes the seat order. This covers friends now and public matchmaking later with no protocol change.
- **Default fill order (client, Phase 2d).** `foldLobby` seats the creator, then the invited npubs in list order, then open joiners by the self-declared `created_at` of their earliest valid Join (then id). `created_at` is attacker-controllable: a joiner can backdate a Join to jump the open-seat queue, though never past the creator or an invited player.
- **Explicit seats.** The creator is not bound by that order. `buildRootTemplate(view, relays, createdAt, seats)` takes the Join ids in seat order and checks them with `validateRoot`'s seat rules (creator first, every invited npub present, at most `open` others, no colliding keys), so the creator can choose among open joiners. The root is what fixes the seats; peers accept any valid one.
- **Collisions and recovery.** The fold drops a Join whose session key is its own npub or its deck key's x-coordinate, then walks each npub's Joins in time order and seats the first that collides with no seat already taken. A player whose earlier Join collides can re-join with fresh keys and take its slot. With D033, only the holder of a key can cause a collision with it.
- **Later.** Hardening open seats for public matchmaking is deferred to the matchmaking work.

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
- **Shape only.** Parsers do not verify proofs, owed shares or `x·G = X_k`. The session engine does (2d, D030).

## D031: Phase 3 frontend dependencies (2026-10-01, Phase 3 Task 2)
- **Frontend (apps/web).** Preact + Signals + Vite (D014 option B), chosen by the controller during the owner-authorized overnight run because it keeps the TypeScript 7 toolchain; the owner may revisit. All three are pinned exactly:
  - `preact` `11.0.0` (the current stable release) and `@preact/signals` `2.11.3`. Together they are about 30 KB gzipped with the protocol code, and signals give the router, the settings and later the game state fine-grained updates without a store library.
  - `@preact/preset-vite` `2.10.6` (dev). It works with the repo's Vite `8.3.1` (its peer range includes `8.x`), so JSX goes through the preset with `jsxImportSource: 'preact'`. It also pulls in `@babel/core`, a dev-time transitive dependency of the build only.
  - `vite` `8.3.1`, the version the root already pins, is repeated in `apps/web` so the package builds on its own.
- **No other dependency.** Bech32 (BIP-173, for `npub` and `nsec`) is about 100 lines in `apps/web/src/bech32.ts`, tested against the NIP-19 vector. The `pnpm dev` launcher is a plain Node script (`scripts/dev.ts`) that spawns the relay and Vite.
- **Impure code.** `apps/web` is not a pure package, but the clock, randomness and storage enter only through `src/clock.ts`, `src/random.ts` and `src/storage.ts`. A repo guard enforces it. Everything else takes them as arguments, so the tests run in Node with fakes.
- **Identity.** A profile (`?profile=<name>`, default `default`) namespaces every key as `bg:<profile>:<name>`. The local secret key is stored as hex. NIP-07 is used only when the user chose it, and every event the extension returns is checked with `verifyEvent`, against the extension's own public key, and against the template that was sent.
- **Numbering.** D029 covers `ws` and Playwright; this entry covers the frontend.

## D014: UI framework for apps/web (Phase 3)
**Answered by D031:** option B, by controller ruling during the owner-authorized overnight run. The owner may revisit. The original proposal offered two options:

| | **A. Svelte 5 + Vite** | **B. Preact + Signals + Vite** |
|---|---|---|
| Size and speed | Compiled, very small bundles, fast | ~4 KB runtime, fine-grained signals, fast |
| Ergonomics | Concise components, built-in transitions; great for a board, animations, merger dialogs | JSX; React-like patterns, very familiar |
| Typing | Needs `svelte-check`, which uses the TypeScript programmatic API, so apps/web would pin TS 6.x | Plain `tsc` checks JSX, so TS 7 works as-is |
| Ecosystem | Smaller, but good PWA support (vite-plugin-pwa) | Can use most React libraries via `preact/compat` |
| Mobile / Capacitor | Static output, works | Static output, works |
| Risk | Toolchain split (TS 6 for web) | Easier to write unidiomatic code; more manual animation work |

Either keeps the client a static SPA with relative asset paths, ready for Capacitor.

## D029: Phase 3 dev dependencies: `ws` for the dev relay, and Playwright (2026-10-01, Phase 3)
- **`ws` 8.22.0 (exact), with `@types/ws` 8.18.2 (dev).** Used only by `tools/dev-relay`, an in-memory NIP-01 relay for local development and tests (`pnpm relay`, port 7777). `ws` is the de-facto Node WebSocket server and has zero runtime dependencies. Node has a global WebSocket client but no server, so a hand-written one would be more code than the dependency. It is a dev tool: nothing shipped to browsers imports it.
- **`packages/relay` has no third-party dependency.** It takes the `WebSocket` constructor as an option (the browser's, Node's global, or a fake in tests) and verifies events with `@bored-games/protocol`. It is not a pure package (sockets, timers), so the purity guard does not cover it.
- **Dev relay semantics.** It verifies with protocol's `verifyEvent` and rejects events over `MAX_EVENT_BYTES`. Kinds 30000–39999 are addressable: the latest `created_at` per `(pubkey, kind, d)` wins and, on a tie, the lowest id (NIP-01). A stale version is answered `OK false "replaced: …"`. Other replaceable and ephemeral kinds are not implemented, because the protocol uses none.
- **Frontend dependencies** (the UI framework chosen under D014 and its Vite plugin) are recorded in D031.
- **Addendum (Phase 3 Task 6): `@playwright/test` 1.56.1 (exact, dev, `apps/web` only).** It drives the end-to-end browser test (`apps/web/e2e/play.spec.ts`, run by `pnpm e2e`). Real browsers are the only way to check the whole stack together (Preact screens, `localStorage` profiles, WebSockets to a relay, the shuffle proofs in the page), and Playwright's role and text locators and auto-waiting keep a multi-minute, three-player test free of sleeps. Version 1.56.1 is the one whose Chromium build (revision 1194) the dev container already has under `/opt/pw-browsers`, so no browser download is needed there; elsewhere `pnpm --filter @bored-games/web exec playwright install chromium` fetches it, and `E2E_CHROMIUM` can point at another binary. It brings only `playwright` and `playwright-core`, is never imported by `src`, and is not part of `pnpm check`.
  - **Test plumbing that came with it.** `pnpm e2e` (`apps/web/e2e/run.ts`) starts the dev relay in-process on a free port, builds the app, serves it with `vite preview` on another free port, runs Playwright, and stops both servers. A production build has no dev relay in its defaults, so the app accepts `?relays=<url>[,<url>…]`, which replaces the profile's saved relay list on load (as if edited in Settings; local relays only since D035); share links drop it so a recipient's list is never overwritten. The game root carries `data-seq`, `data-turn` and `data-phase` for tests.

## D032: The Chain Reaction screen components (2026-10-01, Phase 3 Task 5)
- **Props-driven components.** `ChainReactionGame` (exported from `apps/web/src/games/chain-reaction/index.ts`) renders a state, the viewer's legal actions and log lines given by its caller; it holds no game state. The Game route wires it in with the session controller (Task 3).
- **Forms pick from `legal`.** `model.ts` maps the legal list to one decision (`decisionFor`). Every submission is an element of that list, found by canonical JSON: the disposal form looks up `(sell, trade)`, and the end-of-turn form looks up the buy counts per chain plus the declare flag. When nothing matches, submit is disabled and the form says why. Dead-tile discards are not a choice (the engine requires every dead tile), so the form only lists them.
- **No double submission.** After a submission the controls stay locked until the state's `seq` changes or the caller's `busy` falls back to false, so a double click cannot send two moves.
- **Last placed tile.** The state does not record it after a placement resolves, so the caller passes `lastTile` (from `lastPlacedTile(events)`); a tile awaiting a founding or a merger is always marked.
- **Status bar inputs.** Protocol notes ("waiting for shares"), the formatted deadline and the claim-timeout callback are optional props; the component reads no clock.
- **`@bored-games/game-kit` is now a direct workspace dependency of `apps/web`** (canonical JSON for matching actions, the seeded PRNG for fixtures). It is first-party, not a new third-party dependency.
- **Dev preview.** `#/dev/board/<scene>` renders the component from scripted full-mode games (`fixture.ts`). It is rendered only when `import.meta.env.DEV` and is loaded by a dynamic import that production builds drop.

## D033: The Join proves possession of its session key (2026-10-01, Phase 2d security fix)
- **Finding.** A Join's `session` was a bare pubkey. The deck key had a proof of knowledge bound to `[tableAddress, npub, session]`, but nothing proved that the joiner owned `session` itself. An attacker could copy another player's `session` into their own Join, with a fresh deck key and a valid proof for it. The lobby's session collision filter then evicted the victim. The victim could not recover either, because the fold kept only one Join per npub (the earliest) before it ran the collision filter.
- **Fix.** The Join content gains `sessionSig`: a BIP-340 signature by the session secret key over `SHA-256(UTF-8("bored-games/v1/session\n" + tableAddress + "\n" + npub))` (PROTOCOL §3, §4.2). `parseJoin` verifies it against `session` and throws `bad-content` when it is missing, malformed (128 lowercase hex) or wrong. `signSession(sessionSk, tableAddress, npub, rnd)` makes it; specs carry the signature, never the secret.
- **Why a separate signature, not a wider PoK.** It is a plain BIP-340 signature by the key that later signs every in-game event, so it proves exactly that key, with the code that already verifies events. The message binds the npub and the table address, so a copied `session` and `sessionSig` fail on any other Join and at any other table. It is domain-separated from NIP-01 event ids by its prefix, so it can never double as an event signature.
- **Consequence.** Every collision the lobby and `validateRoot` check (a repeated session, a session equal to a seat's npub, a seat's npub equal to another's session) now needs the colliding session's secret key. No outsider can trigger the session collision filter against an honest player; only someone who holds the key, that is the player themselves or a party they gave it to, can. The deck-key collisions were already protected by the PoK.
- **Compatibility.** Nothing had been published under protocol version 1, so the field is added without a version bump.

## D034: Lobby and game controllers (2026-10-01, Phase 3 Task 3)
- **Plain classes holding signals.** `LobbyController` and `GameController` (`apps/web/src/*-controller.ts`) take their dependencies in the constructor (`ControllerDeps` in `net.ts`: pool, identity signer, store, profile, relays, randomness, clock, modules, timers). Tests run them in Node against the dev relay. Timers come from `clock.ts`, so the repo's impurity guard still holds.
- **Lobby queries.** Relays do not index multi-letter tags, so open tables are `{kinds:[37450], limit:200}`, filtered here to registered games with `status: open`. "My tables" are those I authored plus a per-profile list of addresses (`bg:<profile>:tables`). Joins and roots come from `#a`.
- **Start.** The creator signs the root, saves it (`bg:<profile>:root:<address>`) before publishing, and republishes that saved root rather than signing a second one. The table is then republished with `status: started` and a later `created_at`. Every seated player saves the root id with its game secrets.
- **Outbox, never re-sign (PROTOCOL §9).** Every event the game controller builds is saved under `bg:<profile>:outbox:<rootId>`, by slot (`move:<seq>:<prev>`, `deal`, `secret`, `attest`, `timeout:<seat>:<head>`), before it is published, and is folded in locally first: an event the session refuses becomes an orphan and is never published. A slot already holding an event is reused instead of building a new one, including one written by another tab of the same profile. A move that cannot be saved is not published at all. Own events the session refuses later (a pooled move whose parent lost) are marked orphans when retried. The outbox is deleted once the game is `done` or `cancelled` and everything in it is delivered or orphaned. A reopened tab folds in its outbox and republishes what no relay has confirmed. An entry is confirmed by a relay `OK` or by the relay echoing it. This keeps a seat from ever signing two moves on one parent (§6.6).
- **Duty loop.** After each batch of events, the controller performs at most one automatic duty at a time (shuffle, deal, secret, attest), yielding first so the screen can show "working". A duty that throws, or that is still due after its event was folded in, is not retried at that head. Only `decide` waits for the player (`act`, which owns `busy` and rejects a second call while one is in flight).
- **Attestations** are the session's `attestTemplate(createdAt)` (Phase 2d Task 4), signed by the npub signer. A session without it does not attest.
- **Statuses.** `working` is shown only for automatic duties and "Sending your move…" only for `act`. A failed automatic duty shows `stuck`. `your-turn` is withheld while a move of mine on the current head is saved but not yet folded in.
- **Double submissions.** `LobbyController.start` and `join` keep one in-flight promise per address and hand it to concurrent callers, so a NIP-07 prompt held open by a double click never yields two roots or two Joins. `GameController.act` refuses a second call while `busy`, and `#commit` refuses after `dispose` (re-checked after every await).
- **Relay input is not trusted.** The game loader accepts a Table only at the root's address (same creator and `d` tag; NIP-01 tie rule) and a Join only if the root seats its id and its `a` tag names that address; the root must have the route's id. The lobby holds at most 500 tables and 200 Joins and roots per table (dropping the oldest that hold no seat), and caches parsed tables and folds per address.
- **Timeout claims are a button,** shown when `timeoutTarget(now)` names a seat, rather than automatic: a claim forfeits another player, so a person makes it.
- **Pool changes.** `onEose` is delivered in a microtask (never inside `subscribe`), a consumer's exception is swallowed, and each subscription has an EOSE deadline (default 8 s) after which `onEose` fires anyway. `addRelays(urls)` connects a game's relays to the shared pool, and `publish(ev, urls)` sends to a chosen subset (the root's relays plus the player's own).
- **Workspace dependencies of `apps/web`:** `@bored-games/client`, `@bored-games/relay` and `@bored-games/deck` (first-party), and `@bored-games/dev-relay` for tests. No third-party dependency is added.

## D030: Game-session rulings (2026-10-01, Phase 2d)
The rules the session engine (`GameSession` in `packages/client`) implements. They were set as R1–R6 in the Phase 2d plan, then amended by the review rulings (numbered 1–12 in the order they were made; Ruling 1 was process, and Ruling 2 is D033). They change PROTOCOL v1, which is not yet published, so there is no version bump. PROTOCOL §6–§8, §10 and §11 state them normatively; this entry records the reasons.

**Owed shares (R1, PROTOCOL §6.2).**
- A game-action move by seat k on parent state S is acceptable only if, counting k's verified shares already held plus those in the move, k has a share for every position that `dealt(S)` assigns to another seat or to `null`.
- **Stated monotonically.** The rule counts only what is held, never what is absent. A move that fails only this rule is **buffered**, not rejected, because the missing shares may still arrive in an earlier Shares event. So clients converge whatever order events arrive in.

**The fold (PROTOCOL §6.3–§6.5).**
- Every received event first goes through the size cap, `verifyEvent` and the strict parser, and its signer must be a seated key (session key for in-game kinds, npub for attestations). `receive` never throws on peer input.
- Moves are pooled by `prev` until they link. A game action waits while the deal is incomplete, while a public reveal is pending, while another seat's share of a revealed position is missing, and while R1 fails. Any other failure makes it invalid. A pooled move is judged when its prev links, and an invalid one is dropped for good, since a prev fixes its whole ancestry.
- `revealsOf` is syntactic, so its claims are trusted only for an action `apply` accepts: `apply` runs on the state first, then the reveals are checked.
- **Derived reveals** are applied once the deal is complete, while the module pends a reveal whose positions all have N shares, in ascending position order. They go into the **interleaved action log** with the game actions, in fold order, for the audit.
- **Private learns** start with the play phase, after the setup reveals, so the module's state and event log do not depend on the order in which the deal's Shares events arrived.
- Shares: at most one verified share per (seat, position), the first valid one kept (D025).

**The decide gate (Ruling 4).**
- `decide` is due when the pending decision is mine and `module.legalActions(state, me)` is non-empty, and `legalActions()` returns that list.
- **Why.** The first gate also required the seat's whole hand to be decrypted, and it deadlocked honest games: a merger disposal is an out-of-turn decision, and it can come before the other seats have shared the seat's last-drawn tile. All three end-to-end games in that review stalled at a disposal.
- **Contract.** It relies on `GameModule.legalActions` being exact or empty (below).

**Equivocation (R2, refined by Rulings 3 and 5).**
- **What counts (Ruling 3).** Two distinct moves with the same (prev, seq, signer), both valid as of prev on everything except R1: the signer is pending, every share and reveal proof verifies, the reveals decrypt to the claimed cards, and `module.apply` accepts. An invalid move is ignored and never counts. The original R2 counted any two parseable moves, which would have let a seat's own malformed retry or a module-rejected action trip it. Shuffle steps: Ruling 12 (below), which counts them without their proofs.
- **What it does (Ruling 5).** The seat is flagged (`view().equivocators`). The game is never stopped, rewound or cancelled. At the end the flagged seats forfeit with R5's end adjustment, and the audit still runs.
- **Why (Ruling 5 replaced rollback and "equivocation before the first action cancels").** With rollback, one `receive` of a late re-signed old move let a seat rewind or cancel any game, even a finished one.
- **Builders.** Each builder draws fresh randomness, so building twice for one decision is equivocation. Clients build once, persist and rebroadcast (the web controller's outbox, D034).

**Fork choice (Rulings 5 and 9).**
- From the root, at each prev on the chain, the next move is the successor heading the best valid branch, ranked by **(reaches the module's `over` desc, length in accepted moves desc, lowest id)**.
- **Why `over` first (Ruling 9).** With length alone, the last mover could reopen a done game, with every secret already public: either a rival to its final move without `declareEnd` and with a lower id, or a longer replacement for its last turn.
- **Two endings.** When two branches both reach `over`, length and then id decide, and the equivocator is flagged and ranked last either way. The last mover can therefore still choose between alternative endings it signed. That can change the other seats' relative order and the `logHash`. This is accepted as weak, because it costs the seat its own place.

**Shuffle candidates (Ruling 12, which replaces the rival-shuffle cap).**
- **(a) Flagging without proofs.** Two distinct well-formed shuffle steps flag their seat when both are seq ≤ S, signed by seat seq − 1, on the same prev, and that prev is the chain's move at seq − 1. Their proofs are not checked. Well-formed means the event parsed and passed the shape check: the right signer for its seq. Only that seat's key can sign both, and an honest client never signs twice, because the web outbox and the sim persist what they built. Ruling 3 still governs game actions.
- **(b) Eligibility.** Per group `prev:seq:seat`, let C be the well-formed steps held. If |C| ≤ 3, every step in C is a fork-choice candidate. If |C| > 3, only **acknowledged** steps are: a step is acknowledged when some well-formed move signed by another seat lies 1 to 32 moves below it along `prev`, every move on that path held. Both conditions are functions of the event set alone and read no chain or proof state, so every client holding the same events has the same candidates. Acknowledgement only grows; the |C| ≤ 3 condition can be lost when the group grows, which (c) handles.
- **(c) No cap rejections.** A step that is not a candidate stays pooled and unverified, and becomes a candidate if it is acknowledged later. The only rejections left are a bad shape and a failed proof. A step on the chain that stops being a candidate (its group grew past 3 and nobody acknowledged it) is cut back off the chain, with everything after it.
- **(d) Fork choice is unchanged:** (reaches `over`, length, lowest id), over candidates only.
- **Why.** The cap it replaces (per prev and signer, verify only the 3 lowest-id steps other than the chain's own) still split clients for good, as the final re-review reproduced. Seat 1 signs valid steps `a` and `b` and 3 junk steps with lower ids, and seat 2 builds `c` on `a`. Delivered as `[s0, junk×3, b, a, c]`, a client linked `b` at the head, then ignored `a` for good as the 4th rival, so `c` never linked: the chain stopped at `[s0, b]`. Delivered as `[s0, junk×3, a, b, c]`, it ended at `[s0, a, c]`. Neither flagged seat 1, because the junk never verified and one valid step was always ignored. Three things made the kept set depend on arrival order: failing junk took cap slots, the exemption for the chain's own step depended on which step linked first, and an ignored rival was rejected for good. The cap did not bound the work either: delivered in descending id order, every junk step was briefly among the 3 lowest and was verified.
- **Bound.** Per group, a client verifies at most the 3 steps that arrive while the group holds 3 or fewer, plus the acknowledged ones. Acknowledging junk takes another seat's signed move.
- **Accepted consequence.** A seat that publishes more than 3 unacknowledged steps on one prev stalls its own position: none of them links, so the timeout falls on it (cancel, or forfeit once play started). It is flagged as well.
- **Residuals.**
  - Colluding seats can acknowledge junk: each colluder move can make steps above it candidates, at no more than one failing verification per colluder move.
  - The last shuffler, if it is also the first actor, can withdraw its step (by publishing 3 more) until someone else moves. The deal's Shares events are not moves, so this window spans the deal. It flags the seat, but a withdrawal inside the window between clients' acceptance of a timeout claim splits them like the claim race (below), as a lower-id re-signed head move already can. The adversarial review judged this the same class as that residual, not a new split: both need the head signer to act inside the claim window.
  - The last shuffler sees its own hand once the deal starts, so it can withdraw or re-sign its step after seeing it. This was already possible before Ruling 12 (a lower-id re-sign); the seat is flagged either way.
  - The pool of held moves still grows without bound (Deferred, below).

**Timeouts (Ruling 10, which replaces R3's date rules, the far-future clamp and Ruling 6).**
- **Local time.** `receive(ev, now)` takes `now` as the time this client first saw `ev`. Clients persist first-seen times by event id (the web controller does), so a reload keeps them.
- **Progress time P** is the largest first-seen time over the root, the canonical chain's moves, and the Shares events and secrets that removed a seat from the stalled set at the head (Ruling 11, below).
- **Acceptance.** A claim is accepted iff its head is the current head, some seat is stalled there (R4), its claimant is **not** stalled there, and the client's `now ≥ P + deadline`. The claim's own `created_at` is ignored, and the seat it names is a shape check only (a seat other than the claimant's). A stalled claimant is rejected because its own claim would otherwise turn valid the moment it unstalls itself.
- **Order: progress before claims.** When a Shares event or secret is folded, the session records its progress first and only then judges the stored claims (final review, Critical 1). Judging first let a stalled seat publish a claim and then its own share or secret: clients that got them in that order accepted the claim against the old P, while the others gave the remaining stalled seat a fresh deadline. A claim that is not yet acceptable is kept, judged again on later events and on `tick(now)`, and rejected once its head is no longer current.
- **On acceptance, every seat stalled at the head forfeits** (R4), whichever claim was accepted and whom it named. Flagged equivocators forfeit with them.
- **Targets.** `timeoutTarget(now)` is the lowest stalled seat other than mine once `now ≥ P + deadline`, and null while my own seat is stalled; `buildTimeout` names that seat and dates the claim `now`.
- **Why local time.** Every date-based rule failed review, because `created_at` is whatever the signer writes:
  - R3 judged claims by their own `created_at`, so a seat could postpone every timeout by dating a share years ahead. The far-future clamp that fixed this (ignore progress dated after the claim) let a seat date its turn-passing move ahead and claim against the next seat one second after its own deadline. Ruling 6 (the head move always counts) closed that hole.
  - Even so, a head move dated far ahead still put off every claim against the next seat indefinitely. A seat could also backdate its turn-passing move, so that the next seat's deadline had all but passed when the move arrived.
  - Backdated shares split clients' stall attribution.
  - With the forfeits taken from the deciding claim's named seat, the result depended on which claim decided, which let a claimant shift the blame.

  With first-seen times nobody can move anybody's deadline but the client's own clock, and the forfeits depend only on the head and the held events, not on the claim.
- **Cost.** Clients judge on their own clocks, so they no longer accept a claim at the same moment. That gives the race below.

**Who is stalled (R4).**
- Shuffle: the next shuffler.
- Deal: every seat whose owed deal positions (dealt to another seat or public) are not all covered.
- Play, a player decision: the pending seat. Exception: one of the positions dealt to it lacks another seat's share, and the module lists no action for it on the public state (`legalActions(view(state, null), seat)`, so every view agrees). Then the decision needs that card, and the stalled seats are those missing a share of such a position.
- Play, a pending public reveal: the seats missing a share of it.
- End: every seat without a verified secret.

**Forfeit outcomes (R5, with Ruling 7).**
- **Before the first game action** (no game action on the chain): phase `cancelled`, no outcome and nothing to attest. `forfeits` lists the stalled seats and any equivocator.
- **During play:** phase `done` at once. The outcome is `rankWithForfeits(standings(state), forfeits, null)`: forfeiting seats share the last places, the others are ranked by standings, descending, with ties sharing a place. The reason is `forfeit`.
- **At the end** (secrets missing): phase `done`. The withholders and any equivocator forfeit, and the others keep their declared order.
- **At a normal end** (a failed audit or an equivocation): the declared order is kept among the others, the forfeiters move to shared last places, and the declared scores are kept.
- **Ruling 7: forfeit endings are attestable.** After a timeout the R6 audit cannot run, because the deck cannot be decrypted without every secret. The audit field records the forfeits instead: `{fail: [forfeiting seats ascending], reason: 'timeout'}` during play, and `reason: 'withheld secret'` at the end. The result is attested with the existing protocol shape, so forfeits count for stats (D020). Ruling 7 also lists the reason `equivocation`, but under Ruling 5 equivocation never ends a game, so no path produces it.

**Finality and the race.**
- **Finality.** Once a client accepts a claim at head H, its result is final. Later moves, Shares events and secrets are stored and change nothing, fork choice stops, and a late move on H is ignored. Attestations are still accepted.
- **The race (documented, accepted).** A client that linked the stalled seat's late move first rejects the claim, because it names an old head. A late share or secret can likewise shrink the stalled set, or restart the deadline, on clients that fold it before accepting. So a stalled seat that acts inside the window between different clients' acceptance can split them. The window opens only after a full deadline of the seat's silence. `created_at` cannot break the tie, since any date can be claimed.
- **Ruling 11: what counts as progress.** Progress time P counts the root, canonical chain moves, and Shares events or Secret reveals that removed a seat from the stalled set at the head. A Shares event that adds shares without unstalling anyone is not progress, so a stalled seat cannot restart its own deadline by dripping new shares.

**Audit (R6, PROTOCOL §7).**
- Once every seat's secret is known (verified by `x·G = X_k`), decrypt each final-deck position with `decryptWithSecrets` and `cardOf`, set up the module in full mode with that order, and replay the interleaved action log.
- The first rejected game action fails its actor: `audit: {fail: [actor], reason}`.
- A rejected derived reveal, an undecryptable position or a refused full-mode setup fails every seat, since no single seat is to blame. So does a replay whose `outcome` differs from the view's ("outcome mismatch").
- Otherwise `audit: 'pass'`. The audit runs only on the canonical chain and is cached by log hash.

**Attestations.**
- Result attestations are signed by the seat's **npub**, which the session does not hold, so it returns the unsigned template (`attestTemplate(createdAt)`).
- One counts when it is signed by a seated npub and its `{audit, logHash, outcome}` equals the session's own.
- Each seat's latest attestation by (`created_at`, id) is kept, the higher id winning a tie, so the kept one does not depend on arrival order; the seat is attested iff that one matches. A mismatching latest one is kept, since the result may change as events arrive.

**DoS bounds.**
- **Claims (Ruling 8, made order-independent).** A session keeps the 4 lowest-id claims per signer per head, evicting the highest, and at most 8 claims per signer naming heads it has not linked.
- **Rival shuffle steps (Ruling 12).** Per `prev:seq:seat` group, only the steps that arrive while it holds 3 or fewer are verified, plus those another seat acknowledges; the rest stay pooled and unverified, whatever the arrival order.
- **Duplicates.** A held event id is answered `duplicate` before parsing, so a re-sent shuffle step is not verified again (a sim finding).
- **Fork trials (Task 4 review, with Ruling 9):**
  - A pooled move found unable to link at its prev (waiting on R1 or a missing reveal share) is marked stuck for the current share set. It counts as depth 1 at most, and nothing below it counts.
  - `poolDepth` is iterative and capped at 64. When the chain is over, a side branch whose bound cannot reach the chain's length past the prev is skipped without a trial.
  - Each fork prev's best side branch is memoized, keyed by a pool version counter and a share-set counter. The pool counter is bumped on every insert or removal below the prev and passed up through pooled ancestors (at most 64 steps), stopping at a stuck move. The share-set counter is bumped only when a Shares event adds a new share, never when it merely repeats one.
  - Trial folds skip the audit and private learns. They need only validity, length and whether the branch reaches over.
  - **Residual.** Junk under a rival that can link still costs one trial per junk event, paid for by the attacker's own events. The first trial drops the junk as invalid.

**Contract notes for modules (`GameModule`, PROTOCOL §10).**
- **`legalActions` is exact or empty.** It must return [] whenever the legality of any action it would list depends on hidden cards the seat has not learned, so a non-empty list is exact. The decide gate relies on this, and so does R4's play attribution, which calls it on `view(state, null)`. Chain Reaction complies.
- **`learn` and arrival order.** A learn's place among other seats' actions depends on when shares arrive. Learns must commute with actions, since a branch switch restores a snapshot and redoes them. A module's `learn` should emit no events, since their place in `view().events` would depend on arrival order. Chain Reaction's emits none.
- `dealt` is append-only and identical across views, and `standings` uses public data only (D020).

**Session API notes.**
- `view().events` holds the module's events from every `apply` and `learn` on the canonical chain, in fold order, the last 300. A branch switch restores it from the snapshot.
- The session supports exactly one deck, and it throws `ClientError` at creation otherwise.

**Deferred.**
- The claim race (above) is documented, not solved.
- A derived reveal that fails to decrypt or apply stops silently. It cannot happen with verified proofs.
- The pool of moves under unlinked prevs is bounded only by the event-size cap and the seated-key check.
- The validity of a seat's own moves is view-dependent: a cheater's own client judges its forged move with its real hand. Other seats' moves are judged the same by every view.
- The NIP-78 key backup and the live relay smoke test (Phase 2e), and hardening open seats for public matchmaking (D021).

## D035: Final Phase 3 polish (2026-10-01, Phase 3)
- **`?relays=` accepts local relays only.** A link could otherwise move a player onto relays an attacker runs (to censor, delay or watch their games), and the list is saved for later visits. The parameter is honoured only when every entry is `ws://localhost[:port]` or `ws://127.0.0.1[:port]` (`isLocalRelayUrl` in `apps/web/src/settings.ts`), which is all `pnpm dev`, `pnpm e2e` and local setups need. Otherwise the whole list is ignored and the page shows "Ignored relays from the link; change relays in Settings." Narrowed further by D036: only dev servers and e2e builds honour it.
- **Game log and last tile.** The Game screen maps the session's `view().events` through `describeEvent` (the newest 100 lines, newest last) and takes the last placed tile from them (`lastTileOf`), replacing the diff of consecutive states.
- **Timeout claims are confirmed.** "Claim timeout" opens a confirm step that says what the claim does: the stalled seat forfeits and the game ends, or, before the first game action, the game is cancelled. The button also shows on the setup screen, since a shuffle or deal can stall too.
- **Player names from kind 0.** The game controller subscribes to `{kinds:[0], authors: seats}` on its pool and keeps the newest event per seat (checking kind and author itself). The name is `display_name`, else `name`, with control and format characters removed, whitespace collapsed and at most 32 characters. It is always shown with the short npub ("Ann (npub1…)"), so a chosen name cannot pass for another player. No new dependency.

## D036: Final review fixes before public use (2026-10-01, Phase 2d/3 final review)
- **Game subscription by seated authors.** Once the root is parsed, the game controller asks for kinds 7452–7455 from the seats' session keys and 7456 from their npubs, tagged with the root, and drops any other event before buffering. Without `authors`, anyone could flood the public root tag and push the real shuffle steps out of a relay's capped answer, so a reloading client never loaded the game. Stored events come in pages of 500, paged backwards with `until` (the oldest `created_at` among the page's seated events not seen before) while a page brings such an event, so a relay's own cap cannot hide events, and neither strangers nor already-seen events steer `until`. **Known gap (across relays):** the pool merges relays into one subscription and delivers each event once, so a single `until` serves every relay. When one relay caps its page at a later date than another's, the next `until` is the earlier date, so that relay's events between the two dates are never asked for again: they arrive only if another relay also holds them. Per-relay paging needs a single-relay subscribe in the pool and is left for later. The pre-EOSE buffer holds 100,000 seated events; past that, loading stops with an error rather than dropping events silently.
- **The validated Table is saved per game.** The Table is addressable, so after the start its creator can republish it (another deadline, other invitees) and every client that loads the game afterwards would fail `validateRoot`. On the first successful load the controller saves the Table event the root validated against (`bg:<profile>:table:<rootId>`) and prefers it later. Without a saved one it tries every Table version the relays sent, newest first. A fresh client that only sees a republished version still cannot load the game; binding `deadline` and `seats` into the Join (so the root validates without the mutable Table) stays with the owner's protocol review (PLAN open question 9).
- **`?relays=` only in dev servers and e2e builds.** Even a local relay in a link replaced a player's saved relay list on the published site and silently cut them off from their games. The parameter is honoured only when `import.meta.env.DEV` is set (`pnpm dev`) or the build sets `VITE_ALLOW_LINK_RELAYS=1` (`pnpm e2e` does); otherwise it is ignored with the usual notice.
- **Shared origin on GitHub Pages.** A project site at `https://<owner>.github.io/<repo>/` shares its origin, and so its `localStorage`, with every other Pages project site of that owner. The identity key (`bg:<profile>:sk`) and per-game secrets are readable by any script on any of them. Before sharing the app widely, deploy it on a dedicated origin: a custom domain or subdomain, or a Pages user or organization site used only for this app. No code change; TESTING.md §2 says so.
- **Refused single-slot events are rebuilt.** A saved deal, secret or attestation that the session refuses (an orphan, after a shuffle fork or a changed result) is built anew instead of being resent forever. None of them is a chain move, so a second one is never equivocation: later shares of a position are ignored, a secret is one value, and the latest attestation per seat is the one that counts. Move slots still never rebuild.
- **A missing extension is announced.** When NIP-07 was chosen in Settings, the app waits up to a second for a late `window.nostr`, then falls back to the profile's local key with the banner "Browser extension not found; using this profile's local key." instead of switching identity silently.

## D037: Hidden holdings and cash in the UI (owner, 2026-10-01)
- **Rule (RULES "Assets", "Hidden information").** At a real table, players cannot see how many shares the others hold, only that they hold some, nor how much money they have, only whether they have any; they can watch purchases happen and remember them. So a player sees their own cash and holdings exactly; of other players, only which chains they hold shares in and whether they have any cash (cash > 0). Bank supply stays exact and public. Everything becomes public when the game ends. Spectators see every player in the hidden form.
- **UI-only.** The engine, the protocol and the public move log are unchanged; the client never shows the numbers. It is a table-manners rule: anyone can still derive them from the public move log, by design. In `apps/web`, `playerRows` carries `cash: number | null` and `shares: {chain, count: number | null}[]` with the hidden numbers absent, so a component cannot leak them by accident. The Chains panel (size, price, bank supply, "Mine"), the decision forms (own holdings and cash only) and the results view are unchanged.
- **The log is a memory aid of one turn.** `logLines(events, {mySeat, over, names})` keeps exact lines for events of the current and the previous turn; older lines about another player's purchase, disposal, bonus or final sale drop their counts and amounts ("Ann bought Jade and Lapis shares.", "Bo received a bonus for Onyx."). An event belongs to the turn of the last `turnStarted` before it, so a merger's bonuses and disposals belong to the turn that caused it. The viewer's own lines stay exact forever, and every line is exact once the game is over. Bonus lines also drop the role (majority, minority), since role and price give the amount. Founding lines stay exact, except that on older turns the share-total parenthetical ("(3 old shares still held)") is dropped for every viewer, the founder included, since it sums every player's holdings of the chain.
- **Rejected: cryptographic hiding.** Hiding cash and holdings from the move log would need hidden purchases, a commitment scheme for every balance, and proofs for bonuses, legality checks (affordability, majority) and final scoring. That is a large protocol and engine change for a casual-play rule that a real table does not enforce cryptographically either.
- **Rejected: rough bank levels.** Showing bank supply as bands (plenty, few, none) instead of exact numbers. Exact bank supply is public at a real table and players need it to plan purchases and trades; hiding it would change play without hiding holdings any better.

## D038: relay.primal.net is the default relay (owner, 2026-10-01)
- **Decision.** The app's default relay list is `wss://relay.primal.net` alone, for everybody (`DEFAULT_RELAYS` in `apps/web/src/settings.ts`). It replaces `wss://relay.damus.io`, `wss://nos.lol` and `wss://relay.nostr.band`. In development the local dev relay still comes first.
- **Why.** One relay that every player shares means a table created with the defaults is always found by joiners using the defaults, with no relay coordination.
- **Large events.** A probe on 2026-10-01 published signed kind-7452 events of 8, 36 and 60 KB to relay.primal.net; all three were accepted (`OK true`) and served back by a `#t` query, so the ~36 KB shuffle steps (PLAN open question 7) fit.
- **Cost.** A single relay is a single point of failure: if it is down, or later tightens its limits, no game on the defaults can proceed. Players can add relays in Settings; a table's events go to its creator's relays.
- **Existing profiles** keep the relay list they saved; **Settings → Reset to defaults** picks up the new default.

## D039: Prompt decryption shares for a drawn tile (owner request, 2026-10-02; residual risk awaits owner sign-off)
- **Problem.** The engine draws at End turn, so the bag position belongs to the drawer at once, but the drawer reads the tile only once every other seat's decryption share is in. Those shares rode only on each other seat's next move (PROTOCOL §6.2), so a new tile showed "?" until everyone else had moved, often hours in async play.
- **Decision.** In the play phase, a seat publishes the shares it owes in one Shares event (7453) as soon as it sees them owed, without waiting for its next move. PROTOCOL §6.2 makes it a SHOULD ("prompt sharing"). The rule that a move carries every share its seat still owes is unchanged and stays the liveness guarantee for a seat that is offline.
- **Client.** `GameSession.duties()` returns `{kind: 'share', positions}` in play whenever the seat owes shares as of the head, **first**, before `decide`. It is never due in the shuffle, the deal (the `deal` duty covers it), the end (the secrets reveal everything), after a timeout, or for a spectator. `buildShares(rnd, createdAt)` builds the event; it shares a private helper with `buildDeal`. A seat's next move then carries `shares: []`; a client that receives that move before the Shares event buffers it until the shares arrive (§6.2, already so). The simulator gives the duty an outbox slot `shares:<positions>`.
- **No protocol version bump.** Standalone Shares events were already valid in any phase and folded by every client; no new kind, field or rule for receivers. Old clients accept the events and the moves without shares.
- **Progress (Ruling 11).** A Shares event that leaves the stall set as it was is not progress, so prompt shares never move a deadline. Tested in `play.test.ts`.
- **Web controller: a quiet duty.** `share` is an automatic duty, and `QUIET = ['share']`: it never sets `working` and never yields, so it does not hide "your turn" or make the status flicker, and a failure is not `stuck` and shows no error, since the shares still ride on the next move. Its slot is `shares:<positions>`, so a retry re-sends the same event.
- **A move is no longer self-contained.** The seat folds its own Shares event in at once, so its next move carries `shares: []`. A peer that never gets the Shares event holds that move back (R1 buffering) for good, and could time the seat out although it moved. So the Shares event must reach the table's relays, the root's `relays`, which every seat reads; a player's own extra relays are not enough.
- **Pruning, only once a table relay has it.** A `shares:` outbox slot counts as delivered only when a root relay answers `OK true`, or the event comes back from a root relay's subscription. Until then it stays unconfirmed, is retried every tick (30 s) and on reload, and the screen shows "Not delivered to this game's relays yet; retrying." Once delivered it is dropped, so the outbox in `localStorage` does not grow by about a hundred events per game. Dropping it is then safe: a table relay holds the event, and if the duty came back, a second Shares event is harmless (only a seat's first share of a position is kept, and Shares events are not chain moves, so this is never equivocation).
- **Volume.** About S−1 extra small events per turn (S seats): one per other seat after each drawing End turn, under 1 KB each with one share (a 33-byte point and two 32-byte scalars in hex, plus the signed envelope). If the table's relays refuse them, the reveal waits and so does the seat's next move: peers hold that move back until the Shares event reaches them (see above).
- **UI.** A tile the viewer cannot read yet reads "New tile, being revealed": a "…" glyph with a "new" badge, a tooltip, and a visible `role=status` note under the hand, since tooltips do not work on touch screens. Once a timeout ends the game, a tile never revealed is a plain "?" with no note. The rules page and TESTING.md say a new tile takes seconds while the others have the game open and in view, and a minute or more from a background tab (browsers throttle timers in hidden tabs). The equivocation warning adds that a tile dealt around then may be known to other players.
- **Residual risk: one seat can expose a tile at will (owner to accept).** A decryption share is a value, `D = x·R`, not bound to a branch, and prompt sharing sends it within seconds with no human action. So one seat E can now do this alone:
  1. At prev `h`, E signs branch A (for example `place`, then `endTurn`), which draws position p for E.
  2. The other seats' clients share p for E on their own. E decrypts p.
  3. Before the next seat N moves (a human: minutes or hours later), E signs branch B on the same prev: the same length, with an id ground down to be lower, and a different draw count. For example, a forged `skipPlace` keeps E's hand full, so B draws nothing; a forged hidden-information claim is accepted in play and only fails the audit. Fork choice breaks equal-length ties by the lowest id (D030), so every client switches to B, where p goes to N at N's End turn.
  4. E knows N's tile. Worse, N's own share of p went out on branch A, so once the other seats share p for N on branch B, all S shares of p are public and every seat can read N's tile.

  It is always detected: two signed moves on one prev flag E as an equivocator, ranked last (Ruling 5), and the game screen warns every player that a tile dealt around then may be known to others. There is no cryptographic fix, since the share is the same value on every branch. A grace delay before sharing does not help either: a deliberate attacker simply waits for the shares. Before D039 the exposure needed honest seats to build on both branches (their shares rode on their own moves, which made branch A longer), so a lone seat could not trigger it. **The trade-off for the owner:** a drawn tile shows in seconds, against the exposure of one tile to a seat that is guaranteed to be caught and ranked last (or to everyone, as above). Owner sign-off is pending (PLAN open question 10). Partial mitigations, if wanted: do not prompt-share a position whose dealing move is the head while its signer still has another decision this turn; or change the fork tie-break so that a later rival of equal length does not win (a consensus change needing its own ruling).
