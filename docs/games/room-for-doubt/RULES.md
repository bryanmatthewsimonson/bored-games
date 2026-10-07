# Room for Doubt rules

**Room for Doubt** is a deduction game for 3–6 players. Six people are trapped in the Aldermoor Assize Courts on the night before a verdict, and the judge is dead. Players walk the building, make submissions in its rooms, rebut each other with the cards they hold, and race to indict the right Party, the right Exhibit and the right Scene. This file is the **source of truth** for the engine in `packages/games/room-for-doubt`.

Room for Doubt uses the mechanics of *Clue* (*Cluedo* in the United Kingdom; devised by Anthony E. Pratt, published by Parker Brothers and now Hasbro) unchanged. The rules prose, the names, the setting, the board and the artwork here are all new. This is the only file, with `docs/DECISIONS.md` and the other docs, where the reference game's name may appear (CLAUDE.md, D046). The public site names it only through the exact "Compare to" phrase, stored once in `packages/games/room-for-doubt/src/compare.ts` (D053, D078).

**Status: beta (D078).** Room for Doubt is built and playable on the site. The engine is the package `packages/games/room-for-doubt` (engine 0.1.0), where every `#### Cnn` below has a named test in `test/catalog/` (CLAUDE.md, D045). The web game is `apps/web/src/games/room-for-doubt` (the board, the hand, the Docket and the rules page `#/rules/room-for-doubt`). The fuzz target is `room-for-doubt` (`pnpm fuzz --game room-for-doubt`, policies in `tools/fuzz/src/room-for-doubt.ts`), and the e2e spec is `apps/web/e2e/room-for-doubt.spec.ts`. The design came first (D074): this file, the board (`board.txt`, with a test that proves its structure), the art (`art/`, CC0-1.0, drawn by `scripts/room-for-doubt/`) and the name guards. Two opt-in platform features keep the hidden cards exactly as hidden as at a table, a second shuffle round (D076) and a private show (D077); [Online play](#online-play-and-hidden-information) says how, and [Online play on this site](#online-play-on-this-site) lists what the build settled.

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
| the Verdict | the case file | positions 0, 6 and 12 of the deck `case`, one per group (see [Online play](#online-play-and-hidden-information)) |
| roll | roll the dice | `roll`; each seat's share of the roll is `contribute` |
| submit | make a suggestion | `submit` |
| rebut (show a card, or say none) | disprove a suggestion | `show`, `none` |
| indict | make an accusation | `indict`, `verdict` |
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

**Sources.** The Parker Brothers instruction book of the 2002 printing (3 to 6 players; the publisher's PDF, read in full, pages 1–7), a rulebook extract on rulespal.com, and Wikipedia's article on *Cluedo*. Rules confirmed by the instruction book are **verified**. A rule that rested on the author's memory alone would be marked **recalled**; none does. Points the sources do not settle are **platform** rules or **OPEN** options, per CLAUDE.md ("Never invent rules"). BoardGameGeek's own pages refuse automated reads (HTTP 403), so the id **1294** was confirmed at build time by a search limited to boardgamegeek.com, which returned the reference game's page, `boardgame/1294` (D078).

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

A turn has a movement, then, if you are entitled to one, a submission, then the end. You may indict at any point of your own turn; an indictment ends the turn (see [3. Indict](#3-indict)). Play passes over a dismissed seat, which takes no turns. Nothing is accepted out of turn, apart from a seat's answer when it is asked to rebut, and the shares of the dice and of the Verdict that every seat's app adds by itself (see [Online play](#online-play-and-hidden-information)).

### 1. Move
Do one of these three, or stay if your pawn cannot move (see [A turn with no possible move](#a-turn-with-no-possible-move)).

**Roll and walk.** Roll the two dice and walk your pawn exactly the total, from 2 to 12 squares. A player never sends the dice online: the session derives them.
- A step goes to an orthogonally adjacent square (up, down, left or right), never diagonally. You may turn as often as you like.
- You may not enter or end on a square holding any pawn: another player's, an unplayed Party's or a dismissed Party's. Rooms are not squares in this sense: any number of pawns and tokens may stand in a room.
- You may not enter the same square twice in one turn.
- **Doors.** A room is entered and left through its doors. Passing a door is one step, between the doorstep (the corridor square outside) and the room itself; the doorway is not a square and costs nothing more. A door whose doorstep holds another pawn cannot be used, in either direction. Your own pawn on a doorstep never blocks that door for you.
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
- A seat that is not dismissed may indict, **once per game**, at any point of its own turn: before it moves (at the start of the turn, or after its roll and before its walk), after it moves, or after a submission, whether or not that submission was rebutted.
- You name any Party, any Exhibit and any Scene. The Scene need not be the room you stand in.
- Then you, and nobody else, look at the Verdict in secret.
- **Upheld.** If your three cards match the Verdict exactly, the game ends and you win. Lay the cards out for the table. (Online the indictment has already named the three cards to everyone, and the end audit checks your claim; see [Resolving an indictment](#resolving-an-indictment).)
- **Dismissed.** Otherwise you are dismissed. You may no longer move, submit or indict, and the Verdict goes back sealed, unseen by anyone else. You keep your hand and you still rebut, as before (online, your app also goes on adding its shares to the dice and, if you were the first to indict, sealing your share of the Verdict to each later indicter). Your pawn stays where it is, and other players' submissions may still name your Party and move your pawn. If your pawn stands on a doorstep, it moves into that door's room at once, so that it never blocks the door.

### A turn with no possible move
A Party whose pawn has no free first step cannot move: no free square beside it on the corridor or, in a room, every doorstep of the room taken by another pawn. It does not roll; it stays where it is, which passes its move (P5). It may still indict, take the Old Gaol Passage from a corner room, or submit if another Party's submission has moved it into a room. A Party that has a free first step always has somewhere to go after its roll, since that step alone is a legal path, so P4 never leaves it nowhere to move. A seat that has not been dismissed always has a legal action, because it can indict, so play never deadlocks.

## End of the game

The game ends the moment an indictment is upheld: that seat wins. It also ends when every seat but one has been dismissed: the last seat standing wins at once (P6). A winner is place 1 with score 1; every other seat shares place 2 with score 0 (P7).

There is no stall rule. Games end only by declaration (D015, D016): a game in which no seat ever indicts is a bug in the engine or its fuzz policies, never a rules gap.

## Rule options

- **`submit`:** `'optional'` (the default) or `'required'`. The source book phrases entering a room as an instruction to make a suggestion at once, yet elsewhere says that a player may make a suggestion and then an accusation in one turn, and limits a player to one suggestion per entry. Whether a submission is required is therefore **OPEN**, so it is an option, logged in DECISIONS. The New table form offers it as "Submissions on entering a room": Optional or Required. Under `'required'` a seat that entered a room must submit there or indict; it cannot end its turn first.
- **Dice:** always live (see [Dice and pace](#dice-and-pace)). The design also described `dice: 'ahead'`, an asynchronous adaptation; it is not built (D078). The rules object is therefore `{submit: 'optional' | 'required'}` and nothing else.
- **Two players:** not offered. The 2002 book is for 3 to 6 players, so a two-player variant stays **OPEN**, as Chain Reaction's does.

## Platform rules

These are platform necessities, not published rules (D015, D016).
- **P1 Seats and Parties.** As in Setup step 1. The Prosecutor is always played and goes first, which matches the published rule that a fixed first Party always starts.
- **P2 The deal.** From the first seat: 3 seats 6, 6, 6; 4 seats 5, 5, 4, 4; 5 seats 4, 4, 4, 3, 3; 6 seats 3 each.
- **P3 Exhibits.** Six different rooms are drawn from the jointly shuffled public setup, as Luster's first player is, one room for each Exhibit. No seat can choose them.
- **P4 Shortfall.** A Party moves the whole roll, or enters a room on the way, which ends the move. If neither is possible, it moves along the longest legal path, possibly no squares at all, and any path of that greatest length is accepted. The published rules are silent; "as far as it can" is read as the greatest distance, not as "until a dead end".
- **P5 Trapped.** A Party whose pawn has no free first step is offered `stay` instead of `roll` at the start of its turn, and staying passes its move. It may still indict, take a passage from a corner room, or submit if another Party's submission has moved it. After a roll a free first step is itself a legal path, so P4 always leaves at least one destination.
- **P6 Last standing.** The engine declares the last undismissed seat the winner (D015: games end only by declaration).
- **P7 Result.** A winner is place 1 with score 1; every other seat shares place 2 with score 0.

## Online play and hidden information

### What is hidden
| Hidden thing | Who may know | Platform mechanism |
|---|---|---|
| The Verdict (1 Party, 1 Exhibit, 1 Scene) | nobody, until an indicting seat reads it | One deck, `case`, of 30 cards in four groups shuffled apart (`DeckSpec.partitions`, PROTOCOL §5.5): Parties (6), Exhibits (6), Scenes (9) and room cards (9). The first position of each of the first three groups (0, 6 and 12) is the Verdict and is dealt to no seat at setup, so it always holds one card of each kind. An indictment deals those three positions to the indicting seat alone (see [Resolving an indictment](#resolving-an-indictment)). |
| Hands | the holder (sizes are public) | the 18 other positions of the first three groups, dealt at setup from the first seat in the P2 counts. Every other seat publishes its share of a hand position in the deal; the holder never publishes its own in play |
| How many Parties, Exhibits and Scenes a hand holds | the holder | the **second shuffle round** (D076, PROTOCOL §5.5): once every seat has shuffled the four groups, every seat shuffles the 18 hand positions together (`DeckSpec.secondRound`, one group `mix`), so a position no longer shows its card's kind. The round never touches the Verdict's positions |
| The Exhibits' starting rooms | everyone | the room cards' group, in the same deck: positions 21–26 are revealed publicly at setup and name the six rooms (P3); positions 27–29 are never dealt |
| A card shown in a rebuttal, and its position | the shower and the submitter | a **private show** (D077, PROTOCOL §14): the shower's share of the card rides on its own `show` move, inside a packet that only the shower and the submitter can open. The move names neither the card nor its position, and two shows of one card cannot be told from shows of two cards |
| "I hold none of those three" | public claim | audited at the end, like Chain Reaction's `skipPlace` |
| The indictment's outcome | the indicting seat, then everyone | claimed by that seat's `verdict` and audited, so a false claim is caught at the end audit |
| Dice | public | Bank's key-committed beacon (D058), beside the deck as "Deck plus dice" below says |

### Resolving an indictment
An indictment deals the three Verdict positions to the indicting seat (`dealt`). The deck sets `DeckSpec.promptShares` (D075), so every other seat's open app sends its shares of those positions at once, in a Shares event outside its own turn and with no click (PROTOCOL §6.2a). No seat answers in turn: the shares go out together, as soon as each app sees the indictment. The indicter's app then decrypts the three cards with its own layer and shows them to that player alone. Only then does the game offer the indicter its one answer, `verdict`, with `upheld` true or false as the cards say. A seat whose app stays closed while it owes a share stalls the indictment, and once the deadline has passed the timeout falls on that seat (PROTOCOL §8.1).

A **second indictment**, after a wrong one, deals the same three positions again, to the new indicter. Every other seat's share of them went out at the first indictment, except the first indicter's own. The first indicter's app, although its seat is dismissed, seals that share to the new indicter in a Sealed event (PROTOCOL §4.10, the `seal` duty), as the first holder of a re-dealt charter does in Right of Way. Each later indicter gets the first indicter's sealed share the same way.

An upheld verdict reveals nothing on the wire. The indictment already named the three cards to everyone, `verdict` with `upheld: true` claims that they match the Verdict, and the end audit checks that claim as it checks a dismissal (C44).

### Actions (one accepted encoding each)
Each action is a JSON object with exactly the keys below; `actor` is the acting seat. A player never sends the dice: the session derives `rolled`.

| Action | Keys | When |
|---|---|---|
| `roll` | `type`, `actor` | at the start of the turn, when the pawn has a free first step. It commits the roll and carries no share |
| `contribute` | `type`, `actor`, `id` | each seat's share of roll `id`, one seat at a time from the seat after the roller round to the roller. The seat's app sends it; nobody clicks |
| `move` | `type`, `actor`, `to` | the walk. `to` is a square name (`H3`) or a room's Scene id |
| `passage` | `type`, `actor` | at the start of the turn, from a corner room |
| `stay` | `type`, `actor` | at the start of the turn, when the pawn has no free first step (P5) |
| `submit` | `type`, `actor`, `party`, `exhibit` | on entering a room, or at the start of the turn after another seat's submission moved the pawn there. The Scene is the submitter's room |
| `show` | `type`, `actor`, `id`, `packet` | the rebuttal's private show (D077). `id` is the submission's index and `packet` the encrypted share. The asked seat's own legal list holds a marker `{type, actor, pos}` for each named card it holds; its app turns the chosen marker into this action, and `apply` never accepts a marker |
| `none` | `type`, `actor` | the asked seat holds none of the three named cards |
| `indict` | `type`, `actor`, `party`, `exhibit`, `scene` | at any point of the seat's own turn, once per game |
| `verdict` | `type`, `actor`, `upheld` | the indicter's announcement, once it has read the three cards |
| `endTurn` | `type`, `actor` | after the move, or after a submission's answers |

Every client derives two more actions, which nobody sends: `{type: 'reveal', actor: 'deck', deck: 'case', pos, card}` for the room cards at setup (PROTOCOL §6.3), and `{type: 'rolled', actor: 'beacon', id, dice}` for each roll (PROTOCOL §6.3a).

### How the platform keeps it exact
The design (D074) found two gaps in what the platform could do then, and recorded them as platform limits. The owner's priority (D075) is that a game plays exactly as its rules say, so neither ships. Two opt-in platform features close them:
1. **The hand mix.** With the groups shuffled apart, every deck position shows its card's kind. Everyone could then count the Parties, Exhibits and Scenes in each hand, where a table shows only hand sizes, and a rebuttal's position would tell which kind of card was shown. The second shuffle round (D076) mixes the 18 hand positions after the groups are shuffled. The Verdict keeps one card of each kind, because its positions are outside the round. What stays public is how many cards of each kind the 18 positions hold (5 Parties, 5 Exhibits and 8 Scenes), which a table shows too.
2. **The shown card.** Dealt again to the submitter and sealed to it (D066), a shown card would be a public `dealt` entry naming its position. A repeated show would then read as "the same card again", and a third seat that could place the other cards might deduce it. The private show (D077) puts the shower's share inside the shower's own move, encrypted to the submitter. No event names the position, and every packet has the same length, so two shows of one card cannot be linked.

What remains is what every protocol-1 game with prompt shares accepts (D071, D075): a seat that forks after reading a released value, or a shower that equivocates and shows the submitter two cards, is detected and ranked last, not prevented (PROTOCOL §11, §14).

### Online play on this site
The players' apps take the mechanical steps by themselves while the game is open in a window: a seat's dice share, its shares of the Verdict for an indicter, the first indicter's sealed share for a later one, and a forced rebuttal. A closed window stalls the step it owes. The status line names that seat, and once the deadline has passed another seat may claim a timeout (PROTOCOL §8.1). The game is slow and asynchronous: every submission waits on the answers in turn, so a game takes days.

The build settled these points, the rulings of its plan (D078). Each refines how this file is played online; none changes a published rule.
1. **Both information gaps close.** The second shuffle round (D076) hides the mix of kinds in a hand, and the private show (D077) hides which card a rebuttal showed and where it lies in the deck (see [How the platform keeps it exact](#how-the-platform-keeps-it-exact)). The owner's priority (D075) ruled out shipping either gap.
2. **No attend move.** The design had each other seat answer an indictment with a move of its own carrying its shares of the Verdict. Instead the deck sets `promptShares` (D075): every other seat's open app sends its shares as soon as the indictment deals the Verdict, and for a second indictment the first indicter's app sends its sealed share (the `seal` duty). The indicter then announces `verdict` (see [Resolving an indictment](#resolving-an-indictment)).
3. **An upheld verdict reveals nothing on the wire.** The indictment already names the three cards publicly, `verdict` with `upheld: true` claims that they match, and the end audit checks the claim, as it checks a dismissal.
4. **Trapped (P5).** At the start of a turn a Party with no free first step is offered `stay` instead of `roll`. After a roll P4 always leaves at least one destination, because a free first step is a path of length 1.
5. **Indict after rolling.** "Before it moves" includes the moment between the roll and the walk, so an indictment is legal at the start of the turn, after the roll, after the move and after a submission's answers.
6. **No `ahead` dice.** `dice: 'ahead'` is not built. The rules object is `{submit: 'optional' | 'required'}`, and the dice are always rolled live.
7. **Forced rebuttals.** When the asked seat has exactly one legal answer (`none`, or the one named card it holds), its app sends that answer without a click, as Right of Way's app sends a forced sift. With two or three named cards the player chooses which to show.
8. **The spec-only guard.** `tests/catalog.test.ts` treats a game as spec only until its package has `test/catalog/`, rather than until the package exists. So the board and the movement search landed, with their own tests, before the 45 catalog tests.
9. **The art moves into the game package.** The glyph markup lives in `packages/games/room-for-doubt/src/art.ts`, so the web game draws the same original art as `art/`. `scripts/room-for-doubt/` re-exports it, and the art test proves the SVG files unchanged.

### Build paths
- **A. Beta on today's pieces,** as Luster and Right of Way shipped. **Built (D078),** with both gaps closed on the platform (a second shuffle round, D076, and a private show, D077), so no deviation from the rules ships. The deck sets `DeckSpec.promptShares`, which any game may now set under the standing exception (D075) to D050: every other seat's open app releases its shares of the Verdict to an indicter at once. A **second indictment** needs a sealed share too, and the same flag covers it: the first indictment needs none, but after a wrong one the Verdict positions are dealt again, and the first indicter, though dismissed, seals its share of them to each later indicter (a Sealed event, PROTOCOL §4.10, the `seal` duty of its app). A first indicter whose app stays closed stalls that later indictment, and the timeout falls on it (PROTOCOL §8.1). A rebuttal needs no sealed share: the narrower rule the design considered, a share riding on its sealer's own move, is the private show, carried inside the module's own `show` action, so it needed no change to the Move format (PROTOCOL §4.4, §14).
- **B. Exact, with platform work** (not taken). Deck epochs (an 18-card re-shuffle after the Verdict is fixed; GAME-SYSTEMS §4.1.4, roadmap #4) would have fixed gap 1, and sealed choices (a public commitment, a private opening, an audit-time check; §4.4, roadmap #9) gap 2, with new session and protocol code and an adversarial review. The build closed both gaps on path A with two smaller opt-in features instead.
- **C. Dealer tables** (`docs/proposals/dealer-relay.md`): exact and immediate, but the dealer is trusted. Not taken.

**Deck plus dice.** Room for Doubt both deals cards and rolls dice. PROTOCOL §6.3a keeps a deckless game's roll shares in the card share store, keyed by roll id; with a deck, the roll slots follow the card positions and each roll is bound to the move that requests it. That was Driftwrights' extension (D069, D070). The session applies it to any module with a deck that rolls, and PROTOCOL §13 now says so (D078). Here the card positions are 0–29 and roll `i` is wire position `30 + i`. The `roll` action is the request and carries no share; every seat then sends a `contribute` action with its share, from the seat after the roller round to the roller.

**Outcome.** The design recommended A as a beta, then B, and C only if dealer tables were adopted generally. The build took A and closed both gaps on it, so B is not needed. Every game stays on protocol 1 until the move to trusted dealers (D071), and the trusted-dealer proposal stays the next step for preventing cheating rather than detecting it.

### Dice and pace
- The dice are always rolled live, and exactly: the roller's `roll` commits the roll, and every seat's open app then adds its key-committed beacon share with no decision, the roller's last. The faces appear once the last share is in. A closed window stalls the roll, as in Bank, and the status line names whose app is next.
- `ahead`, the asynchronous adaptation the design described (a named variant, D049: the next turn's roll scheduled at the end of the previous turn, the other seats' shares riding on their moves, at the cost of a Party in a corner room seeing the roll before choosing whether to take the passage), is not built (D078). The rules object has no `dice` field.
- Every submission also waits on responses in turn, so this is a slow asynchronous game; the catalog entry says so.

### Resign
Resign is disabled at every seat count (`resignAllowed` false) until its D052 review, as for Luster and Right of Way. A Resign publishes the resigner's deck secret at once (PROTOCOL §8.3), which would open the resigner's hand, every private show it sent or received (PROTOCOL §14) and, once the resigner has indicted, the Verdict itself. A player who cannot go on is timed out instead.

### Catalog entry (for the build)
`players {min: 3, max: 6, best: [4]}`, `playMinutes {min: 45, max: 90}` face to face, `weight` 1.6, `luck` 2, `genre: 'family'`, `mechanisms: ['deduction', 'dice-rolling', 'grid-movement']`, competitive, sequential, `hiddenInfo` and `randomness`, `minAge: 8`, "Compare to Clue" with BoardGameGeek 1294, art credit "Original board, card and cover art by Bored Games", CC0-1.0. As built (`src/catalog.ts`), the entry also has `status: 'beta'`, `typicalTurns: 60`, `bggId: null` (the game has no BoardGameGeek entry of its own) and the tags mystery, murder, courthouse and detective.

### Interface notes
The Docket is private to the player: a row for each of the 21 cards and a column for each seat. The app marks the player's own cards (●) and the cards shown to them (✓). Every other box is the player's to mark (✗, then ?, then blank again), and the marks stay in that browser. The public record of each submission and indictment sits below it. The Docket leaves every deduction to the player. The game screen says who owes a rebuttal, a roll contribution, a share of the Verdict or a sealed share, and when the deadline passes. On a phone, "Enlarge board" draws the board bigger inside a frame that scrolls.

## Art direction

All files in `art/` are original SVG made for this project and dedicated to the public domain (CC0-1.0). `node scripts/room-for-doubt/cli.ts` draws them from `board.txt`, the tables in `scripts/room-for-doubt/data.ts` and the 21 glyphs of `packages/games/room-for-doubt/src/art.ts`; `tests/room-for-doubt-art.test.ts` fails if a file on disk differs from what the generator draws, or uses a colour outside the palette. The glyphs live in the game package so that the web game draws the same pictures (D078). Text uses generic font stacks (serif and sans), and so does the web game, which ships no font files.

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
A turn is a movement (or its alternative), then a submission if the Party is entitled to one, then the end. An indictment may come at any point and ends the turn. Nothing is accepted out of turn, apart from a rebuttal and a seat's share of the dice.

#### C09 Roll
Two dice are rolled, from every seat's share in turn, and the total is 2 to 12. A player never sends the dice.

#### C10 Orthogonal movement
Movement is one orthogonal step at a time, never diagonal.

#### C11 Occupied squares
A pawn may not enter or end on a square holding any pawn, including the pawns of unplayed and dismissed Parties.

#### C12 Repeated squares
A square may not be entered twice in one turn.

#### C13 Doors
A door is passed in one step between its doorstep and the room. The doorway is not a square.

#### C14 Blocked doors
A door whose doorstep holds another pawn cannot be used, in either direction. A pawn on a doorstep never blocks that door for itself.

#### C15 Room entry
Entering a room ends the move, whatever part of the roll remains.

#### C16 No re-entry
A Party may not enter a room that it left earlier in the same turn.

#### C17 Old Gaol Passages
From a corner room, at the start of a turn and instead of rolling, a Party moves to the opposite corner room (Judge's Chambers to Evidence Store, Belfry to Holding Cells) and counts as having entered it.

#### C18 Trapped
A Party whose pawn has no free first step cannot roll: it stays, which passes its move (P5). It may still submit if it has been moved into a room, take a passage from a corner room, or indict.

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
Only the submitter learns which card was shown. Every seat sees that one was shown, and by whom. No seat but the shower and the submitter, and no spectator, learns the card or its deck position (D077).

#### C32 Indict timing
A seat that is not dismissed may indict at any point of its own turn, between its roll and its walk included.

#### C33 Indict once
A seat may indict once per game. A second indictment is rejected.

#### C34 The Verdict check
An indictment names any Party, any Exhibit and any Scene, and deals the Verdict's three positions to the indicting seat. Only that seat can read the Verdict, and only once every other seat's share of it has arrived (after a wrong indictment, the first indicter's share comes sealed to the new indicter).

#### C35 Upheld
An indictment that matches all three cards ends the game, and the indicting seat wins.

#### C36 Dismissed
Any mismatch dismisses the seat: it may not move, submit or indict, and the Verdict stays sealed to everyone else.

#### C37 A dismissed seat's duties
A dismissed seat still rebuts, it still adds its share to every roll, and its pawn can still be named.

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
At the end, every `none`, every shown card and every indictment's announced outcome is checked against the decrypted hands and the Verdict. A false claim fails its seat.

#### C45 Games end
Every game ends by an upheld indictment or by the last seat standing. A game in which no seat ever indicts is a policy bug, not a rules gap (D015).
