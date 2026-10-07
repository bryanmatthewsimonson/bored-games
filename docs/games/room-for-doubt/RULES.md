# Room for Doubt rules

**Room for Doubt** is a deduction game for 3–6 players. Six people are trapped in the Aldermoor Assize Courts on the night before a verdict, and the judge is dead. Players walk the building, make submissions in its rooms, rebut each other with the cards they hold, and race to indict the right Party, the right Exhibit and the right Scene. This file is the **source of truth** for a future engine in `packages/games/room-for-doubt`.

Room for Doubt uses the mechanics of *Clue* (*Cluedo* in the United Kingdom; devised by Anthony E. Pratt, published by Parker Brothers and now Hasbro) unchanged. The rules prose, the names, the setting, the board and the artwork here are all new. This is the only file, with `docs/DECISIONS.md` and the other docs, where the reference game's name may appear (CLAUDE.md, D046). The public site may name it only through the exact "Compare to" phrase, once a `src/compare.ts` exists (D053).

**Status: spec only (D074).** There is no engine, package, web game, fuzz target or e2e spec yet. What exists is this file, the board (`board.txt`, with a test that proves its structure), the art (`art/`, CC0-1.0, drawn by `scripts/room-for-doubt/`), the name guards and the decision log. Every `#### Cnn` below is to get a named test when the engine exists (CLAUDE.md, D045); until then `tests/catalog.test.ts` lists the game as spec only. How the hidden cards would be played online, and the choices that are the owner's, are in [Online play](#online-play-and-hidden-information).

## Name, brand and what is original

### The name
- **Room for Doubt** plays on *reasonable doubt*, the bar a verdict has to clear, and on the nine rooms in which you must stand to make a submission. Both meanings fit the game: you walk the building to remove doubt, and the first player to leave none wins.
- **Tagline:** "Leave no room for doubt."
- **The setting:** the Aldermoor Assize Courts, the night before the Michaelmas verdict, 1934. Mr Justice Horatio Penhallow is dead, the storm has cut the telephone line, and six people are still inside. The true account is sealed in **the Verdict**, locked in the strongbox at the centre of the **Rotunda**.
- **Names considered and set aside:** "Stage Whisper" (a theatre setting) and "Exhibit A" (a museum setting). The fallback title is **Sealed Verdict**; only the title text would change.
- **Clearance (not legal advice).** On 2026-10-06 web searches found no board game published as "Room for Doubt" (they found *Doubt*, 2019, a different game). This is not a trademark search. As for Luster and Right of Way, a lawyer must clear the name before release.
- **A restricted word.** "Tower" is restricted in this repository (a Chain Reaction chain name, matched anywhere inside a word), which is why the north-east corner room is the Belfry.

### What is the same, and why it may be
Game mechanics, rules as systems and numbers that are part of a method of play are not protected by copyright: 17 U.S.C. §102(b), and the U.S. Copyright Office's circular FL-108 on games. A rulebook's wording, its board art, its layout and its card art are protected, and so are the title and the trade dress (the look of the box and pieces) as trademarks. So:

| Kept exactly (mechanics) | Replaced (expression and brand) |
|---|---|
| 21 cards, 6 / 6 / 9; a 3-card Verdict, one of each kind; the other 18 dealt | every name, the setting, the era, the six Parties, six Exhibits and nine Scenes |
| two dice; orthogonal movement; occupied squares, repeated squares, doors, blocked doors, room entry, no re-entry | the rules wording (this file is written from scratch, not paraphrased) |
| secret passages between opposite corner rooms | the passages' fiction (the Old Gaol Passages) |
| suggest, clockwise one-card disproof, accuse once, elimination that still shows cards | the words for them (submit, rebut, indict, dismissed) |
| the moved-suspect rule; the last player standing wins | the board layout, the pawn look and all the art |

Nothing on the board copies the reference board: the rooms, the corridors and the door positions are a new layout whose properties a test proves (see [The board](#the-board)), and the arrangement of rooms around the edges differs on purpose.

### Glossary
| Room for Doubt | Reference game | Engine id |
|---|---|---|
| Party | suspect | `ashdown`, `brine`, `reeve`, `crowther`, `faulk`, `quarrel` |
| Exhibit | weapon | `gavel`, `scales`, `reports`, `carafe`, `manacles`, `clockhand` |
| Scene | room (the card) | `courtroom`, `chambers`, `jury`, `robing`, `registry`, `store`, `cells`, `belfry`, `gallery` |
| the Verdict | the case file | one deck position per group (see [Online play](#online-play-and-hidden-information)) |
| submit | make a suggestion | `submit` |
| rebut (show a card, or say none) | disprove a suggestion | `show`, `none` |
| indict | make an accusation | `indict`, `attend`, `verdict` |
| dismissed | eliminated | `dismissed` |
| Entrance | start square | Entrance `1`–`6` |
| Old Gaol Passage | secret passage | `passage` |
| the Rotunda | the central block | the `#` squares of `board.txt` |
| the Docket | the detective notes | none: paper, not state |
| the Colonnade | no counterpart | the west corridor of `board.txt` |

Engine ids are plain words, permanent once they appear in network events. Display names belong to the brand pack (`src/theme.ts`, the trademark-safe pack, D046). There is no licensed pack: the reference game's names would need a licence.

### Brand pack (for the build)
- `gameTitle`: Room for Doubt
- `tagline`: "Leave no room for doubt."
- `summary`: "Six people are trapped in the Aldermoor Assize Courts the night its judge is murdered. Move through nine rooms, make submissions, rebut with the cards you hold, and indict the party, the exhibit and the scene before anyone else, for three to six players."
- `aliases`: mystery, whodunit, murder, detective, deduction, courthouse

## Sources and interpretations

**Sources.** The Parker Brothers instruction book of the 2002 printing (3 to 6 players; the publisher's PDF, read in full, pages 1–7), a rulebook extract on rulespal.com, and Wikipedia's article on *Cluedo*. Rules confirmed by the instruction book are **verified**. A rule that rested on the author's memory alone would be marked **recalled**; none does. Points the sources do not settle are **platform** rules or **OPEN** options, per CLAUDE.md ("Never invent rules"). BoardGameGeek itself was not read: the id **1294** comes from the URL of a search result and must be confirmed when the package exists.

| Topic | Rule | Basis |
|---|---|---|
| Players | 3 to 6 | **verified** (2002 cover). Two players is **OPEN**, as for Chain Reaction |
| Cards | 21: 6 Parties, 6 Exhibits, 9 Scenes | **verified** |
| The Verdict | one card of each kind, chosen blind and sealed | **verified** |
| Deal | the other 18 cards dealt out; some hands may be larger | **verified** |
| Pieces | all six pawns are on the board; each player takes the pawn nearest them; the rest stand on their start squares | **verified** |
| Exhibits | each in a different room: any six of the nine | **verified** |
| First player | the first Party always goes first, then play passes round; modern editions use the highest roll | **verified** (2002) |
| Dice | two | **verified** |
| Move | roll, then move that many squares horizontally or vertically; turn as often as you like; never onto an occupied square; never the same square twice in a turn | **verified** |
| Doors | the doorway is not a square; a door blocked by a pawn cannot be passed; entering a room ends the move; no re-entering the same room in one turn; a trapped player waits | **verified** |
| Passage | in a corner room at the start of your turn, instead of rolling, go to the opposite corner room | **verified**; that the passages join opposite corners is from Wikipedia |
| Submission | made on entering a room; it names that room; the named Party and Exhibit move there; one per entry | **verified**. Whether it is required is **OPEN** |
| Naming | you may name cards you hold, and items already in the room | **verified** |
| Moved party | if another player's submission moved your pawn, on your next turn you may submit in that room without rolling, or leave normally | **verified** |
| Rebuttal | asked in turn from the player after the submitter; the first holder of a named card shows exactly one, of their choice, to the submitter only, and it stops there | **verified** |
| No rebuttal | the submitter may end the turn or indict | **verified** |
| Indictment | on your turn, any three cards, any room; look at the Verdict in secret; once per game; may follow a submission in the same turn | **verified** |
| Wrong indictment | no further moves, cannot win, still rebuts, the pawn stays; a pawn blocking a door moves into that room | **verified** |
| Win | a correct indictment: lay the cards out | **verified** |
| Last standing | when all but one player are out, the last wins | **verified** in the rulespal extract; the 2002 book is silent |
| Roll shortfall | what to do when no path of the full roll exists | not stated: **platform** (P4) |
| Seats and parties | which Parties are played at each seat count | not stated: **platform** (P1) |
| Deal sizes | how many cards each seat gets | the deal is verified; the counts follow from it: **platform** (P2) |
| Exhibit rooms | how the six rooms are chosen online | not stated: **platform** (P3) |
| Trapped | a party that cannot move passes its move | **verified**; the online form is **platform** (P5) |
| Result | the winner's place and score | not stated: **platform** (P7) |

## Components

- **21 cards:** 6 Parties, 6 Exhibits and 9 Scenes (tables below). Every card shows a large pictogram in its centre and a small index (a monogram or a pictogram) in two corners, so no card relies on colour.
- **The Verdict:** three cards, one Party, one Exhibit and one Scene, sealed in an envelope at setup.
- **6 party pawns**, one for each Party, and **6 Exhibit tokens**.
- **2 dice.**
- **The board:** 24 × 24 squares, nine rooms, the Rotunda, six Entrances and two Old Gaol Passages (see [The board](#the-board)).
- **A Docket pad** for each player.

| Party (engine id) | Role | Emblem | Accent | Monogram | Entrance |
|---|---|---|---|---|---|
| Rosalind Ashdown (`ashdown`) | Crown prosecutor | wig | oxblood | RA | Counsel's Door (1) |
| Hartley Brine (`brine`) | jury foreman, a grocer | bowler hat | umber | HB | Jurors' Door (2) |
| Octavia Reeve (`reeve`) | court physician | pince-nez | ivory | OR | Infirmary Door (3) |
| Barnaby Crowther (`crowther`) | chief bailiff | whistle | slate | BC | Staff Door (4) |
| Lucian Faulk (`faulk`) | the defendant | broad arrow | ochre | LF | Prisoners' Door (5) |
| Delphine Quarrel (`quarrel`) | court reporter | quill | teal | DQ | Press Door (6) |

The order above is the clockwise order of the Entrances and the turn order. Colour is never the only cue: every pawn and card also carries its emblem and a two-letter monogram.

| Exhibits (engine id) | Scenes (engine id) |
|---|---|
| Gavel (`gavel`), Brass Scales (`scales`), Law Reports (`reports`), Water Carafe (`carafe`), Manacles (`manacles`), Clock Hand (`clockhand`) | Courtroom (`courtroom`), Judge's Chambers (`chambers`) ✦, Jury Room (`jury`), Robing Room (`robing`), Registry (`registry`), Evidence Store (`store`) ✦, Holding Cells (`cells`) ✦, Belfry (`belfry`) ✦, Press Gallery (`gallery`) |

✦ corner room. The Old Gaol Passages run Judge's Chambers ↔ Evidence Store and Belfry ↔ Holding Cells.

## The board

The board is the text file `board.txt`: a 24 × 24 grid, columns A–X from left to right and rows 1–24 from top to bottom. It is the single source: `art/board.svg` is drawn from it by `scripts/room-for-doubt/`, and `tests/room-for-doubt-board.test.ts` proves its properties on every `pnpm check`.

| Mark | Meaning |
|---|---|
| `.` | a corridor square |
| `#` | the Rotunda: blocked, no pawn may enter (the only blocked squares) |
| `C` `H` `J` `R` `Y` `E` `L` `B` `P` | a square of the Courtroom, Judge's Chambers, Jury Room, Robing Room, Registry, Evidence Store, Holding Cells, Belfry or Press Gallery |
| `^` `v` `<` `>` | a door: an edge square of a room; the arrow points at its **doorstep**, the corridor square outside |
| `1`–`6` | an Entrance (a corridor square) |

```text
HHHHHH.1CCCCCCCCC.2BBBBB
HHHHHH..CCCCCCCCC..BBBBB
HHHHHH..<CCCCCCCC..BBBBB
HHHHH>..CCCCCCCCC..BBBBB
HHHHHH..CCCCCCCCC..BBBBB
HvHHHH..CCCCvCCCC..<BBBB
...................BBvBB
.......................3
........................
..JJJ^JJ.######..PPP^PPP
..JJJJJJ.######..<PPPPPP
..<JJJJJ.######..PPPPPPP
6.JJJJJ>.######..PPPPPPP
..JJJJJJ.######..<YYYYYY
..JJJJJJ.######..YYYYYYY
.................<YYYYYY
.................YYYYYYY
L^LLLL............EEEEEE
LLLLLL..RR^RRRR...<EEEEE
LLLLLL..RRRRRRR...EEEEEE
LLLLL>..RRRRRRR...EEEEEE
LLLLLL..RRRRRR>...<EEEEE
LLLLLL..RRRRRRR...EEEEEE
LLLLLL5.RRRRRRR4..EEEEEE
```

| Letter | Scene | Corner | Size | Doors (square and the side the doorstep lies on) |
|---|---|---|---|---|
| `C` | Courtroom | | 9 × 6 | I3 west, M6 south (2) |
| `H` | Judge's Chambers | north-west ✦ | 6 × 6 | F4 east, B6 south (2) |
| `J` | Jury Room | | 6 × 6 | F10 north, C12 west, H13 east (3) |
| `R` | Robing Room | | 7 × 6 | K19 north, O22 east (2) |
| `Y` | Registry | | 7 × 4 | R14 west, R16 west (2) |
| `E` | Evidence Store | south-east ✦ | 6 × 7 | S19 west, S22 west (2) |
| `L` | Holding Cells | south-west ✦ | 6 × 7 | B18 north, F21 east (2) |
| `B` | Belfry | north-east ✦ | 5 × 7 | T6 west, V7 south (2) |
| `P` | Press Gallery | | 7 × 4 | U10 north, R11 west (2) |

| Entrance | Party | Door name | Square |
|---|---|---|---|
| 1 | Rosalind Ashdown | Counsel's Door | H1 |
| 2 | Hartley Brine | Jurors' Door | S1 |
| 3 | Octavia Reeve | Infirmary Door | X8 |
| 4 | Barnaby Crowther | Staff Door | P24 |
| 5 | Lucian Faulk | Prisoners' Door | G24 |
| 6 | Delphine Quarrel | Press Door | A13 |

The Rotunda fills J10 to O15. The two Old Gaol Passages join the corner rooms that lie diagonally opposite each other: Judge's Chambers ↔ Evidence Store (28 squares apart on foot) and Belfry ↔ Holding Cells (29 squares apart on foot).

<!-- board-stats -->19 doors · 197 corridor squares · median trip 13.5 · longest trip off the passages 22 · passage trips 28 and 29 · 7 trips of 7 or fewer<!-- /board-stats -->

A **trip** is the shortest walk between two rooms: one step out of the first room, the corridor squares between the two doorsteps, and one step into the second, minimised over the rooms' doors, never using a passage.

**What the board test proves.** On every `pnpm check`:
1. The grid is 24 × 24 with a legal legend. The Rotunda is one rectangle of blocked squares, 5–7 squares a side, centred within one square of the board's centre.
2. The nine rooms are each one connected region, and the four corner rooms touch their board corners (Judge's Chambers north-west, Belfry north-east, Holding Cells south-west, Evidence Store south-east).
3. Each room has 1–4 doors (a corner room 1–2), and there are 17–19 in all. Each door joins one room square to one corridor square, and no doorstep serves two doors.
4. The two passages join Judge's Chambers ↔ Evidence Store and Belfry ↔ Holding Cells.
5. The six Entrances lie on the outer ring in clockwise party order, at least 6 squares apart along the perimeter.
6. There are 190–230 corridor squares, they are all connected, and each has at least two neighbours counting doors (no dead ends).
7. Every pair of rooms can reach each other. The median trip is 9–14. A pair of rooms that no passage joins is at most 24 apart, and each passage pair is at least 24 apart on foot (the passage is the shortcut across the whole building). At least 5 pairs are 7 or fewer apart, and every room has at least 3 others within 12.

These bands are design targets of ours, not measurements of the reference board. The design first set a single maximum of 28 for every pair. The two passage pairs are, by design, the longest trips on the board (28 and 29), so the limit is stated per pair: at most 24 where no passage joins the rooms, and at least 24 where one does (D074).

**Originality.** The reference board arranges its rooms one, one, one and two around the four edges, with a block in the middle (recalled from general knowledge, not a rules fact). This board has one edge with no room between the corners: the **Colonnade**, a corridor two squares wide down the west side (columns A and B, rows 7–17) between Judge's Chambers and Holding Cells. It has one room set inside the ring, beside the Rotunda (the Jury Room, reached from an inner ring of corridor), and two rooms stacked on the east side (the Press Gallery and the Registry). Whether the layout is different enough is a design judgement reviewed by a person; it is not mechanically provable.

## Setup

1. **Seats and Parties (P1).** The Parties are spread evenly round the building, in party order, so the Prosecutor is always played and goes first. Seats take them in turn order: 3 seats play Ashdown, Reeve and Faulk; 4 seats play Ashdown, Brine, Crowther and Faulk; 5 seats play all but Quarrel; 6 seats play all six. Every pawn, played or not, stands on its Entrance. An unplayed Party's pawn stays there until a submission names it; it can be named and it blocks its square like any pawn.
2. **The Verdict.** One Party card, one Exhibit card and one Scene card are drawn blind and sealed in the envelope without anyone seeing them.
3. **The deal (P2).** The other 18 cards are shuffled and dealt face down, starting with the first seat and going round, so each card is held by exactly one seat. The counts: 3 seats get 6, 6, 6; 4 seats get 5, 5, 4, 4; 5 seats get 4, 4, 4, 3, 3; 6 seats get 3 each. Some hands are larger than others, and that is intended. Each player looks at their own hand and marks it on their Docket.
4. **The Exhibits (P3).** The six Exhibit tokens go to six different rooms, one in each, chosen at random from the nine.
5. **First player.** The first seat, the Prosecutor, moves first. Play passes in seat order, which is party order.

## Your turn

A turn has a movement, then, if you are entitled to one, a submission, then the end. You may indict at any point of your own turn; an indictment ends the turn (see [3. Indict](#3-indict)). Play passes over a dismissed seat, which takes no turns. Nothing is accepted out of turn, apart from a seat's answer when it is asked to rebut or to attend (see [Online play](#online-play-and-hidden-information)).

### 1. Move
Do one of these three.

**Roll and walk.** Roll the two dice and walk your pawn exactly the total, from 2 to 12 squares. A player never sends the dice online: the session derives them.
- A step goes to an orthogonally adjacent square (up, down, left or right), never diagonally. You may turn as often as you like.
- You may not enter or end on a square holding any pawn: another player's, an unplayed Party's or a dismissed Party's. Rooms are not squares in this sense: any number of pawns and tokens may stand in a room.
- You may not enter the same square twice in one turn.
- **Doors.** A room is entered and left through its doors. Passing a door is one step, between the doorstep (the corridor square outside) and the room itself; the doorway is not a square and costs nothing more. A door whose doorstep holds a pawn cannot be used, in either direction.
- **Entering a room ends your move**, however much of the roll is left. You may not enter a room that you left earlier in the same turn.
- **Shortfall (P4).** You must use the whole roll, or enter a room on the way, which ends the move as above. If neither is possible (no path of the full roll exists and no shorter path ends in a room), you move along the longest legal path there is, which may be no squares at all; any path of that greatest length is accepted.

**Take the Old Gaol Passage.** If your pawn starts the turn in a corner room, you may skip the roll and move at once to the corner room diagonally opposite (Judge's Chambers ↔ Evidence Store, Belfry ↔ Holding Cells). You count as having entered it.

**Stay and submit.** Only a Party that another player's submission moved into its room since its last turn may do this: it submits there at once, without rolling (see 2). Any other Party takes one of the first two moves.

### 2. Submit
A submission is a question to the table. You may make one when you have just entered a room, by walking or by a passage, and a moved Party may make one at the start of its turn (see 1). Under the default rule (`submit: 'optional'`) it is your choice; under `'required'` you must (see [Rule options](#rule-options)).
- You name one Party and one Exhibit, and the room you are standing in. You may name any Party and any Exhibit, including cards you hold yourself and items already in the room.
- The named Party's pawn and the named Exhibit's token are placed in your room. Nothing moves if one is already there. A Party named in a submission moves whether it is played, unplayed or dismissed.
- **One per entry.** You may not submit twice in a room unless you leave and enter it again, or another player's submission moves you there again.
- **The moved Party.** A Party moved by someone else's submission may, at the start of its next turn, submit in that room instead of rolling. If it does not, it leaves normally: it rolls and walks, or takes the passage if the room is a corner room. A Party that was already in the room is not moved, and gains nothing.

### Rebutting a submission
- The other seats are asked in turn order, starting with the seat after the submitter. A dismissed seat is asked like any other.
- A seat holding at least one of the three named cards (the Party, the Exhibit and the room's Scene) must show exactly one of them to the submitter alone, and the asking stops there. A seat holding several chooses which to show.
- A seat holding none says so (`none`), and the next seat is asked.
- Every seat sees that a card was shown and by whom. Only the submitter sees which card.
- If every other seat says none, the submission stands unrebutted. You may end your turn or indict.

### 3. Indict
- A seat that is not dismissed may indict, **once per game**, at any point of its own turn: before it moves, after it moves, or after a submission, whether or not that submission was rebutted.
- You name any Party, any Exhibit and any Scene. The Scene need not be the room you stand in.
- Then you, and nobody else, look at the Verdict in secret.
- **Upheld.** If your three cards match the Verdict exactly, the game ends and you win. Lay the cards out for the table.
- **Dismissed.** Otherwise you are dismissed. You may no longer move, submit or indict, and the Verdict goes back sealed, unseen by anyone else. You keep your hand and you still rebut and attend, as before. Your pawn stays where it is, and other players' submissions may still name your Party and move your pawn. If your pawn stands on a doorstep, it moves into that door's room at once, so that it never blocks the door.

### A turn with no possible move
A Party that cannot move (every route is blocked, or it is walled in) passes its move (P5). It may still indict, or submit if another Party's submission has moved it into a room. A seat that has not been dismissed always has a legal action, because it can indict, so play never deadlocks.

## End of the game

The game ends the moment an indictment is upheld: that seat wins. It also ends when every seat but one has been dismissed: the last seat standing wins at once (P6). A winner is place 1 with score 1; every other seat shares place 2 with score 0 (P7).

There is no stall rule. Games end only by declaration (D015, D016): a game in which no seat ever indicts is a bug in the engine or its fuzz policies, never a rules gap.

## Rule options

- **`submit`:** `'optional'` (the default) or `'required'`. The source book phrases entering a room as an instruction to make a suggestion at once, yet elsewhere says that a player may make a suggestion and then an accusation in one turn, and limits a player to one suggestion per entry. Whether a submission is required is therefore **OPEN**, so it is an option, logged in DECISIONS.
- **`dice`:** `'live'` (the default) or `'ahead'` (see [Dice and pace](#dice-and-pace)).
- **Two players:** not offered. The 2002 book is for 3 to 6 players, so a two-player variant stays **OPEN**, as Chain Reaction's does.

## Platform rules

These are platform necessities, not published rules (D015, D016).
- **P1 Seats and Parties.** As in Setup step 1. The Prosecutor is always played and goes first, which matches the published rule that a fixed first Party always starts.
- **P2 The deal.** From the first seat: 3 seats 6, 6, 6; 4 seats 5, 5, 4, 4; 5 seats 4, 4, 4, 3, 3; 6 seats 3 each.
- **P3 Exhibits.** Six different rooms are drawn from the jointly shuffled public setup, as Luster's first player is, one room for each Exhibit. No seat can choose them.
- **P4 Shortfall.** A Party moves the whole roll, or enters a room on the way, which ends the move. If neither is possible, it moves along the longest legal path, possibly no squares at all, and any path of that greatest length is accepted. The published rules are silent; "as far as it can" is read as the greatest distance, not as "until a dead end".
- **P5 Trapped.** A Party that cannot move passes its move. It may still indict, or submit if another Party's submission has moved it.
- **P6 Last standing.** The engine declares the last undismissed seat the winner (D015: games end only by declaration).
- **P7 Result.** A winner is place 1 with score 1; every other seat shares place 2 with score 0.

## Online play and hidden information

### What is hidden
| Hidden thing | Who may know | Platform mechanism |
|---|---|---|
| The Verdict (1 Party, 1 Exhibit, 1 Scene) | nobody, until an indicting seat reads it | One deck in three groups (6 / 6 / 9) (`DeckSpec.partitions`). The first card of each group is the Verdict and is never dealt. An indictment deals those three positions to the indicting seat, so only that seat can decrypt them. A second indictment, after a wrong one, deals them again, to the next indicting seat: the first indicter seals its share to that seat (PROTOCOL §4.10). |
| Hands | the holder (sizes are public) | the standard deal at setup |
| The Exhibits' starting rooms | everyone | a fourth group of 9 cards (one per room) in the same deck, revealed publicly at setup; the first 6 name the rooms (P3) |
| A card shown in a rebuttal | the shower and the submitter | Right of Way's sealed share (PROTOCOL §4.10): the shower seals its share of that card to the submitter |
| "I hold none of those three" | public claim | audited at the end, like Chain Reaction's `skipPlace` |
| The indictment's outcome | the indicting seat, then everyone | claimed by that seat and audited, so a false win is caught at the end audit |
| Dice | public | Bank's key-committed beacon (D058), combined with the deck as "Deck plus dice" below says |

### Resolving an indictment
After the indictment the engine asks each other seat, in turn, for one `attend` move. Each carries that seat's owed shares for the Verdict positions (PROTOCOL §6.2). The indicting seat then decrypts the three cards and publishes `verdict` (upheld or dismissed). The cost is n − 1 asynchronous hops for each indictment.

The first indictment needs no prompt duty: every other seat's share of the Verdict is public once the seats have attended, and only the indicting seat holds its own. A **second indictment**, after a wrong one, deals the same three positions again, so the first indicter, although dismissed, must also seal its share of them to the new indicter (PROTOCOL §4.10), as a shower seals a shown card to the submitter. Only a seal duty can deliver that today (see build path A).

### Actions (one accepted encoding each)
Names only; the build fixes the encodings: `roll`, `move`, `passage`, `stay` (a trapped Party's pass), `submit`, `show`, `none` (no matching card), `indict`, `attend`, `verdict`, `endTurn`. A player never sends the dice: the session derives `rolled`.

### Where the platform cannot be exact yet
Both gaps change who knows what, so they are recorded as platform limits, not as rules.
1. **Hand mix is public.** A card's group is visible from its deck position, so everyone can see how many Parties, Exhibits and Scenes each seat holds. At a table only hand sizes show.
2. **Which card was shown is visible.** A rebuttal names a deck position, so a repeated show reads as "the same card again".

### Build paths (the owner chooses at build time)
- **A. Beta on today's pieces,** as Luster and Right of Way shipped. Both deviations ship documented. The seal duty is switched on by `DeckSpec.promptShares`, which any game may now set under the standing exception (D075) to D050, so a rebuttal's sealed share needs no further decision. A **second indictment** needs a sealed share too, and the same flag covers it: the first indictment needs none, but after a wrong one the Verdict positions are dealt again, and the first indicter, though dismissed, must seal its share of them to each later indicter (PROTOCOL §4.10). A first indicter who never answers stalls that later indictment (PROTOCOL §8.1 names it). A narrower rule would let a sealed share ride on its sealer's own move (the shower's `show`, the first indicter's `attend`); a Move carries no sealed shares today (PROTOCOL §4.4), so that is a protocol change, a possible design not yet checked against the session.
- **B. Exact, with platform work.** Deck epochs (an 18-card re-shuffle after the Verdict is fixed; GAME-SYSTEMS §4.1.4, roadmap #4) fix gap 1. Sealed choices (a public commitment, a private opening, an audit-time check; §4.4, roadmap #9) fix gap 2. Room for Doubt would be the validating game for both. This needs new session and protocol code and an adversarial review.
- **C. Dealer tables** (`docs/proposals/dealer-relay.md`): exact and immediate, but the dealer is trusted.

**Deck plus dice (every path).** Room for Doubt both deals cards and rolls dice. PROTOCOL §6.3a says that v1 has no deck id on the beacon's share store, so a game cannot do both; the one exception is Driftwrights' game-specific extension (PROTOCOL §13, D069, D070), which puts the card positions first and the roll slots after, and binds each roll to the move that requests it. A build on path A or B must reuse or generalise that extension, which is platform work in its own right.

**Recommendation:** A as a beta, then B; C only if dealer tables are adopted generally. Since this was written, the owner decided that every game stays on protocol 1 until the move to trusted dealers, and named the trusted-dealer proposal as the next step for hidden-information safety (D071), so path C may become the build path sooner than this recommendation assumed. The choice stays the owner's.

### Dice and pace
- `live` is exact: the roll comes from every seat's key-committed beacon share, each sent by that seat's open app with no decision (a closed window stalls the roll, as in Bank).
- `ahead` is an asynchronous adaptation (a named variant, D049): the next turn's roll is scheduled at the end of the previous turn and the others' shares ride on their moves. The cost is that a Party starting in a corner room sees the roll before choosing whether to take the passage.
- Every submission also waits on responses in turn, so this is a slow asynchronous game; the catalog entry says so.

### Resign
Resign is disabled at every seat count (`resignAllowed` false) until its D052 review, as for Luster and Right of Way.

### Catalog entry (for the build)
`players {min: 3, max: 6, best: [4]}`, `playMinutes {min: 45, max: 90}` face to face, `weight` 1.6, `luck` 2, `genre: 'family'`, `mechanisms: ['deduction', 'dice-rolling', 'grid-movement']`, competitive, sequential, `hiddenInfo` and `randomness`, `minAge: 8`, "Compare to Clue" with BoardGameGeek 1294, art credit "Original board, card and cover art by Bored Games", CC0-1.0.

### Interface notes (for the build)
The Docket is private to the player. It records what that player has seen (their hand and the cards shown to them) and the public record of who rebutted, and leaves every deduction to the player. The game screen says who owes a rebuttal, an `attend` or a roll contribution, and when the deadline passes.

## Art direction

All files in `art/` are original SVG made for this project and dedicated to the public domain (CC0-1.0). `node scripts/room-for-doubt/cli.ts` draws them from `board.txt` and the tables in `scripts/room-for-doubt/data.ts`; `tests/room-for-doubt-art.test.ts` fails if a file on disk differs from what the generator draws, or uses a colour outside the palette. Text uses generic font stacks (serif and sans); the web build later chooses freely licensed fonts.

| File | What |
|---|---|
| `art/cover.svg` | the Aldermoor Assize Courts at night, the Belfry lit, the lamp's long shadow on the steps |
| `art/board.svg` | the floor plan, drawn from `board.txt` |
| `art/cards.svg` | the 21 card faces, the card back and the Verdict envelope |
| `art/pieces.svg` | the six party pawns (emblem and monogram), the six Exhibit tokens and the six faces of a die |
| `art/docket.svg` | the printable notes sheet: 21 names with a tick box for yourself and for each other player |

- **Style:** a letterpress, legal-office look: parchment paper, ink outlines, brass and oxblood, wax-seal emblems. Flat shapes, no gradients on cards.
- **Palette:** ink `#241f2b`, parchment `#f0e6d0`, oxblood `#7a1f2b`, brass `#b08d3a`, slate `#4a5a6a`, teal `#2f6f73`, ochre `#c58a1f`, umber `#6b4a32`, ivory `#f6f1e4`. Tints are made with opacity, never with new colours. Text and key marks are held to WCAG AA contrast (4.5) by the data test.
- **Pictograms (colour-blind safe):** every Party has an emblem (wig, bowler hat, pince-nez, whistle, broad arrow, quill), every Exhibit its own picture (gavel on its block, brass scales, a bound volume of reports, a water carafe, two open cuffs on a chain, a spade-shaped clock hand) and every Scene its own picture (a bench with a witness rail, an armchair behind a desk, a round table ringed by twelve chairs, a gown on a hook beside a wig stand, a filing cabinet, shelves of tagged boxes, a barred arched window, a bell in a louvred opening, figures behind a balustrade).
- **Pieces:** the pawns are discs with the emblem and, beneath, the monogram in a brass ring; the Exhibit tokens are brass squares with the pictogram.

## Verification catalog

#### C01 Components
There are 21 cards (6 Parties, 6 Exhibits, 9 Scenes) with the ids and names of the tables above, 6 party pawns, 6 Exhibit tokens, 2 dice, and the board of `board.txt`.

#### C02 Seats
Three to six seats are accepted. Two seats and seven seats are rejected.

#### C03 The Verdict
One Party, one Exhibit and one Scene are sealed at setup and dealt to no seat.

#### C04 The deal
The other 18 cards are dealt from seat 0 in the P2 counts, and each card is held by exactly one seat.

#### C05 Parties and Entrances
Seats take Parties as P1 says. Every pawn, played or not, starts on its Entrance.

#### C06 Exhibit start
Six distinct rooms, taken from the public setup, hold one Exhibit each, identically on every client.

#### C07 First player
Seat 0, the Prosecutor, moves first, and play then passes in seat order.

#### C08 Turn shape
A turn is a movement (or its alternative), then a submission if the Party is entitled to one, then the end. An indictment may come at any point and ends the turn. Nothing is accepted out of turn.

#### C09 Roll
Two dice are rolled and the total is 2 to 12. A player never sends the dice.

#### C10 Orthogonal movement
Movement is one orthogonal step at a time, never diagonal.

#### C11 Occupied squares
A pawn may not enter or end on a square holding any pawn, including the pawns of unplayed and dismissed Parties.

#### C12 Repeated squares
A square may not be entered twice in one turn.

#### C13 Doors
A door is passed in one step between its doorstep and the room. The doorway is not a square.

#### C14 Blocked doors
A door whose doorstep holds a pawn cannot be used, in either direction.

#### C15 Room entry
Entering a room ends the move, whatever part of the roll remains.

#### C16 No re-entry
A Party may not enter a room that it left earlier in the same turn.

#### C17 Old Gaol Passages
From a corner room, at the start of a turn and instead of rolling, a Party moves to the opposite corner room (Judge's Chambers to Evidence Store, Belfry to Holding Cells) and counts as having entered it.

#### C18 Trapped
A Party with no legal move passes its move. It may still submit if it has been moved into a room, or indict.

#### C19 Roll shortfall
If no path of the full roll exists and no shorter path ends in a room, the Party moves along the longest legal path (P4), which may be none, and any path of that greatest length is accepted.

#### C20 Submission on entry
After entering a room by roll or by passage, a Party may submit (`submit: 'optional'`) or must (`'required'`).

#### C21 One submission per entry
A Party may not submit twice in a room without leaving and entering it again, or being moved there again.

#### C22 The moved Party
A Party moved by another's submission may submit in that room at the start of its next turn instead of rolling, or leave normally.

#### C23 Submission contents
A submission names a Party, an Exhibit and the room the submitter stands in. Any Party and any Exhibit may be named.

#### C24 Named items move
The named pawn and token move into the room, and nothing moves if one is already there. A room holds any number of them.

#### C25 Own cards
A submission may name cards that the submitter holds.

#### C26 Rebuttal order
The other seats are asked in turn order starting with the seat after the submitter. A dismissed seat is asked like any other.

#### C27 One card
A seat holding a named card shows exactly one, privately to the submitter, and the asking stops.

#### C28 Choice
A seat holding several of the named cards chooses which one to show.

#### C29 Passing
A seat holding none of them says so (`none`), and the next seat is asked.

#### C30 No rebuttal
If every other seat passes, the submission stands, and the submitter may end the turn or indict.

#### C31 Rebuttal privacy
Only the submitter learns which card was shown. Every seat sees that one was shown, and by whom.

#### C32 Indict timing
A seat that is not dismissed may indict at any point of its own turn.

#### C33 Indict once
A seat may indict once per game. A second indictment is rejected.

#### C34 The Verdict check
An indictment names any Party, any Exhibit and any Scene. Only the indicting seat can read the Verdict, and only after every other seat has attended.

#### C35 Upheld
An indictment that matches all three cards ends the game, and the indicting seat wins.

#### C36 Dismissed
Any mismatch dismisses the seat: it may not move, submit or indict, and the Verdict stays sealed to everyone else.

#### C37 A dismissed seat's duties
A dismissed seat still rebuts and attends, and its pawn can still be named.

#### C38 A pawn blocking a door
A dismissed Party's pawn standing on a doorstep moves into that door's room at once.

#### C39 Last standing
When every seat but one is dismissed, the last seat wins at once.

#### C40 Named Parties move
A Party named in a submission moves, whether it is played, unplayed or dismissed.

#### C41 Standings
The winner is place 1 with score 1, and every other seat shares place 2 with score 0. Before the end every standing is 0.

#### C42 Invalid input
Malformed, out-of-turn or illegal actions are rejected without changing the state, and each legal action has exactly one accepted encoding.

#### C43 Determinism and fold
Replaying the same actions from the same setup gives the same state for every seat and every spectator.

#### C44 Audit of hidden claims
At the end, every `none`, every shown card and the indictment's outcome is checked against the decrypted hands and the Verdict. A false claim fails its seat.

#### C45 Games end
Every game ends by an upheld indictment or by the last seat standing. A game in which no seat ever indicts is a policy bug, not a rules gap (D015).
