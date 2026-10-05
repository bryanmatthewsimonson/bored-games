# Luster implementation plan

Implement the standard base-game mechanics of Splendor for 2–4 players under original Luster branding. Expansions and Duel are out of scope. Original light-and-glass motifs replace published illustrations, characters, card layouts, terminology and rules prose. Numeric card costs, bonuses, scores and component quantities describe gameplay. No publisher assets or rulebook text are included. This is an implementation boundary, not a legal opinion or trademark clearance of the name Luster; jurisdiction-specific legal review remains necessary before commercial release.

The follow-up request replaces the tabletop youngest-player convention with a random starting player. This is an intentional Luster rule difference; all remaining base-game turn and scoring rules still apply.

## Scope and order

1. Record the 90 workshop cards (40/30/20), ten 3-point patron commissions, seven tokens in each of five colors and five wild tokens. Verify exact costs, bonus colors and scores against numerical reference tables. Specify setup, taking, buying, reserving, returning tokens, patron selection and equal-turn end scoring.
2. Build a deterministic pure GameModule in packages/games/luster. Four logical decks represent each tier and patrons. For the existing single-deck client, a Luster adapter maps these to four independently shuffled groups in a 100-card encrypted packet. Exposed market cards use public reveals; blind reservations use private deals. Public reservations remain public knowledge. Purchasing a blind reservation claims its identity through revealsOf and is audited against the encrypted deck.
3. Build a responsive, keyboard-operable Preact game under apps/web/src/games/luster with original geometric glass artwork, color names and symbols, purchase/payment selection, token taking/returns, reservation, patrons, standings, spectator/locked states and async error handling. Write original player-facing rules.
4. Add only Luster entries to web package dependencies and the five game registries, the fuzz target and Vitest project. Reuse existing cryptographic primitives, protocol wire formats and relay APIs. The one-deck client requires opt-in partitioned shuffle support plus a public-refill share duty. Existing one-group and deckless behavior stays compatible. Add no third-party runtime dependencies.
5. Check documented edge cases, exhaustive legal encodings, conservation, hidden information and replay with unit/catalog tests and fuzz games, then test the NOSTR browser flow and repository checks.

## Concurrent Bank work

Exclusive ownership: packages/games/luster/**, apps/web/src/games/luster/**, docs/games/luster/**, Luster-specific tests and fuzz policy. Shared integration points: apps/web/package.json, apps/web/src/{net.ts,game-names.ts}, apps/web/src/games/{ids.ts,registry.ts,catalog.ts}, tools/fuzz/{package.json,src/index.ts}, vitest.config.ts, pnpm-lock.yaml and additive documentation notes. Always read current contents immediately before additive edits and preserve other games. Do not change Bank, cryptographic primitives, protocol formats, PWA or global styling libraries. The only necessary shared runtime changes are the optional DeckSpec.partitions field, partitioned shuffle handling in the client, the public-share duty and its web-controller/simulator dispatch. No Bank implementation files were present at inspection.

## Public reveal and resignation analysis

Luster pends market refills during play. The existing fold continues derived public reveals after a resignation, but enabling resignation would require a dedicated review of that path. Luster opts out with resignAllowed returning false for all seat counts. Existing platform timeout and post-game audit remain available. This leaves Bank and the protocol unchanged.

## Numerical references

The base-game numerical card and patron tables were checked using the CSV tables at https://github.com/filipmlynarski/splendor-ai/tree/master/environment (cards.csv and nobles.csv), accessed 2026-10-03. Only the mechanical numbers are transcribed; no implementation, artwork, names or prose is copied. Verification tests record per-tier/color counts and full numerical-table fingerprints.

Second numerical reference: https://github.com/cestpasphoto/alpha-zero-general/blob/master/splendor/SplendorLogic.py. The first CSV has two tier-two mistakes: the white 2-point mixed-cost card omits its one green cost, and the blue 2-point mixed-cost card adds an extra green cost. The second reference supplies the correct seven-token costs. The entire tier-one and tier-three multisets match both references. Color correspondence: white→Ivory, blue→Azure, green→Moss, red→Rose, black→Ink, gold→Prism.


## Integration decision: encrypted groups and mid-game public shares

Inspection and a failed NOSTR simulation showed that GameSession supports only one encrypted deck and originally publishes standalone Shares only at setup. Four conventional decks cannot be played on that client. Replacing the hidden tiers with public order or a mixed deck would change the game, so the implementation instead adds optional contiguous DeckSpec.partitions. Each seat shuffles each group, with a separate proof against that group's input and a domain including the group id. The same shuffle wire format carries one group per step. The client keeps complete packet snapshots across those steps; shares and audits continue to use global packet positions.

The opt-in packet is `glass`, 100 cards, with groups 40/30/20/10 at offsets 0/40/70/90. The Luster transport adapter converts public reveals, private learns, dealt positions, identity claims and full audit orders between global and per-tier coordinates. Cross-group input/proof substitution is rejected. Decks with no partitions keep their existing domain and one shuffle per seat; deckless games have no shuffle or share duty.

Under protocol 1 (games started before protocol 2, which stay on it for good), a new automatic `share` duty, gated by Luster's explicit `DeckSpec.promptShares` opt-in, supplies pending public reveals during play and newly assigned non-owner layers, so a blind reservation can be learned before the next player acts. Partitions alone do not enable that duty. Every shared position is assigned by the module; a seat never publishes its own private layer. Its persisted outbox key is the position list; it does not replace the one-time setup deal or publish an owner's private share. The existing rival-deck safeguard blocks this duty after a seat dealt on another shuffle branch. No cryptographic algorithms, wire events, dice helpers, dependencies or Bank files change.

This is a necessary exception to the initial registration-only integration plan. Shared edits are additive and kept out of Bank's game-specific implementation. The combined release preserves both games' registration entries and their separate client duties.

## Random starting player — follow-up

Engine version 0.2.0 chooses the starter from the tier-one cards already revealed during setup. Examine positions in their fixed deck order, beginning at zero. The first identity less than `40 - (40 % seats)` selects `identity % seats`. With two or four seats, all 40 identities divide evenly. With three seats, identity 39 is rejected and the next position is used; the next distinct card must be in 0–38. Every seat is equally likely under the existing joint-shuffle assumptions, with no extra draw, network event, deck position or random source. Revealing a later position first waits for the earlier position, so delivery order cannot select the starter. Unrevealed full-mode order does not disclose the starter prematurely to views.

The selected seat is recorded permanently in public state, displayed in the UI, preserved through reload/replay, and checked by the full audit. Seat identities and encryption ownership stay fixed. Normal table order wraps from the selected starter; round numbers advance when play returns to that seat, and the final round ends after their predecessor completes any token-return and patron decisions. Tests enumerate all 1,560 ordered pairs of first-tier identities at each player count, verify exact equal frequencies, and exercise every starter and scoring-trigger position.

The existing protocol's selective-abort, shuffle-fork and timeout limitations still apply: a player can abandon a game, and this is not a new general-purpose adversarial randomness beacon. The random-start mechanism requires no new shared library or client runtime logic. An accompanying UI correction counts completed players rather than individual group shuffle steps in the existing setup screen; legacy single-group progress remains the same. Full browser games now cover every supported player count, each with a spectator and confirmed signatures from all players.

Version 0.2.0 pins the changed starting-player and round semantics. Previously created 0.1.0 roots require their original engine version; they must not be silently reinterpreted with the new rules.

## Protocol 2 (v2 build T18)

New Luster tables are protocol 2 (docs/PROTOCOL-v2.md §6.3). The engine is unchanged (0.2.0, `protocols: [1, 2]`); everything below comes from the generic v2 session and controller.

- **Prompt release replaces the `share` duty.** A v2 session ignores `DeckSpec.promptShares` and never owes `share`. After a buy or a reserve from the display, every seat's open app, the actor's included, releases its share of the refilled position in a card Shares event anchored on the move (§6.1); after a blind reservation, every other seat's app releases the card and its owner never does. Moves wait while a refill's reveal is pending. The slow path stays: a game action still carries every share its seat owes.
- **Forks stop the game (audit F1).** A seat that reserves blind, reads the card from the automatic releases and signs a rival on the same prev holds a fork at every client that sees both: the game stops at that prev, the forker is last (rated; unrated for the others with 3 or more seats), no release, decision or claim follows, and only the after-stop Secret reveal is owed. A move signed past the fork on either side is not played and nobody releases for it, so the card read on one side is worth nothing on the other.
- **Two devices (audit F2).** The check before signing finds the other device's move before the seat signs a rival; a move saved offline on the other device is discarded by the outbox rule (§9.2) and a fork made only by it is never acted on (D073 H1). A seat never releases a card dealt to itself, on any device.
- **Stale releases (audit F3).** A saved release is published only after the outbox rule's verdict `send`: its anchor on the chain, no fork held, the game live, and every position still drawn and dealt to another seat or to nobody with no share of this seat out yet. A release saved on a side that loses is discarded, and the controller refuses to publish any release holding the seat's own card.
- **Owed reveals keep their timeout (D060).** A seat whose share of a refill is missing is stalled whether or not it is its turn, and is timed out at the deadline; the game screen and Home name it with the deadline.
- **Resign stays disabled** (`resignAllowed` false at every seat count; a v2 session refuses to build one and rejects one received).
- **v1 games in progress** keep folding under protocol 1 with its `share` duty and the D063 share vetting (`share-vet.ts`). New Luster tables at protocol 1 are neither created nor joined (T14).

Tests: `packages/client/test/v2/luster.test.ts` (refills and blind reservations at 3 seats, F1 in split arrival orders, F2, F3, the owed-reveal timeout, a whole game with the audit passing, Resign refused, a v1 game through `openSession`), vector 6's Luster cases in `test/vectors/prompt-release-v2.json`, and `apps/web/test/v2-luster.test.ts` (the same through the controllers and the dev relay).

## Authorized release exception

After the explicit D050 release-blocker assessment, the owner instructed: "For this game only, merge and deploy anyway." This authorizes Luster's current beta integration and deployment with the documented unresolved fork/rollback, Resign and legal/name review limits. The exception does not apply to other games or approve Phase K. Immediate shares require `DeckSpec.promptShares: true`; Luster alone sets it in the production registry. Neither an ordinary deck nor opting into deck partitions enables immediate shares by itself. Bank's dice contributions and the existing turn-piggybacked card games retain their prior duties.

Protocol 2 (above) supersedes this exception for new tables: prompt release, the fork stop and the outbox rule apply to every deck game, and `promptShares` is read only by protocol 1 sessions. The exception still covers Luster games started under protocol 1.

Bank was merged into main as PR #23 during this development. Integration preserves its package, dice beacon, manual contribution path, rules and UI. Shared registry conflicts retain both games, and the release is checked on that combined base.

## Interface revision — 2026-10-04

The owner requested direct clicks on gems and cards and familiar gemstone names, with original artwork. The presentation now uses Diamond, Sapphire, Emerald, Ruby, Onyx and Gold, developments, nobles and prestige. Internal engine identifiers and all mechanical quantities remain unchanged. The owner clarified that standard player-count supply rules should apply after recognizing the earlier observation came from a two-player game: 4/5/7 tokens per color for 2/3/4 players, always five Gold. The bank displays that setup rule as well as current counts.

Large gem-stack buttons replace numeric inputs. Clicking a color cycles legal selections; selected tray gems can be removed individually, and Clear resets the draft. The tray confirms a token move and floats during the player's decision. During mandatory returns the buttons show the player's hand. Every selection must still be completable as a legal move. Clicking an entire card opens a native modal with its discounted price, buy/reserve choices, and direct colored-gem/Gold payment swaps. Clicking a tier deck opens a blind-reservation confirmation; an eligible noble's whole card is its selection target. Keyboard selection, Escape, focus trapping, busy states, spectators, errors and mobile layouts use the existing browser and game APIs.

The compact board groups three market rows with their tier decks and noble cards beside them on desktop. Mobile uses larger two-card rows and scrolls the noble strip within the board. Original gem facets, mining/guild landscapes and noble portraits are drawn in `apps/web/src/games/luster/art.tsx` and covered by the artwork's CC0 dedication. No artwork or CSS is taken from BoardGameArena or a publisher. No shared library, engine, wire protocol, prompt-share duty or Bank implementation changes; the shared registry receives only Luster's new setup wording.

Players can see their gems and permanent discounts beside the bank, and affordable development cards are highlighted. The interface revision integrates Bank PR #27 unchanged, including its automatic public-dice contribution path; the earlier manual-path description above records the original release base.

## Face-down hands and score sidebar

All reserved cards now render as backs in the public score panels, regardless of whether they came from the exposed market or an unseen tier draw. Only the owner’s separate hand renders selectable card faces. The presentation checks ownership before creating artwork, costs, bonuses, point labels or card identity attributes. A public market card’s identity remains known in signed history and replay, as required by the existing immutable assignment semantics; this UI change does not claim to erase that information. Blind reservations continue to be redacted by the engine and learned only by their owner. No engine version or protocol change is needed.

Desktop uses the same board/sidebar convention as the other site games: the main bank, market, selection tray and own hand sit beside a compact sticky score column. Scores, gems, discounts, earned nobles, reservation backs and purchased developments are public. The sidebar scrolls when necessary, and at narrower widths moves below the main area. Luster-scoped layout rules widen only this game’s main container. No reference artwork, Bank code or shared library changes.

Bank PR #29 (roll guide) is incorporated unchanged in the final base. The hand and sidebar follow-up edits no Bank files and changes no common runtime or crypto policy.
