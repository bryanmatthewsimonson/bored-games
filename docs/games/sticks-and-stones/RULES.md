# Sticks & Stones rules

**Sticks & Stones** is a worker-placement game for 2–4 players. Each player leads a clan at the dawn of the world. Every round the clans send their people out to hunt, gather wood, clay, stone and amber, make tools, grow the harvest and raise families; then they roll for what their people bring home, trade it for discoveries and monuments, and feed everyone. The richest legacy wins. This file is the **source of truth** for the engine in `packages/games/sticks-and-stones`.

Sticks & Stones uses the mechanics of *Stone Age* (Bernd Brunnhofer, writing as Michael Tummelhofer; Hans im Glück, 2008; in English from Rio Grande Games and later Z-Man Games) unchanged. The rules prose, the names, the board, the card and tile designs and the artwork here are all new. This is the only file, with `docs/DECISIONS.md` and the other docs, where the reference game's name may appear (CLAUDE.md, D046). The public site names it only through the exact "Compare to" phrase, stored once in `packages/games/sticks-and-stones/src/compare.ts` (D053, D089).

**Status: beta (D089).** The engine is `packages/games/sticks-and-stones` (engine 0.1.0), where every `#### Cnn` below has a named test in `test/catalog/` (CLAUDE.md, D045). The web game is `apps/web/src/games/sticks-and-stones`, the fuzz target is `sticks-and-stones` (`pnpm fuzz --game sticks-and-stones`), and the e2e spec is `apps/web/e2e/sticks-and-stones.spec.ts`.

## Name, brand and what is original

### The name
- **Sticks & Stones**: two of the goods the clans gather, and the start of the old rhyme. It names the game's stuff, wood and stone, without naming the era the reference title does.
- **Tagline:** "Gather sticks and stones, feed the clan, and leave a mark that lasts."
- **Clearance (not legal advice).** "Sticks and stones" is an everyday phrase. This is not a trademark search; as for Luster, Right of Way, Room for Doubt and Hazard, a lawyer must clear the name before release. Fallback title: *Ochre*.

### What is the same, and why it may be
Game mechanics, rules as systems and the numbers that are part of a method of play are not protected by copyright (17 U.S.C. §102(b); U.S. Copyright Office circular FL-108). A rulebook's wording, its board art and layout, its card and tile art and its trade dress are, and the title is a trademark. So:

| Kept exactly (mechanics) | Replaced (expression and brand) |
|---|---|
| 5 people and 12 food to start; at most 10 people, harvest 10, three tools of up to 4 | every name: the spots, the goods (amber, not gold; clay, not brick), the symbols and figures, the cards and tiles |
| the spots and their room: hunting (any), four grounds of 7, toolmaker 1, hut 2, field 1, four cards, a stack per player; the 2- and 3-player limits | the rules wording (this file is written from scratch) |
| place one spot a turn, never a spot twice a round; resolve all your spots in your order | the board: a camp drawn for this game, not the reference board's layout |
| dice sum over 2, 3, 4, 5 or 6; tools added after the roll, once a round | the card faces and their symbol drawings, the monument tiles, the tokens, the dice and the cover |
| the 36 cards' effects and scoring parts; the 28 buildings' prices and points | |
| feeding, the −10 penalty; the end on an empty stack or a short pile; the final count and the tie-break | |

### Glossary
| Sticks & Stones | Reference game | Engine id |
|---|---|---|
| clan | player | seat |
| people | people (workers) | `people`, `home`, `spots` |
| Hunting Grounds | hunting grounds | `hunt` |
| Birch Wood, Clay Bank, Rockfall, Amber Creek | forest, clay pit, quarry, river | `wood`, `brick`, `stone`, `gold` |
| wood, clay, stone, amber | wood, brick, stone, gold | goods 0–3 |
| Knapper's Rock | tool maker | `tools` |
| Hearth | hut | `hut` |
| Furrows | field | `field` |
| harvest | agriculture / food track | `field` |
| one-use tool | one-time tool | `spares` |
| discovery | civilization card | cards 0–35 of the deck `camp` |
| monument | building | cards 36–63 of the deck `camp`, monuments 0–27 |
| monument site | building stack | `stack0`–`stack3` |
| Glyphs, Healing Herbs, Pottery, Cave Painting, Bone Flute, Weaving, Star Calendar, Sledge | writing, medicine, pottery, art, music, weaving, time, transport | symbols 0–7 |
| Grower, Knapper, Builder, Elder | farmer, tool maker, hut builder, shaman | figures 0–3 |
| Gifts of the dice | dice for everyone | top `dice` |
| went hungry | could not feed (−10) | `fed` with `hungry` |

### Brand pack (for the build)
- `gameTitle`: Sticks & Stones
- `tagline`: "Gather sticks and stones, feed the clan, and leave a mark that lasts."
- `summary`: "Lead a clan at the dawn of the world. Each round, send your people out: to hunt, to cut wood, dig clay, break stone and pan amber, to the knapper for tools, to the hearth for a new mouth to feed, to the furrows for a better harvest. Then roll for what they bring home, trade it for discoveries and raise monuments, and feed everyone before winter bites. The richest legacy wins. For two to four players."
- `aliases`: worker placement, workers, prehistory, tribe, clan, dice, village, cave

## Sources and interpretations

**Sources.** The Rio Grande Games English rulebook of 2008 with its two-page card sheet (hosted by Yucata), the Z-Man English rulebook ZM7260 (©2008–2014) and its card summary, read in full; the 2018 anniversary rulebooks in English and German only where they word the same rule more plainly. The 36 cards and the 28 tiles were read one by one from BoardGameGeek scans (images 408812, 408814, 408817, 408856; 408843, 408847 and the photo 361106) and checked against a second, independent card list. Rules a rulebook states are **verified**. Points no rulebook settles are **platform** rules, and choices a table could make either way are rule options or **OPEN** (CLAUDE.md, "Never invent rules"). BoardGameGeek id **34635** (2008; 2–4 players, 60–90 minutes, age 10+) was confirmed on 2026-10-12 against boardgamegeek.com. The research notes, with every source address, are in the D089 entry.

| Topic | Rule | Basis |
|---|---|---|
| Players | 2 to 4 | verified |
| Start | 5 people, 12 food, harvest 0, no tools, score 0 | verified |
| First player | free choice in the rulebooks | **platform**: the first card of the opening display, counted round the table (C02) |
| Stacks | 28 tiles in four stacks of 7; one stack per player | verified |
| Display | always four cards, the cheapest end refilled first | verified (the 2008 English "by number of players" is a known mistranslation) |
| Placement | one spot a turn, any number up to its room; never a spot already used this round; no passing while a spot is open | verified |
| Room | hunting any; each ground 7; toolmaker and field 1; hut exactly 2 of one clan; each card and stack 1 | verified |
| Fewer players | 3 players: two clans a ground; 2 players: one clan a ground; 2 or 3: only two of the three village spots each round | verified |
| Resolving | in order from the first player, each clan resolves all its spots, in the order it likes | verified |
| Gathering | a die per person; the sum, plus tools, over 2 (food), 3, 4, 5 or 6, rounded down | verified |
| Tools | the ladder 1, 1·1, 1·1·1, then each tile up to 4; each once a round, whole, after the roll, several at once | verified; which tile goes up is **platform** (an unused one of the lowest) |
| Village | hut +1 person (who eats this round), field +1 harvest, toolmaker a tool step | verified |
| Limits | 10 people, harvest 10, tool value 12 | verified for tools; people and harvest by the components and the track |
| Cards | pay the slot (1–4) in any goods, never food; or take the person back | verified |
| Buildings | pay the price (or a valid variable payment), score at once, turn up the next tile; or take the person back | verified |
| Feeding | take the harvest in food, then eat one food a person; short: all food goes, then pay the whole rest in goods, or lose 10 points | verified |
| End | the display cannot be filled at a round's start: the game ends at once; a stack is empty: the round ends, feeding included, then the game | verified |
| Scoring | culture symbols squared (duplicates a second set, squared); figures × harvest, tool value, buildings, people; one point a good left | verified; duplicates are a rule option (C27) |
| Tie-break | harvest + tool value + people; then a shared place | verified |
| Resources and food | unlimited | verified for goods; food by standard practice |
| Declining a village spot or a roll | the rulebooks give the take-back only for cards and buildings | **OPEN**: the engine resolves every village spot and every roll |
| The two-goods card | "now or later" | **OPEN**: the engine lets its owner take the goods at any of its own decisions while placing, resolving or feeding |
| A tile raised after it was used | stays used this round | **OPEN** (consensus); the engine keeps it used |

## Components
- **Goods:** wood, clay, stone and amber, worth 3, 4, 5 and 6 (the divisor of a gathering roll and the points of a variable monument). Food. All unlimited.
- **People:** 5 per clan at the start, up to 10.
- **Tools:** at most three tiles, each worth 1 to 4.
- **Dice:** six-sided, as many as needed.
- **The deck `camp`:** 64 cards in two groups shuffled apart, so a position's group is public: positions 0–35 the discoveries, positions 36–63 the monuments, in four stacks of seven (stack *k* is positions 36 + 7*k* … 36 + 7*k* + 6, its top first). A game uses the first stack for each player; the others are never turned up.

### The 36 discoveries (cards 0–35)
Each card has a **top**, taken at once when it is bought, and a **bottom**, which scores at the end. Goods: 0 wood, 1 clay, 2 stone, 3 amber.

| Cards | Bottom | Tops |
|---|---|---|
| 0, 1 | Glyphs | a face-down discovery; Gifts of the dice |
| 2, 3 | Healing Herbs | 5 food; two goods of your choice |
| 4, 5 | Pottery | 7 food; Gifts of the dice |
| 6, 7 | Cave Painting | roll two dice for amber; a tool step |
| 8, 9 | Bone Flute | 3 points; 3 points |
| 10, 11 | Weaving | 1 food; 3 food |
| 12, 13 | Star Calendar | a harvest step; Gifts of the dice |
| 14, 15 | Sledge | 2 stone; Gifts of the dice |
| 16–20 | Grower ×1, ×1, ×1, ×2, ×2 | a harvest step; 1 stone; Gifts; 3 food; Gifts |
| 21–25 | Knapper ×1, ×1, ×2, ×2, ×2 | a one-use tool of 4; of 3; of 2; Gifts; Gifts |
| 26–30 | Builder ×1, ×1, ×2, ×2, ×3 | 4 food; Gifts; 2 food; Gifts; 3 points |
| 31–35 | Elder ×1, ×1, ×1, ×2, ×2 | 1 amber; 1 stone; roll two dice for stone; 1 clay; roll two dice for wood |

### The 28 monuments (cards 36–63)
| Monuments | Price | Points |
|---|---|---|
| 0–8 | 2 wood + 1 clay; 2 wood + 1 stone; 1 wood + 2 clay; 2 wood + 1 amber; 2 clay + 1 stone; 1 wood + 2 stone; 1 clay + 2 stone; 2 clay + 1 amber; 2 stone + 1 amber | 10, 11, 11, 12, 13, 13, 14, 14, 16 |
| 9–16 | two each of: wood + clay + stone; wood + clay + amber; wood + stone + amber; clay + stone + amber | 12, 13, 14, 15 |
| 17–20 | four goods of exactly 1, 2, 3 or 4 different kinds, chosen by the builder | the goods' value |
| 21–24 | five goods of exactly 1, 2, 3 or 4 different kinds | the goods' value |
| 25–27 | one to seven goods of any kinds | the goods' value |

## Setup
1. Each clan takes 5 people, 12 food, harvest 0, no tools and score 0.
2. The discoveries are shuffled into a pile; the top four are turned up into the display. Slot 0 costs 1 good, slot 1 costs 2, slot 2 costs 3, slot 3 costs 4.
3. The monuments are shuffled into four stacks of seven; one stack per player is used, and its top tile is turned up.
4. The first player is fixed by the first card of the opening display: its number, counted round the table from the first seat (C02).

## A round
A round has three phases: **placing**, **resolving** and **feeding**.

### 1. Placing
From the first player, round the table, each clan in turn sends one or more of its people still at home to **one** spot. The turns go round until nobody can place any more. A clan with nobody at home, or with no spot left open to it, is passed over. A clan must place while it can.
- **Never twice.** A clan may not send people to a spot where it already has people this round, even with room left.
- **Hunting Grounds:** any number of people, from any number of clans.
- **Birch Wood, Clay Bank, Rockfall, Amber Creek:** seven people in all, from all clans together.
- **Knapper's Rock, Furrows:** one person. **Hearth:** exactly two people of one clan, sent together.
- **Each discovery in the display, and each monument site with a tile:** one person.
- **Fewer players.** With three players, a gathering ground takes people of at most two clans; with two, of one. With two or three players, only two of the three village spots (Knapper's Rock, Hearth, Furrows) may be used in a round, by anyone.

### 2. Resolving
From the first player, round the table, each clan resolves **all** of its spots, in any order it likes, before the next clan starts. Each person comes home as their spot is resolved. Whatever a clan gains on one spot it may use on the next.
- **Gathering** (Hunting Grounds and the four grounds): roll a die for each person there, add up the dice, add any tools, and divide by 2 for food, 3 for wood, 4 for clay, 5 for stone or 6 for amber, rounding down. That many of the good come home.
- **Tools.** Each tool tile can be added once a round, at its whole value, to any roll of its clan's; any number of tiles can go on one roll, and the clan decides after seeing the dice. A one-use tool is added the same way and is then gone.
- **Knapper's Rock:** one tool step. The first three steps each bring a new tile worth 1; after that each step raises a lowest tile by one, until all three are worth 4.
- **Hearth:** one more person, up to 10. They eat from this round.
- **Furrows:** one step of harvest, up to 10.
- **A discovery:** pay its slot's price in goods, any mix, never food, and take the card: its top happens at once, its bottom scores at the end. Or take the person back and leave the card.
- **A monument:** pay its price and score its points at once; the next tile of the stack is turned up. Or take the person back and leave the tile.

### Discovery tops
- **Food, goods, points:** taken at once.
- **A tool step, a harvest step:** as at Knapper's Rock or the Furrows.
- **A one-use tool:** kept until its clan adds it to a roll.
- **Two goods of your choice:** taken now, or at any later decision of the owner's (OPEN, see the sources).
- **Roll two dice for a good:** a gathering of two people for that good; tools may be added.
- **Gifts of the dice:** the buyer rolls a die for each player. Starting with the buyer and going round, each player takes one die: 1 a wood, 2 a clay, 3 a stone, 4 an amber, 5 a tool step, 6 a harvest step. Tools cannot change these dice. The last player takes the last die.
- **A face-down discovery:** the buyer takes the top card of the pile without showing it. It counts only for its bottom at the end. With an empty pile there is nothing to take.

### 3. Feeding
Every clan takes food equal to its harvest. Then, from the first player, each clan eats one food per person and keeps any food left. A clan short of food gives up all its food and then either pays the whole shortfall in goods (one good per missing food) or loses 10 points, whatever the number unfed. A score can go below zero.

### A new round
The first player passes to the left. The cards left in the display slide to the cheap end, keeping their order, and the empty slots are filled from the pile, the cheap end first. Used tools turn back.

## The end of the game
- **The pile runs short.** If, at the start of a round, the pile cannot fill every empty slot of the display, the game ends at once.
- **A stack runs out.** If a monument stack is empty after resolving, the round is played out, feeding included, and the game ends.
- **Face-down discoveries** are turned up.
- **The final count** adds to the score track:
  - **Culture:** the different culture symbols a clan holds, squared. A second card of a symbol starts a second set, scored the same way (or, with the rule option `duplicates: 'ones'`, one point each).
  - **Figures:** Growers times the harvest, Knappers times the total value of the tool tiles (one-use tools do not count), Builders times the monuments built, Elders times the people.
  - **Goods:** one point for each good left. Food scores nothing.
- **The winner** has the most points. A tie goes to the higher total of harvest, tool value and people; a tie there shares the place.

## Rule options
- `duplicates`: `squared` (default: the publisher's ruling and every later printing) or `ones` (the first English printing's answer: one point for each duplicate symbol).

## Platform rules
- The first player is the seat counted by the first card of the opening display (36 cards: every seat is as likely).
- When the tools a clan still has could not raise a roll's yield, nobody is asked: the roll yields with no tool.
- A tool step that raises a tile raises an unused one of the lowest value, when there is one.
- The last player to take a die from a gift takes it without a decision.
- A clan whose goods cannot cover its shortfall goes hungry without a decision; a clan with nothing to decide while feeding is fed by itself.

## Online play on this site
- **Dice** come from the dice beacon (D058): the move that rolls (resolving a gathering spot, or buying a card that rolls) opens a roll, every seat's app adds a share, and the faces follow.
- **The cards and tiles** are one encrypted deck of 64 in two groups (`camp`, with prompt shares under D075). The display and the stack tops are public reveals, so every app shares them as they come up. A face-down discovery is dealt to its buyer alone; at the end it is turned up by a public reveal before the count.
- **What is public:** everything but the pile's order and a face-down discovery. Bought discoveries are face down in the box game, but every one was face up in the display when it was bought, and the public record shows it: the screen shows them.
- **Standings** during the game are the final count of what is public now.
- **Resign** is off (`resignAllowed` false), as for every deck game with public reveals, pending a D052 review.

### Actions (one accepted encoding each)
`{type:'contribute',actor,id}`, `{type:'place',actor,spot,count}`, `{type:'use',actor,spot}`, `{type:'buy',actor,slot,pay:[w,c,s,a]}`, `{type:'build',actor,stack,pay:[w,c,s,a]}`, `{type:'skip',actor,spot}`, `{type:'tools',actor,tools:[ascending tile indexes],spares:[ascending one-use indexes]}`, `{type:'pick',actor,face}`, `{type:'choose',actor,take:[w,c,s,a]}`, `{type:'feed',actor,pay:[w,c,s,a]|null}`; from the platform, `{type:'rolled',actor:'beacon',id,dice}` and `{type:'reveal',actor:'deck',deck:'camp',pos,card}`.

## Verification catalog

#### C01 Setup
Two to four players (one and five are refused), each with 5 people, 12 food, no harvest, no tools; four discoveries and one stack top per player are turned up.

#### C02 The first player
The first card of the opening display, counted round the table from the first seat, names the first player.

#### C03 The discoveries
36 cards: 16 culture cards, two per symbol, and 20 figure cards with 7 Growers, 8 Knappers, 9 Builders and 7 Elders; the tops are 10 gifts, 7 foods, 5 goods, 3 rolls, 3 points, 3 one-use tools, a tool step, two harvest steps, a choice of goods and a face-down card.

#### C04 The monuments
28 tiles: 17 at a fixed price worth 222 points in all, 8 by count and kinds, and 3 of one to seven goods.

#### C05 Placing
One spot a turn, one or more people, never a spot the clan already used this round; the turns go round, and a clan with nobody left is passed over.

#### C06 Room on the spots
Hunting takes any number; a ground holds 7 in all; Knapper's Rock and the Furrows one; the Hearth exactly two of one clan; each card and stack one.

#### C07 Fewer players
With three players two clans share a ground, with two only one; with two or three only two of the three village spots are used.

#### C08 The end of placing
Placing ends when no clan can place, and resolving starts with the first player.

#### C09 Resolving in order
Each clan, in order, resolves every one of its spots, in the order it likes, before the next clan.

#### C10 Gathering
A die per person; the sum over 2, 3, 4, 5 or 6, rounded down.

#### C11 Tools
The ladder up to three 4s; each tile once a round, after the dice, alone or with others; no question when tools cannot help.

#### C12 The village
The Hearth adds a person, the Furrows a harvest step, Knapper's Rock a tool step, up to their limits.

#### C13 Buying a discovery
The slot's price in any goods, never food; or the person comes back and the card stays.

#### C14 Building a monument
The price, or a valid variable payment; the points at once; the next tile turned up at once; or the person comes back.

#### C15 Food, goods and points
Taken at once.

#### C16 One-use tools
Added to one roll of the owner's, with any tools, and then gone; the card stays for its bottom.

#### C17 Tool and harvest steps
As at Knapper's Rock and the Furrows.

#### C18 Two goods of your choice
Taken at once or at a later decision of the owner's.

#### C19 Gifts of the dice
A die per player; from the buyer round, each takes one: a good, a tool step or a harvest step; the last die goes to the last taker.

#### C20 Rolling for a good
Two dice for the card's good, as a gathering; tools may be added.

#### C21 A face-down discovery
Drawn for its buyer alone, it only scores; with an empty pile there is none.

#### C22 Feeding
The harvest first, then one food a person; what is left is kept.

#### C23 Going hungry
All the food goes; the whole shortfall in goods, or −10; a score may go below zero; a card of two goods may be used first.

#### C24 A new round
The display slides to the cheap end and is refilled; tools turn back; the first player passes left.

#### C25 The pile runs short
The game ends at once when the display cannot be filled at the start of a round; with nothing to fill, play goes on.

#### C26 A stack runs out
The round is played out, feeding included, and the game ends.

#### C27 Culture
The different symbols, squared; duplicates a second set squared, or one point each with `duplicates: 'ones'`.

#### C28 Figures, goods and ties
Figures multiply harvest, tool value, monuments and people; goods score one each; a tie goes to harvest + tool value + people.

#### C29 Face-down cards at the end
They are turned up before the count; until then the standings leave them out.

#### C30 Encoding, rules and views
Every move has one accepted encoding; the rules object is exact; a view hides the pile and others' face-down cards.
