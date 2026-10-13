# Current Affairs rules

**Current Affairs** is an economic game for 2–6 players. Each player runs a young power company in the Commonwealth. Every round the companies bid for power stations, buy coal, oil, waste and uranium in a market whose prices climb as it empties, and wire cities into their networks; then they fire their stations and are paid for every city they light. When one network grows large enough, the company that can power the most cities wins. This file is the **source of truth** for the engine in `packages/games/current-affairs`.

Current Affairs uses the mechanics of *Power Grid* (Friedemann Friese; first published in German by 2F-Spiele as *Funkenschlag*; in English from Rio Grande Games, 2004) unchanged. The rules prose, the names, the map, the station cards and the artwork here are all new. This is the only file, with `docs/DECISIONS.md` and the other docs, where the reference game's name may appear (CLAUDE.md, D046). The public site names it only through the exact "Compare to" phrase, stored once in `packages/games/current-affairs/src/compare.ts` (D053, D091).

**Status: beta (D091).** The engine is `packages/games/current-affairs` (engine 0.1.0), where every `#### Cnn` below has a named test in `test/catalog/` (CLAUDE.md, D045). The web game is `apps/web/src/games/current-affairs`, the fuzz target is `current-affairs` (`pnpm fuzz --game current-affairs`), and the e2e spec is `apps/web/e2e/current-affairs.spec.ts`.

## Name, brand and what is original

### The name
- **Current Affairs**: electric current, and the affairs of business. The everyday phrase means the news; here it is a game about running a utility's affairs. It names neither the reference title nor anything in it.
- **Tagline:** "Bid for power stations, buy the fuel, wire the cities. Keep the lights on."
- **Fallback name:** *Live Wire*.
- **Clearance (not legal advice).** "Current affairs" is an everyday phrase. This is not a trademark search; as for the other titles, a lawyer must clear the name before release.

### What is the same, and why it may be
Game mechanics, rules as systems and the numbers that are part of a method of play are not protected by copyright (17 U.S.C. §102(b); U.S. Copyright Office circular FL-108). A rulebook's wording, its board art and layout, its card art and its trade dress are, and the title is a trademark. So:

| Kept exactly (mechanics) | Replaced (expression and brand) |
|---|---|
| 50 to start, 22 substations, 2–6 players and the counts that depend on them | every name: the land, its regions and cities, the stations, the eras, the phases, the money (dollars, not the reference currency) |
| the 42 stations' numbers, fuels, burns and cities powered, and the Era III card | the rules wording (this file is written from scratch) |
| the auction, the fuel market's prices and restock, wiring costs 10/15/20 plus lines, the payday table | the map's drawing: a new land, mirrored and redrawn, with new region and city names |
| the board's graph (its U.S. side): 42 cities in six regions of seven, which cities each line joins and what it costs, all 87 lines | |
| the five phases and their orders; the three eras and their triggers; the end and the tie-breaks | the station cards, the fuel tokens, the board drawing, the cover |

### Glossary
| Current Affairs | Reference game | Engine id |
|---|---|---|
| company | player | seat |
| power station (station) | power plant | station numbers 3–50 |
| the station market, on offer / coming up | power plant market, actual / future market | `market`, `onOffer` |
| the stack | draw stack | `stack` |
| the Era III card | Step 3 card | `stack.eraCard`, `eraCardShown` |
| Era I, II, III | step 1, 2, 3 | `era` |
| coal, oil, waste, uranium | coal, oil, garbage, uranium | fuels 0–3 |
| coal-or-oil station | hybrid plant | kind `hybrid` |
| green station | ecological and fusion plants | kind `green` |
| the fuel yard | resource market | `yard` |
| substation | house | `houses`, `cities` |
| line | connection | `LINKS` |
| Standings, Auction, Fuel, Wiring, Payday | phases 1–5 (player order, auction, buying resources, building, bureaucracy) | `phase` |
| the Commonwealth | the map | `map.ts` |
| dollars ($) | the reference currency | `money` |

### Brand pack (for the build)
- `gameTitle`: Current Affairs
- `tagline`: "Bid for power stations, buy the fuel, wire the cities. Keep the lights on."
- `summary`: "Run a young utility across the six regions of the Commonwealth. Each round, bid against your rivals for power stations, buy coal, oil, waste and uranium in a market where every unit bought raises the price, and wire cities into your network. Then fire your stations and get paid for every city you light. The leaders pay more and choose last; the stragglers get the bargains. When the network race ends, the company that can power the most cities wins. For two to six players."
- `aliases`: economic, auction, network, electricity, power plants, utilities, energy, market

## Sources and interpretations

**Sources (research of 2026-10-13, paraphrased, never copied).** The Rio Grande Games English rulebooks in their printings of 2005 (the 2004 edition's text), 2007, March 2009 and August 2009 (the last before the 2018 edition), all from riograndegames.com through the Wayback Machine; the official 2F-Spiele English FAQ (archived 2008); the BoardGameGeek FAQ wiki with the official Step 3 ruling of 2009-02-23 (thread 383964); Eric Postpischil's condensed rules; and the 2018 edition's rulebook, for comparison and where the earlier texts are silent (Era III before Era II). The 42 stations were checked card by card against three independent data sets; station 29 (coal or oil, burns 1, powers 4) is backed by two of the three. BoardGameGeek id **2651** (2004; 2–6 players, 120 minutes, age 12, weight 3.2) was confirmed through BoardGameGeek's own API. Rules a rulebook states are **verified**. Where printings differ, the latest pre-2018 printing and the official rulings win, and the choice is noted. Points no source settles are **platform** rules or **OPEN** (CLAUDE.md, "Never invent rules").

| Topic | Rule | Basis |
|---|---|---|
| Players | 2 to 6 | verified |
| Start | $50 and 22 substations each | verified |
| Regions | 3, 3, 4, 5, 5 regions for 2–6 players, touching as one block, chosen by the players | verified; who speaks for the table is **platform**: the first seat, the table's creator, chooses (C02) |
| First order | drawn by lot | verified; here by the dice (C05) |
| Stack | 3–10 in the market, 13 on top, the Era III card at the bottom; 8, 8, 4, 0, 0 stations out unseen for 2–6 players | verified |
| Auction | open in player order, bid clockwise; one station a round; everyone buys in round 1; passing the opening ends the company's auction phase | verified |
| Limit | 3 stations (4 with 2 players); scrap one of the others; its fuel may move or be dropped | verified (the FAQ for dropping) |
| Unsold round | the lowest station leaves at the end of the auction | verified |
| Small stations | a market station numbered no higher than any company's city count leaves at once | verified |
| Fuel | reverse order; the cheapest units first; only what the stations can hold; fuel moves freely between a company's stations | verified |
| Wiring | reverse order; 10, 15, 20 a substation plus the cheapest lines from the network; never through regions out of play | verified (2007 printing on, for the regions) |
| Payday | player order; any stations fired; the table; restock; then the market moves on | verified |
| Era II | at 10, 7, 7, 7, 6 cities for 2–6 players, after wiring: the lowest station leaves once; if Era III comes first, Era II's changes are made just before it | verified (the 2018 rulebook for Era III first; the 2004 edition's FAQ only says to go straight to Step 3) |
| Era III | the card's three timings; the stack is shuffled at once | verified (the 2009 ruling, over the 2007 printing's "no replacements") |
| End | 21, 17, 17, 15, 14 cities, after wiring; the most cities powered, then money, then cities | verified; no income in the final count (the FAQ calls it pointless; the 2018 edition pays none) |
| Money | hidden (the official FAQ: play with hidden money; the rulebooks are silent) | verified (FAQ); each company sees only its own money until the end, though every payment is made in the open, as at the table |

## The map
The board is the reference game's U.S. side as a graph: its 42 cities in six regions of seven, and its 87 lines, each joining the same two cities at the same cost, from $0 to $28 (three lines cost nothing; 31 lines cross between regions). Which cities touch and what a line costs are part of how the game plays, so they are kept line for line, as Hazard keeps its board's links (D088). Everything else is new: the land is the Commonwealth, drawn mirrored and redrawn, with its own region and city names (`src/theme.ts`) and drawing (`src/atlas.ts`, `apps/web/src/games/current-affairs/map.tsx`). The regions are **Frostmere** (north-east), **Highcopper** (north), **Ambergate** (north-west), **Saltmarsh** (south-east coast), **Heartfield** (south-west) and **Emberreach** (south). Regions touch where a line crosses between them: Frostmere touches Highcopper, Saltmarsh and Emberreach; Highcopper touches Ambergate, Heartfield and Emberreach; Ambergate touches Heartfield; Saltmarsh and Heartfield both touch Emberreach. `src/map.ts` holds the graph. The graph was taken from two independent transcriptions of the board (a Java and a JavaScript implementation, research of 2026-10-13), which agree on every line and cost, read from both ends.

## Components
- **Money:** dollars. Each company starts with $50.
- **Substations:** 22 per company.
- **Fuel:** 24 coal, 24 oil, 24 waste, 12 uranium.
- **The fuel yard:** coal, oil and waste each have eight price spaces, $1 to $8, three units to a space; uranium has twelve spaces of one unit, $1–$8, $10, $12, $14, $16. Units fill a fuel's dearest spaces; a buyer takes the cheapest.
- **The 42 power stations** (number: fuel, burn → cities). A station stores twice its burn; a green station burns and stores nothing.

| Fuel | Stations |
|---|---|
| Coal | 4: 2→1; 8: 3→2; 10: 2→2; 15: 2→3; 20: 3→5; 25: 2→5; 31: 3→6; 36: 3→7; 42: 2→6 |
| Oil | 3: 2→1; 7: 3→2; 9: 1→1; 16: 2→3; 26: 2→5; 32: 3→6; 35: 1→5; 40: 2→6 |
| Coal or oil | 5: 2→1; 12: 2→2; 21: 2→4; 29: 1→4; 46: 3→7 |
| Waste | 6: 1→1; 14: 2→2; 19: 2→3; 24: 2→4; 30: 3→6; 38: 3→7 |
| Uranium | 11: 1→2; 17: 1→2; 23: 1→3; 28: 1→4; 34: 1→5; 39: 1→6 |
| Green | 13: →1; 18: →2; 22: →2; 27: →3; 33: →4; 37: →4; 44: →5; 50: →6 |

- **The Era III card.**
- **Payday table** (cities powered: dollars): 0: 10, 1: 22, 2: 33, 3: 44, 4: 54, 5: 64, 6: 73, 7: 82, 8: 90, 9: 98, 10: 105, 11: 112, 12: 118, 13: 124, 14: 129, 15: 134, 16: 138, 17: 142, 18: 145, 19: 148, 20 or more: 150.
- **Restock** (coal, oil, waste, uranium):

| Players | Era I | Era II | Era III |
|---|---|---|---|
| 2 | 3, 2, 1, 1 | 4, 2, 2, 1 | 3, 4, 3, 1 |
| 3 | 4, 2, 1, 1 | 5, 3, 2, 1 | 3, 4, 3, 1 |
| 4 | 5, 3, 2, 1 | 6, 4, 3, 2 | 4, 5, 4, 2 |
| 5 | 5, 4, 3, 2 | 7, 5, 3, 3 | 5, 6, 5, 2 |
| 6 | 7, 5, 3, 2 | 9, 6, 5, 3 | 6, 7, 6, 3 |

- **By the number of players:**

| Players | Regions | Out unseen | Station limit | Era II at | End at |
|---|---|---|---|---|---|
| 2 | 3 | 8 | 4 | 10 cities | 21 cities |
| 3 | 3 | 8 | 3 | 7 | 17 |
| 4 | 4 | 4 | 3 | 7 | 17 |
| 5 | 5 | 0 | 3 | 7 | 15 |
| 6 | 5 | 0 | 3 | 6 | 14 |

## Setup
1. Each company takes $50 and 22 substations.
2. The first seat chooses the regions in play for the table (C02): 3, 3, 4, 5 or 5 of them for 2–6 players, touching as one block. Cities of the other regions take no part, and no line may pass through them.
3. The order of the first round is drawn (C05).
4. Stations 3 to 10 form the market: 3–6 on offer, 7–10 coming up. The others but 13 are shuffled; 8, 8, 4, 0 or 0 of them (for 2–6 players) are taken out unseen; 13 goes on top and the Era III card at the bottom.
5. The yard holds coal on every space ($1–$8, 24 units), oil on $3–$8 (18), waste on $7–$8 (6) and uranium on $14 and $16 (2). The rest is the supply.

## A round
Every round has five phases. **Standings** (the new order), then **Auction** in player order, **Fuel** and **Wiring** in reverse order, and **Payday** in player order.

### 1. Standings
The company with the most cities goes first; among companies with as many cities, the one with the highest station. The others follow by the same rule. Round 1 keeps the drawn order for its auction, and the order is worked out again by the stations bought, before the fuel phase.

### 2. Auction
- In player order, a company may put up a station **on offer** (the four lowest in Eras I and II; all of them in Era III) with an opening bid of at least its number, or pass. A company that passes takes no further part in this round's auction. In round 1 every company must buy, so nobody may pass.
- The others then bid **clockwise round the table** from the opener: each bids more than the last bid or folds out of this auction. Nobody bids more money than it has. When one company is left, it pays its bid and takes the station.
- Each company buys **one station a round** at most; after buying it bids no more this round. If the opener did not win, it puts up a station again (or passes). The last company to put up a station gets it at its opening bid.
- After each sale a replacement is drawn from the stack and the market is put in number order again.
- **No sale.** If no station was sold in a round (from round 2), the lowest station of the market leaves the game at the end of the auction and a replacement is drawn.
- **The station limit.** A company that buys a station over its limit (3; 4 with two players) scraps one of its other stations, never the new one. It may move that station's fuel to its other stations as far as they can hold it, and drop the rest, which returns to the supply.

### 3. Fuel
In reverse player order each company may buy fuel once, any mix, the cheapest units of each fuel first, only as much as its stations can hold, paying the yard's prices. A station holds twice its burn of its own fuel; a coal-or-oil station holds either, in any mix. A company may move its fuel between its stations at any time.

### 4. Wiring
In reverse player order each company may wire any number of cities, one at a time, paying for each:
- **the substation:** $10 in an empty city, $15 for the second company in a city, $20 for the third;
- **the lines:** the cheapest route from any city already in its network (cities wired earlier this turn included), through any cities of the regions in play, wired by anyone or not. The first city needs no line.

A city takes one company in Era I, two in Era II and three in Era III. A company is never wired twice to one city, and has 22 substations. Nobody has to wire, in round 1 or later.

### 5. Payday
In player order each company fires any of its stations: each burns exactly its fuel (a coal-or-oil station any mix of the two) and powers its cities, up to the cities the company has wired. The company is paid by the table for the cities it powers ($10 for none). Burnt fuel returns to the supply. Then:
- **Restock.** The yard is refilled by the table for the era, each fuel from its dearest empty space, as far as the supply allows.
- **The market moves on.** In Eras I and II the highest station of the market goes face down under the stack (below the Era III card) and a replacement is drawn. In Era III the lowest station leaves the game and a replacement is drawn.

### Small stations
At any time, a station of the market numbered no higher than the city count of some company leaves the game at once and a replacement is drawn; a replacement that is small too leaves in turn. Stations a company owns are never affected.

## The eras
- **Era I** is the start: one company a city.
- **Era II** begins after the wiring phase in which a company first has 10, 7, 7, 7 or 6 cities (2–6 players): once, the lowest station of the market leaves the game and a replacement is drawn. From then on two companies a city, and the Era II restock.
- **Era III before Era II.** If Era III begins before any company has reached the Era II count, Era II's changes are made first, at once: the lowest station leaves the game and is replaced. Then Era III's changes follow (the 2018 rulebook: "first perform all changes for Step 2 before directly continuing with the changes for Step 3"). In an auction this happens after the auction, before the Era III card leaves with the lowest station; while wiring, at payday, before Era III begins; at payday, after the Era III card and the lowest station leave.
- **The Era III card.** When it is drawn, the stack is shuffled at once: it then holds the stations laid under it at paydays.
  - Drawn in the **auction**: it lies at the end of the market, as the highest card, and cannot be bought; replacements are drawn as usual. After the auction it leaves with the lowest station, without replacements. Era III begins with the fuel phase.
  - Drawn while **wiring** (a small station's replacement, or Era II's): it leaves with the lowest station, without replacements. Era III begins with payday.
  - Drawn at **payday**: it leaves with the lowest station, without replacements. Era III begins with the next round.
- **Era III:** three companies a city, six stations in the market, all on offer, and the Era III restock. If the stack runs out, no replacement is drawn, and payday still takes the lowest station away: the market can shrink to nothing.

## The end of the game
After a wiring phase in which a company has 21, 17, 17, 15 or 14 cities (2–6 players) the game ends. Nobody buys any more. Each company counts the cities it could power with its stations and the fuel on them (no income is paid). The most cities powered wins; a tie goes to the most money, then to the most cities wired; a tie there shares the place.

## Platform rules
- **Regions.** The rulebook has the players choose them together. Here the first seat, the table's creator, chooses for the table, from every set of the right size that touches as one block (12 sets of three, 12 of four, 6 of five), as the game's first decision.
- **The first round's order** is drawn by the dice beacon: one die of 60 faces for each place but the last, each picking evenly among the companies not yet placed.
- **The stations set aside unseen** are the last 8, 8, 4, 0 or 0 cards of the shuffled stack (for 2–6 players): a random choice exactly as taking them out at random is, and nobody ever sees them before the end.
- **Nothing to decide, nothing asked, but only from what everyone can see.** A company that could store none of the fuel the yard holds is passed over in the fuel phase; one that could wire no city whatever its money (no room, no substation, no route) is passed over in wiring; a company with no city, or no station it can fire, is paid $10 without a decision. Money never decides for a company: one that cannot afford a station, a raise, fuel or a city still chooses, and passes, folds or finishes itself, so nothing shows the table what it cannot pay.
- **One fuel purchase a turn:** a company buys all the fuel it wants in one move, or finishes.
- **The final count** is computed: the most cities each company's stations and fuel could power.
- **Money is hidden**: the screen shows each company its own money only, and everyone's at the end (it breaks ties). Every bid, price and payday is still made in the open, as at the table, so a player who keeps careful notes can work out the others' money, as the FAQ says players can at the table; the platform cannot hide a payment that every client must check.

## Rule options
None (`{ rulesVersion: 1 }`).

## OPEN
- **Station 29** powers 4 cities in two of three data sets and 3 in one; the engine uses 4.

## Online play on this site
- **The stack is a real shuffled deck** (`pile`, 34 cards: the green 13 alone in its group, so it lies on top, and the 33 others shuffled by every player's app in the setup phase, with prompt shares under D075). Each draw turns up the stack's next card by a public reveal, which every app shares at once. The Era III card is not a deck card: it comes once the cards to draw before it are gone. When it comes, the stations under the stack are reshuffled at once by a deck epoch (D073), every app shuffling them in turn, and are then drawn the same way.
- **Dice** come from the dice beacon (D058) for the opening order only: every seat's app adds a share, and the faces follow.
- **What is hidden:** the order of the stack, the stations set aside unseen (until the game's secrets are published at the end), and each company's money on the screen.
- **Standings** during the game are the cities each company could power now.
- **Resign** is on at every seat count (D090), with the resigner's deck secret (PROTOCOL §8.3): with two players it is a rated loss; with three or more it ends the game for everyone, unrated, with the resigner last and the others placed by the standings, whatever is pending (a reveal, the Era III reshuffle, the opening roll).

### Actions (one accepted encoding each)
`{type:'regions',actor,regions:[ascending]}` (the first seat, first), `{type:'contribute',actor,id}`, `{type:'open',actor,station,bid}`, `{type:'pass',actor}`, `{type:'bid',actor,amount}`, `{type:'fold',actor}`, `{type:'scrap',actor,station,keep:[coal,oil,waste,uranium]}`, `{type:'fuel',actor,buy:[coal,oil,waste,uranium]}` (not all zero), `{type:'build',actor,city}`, `{type:'done',actor}` (ends a fuel or wiring turn), `{type:'power',actor,stations:[ascending],hybridCoal}`, the beacon's `{type:'rolled',actor:'beacon',id,dice}`, and the deck's `{type:'reveal',actor:'deck',deck:'pile',pos,card}` and `{type:'epoch',actor:'deck',epoch:1,size}`. The legal list offers each station at its number, raises of 1, 5 and 10, a few purchases and the fullest fuel each scrap can keep; `validateIntent` accepts any other legal opening bid, raise, purchase or scrap.

## Verification catalog

#### C01 Setup
Two to six players (one and seven are refused); each company has $50, no stations, no fuel, no cities; the yard holds 24, 18, 6 and 2; the market is 3–10; 13 is on top of the stack and 33 stations are unseen, 25, 25, 29, 33 or 33 of them to be drawn before the Era III card.

#### C02 The regions in play
The first seat chooses one of the sets of 3, 3, 4, 5 or 5 regions that touch as one block, before anything else, and only such a set; no city outside them can be wired, and no line passes through them.

#### C03 The station market
The four lowest stations are on offer in Eras I and II; the market is kept in number order after every draw.

#### C04 The round
A round runs Auction, Fuel, Wiring, Payday, and a new round re-ranks the order.

#### C05 Player order
The opening order comes from the opening roll, after the regions are chosen, evenly; from round 2 the most cities go first, then the highest station; round 1's order is worked out again after its auction, by stations alone.

#### C06 Opening an auction
In player order; only a station on offer; at least its number, at most the company's money; passing ends the company's auction for the round; nobody passes in round 1; a company that can afford no station still decides, and passes.

#### C07 Bidding
Clockwise from the opener; each bid beats the last; a fold leaves that auction only; the last company in pays its bid; a bidder who cannot beat the bid still decides, and can only fold; the last opener gets the station at its opening bid.

#### C08 After a sale
The buyer is done for the round; an outbid opener opens again; a replacement is drawn; an unsold round (round 2 on) loses its lowest station at the end of the auction.

#### C09 The station limit
A fourth station (a fifth with two players) makes its buyer scrap one of the others, never the new one; the fuel it keeps must fit the stations left, and it may drop more.

#### C10 Station kinds
Each station stores twice its burn of its fuel; a coal-or-oil station stores and burns either, in any mix; a green station needs nothing.

#### C11 Small stations
A market station numbered no higher than a company's city count leaves the game at once and is replaced, again if the replacement is small too.

#### C12 Buying fuel
Reverse order; one purchase a turn; the cheapest units first at the yard's prices; never more than the yard holds, the stations hold or the money pays; a company that could store none of the yard's fuel is passed over, one that only cannot pay decides, and finishes.

#### C13 Moving fuel
A company's fuel goes wherever its stations can hold it: coal on coal-or-oil stations frees room for oil on them, and so on.

#### C14 Wiring costs
$10, $15 or $20 for the substation, plus the cheapest lines from the network through cities in play; the first city has no line; cities wired this turn are part of the network.

#### C15 Room in a city
One company a city in Era I, two in Era II, three in Era III; never twice for one company; 22 substations at most; reverse order; a company that could wire no city whatever its money is passed over, one that only cannot pay decides, and finishes.

#### C16 Firing stations
Player order; any stations; exact burns; cities powered up to the cities wired; the fuel burnt leaves the stations; a company with nothing to choose is paid without a decision.

#### C17 The payday table
$10 for no city, up to $150 for 20 or more.

#### C18 Restock
By players and era, from the supply only, each fuel up to its spaces.

#### C19 The market moves on
Eras I and II: the highest station goes under the stack and a replacement is drawn; Era III: the lowest leaves the game and a replacement is drawn.

#### C20 Era II
After the wiring in which a company reaches the Era II count: two companies a city, the lowest station leaves once and is replaced, the Era II restock. If Era III begins first, in each of its three timings, Era II's removal and replacement come just before it, and Era II never begins again.

#### C21 The Era III card
Shuffles the stack at once; in an auction it waits at the end of the market and leaves with the lowest station after the auction; while wiring or at payday it leaves at once with the lowest station; Era III begins as the timing says.

#### C22 Era III
Three companies a city; six stations, all on offer; payday removes the lowest; an empty stack draws nothing and the market shrinks.

#### C23 Unknown stations
The stack is the deck `pile`: 13 on top (position 0), then the shuffled stations; each draw turns up the next position by a public reveal, and only the station at that position; the last 8, 8, 4, 0 or 0 positions are never drawn; after them comes the Era III card, which is no deck card; its reshuffle is a deck epoch of the stations under the stack, whose new positions are then turned up in order; a full state knows the order, a view does not.

#### C24 The end
After the wiring in which a company reaches the end count: no more buying, no income; places by cities powered, then money, then cities wired.

#### C25 Standings
The cities each company could power now, from public data, equal to the final scores at the end.

#### C26 Encoding, rules and views
One accepted encoding for each action, the deck's reveal and epoch included; `validateIntent` accepts any legal opening bid, raise, purchase and scrap and nothing else; the rules are `{ rulesVersion: 1 }`; a view is the whole state but the deck's order; `dealt` lists every position turned up, all to the table; nothing is dealt to one seat or learnt in private.
