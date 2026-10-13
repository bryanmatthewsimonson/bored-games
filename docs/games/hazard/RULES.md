# Hazard rules

**Hazard** is a game of conquest for 3–6 players. The world of the Meridian is split into six realms and forty-two provinces. Players claim the map, muster troops, roll dice against their neighbours and trade sets of charters for reinforcements, until one commander holds every province. This file is the **source of truth** for the engine in `packages/games/hazard`.

Hazard uses the mechanics of the classic world-domination game *Risk* (devised by Albert Lamorisse, published by Parker Brothers and now Hasbro) unchanged. The rules prose, the names, the world, the map drawing and the artwork here are all new. This is the only file, with `docs/DECISIONS.md` and the other docs, where the reference game's name may appear (CLAUDE.md, D046). The public site names it only through the exact "Compare to" phrase, stored once in `packages/games/hazard/src/compare.ts` (D053, D088).

**Status: beta (D088).** The engine is `packages/games/hazard` (engine 0.1.0), where every `#### Cnn` below has a named test in `test/catalog/` (CLAUDE.md, D045). The web game is `apps/web/src/games/hazard`, the fuzz target is `hazard` (`pnpm fuzz --game hazard`), and the e2e spec is `apps/web/e2e/hazard.spec.ts`.

## Name, brand and what is original

### The name
- **Hazard** is a synonym of the reference title, and the name of the medieval dice game that craps descends from: a game of dice and nerve, which is what a battle here is.
- **Tagline:** "Six realms. Forty-two provinces. Every roll a hazard."
- **The world:** *the Meridian*, an invented world of six realms, each its own landmass, joined by sea lanes.
- **Clearance (not legal advice).** Hazard is an everyday English word. This is not a trademark search; as for Luster, Right of Way and Room for Doubt, a lawyer must clear the name before release. Fallback title: *Overreach*.

### What is the same, and why it may be
Game mechanics, rules as systems and the numbers that are part of a method of play are not protected by copyright (17 U.S.C. §102(b); U.S. Copyright Office circular FL-108). A rulebook's wording, its board art and layout, its card art and its trade dress are, and the title is a trademark. So:

| Kept exactly (mechanics) | Replaced (expression and brand) |
|---|---|
| 42 territories in 6 continents (9, 4, 7, 6, 12, 4) worth 5, 2, 5, 3, 7, 2; the same 83 connections | every name; the world; the drawing of the map, which is a hex atlas of six separate islands in an arrangement unlike the reference board |
| starting armies 35 / 30 / 25 / 20; claim one at a time, then place one at a time | the rules wording (this file is written from scratch) |
| reinforcements of a third of your territories, at least 3, plus continents | the words for things (provinces, realms, troops, muster, charters, cash in, march) |
| 3 attack dice against 2, highest pairs compared, ties to the defender; move in at least the dice rolled | the card designs (Spear, Horse, Cannon, Crown) and their art |
| 44 cards; sets of three alike, one of each or two and a wild; 4, 6, 8, 10, 12, 15, then +5; +2 on a held territory | the dice, the troop tokens and the cover |
| must trade at 5+; take an eliminated player's cards and trade down to 4 at 6+ | |
| one fortifying move to an adjacent territory; win by holding all 42 | |

The map's graph must be the reference board's, because which provinces touch is part of how the game plays. The drawing is not: no coastline, outline, colour or position copies the reference board, and the names are invented.

### Glossary
| Hazard | Reference game | Engine id |
|---|---|---|
| province | territory | `a1`–`f4` |
| realm | continent | `a`–`f` |
| troops | armies | `troops` |
| muster | place reinforcements | `muster` |
| charter | card | cards 0–43 of the deck `pile` |
| Spear, Horse, Cannon, Crown | infantry, cavalry, artillery, wild | `kindOf`: `card % 3` for 0–41, Crown for 42 and 43 |
| cash in a set | trade in cards | `cash` |
| attack, defend | attack, defend | `attack`, `defend` |
| move in | occupy | `advance` |
| march | fortify | `march` |
| out | eliminated | `out` |

### Brand pack (for the build)
- `gameTitle`: Hazard
- `tagline`: "Six realms. Forty-two provinces. Every roll a hazard."
- `summary`: "Claim provinces across the six realms of the Meridian, muster troops, and march on your neighbours with dice in hand: three for the attacker, two for the defender, ties to the defender. Hold a whole realm for extra troops, cash in sets of charters for more, and take the charters of every rival you wipe from the map. The last commander standing holds the world. For three to six players."
- `aliases`: conquest, world conquest, armies, map, dice war, territory, domination

## Sources and interpretations

**Source.** The Parker Brothers rulebook, 1993 printing ("Rules ©1959, 1963, 1975, 1980, 1990, 1993"), 16 pages, read in full from a public library's PDF. Rules it states are **verified**. Points it does not settle are **platform** rules, and choices left to a table are rule options or **OPEN** (CLAUDE.md, "Never invent rules"). BoardGameGeek id **181** (the 1959 game; it lists 2–6 players, 120 minutes, weight 2.06) was confirmed on 2026-10-12 by a search limited to boardgamegeek.com.

| Topic | Rule | Basis |
|---|---|---|
| Players | 3 to 6 | verified; the 2-player game with a neutral army is **OPEN** |
| Starting troops | 35, 30, 25, 20 for 3, 4, 5, 6 | verified |
| First player | one die each; highest claims first and takes the first turn | verified; rolling again among tied seats is **platform** |
| Claim | in turn, one troop on an empty province, until all 42 are held | verified |
| Place | in turn, one troop on a held province, until all are placed | verified; skipping a seat with none left is **platform** |
| Reinforcement | ⌊provinces / 3⌋, at least 3, plus each realm held whole at the turn's start | verified |
| Realm bonuses | 5, 2, 5, 3, 7, 2 | verified (the board's chart, as every secondary source gives it) |
| Charters | 42 provinces, 14 of each design, and 2 wilds | verified (the count of each design matches every secondary source) |
| Sets and values | three alike, one of each, two and a wild; 4, 6, 8, 10, 12, 15, then +5; counted over all players | verified |
| Province bonus | +2 placed on a held province shown on a cashed charter; at most +2 a turn | verified |
| Forced cash | 5 or 6 charters at the turn's start: at least one set; a second is optional | verified |
| Attack | from 2+ troops to a linked enemy province; 1–3 dice, one fewer than the troops; defender 1–2, 2 needs 2 troops; both announce, then roll | verified |
| Battle | highest pair, then next; ties to the defender | verified |
| Move in | at least the dice of the last roll, leaving one | verified |
| Charter earned | one card at the end of attacking if a province was captured that turn | verified |
| Elimination | the winner takes the loser's cards; 6+ means trade at once until 4 or fewer, then stop; fewer waits for the next turn | verified |
| Fortify | once, one province to one adjacent province, leaving one | verified; the connected-path expert variation is **OPEN** |
| Win | hold all 42 | verified |
| Empty draw pile | the cashed charters are shuffled into a new pile; with none, no charter is drawn | **platform** (the 1993 book is silent; later editions reshuffle) |
| Defender's dice | the defender chooses (default), or the table plays `defense: 'auto'`, the most allowed | verified default; `auto` is a rule option for asynchronous play |

## Components
- **The map:** 42 provinces in six realms, and their 83 links (`src/map.ts`): 67 shared borders and 16 sea lanes, drawn as dotted routes. The lane between Wolfsgate and Smoke Cape runs off the west and east edges of the atlas.
- **Charters:** 44. Card *n* for *n* < 42 shows the province `PROVINCES[n]` and the design Spear (*n* mod 3 = 0), Horse (1) or Cannon (2); cards 42 and 43 are Crowns.
- **Dice:** six-sided, three for the attacker, two for the defender.
- **Troops:** counted, not pieces: each province shows a number.

## The map

| Realm (bonus) | Provinces |
|---|---|
| Hollowpine (5) | a1 Wolfsgate, a2 Longwinter, a3 Rimeholm, a4 Elkridge, a5 Heartwood, a6 Fogmere, a7 Sunder Plains, a8 Lanternshore, a9 Serpent's Neck |
| Verdance (2) | b1 Orchid Coast, b2 Greatcanopy, b3 Condor Heights, b4 Windtail |
| the Old Crowns (5) | c1 Ashfall Isle, c2 Fenhallow, c3 Fjordmark, c4 Gildmoor, c5 Vintner's Reach, c6 Marblecoast, c7 Ryegate Steppe |
| Sunscorch (3) | d1 Dunesea, d2 Reedmouth, d3 Rift Highlands, d4 Deepgreen, d5 Cape Ember, d6 Spice Isle |
| the Vast (7) | e1 Ironspine, e2 Whitewaste, e3 Frostfang, e4 Smoke Cape, e5 Lakehold, e6 Horsewind, e7 Cherrystone Isles, e8 Highpass, e9 Jade Basin, e10 Caravan Gate, e11 Monsoon Coast, e12 Tigerfen |
| Farshore (2) | f1 Steppingstones, f2 Birdwing, f3 Redsand, f4 Coralrun |

The atlas is a hex grid (`src/atlas.ts`). A test proves that its shared hex edges plus its sea lanes are exactly the 83 links, and that every province is drawn in one piece.

## Setup
1. Each seat takes 35, 30, 25 or 20 troops for 3, 4, 5 or 6 players.
2. **The first-player roll.** Every seat rolls one die. The highest claims first. Seats tied on the highest roll again, alone, until one is highest.
3. **Claiming.** From the first claimer, in seat order, each seat puts one troop on a province no one holds, until all 42 are held.
4. **Placing.** Continuing in seat order from the seat after the last claimer, each seat puts one troop on a province it holds, until every troop is out. A seat with none left is passed over.
5. The charters are shuffled face down: that is the pile. The first claimer takes the first turn.

## A turn
A turn has three steps, in order: **muster**, **attack**, **march**.

### 1. Muster
- Count your troops: your provinces divided by three, rounded down, and never fewer than 3; then add the bonus of every realm whose provinces are all yours at the start of the turn.
- You may cash in a set of charters (see [Charters](#charters)) for more. With five or more charters you must cash in one set before placing, and you may cash a second.
- Place every troop of the muster on your own provinces, in any split. The attack opens when the last one is placed.

### 2. Attack
- Attack as often as you like, from any of your provinces holding at least two troops, against any enemy province linked to it.
- Name the province you attack from and the one you attack, and how many dice you roll: one, two or three, and always fewer than the troops in your province.
- The defender then names one or two dice; two only with at least two troops in the province. With one troop there is nothing to choose. (With the rule option `defense: 'auto'`, the defender always rolls as many as allowed.)
- Both roll. Compare the highest die of each: the lower loses one troop, and a tie goes to the defender. If both rolled two or more, compare the second highest the same way.
- When the last defending troop falls, the province is yours. Move in at least as many troops as the dice you just rolled, and as many more as you like, leaving at least one behind. If only one number is possible, the move happens by itself.
- Stop attacking whenever you like. If you captured at least one province this turn, take the top charter of the pile: one, however many you took.

### 3. March
Once, move any number of troops from one of your provinces to one linked province of your own, leaving at least one behind. Or don't. The turn passes to the next seat still on the map.

## Charters
- **A set** is three charters of the same design, one of each design, or any two with a Crown.
- **Cashing in.** Sets pay 4, 6, 8, 10, 12 and 15 troops for the first six sets cashed in the game, by anyone, and five more for each set after that (20, 25, …).
- **Province bonus.** If a cashed charter shows a province you hold, two extra troops go straight onto that province. If several do, you choose which. You can take this bonus once a turn.
- **Cashed charters** go face up to the discard. When a charter must be drawn and the pile is empty, the discard is shuffled into a new pile; if the discard is empty too, there is no charter to draw.

## Eliminating a rival
When you take a seat's last province, it is out of the game, and its charters become yours. If that gives you six or more, cash sets at once until you hold four or fewer, then stop. Place those troops at once and carry on attacking. With fewer than six, the new charters wait for your next turn.

## Winning
The first seat to hold all 42 provinces wins. The other seats rank by how long they lasted: the last one out is second.

## Rule options
- `defense`: `choose` (default, the rulebook) or `auto` (the defender always rolls the most dice allowed: fewer waits for an asynchronous table).

## Platform rules
- Ties in the first-player roll roll again among the tied seats only.
- A seat with no troops left to place is passed over while placing.
- An empty pile is refilled by reshuffling the cashed charters.
- A seat that cashes a false set or names a false province bonus (only a modified client can) gets nothing for it, loses the charters to the discard, and ranks last at the end.

## Online play on this site
- **Dice** come from the dice beacon (D058): the move that fixes the last dice count (the attack, or the defender's choice) opens a roll, every seat's app adds a share, and the faces follow. The faces are the attacker's dice, then the defender's. **Every seat's app takes part in every roll, including the apps of seats that are out**: a closed app holds the game up until the others claim a timeout.
- **Charters** are one encrypted deck of 44 (`pile`, with prompt shares under D075). A drawn charter is dealt to its drawer alone. Cashing in deals the three positions to the table, so every app shares them, and the set pays once all three are face up: the engine cannot check a set it cannot see, so it checks it then. A reshuffle is a play-phase epoch (D073), with positions 128·k + i. An eliminated seat's charters are re-dealt to the conqueror, whose app opens them with sealed shares (D067); until it has, it offers nothing that depends on them.
- **Resign** is on at every seat count (D090): it ends the game for everyone, unrated, with the resigner last and the others placed by the standings as if the game ended now (PROTOCOL §8.3), whatever is pending (a roll, a cashed set's reveal, a reshuffle, a sealed charter).

### Actions (one accepted encoding each)
`{type:'roll',actor}`, `{type:'contribute',actor,id}`, `{type:'claim',actor,province}`, `{type:'place',actor,province}`, `{type:'muster',actor,province,count}`, `{type:'cash',actor,positions:[p,q,r] ascending,bonus:province|null}`, `{type:'attack',actor,from,to,dice}`, `{type:'defend',actor,dice}`, `{type:'advance',actor,count}`, `{type:'endAttack',actor}`, `{type:'march',actor,from,to,count}`, `{type:'endTurn',actor}`; from the platform, `{type:'rolled',actor:'beacon',id,dice}`, `{type:'reveal',actor:'deck',deck:'pile',pos,card}` and `{type:'epoch',actor:'deck',epoch,size}`.

## Verification catalog

#### C01 Seats and starting troops
Three to six seats, with 35, 30, 25 or 20 troops each; two and seven seats are refused.

#### C02 The first-player roll
One die per seat still tied; the highest goes first; tied seats roll again, alone.

#### C03 Claiming
From the first claimer in seat order, one troop on an empty province.

#### C04 Claimed provinces
A held province cannot be claimed, and only the seat in turn may claim.

#### C05 Placing
Placing starts after the last claimer, puts one troop on a held province, and passes over seats with none left.

#### C06 The first turn
When every troop is placed, the first claimer's turn starts with its muster.

#### C07 Troops from provinces
A third of the provinces held, rounded down, and never fewer than 3.

#### C08 Realm bonuses
Each realm held whole at the start of the turn adds 5, 2, 5, 3, 7 or 2.

#### C09 Placing the muster
Any split, one province at a time; the attack waits until the pool is empty.

#### C10 What may be attacked
A linked enemy province, over land or a sea lane (the edge lane included), from a province with two troops or more.

#### C11 Attacking dice
One to three, and fewer than the troops attacking.

#### C12 Defending dice
The defender chooses one or two, two only with two troops; with one troop there is no choice.

#### C13 Automatic defence
With `defense: 'auto'`, the defender rolls the most dice allowed.

#### C14 The battle
Highest against highest, then the next pair; ties to the defender.

#### C15 Moving in
At least the dice just rolled, at most all but one; a single possibility happens by itself.

#### C16 Earning a charter
One charter for a turn with a capture, drawn when the attacks stop, before the march.

#### C17 No capture, no charter
A turn without a capture draws nothing.

#### C18 Sets
Three alike, one of each, or two and a Crown; nothing else is offered.

#### C19 Set values
4, 6, 8, 10, 12, 15, then five more each, counted over every seat's sets.

#### C20 The province bonus
Two troops on a held province shown on a cashed charter, chosen among matches, once a turn.

#### C21 Forced cash
Five charters or more at the start of a turn must be cashed before placing; a second set is optional.

#### C22 Cashing is a reveal
The three positions go to the table, and the set pays once all three are face up.

#### C23 Reshuffles
An empty pile is refilled from the cashed charters; with none, no charter is drawn.

#### C24 Captured charters
A seat wiped out hands its charters to the conqueror, re-dealt privately.

#### C25 Cashing down
Six charters or more after a conquest: cash at once to four or fewer, then stop, place and attack on; until the captured charters are learned, nothing is offered.

#### C26 Fewer than six
Captured charters below six wait for the next turn; a seat with none is wiped out with no re-deal.

#### C27 The march
Once, between linked provinces of one's own, leaving one behind; it ends the turn.

#### C28 Ending a turn
A turn may end without a march.

#### C29 Winning
All 42 provinces win; the others rank by how long they lasted.

#### C30 Seats that are out
They take no turns, and still add their share to every roll.

#### C31 False sets
A false set or bonus pays nothing, and ranks its seat last.

#### C32 Encodings
Every move has one accepted encoding; junk is refused without an exception.

#### C33 Views
A hand is hidden from other seats and spectators; its size is public; both a conqueror and the loser know captured charters.

#### C34 The map
42 provinces in six realms of 9, 4, 7, 6, 12 and 4, worth 5, 2, 5, 3, 7 and 2, and 83 links.
