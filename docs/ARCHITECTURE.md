# Architecture

**Status:** Phases 0–1 are built: the game kit and the Chain Reaction engine. Of Phase 2, the mental-poker deck (`packages/deck`, 2b) is built. The networked design below is specified precisely in `docs/PROTOCOL.md`, a NIP-style draft (protocol version 1). Where the two differ, PROTOCOL.md wins.

## What we are building

A platform for **online, human-only, multiplayer board games** (in the spirit of BoardGameArena), with these properties:

- **Decentralized.** Only the players' clients and NOSTR relays are involved. There is no referee, dealer, matchmaking server or stats server that anyone has to trust or run.
- **Asynchronous first.** A player is never required to be online outside their own turn.
- **Many games.** Each game is a pure rules module behind one contract. The first is Chain Reaction, an implementation of *Acquire*'s mechanics.
- **Persistent records.** Game history, wins, scores and ratings come from verifiable games. Friends, matchmaking and invites come later.
- **Static and portable.** A static SPA/PWA (later wrapped with Capacitor) that runs on phones, tablets and desktops.

There are no AI players and no local pass-and-play. A random-move **fuzzer** exists only as a test tool.

## Layers

```
apps/web (Phase 3)          platform shell + per-game UI modules
packages/client (Phase 2)   game sessions: relay pool, ordering, validation, auto-shares, audit
packages/protocol (Phase 2) NOSTR event schemas, encoding, validation
packages/deck (Phase 2b)    mental-poker deck: ElGamal, shuffle proofs, decryption shares, wire codecs
packages/games/*            pure rules modules (Chain Reaction today)
packages/game-kit           GameModule contract, canonical JSON, hashing, PRNG, replay, fuzzer
```

Dependencies point downward only. Game modules and the kit are **pure**:
- no clock, randomness, I/O or platform globals
- integer money and plain-JSON state.

Purity is enforced by a source scan and by `tsconfig` (no DOM or Node types).

## The game contract (`@bored-games/game-kit`)

A game is a deterministic state machine. Its full contract is `GameModule` in `packages/game-kit/src/types.ts`. In short:

| Member | Purpose |
|---|---|
| `id`, `version` | Permanent internal id; engine semver. A game is pinned to the version it started on. |
| `defaultRules`, `validateRules`, `seatRange` | Rule configuration; every OPEN rule is an option. |
| `decks(rules)` | The shuffled decks the game needs (Chain Reaction: one deck of 108 tiles). |
| `setup({rules, seats, mode})` | **Full mode:** deck orders known (tests, fuzzing, post-game audit). **View mode:** a live client for one seat, or a spectator. |
| `pending(state)` | Who must act: a seat with a named decision, a public `reveal` of deck positions, or `over`. |
| `legalActions(state, seat)` | Exact whenever the seat's hidden cards are known. |
| `apply(state, action: unknown)` | Validates and applies. Never throws, never mutates. Rejects non-canonical encodings so every move has exactly one form. |
| `learn(state, {deck, pos, card})` | Records a card this viewer privately decrypted. |
| `knownTo(state, seat)`, `view(state, viewer)` | What a seat knows, and the redaction of a full state to one viewer. |
| `outcome(state)` | Places, scores and reason. Feeds stats. |
| `invariants(state)`, `coverage(state, events)` | Used by the fuzzer and tests. |

**Event sourcing.** The public log is the ordered list of actions, and state is a fold over it. A seat's view is a fold over the public log plus that seat's private `learn` records. Replays must reproduce identical state; the fuzzer checks this for full states and for every seat's view after every action.

**Hidden cards are deck positions.** When a player draws, the engine deterministically assigns the next deck position to them. The identity is never in the public log until the card is played, discarded or revealed. Public reveals, such as Chain Reaction's setup tiles, are `reveal` actions from the pseudo-actor `deck`, which `pending()` requests.

**Async requirement.** Hidden-card dealing (below) relies on every seat acting at least once between two consecutive turns of any seat. Chain Reaction satisfies this. Future games that need instant randomness, such as dice, must design around it (see Risks).

## Dealing hidden cards without a dealer

This is mental poker, with decryption shares that ride along with ordinary turns.

**Shuffle (setup).**
- Each player publishes a per-game ElGamal public key `X_k = x_k·G` on secp256k1, the curve NOSTR already uses. It comes with a Schnorr proof of knowledge, which stops rogue-key attacks.
- The joint key is `X = Σ X_k`.
- Each card *m* has a fixed public point `M_m`, by hashing to the curve.
- Starting from the trivial encryption of the ordered deck, each player in seat order re-randomizes every ciphertext and permutes the deck. For each card, `(R, C) → (R + r·G, C + r·X)`.
- Each player publishes, with its shuffled deck, a zero-knowledge proof that the deck is a permutation and re-encryption of its input (Terelius–Wikström, D019). Every client verifies it before accepting the step.
- Nobody knows the final order.

**Dealing.** The engine assigns deck position *j* to player Q publicly and deterministically.

**Decryption shares.**
- Card *j* = `(R_j, C_j)` needs `D_kj = x_k·R_j` from every player except Q. Each share carries a Chaum–Pedersen DLEQ proof that it used the same `x_k` as `X_k`.
- Each client automatically attaches, to its next action of any kind, the shares for every card dealt to *other* seats since its previous action.
- Between Q's draw at the end of Q's turn and Q's next turn, every other seat acts. So Q always has all the shares in time, and **nobody is ever needed online outside their own turn.**
- Shares are public; Q's own share keeps the card hidden.
- Q decrypts privately: `M = C_j − Σ_k D_kj`, then looks M up among the deck's points.

**Public reveals.**
- To play or discard a card, Q publishes its own share with a DLEQ proof. Every client then decrypts the card and verifies that it came from Q's hand at that position.
- Setup tiles get all N shares during the setup deal round.

**Audit at game end.**
- Every player reveals `x_k`; shuffle secrets are discarded after proving and never revealed. Any client decrypts the whole deck and checks:
  - every hand
  - every claim that depended on hidden information, such as Chain Reaction's "no playable tile" and "no other dead tile".
- A failed check or a refusal to reveal marks that player as cheating, which counts as a forfeit (D020).

**Known limitations.**
- Verifying a 108-card shuffle proof takes about 1 s on a desktop CPU, so each client spends several seconds at setup (D019).
- A player making an out-of-turn decision, such as a Chain Reaction merger disposal, may not yet have decrypted the tile drawn at the end of their previous turn. This is a minor information difference from tabletop play.

**Alternatives rejected:**
- A trusted dealer or referee: the owner ruled it out.
- Synchronous mental poker: every draw waits for all players, which breaks async play.
- Pre-assigned per-player card streams: a player can peek at future draws, and bag exhaustion behaves differently.

## Moves, ordering and integrity

- **Identity.** The player's npub signs a one-time join event that authorizes a per-game **session key**. NIP-07 is used on desktop and NIP-46 on mobile, with NIP-55 later. The session key signs all moves.
- **Backup.** The session key and deck secrets are backed up NIP-44-encrypted to the player's own npub as app data (NIP-78), so another device can resume.
- **Moves.** Each move is a regular, signed, stored event. It tags the game root and the previous move, forming a hash chain, and carries a sequence number. A move is valid only if it is signed by the seat that `pending()` names and `apply()` accepts it.
- **Validation.** Every client validates with the same engine and ignores invalid moves.
- **Equivocation.** Two different moves on the same parent are a signed proof of cheating.
- **Relays.** A configurable list: the owner's nostr-rs-relay plus public relays.
  - Publish to all of them and dedupe by event id.
  - On retry, rebroadcast the same signed event; never re-sign.
- **Timeouts.** NOSTR `created_at` is self-reported, so time limits are judged by each client. A player may publish a timeout claim once the stalled seat's limit (set in the game root) has clearly passed. The stalled seat forfeits (D020).

## Ratifying results

- There is no authority.
- Final scoring in Chain Reaction uses only public data, and every client computes the same outcome by replaying the log. After the audit, each player's client publishes a signed **result attestation**: game root, final log hash, outcome, and audit verdict.
- A result is **valid** if its log verifies. It is **finalized** when every player attests and the audit passes.
- Stats and ratings use only valid, audited games.

## Records and social features

| Feature | Approach | Phase |
|---|---|---|
| History and stats | Computed by each client from verified games (games played, wins, scores per game). An optional untrusted cache can serve aggregates that anyone can re-verify. | 4 |
| Ratings | Deterministic multiplayer ratings (OpenSkill / Weng–Lin style) over a verified game set in canonical order, so any client can recompute them. They may be weighted by web of trust to resist sybils. | 4 |
| Profiles | kind 0 | 3 |
| Friends | NIP-02 follow lists | 5 |
| Seeks and invites | Parameterized replaceable "looking for a game" events with NIP-40 expiration | 5 |
| Turn notifications | NIP-17 DMs sent by the acting player's client | 5 |
| Moderation | NIP-56 reports | 5 |

Event kinds are chosen in Phase 2 after checking the NIPs registry, avoiding 30050–30055 and 30100–30105 (used by the owner's other projects).

## Names and branding

Internal ids are permanent once they appear in network events: `chain-reaction`, and chain ids `b1 b2 s1 s2 s3 p1 p2`. User-facing names live only in:
- `packages/brand/src/brand.ts` for the platform
- one theme file per game, e.g. `packages/games/chain-reaction/src/theme.ts`.

The reference game's name and its editions' chain names never appear in source; a repo test enforces this.

## Risks

| Risk | Mitigation / status |
|---|---|
| The contract was shaped by one game | A toy hidden-hand module tests the kit now. Phase 6 adds a second real game early. |
| A bug in the shuffle proof lets a cheater stack the deck | Proofs follow CHVote's algorithms, cross-checked (D019), with a tamper suite and test vectors. |
| Abandonment stalls a game, since the missing player's shares are needed | Timeout claims; the stalled seat forfeits (D020). |
| Fuzzy, clock-free timeouts | Generous per-move limits; client-side judgement. |
| Engine changes break replays of old games | Version pinned in the game root; old engine versions stay importable; semantic changes require a version bump. |
| Key loss | Encrypted self-backup of session and deck secrets. |
| Relay availability and event size limits | Several relays. A shuffle step (108 ciphertexts plus its proof) is about 36 KB. |
| Games needing instant randomness or simultaneous moves | Commit–reveal or a revealed deck card, accepting a one-round delay; decided per game. |
| Sybils and collusion in ratings | Web-of-trust weighting; collusion is observable but not preventable. |
| TypeScript 7 lacks a stable programmatic API that some UI tooling needs | apps/web may pin TypeScript 6 (see DECISIONS D005). |
