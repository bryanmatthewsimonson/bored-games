# Game systems

**Status:** design (D044, 2026-10-02), written before any game after Chain Reaction. Nothing here beyond what §3 marks "exists" is built. Each system gets its own PROTOCOL section, DECISIONS entry and adversarial review when it is built; where this document and PROTOCOL.md differ, PROTOCOL.md wins. The owner answered §7 on 2026-10-02 (D049–D051); the sections below carry the answers.

## 1. Purpose

The owner asked (2026-10-02): *"For all future games, consider what kinds of libraries will be necessary to be used by multiple or all games, e.g. dice and playing cards. Player-level privacy of hands is critically important, so before all game development happens, those must be considered. Think about which game systems apply to multiple games, and which apply only to a single game."*

This document answers in five parts:
- §2, the principles every game and library follows;
- §3, the three layers (platform, shared systems, per-game code), with status, location and API sketch for each item;
- §4, a design note per shared system;
- §5, game families mapped to the systems they need;
- §6, a prioritized roadmap, and §7, the owner's answers to the questions this document raised.

Status words: **exists** (built and tested), **partial** (built for one case, generalization needed), **planned** (in the approved multi-game plan, Phases C–E), **missing** (designed here only).

## 2. Principles

### 2.1 Privacy only through cryptography (firm rule)
- **Player-level privacy is enforced by cryptography, never by the UI alone.** A card, tile, role, die or choice that one player may know and another may not is hidden by the mental-poker deck (§4.1), by a sealed share (§4.1.5) or by a commitment (§4.4). The public log never holds it in plaintext, and `view()` redaction is a convenience on top of that, never a substitute.
- **The one exception is D037** (Chain Reaction's hidden holdings): numbers that anyone can **derive from the public move log** may be hidden by the UI as a table-manners rule, because a physical table does not hide them cryptographically either. The exception never covers information that is not derivable from public moves.
- **Corollary for new games:** a rules interpretation that would need UI-only hiding of non-derivable information is a design bug. Restructure the rule, or use a primitive from §4.
- **Limits that remain** (PROTOCOL §11): colluding players can share what they know, and a player's privacy is only as good as their key storage. Keys live in `localStorage`, which a shared GitHub Pages origin exposes to other sites (D036, PLAN open question 9).

### 2.2 Extract on the second user
A shared library is designed when its first game is designed (this document), but its code is extracted into a shared package only when a second game needs it. Until then it lives in the first game's package with the shared API shape. Exceptions, built shared from the start because they touch the protocol: the deck and its extensions, the dice beacon and sealed choices.
- **Shared libraries are welcome (owner, D051).** Engines stay pure but may import shared **pure** helpers. `game-kit` may depend on `@noble/hashes` for a pure `commit.ts` (SHA-256 commitments over canonical JSON, §4.4) when the first engine needs it. Crypto that touches keys (shares, sealed shares, beacon contributions) stays in `packages/deck`, called by the session, never by engines (§2.4). Card and dice helpers (§4.2, §4.3) become shared packages when the first game needs them.

### 2.3 Async first, and draw timing decides the cost
D004 requires that no one is needed online outside their own turn. Hidden draws and fair dice both need **some other seat's** contribution, so every game must answer: *when does the information get created, and who must act after that?*
- **Free:** the information is created at the end of the receiver's turn (Chain Reaction draws at End turn). Every other seat acts before the receiver's next turn, and its shares ride on those moves (D011, PROTOCOL §6.2). This is the round-robin liveness rule of PROTOCOL §10.
- **One extra round:** the information is created *after* a decision of the receiver in the same turn (draw on demand, decide-then-roll). Another seat must act after the decision, so the turn takes two async hops, or that seat's client publishes automatically while it is online (a **prompt duty**, none of which may ship before Phase K passes review, D050).
- **Prompt duties need finality.** D039 published shares automatically and was rejected by the owner (2026-10-02, reverted in Phase A): an equivocating seat could expose a tile. Any automatic out-of-turn duty that releases information (shares, dice contributions, sealed shares) needs cheat-proof finality. D042's gate ("acknowledge, then share", `docs/proposals/fast-reveal.md`, after its adversarial review) is **superseded by D050**: the prompt-reveal protocol of Phase K replaces it as the only way in; the Phase K candidate is "plain stop" (`docs/proposals/prompt-reveal.md`, D055), research only, pending another independent adversarial review and the owner's approval.
- **No prompt duty anywhere yet (owner, D050).** No game, co-op games included, uses a prompt duty until the prompt-reveal protocol (Phase K: a cheat-proof design and sealed shares, research only) passes adversarial review. Until then every game stays turn-piggybacked, and a game that cannot work that way (Hanabi with 3 or more players, §6) waits for K. The owner's reason: cheating kills a game, while waiting for a reveal is only a mild annoyance.

### 2.4 Pure engines see results, never secrets
Engines stay pure (CLAUDE.md). Hidden information enters an engine only as the result of a platform mechanism: `learn` (a private card), a derived `reveal` (a public card), and, proposed here, a derived `roll` (§4.3) and an `open` of a sealed choice (§4.4). Keys, salts, shares and proofs stay in `packages/deck`, `packages/protocol` and `packages/client`.

### 2.5 Every primitive keeps the existing guarantees
Each new primitive must keep what the protocol already guarantees: one accepted encoding per move, an append-only and view-independent schedule of who owes what (like `dealt`, PROTOCOL §6.2), monotone rules so clients converge whatever the arrival order (D030), a timeout that names who is stalled, and an end-of-game audit or an at-the-time proof for every claim about hidden information.

## 3. Layers

### 3.1 Platform (every game)

| Item | What | Status | Where | API sketch |
|---|---|---|---|---|
| Game contract | `GameModule`: pure state machine, `pending`, `legalActions`, `apply`, `learn`, `view`, `dealt`, `revealsOf`, `standings`, `outcome` | exists | `packages/game-kit/src/types.ts` | extended by §4.1, §4.3, §4.4, §4.7 (each optional, so Chain Reaction is unchanged) |
| Identity and keys | npub, per-game session key and deck key, key import | exists | `apps/web/src/identity.ts`, PROTOCOL §3, D033, D041 | unchanged |
| Profiles | kind 0 names and avatars | exists | `apps/web/src/profiles.ts`, D040 | unchanged |
| Lobby and seats | Table 37450, Join 7451, Root 7450; `foldLobby`, explicit seat order | exists | `packages/protocol/src/lobby.ts`, `packages/client/src/lobby.ts`, D021 | `seatRange` per game; 2 seats already allowed by the protocol |
| Move chain | Move 7452, hash chain, fork choice, equivocation | exists | `packages/client/src/session.ts`, D030 | unchanged; any finality rule for prompt duties comes from Phase K (D050), and none ships before it passes adversarial review |
| Turn order | `pending()` names one seat or a public reveal | partial | `game-kit/types.ts` | simultaneous phases: §4.4, §4.8 |
| Deckless sessions | games with `decks(rules) = []` (Chess) | exists (D045) | `packages/client` | `shuffleSteps = decks ? seats : 0` (`SessionView.shuffleSteps`); deckless audit with `deckOrders: {}` |
| Timeouts and forfeit | Timeout 7454, local-clock deadlines, `rankWithForfeits` | exists | D020, D030, PROTOCOL §8 | a deckless game forfeits after its first move (D045) |
| Resign | voluntary forfeit at any time | built (D045, D052): every game | kind **7457** `{type:'resign'}`, plus `secret` (the deck secret) in a game with a deck, signed by the session key, naming the head; PROTOCOL §4.9, §8.3 | `canResign()`, `buildResign(rnd, createdAt)`; counts once the named head is on the chain, then is final for the client; the game ends for everyone and the resigner ranks last. 3+ seats: unrated, `endedBy` recorded. Deck games: the others' secrets, then a partial audit (`auditPrefix`) |
| Audit and attestation | Secret 7455, full-mode replay, Attest 7456 | exists (one deck or none) | `packages/client/src/audit.ts` | audit modes (§4.1.7) |
| Results and ratings | attested outcomes; ratings in Phase 4 | partial | D012 | team and co-op outcomes: §4.7; unrated results (a multi-seat resign, D049) never count toward ratings, completions or wins |
| Game registry (web) | per-game component, rules page, setup copy | exists (D045) | `apps/web/src/games/registry.ts` | `{id, title, tagline, Component, RulesPage, setupCopy}`; catalog and brands come in Phase E |
| Rules pages | `#/rules/<gameId>` | exists (D045) | `apps/web/src/games/<id>/rules-page.tsx` | registry entry |
| Catalog | browse and filter games | planned (E1, E2) | `packages/games/<id>/src/catalog.ts`, `apps/web` | `CatalogEntry` (§4.12) |
| Branding | platform name, per-game brand packs | partial (E3) | `packages/brand`, `packages/games/<id>/src/theme.ts`, `licensed/` | §4.12 |
| Spectators | view as `viewer: null` | exists | session, `game-controller.ts` | §4.11 |
| Replays | replay a finished game | partial | `game-kit/src/replay.ts`; no UI | §4.11 |
| Deadlines | 1, 3 or 7 days per move | exists | `protocol/src/kinds.ts` `DEADLINES` | live deadlines: §4.9 |
| Key backup | NIP-78 backup of session and deck secrets | missing (Phase 2e) | PLAN | backs up salts of sealed choices too (§4.4) |
| Notifications, friends, seeks | NIP-17, NIP-02, matchmaking | missing (Phase 5) | PLAN | unchanged |

### 3.2 Shared systems (several games)

| System | Status | Where (today / proposed) | Users |
|---|---|---|---|
| §4.1 Private hands and hidden draws | partial: one deck, shuffled once, private and public draws | `packages/deck` (crypto), `packages/client` (session), kit `dealt`/`learn` | every hidden-information game |
| §4.2 Playing cards | missing | `packages/cards` (pure), `apps/web/src/kit/cards/` | trick-taking, rummy, poker, many euros |
| §4.3 Dice and fair randomness | built for public dice (D058) | `packages/deck/src/beacon.ts`, `packages/dice`, session `deriveBeacon`; Bank | dice games, euros, wargames |
| §4.4 Secret simultaneous choices | missing | `packages/game-kit/src/sealed.ts`, session duty | auctions, drafting, hidden-role votes |
| §4.5 Boards and coordinates | missing (Chain Reaction has its own grid) | `packages/boards` (pure), `apps/web/src/kit/board/` | abstracts, tile placement, euros |
| §4.6 Counters, money, markets, tracks | per-game (Chain Reaction) | conventions now; `packages/game-kit` helpers on the second user | economic games |
| §4.7 Teams, co-op, solo | missing | kit `Outcome`, rules options | partnership, co-op, solo |
| §4.8 Turn structures | partial | kit `Pending`, session | all |
| §4.9 Timers and clocks | partial (async deadlines) | protocol `DEADLINES`, session | live play |
| §4.10 Rules options and variants | exists | `defaultRules`/`validateRules`, Join `rules-hash` | all |
| §4.11 Spectators and replays | partial | session, web | all |
| §4.12 Branding packs and catalog metadata | planned (Phase E) | game packages, web | all |

### 3.3 Per-game code

| Item | Where | Notes |
|---|---|---|
| Rules engine | `packages/games/<id>/src` | pure; implements `GameModule`; uses shared systems through their pure APIs |
| Rules source of truth | `docs/games/<id>/RULES.md` | every `#### Cnn` has a catalog test (`tests/catalog.test.ts`, every game, D045) |
| Fuzz policies and deck orders | `tools/fuzz/src/<id>` | registered in `tools/fuzz/src/index.ts` |
| UI components | `apps/web/src/games/<id>/` | props-driven, as D032; registered in the web registry (C3) |
| Rules page, log lines, setup copy | `apps/web/src/games/<id>/` | through the registry |
| Brand packs | `packages/games/<id>/src/theme.ts`; licensed packs in `packages/games/<id>/licensed/` | Phase E3 |
| Catalog entry | `packages/games/<id>/src/catalog.ts` | Phase E1 |
| Game-specific scoring, markets, price tables, tracks | the engine | §4.6: extracted only on a second user |

## 4. Shared systems

### 4.1 Private hands and hidden draws

#### 4.1.1 What exists
- **Crypto** (`packages/deck`): ElGamal on secp256k1 with a joint key `X = Σ X_k`, card points `h2c('card:<deckId>:<m>')` (`cards.ts`), a Terelius–Wikström proof per shuffle step (D019), DLEQ decryption shares (`makeShare`, `verifyShare`, `decryptPosition`), proofs of knowledge. It works for any n ≥ 1 seats and any deck size, and every context (`ShareCtx`, `ShuffleCtx`) already carries `deckId`, so several decks are cryptographically separated today.
- **Session** (`packages/client`): exactly one deck, shuffled once by every seat in seat order at the start (moves 1..S), a deal round, then play. `session.ts:391-392` throws for any other deck count.
- **Contract** (`game-kit/types.ts`): `decks(rules)`, `dealt(state)` (append-only `{deck, pos, to}` with `to` a seat or `null` for public), `learn`, `revealsOf`, `pending` with `reveal`.
- **Liveness** (D011, PROTOCOL §6.2): a seat owes a share for every position dealt to another seat or to `null`; owed shares ride on its next move. This is enough because every seat acts between a draw and the drawer's next turn (PROTOCOL §10).

#### 4.1.2 Operations games need

| Operation | Example | Mechanism | Status |
|---|---|---|---|
| Private draw | draw a tile, deal a hand | grant to one seat; the others share publicly | exists |
| Public draw or reveal | setup tiles, flop, flip a market card | grant to `null`; every seat shares; derived `reveal` | exists |
| Play or discard from hand | place a tile, play a card | the owner's own share, in the move's `reveals` | exists |
| Deal to a zone, face down | a face-down market, a kitty, a role deck | engine-only: positions not yet in `dealt` stay sealed under every layer | exists (no protocol change) |
| Private look | peek at the top card, look at the kitty | grant to a seat without ownership in the engine | exists as a grant; the engine models ownership |
| Several decks | tiles plus cards; roles plus missions | one shuffle step per seat covering every initial deck | missing (session) |
| Mid-game reshuffle | discard pile becomes the new draw pile | a shuffle round on the same deck's next epoch | built for Holler (D060); other games unchanged |
| Visible to a set of seats | Hanabi (all but the owner), a team | public shares from non-members, **sealed shares** between members | missing |
| Show a card to one player | "show your role to the player on your left" | the owner seals its own share to that seat | missing |
| Pass a card | Hearts' pass, a trade of hidden cards | sealed share to the receiver, plus a new grant | missing |
| Leave the game | a busted poker seat | **retire**: reveal the deck secret, stop owing shares | missing |
| Anonymous submission | mission cards in hidden-role games | each voter's chosen position goes into a mid-game shuffle, then a public reveal | missing (composes the rows above) |

#### 4.1.3 The grant model (generalizing `dealt`)
- `dealt(state)` keeps its shape and stays append-only, but an entry becomes a **grant**: "seat `to` may know the card at `(deck, pos)`", or "everyone may" for `null`. A position may appear several times; its **viewer set** V is the union of its grants, and it is public once any grant is `null`. Ownership (whose hand it is in) is engine state, not protocol state.
- **Owed shares, generalized:** for a position with viewer set V,
  - if public: every seat owes a public share (today's rule for `null`);
  - otherwise: every seat **outside V** owes a public share, and every seat **inside V** owes a **sealed share** (§4.1.5) to every other member of V. A seat whose public share is already held owes nothing more (a receiver of a passed card had shared it publicly while it was outside V).
- With |V| = 1 this is exactly today's rule, so Chain Reaction is unchanged. V only grows, so the rule stays monotone (D030).
- Hanabi's "visible to everyone but the owner" is V = all seats but Q: Q shares publicly, the others seal pairwise, (S−1)(S−2) sealed shares per card, 12 at 5 players.
- `learn` still records what the viewer decrypted; a learn from a sealed share is the same `Learn`.

#### 4.1.4 Several decks, reshuffles and the shuffle budget
- **Initial decks.** `decks(rules)` may list several decks. Each seat publishes **one** shuffle step covering all of them (one deck array and one proof per deck), so the setup still takes S sequential steps, not S × decks. An event over the 256 KB cap (PROTOCOL §11) splits by deck. One deck key per seat serves every deck; contexts already separate them by `deckId`. C1's `shuffleSteps` (0 or S) stays S.
- **Card sets and deck epochs.** `DeckSpec` gains an optional `cards` (the card-set id used for card points, default `id`), so a reshuffled pile keeps the same card points under a new deck id: `cardPoint(spec.cards, m)`, with `ShareCtx.deckId` and `ShuffleCtx.deckId` set to the epoch id (`draw.2`; ids may not contain `:`).
- **Mid-game reshuffle.** A new pending type requests it:
  `{type: 'shuffle', deck: 'draw.2', cards: 'draw', from: [{deck, pos}, …]}`.
  The input is the current ciphertexts of the listed positions (cards already public may instead start from their trivial encryption). Every seat then shuffles in seat order, and the new epoch's positions are dealt as usual. Cost: S sequential steps, each needing that seat online.
- **Background shuffle (recommended for multi-hand games).** A shuffle the engine can foresee (the next hand's deck in a trick-taking game) is requested early, and each seat's step **rides on its next move**, in the order the moves come. In round-robin play the new deck is ready after one round, with no added latency. When the engine cannot foresee the input (the discard pile as it stands when the draw pile runs out), the game waits for S steps, unless the rules allow a snapshot reshuffle as a variant (an OPEN rule, logged per game).
- **Holler (D060).** The reshuffle is built for this game only, without a second deck and without new card points. Positions of epoch `k` are `128 * k + i`. `ShuffleCtx.deckId` is `pile.<k>` (a dot). The public action is `{"type":"epoch","actor":"deck","epoch":<k>,"size":<n>}` and carries no order. Full mode learns the order through `installDeckOrder`. A piggyback step on the next move, and a snapshot of a pile the game has not reached, are both rejected here: the epoch waits for S steps once the pile is known. A card dealt by the move that plays it is attached on that move for Holler only (PROTOCOL §6.2). Other games are unchanged. Sealed shares are still unbuilt.
- **Budget** (extrapolated linearly from D019's 108-card bench): about 334 bytes and 10 ms of verification per card per step. A 52-card deck is about 17 KB and 0.5 s per step, so a 4-seat deal costs about 2 s of verification; the cap allows about 750 cards per step.

#### 4.1.5 Sealed shares: showing and passing a card
- **What.** Seat k's decryption share `D = x_k·R_j` of position j, encrypted to seat T's deck key: `(A, B) = (r·G, D + r·X_T)`, with a generalized Chaum–Pedersen proof of knowledge of `(x_k, r)` such that `X_k = x_k·G`, `A = r·G` and `B = x_k·R_j + r·X_T` (three equations, one challenge). Anyone can verify it; only T can open it: `D = B − x_T·A`.
- **Transferable opening.** T can later make D public with an ordinary DLEQ share of the ciphertext `(A, B)` under its own key (`makeShare(x_T, {a: A, b: B}, …)`), so everyone checks `D = B − x_T·A` without k. A passed card can therefore be played by its new owner without the passer being online.
- **Show one player:** the owner Q seals its own share to T (the other shares of a card in Q's hand are already public). T learns the card; no one else does.
- **Pass:** the same, plus a grant to T in `dealt`, and the engine moves ownership. The passer still knows the card, as at a real table.
- **Timing.** A sealed share is readable by T as soon as it is published, so a simultaneous pass (Hearts) needs two steps: every seat first names the positions it passes (positions are opaque, so naming them reveals nothing), then the sealed shares are released. Otherwise a later passer would see what it receives before choosing.
- **API sketch** (`packages/deck/src/sealed.ts`): `sealShare(x, ct, Xto, ctx, rnd)`, `verifySealedShare(X, ct, Xto, sealed, ctx)`, `openAndVerify(xTo, X, ct, sealed, ctx)`. Protocol: a `sealed` list in Shares events and moves, `{pos, to, A, B, proof}`.
- **Built as a reference, unwired (Phase K, D055).** The spec, its security argument and the wire form are in `docs/proposals/prompt-reveal.md` §7; `packages/deck/src/sealed.ts` implements `sealShare`, `verifySealedShare`, `openAndVerify` (no unverified opening exists) and the transferable opening (`proveOpening`, `verifyOpening`), with codecs, tamper tests and vectors. Nothing in the session uses it until the owner approves. A sealed share is a prompt release, so outside a seat's own move it is allowed only under the prompt-reveal rules (§4.1.8).

#### 4.1.6 Retiring a seat
A seat eliminated mid-game (poker, elimination games) would otherwise owe shares until the end. **Retire** publishes its deck secret early: every card stays protected by the other seats' layers, except the retiring seat's own cards, which become readable by all. From then on it owes nothing, and new decks are shuffled under the joint key of the remaining seats only (a `DeckSpec` participant list). Cost: the retiring seat's own hand becomes public, which is acceptable only when it no longer matters to play. **Owner (D049):** generally yes, a retiring seat's cards may become public when it leaves; each game decides, by its mechanics, whether it retires seats this way.

#### 4.1.7 Audit modes: a per-game reveal policy
Today every game ends with every deck secret revealed and a full-mode replay (D020, PROTOCOL §7). That is right for games with **hidden claims** (Chain Reaction's `skipPlace`, a trick-taker's "no card of the led suit"), but it makes every card public forever, including folded poker hands.
- **Owner (D049):** poker and similar games with no hidden claims **never reveal folded or unplayed private cards unless the player chooses to show them**, at the end or later (the owner: *"should allow folded hands to stay private forever"*): a public record of someone's folds would destroy their ability to bluff. The end-of-game reveal therefore becomes a **per-game reveal policy**, and such games get their verifiability from the shuffle proofs and the share proofs (DLEQ) checked as each card is dealt and shown, not from a final reveal.
- **Proposed:** `GameModule.audit?(rules): 'reveal' | 'none'`, default `'reveal'`.
- `'none'` is allowed only for a game with no hidden claims, where every action is checkable when it is made (poker: betting is public and showdown cards are revealed with proofs). The session then skips the Secret reveal, and mucked cards stay private.
- In trick-taking games the hand's own plays reveal every card dealt by the end of the hand, so revokes are caught at the end of the hand without any secret, except for cards never played (a kitty, a skat).

#### 4.1.8 Liveness, D039, D042 and D050
- The round-robin rule (PROTOCOL §10, D011) holds for any game whose private draws happen at the end of the drawer's turn (§2.3). It binds only games with private draws: a deckless game, or one with public randomness, may use any turn order.
- **On-demand draws** (rummy draws at the start of the turn, Ticket to Ride's draws, Carcassonne's tile) need every other seat after the decision: +1 async round per draw. Prompt shares were D039, **rejected** by the owner on 2026-10-02 (a lone equivocator could expose a tile). D042 then required a future fast path to be cheat-proof (acknowledge-then-share, `docs/proposals/fast-reveal.md`); **D050 supersedes that gate**: no game uses prompt shares until the prompt-reveal protocol (Phase K) passes adversarial review, so on-demand draws cost the extra round. Phase K's candidate is "plain stop" (`docs/proposals/prompt-reveal.md`, D055; the earlier acknowledge-then-share write-up is `fast-reveal.md`); not built.
- **Draw-ahead variants.** Some on-demand draws can move to the end of the previous turn with no effect on any decision (Carcassonne: the next tile is drawn after your turn, and you have no decision until you place it). Such a change is a rules variant, logged per game as an OPEN rule (CLAUDE.md "Never invent rules").

#### 4.1.9 Contract sketch (all optional, backward compatible)
```ts
interface DeckSpec { readonly id: string; readonly size: number; readonly cards?: string; readonly seats?: readonly Seat[] }
type Pending =
  | { type: 'player'; seat: Seat; decision: string }
  | { type: 'reveal'; deck: string; positions: readonly number[] }
  | { type: 'shuffle'; deck: string; cards: string; from: readonly { deck: string; pos: number }[] } // §4.1.4
  | { type: 'roll'; id: string }                                                                  // §4.3
  | { type: 'over' };
// dealt(state): DealtPosition[]: unchanged shape, read as grants (§4.1.3).
// audit?(rules): 'reveal' | 'none' (§4.1.7).
```

#### 4.1.10 Hanabi design note (Phase J0, D054)
Rules: `docs/games/hanabi/RULES.md`. Hanabi is the hardest privacy case in this document, and it is **blocked on Phase K** (sealed shares plus a prompt-reveal protocol).
- **Viewer set "all but the holder".** A card in seat Q's hand has V = every seat except Q (§4.1.3). Q owes a public share; every other seat owes a sealed share (§4.1.5) to every other member of V: (S−1)(S−2) per card, so 0, 2, 6 and 12 for 2, 3, 4 and 5 seats. The initial deal at 5 seats is 20 cards and 240 sealed shares, and it must be complete before seat 0 can see the other hands.
- **Reveal on play (and on discard).** A played or discarded card must become public, the holder included. Its position gets a `null` grant, so **every** seat owes a public share, including the seats inside V that were already able to read it, and the holder's own share. The engine needs the card to apply the move (success or a lost fuse), so the move waits on a platform `reveal` (§4.1.9) until every share is in.
- **The timing problem.** The drawer Q draws at the end of its turn, and the next seat A acts at once. A must see the new card first (it changes clue and play decisions), so A needs a sealed share from every other seat outside {Q, A}. With turn-piggybacking those shares ride on each seat's *next* move (PROTOCOL §6.2), so with 3 or more seats the seats after A have not acted yet and A cannot see the card before acting. The same stall hits the reveal on play: the seat after the player needs every other seat's share before the outcome is public.
- **Therefore: blocked on Phase K.** The game needs sealed shares for the viewer sets plus a prompt-reveal protocol that passes Phase K's adversarial review (D050: no prompt duties in any game before then; D042's "acknowledge, then share" is one candidate, `docs/proposals/fast-reveal.md`). A prompt duty with no finality is the D039 mistake, and here it would expose exactly the cards a seat must not see. Nothing for Hanabi is built before Phase K is approved.
- **Two players are not solved by today's mechanisms either.** V has one member, so only the drawer's own share of a new card is owed, but PROTOCOL §6.2 attaches it to the drawer's *next* move, so the next seat gets it one round late. Reveal-on-play is circular: the other seat's share would ride on its own move, whose parent state is waiting for that very reveal (§6.3). Both the draw timing and the reveal-on-play circularity are Phase K questions.
- **A clue's touched slots are a hidden claim.** The giver sees the target's hand and the target does not, so the public fold cannot compute the touched slots (§2.4, §2.5). The clue move carries them as the giver's claim, the fold accepts any well-formed claim, and the end-of-game audit (§4.1.7) rejects a wrong one and fails the giver, as for Chain Reaction's `skipPlace`. Proving it at the time would need zero-knowledge machinery.

### 4.2 Playing cards
- **What.** A pure package `packages/cards` describing the standard deck and helpers, built on the deck: card indices are the deck's card numbers, so a hand is a list of positions and learned cards.
- **Encoding.** `card = suit × 13 + (rank − 1)` with suits in bridge order (clubs 0, diamonds 1, hearts 2, spades 3) and ranks 1 (ace) to 13 (king); jokers are 52 and 53. Several physical decks (Canasta, 2 × 54) use indices `c + 54·copy`, and `identity(c) = c mod 54`. One accepted encoding per card; display names come from a theme.
- **Helpers:** `suitOf`, `rankOf`, `isJoker`, `compareCards(a, b, {aceHigh, suitOrder, trump})`, `sortHand`, and trick helpers: `ledSuit(trick)`, `mustFollow(hand, trick)`, `trickWinner(trick, {trump, aceHigh})`, `legalPlays(hand, trick, rules)`. Shedding helpers (`isRun`, `isSet`, meld validation) come with the first rummy game.
- **Hidden claims.** Playing off suit claims "no card of the led suit". `legalActions` is exact because the seat knows its own hand; other seats check the claim when the hand's cards are played out, or at the audit (§4.1.7).
- **UI** (`apps/web/src/kit/cards/`): `<Card>` (an inline SVG face: rank, suit symbol, accessible label "queen of hearts"), `<CardBack>`, `<Hand>` (fan or row, sorted by the player's choice, selection for plays and passes), `<Trick>`. An optional four-colour deck; the suit symbol is always shown, so colour is never the only cue. Card art must be redistributable (as with Cburnett for chess pieces).
- **Not shared:** the rules of any particular game (bidding, scoring, melds) stay in its engine.

### 4.3 Dice and fair randomness without a server

#### 4.3.1 Requirements
- **Unbiasable:** no seat or coalition short of everyone can choose the result. Aborting (refusing to continue) must cost a forfeit.
- **Unforeseeable:** no seat learns a roll before the last decision that should be made without it.
- **Verifiable** by every client and by the audit.
- **Cheap in async latency:** ideally no extra round per roll.

No scheme gives a roll that is unforeseeable to its roller with only the roller acting after the decision: if only the roller's data fixes the result, the roller can compute it first. So "decide, then roll" always needs another seat after the decision (§2.3).

#### 4.3.2 Options

| Option | How | Bias | Foresight | Latency per roll | Verdict |
|---|---|---|---|---|---|
| 1a. Commit-reveal beacon | every seat commits `H(salt, value)`, then reveals; roll = `H(all values)` | only by abort: the last revealer sees the result and may withhold, which is a timeout forfeit | none before the last reveal | 2 rounds of every seat | correct but too slow for async |
| **1b. Key-committed beacon** (recommended) | every seat's contribution to roll i is `x_k·H_i`, `H_i = h2c('roll:<rootId>:<i>')`, with a DLEQ proof against its deck key `X_k`; roll seed = `SHA-256(contributions in seat order)` | only by abort, as 1a: the deck key, fixed at Join, is the commitment, so a contribution has exactly one valid value | the seat contributing last knows the roll first | 0 extra rounds when the roll is scheduled at the end of the roller's previous turn and the roller contributes last; 1 round for decide-then-roll | adopt |
| 2. Deck of faces | a shuffled deck of die faces (or a 36-card 2d6 deck), drawn publicly, reshuffled when empty | none | as 1b (the last sharer knows first) | as a public draw; a reshuffle costs S steps | only when the physical game uses a deck; not i.i.d. dice |
| 3. Single-party VRF | the roller's own verifiable random function of the roll id | none | **the roller foresees every roll** | 0 | does not fit alone; it is the per-seat ingredient of 1b |
| 4. VDF or time-lock | a slow function of the previous move id | grindable: the roller can try many move variants | none, if the function is slow enough | minutes of phone CPU per roll | rejected: grinding, phone cost, no audited library |
| 5. External beacon (drand, block hashes) | a public randomness service | none, if the service is honest | none | seconds | rejected: a third party, against D003; the owner rules out third parties for solo play too (D049) |

#### 4.3.3 The recommended design (1b)
- **Reuse.** A contribution is exactly a decryption share of the pseudo-ciphertext `{a: H_i}`: `makeShare(x_k, {a: H_i, b: H_i}, {rootId, deckId: 'roll', pos: i}, rnd)` and `verifyShare` already exist (`deck/src/dleq.ts:40`, `:57`; `roll` becomes a reserved deck id). It is deterministic for the key, so a seat cannot choose among values, and unpredictable to anyone without `x_k` (this is the 2HashDH construction underlying ECVRF). The inputs are fixed hash points, never chosen by a peer, so it gives no decryption oracle; the adversarial review must still confirm that reusing the deck key is safe, or the Join gains a separate beacon key.
- **Deckless games** keep a deck key: C1 keeps `deckKey` and `pok` in the Join, so Backgammon has one.
- **Schedule, like `dealt`.** The engine schedules rolls in an append-only list, `rolls(state): {id, last: Seat | null}[]`, identical in every view. Every seat other than `last` owes its contribution, under the owed-shares rule (they ride on moves); `last` contributes when the engine pends `{type: 'roll', id}`, as an automatic duty. The session then derives `{type: 'roll', actor: 'beacon', id, seed}` into the interleaved action log, like a derived reveal (PROTOCOL §6.3).
- **The engine turns a seed into dice** with pure helpers (`packages/dice`): `dice(seed, count, sides)`, by rejection sampling over SHA-256 output, so there is no modulo bias.
- **Roll at the start of a turn** (Backgammon without the cube, production rolls): the roll is scheduled at the end of the roller's previous turn with `last` = the roller; the other seats' contributions ride on their moves; the roller computes the roll when the last of them arrives and publishes its own at its turn. The roller may see the roll early, but makes no decision before it. Abort costs a forfeit.
- **Private rolls** (Liar's Dice): `last` keeps its contribution unpublished; the roll is known to `last` alone (learned, like a card) and revealed when `last` publishes it.
- **Decide, then roll** (the doubling cube, push-your-luck, Yahtzee rerolls, combat after an attack): `last` must be a seat other than the decider, contributing after the decision: +1 async round, or, once Phase K passes review (D050), a prompt duty.
- **Audit:** every contribution is verified when folded, so rolls need no end-of-game check.

#### 4.3.4 Recommendation per game type

| Game type | Randomness | Latency |
|---|---|---|
| Roll at the start of the turn, no decision before it (Backgammon without the cube, Catan-style production) | 1b, roller last | none |
| Decide then roll, 2 players (the doubling cube, Can't Stop, Yahtzee rerolls) | 1b, the opponent last | +1 round per roll (a prompt duty only after Phase K passes review, D050); best played live |
| Many rolls per turn by one player (Yahtzee) | 1b, one async round per roll until Phase K passes review (D050); prompt duties after that, if K allows them | live play recommended; waits for K to be practical |
| Private dice (Liar's Dice) | 1b, private | none |
| Event decks, card-driven randomness | 2 (it is a deck) | as draws |
| Solo | designed per game when one comes, with no third party (§4.7, D049) | |

#### 4.3.5 Built: Bank (D058)
Bank (`packages/games/bank`, `docs/games/bank/RULES.md`) is the first game on option 1b. `packages/deck/src/beacon.ts` builds and checks a contribution (`makeRollShare`, `verifyRollShare`, deck id `roll`). `packages/dice` `faces(seed, count, sides)` draws faces by rejection sampling. The session derives `{type:'rolled', actor:'beacon', id, dice}` once every seat's share of that roll is in (PROTOCOL §6.3a). The engine sees the faces and never the seed, and it imports neither package.
The roller attaches their share to the Roll move, before the others publish, so an honest roller cannot compute the faces before choosing to roll. Each other seat's share is then sent by that seat's open app, in the module's order, and the last of them is a seat other than the roller (PROTOCOL §6.3a). There is no button. The roll is one public result, so publishing the share releases nothing another seat is hiding. D050 still forbids an automatic publication of a hidden card or a sealed choice; this roll is not that. A closed window can withhold, and that remains a timeout. Private dice, a roll scheduled at the end of the previous turn, and a roller who contributes last are still the §4.3.3 design; Bank does not use them.
The seed is the SHA-256 of each share's `D` as compressed SEC1 bytes, in seat order. §4.3.2's sketch hashed the base64 text of those points; the bytes do not depend on that alphabet. Shares are stored by roll id in the card share store. Bank deals nothing, so the ids do not meet cards. A game that deals and rolls needs a deck id on that store.

### 4.4 Secret simultaneous choices
- **What.** Sealed bids, simultaneous action selection, drafting picks, votes: every chooser commits before anyone sees another's choice.
- **Commitment.** `commit = SHA-256(canonicalJson(['bored-games/seal', seat, round, choice, salt]))` with a fresh 32-byte salt from the injected randomness. Binding the seat and round stops one seat mirroring another's commitment; the salt hides low-entropy choices.
- **Actions.** `{type: 'seal', actor, round, commit}`, then `{type: 'open', actor, round, choice, salt}`. The engine checks the opening and that `choice` was legal when sealed; an invalid or missing opening is that seat's forfeit (or a rules-defined default).
- **Private state.** The seat's own choice and salt are private view state, recorded like a learn, so `legalActions` can list the one opening and the decide gate stays exact (D030). The salt is a game secret: it must survive a reload (the outbox, D034) and belongs in the NIP-78 backup.
- **v1, in the chain, no protocol change:** the seals are ordinary moves in seat order, then the openings. **The last chooser need not seal**: the others are hidden, so it moves in the clear. That is 2S − 1 sequential steps, about the same as alternating play at 2 players and acceptable for occasional sealed rounds.
- **v2, parallel** (for games with frequent simultaneous phases for many players, such as drafting): Seal events outside the chain, like Shares; a chain move binds the set of seal ids, so a late rival seal cannot change it; openings then come in any order and the engine applies them together. It needs a new kind and an adversarial review, and is built only when such a game comes.
- **Abort.** The last opener sees the others first and may withhold: a timeout forfeit, as with the beacon.
- **Dependency.** The engine needs SHA-256, so `game-kit` gains `@noble/hashes` (already pinned at 2.4.0 in the repo, D023) for a pure `commit.ts`, approved by the owner (D051) and added with the first engine that needs it. API sketch: `sealCommit(seat, round, choice, salt)`, `checkOpening(commit, seat, round, choice, salt)`.
- **Anonymous ballots** (who played "fail" stays secret) are not commit-reveal: each voter's chosen card position goes into a mid-game shuffle (§4.1.4), then a public reveal.

### 4.5 Boards and coordinates
- **Pure package `packages/boards`**, extracted on the second user (§2.2); Chess (Phase D) builds the square grid first inside its engine with this API:
  - **Square:** `{file, rank}`; `algebraic(sq)` and `parseAlgebraic('e4')`; `neighbors(sq, 'orthogonal' | 'diagonal' | 'king')`; `ray(sq, dir)`; `knightMoves(sq)`; bounds for any width and height (Chess 8×8, Checkers, Go 9/13/19, Chain Reaction's 12×9).
  - **Hex:** axial `{q, r}` with cube conversion, `hexNeighbors`, `hexDistance`, `hexRing`, `hexLine`, and orientation (pointy or flat).
  - **Graph:** named nodes and edges for maps (routes, areas): `adjacent`, `shortestPath`, `connected`.
- **UI kit** (`apps/web/src/kit/board/`): `<GridBoard>` of buttons with labels ("e4, white knight"), coordinates, flipping, keyboard movement, highlight layers (selected, targets, last move, check), drag and click; `<HexBoard>` and `<GraphBoard>` in SVG on the same props. Colour is never the only cue.
- **Not shared:** piece movement rules, scoring (territory, area), connectivity rules.

### 4.6 Counters, money, markets and tracks
- **Conventions now** (CLAUDE.md): integer money, plain-JSON state, `null` for absent values, bank supplies as integers.
- **Per game for now:** Chain Reaction's price chart, bonuses and share market stay in its engine.
- **Helpers on the second economic game:** `Bank` (finite supply with take and return), a `PriceTable` lookup by size bracket, a `Track` (score track with laps and tie-breaking order), money formatting in the web kit.
- **Hidden numbers** follow §2.1: hidden cash that is derivable from the public log may use the D037 exception; hidden cash that is not (bids paid in secret, hidden resource draws) needs §4.1 or §4.4.

### 4.7 Teams, co-op and solo
- **Teams.** Seat groups as a rules option (for example partners at seats 0 and 2 against 1 and 3), so the `rules-hash` in every Join already binds them and the protocol needs no change; the creator's explicit seat order (D021) places the players. `Outcome` gains `teams?: Seat[][]`; places and scores are shared within a team.
- **Co-op.** `Outcome` gains `coop?: 'win' | 'loss'` with every seat at place 1; a co-op loss is a loss for all. Ratings treat co-op games separately (Phase 4). A timeout or resign in a co-op game ends it as a loss for everyone, unless the rules say otherwise.
- **Restricted communication** (Hanabi, The Crew) cannot be enforced: players can talk elsewhere. It is an honour rule, like collusion (PROTOCOL §11).
- **Solo.** `seatRange` may start at 1. **Randomness cannot be verified with one player:** the only shuffler knows, or can know, the permutation, and a single seat's beacon is foreseeable. Solo games without randomness (puzzles) are fully verifiable. **Owner (D049):** casual and unrated play should be an option, but verifiability and anti-cheating are universal, and there are **no third parties** (no drand): everything stays inside the platform and NOSTR. Verifiable solo randomness is designed per game when the first solo game with randomness comes; until then it is not worth more design.

### 4.8 Turn structures

| Structure | Example | Status | Mechanism |
|---|---|---|---|
| Round-robin | Chain Reaction, Chess | exists | `pending` names the next seat |
| Out-of-turn decision, sequential | Chain Reaction merger disposals, a defender's choice | exists | `pending` may name any seat |
| Variable order, extra turns | Patchwork (the player behind moves), doubles | exists for games without private draws | with private draws, check the liveness rule (§4.1.8) |
| Response windows | "any player may challenge" (Coup) | missing | each other seat answers in seat order (S − 1 async steps); a prompt duty only after Phase K (D050) |
| Simultaneous phase | sealed bids, drafting, rock-paper-scissors | missing | §4.4 |
| Resign at any time | every game (D045, D052); unrated with 3+ seats | built | kind 7457 outside the turn order; final once its head is held (PROTOCOL §8.3) |
| Real time | action games | not supported | against D004; later (owner, D049), not now |

### 4.9 Timers and clocks
- **Today:** a per-move deadline of 1, 3 or 7 days (D020), measured on each client's own clock from first-seen times (D030), with claims, forfeits and the documented claim race.
- **Live play, later (owner, D049):** asynchronous play is the focus; live play will come, so mechanisms should not rule it out. Shorter per-move deadlines (for example 2 minutes, 1 hour) through the same mechanism. Adding values to `DEADLINES` (`protocol/src/kinds.ts`) is a protocol change. The claim race window shrinks with the deadline, so it needs a fresh look before minute-level deadlines ship.
- **Chess clocks, later:** a total time per player, measured locally between first-seen times, with a flag claim judged like a timeout claim. Clients see opponents' times differently by their network latency, so a close flag can split clients; acceptable for casual play only. Chess (Phase D) ships with async deadlines.

### 4.10 Rules options and variants
- **Exists:** `defaultRules`, `validateRules` and the Join's `rules-hash` (PROTOCOL §4.2) bind every option; every OPEN rule is an option (CLAUDE.md).
- **Variants** are named presets of options (`variant: 'standard' | 'chess960'`), shown in the New table form and listed in the catalog entry; the async adaptations of §4.1.8 and §4.3 (draw ahead, snapshot reshuffle, no doubling cube) are variants, never silent rules changes.
- **The New table form** will render each game's options from a small schema in its registry entry (the registry exists since D045; it has no options schema yet).

### 4.11 Spectators and replays
- **Spectators** fold the public log with `viewer: null` (exists) and never see a private card: the cryptography, not the UI, hides it (§2.1), so a player gains nothing by also watching.
- **Replays** step through the interleaved action log (PROTOCOL §7). With audit mode `'reveal'` every card is known after the end, so a finished game replays in full mode; with `'none'` it replays as a spectator's view plus the viewer's own cards. Replay UI: missing; one generic step control drives each game's registered component with the state at each step.
- **History is permanent:** after a `'reveal'` audit, anyone holding the log can decrypt every card forever. The rules pages say so.

### 4.12 Branding packs and catalog metadata (Phase E)
- **Catalog entry** (`packages/games/<id>/src/catalog.ts`, pure): players, play time, weight, luck, genre, mechanisms, modes (competitive, team, co-op, solo), turn style (sequential, simultaneous), `hiddenInfo`, `randomness`. Proposed additions from this document: `randomness: 'none' | 'deck' | 'dice'` instead of a boolean, and `pace: 'async' | 'live-recommended'` from §2.3, so players know a decide-then-roll game is best played live.
- **Brand packs:** user-facing names in the game's theme; licensed packs in `licensed/`, off on the public site (owner's choice, Phase E3). A game that implements a published one says "Compare to <title>" with a BoardGameGeek link (`compareTo`, D053).
- **Tests** (Phase E1): `players` matches `seatRange`; `hiddenInfo || randomness !== 'none'` iff the game uses a deck or the beacon.

## 5. Game families

### 5.1 Systems per family

| Family | Examples | Private hands (§4.1) | Extensions needed | Randomness | Other systems | Async fit |
|---|---|---|---|---|---|---|
| Abstract, perfect information | Chess, Go, Checkers, Hex | no | none | none | boards (square, hex) | excellent (deckless, C1) |
| Tile placement, hidden hands | Chain Reaction; Carcassonne-like | yes | none (Chain Reaction); draw-ahead variant (Carcassonne) | deck | boards (grid), money (Chain Reaction) | good: draws at end of turn |
| Trick-taking | Hearts, Spades, Bridge, Whist, Euchre | yes | multi-hand background shuffle; sealed shares for passes (Hearts); kitty (Euchre) | deck | cards, trick helpers, teams (Spades, Bridge) | good: hands dealt at hand start, plays reveal |
| Shedding, rummy | Crazy Eights, Gin Rummy, Canasta, Rummikub | yes | reshuffle of the discard pile | deck | cards, melds | poor: draws on demand, +1 round per draw (prompt shares only after Phase K, D050) |
| Poker-like | Texas Hold'em, Stud | yes | retire, audit mode `'none'`, per-hand decks | deck | cards, chips (money) | fair: betting rounds are sequential; community cards need every active seat |
| Deck-building | Dominion | yes, and each player's own deck must be hidden from its owner | frequent reshuffles of personal decks, each needing every seat | deck | cards, market | poor, but **in scope** (owner, D049: Dominion is wanted); needs the reshuffle and background-shuffle work of §4.1.4 |
| Dice | Yahtzee, Backgammon, Can't Stop, Liar's Dice | private dice only (Liar's Dice) | beacon | beacon | boards (Backgammon), scoring helpers | Backgammon without the cube: excellent; decide-then-roll: live recommended |
| Auction and bidding | sealed-bid games, open-auction games (Modern Art-like, For Sale-like) | often (hands of lots or cards) | sealed choices | deck, sometimes | money, sealed choices | open auctions: one async step per bid; sealed rounds: §4.4 |
| Hidden role, deduction | Secret Hitler, One Night Ultimate Werewolf, The Resistance-like, Coup-like | yes (role cards) | sealed shares (show a role, look at a role), anonymous ballots, response windows | deck | sealed choices (votes), teams | fair; **Secret Hitler and One Night Ultimate Werewolf are in scope** (owner, D049); variants that need human judgement (a live moderator) come later, if ever |
| Cooperative | Hanabi, The Crew, Pandemic-like | yes (Hanabi: hidden from the owner only) | viewer sets with sealed shares | deck | co-op outcome | good; communication limits are honour rules |
| Worker placement, euro | Agricola-like, Stone Age-like, Ticket to Ride-like, Splendor-like | often (objectives, hands) | on-demand market draws | deck, dice (Stone Age) | boards (graph), money, tracks | fair: on-demand draws cost a round; open-information euros are excellent |

### 5.2 Single-game systems
These stay per game, whatever the family: scoring rules, special powers, map data, piece movement, Chain Reaction's merger and bonus rules, Go's territory scoring and superko, chess's draw rules, meld legality of a particular rummy, bidding systems.

## 6. Roadmap

Ordered by value and by how much each step unblocks; each step names the game that validates it. Phases C to E come from the approved multi-game plan and are done.

**Next (owner, 2026-10-02, D049, D050):**
1. **Phase G: multi-seat and deck-game Resign.** A Resign with 3 or more seats ends the game, unrated, with the resigner recorded and ranked last; in deck games the Resign carries the resigner's deck secret, the other seats reveal theirs, and a partial audit replays the log up to the resign.
2. **Phase K: the prompt-reveal protocol (research only, no gameplay code).** A threat model, every source of reorganisation (equivocation, claim and resign races, raced endings, relay withholding), candidate designs, an executable model of event orderings, and **sealed shares** (§4.1.5) with a reference implementation that no game uses yet, all through adversarial review. The output for the owner is "cheat-proof: yes, with this design", or the precise residual. Candidate policy to analyse in K (a proposal, not a rule): **proven equivocation ends the game**, unrated, with the cheater recorded and ranked last, like a multi-seat resign; then any exposure that needs an equivocation happens only in a game that is already over.
3. **Hanabi** (public name "Hanabi", no safe pack). Its rules spec (`docs/games/hanabi/RULES.md`, Phase J0) comes first; the build is **blocked on K**: with 3 or more players every viewer must see a new card before its next turn, which turn-piggybacked shares cannot guarantee, and cards visible to a set of seats need sealed shares. Bank (D058) was asked for and built in between. It does not change this order: Hanabi still waits for K.

The table below is the longer-term order; rows 7 and 10 now come from Phase K.

| # | Build | Layer | Validating game | Depends on |
|---|---|---|---|---|
| 1 | Deckless sessions, resign (7457), 2 players, web registry, generic fuzz and catalog tests | platform | Chess (Phase D) | Phase C (done, D045) |
| 2 | Square-grid board kit (inside Chess first) | shared | Chess; extracted with Checkers or Go | 1 |
| 3 | Catalog and brand packs | platform | Chess and Chain Reaction | Phase E |
| 4 | Several decks per session, deck epochs, background shuffle for multi-hand games | shared (deck, session) | a trick-taking game: Spades (no pass) or Hearts with passing off | 1 |
| 5 | Playing-cards package and card UI kit | shared | the same trick-taking game | 4 |
| 6 | Team outcomes (rules-option seat groups) | platform | Spades or Bridge partnerships | 4, 5 |
| 7 | Sealed shares and the grant model (viewer sets) | shared (deck, protocol) | Hanabi (co-op outcome), Hearts' pass | Phase K (design and reference code), 4 |
| 8 | Key-committed dice beacon and dice helpers | shared (deck, protocol, kit) | Bank (D058, done). Backgammon without the cube still later | 1 |
| 9 | Sealed choices v1 (in chain) | shared (kit, session) | a sealed-bid auction game, or a 2-player simultaneous game | 1 |
| 10 | Prompt-reveal protocol and prompt duties | platform | Hanabi with 3+ players, Gin Rummy (on-demand draws), the doubling cube | Phase K passing adversarial review (D050) |
| 11 | Hex and graph boards | shared | a hex game; a route-building euro | 2 |
| 12 | Retire, audit mode `'none'`, anonymous ballots, response windows | shared | poker; a hidden-role game | 7, 9, 10 |
| 13 | Live deadlines and clocks | platform | Chess blitz | 10 |
| 14 | Sealed choices v2 (parallel), deck-building | shared | a drafting game; Dominion (in scope, D049) | 9, 10 |

Each step ends with its RULES.md catalog, fuzz target (10,000 games, zero failures), sim test and e2e spec, as Chess does.

## 7. Answered (owner, 2026-10-02)

The owner answered the nine questions this section held (D049). Each answer below gives the owner's words, condensed, and what follows from them.

1. **The game after Chess.** *"Hanabi."* Shown publicly as "Hanabi", with no safe pack.
   - **Follows:** the rules spec comes first (Phase J0, `docs/games/hanabi/RULES.md` with its `#### Cnn` catalog). The build is blocked on Phase K: with 3 or more players every viewer must see a new card before its next turn, which turn-piggybacked shares cannot guarantee, and the cards visible to a set of seats need sealed shares (§4.1.5).
2. **Prompt duties.** The owner prefers prompt duties that take seconds while everyone is online, for on-demand draws and decide-then-roll games, but *"strong anti-cheating mechanisms are critical"*: the method must be cheat-proof first, with a fallback to turn-based play where the mechanics allow, because *"cheating kills a game, while waiting for a draw to be revealed is only a mild annoyance."* Follow-up: *"No prompt shares anywhere yet. Figure that out first"*, co-op games included. The owner asked for a recommendation.
   - **Follows (recommendation, D050):** no prompt duty in any game until the prompt-reveal protocol (Phase K) passes adversarial review. Every game stays turn-piggybacked until then, and a game that cannot (Hanabi with 3 or more players) waits for K.
   - **A candidate policy for K, not a rule:** proven equivocation ends the game, unrated, with the cheater recorded and ranked last (§6).
3. **Async rules adaptations.** *"For now we need to focus on asynchronous play. Live play will come, and we will need to prepare for those variants, but we need to make asynchronous work where it doesn't destroy the game mechanics."*
   - **Follows:** draw-ahead and snapshot-reshuffle variants are acceptable where they leave the mechanics intact, as named variants logged per game as OPEN rules (§4.1.8, §4.10). Mechanisms are designed so live variants can be added later.
4. **End-of-game reveal.** *"Poker, and similar games without hidden claims, should allow folded hands to stay private forever."* A record of a player's folds would destroy their ability to bluff.
   - **Follows:** the end-of-game reveal becomes a per-game reveal policy (§4.1.7). Games with no hidden claims never reveal folded or unplayed private cards unless the player chooses to show them; their verifiability comes from the shuffle proofs and the share proofs.
5. **Retiring seats.** *"It depends on the game and its mechanics, but yes, generally a retiring seat's cards can become public when it leaves."*
   - **Follows:** retire (§4.1.6) is allowed, chosen per game.
   - **Resign in multi-seat games.** *"We will likely throw the whole game out such that aborted games do not count for ranking or completions or wins. But the person who aborts the game should be tracked. We don't want to incentivize griefing behaviors."* For 3 or more players a resign ends the game and works out who would have won, and the result does not count toward any future rating.
     - **Follows:** a Resign with 3 or more seats ends the game for everyone. Places are worked out as if the game ended now, with the resigner last (as in D045 and the round-2 plan, not the owner's words); the result is **unrated** and records the resigner (`endedBy`). Phase G implements it (PROTOCOL §4.9, §8.3).
   - **Resign in deck games.** The audit options are *"good recommendations that can be considered when a new game is implemented."*
     - **Follows:** for Chain Reaction now, and any game whose seats hold deck secrets, the Resign carries the resigner's deck secret, the other seats publish theirs as at any end, and a partial audit replays the action log up to the resign (Phase G). Other games choose per game.
6. **Solo play.** *"Casual and unrated play should be an option, yes, but verifiability and anti-cheating mechanisms should be universal."* *"No 3rd parties. Each game must be self-contained in the Bored Games platform and NOSTR."* Verifiable solo randomness *"should be possible"*, and is *"an edge case not worth worrying about too much until we have such a game to implement."*
   - **Follows:** no drand or other external beacon (§4.3.2). Verifiable solo randomness is designed per game, inside the platform and NOSTR, when the first solo game with randomness comes (§4.7).
7. **Live play.** *"For now we focus on asynchronous play. Live play will probably come at some point in the future, so we should be cognizant of that possibility in developing mechanisms."*
   - **Follows:** no minute-level deadlines or chess clocks now (§4.9). New mechanisms should not rule them out.
8. **Scope.** *"Deck-building games are in scope. Dominion is a very popular game that I would like to play on this platform. One Night Ultimate Werewolf and Secret Hitler are definitely games I would like to implement. Real time games will come eventually, but not now. But variants that require human judgment are something that we will have to worry about later, if we do ever implement them."*
   - **Follows:** deck-building (Dominion), One Night Ultimate Werewolf and Secret Hitler are in scope (§5.1). Real-time games come later. Variants that need human judgement (a live moderator) come later, if ever.
9. **Shared libraries, and `game-kit` on `@noble/hashes`.** *"Each game should take advantage of shared libraries and the codebase as necessary. If there needs to be an API implemented for games to call, perhaps that works better."* The owner asked for a recommendation.
   - **Follows (recommendation, D051):** shared pure helpers are allowed (§2.2). `game-kit` may depend on `@noble/hashes` for a pure `commit.ts` (SHA-256 commitments over canonical JSON, §4.4) when the first engine needs it. Key-handling crypto stays in `packages/deck`, called by the session, never by engines (§2.4). Card and dice helpers become shared packages when the first game needs them.
