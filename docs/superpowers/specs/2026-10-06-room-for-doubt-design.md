# Room for Doubt: design

**Date:** 2026-10-06. **Status:** design approved in conversation (parts 1 and 2); this file awaits the owner's review before any plan is written.

**Scope:** a design package in the manner of D066 (Right of Way): a rules spec, an original board and art, name guards and decision-log entries. **No** engine, UI, fuzz target, e2e spec or package.

## 1. Request and success criteria

The owner asked: *"Design a trademark & copyright safe version of Clue with a clever name and original artwork and rewritten rules, which follows the exact same gameplay mechanics as Clue."* (This file is under `docs/`, so it may name the reference game; CLAUDE.md, D046.)

The package is done when:
1. `docs/games/room-for-doubt/RULES.md` specifies the published game's mechanics exactly, each rule marked **verified**, **recalled**, **platform** or **OPEN**, in new prose, with a `#### Cnn` verification catalog.
2. Nothing in the package reproduces the reference game's names, characters, weapons, rooms, board layout, art or rulebook wording.
3. All art is original and dedicated CC0-1.0.
4. The board is generated from a plain-text grid, and a repo test proves its structural properties.
5. The repo guards restrict the reference game's names, `tests/catalog.test.ts` lists the game as spec only, and `pnpm check` passes.
6. The hidden-information requirements and the build options are written down for the owner to choose between at build time.

## 2. Decisions taken in the brainstorm

| Decision | Choice | Considered and set aside |
|---|---|---|
| Scope | design package (D066 style) | design plus playable build; a standalone print-and-play pack |
| Name and setting | **Room for Doubt**, the Aldermoor Assize Courts, 1934 | Stage Whisper (theatre); Exhibit A (museum) |
| Fallback title | *Sealed Verdict* (title text only) | |
| Board | a new grid with proven properties, a different room arrangement from the reference's | a topological twin of the reference board; a free-form redesign |
| Hidden cards | document three build paths and recommend A, then B (section 7) | choosing one now |
| Guard for the bare title | exact-case whole word `Clue` or `CLUE` only (section 8) | a case-insensitive ban (would block a future Hanabi engine's `clue`); no ban |
| Dice online | table option `live` (exact) or `ahead` (async adaptation) | `live` only |

**Name check.** On 2026-10-06 web searches found no board game published as "Room for Doubt" (they found *Doubt*, 2019, a different game). This is not trademark clearance, which stays with a lawyer before release, as for Luster and Right of Way.

## 3. Sources and interpretations

| Source | Used for |
|---|---|
| Parker Brothers *Clue* instruction book, 2002 printing (3 to 6 players), PDF from the publisher's site, read in full (pages 1–7) | primary: components, setup, movement, suggestion, accusation |
| rulespal.com *Clue* rulebook extract | the last-remaining-player rule; one accusation per game |
| Wikipedia "Cluedo" | four corner rooms joined by diagonal passages; modern editions start by highest roll |

BoardGameGeek itself was not read. The id **1294** comes from the URL of a search result and must be confirmed when the package exists.

| Topic | Rule | Basis |
|---|---|---|
| Players | 3 to 6 | **verified** (2002 cover). Two players is OPEN, as for Chain Reaction |
| Cards | 21: 6 suspects, 6 weapons, 9 rooms | **verified** |
| Case file | one card of each kind, chosen blind and sealed | **verified** |
| Deal | the other 18 dealt out; some hands may be larger | **verified** |
| Pieces | all six suspect pawns are on the board; each player takes the pawn nearest them; the rest stand on their start squares | **verified** |
| Weapons | each in a different room; "any six of the nine" | **verified** |
| First player | the first suspect always goes first, then to the left | **verified** (2002); modern editions use highest roll |
| Dice | two | **verified** |
| Move | roll, move that many squares horizontally or vertically; turn as often as you like; never onto an occupied square; never the same square twice in a turn | **verified** |
| Doors | the doorway is not a space; a door blocked by a pawn cannot be passed; entering a room ends the move; no re-entering the same room in one turn; a trapped player waits | **verified** |
| Passage | in a corner room at the start of your turn, instead of rolling | **verified** |
| Suggestion | on entering a room; names that room; the named suspect and weapon move there; one per entry | **verified**. Whether it is required is **OPEN** |
| Naming | you may name cards you hold, and items already in the room | **verified** |
| Moved suspect | if another player's suggestion moved your pawn, on your next turn you may suggest in that room without rolling, or leave normally | **verified** |
| Disproof | clockwise from the player on the suggester's left; the first holder of a named card shows exactly one, of their choice, to the suggester only; it stops there | **verified** |
| No disproof | the suggester may end the turn or accuse | **verified** |
| Accusation | on your turn, any three, any room; look at the case file in secret; once per game; may follow a suggestion in the same turn | **verified** |
| Wrong accusation | no further moves, cannot win, still shows cards, pawn stays; a pawn blocking a door moves into that room | **verified** |
| Win | a correct accusation: lay the cards out | **verified** |
| Last standing | when all but one player are out, the last wins | **verified** in rulespal's rulebook; the 2002 book is silent |
| Roll shortfall | no legal path of the full roll | not stated: **platform** |

## 4. The game

### 4.1 World, names and vocabulary

**Room for Doubt.** Tagline: "Leave no room for doubt." The pun is reasonable doubt, and the nine rooms you must stand in to make a submission.

**Setting.** The Aldermoor Assize Courts, the night before the Michaelmas verdict, 1934. Mr Justice Horatio Penhallow is dead, the storm has cut the telephone line, and six people are still inside. The true account is sealed in **the Verdict**, locked in the strongbox at the centre of the **Rotunda**.

**Vocabulary.** The 21 cards are **Parties** (who), **Exhibits** (with what) and **Scenes** (where). A player **submits** (suggests), the others **rebut** (disprove by showing one card), a player **indicts** (accuses), and a wrong indictment is **dismissed**. Start squares are **Entrances**; the secret passages are the **Old Gaol Passages**; notes are the **Docket**.

| Party (engine id) | Role | Emblem | Accent | Entrance |
|---|---|---|---|---|
| Rosalind Ashdown (`ashdown`) | Crown prosecutor | wig | oxblood | Counsel's Door |
| Hartley Brine (`brine`) | jury foreman, a grocer | bowler hat | umber | Jurors' Door |
| Octavia Reeve (`reeve`) | court physician | pince-nez | ivory | Infirmary Door |
| Barnaby Crowther (`crowther`) | chief bailiff | whistle | slate | Staff Door |
| Lucian Faulk (`faulk`) | the defendant | broad arrow | ochre | Prisoners' Door |
| Delphine Quarrel (`quarrel`) | court reporter | quill | teal | Press Door |

The order above is the clockwise order of the Entrances and the turn order. Colour is never the only cue: every pawn and card also carries its emblem and a two-letter monogram.

| Exhibits | Scenes (engine id) |
|---|---|
| Gavel (`gavel`), Brass Scales (`scales`), Law Reports (`reports`), Water Carafe (`carafe`), Manacles (`manacles`), Clock Hand (`clockhand`) | Courtroom (`courtroom`), Judge's Chambers (`chambers`) ✦, Jury Room (`jury`), Robing Room (`robing`), Registry (`registry`), Evidence Store (`store`) ✦, Holding Cells (`cells`) ✦, Belfry (`belfry`) ✦, Press Gallery (`gallery`) |

✦ corner room. The Old Gaol Passages run Chambers ↔ Evidence Store and Belfry ↔ Holding Cells. Engine ids are permanent once they appear in network events; display names live in the brand pack.

**Brand pack.** `gameTitle` Room for Doubt; `tagline` "Leave no room for doubt."; `summary` "Six people are trapped in the Aldermoor Assize Courts the night its judge is murdered. Move through nine rooms, make submissions, rebut with the cards you hold, and indict the party, the exhibit and the scene before anyone else, for three to six players."; `aliases` mystery, whodunit, murder, detective, deduction, courthouse.

"Tower" is a restricted word in this repository (a Chain Reaction chain name, matched anywhere inside a word), which is why the corner room is the Belfry.

### 4.2 Same and different

| Kept exactly (mechanics) | Replaced (expression and brand) |
|---|---|
| 21 cards, 6/6/9; a 3-card case file, one of each kind; the other 18 dealt | every name, the setting, the era, the six suspects, six weapons and nine rooms |
| two dice; orthogonal movement; occupied squares, repeated squares, doors, blocked doors, room entry, no re-entry | the rules wording (written from scratch) |
| secret passages between opposite corner rooms | the passages' fiction (the Old Gaol Passages) |
| suggest, clockwise one-card disproof, accuse once, elimination that still shows cards | the words for them (submit, rebut, indict, dismissed) |
| the moved-suspect rule; the last player standing wins | the board layout, pawn look and all art |

### 4.3 Platform rules (marked as such in RULES.md)

- **P1 Seats and parties.** Parties are spread evenly around the building, in party order, so the Prosecutor is always played and goes first (the published "first suspect always starts"). Seats take them in turn order: 3 seats Ashdown, Reeve, Faulk; 4 seats Ashdown, Brine, Crowther, Faulk; 5 seats all but Quarrel; 6 seats all. Unplayed parties stand on their Entrances, can be named in submissions and block squares.
- **P2 Deal.** From seat 0: 3 seats 6, 6, 6; 4 seats 5, 5, 4, 4; 5 seats 4, 4, 4, 3, 3; 6 seats 3 each.
- **P3 Exhibits.** Six different rooms are drawn from the jointly shuffled public setup (as Luster's first player is), one per Exhibit.
- **P4 Shortfall.** A party moves the whole roll, or enters a room on the way (which ends the move). If neither is possible, it moves along the longest legal path (any path of that greatest length), possibly not at all.
- **P5 Trapped.** A party that cannot move passes its move. It may still indict, or submit if another party's submission moved it.
- **P6 Last standing.** The engine declares the last undismissed seat the winner (D015: games end only by declaration).
- **P7 Result.** A winner is place 1 with score 1; every other seat shares place 2 with score 0.

### 4.4 OPEN options (logged in DECISIONS)

- `submit`: `'optional'` (default) or `'required'`. The 2002 book words entry as an instruction ("As soon as you enter a Room, make a Suggestion") but also says "you may" make a suggestion followed by an accusation and limits you to one per entry.
- `dice`: `'live'` (default) or `'ahead'` (section 7).
- Two players: not offered. The 2002 book is for 3 to 6, so a 2-player variant stays OPEN, as Chain Reaction's does.

## 5. The board

`docs/games/room-for-doubt/board.txt` is the single source. It is a 24 × 24 text grid (columns A–X, rows 1–24): `.` corridor, `#` the Rotunda (the only blocked squares), one letter per room, an arrow on a room's edge square for each door (pointing at its doorstep), `1`–`6` for the Entrances. `art/board.svg` is rendered from it by `scripts/room-for-doubt-art.ts` and carries the grid's SHA-256 in a comment.

`tests/room-for-doubt-board.test.ts` (repo project) proves, on every `pnpm check`:
1. The grid is 24 × 24 with a legal legend; the Rotunda is one rectangle of blocked squares, 5–7 squares a side, centred within one square of the board's centre.
2. The nine rooms are each one connected region; the four corner rooms touch their board corners (Chambers NW, Belfry NE, Holding Cells SW, Evidence Store SE).
3. Each room has 1–4 doors (corner rooms 1–2), 17–19 in all; each door joins one room square to one corridor square (its doorstep) and no doorstep serves two doors.
4. The two passages join Chambers ↔ Evidence Store and Belfry ↔ Holding Cells.
5. The six Entrances lie on the outer ring in clockwise party order, at least 6 squares apart along the perimeter.
6. There are 190–230 corridor squares; every corridor square has at least two neighbours in the movement graph (no dead ends); every doorstep reaches every Entrance.
7. Door-to-door trip lengths between rooms (a step out, the corridor squares, a step in; passages excluded): every pair is finite, the median is 9–14, the maximum at most 28, at least 5 pairs are 7 or less, and every room has at least 3 others within 12. These bands are design targets of ours, not measurements of the reference board; if the layout cannot meet one, the plan records the reason when it adjusts it.
8. The SVG's embedded hash matches the grid.

**Originality.** The reference board arranges its rooms 1-1-1-2 around the edges with a central block (recalled from general knowledge, not a rules fact). Ours has one room-free edge, the **Colonnade** (a wide corridor down the west side between Chambers and Holding Cells), an inner room beside the Rotunda (the Jury Room, reached from an inner ring corridor), and two rooms stacked on the east. This is a design constraint reviewed by a person; it is not mechanically provable.

## 6. Art

All files in `docs/games/room-for-doubt/art/` are original SVG made for this project and dedicated to the public domain (CC0-1.0). Text uses generic font stacks (serif, sans); the web build later chooses freely licensed fonts.

| File | What |
|---|---|
| `cover.svg` | the Aldermoor Assize Courts at night, the Belfry lit, the lamp's long shadow on the steps |
| `board.svg` | the floor plan, rendered from `board.txt` |
| `cards.svg` | the 21 card faces, the card back and the Verdict envelope |
| `pieces.svg` | the six party pawns (emblem, monogram), the six Exhibit tokens and two dice |
| `docket.svg` | the notes sheet: 21 names with a column per player |

**Style.** A letterpress, legal-office look: parchment paper, ink outlines, brass and oxblood, wax-seal emblems; flat, no gradients on cards. Palette: ink `#241f2b`, parchment `#f0e6d0`, oxblood `#7a1f2b`, brass `#b08d3a`, slate `#4a5a6a`, teal `#2f6f73`, ochre `#c58a1f`, umber `#6b4a32`, ivory `#f6f1e4`. Each Exhibit and Scene has its own pictogram, so no card relies on colour. Text and key marks are checked for contrast (WCAG AA).

## 7. Online play and hidden information

| Hidden thing | Who may know | Platform mechanism |
|---|---|---|
| The Verdict (1 Party, 1 Exhibit, 1 Scene) | nobody, until an indicting seat reads it | One deck in three groups (6/6/9) (`DeckSpec.partitions`). The first card of each group is the Verdict and is never dealt. An indictment deals those three positions to the indicting seat, so only that seat can decrypt them. |
| Hands | the holder (sizes are public) | the standard deal at setup |
| The Exhibits' starting rooms | everyone | a fourth group of 9 cards (one per room) in the same deck, revealed publicly at setup; the first 6 name the rooms (P3) |
| A card shown in a rebuttal | the shower and the submitter | Right of Way's sealed share (PROTOCOL §4.10): the shower seals its share of that card to the submitter |
| "I hold none of those three" | public claim | audited at the end, like Chain Reaction's `skipPlace` |
| The indictment's outcome | the indicting seat, then everyone | claimed by that seat and audited, so a false win is caught at the end audit |
| Dice | public | Bank's key-committed beacon (D058), combined with the deck as "Deck plus dice" below says |

**Resolving an indictment.** After the indictment the engine asks each other seat, in turn, for one `attend` move. Each carries that seat's owed shares for the Verdict positions (PROTOCOL §6.2). The indicting seat then decrypts the three cards and publishes `verdict` (upheld or dismissed). The cost is n − 1 async hops for each indictment. The first indictment needs no prompt duty. A second indictment, after a wrong one, deals the same positions again, so the first indicter, though dismissed, must also seal its share of them to the new indicter (PROTOCOL §4.10); only a seal duty can deliver that today (see build path A). (Corrected in review: this paragraph first said that indictment resolution never needs a prompt duty.)

**Actions** (one accepted encoding each; names only, the build fixes the encodings): `roll`, `move`, `passage`, `stay` (a trapped party's pass), `submit`, `show`, `none` (no matching card), `indict`, `attend`, `verdict`, `endTurn`. A player never sends the dice (the session derives `rolled`).

**Where the platform cannot be exact yet.** Both gaps change who knows what, so RULES.md records them as platform limits, not rules.
1. **Hand mix is public.** A card's group is visible from its deck position, so everyone can see how many Parties, Exhibits and Scenes each seat holds. At a table only hand sizes show.
2. **Which card was shown is visible.** A rebuttal names a deck position, so a repeated show reads as "the same card again".

**Build paths (the owner chooses at build time).**
- **A. Beta on today's pieces,** as Luster and Right of Way shipped. Both deviations ship documented. The seal duty is today gated by `DeckSpec.promptShares`, which only Luster, Right of Way and Driftwrights may set (D050, D067, D069), so a rebuttal's sealed share needs a fourth owner exception. So does a second indictment: the first needs none, but after a wrong one the first indicter, though dismissed, must seal its share of the Verdict positions to each later indicter, and a first indicter who never answers stalls that later indictment (PROTOCOL §8.1). A narrower rule would let a sealed share ride on its sealer's own move (the shower's `show`, the first indicter's `attend`); a Move carries no sealed shares today (PROTOCOL §4.4), so that is a protocol change, a possible design not yet checked against the session.
- **B. Exact, with platform work.** Deck epochs (an 18-card re-shuffle after the Verdict is fixed; GAME-SYSTEMS §4.1.4, roadmap #4) fix gap 1. Sealed choices (a public commitment, a private opening, an audit-time check; §4.4, roadmap #9) fix gap 2. Room for Doubt would be the validating game for both. This needs new session and protocol code and an adversarial review.
- **C. Dealer tables** (`docs/proposals/dealer-relay.md`): exact and immediate, but the dealer is trusted.

**Deck plus dice (every path).** Room for Doubt both deals cards and rolls dice. PROTOCOL §6.3a says that v1 has no deck id on the beacon's share store, so a game cannot do both; the one exception is Driftwrights' game-specific extension (PROTOCOL §13, D069, D070), which puts the card positions first and the roll slots after, and binds each roll to the move that requests it. A build on path A or B must reuse or generalise that extension, which is platform work in its own right.

**Recommendation:** A as a beta, then B; C only if dealer tables are adopted generally. Since this was written, the owner decided that every game stays on protocol 1 until the move to trusted dealers, and named the trusted-dealer proposal as the next step for hidden-information safety (D071), so path C may become the build path sooner than this recommendation assumed. The choice stays the owner's. (Updated 2026-10-06, after main moved: the exception count, the deck-plus-dice note and the D071 sentence.)

**Dice and pace.**
- `live` is exact: the roll comes from every seat's key-committed beacon share, each sent by that seat's open app with no decision (a closed window stalls the roll, as in Bank).
- `ahead` is an async adaptation (a named variant, D049): the next turn's roll is scheduled at the end of the previous turn and the others' shares ride on their moves. The cost is that a party starting in a corner room sees the roll before choosing whether to take the passage.
- Every submission also waits on responses in turn, so this is a slow async game; the catalog entry says so.

**Resign** is disabled at every seat count (`resignAllowed` false) until its D052 review, as for Luster and Right of Way.

**Catalog entry (for the build).** players 3–6, best 4; 45–90 minutes face to face; weight 1.6; luck 2; genre `family`; mechanisms `deduction`, `dice-rolling`, `grid-movement`; competitive; sequential; hidden information and randomness; minimum age 8; "Compare to Clue" with BoardGameGeek 1294; art credit "Original board, card and cover art by Bored Games", CC0-1.0.

**Interface notes (for the build).** The Docket is private to the player. It records what that player has seen (their hand, the cards shown to them) and the public record of who rebutted, and leaves every deduction to the player. The game screen says who owes a rebuttal, an `attend` or a roll contribution, and when the deadline passes.

## 8. Repository changes

| File | Change |
|---|---|
| `docs/games/room-for-doubt/RULES.md` | the source of truth: name and what is original; glossary; sources; components; board; setup; your turn; end; rule options; platform rules; online play; art direction; the catalog below |
| `docs/games/room-for-doubt/board.txt`, `art/*.svg` | the grid and the five art files (section 6) |
| `scripts/room-for-doubt-art.ts` | renders `board.svg` from `board.txt` |
| `tests/room-for-doubt-board.test.ts` | the section 5 proofs |
| `tests/restricted-names.ts` | new restricted names (below) |
| `tests/repo-guards.test.ts` | guard tests for each new form |
| `tests/catalog.test.ts` | `SPEC_ONLY` gains `'room-for-doubt'` |
| `docs/DECISIONS.md` | D072 |
| `docs/PLAN.md` | a status entry |
| `CLAUDE.md` | the repo map says Room for Doubt is spec only; the "Compare to" exception lists it once its package exists |

**Restricted names.** In any case, inside words, with each multi-word name in its spaced, joined, hyphenated and underscored forms (a helper builds them): `Cluedo`; `Hasbro`; `Parker Brothers`; `Waddington`; `Anthony Pratt` and `Anthony E. Pratt`; `Tudor Mansion`; `Boddy`; the suspects' full names (Colonel Mustard, Miss Scarlett and Miss Scarlet, Professor Plum, Mrs. Peacock, Mrs. White, Mr. Green, Reverend Green, Dr. Orchid). Single common words (Plum, Green, White, Black, Peacock) are not restricted: Right of Way uses "Plum" as a cargo. The bare title is restricted only as the exact-case whole word `Clue` or `CLUE` (a second, case-sensitive matcher), so lowercase "clue", `clues`, `ClueAction` and `HintClue` pass. The allowed phrase "Compare to Clue" gets its `ALLOWED_PHRASE_HOMES` entry and its `src/compare.ts` when the package exists, as in D066. `Hasbro` already appears in a Chain Reaction `licensed/` comment, which the guard exempts.

**Verification catalog.** About 45 entries, `C01`–`C45`, each to get a named test when the engine exists: components; seats; the Verdict; the deal; parties and Entrances; Exhibit start; first player; turn shape; roll; orthogonal movement; occupied squares; repeated squares; doors; blocked doors; room entry; no re-entry; Old Gaol Passages; trapped; roll shortfall; submission on entry; one submission per entry; the moved party; submission contents; named items move; own cards; rebuttal order; one card; choice; passing; no rebuttal; rebuttal privacy; indict timing; indict once; the Verdict check; upheld; dismissed; a dismissed party's duties; a pawn blocking a door; last standing; named parties move; standings; invalid input; determinism and fold; audit of hidden claims; games end.

## 9. Verification of the package

1. `pnpm check` passes (typecheck, Biome, every Vitest project, including the new guard, catalog and board tests and the public build scan).
2. The board test passes and prints the trip-length statistics.
3. Every new file under `docs/games/room-for-doubt/` except `RULES.md` is scanned for every restricted name and for the licensed packs' strings, and holds none.
4. Each SVG is rendered with the installed Chromium and inspected for overlap, clipping and legibility, including at phone width for the cards.

## 10. Risks and items for the owner

- **Name clearance** is a lawyer's job. The fallback is *Sealed Verdict*.
- **The hidden-card path** (section 7) is the owner's decision before any build.
- **The `Clue` guard** is exact-case only. A future Hanabi engine may use lowercase `clue`; a standalone capitalised `Clue` in code or comments fails the guard and is reworded.
- **BoardGameGeek 1294** is unverified on BoardGameGeek itself.
- **Pace.** Async play needs many hops (submissions, `attend` moves, rolls). `ahead` removes the roll wait at the cost described above.
- **Originality of the layout** is reviewed by a person (section 5).
- **Resign** stays disabled.

## 11. Out of scope and next steps

Out of scope: an engine, a package, UI, a fuzz target, a simulation, an e2e spec, the platform work of build path B, and any dealer table.

Next: the owner reviews this file; then the implementation plan is written (`docs/superpowers/plans/`) and the owner chooses how to execute it; then the package is built, verified, pushed and opened as a draft pull request.
