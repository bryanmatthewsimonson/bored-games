# Right of Way rules

**Right of Way** is a railway-building game for 2–5 players. Each player collects coloured freight cards and spends matching sets to lay track between the towns of Ferrovia, an invented land. Points come from the track laid, from the secret railway charters each player has taken on, and from the longest unbroken line. This file is the **source of truth** for the engine in `packages/games/right-of-way`.

Right of Way uses the base-game mechanics of *Ticket to Ride* (Alan R. Moon; Days of Wonder, 2004) unchanged. The rules prose, names, map, route layout, charter list and artwork here are all new. This is the only file, with `docs/DECISIONS.md` and the other docs, where the reference game's name may appear (CLAUDE.md, D046). The public site names it only through the exact comparison phrase stored once in `packages/games/right-of-way/src/compare.ts`, linked to BoardGameGeek 9209 (D053, D066).

**Status: beta (engine 0.1.0, D066).** The engine is `packages/games/right-of-way`, the web game `apps/web/src/games/right-of-way`. Every `#### Cnn` below has an `it('Cnn …')` test in `packages/games/right-of-way/test/catalog/`. How the hidden cards are played online is described in [Online play](#online-play-and-hidden-information).

## Name, brand and what is original

### The name
- **Right of Way** is a railway term for the strip of land a line is built on. In ordinary speech it means who gets to go first. Both meanings fit the game: you race to claim the land between two towns, and once you hold it nobody else may build there.
- **Tagline:** "Lay claim. Lay track. Connect."
- **The land:** Ferrovia, from the Italian for "railway" (literally "iron way"). It is a generic word, not a brand.
- **Names considered and set aside:** "Spur of the Moment" (a pun on a rail spur, but it suggests a light party game) and "Iron Ribbon", now the name of the longest-line award.
- **Clearance (not legal advice).** On 2026-10-06 a web search found no railway board game published as "Right of Way". This is not a trademark search. As for Luster (PLAN, "Luster"), a lawyer must clear the name before release. If it fails, the fallback is "Iron Ribbon" with the same art; only the title text changes.

### What is the same, and why it may be
Game mechanics, rules as systems and numbers that are part of a method of play are not protected by copyright: 17 U.S.C. §102(b), and the U.S. Copyright Office's circular FL-108 on games. A rulebook's wording, its board art, its map design and its card art are protected, and so are the title and the trade dress (look of the box and pieces) as trademarks. So:

| Kept exactly (mechanics) | Replaced (expression and brand) |
|---|---|
| 110 cards: 12 in each of 8 colours, plus 14 wilds (the 8 are plain basic hues) | the card names, cargo themes, exact shades, symbols and art |
| 45 track pieces per player; 2–5 players | the piece name ("track"), the five player colours and the bird names |
| deal 4 cards; a market of 5 face up; the 3-wild wipe | the rules wording (this file is written from scratch, not paraphrased) |
| draw 2 cards, a face-up wild counts as 2 | the map: 36 invented towns on an invented land, with a new route layout |
| one route per turn; set of one colour; unmarked routes take any colour | the 30 charters (pairs and values computed on this map, below) |
| route points 1, 2, 4, 7, 10, 15 for lengths 1–6 | the box, board, card and charter art (`art/`, CC0, below) |
| twin routes; one twin usable with 2–3 players | the award's name ("the Iron Ribbon") |
| 3 tickets at setup (keep ≥ 2); draw 3 later (keep ≥ 1); returns to the bottom | the game's name and tagline |
| end when someone has ≤ 2 pieces, then one more turn each | |
| completed tickets add, open tickets subtract; 10 for the longest path; tie-breaks | |

Nothing on the map copies the reference map. There are no real places, the coastline and route graph are new, and the charter values come from a stated formula on this graph (see [The charters](#the-charters)).

### Glossary
| Right of Way | Reference game | Engine id |
|---|---|---|
| freight card (Brick, Copper, Grain, Timber, Ice, Plum, Wool, Coal) | train car card | `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `white`, `black` |
| Engine (wild) | locomotive | `engine` |
| the yard (the 5 face-up cards) | face-up cards | `market` |
| the draw pile, the discard pile | deck, discards | `pile`, `discards` |
| track piece | plastic train | `track` |
| town | city | town ids below |
| route; unmarked route; twin route | route; gray route; double route | `R01`–`R85`; `gray`; `side: 0 \| 1` |
| lay track | claim a route | `{type:'claim'}` |
| charter | destination ticket | `T01`–`T30` |
| the Iron Ribbon | longest continuous path bonus | `ribbon` |

Colour ids stay plain words, so the engine and tests never need a cargo name. Display names belong to `src/theme.ts` (the trademark-safe brand pack, D046). There is no licensed pack: the reference game's names would need a licence.

## Sources and interpretations

**Sources.** The base-game rulebook, as reproduced by rulespal.com ("Ticket to Ride rulebook", read 2026-10-06), and Board Game Arena's game help page for the game (read 2026-10-06). The publisher's rulebook PDF on archive.org returned HTTP 503. Rules confirmed by both sources, or quoted from the rulespal copy of the rulebook, are **verified**. Rules that rest on the author's knowledge of the rulebook alone are **recalled**. Points the rulebook does not settle are **platform** rules or **OPEN** options, per CLAUDE.md ("Never invent rules").

| Topic | Rule | Basis |
|---|---|---|
| Components | 110 freight cards (12 in each of 8 colours, 14 Engines), 30 charters, 45 track pieces per player, one longest-line award | **verified** (rulespal) |
| Players | 2–5 | **verified** |
| Setup hand | 4 freight cards each; 5 turned face up | **verified** |
| Setup charters | 3 each; keep at least 2; returned ones go to the bottom of the charter pile | **verified** |
| First player | "the most experienced traveler". **Platform:** chosen at random (see [Platform rules](#platform-rules)) | custom **verified**; the random draw is ours |
| Draw two | take 2 cards, each from the yard or the top of the pile | **verified** |
| Face-up Engine | taking one is the whole draw. It cannot be the second card | **verified** (rulespal; BGA: "only one face-up Locomotive card in a turn") |
| Blind Engine | an Engine from the pile counts as one card; you still draw a second | **verified** (BGA) |
| Refill | a yard card taken is replaced at once from the pile | **verified** |
| Three Engines | whenever 3 of the 5 yard cards are Engines, all 5 are discarded and 5 new ones turned up | **verified** |
| Reshuffle | when the pile runs out, the discards are shuffled into a new pile | **verified** |
| No cards anywhere | with no pile and no discards, freight cannot be drawn | **verified** |
| Hand limit | none | **recalled** |
| Lay track | play cards equal to the length, all one colour (the route's colour, or any one colour on an unmarked route); Engines are wild | **verified** |
| One route a turn | at most one per turn; it need not join your other track | **verified** (one per turn); joining not needed **recalled** |
| Enough track | you need as many pieces as the route is long | **recalled** |
| Twins | one player may not take both sides; with 2 or 3 players, once one side is taken the other is closed | **verified** |
| Route points | 1, 2, 4, 7, 10, 15 for lengths 1–6, scored at once | **verified** |
| Draw charters | draw 3 (fewer if fewer are left); keep at least 1; return the rest to the bottom | **verified** |
| Ending | when a player ends a turn with 0, 1 or 2 pieces, everyone, that player included, gets one more turn | **verified** |
| Charters at the end | completed add their value, others subtract it | **verified** |
| Longest line | 10 points; loops and repeated towns allowed, no route used twice; ties all score | **verified** |
| Winner | most points; then most completed charters; then the award holder | **verified**; beyond that, a shared place (**platform**, as in Luster) |
| Charter counts | how many charters and freight cards each player holds is public | **recalled** (open hands at a table) |

## Components

- **Freight cards: 110.** 12 each of Brick (`red`), Copper (`orange`), Grain (`yellow`), Timber (`green`), Ice (`blue`), Plum (`purple`), Wool (`white`) and Coal (`black`), and 14 Engines (`engine`, wild). Every card shows its colour and its cargo symbol in two corners, so colour is never the only cue.
- **Charters: 30** (table below). Each names two towns and a value.
- **Track: 45 pieces per player**, in five player colours: Kestrel (rust), Heron (slate blue), Finch (mustard), Magpie (charcoal) and Parrot (green).
- **The Iron Ribbon:** one award card, worth 10.
- **The board:** 36 towns and 85 routes. 22 of the routes are twins, so there are 107 route sides with 332 spaces in all. A score track runs round the edge.

## The map

The board art is `art/board.svg`, drawn from the tables below. Town ids are the plain lower-case names (spaces removed).

### Towns
| Id | Town | Routes |
|---|---|---|
| `ashgrove` | Ashgrove | 5 |
| `bellwether` | Bellwether | 3 |
| `brindlefield` | Brindlefield | 6 |
| `cinderpass` | Cinderpass | 6 |
| `clockhaven` | Clockhaven | 5 |
| `copperhollow` | Copperhollow | 6 |
| `duskwater` | Duskwater | 4 |
| `emberdune` | Emberdune | 4 |
| `fernvale` | Fernvale | 5 |
| `frostwick` | Frostwick | 4 |
| `glimmerford` | Glimmerford | 6 |
| `granitefold` | Granitefold | 6 |
| `gullhaven` | Gullhaven | 3 |
| `harrowcross` | Harrowcross | 6 |
| `highspire` | Highspire | 6 |
| `hollowmere` | Hollowmere | 5 |
| `ironmoor` | Ironmoor | 6 |
| `kelpmouth` | Kelpmouth | 3 |
| `kettleburn` | Kettleburn | 6 |
| `lanternport` | Lanternport | 3 |
| `larchholm` | Larchholm | 4 |
| `marrowmarsh` | Marrowmarsh | 5 |
| `millstone` | Millstone | 4 |
| `mosswick` | Mosswick | 4 |
| `northwatch` | Northwatch | 3 |
| `owlgate` | Owlgate | 5 |
| `ravensgate` | Ravensgate | 5 |
| `saltmere` | Saltmere | 4 |
| `starlingcove` | Starling Cove | 3 |
| `sunreach` | Sunreach | 6 |
| `thistledown` | Thistledown | 6 |
| `tidewell` | Tidewell | 3 |
| `velvetdale` | Velvetdale | 4 |
| `whistlestop` | Whistlestop | 6 |
| `wrenford` | Wrenford | 6 |
| `yarrowfen` | Yarrowfen | 4 |

### Routes
Lengths run 1–6; points are scored when the track is laid. A twin route has two sides, each with its own colour. "Unmarked" routes take a set of any one colour.

| Route | Between | Length | Points | Colour | Twin colour |
|---|---|---|---|---|---|
| R01 | Ashgrove – Copperhollow | 3 | 4 | unmarked | — |
| R02 | Ashgrove – Duskwater | 4 | 7 | unmarked | — |
| R03 | Ashgrove – Emberdune | 3 | 4 | Timber (green) | — |
| R04 | Ashgrove – Glimmerford | 6 | 15 | Brick (red) | — |
| R05 | Ashgrove – Sunreach | 3 | 4 | Ice (blue) | Coal (black) |
| R06 | Bellwether – Clockhaven | 1 | 1 | unmarked | unmarked |
| R07 | Bellwether – Northwatch | 2 | 2 | unmarked | unmarked |
| R08 | Bellwether – Tidewell | 2 | 2 | unmarked | unmarked |
| R09 | Brindlefield – Hollowmere | 3 | 4 | Brick (red) | — |
| R10 | Brindlefield – Kettleburn | 3 | 4 | Copper (orange) | Grain (yellow) |
| R11 | Brindlefield – Owlgate | 3 | 4 | Ice (blue) | — |
| R12 | Brindlefield – Ravensgate | 3 | 4 | unmarked | — |
| R13 | Brindlefield – Thistledown | 2 | 2 | Plum (purple) | — |
| R14 | Brindlefield – Whistlestop | 3 | 4 | Timber (green) | Wool (white) |
| R15 | Cinderpass – Copperhollow | 4 | 7 | unmarked | — |
| R16 | Cinderpass – Glimmerford | 4 | 7 | Ice (blue) | Coal (black) |
| R17 | Cinderpass – Gullhaven | 5 | 10 | Wool (white) | — |
| R18 | Cinderpass – Highspire | 4 | 7 | Brick (red) | — |
| R19 | Cinderpass – Larchholm | 3 | 4 | unmarked | unmarked |
| R20 | Cinderpass – Saltmere | 4 | 7 | Plum (purple) | — |
| R21 | Clockhaven – Fernvale | 2 | 2 | Ice (blue) | — |
| R22 | Clockhaven – Ironmoor | 2 | 2 | Plum (purple) | Coal (black) |
| R23 | Clockhaven – Thistledown | 2 | 2 | unmarked | unmarked |
| R24 | Clockhaven – Wrenford | 3 | 4 | Timber (green) | — |
| R25 | Copperhollow – Glimmerford | 4 | 7 | Copper (orange) | — |
| R26 | Copperhollow – Highspire | 3 | 4 | Coal (black) | Plum (purple) |
| R27 | Copperhollow – Kettleburn | 3 | 4 | Brick (red) | — |
| R28 | Copperhollow – Sunreach | 4 | 7 | Wool (white) | — |
| R29 | Duskwater – Emberdune | 6 | 15 | unmarked | — |
| R30 | Duskwater – Glimmerford | 5 | 10 | Plum (purple) | — |
| R31 | Duskwater – Kelpmouth | 4 | 7 | Ice (blue) | — |
| R32 | Emberdune – Marrowmarsh | 5 | 10 | Ice (blue) | — |
| R33 | Emberdune – Velvetdale | 3 | 4 | Copper (orange) | — |
| R34 | Fernvale – Granitefold | 3 | 4 | unmarked | — |
| R35 | Fernvale – Mosswick | 3 | 4 | unmarked | — |
| R36 | Fernvale – Tidewell | 2 | 2 | unmarked | — |
| R37 | Fernvale – Wrenford | 2 | 2 | Wool (white) | Coal (black) |
| R38 | Frostwick – Highspire | 3 | 4 | Grain (yellow) | — |
| R39 | Frostwick – Hollowmere | 5 | 10 | unmarked | — |
| R40 | Frostwick – Larchholm | 4 | 7 | Coal (black) | — |
| R41 | Frostwick – Owlgate | 3 | 4 | Plum (purple) | Timber (green) |
| R42 | Glimmerford – Kelpmouth | 4 | 7 | Wool (white) | — |
| R43 | Glimmerford – Saltmere | 4 | 7 | Brick (red) | — |
| R44 | Granitefold – Harrowcross | 2 | 2 | unmarked | — |
| R45 | Granitefold – Marrowmarsh | 5 | 10 | Plum (purple) | — |
| R46 | Granitefold – Mosswick | 2 | 2 | Timber (green) | Wool (white) |
| R47 | Granitefold – Wrenford | 3 | 4 | Copper (orange) | — |
| R48 | Granitefold – Yarrowfen | 3 | 4 | Ice (blue) | — |
| R49 | Gullhaven – Larchholm | 4 | 7 | Grain (yellow) | — |
| R50 | Gullhaven – Saltmere | 6 | 15 | Copper (orange) | — |
| R51 | Harrowcross – Marrowmarsh | 4 | 7 | Timber (green) | — |
| R52 | Harrowcross – Sunreach | 3 | 4 | unmarked | — |
| R53 | Harrowcross – Velvetdale | 3 | 4 | Wool (white) | — |
| R54 | Harrowcross – Whistlestop | 2 | 2 | Copper (orange) | Grain (yellow) |
| R55 | Harrowcross – Wrenford | 2 | 2 | unmarked | — |
| R56 | Highspire – Kettleburn | 3 | 4 | unmarked | — |
| R57 | Highspire – Larchholm | 4 | 7 | unmarked | — |
| R58 | Highspire – Owlgate | 4 | 7 | unmarked | — |
| R59 | Hollowmere – Millstone | 5 | 10 | Coal (black) | — |
| R60 | Hollowmere – Owlgate | 3 | 4 | Copper (orange) | — |
| R61 | Hollowmere – Ravensgate | 3 | 4 | unmarked | unmarked |
| R62 | Ironmoor – Millstone | 2 | 2 | Brick (red) | Copper (orange) |
| R63 | Ironmoor – Northwatch | 2 | 2 | unmarked | — |
| R64 | Ironmoor – Ravensgate | 2 | 2 | Timber (green) | — |
| R65 | Ironmoor – Starling Cove | 3 | 4 | Grain (yellow) | — |
| R66 | Ironmoor – Thistledown | 3 | 4 | unmarked | — |
| R67 | Kelpmouth – Saltmere | 6 | 15 | Grain (yellow) | Timber (green) |
| R68 | Kettleburn – Owlgate | 3 | 4 | unmarked | — |
| R69 | Kettleburn – Sunreach | 3 | 4 | Timber (green) | — |
| R70 | Kettleburn – Whistlestop | 3 | 4 | Ice (blue) | — |
| R71 | Lanternport – Mosswick | 1 | 1 | unmarked | — |
| R72 | Lanternport – Tidewell | 4 | 7 | Copper (orange) | Grain (yellow) |
| R73 | Lanternport – Yarrowfen | 4 | 7 | unmarked | — |
| R74 | Marrowmarsh – Velvetdale | 2 | 2 | unmarked | unmarked |
| R75 | Marrowmarsh – Yarrowfen | 3 | 4 | Wool (white) | Coal (black) |
| R76 | Millstone – Ravensgate | 2 | 2 | unmarked | — |
| R77 | Millstone – Starling Cove | 3 | 4 | Wool (white) | — |
| R78 | Mosswick – Yarrowfen | 3 | 4 | Grain (yellow) | — |
| R79 | Northwatch – Starling Cove | 2 | 2 | Ice (blue) | Plum (purple) |
| R80 | Ravensgate – Thistledown | 3 | 4 | Brick (red) | — |
| R81 | Sunreach – Velvetdale | 3 | 4 | Plum (purple) | — |
| R82 | Sunreach – Whistlestop | 3 | 4 | Brick (red) | — |
| R83 | Thistledown – Whistlestop | 3 | 4 | Coal (black) | — |
| R84 | Thistledown – Wrenford | 2 | 2 | Grain (yellow) | — |
| R85 | Whistlestop – Wrenford | 3 | 4 | unmarked | — |

Totals: 107 route sides (lengths 1: 3, 2: 29, 3: 45, 4: 19, 5: 6, 6: 5); 332 spaces. Each colour covers 28–30 spaces and unmarked routes 99. No twin has two sides of the same colour; 7 twins are unmarked on both sides.

### The charters
**Value rule (ours):** a charter's value is the length of the shortest connection between its towns on this map, counted in spaces. The 30 pairs were chosen to spread values from 4 to 22 and to use every town once to three times. The map's longest shortest connection is 22, between Saltmere or Kelpmouth and Starling Cove.

| Charter | Between | Value |
|---|---|---|
| T01 | Brindlefield – Wrenford | 4 |
| T02 | Brindlefield – Harrowcross | 5 |
| T03 | Kettleburn – Thistledown | 5 |
| T04 | Bellwether – Mosswick | 6 |
| T05 | Hollowmere – Whistlestop | 6 |
| T06 | Whistlestop – Tidewell | 7 |
| T07 | Highspire – Thistledown | 8 |
| T08 | Sunreach – Clockhaven | 8 |
| T09 | Copperhollow – Wrenford | 9 |
| T10 | Owlgate – Fernvale | 9 |
| T11 | Highspire – Clockhaven | 10 |
| T12 | Kettleburn – Lanternport | 10 |
| T13 | Emberdune – Brindlefield | 11 |
| T14 | Frostwick – Harrowcross | 11 |
| T15 | Glimmerford – Velvetdale | 11 |
| T16 | Ashgrove – Ironmoor | 12 |
| T17 | Ashgrove – Ravensgate | 12 |
| T18 | Cinderpass – Marrowmarsh | 13 |
| T19 | Copperhollow – Northwatch | 13 |
| T20 | Frostwick – Granitefold | 13 |
| T21 | Emberdune – Hollowmere | 14 |
| T22 | Larchholm – Fernvale | 15 |
| T23 | Duskwater – Bellwether | 16 |
| T24 | Cinderpass – Northwatch | 17 |
| T25 | Glimmerford – Tidewell | 17 |
| T26 | Duskwater – Millstone | 18 |
| T27 | Gullhaven – Mosswick | 20 |
| T28 | Saltmere – Yarrowfen | 20 |
| T29 | Gullhaven – Lanternport | 21 |
| T30 | Kelpmouth – Starling Cove | 22 |

Total of all values: 363. The charter art is `art/charters.svg`.

## Setup

1. Each player takes the 45 track pieces of one colour and puts a score marker on 0.
2. The freight cards are shuffled (the deck protocol, deck `freight`). Each player is dealt 4 cards, in seat order. Then 5 cards are turned face up to form the yard. If 3 or more of them are Engines, the wipe rule applies at once (see [Drawing freight](#1-draw-freight)).
3. The charters are shuffled (deck `charters`). Each player is dealt 3.
4. **Keeping the first charters.** Each player keeps 2 or 3 of their 3 and returns the rest to the bottom of the charter pile. Kept charters are secret. The number kept is public. **Platform:** players choose in seat order, starting with the first player, before the first turn. Returned charters go to the bottom in the order of the choices: earlier choosers' charters lie above later choosers', and one player's returned charters keep their dealt order.
5. The first player is chosen at random (platform rule). Play goes in seat order from there, wrapping round.

## Your turn

On your turn do exactly one of three things.

### 1. Draw freight
Take two cards, one at a time. Each card comes either from the yard (any face-up card) or blind from the top of the pile.
- **A face-up Engine is the whole draw.** If your first card is a face-up Engine, you take no second card. You may never take a face-up Engine as your second card.
- **A blind Engine is one card.** An Engine drawn from the pile counts like any other card, and you take a second.
- **Refill at once.** When you take a yard card, it is replaced from the pile before you choose again. The new card may be an Engine you are then not allowed to take.
- **The wipe.** Whenever 3 or more of the 5 yard cards are Engines, all 5 go to the discard pile and 5 new cards are turned up. This can repeat, at most three times in a row (**platform**, see [Platform rules](#platform-rules)).
- **The pile runs out.** When a card must come from the pile and the pile is empty, the discards are shuffled to form a new pile. A card is needed from the pile for a blind draw, and to refill the yard after a card is taken from it or wiped. Empty yard slots are also refilled at the start of a turn whenever the pile has cards, but that alone never reshuffles (**platform**: the rulebook says the discards are reshuffled "when the deck is exhausted" without saying more).
- **Nothing left.** With no pile and no discards, the yard may hold fewer than 5 cards, and an empty slot cannot be taken. You may draw freight only if you can take at least one card. If, after your first card, you cannot legally take a second, your draw ends with one card (**platform**; see C17).
- There is no hand limit.

### 2. Lay track
Lay track on one open route side.
- **Pay** with as many freight cards as the route is long, all of one colour: the route's colour, or any one colour for an unmarked route. Engines stand in for any colour; a set may be all Engines. Paid cards go to the discard pile, face up.
- **Place** that many of your track pieces on it. You must have enough pieces left.
- **Score** the route's points at once: length 1 → 1, 2 → 2, 3 → 4, 4 → 7, 5 → 10, 6 → 15.
- A route need not join your other track. At most one route per turn.
- **Twins.** You may never hold both sides of a twin. With 2 or 3 players, only one side of a twin may be used at all: once anyone lays track on one side, the other side is closed.

### 3. Draw charters
Draw 3 charters from the top of the charter pile (all that are left, if fewer than 3). Keep at least one; return the rest to the bottom of the pile, in the order drawn (**platform**: the rulebook does not fix the order). Kept charters stay secret until the end, and count against you if left unfinished. You cannot take this action when the charter pile is empty.

### A turn with no possible action
It can happen, rarely, that you cannot do any of the three. For example, every card may be in hands, no route may be payable from your hand, and the charter pile may be empty. Then you pass (**platform**, see [Platform rules](#platform-rules)).

## End of the game

When a player ends a turn with **2 or fewer** track pieces, the final round begins. Every player, including that one, takes exactly one more turn. The game then ends and is scored. A player who reaches 2 or fewer again during the final round does not start another round.

## Final scoring

Route points are already on the score track. Then:
1. **Charters.** Every player reveals all their charters. A charter is **completed** when the player's own track forms an unbroken chain of routes between its two towns. Each completed charter adds its value and each unfinished one subtracts it. Scores can go below zero.
2. **The Iron Ribbon.** Each player's longest line is the largest total length of a trail through their own routes. A trail is a walk in which no route is used twice; it may pass a town more than once and may loop. The player(s) with the greatest length score 10 each.
3. **Winner.** The most points wins. Ties are broken by the most completed charters, then by holding the Iron Ribbon. Players still tied share the place (**platform**).

## Rule options

None: the base game has no options. Two are logged as **OPEN** for the owner:
- **`firstPlayer`:** `random` (as built, platform) or `seat0`. The reference rule ("the most experienced traveller") cannot be checked online.
- **`chartersAtStart`:** `sequential` (as built, platform) or `simultaneous`, once the platform has simultaneous phases (GAME-SYSTEMS §4.8).

## Platform rules

These are platform necessities, not published rules (D015, D016).
- **Random first player.** The first player comes from the jointly shuffled setup: the first face-up card, in slot order, whose freight number is below the largest multiple of the seat count up to 110; that number modulo the seat count is the first seat. No seat can choose it, and every seat has an equal chance (C06).
- **Forced pass.** A turn with no legal action is a pass. There is no voluntary pass. It can happen: every freight card can end up in hands (no hand limit), with no route side payable and no charters left. **After every seat in turn has passed in a row, the game ends and is scored as usual** (D015 needs an end). It applies only when no player can do anything at all. **OPEN** for the owner's review: the published rules do not cover it.
- **Wipe limit.** The rulebook repeats the wipe without limit. If too few non-Engines are left outside hands, the yard could never show fewer than 3 Engines and the wipe would loop forever. **At most three wipes happen in a row**; after a third, the yard stays as it is until the next player action. The limit uses only public counts. **OPEN** for the owner.
- **Short draws.** If no legal second card exists, the draw ends after one card. If no first card exists, freight cannot be drawn.
- **Seat order of setup returns.** As in Setup step 4.
- **Reshuffle limit.** A reshuffle uses one of four spare decks set aside at setup (see below). 4000 fuzzed games never needed more than three (five seats). If a game ever needs a fifth, the discards stay where they are: the pile stays empty, as if no discards could be reshuffled.

## Online play and hidden information

### What is hidden
| Information | Who knows it | How (GAME-SYSTEMS §2.1) |
|---|---|---|
| Freight cards in hand (dealt or drawn blind) | the holder | the mental-poker deck, a private position per card |
| The yard, the discards, paid cards | everyone | public reveals |
| Charters in hand | the holder, until the end | private positions |
| Charters returned to the bottom | the player who returned them | already known to them; positions stay encrypted for the others |
| How many cards and charters each player holds; track left; score | everyone | public counts in `view()` |
| Whether a charter is complete | the holder, until the end | derived locally from public routes plus the holder's own charters |

### The packet
The game plays one encrypted deck, `rail` (580 cards), in groups that each seat shuffles separately (`DeckSpec.partitions`, as Luster's): `freight` (110), four spare decks `spare-1`…`spare-4` (110 each) and `charters` (30). Setup proves every group's shuffle once; nothing is shuffled during play.

**Reshuffles from spare decks (C15).** A spare deck is a shuffled deck of numbered cards. When the discards (n cards) are reshuffled, the next unused spare stands for them: its card v < n means the v-th discard (ascending by freight number), and a card v ≥ n is skipped. The members turn up in a uniformly random order, which is exactly a fair shuffle of the discards, and a skipped card says nothing about the others. A refill from a reshuffle is revealed publicly and skipped publicly. A blind draw is dealt to the drawer, who **sifts** it: keeping a discard says nothing; skipping reveals the card publicly, so the session checks the skip at once. The pile's count is public throughout.

**Returned charters (D066).** A charter returned to the bottom may later be drawn by another player. Its position was first dealt to the returner, and every other seat published its share then, so only the returner's share is not public. The returner never publishes it while the charter is private. Instead it **seals** that share to the new holder (a Sealed event, kind 7458, PROTOCOL §4.10), who alone can open it and read the card. The returner still knows the card, exactly as at a real table, where they saw it before putting it back.

### Mid-turn reveals (owner decision, D066)
Blind draws, refills, wipes and sifts reveal cards in the middle of a turn, so the other seats' open apps release their shares at once (`DeckSpec.promptShares`), the exception the owner made for Luster and, on 2026-10-06, for Right of Way. The same applies to sealed shares. The residual risk is Luster's: a seat that forks the chain after reading a released card is detected but not prevented (D050).

**Laying track** reveals the paid cards drawn blind: the actor attaches its own shares, and the session checks them at once. **Final scoring** reveals every held charter publicly; every seat's app sends its share. **Resign (D052)** is disabled, as Luster's is, until public reveals during play have their own Resign review.

### Actions (one accepted encoding each)
- `{type:'take', actor, slot}` (a yard card) and `{type:'blind', actor}`;
- `{type:'sift', actor, card}`: `card` null to keep a reshuffled card, or the card itself to skip it;
- `{type:'claim', actor, route, side, pay}`: `route` is the route index (R01 is 0), `side` 0 or 1, `pay` the [position, card] pairs paid, ascending by position, and always the lowest positions of each kind used (C19);
- `{type:'charters', actor}`, then `{type:'keep', actor, keep}`: ascending indexes into the offered charters;
- `{type:'pass', actor}`, legal only when nothing else is.

### Interface
The board pans and zooms, and every route side is a large tap target. Tap a route to see its price; the payment picker suggests the cheapest colour and lets you trade Engines in or out. Tap a yard card or the pile to draw. After the first card, options that are not allowed are dimmed and say why. The charter dialog shows each offered charter with its mini map and greys out Confirm until enough are kept. Your charters list marks each one complete or open, using only public routes. Every player panel shows track left, cards held, charters held and score. A banner announces the final round. Cards and route spaces carry cargo symbols for colour-blind play.

### Catalog entry
`players {min: 2, max: 5, best: [4]}`, `playMinutes {min: 30, max: 60}`, `typicalTurns` 100, `weight` 1.9, `luck` 2, `genre: 'family'`, `mechanisms: ['network-building', 'set-collection', 'hand-management', 'card-drafting']`, `hiddenInfo` and `randomness`, `minAge: 8`, `bggId: null`, "Compare to" the reference game (BoardGameGeek 9209, from a secondary search; boardgamegeek.com itself was not reachable). Art: original, CC0-1.0.

## Art direction

All files in `art/` are original SVG, made for this project and dedicated to the public domain (CC0-1.0).

| File | What |
|---|---|
| `art/cover.svg` | box cover: a freight train crossing a stone viaduct at dawn |
| `art/board.svg` | the board of Ferrovia, drawn from the route table |
| `art/cards.svg` | the 8 freight cards, the Engine, the card back and the Iron Ribbon |
| `art/charters.svg` | all 30 charters and the charter back |

- **Style:** a flat, mid-century travel-poster look. Limited palette, ink outlines, banded sunrise skies, no gradients on cards. It is deliberately unlike the painted, period-illustration look of the reference game.
- **Palette:** ink `#1f2a44`, paper `#f3ead7`, land `#eadcb8`, sea `#b9d3d0`. Freight: Brick `#b8412f`, Copper `#d9792b`, Grain `#e6c045`, Timber `#3d7a3a`, Ice `#2e66ab`, Plum `#74468f`, Wool `#f7f4ec`, Coal `#2a2a2e`. Engine brass `#c9a04a`. Unmarked routes `#a7a397`.
- **Symbols (colour-blind safe):** brick wall, diamond (ore), wheat sheaf, pine, snowflake, plum, cloud (wool), hexagon (coal), and a locomotive for the Engine. Each appears on its card corners and on every space of a route of that colour.
- **Wagons:** each cargo has its own car: a boxcar (Brick, Plum, Wool), a hopper (Copper, Grain, Coal), a flatcar with logs (Timber) and a ribbed reefer (Ice).
- **Type:** a classic serif for titles and town names (Georgia-class) and a plain sans for small print. The web build will choose freely licensed fonts.

## Verification catalog

#### C01 Components
110 freight cards (12 in each of 8 colours, 14 Engines), 30 charters exactly as tabled, 45 track pieces per seat, 85 routes (22 twins, 107 sides, 332 spaces) exactly as tabled, and a connected map with no route repeated.

#### C02 Charter values
Every charter's value equals the shortest connection between its towns on the map, counted in spaces. The values run 4–22 and total 363.

#### C03 Seats
Two to five seats are accepted; one and six are rejected.

#### C04 Setup deal
Each seat receives 4 freight cards and 3 charters. The yard shows 5 cards (after any wipe). The pile holds 110 − 4 × seats − 5 cards before any wipe.

#### C05 First charters
Every seat keeps 2 or 3, choosing in seat order from the first player. A keep of 0, 1, an index out of range, a duplicate or an unsorted list is rejected. Returns go to the bottom in choice order, keeping dealt order.

#### C06 Random first player
The first player comes from the jointly shuffled setup; every seat has an equal chance. Full replay, players and spectators agree.

#### C07 One action per turn
A turn is exactly one of draw freight, lay track or draw charters (or a forced pass). Nothing else is accepted, and nothing is accepted from a seat out of turn.

#### C08 Two cards
A freight draw takes two cards, from the yard or the pile, in any mix.

#### C09 Face-up Engine first
Taking a face-up Engine as the first card ends the draw at once.

#### C10 No face-up Engine second
A face-up Engine cannot be the second card, including one that has just arrived in a refill.

#### C11 Blind Engine
An Engine from the pile counts as one card, and the second draw is still taken.

#### C12 Refill before the second choice
A taken yard card is replaced from the pile before the second choice.

#### C13 The wipe
Whenever 3 or more yard cards are Engines, all five are discarded and five new cards turned up, at setup and after any refill.

#### C14 Wipe limit
At most three wipes happen in a row; after a third, the yard stays as it is until the next player action, so the wipe never loops.

#### C15 Reshuffle
When a card must come from an empty pile, the discards are reshuffled: the next spare deck stands for them, its cards below the discard count stand for the discards in ascending order, and other cards are skipped (publicly for a refill, by a sift for a blind draw). The pile count is the discards not yet drawn.

#### C16 Empty pile and discards
With no pile and no discards, blind draws are unavailable, empty yard slots cannot be taken, and freight may be drawn only if at least one card can be taken. Empty slots refill at the start of a turn when the pile has cards.

#### C17 Short draw
When no legal second card exists after the first, the draw ends with one card.

#### C18 No hand limit
A hand of any size is legal.

#### C19 Lay track: payment
The payment equals the route's length; all non-Engine cards share one colour; on a coloured route that colour is the route's, and on an unmarked route any colour. Engines are wild, and an all-Engine payment is legal. The encoding is unique: `colour` is `null` exactly when the payment is all Engines.

#### C20 Lay track: pieces
A route longer than the actor's remaining track is not claimable.

#### C21 Lay track: points
Route points are scored at once: 1, 2, 4, 7, 10 and 15 for lengths 1–6.

#### C22 Paid cards
Paid cards go face up to the discard pile and become public.

#### C23 Any route
A route need not join the actor's other track; at most one route is laid per turn.

#### C24 Twins, 4–5 players
Either side of a twin may be taken by different players; never both by one player.

#### C25 Twins, 2–3 players
After either side is taken, the other is closed to everyone.

#### C26 Taken routes
A route side already taken, or closed, cannot be laid on.

#### C27 Draw charters
Three are drawn (all that remain, if fewer); at least one must be kept; returns go to the bottom in drawn order. The action is unavailable when the pile is empty.

#### C28 Charter secrecy
Kept and returned charters are hidden from the other seats and from spectators until the end; the counts are public.

#### C29 Final round trigger
A player who ends a turn with 0, 1 or 2 pieces starts the final round; each player, that one included, takes exactly one more turn.

#### C30 Final round once
Reaching 2 or fewer again during the final round does not extend it.

#### C31 Charter scoring
Each charter is revealed; completed charters add their value, unfinished ones subtract it, and scores may be negative.

#### C32 Completion
A charter is complete when the holder's own routes join its two towns; other players' routes and closed twins never count.

#### C33 Longest line
The longest trail through a player's own routes may loop and revisit towns but never reuses a route; it uses route lengths.

#### C34 The Iron Ribbon
The longest line scores 10; every tied player scores 10.

#### C35 Winner and ties
Most points wins; then most completed charters; then holding the Iron Ribbon; players still tied share the place.

#### C36 Forced pass
A pass is legal only when no other action is; when every seat passes in a row, the game ends and is scored.

#### C37 Invalid input and determinism
Malformed actions, extra fields, wrong types and hostile getters are rejected without throwing or mutating state; every enumerated legal action applies.

#### C38 Fold and audit
Players and spectators fold the same public state; hand identities appear only in their holder's `learn`; the end-of-game reveal and audit reject a forged charter or freight identity.

#### C39 Games end
Fuzzed games at 2–5 seats always end by declaration (D015).

#### C40 Sifting a reshuffled card
A blind card from a reshuffle is dealt to the drawer, who must keep it if it stands for a discard and skip it otherwise; a skip reveals the card, a keep reveals nothing, and a false keep or skip is refused.

#### C41 Re-dealt charters
A returned charter drawn again by another seat is dealt to that seat; its first holder owes a sealed share instead of a public one, the new holder reads the card, and nobody else can. A seat that draws back a charter it returned knows it at once.

#### C42 Reshuffle limit
Four spare decks are set aside; with none left, the discards stay put and the pile stays empty.
