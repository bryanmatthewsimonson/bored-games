# Driftwrights
*Raise a haven. Weave a network. Weather the rivalry.*

An independently illustrated prototype for 3–4 players. Rules target: the classic 3–4 player base-game mechanics, with separate trading and construction phases. No expansion rules apply.

Driftwrights implements the classic base-game mechanics of *Catan* (Klaus Teuber, 1995) under original names, rewritten rules and floating-island artwork. The public catalog names the reference game only through the exact comparison phrase stored once in `packages/games/driftwrights/src/compare.ts`, linked to BoardGameGeek 13 (D080).

**Implementation status:** the decentralized module and production browser board implement this ruleset; local release checks passed as recorded in [IMPLEMENTATION.md](IMPLEMENTATION.md). Online tables use the illustrated classic layout.

## 1. Your aim
Floating islands hold the supplies your community needs. Establish hearths where island corners meet, join them with sky links, and expand hearths into hubs. Trade with rivals and trading moorings to obtain what you lack. The first player with at least 10 prestige **during their own turn** wins immediately.

Hearths are worth 1 prestige each; hubs are worth 2 each in total. Each landmark venture is worth 1. The Grand Span and Stormwatch awards are each worth 2. Hidden landmark points count toward your total.

## 2. Components
Use 19 island tiles: 4 Timber, 3 Clay, 4 Fiber, 4 Grain, 3 Metal and 1 Still Air. The Still Air island produces nothing. There are 18 yield markers: one 2, one 12, and two of each 3, 4, 5, 6, 8, 9, 10 and 11. There is no 7 marker.

Use 95 supply cards, 19 per resource. Shuffle a separate deck of 25 ventures: 14 Gale Guides, 2 Twin Links, 2 Supply Windfalls, 2 Guild Requisitions and 5 different landmarks. Include 9 trading moorings: four general 3:1 moorings and one 2:1 mooring for each resource.

Each player has 15 sky links, 5 hearths and 4 hubs. Also use one Squall marker, two ordinary six-sided dice, two award cards and four cost references. The print kit supplies flat substitutes for the playing pieces; provide your own dice.

## 3. Prepare the sky
Arrange the islands in rows of 3, 4, 5, 4 and 3. Adjacent islands share their full edges. Sites are the corners of this layout; lanes are its edges. The resulting network has 54 sites and 72 lanes, including perimeter lanes. Nothing may be built in an island's interior.

For a first game, use the illustrated sample map. It is a new map, not a recreation of another game's beginner illustration. For variable setup, shuffle the island types into the same 19 positions. Beginning at any outer corner, place yield markers clockwise in a continuous inward spiral, skipping Still Air, in this order: **5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11**. The sample map's A–R letters identify this sequence. Still Air receives no yield marker. Keep the nine marked mooring locations; randomly assign the nine mooring types to them for a variable game. Each mooring serves exactly the two endpoints of its marked perimeter lane.

Place the Squall on Still Air. Sort supply cards into five face-up banks and shuffle ventures face down. Put awards within reach. Choose player colors; unused colors stay out of play. All players roll both dice; the player with the highest total goes first, rerolling a tie.

### Claim starting sites
Starting with the chosen player and moving clockwise, each player places one hearth on a legal vacant site, then one sky link on a lane touching that hearth. After the last player places, reverse the order: that player places their second hearth and adjoining link first, and the original starting player places last. Thus four-player placement is A–B–C–D–D–C–B–A.

**Spacing:** a hearth site and every neighboring site one lane away must be free of all hearths and hubs, including your own. This restriction applies during setup and throughout play. Your second hearth need not connect to your first; the adjoining starting link must touch the hearth just placed. Starting pieces cost no cards.

After placing your second hearth, collect one supply card from each resource island touching it. Still Air gives none. You begin with 2 prestige. The original starting player takes the first turn; turns then move clockwise.

## 4. Take a turn
Your turn has three stages: **produce, trade, construct**. You may play one eligible action venture at any point in your turn, including before rolling; venture timing is explained below.

### Produce
Roll both dice and add them. On any total other than 7, every unblocked island with that number produces. All players collect simultaneously: one card of that island's resource per adjacent hearth, or two per adjacent hub. Multiple buildings and matching islands can produce in the same roll. The island occupied by the Squall produces nothing, even if its number matches.

The supply banks are finite. If more than one player should collect a resource and the bank cannot meet the entire demand, nobody collects that resource from that roll. Other resource types still pay normally. If only one player is entitled to the scarce resource, that player takes as many cards as remain, even if fewer than their entitlement.

### A roll of 7
No islands produce. Every player holding **more than seven supply cards** chooses half of those cards, rounding down, and returns them to the banks. For example, nine cards require a discard of four. Ventures never count toward this limit.

Once all discards are complete, move the Squall to any **different** island, including Still Air if you wish. Choose one rival with a hearth or hub touching its new island and take one random supply card from that player's concealed hand. You choose the rival, not the card. If no adjacent rival has a supply card, take none. Multiple buildings do not increase the theft. The Squall stays there and blocks only that island until moved again. Continue your trade and construction stages normally.

### Trade
You may negotiate exchanges of supply cards with any rivals. Every exchange must include the active player; rivals cannot trade with one another during your turn. Complete exchanges immediately. Do not exchange ventures, awards or pieces, give resources away for nothing, or exchange a resource type for itself. Both sides must offer actual supply cards; future promises are not enforceable game transactions.

You may also exchange with the banks. Normally return four identical supply cards to take one available supply card of a different type. Owning a hearth or hub on either endpoint of a general mooring improves this to three identical cards for one. At a specific mooring, return two cards of its named resource for one available card of another type. Its discount applies only to that resource. A link alone does not grant mooring access, and discounts do not combine.

### Construct
Return costs to the banks and place pieces or draw ventures. Make as many purchases as you can afford, in any order. Once you start this stage, trading is finished for this turn under the core sequence used here.

| Purchase | Cost | Result |
|---|---|---|
| Sky link | 1 Timber + 1 Clay | Occupy one eligible lane |
| Hearth | 1 Timber + 1 Clay + 1 Fiber + 1 Grain | Occupy one eligible site; 1 prestige |
| Hub | 2 Grain + 3 Metal | Replace your hearth; 2 prestige total |
| Venture | 1 Fiber + 1 Grain + 1 Metal | Draw the top hidden venture |

A new link must connect to your existing link, hearth or hub, and its lane must be vacant. You cannot extend your links through a site occupied by a rival's hearth or hub. Your own buildings allow your links to connect through them. Perimeter lanes are valid.

A new hearth must touch one of your links and obey spacing. A rival's nearby link does not reserve a vacant site: you can build there if your own connection and spacing allow it. Your hearth may interrupt a rival's continuous route.

A hub must replace one of your hearths at the same site. Return that hearth to your unused pieces. The hub doubles that site's production and replaces its one point with two; it does not add two points to the old one.

Piece counts are hard limits. If you lack an unused piece of a type, you cannot build it. Built links and hubs cannot be moved, dismantled or exchanged. Returned hearths can be reused. If ventures run out, no further ventures can be bought. Purchased ventures stay secret and never return to the purchase deck.

## 5. Ventures
An **action venture** is a Gale Guide, Twin Links, Supply Windfall or Guild Requisition. You may play at most one action venture during your turn. It must have been bought on an earlier turn. Keep this turn's purchases apart to remember which are ineligible. You may buy any number of ventures you can afford. Ventures cannot be traded or given away.

**Gale Guide (14):** move the Squall to a different island and take one random supply from one eligible neighboring rival, exactly as in the movement/theft part of a 7. Nobody discards cards. Leave this card face up in front of you; its count contributes to Stormwatch.

**Twin Links (2):** place two links without paying resources, or one if your remaining pieces or legal placements permit only one. Each placement must independently meet normal link rules. Your first new link can enable the second. You cannot play this card if you cannot place any link. Recalculate Grand Span afterward.

**Supply Windfall (2):** collect two available supply cards from the banks, either the same type or two different types. If your first choices are unavailable, choose available alternatives; the card cannot create extra supply cards. When fewer than two cards remain across the entire bank, the default table option takes all that remain, including zero. The alternative option requires two available supplies before playing this venture. The publisher's general shortage rule supports taking the remainder, but applying it specifically to this venture is an inference rather than an explicit clarification; the table records its chosen interpretation. In all ordinary cases both options require exactly two cards.

**Guild Requisition (2):** name one resource. Every rival transfers all supply cards of that type in their hand to you. Their mooring access gives no protection. The banks are unaffected.

After resolving any of those three non-Guide actions, put the card in a used pile outside the game. Gale Guides instead remain visible with their owner.

**Landmarks (5):** the Cloud Archive, Wind Conservatory, Sky Observatory, Beacon Hall and Commons Pavilion each add one hidden prestige. They have no action effect and are not built on the map. Keep them concealed until you reveal enough points to win on your own turn. They are exempt from the one-action limit and purchase-turn delay: a newly purchased landmark can complete your winning total immediately.

## 6. Awards and victory
### Grand Span — 2 prestige
The first player with a continuous route of at least five links claims this award. A challenger must have a strictly longer route to take it; an equal length leaves it with its current holder.

Measure a single continuous trail, counting each lane at most once. At a fork, follow one continuation rather than adding every branch. Loops can count, but no link may be counted twice. A trail may revisit a site through different unused links. Your buildings do not break your trail; a rival's hearth or hub prevents it from continuing through that site, though the trail may end there.

If a building splits a route, recalculate. The holder keeps the award if still tied for the longest qualifying route. Otherwise a unique longest route of at least five gains it. If other players tie for longest after the holder loses eligibility, or nobody has five links, return the award to the table until a unique qualifying leader emerges. The loss or transfer changes prestige immediately.

### Stormwatch — 2 prestige
The first player with three played Gale Guides claims this award. Another player takes it only after playing strictly more Guides than its holder. Unplayed Guides do not count, and a tie leaves the award in place.

### Finish
At any moment in your turn when your buildings, held awards and landmarks total at least 10 prestige, you win. Reveal hidden landmarks as needed to demonstrate the total. You may win before rolling, after playing a Guide or immediately after buying a landmark. Reaching 10 outside your turn does not end the game; you must still have at least 10 when your own turn arrives. There is no final equal-turn round.

## 7. Table reminders
Supply identities are hidden, but their count must be answered truthfully when asked. Keep venture identities concealed until used or revealed for victory. A 7 can cause discards even if a Guide moved the Squall earlier in that turn. Moving the Squall does not forbid trading or spending the blocked resource. Awards give points, not extra production.

The classic game also permits an experienced-player option: after production, alternate trades and purchases freely, including use of a newly obtained mooring. Agree before starting if you want that published-style variant. The core rules above keep those stages separate.

## 8. Print and assemble
Print cards and token sheets on US Letter paper at 100% scale. Cut on the outer rectangles and hex outlines. Print card backs only if desired; opaque sleeves with spare playing cards are the easiest way to hide faces and equalize thickness. Resource backs and venture backs are intentionally different; every venture back is identical to the other ventures.

The full map is 12 × 12 inches. Use the four-page Letter poster file for ordinary printers: cut along its square crop boundaries, then join quadrants to form the map. Keep dotted edge lanes and corner sites visible. Use the sample map for your first game. For variable games, cover the map's terrain and yield art with the separate island tiles and number markers; the mooring markers can likewise cover the sample labels.

Glue flat tokens to card stock for durability. Put hearths and hubs on sites; put links along lanes, rotating to align with the lane. Do not put link tokens on sites. Resource/development counts, board connectivity and component quantities were checked digitally; physical playtesting and legal clearance remain outstanding.


## Engine verification catalog

#### C01 validates seats, terrain counts and venture permutation

Verified by the corresponding reference-engine test.

#### C02 preserves the 19-region, 54-site, 72-lane network

Verified by the corresponding reference-engine test.

#### C03 highest starting roll wins and tied leaders reroll

Verified by the corresponding reference-engine test.

#### C04 setup uses forward then reverse placement without costs

Verified by the corresponding reference-engine test.

#### C05 hearths require vacant neighboring sites, including own buildings

Verified by the corresponding reference-engine test.

#### C06 starting supplies come only from the second hearth

Verified by the corresponding reference-engine test.

#### C07 production pays every adjacent hearth and twice per hub

Verified by the corresponding reference-engine test.

#### C08 the Squall blocks only its occupied island

Verified by the corresponding reference-engine test.

#### C09 scarce production cancels multi-player demand but partially pays a sole claimant

Verified by the corresponding reference-engine test.

#### C10 a seven discards only hands over seven, rounding down

Verified by the corresponding reference-engine test.

#### C11 the Squall must move and theft targets must border its new island

Verified by the corresponding reference-engine test.

#### C12 theft maps each uniformly selected slot to exactly one owned resource

Verified by the corresponding reference-engine test.

#### C13 bank trading consumes matching supplies and checks stock

Verified by the corresponding reference-engine test.

#### C14 moorings require a hearth or hub on either marked endpoint

Verified by the corresponding reference-engine test.

#### C15 negotiated exchanges transfer only supplies after the partner accepts

Verified by the corresponding reference-engine test.

#### C16 construction recipes and finite piece limits are enforced

Verified by the corresponding reference-engine test.

#### C17 new links connect to the owner and cannot extend through rival buildings

Verified by the corresponding reference-engine test.

#### C18 a hub replaces an owned hearth and frees its piece

Verified by the corresponding reference-engine test.

#### C19 ventures draw the next shuffled card and cannot exceed 25

Verified by the corresponding reference-engine test.

#### C20 one action venture per turn and no play on its purchase turn

Verified by the corresponding reference-engine test.

#### C21 Gale Guides move the Squall without forcing discards and can precede the roll

Verified by the corresponding reference-engine test.

#### C22 Twin Links places two free connected links or one when only one remains

Verified by the corresponding reference-engine test.

#### C23 Supply Windfall takes exactly two available cards of either type

Verified by the corresponding reference-engine test.

#### C24 Guild Requisition collects every rival card of its named resource

Verified by the corresponding reference-engine test.

#### C25 landmarks count immediately but have no playable action

Verified by the corresponding reference-engine test.

#### C26 Grand Span requires five links and incumbent ties retain it

Verified by the corresponding reference-engine test.

#### C27 trail counting handles loops and stops at rival sites

Verified by the corresponding reference-engine test.

#### C28 Stormwatch requires three played Guides and changes only to a larger count

Verified by the corresponding reference-engine test.

#### C29 ten points end only on the owner turn, including a newly bought landmark

Verified by the corresponding reference-engine test.

#### C30 apply rejects noncanonical encodings and never mutates its input

Verified by the corresponding reference-engine test.

#### C31 owner views hide all other hands and the future venture order

Verified by the corresponding reference-engine test.

#### C32 complete three and four player games conserve resources and replay exactly

Verified by the corresponding reference-engine test.

#### C33 a table chooses how Supply Windfall handles fewer than two supplies in the bank

Verified for both options, including a bank containing one supply or none. See the interpretation note in §5.
