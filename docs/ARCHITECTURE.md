# Architecture

**Status:** Phases 0–2 are built, apart from Phase 2e's key backup and live relay smoke test: the game kit and the Chain Reaction engine, the mental-poker deck, the protocol events, the session engine and the relay transport. Phase 3's web app is playable end to end. The networked design below is specified precisely in `docs/PROTOCOL.md`, a NIP-style draft (protocol version 1), with the session rulings in DECISIONS D030. Where the two differ, PROTOCOL.md wins.

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
apps/web (Phase 3)           platform shell, lobby and game controllers, the game registry, per-game UI modules
packages/relay (Phase 2e)    relay pool over WebSockets (not pure)
packages/client (Phase 2d)   lobby fold and game sessions: ordering, fork choice, validation, shares, timeouts, audit
packages/protocol (Phase 2c) NOSTR event schemas, encoding, validation
packages/deck (Phase 2b)     mental-poker deck: ElGamal, shuffle proofs, decryption shares, wire codecs
packages/games/*             pure rules modules (Chain Reaction; Chess, deckless)
packages/game-kit            GameModule contract, canonical JSON, hashing, PRNG, replay, fuzzer
```

Dependencies point downward only. Game modules and the kit are **pure**:
- no clock, randomness, I/O or platform globals
- integer money and plain-JSON state.

`packages/deck`, `packages/protocol` and `packages/client` are pure in the same way: time and randomness are passed in. Purity is enforced by a source scan and by `tsconfig` (no DOM or Node types).

## The game contract (`@bored-games/game-kit`)

A game is a deterministic state machine. Its full contract is `GameModule` in `packages/game-kit/src/types.ts`. In short:

| Member | Purpose |
|---|---|
| `id`, `version` | Permanent internal id; engine semver. A game is pinned to the version it started on. |
| `defaultRules`, `validateRules`, `seatRange` | Rule configuration; every OPEN rule is an option. |
| `decks(rules)` | The shuffled decks the game needs: one (Chain Reaction: 108 tiles) or none (Chess). A deckless game has no shuffle, deal, shares or secrets (PROTOCOL §6.1, D045). |
| `setup({rules, seats, mode})` | **Full mode:** deck orders known (tests, fuzzing, post-game audit). **View mode:** a live client for one seat, or a spectator. |
| `pending(state)` | Who must act: a seat with a named decision, a public `reveal` of deck positions, or `over`. |
| `legalActions(state, seat)` | Exact whenever the seat's hidden cards are known; otherwise `[]` whenever legality depends on cards the seat has not learned, so a non-empty list is always exact (D030). |
| `apply(state, action: unknown)` | Validates and applies. Never throws, never mutates. Rejects non-canonical encodings so every move has exactly one form. |
| `learn(state, {deck, pos, card})` | Records a card this viewer privately decrypted. |
| `knownTo(state, seat)`, `view(state, viewer)` | What a seat knows, and the redaction of a full state to one viewer. |
| `outcome(state)` | Places, scores and reason. Feeds stats. |
| `standings(state)` | Per-seat scores as if the game ended now, from public data only, so every view agrees. Equals `outcome.scores` at the end. Ranks the remaining seats after a forfeit (PROTOCOL §8.2). Chain Reaction: final scoring on a copy. |
| `dealt(state)` | Every deck position assigned so far, `{deck, pos, to}` in assignment order, with `to` a seat or `null` for a public position. Entries never change or disappear. Identical in full mode and every view; the protocol derives owed shares from it (PROTOCOL §6.1, §6.2). |
| `revealsOf(state, action)` | The hidden cards an action shows from its actor's hand, as `{deck, pos, card}` claims, which the protocol checks against reveal shares. `[]` for anything else, including unparseable input. Never throws. Chain Reaction: a placed tile, or each discarded tile. |
| `invariants(state)`, `coverage(state, events)` | Used by the fuzzer and tests. |

**Event sourcing.** The public log is the ordered list of actions, and state is a fold over it. A seat's view is a fold over the public log plus that seat's private `learn` records. Replays must reproduce identical state; the fuzzer checks this for full states and for every seat's view after every action. After every action it also checks `standings`, `dealt` and `revealsOf` against the deck order and every view.

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
- Verifying a 108-card shuffle proof takes about 1 s, measured in the dev container (x64, Node 22), so each client spends several seconds at setup (D019). A phone may be several times slower.
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
- **Equivocation and forks.** Two different valid-looking moves on the same parent by one seat are a signed proof of cheating (for shuffle steps, any two well-formed ones, D030 Ruling 12). The seat is flagged and ranks last at the end; the game is never rewound. Every client follows the same fork choice: the branch that ends the game, then the longest, then the lowest id (D030).
- **Relays.** A configurable list: the owner's nostr-rs-relay plus public relays.
  - Publish to all of them and dedupe by event id.
  - On retry, rebroadcast the same signed event; never re-sign.
- **Resign.** In any game, any seat may resign at any time with a Resign event (kind 7457). It counts once the head it names is on a client's chain and, like an accepted timeout, it is final for that client: the game ends for everyone, the resigning seat is last and the others are ranked as if the game ended now; later events change nothing. Before the first game action it cancels the game instead. With 3 or more seats the result is **unrated** and records who ended it (`unrated`, `endedBy` in the outcome). In a game with a deck the Resign carries the resigner's deck secret: the others publish theirs, and a partial audit replays the log before the result is attested. A Resign that arrives after the result is final (the game's own end, a claim) changes nothing (PROTOCOL §4.9, §8.3, D045, D052).
- **Timeouts.** NOSTR `created_at` is self-reported, so it is never used for deadlines. Each client measures the deadline (set in the game root) on its own clock, from the time it first saw the game's last progress. A player may then publish a timeout claim, and each client accepts it once its own deadline has passed: every stalled seat forfeits (D020, D030), and acceptance is final for that client. A stall before the first game action (during the shuffle or the deal) instead cancels the game, with no result. A stalled seat that acts while some clients have accepted and others have not can split them; this race is documented and accepted.

## Ratifying results

- There is no authority.
- Final scoring in Chain Reaction uses only public data, and every client computes the same outcome by replaying the log. After the audit, each player's client publishes a **result attestation** signed by the player's npub: game root, final log hash, outcome, and audit verdict.
- A game ended by a timeout is not audited, since the deck is not decrypted, and a resign in a deckless game skips the replay (nothing is hidden). The attestation then records the forfeiting seats in place of the audit verdict. A resign in a game with a deck is followed by the secrets and a **partial audit** (the log up to the resign, every action checked, no outcome compared), whose failures forfeit too. A deckless game (Chess) has nothing to decrypt: at its own end, its audit replays the log at once.
- A result is **valid** if its log verifies. It is **finalized** when every player attests.
- Stats and ratings use only valid results, and never an **unrated** one (a resign with 3 or more players, D052).

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

## More than one game (D045)

- **Session.** `GameSession` runs any `GameModule` with one deck or none. `shuffleSteps` (the seat count with a deck, else 0) marks where game actions start.
- **Web registry.** `apps/web/src/games/registry.ts` lists every hosted game: names (`meta.ts`, from the game's theme), the in-game component (`GameViewProps`), the rules page (`#/rules/<gameId>`) and the setup copy. `screens/game.tsx` is generic: the setup progress, the chrome every game shares (notices, final places, attestations, Resign) and the table's game component.
- **Tools.** The fuzzer and the sim take `--game`; one meta-test checks the rules catalog of every `docs/games/*/RULES.md`.

- **Catalog (D046).** Each game package exports a pure `catalog.ts` `CatalogEntry` (players, play time, weight, luck, genre, mechanisms, modes, hidden information, randomness, tags; the types and controlled vocabularies are in `packages/game-kit/src/catalog.ts`). `apps/web/src/games/catalog.ts` lists the entries with each game's trademark-safe brand pack, and a test checks every entry against its module (`players` = `seatRange`, `hiddenInfo || randomness` iff the game has a deck). Home is Your games, the Game catalog (search plus filters, pure in `catalog-model.ts`) and the open tables of every game; a game's page `#/games/<id>` holds its summary and facts, How to play, the New table form and that game's tables. The lobby filters tables by game on the client: relays index only single-letter tags, so they cannot filter on `game`.

## Names and branding

Internal ids are permanent once they appear in network events: `chain-reaction`, and chain ids `b1 b2 s1 s2 s3 p1 p2`. User-facing names live only in:
- `packages/brand/src/brand.ts` for the platform
- one theme file per game, e.g. `packages/games/chain-reaction/src/theme.ts`, holding the game's trademark-safe **brand pack**
- licensed brand packs, outside `src`, e.g. `packages/games/chain-reaction/licensed/original.ts`.

**Brand packs (D046).** A pack is a game's display strings under one branding: `{id, gameTitle, tagline, summary, aliases[]}`, plus `chains: {b1: {name}, …}` for Chain Reaction. Looks (label letters, colors, patterns) are not part of a pack: they stay the safe theme's. Each player chooses in Settings → Game names (`branding: 'safe' | 'original'`, stored as `bg:<profile>:branding`); `apps/web/src/brands.ts` gives the pack in effect as signals, so every screen that names a game re-renders on a change. Chain Reaction's model functions take the theme explicitly (`chainView(theme, …)`, `logLines(…, {theme})`, `priceCard(theme, …)`, `RulesContent theme`); only the registry screen and the rules route read the theme in effect (`games/chain-reaction/theme.ts`).

**Licensed packs never ship publicly.** The web app loads them only through a dynamic import guarded by `import.meta.env.VITE_LICENSED_BRANDS === '1'` (`apps/web/src/licensed-brands.ts`); Vite replaces the flag at build time, so the public build drops the import and the pack. The reference game's name and its editions' chain names appear only in `licensed/` directories (and docs): the repo guard scans every package file outside them, checks that no `src` file imports from `licensed/` statically, `tests/public-build.test.ts` builds the public app and scans it for every restricted name and licensed pack string, in any case, and the Pages workflow builds with the flag off and runs the same scan (`pnpm scan:dist`) before uploading. A licensed build (`VITE_LICENSED_BRANDS=1`) is for local testing until the names are licensed.

## Risks

| Risk | Mitigation / status |
|---|---|
| The contract was shaped by one game | A toy hidden-hand module tests the kit now. Phase 6 adds a second real game early. |
| A bug in the shuffle proof lets a cheater stack the deck | Proofs follow CHVote's algorithms, cross-checked (D019), with a tamper suite and test vectors. |
| Abandonment stalls a game, since the missing player's shares are needed | Timeout claims; the stalled seat forfeits (D020). |
| Self-reported timestamps | Deadlines run on each client's own clock from first-seen times; generous per-move limits; the claim race is documented (D030). |
| Engine changes break replays of old games | Version pinned in the game root; old engine versions stay importable; semantic changes require a version bump. |
| Key loss | Encrypted self-backup of session and deck secrets. |
| Relay availability and event size limits | Several relays. A shuffle step (108 ciphertexts plus its proof) is about 36 KB. |
| Games needing instant randomness or simultaneous moves | Commit–reveal or a revealed deck card, accepting a one-round delay; decided per game. |
| Sybils and collusion in ratings | Web-of-trust weighting; collusion is observable but not preventable. |
| TypeScript 7 lacks a stable programmatic API that some UI tooling needs | apps/web may pin TypeScript 6 (see DECISIONS D005). |
