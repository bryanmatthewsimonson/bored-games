# Spread Thin rules

**Spread Thin** is a cooperative game for 2–4 players. Four strains are loose across the Wide World, and the players are a team of specialists racing to find all four cures before the strains overrun it. Everyone wins together or loses together. This file is the **source of truth** for the engine in `packages/games/spread-thin`.

Spread Thin uses the mechanics of *Pandemic* (Matt Leacock; Z-Man Games, 2008; second edition 2013) unchanged. The rules prose, the names, the world, the drawing of the map, the cards and the artwork here are all new. This is the only file, with `docs/DECISIONS.md` and the other docs, where the reference game's name may appear (CLAUDE.md, D046). The public site names it only through the exact "Compare to" phrase, stored once in `packages/games/spread-thin/src/compare.ts` (D053, D096).

**Status: beta (D096).** The engine is `packages/games/spread-thin` (engine 0.1.0), where every `#### Cnn` below has a named test in `test/catalog/` (CLAUDE.md, D045). The web game is `apps/web/src/games/spread-thin`, the fuzz target is `spread-thin` (`pnpm fuzz --game spread-thin`), and the e2e spec is `apps/web/e2e/spread-thin.spec.ts`.

## Name, brand and what is original

### The name
- **Spread Thin**: what the strains do across the map, and what the team always is: too few hands for too many places. An everyday idiom, in the pattern of Chain Reaction, Right of Way and Current Affairs. It names neither the reference title nor anything in it.
- **Tagline:** "Four strains, one team, never enough hands. Find the cures before the world runs out of time."
- **Fallback name:** *Fever Pitch*.
- **Clearance (not legal advice).** "Spread thin" is an everyday phrase. This is not a trademark search; as for the other titles, a lawyer must clear the name before release.

### What is the same, and why it may be
Game mechanics, rules as systems and the numbers that are part of a method of play are not protected by copyright (17 U.S.C. §102(b); U.S. Copyright Office circular FL-108). A rulebook's wording, its board art, its card art and its trade dress are, and the title is a trademark. So:

| Kept exactly (mechanics) | Replaced (expression and brand) |
|---|---|
| 48 cities in four regions of twelve, and which cities each of the 93 links joins (the reference board's graph) | every name: the world, its regions and cities, the strains, the roles, the relief cards, the surges |
| 24 case tokens per strain, 6 clinics, 8 spillovers, the spread-rate track 2-2-2-3-3-4-4 | the rules wording (this file is written from scratch) |
| the opening hands (4, 3, 2), 4/5/6 surges in piles, the opening infection 3-3-3/2-2-2/1-1-1 | the map's drawing: a new world, mirrored and redrawn, with invented coastlines |
| the eight actions, the seven roles' powers, the five relief cards' effects | the role cards, the relief cards, the city cards, the tokens, the cover |
| the turn: four actions, two field cards, the spread; surges: rise, strike, restack | the strain colours (teal, amber, violet, moss green) and their marks |
| the hand limit of seven; winning on the fourth cure; the three ways to lose | the cities' populations: invented numbers, ranked as the reference cards rank theirs |

### Glossary
| Spread Thin | Reference game | Engine id |
|---|---|---|
| strain (Tide, Ember, Dusk, Moss) | disease (blue, yellow, black, red) | strains 0–3 |
| case | disease cube | `cases` |
| clinic | research station | `clinics` |
| spillover | outbreak | `spills` |
| spread rate | infection rate | `rate`, `SPREAD_RATES` |
| spread deck, spread card, spent pile | infection deck, infection card, infection discard pile | `pile`, `spent` |
| field deck, field card | player deck, player card | `field`, `hands` |
| relief card | event card | field ids 48–52 |
| surge: rise, strike, restack | epidemic: increase, infect, intensify | `surgeStep` |
| stamped out | eradicated | `stamped` |
| travel, fly, charter, shuttle | drive/ferry, direct flight, charter flight, shuttle flight | action types |
| open a clinic, treat, hand over, find a cure | build a research station, treat disease, share knowledge, discover a cure | action types |
| Archivist, Coordinator, Paramedic, Engineer, Warden, Courier, Virologist | Contingency Planner, Dispatcher, Medic, Operations Expert, Quarantine Specialist, Researcher, Scientist | roles 0–6 |
| Medevac, Early Warning, Field Permit, Lull, Herd Immunity | Airlift, Forecast, Government Grant, One Quiet Night, Resilient Population | reliefs 0–4 |
| Gentle, Standard, Brutal | introductory, standard, heroic | `surges` 4, 5, 6 |

### Brand pack (for the build)
- `gameTitle`: Spread Thin
- `tagline`: "Four strains, one team, never enough hands. Find the cures before the world runs out of time."
- `summary`: "Four strains are loose across the Wide World, and your team of specialists is all that stands in the way. Each turn you travel, treat the sick, open clinics and pool your cards, then watch the spread deck turn up new cases. Let a city pass three cases and it spills over into its neighbours, sometimes in chains. Every few turns a surge strikes and stirs the spent cards back on top. Find all four cures and the team wins together; let the spillovers, the case tokens or the field deck run out and the team loses together. A cooperative game for two to four players."
- `aliases`: cooperative, co-op, outbreak, contagion, cure, disease, medicine, teamwork

## Sources and interpretations

**Sources (research of 2026-10-30, paraphrased, never copied).** The 2013 second-edition English rulebook (Z-Man Games, `zm7101_pandemic_rules.pdf`); a published rules summary for cross-checks; and two independent transcriptions of the board's graph, read as data only: the board-game-analysis count of 93 links, and the city table of the Perl package Games::Pandemic (CPAN, 2011), whose links agree with this file's link for link. BoardGameGeek id **30549** (2008; 2–4 players, 45 minutes, age 8) is the reference's entry. Rules the rulebook states are **verified**. Points it does not settle are **platform** rules or **OPEN** (CLAUDE.md, "Never invent rules").

| Topic | Rule | Basis |
|---|---|---|
| Players | 2 to 4 | verified |
| Edition | the 2013 second edition: seven roles, five relief cards | verified |
| Hands | open: every card is public | platform (C01) |
| Relief timing | only at windows, not at any moment | platform (C23) |
| Tied populations | the earlier seat goes first | platform (C04) |
| The Coordinator's permission, hand-over agreement | the acting player decides | platform (C24, C26) |
| An empty spread deck | the draw is skipped | platform, unreachable in play (C16) |

## The world

The Wide World has 48 cities in four regions of twelve: the Tidelands (strain Tide), the Sunward Reach (Ember), the Dusk Coast (Dusk) and the Mosslands (Moss). A city's own strain is its region's. 93 links join the cities; a link runs both ways, and the world wraps east to west, so three links cross the edge of the map. `src/map.ts` holds the graph and the populations, `src/atlas.ts` the drawing's points, `src/theme.ts` the names. The pawns and the first clinic start in **Glenhallow**.

## Components

- 48 city cards (one per city), 5 relief cards, 4–6 surge cards: the **field deck**.
- 48 spread cards (one per city): the **spread deck**.
- 7 role cards, one pawn per player.
- 96 case tokens, 24 of each strain; 6 clinics; the spillover track (0 to 8); the spread-rate track (2, 2, 2, 3, 3, 4, 4); four cure markers.

## Setup

1. Put a clinic in Glenhallow and every pawn there. Deal each player a role card, face up.
2. Shuffle the spread deck. Turn up nine cards: the first three cities get 3 cases of their own strain each, the next three 2 each, the last three 1 each. These nine cards start the spent pile.
3. Shuffle the 48 city cards with the 5 relief cards and deal the opening hands: 4 cards each with two players, 3 with three, 2 with four.
4. Split the rest into as many piles as there are surge cards (4 Gentle, 5 Standard, 6 Brutal), as equal as possible. Shuffle one surge into each pile and stack the piles, the smaller ones at the bottom.
5. The player holding the city card with the largest population goes first. Play passes in seat order.

## A turn

1. **Four actions.** Any mix, any repeats.
2. **Draw two field cards.** Resolve any surge drawn, then keep the hand limit.
3. **The spread.** Turn up as many spread cards as the spread rate, one at a time, and add a case to each.

### Actions
- **Travel** to a linked city.
- **Fly**: discard a city card to move to that city.
- **Charter**: discard the card of the city you are in to move to any city.
- **Shuttle** from a clinic to any other clinic.
- **Open a clinic** where you stand by discarding that city's card. With all six out, move one from anywhere.
- **Treat**: remove one case of a strain from your city; all of them, once that strain is cured.
- **Hand over**: give the card of the city you both stand in to another player there, or take it from them.
- **Find a cure**: at a clinic, discard five city cards of one strain.

### Surges
Drawing a surge: the spread rate **rises** one step; the bottom spread card **strikes** its city with 3 cases (if the city already holds cases of that strain, it fills up to 3 and spills over); then the spent pile is shuffled and **restacked** on top of the spread deck. A surge leaves the game. Draw no card in its place. Two surges in one draw are resolved one after the other.

### Spillovers
A city that would take a fourth case of a strain spills over instead: the spillover track moves up one, and every linked city takes one case of that strain. A city pushed past three in turn spills over too, but no city spills over twice in one chain.

### Winning and losing
The team wins the moment the fourth cure is found. It loses the moment the eighth spillover happens, a strain needs more cases than its supply holds, or a player must draw two field cards and fewer than two are left.

## Roles

- **Archivist**: as an action, take a relief card from the field discard pile and keep it on the role card (one at a time; not part of the hand). Played from there, it leaves the game.
- **Coordinator**: move other players' pawns as if they were your own, paying for flights with your cards; or, as an action, move any pawn to a city where another pawn stands.
- **Paramedic**: treating removes every case of the strain. Cases of a cured strain are cleared from the Paramedic's city at once, without an action, and none can be placed there.
- **Engineer**: open a clinic without a card; once a turn, from a clinic, move to any city by discarding any city card.
- **Warden**: no case is placed and no spillover happens in the Warden's city or any city linked to it.
- **Courier**: may hand over any city card, not just the one for the city; a player on their turn may take any city card from the Courier.
- **Virologist**: four city cards find a cure.

## Relief cards

Playing a relief card costs no action; it goes to the field discard pile.
- **Medevac**: move any pawn to any city.
- **Early Warning**: look at the top six spread cards and put them back in any order.
- **Field Permit**: open a clinic in any city, without a card.
- **Lull**: skip the next spread step.
- **Herd Immunity**: take a spent spread card out of the game. It may be played between a surge's strike and its restack.

## Platform rules

- **Open hands.** Every card is turned up in public. The 2013 rulebook places no limit on what players say about their cards and asks them to advise each other freely; online, open hands make that advice possible without a chat.
- **Relief windows.** A relief card may be played by its holder at any of their own decisions, and in windows the game opens for every holder: before each spread step, between two surges drawn together, and (Herd Immunity only) between a surge's strike and its restack. Each holder in turn order from the active player plays or passes. The box game allows any moment that is not between drawing and resolving a card; asynchronous play cannot pause after every card, so the windows are the moments the reliefs matter.
- **Consent.** Moving another player's pawn and handing over a card need everyone's agreement at the table; online the acting player decides.
- **Ties for first.** If two opening hands share the largest population, the earlier seat goes first.
- **An empty spread deck.** If a spread card must be drawn and none is left, that draw is skipped. Fuzzing has not reached it.

## Rule options

`surges`: 4 (Gentle), 5 (Standard, the default) or 6 (Brutal).

## OPEN

None.

## Online play on this site

One encrypted deck, `pile`, holds every card: the spread cards, the field cards, the surges and the role cards, each group shuffled by every seat at setup. A second shuffle round mixes each pile of the field deck with its surge, so no deck position shows where a surge lies (D076). Every card is turned up by a public reveal with prompt shares (D075). A restack is a deck epoch (D073). The view is the whole state but the deck order. Resign is on at every seat count (D090): a co-op game ended by a Resign is a loss for the team, and the screen says so with no places (D097).

### Actions (one accepted encoding each)
A player action is accepted exactly when it equals one of `legalActions`: `travel`, `fly`, `charter`, `shuttle`, `summon` (Coordinator) with `{actor, pawn, to}`; `relocate` (Engineer) with `{actor, to, card}`; `clinic` with `{actor, remove}`; `treat` with `{actor, strain}`; `give` `{actor, to, card}`; `take` `{actor, from, card}`; `cure` `{actor, cards}` ascending; `retrieve` `{actor, card}`; `end`; `discard` `{actor, card}`; `pass`; `arrange` `{actor, order}` (cities top first); the reliefs `medevac` `{actor, pawn, to}`, `warning`, `permit` `{actor, city, remove}`, `lull`, `immunity` `{actor, city}`.

## Verification catalog

#### C01 Open information
Every card is turned up in public; a view is the full state without the deck order, and no card is learned privately.

#### C02 The start
Glenhallow holds the first clinic and every pawn; each seat gets a role card, all different.

#### C03 The field deck
Opening hands are 4, 3 or 2 cards each for 2, 3 or 4 players. The rest is split into one pile per surge, the larger piles on top, and each pile's surge may lie anywhere in it.

#### C04 Opening infection and first player
Nine spread cards put 3, 3, 3, 2, 2, 2, 1, 1, 1 cases on their cities and start the spent pile. The holder of the most populous city card goes first (the earlier seat on a tie).

#### C05 Roles
Roles are dealt from the seven role cards; each role's power applies to its holder from the start.

#### C06 Four actions
The active player has four actions and may end the turn early; a relief card costs none.

#### C07 Travel
A pawn travels to any linked city, including across the world's edge.

#### C08 Fly
Discarding a city card moves the pawn to that city.

#### C09 Charter
Discarding the card of the pawn's own city moves it to any other city.

#### C10 Clinics
Opening a clinic takes the card of the city. There is at most one per city and six in all; the seventh moves one.

#### C11 Shuttle
From a clinic a pawn may move to any other clinic.

#### C12 Treat
Treat removes one case; every case of the strain once it is cured.

#### C13 Find a cure
At a clinic, five city cards of one strain (four for the Virologist) cure it. A strain is cured once.

#### C14 Stamped out
A cured strain with no case on the board is stamped out: its spread cards place nothing from then on.

#### C15 Drawing
After the actions the player draws two field cards; with fewer than two left, the team loses.

#### C16 The spread
The spread turns up as many cards as the rate, one at a time, each adding a case of the city's strain, and spends them.

#### C17 Surges
A surge raises the rate, strikes the bottom spread card with three cases (topping up and spilling over if cases are there), and restacks the shuffled spent pile on top. Two surges resolve one after the other.

#### C18 The spread rate
The rate runs 2, 2, 2, 3, 3, 4, 4 and stops at the end.

#### C19 The hand limit
A player over seven field cards discards (or plays reliefs) at once; after a draw, only once its surges are resolved.

#### C20 Spillovers
A fourth case spills over to every linked city; chains follow, and no city spills over twice in one chain.

#### C21 Losing
The eighth spillover, or a strain out of case tokens, ends the game as a loss at once.

#### C22 Relief cards
Medevac, Early Warning, Field Permit, Lull and Herd Immunity do what their text says.

#### C23 Relief windows
Windows open before each spread, between two surges and (Herd Immunity only) before a restack, asking each holder in turn order.

#### C24 Hand over
Two players in one city may pass that city's card between them; the receiver over the limit discards at once.

#### C25 Archivist
The Archivist stores one relief card from the discard pile; played from the role card it leaves the game.

#### C26 Coordinator
The Coordinator moves other pawns as its own with its own cards, or moves any pawn to another pawn.

#### C27 Paramedic
The Paramedic treats a whole strain at once and clears and shields cured strains where it stands, even when moved by others.

#### C28 Engineer
The Engineer opens clinics without cards and once a turn flies from a clinic by discarding any city card.

#### C29 Warden
The Warden shields its city and its neighbours from cases and spillovers, though not the opening infection.

#### C30 Courier
The Courier hands over any city card, and others may take any of its city cards.

#### C31 Virologist
The Virologist needs four cards for a cure.

#### C32 Winning
The fourth cure wins at once, whatever is on the board.

#### C33 Encoding, rules and views
Only the listed encodings are accepted; the rules are `{ rulesVersion: 1, surges }`; views agree with the full state.

#### C34 Standings and the end
Standings are the cures found, the same for every seat; a finished game ranks every seat first, scored by cures.
