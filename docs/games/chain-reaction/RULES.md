# Chain Reaction rules

Chain Reaction implements the mechanics of Sid Sackson's *Acquire*: tile placement, chains, mergers and shares. This file is the **source of truth** for the engine in `packages/games/chain-reaction`. The reference game is named only in documentation; nothing user-facing uses its name, its editions' chain names or its art.

Display names (game title, chain names, colors) live in `packages/games/chain-reaction/src/theme.ts`. This file uses the permanent engine chain ids:

| Tier | Chain ids | Theme names (placeholder) |
|---|---|---|
| Budget | `b1`, `b2` | Jade, Lapis |
| Standard | `s1`, `s2`, `s3` | Onyx, Quartz, Ruby |
| Premium | `p1`, `p2` | Sapphire, Topaz |

## Sources and interpretations

**Sources:**
- The owner-supplied text of the officialgamerules.org Acquire page (updated July 5, 2026); this is the primary reference.
- The project kickoff.
- The owner's answers during planning (2026-10-01).

**Where those sources leave room, we decided as follows:**

| Topic | Decision | Basis |
|---|---|---|
| First player | Closest to 1A comparing **row, then column**: 9A beats 1B, 2A beats 2B. `firstPlayerOrder: 'columnThenRow'` is available. | Reference page examples; owner chose it over the kickoff's column-first convention |
| End declaration | Optional, on your own turn, when an end condition held at the start of the turn or after your placement resolved. The declarer finishes the turn (buys), then the game is scored. | Reference page ("if either condition has been met during your turn… declare… after completing your turn") |
| Ending | The game ends **only** by declaration. There is no stall or timeout ending in the rules. Once the tiles run out, an end condition is always declarable, so a game that does not end is a bug (DECISIONS D015, D016). | Reference page; owner ruling |
| Dead tiles | At the **end of your turn**, every dead tile you held during the turn is revealed, discarded, and replaced. The page says "only once per turn": a replacement that is itself dead waits until the end of your next turn. | Reference page. Literal reading: the tiles you *held during the turn* |
| Blocked tiles | A tile that would found an 8th chain is not dead. You keep it until a chain becomes available. | Reference page |
| No playable tile | Skip placement and still buy. | Kickoff default; consistent with "play one tile each turn, if possible" |
| Bonus splits | Each split portion rounds **up to the next $100** (majority-tie pools and minority ties). | Reference page |
| Defunct ties | Equal-size defunct chains resolve in an order the mergemaker chooses, up front. | Kickoff; the page is silent |
| Same-turn buying | A chain founded this turn can be bought this turn. | Reference page example (one sentence of the page contradicts it) and kickoff |
| Assets | Cash and holdings are public. The engine has no hidden-assets variant (the public move log would reveal them anyway). Bank supply is always public. | Kickoff decision |
| 2 players | **OPEN.** Unsupported; minimum is 3 players. | Not covered by the page |

## Components

- **Board:** 12 columns (1–12) × 9 rows (A–I). There are 108 tiles, one per space, named like `7C` (column 7, row C). Adjacency is orthogonal only.
- **Chains:** seven, in three price tiers. Each has 25 shares.
- **Cash:** each player starts with $6,000. All money is a multiple of $100. There is no borrowing.
- **Players:** 3 to 6.

## Share prices

The price per share depends on the chain's tier and its size in tiles. The majority bonus is 10 × price; the minority bonus is 5 × price.

| Size | 2 | 3 | 4 | 5 | 6–10 | 11–20 | 21–30 | 31–40 | 41+ |
|---|---|---|---|---|---|---|---|---|---|
| Budget | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 |
| Standard | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 | 1100 |
| Premium | 400 | 500 | 600 | 700 | 800 | 900 | 1000 | 1100 | 1200 |

## Setup

1. Each player is dealt one tile, which is revealed and placed on its space. These setup tiles stay **unincorporated** and never form a chain at setup, even when adjacent. They stay on the board and can later be part of a founded chain.
2. The player whose setup tile is closest to 1A goes first (row, then column). Turn order then follows seat order.
3. Each player's hidden hand of 6 tiles is dealt at setup in seat order, before any setup tile is revealed: after the setup tiles, seat 0 takes the next 6 positions of the bag, then seat 1, and so on. The first player does not affect the deal.

## A turn

1. **Place** one tile from your hand on its space. If you hold no playable tile, skip placement.
2. **Buy** 0–3 shares in total, in any mix, of chains on the board. Purchases are limited by bank supply and your cash, at current prices.
3. **End of turn.** Discard and replace any dead tiles you held during the turn, then draw back up to 6 tiles while the bag lasts. Play passes to the next seat.

Placement must happen before buying. You cannot sell shares except during a merger or at final scoring.

## Placement

The effect of a tile depends on its neighbors:

| Neighbors | Result |
|---|---|
| None | **Lone.** The tile sits unincorporated. |
| Only unincorporated tiles | **Founds** a chain. The placer picks any chain not on the board. The chain is the tile plus its whole connected group of unincorporated tiles. The founder receives 1 free share if the bank has one. |
| Exactly one chain (on any number of sides) | **Grows** that chain. It absorbs the tile and every unincorporated tile connected to it. |
| Two or more chains | **Merger** (see below). |

### Tile legality

- A chain of **11+ tiles is safe**. It can never be absorbed, but it can still grow and absorb smaller chains.
- A tile that would merge **two or more safe chains** is **dead**: it is permanently unplayable.
- A tile that would found a chain while all seven chains are on the board is **blocked**: it is unplayable for now and stays in hand.
- Lone, founding, growing and merging tiles are playable.

## Mergers

The player who placed the merging tile is the **mergemaker**.

1. **Survivor.** The largest chain survives. Sizes are compared before the merge; the merging tile does not count. If several chains tie for largest, the mergemaker chooses the survivor. A safe chain is always strictly larger than any unsafe one, so it survives.
2. **Order.** The other chains are **defunct**. They resolve one at a time, largest first. The mergemaker orders equal-size defunct chains up front.
3. **For each defunct chain, in order:**
   1. **Bonuses** are paid at the chain's pre-merger price, using current holdings:
      - The majority holder gets 10× the price; the minority holder (second-largest holding) gets 5×.
      - A sole holder gets both.
      - On a **majority tie**, both bonuses are pooled and split evenly among the tied holders. No minority bonus is paid.
      - On a **minority tie**, the minority bonus is split evenly among those tied.
      - Every split portion rounds up to the next $100.
      - If nobody holds the chain, no bonus is paid. A chain on the board always has a holder, so this happens only through rule variants.
   2. **Disposal.** Starting with the mergemaker and continuing in seat order, each player holding shares of the defunct chain chooses how many to:
      - **sell** at the pre-merger price
      - **trade** at 2 defunct shares for 1 survivor share. The number traded must be even, and the survivor shares received are limited by the survivor's supply in the bank at that moment.
      - **keep.** Kept shares regain value if the chain is founded again.
4. **Completion.** The defunct chains, the merging tile, and any unincorporated tiles connected to it all join the survivor. The defunct chains become available to found again.

## End of game

- **Declaration.** On your turn you *may* declare the end if, at the start of the turn or after your placement resolved, either:
  - any chain has 41+ tiles, or
  - every chain on the board (at least one) is safe.

  You finish your turn (buying), and then the game is scored.
- **No other ending.** Declaration is the only way a game ends. Play continues with players who cannot place a tile still taking their turns to buy shares, until someone declares.
- **Final scoring:**
  1. Each chain on the board pays majority and minority bonuses at its current size, using the same tie rules.
  2. Every share of a chain on the board is sold at its current price.
  3. Shares of chains not on the board are worthless.

  Most cash wins. Tied players share the place.

## Hidden information

Only hands and the bag order are secret. Everything else derives from the public move log: the board, cash, holdings, bank supply, the number of tiles in each hand, and how many remain in the bag. In live play, tiles are dealt as positions in a jointly shuffled encrypted deck (see `docs/ARCHITECTURE.md`):
- A tile's identity becomes public when it is placed, discarded or (for setup tiles) revealed.
- Honesty claims that depend on a hidden hand, such as "I have no playable tile" or "I hold no other dead tile", are checked by the end-of-game audit.

## Rule options (`ChainReactionRules`)

| Option | Default | Notes |
|---|---|---|
| `minPlayers` / `maxPlayers` | 3 / 6 | 2-player is OPEN |
| `handSize` | 6 | |
| `startingCash` | 6000 | |
| `sharesPerChain` | 25 | |
| `maxBuyPerTurn` | 3 | |
| `safeSize` | 11 | |
| `endSize` | 41 | |
| `founderShares` | 1 | |
| `majorityMultiplier` / `minorityMultiplier` | 10 / 5 | |
| `chains`, `priceBrackets`, `tierPrices` | the tables above | |
| `firstPlayerOrder` | `rowThenColumn` | or `columnThenRow` |
| `bonusSplitRounding` | `up100` | |
| `deadTiles` | `endOfTurnOncePerTurn` | |
| `noPlayableTile` | `skipPlacement` | |
| `endDeclaration` | `finishTurn` | |

## Edge-case catalog

Each entry has a named test in `packages/games/chain-reaction/test/catalog/` whose title starts with its id. `catalog-coverage.test.ts` fails if any id below has no test.

**Notation:**
- `s1: 1A-5A` means chain s1 occupies 1A through 5A.
- "Loose" means unincorporated.
- Seats are numbered from 0.
- Prices come from the table above.

### Setup

#### C01 Setup tiles never form chains
**Setup:** Three seats are dealt setup tiles 5C, 6C and 9I.
**Expected:** All three are placed unincorporated. 5C and 6C are adjacent but form no chain.

#### C02 First player is closest to 1A, row then column
**Setup:** Setup tiles are seat 0 3C, seat 1 9A, seat 2 1B.
**Expected:** Seat 1 starts (9A: row A beats row B). Under `firstPlayerOrder: 'columnThenRow'`, seat 2 starts (1B: column 1).

#### C03 Hands are dealt at setup in seat order
**Setup:** Three seats.
**Expected:**
- Seat 0 has deck positions 3–8, seat 1 positions 9–14 and seat 2 positions 15–20. They are assigned at setup, before the setup tiles at positions 0–2 are revealed.
- The first player is still decided by the setup tiles.
- Each hand is hidden from the other players.

### Placement

#### C04 A lone tile stays unincorporated
**Setup:** Place 6F with no neighbors.
**Expected:** 6F is loose. No chain is founded and play moves to buying.

#### C05 Founding next to one loose tile
**Setup:** 1A is loose. Seat 0 places 2A and picks p1.
**Expected:**
- p1 = {1A, 2A}, size 2.
- Seat 0 receives 1 free p1 share (bank 25 → 24).

#### C06 Founding by joining a multi-tile loose group
**Setup:** 1A, 2A and 4A are loose, as is 3C. Seat 0 places 3A and picks s1.
**Expected:**
- s1 = {1A, 2A, 3A, 4A}, size 4.
- 3C is not connected to 3A (3B is empty), so it stays loose.

#### C07 Founder share when the bank has none
**Setup:** s1 is not on the board, but players kept all 25 s1 shares from its earlier life: seat 0 holds 15, seat 1 holds 10. Seat 2 founds s1.
**Expected:** The chain is founded, but no founder share is given; the bank stays at 0.

#### C08 A chain founded this turn can be bought this turn
**Setup:** Seat 0 founds p1 (size 2, price $400) with $6,000.
**Expected:** Seat 0 may buy 3 p1 for $1,200, finishing with 4 p1 shares and $4,800.

#### C09 Growth absorbs loose groups on several sides
**Setup:** b1: 1A-2A. 4A is loose, and 3B and 3C are loose. Place 3A.
**Expected:** b1 = {1A, 2A, 3A, 4A, 3B, 3C}, size 6.

#### C10 A tile touching one chain on two sides grows it once
**Setup:** b1: 1A, 2A, 2B. Place 1B, which touches 1A and 2B, both b1.
**Expected:** b1 grows to 4. There is no merger.

#### C11 A safe chain still grows
**Setup:** s1: 1A-11A (11, safe). 12B is loose. Place 12A.
**Expected:** s1 grows to 13 (12A plus loose 12B).

### Mergers

#### C12 Two-way merger with a clear survivor
**Setup:**
- s1: 1A-5A (5); b1: 7A-9A (3).
- Holdings: b1 seat 0 holds 3, seat 1 holds 2; seat 2 holds 5 s1.
- Seat 2 places 6A.

**Expected:**
- s1 survives and b1 is defunct at size 3 ($300).
- Bonuses: seat 0 gets $3,000 (majority) and seat 1 gets $1,500 (minority).
- Disposal skips seat 2 (no b1 shares), then seat 0, then seat 1.
- Afterwards s1 has 9 tiles and b1 can be founded again.

#### C13 The merging tile is not counted
**Setup:** s2: 1A-10A (10); b2: 12A-12G (7). Place 11A, which touches 10A and 12A.
**Expected:** s2 survives because 10 > 7. The merged s2 has 18 tiles.

#### C14 Tie for survivor: the mergemaker chooses
**Setup:**
- s1: 1A-4A (4); p1: 6A-9A (4).
- Holdings: s1 seat 1 holds 4, seat 2 holds 1; p1 seat 0 holds 2.
- Seat 0 places 5A.

**Expected:**
- Seat 0 must choose s1 or p1; it chooses p1.
- s1 is defunct at size 4 (standard, $500): seat 1 gets $5,000 and seat 2 gets $2,500.
- p1 has 9 tiles.

#### C15 Three-way merger: defuncts resolve largest first
**Setup:** Seat 0 places 5E, touching:
- s1: 5A-5D plus 6A (5)
- p1: 6E-9E (4)
- b1: 2E-4E (3)

**Expected:**
- s1 survives.
- p1 resolves first, at $600 (premium, size 4); then b1, at $300.
- The survivor ends with 5 + 4 + 3 + 1 = 13 tiles and is safe.

#### C16 Four-way merger with all chains tied
**Setup:** Seat 0 places 5E, touching four chains of 3: b1 (5B-5D), b2 (2E-4E), s1 (6E-8E) and s2 (5F-5H).
**Expected:**
- Seat 0 chooses the survivor among all four and picks s2.
- Seat 0 then orders the three tied defuncts and picks s1, b1, b2. Any of the 6 orders is legal.
- s2 ends with 13 tiles.

#### C17 Three-way merger 5/5/5
**Setup:** Seat 0 places 5E, touching three chains of 5:
- b1: 5A-5D plus 4A
- b2: 1E-4E plus 1F
- s1: 6E-9E plus 9F

**Expected:**
- Seat 0 chooses the survivor from all three and picks b1.
- Seat 0 then orders the remaining two defuncts, which are tied, and picks s1 before b2.

#### C18 Three-way merger 5/3/3
**Setup:** As C17, but b2 is 2E-4E (3) and s1 is 6E-8E (3).
**Expected:** b1 survives automatically. The mergemaker orders s1 and b2.

### Bonuses

#### C19 Single majority and single minority
**Setup:** A defunct chain at $300 with holdings 3 / 2 / 0.
**Expected:** $3,000 and $1,500.

#### C20 A sole holder receives both bonuses
**Setup:** A defunct chain at $300 with holdings 0 / 4 / 0.
**Expected:** Seat 1 receives $4,500.

#### C21 Majority tie: bonuses are pooled, with no minority
**Setup:** A defunct chain at $600 (budget, size 6) with holdings 3 / 3 / 1.
**Expected:** Seats 0 and 1 each receive $9,000 / 2 = $4,500. Seat 2 receives nothing.

#### C22 Majority-tie portions round up to $100
**Setup:** A defunct chain at $300 with holdings 2 / 2 / 0.
**Expected:** The pool is $4,500; $2,250 rounds up to $2,300 each.

#### C23 Minority tie: the minority bonus is split, rounding up
**Setup:** A defunct chain at $300 with holdings 5 / 2 / 2.
**Expected:** Seat 0 gets $3,000. The $1,500 minority bonus splits as $750 → $800 each to seats 1 and 2.

#### C24 Three-way minority tie
**Setup:** Four seats, a defunct chain at $200, holdings 4 / 1 / 1 / 1.
**Expected:** Seat 0 gets $2,000. The $1,000 minority bonus splits as $333.33 → $400 each to seats 1, 2 and 3.

#### C25 Three- and four-way majority ties
**Expected:**
- At $300 with holdings 2 / 2 / 2: the $4,500 pool gives $1,500 each.
- At $200 with four seats holding 1 each: the $3,000 pool gives $750 → $800 each.

### Disposal

#### C26 Disposal starts with the mergemaker, in seat order, skipping non-holders
**Setup:** Four seats. The mergemaker is seat 2, which holds no defunct shares; seats 0, 1 and 3 do.
**Expected:** The decision order is seat 3, then seat 0, then seat 1.

#### C27 Sales use the pre-merger price
**Setup:** The defunct b1 had 3 tiles before the merging tile was placed.
**Expected:** Each share sells for $300 (size 3), not $400 (size 4).

#### C28 Trades are two-for-one and must be even
**Setup:** Seat 0 holds 3 defunct shares.
**Expected:**
- A trade of 3 is rejected, and so is selling 2 plus trading 2 (4 > 3 held).
- Trading 2 plus selling 1 is accepted: +1 survivor share, +1 × price.

#### C29 Trades are limited by survivor supply in the bank
**Setup:** The survivor's bank holds 1 share. Seat 0 holds 4 defunct shares.
**Expected:** A trade of 4 is rejected. A trade of 2 is accepted and empties the survivor bank.

#### C30 An earlier defunct can exhaust survivor supply for a later one
**Setup:**
- Three-way merger. The survivor's bank holds 2.
- The first defunct's holder trades 4 for 2.
- The second defunct's holder holds 4 shares.

**Expected:** The second holder can only sell or keep. Its legal trade count is 0, and the disposal reports that supply capped the trade.

#### C31 Sell, trade and keep can be combined
**Setup:** Seat 0 holds 6 defunct shares at $300 with 2+ survivor shares in the bank. Seat 0 trades 4 and sells 1.
**Expected:**
- Seat 0 receives +2 survivor shares and +$300, and keeps 1 defunct share.
- The defunct bank gains 5.

#### C32 Completion: the tile and connected loose tiles join; the defunct chain is foundable again
**Setup:** As C12, with an extra loose tile at 6B, adjacent to the merging tile 6A.
**Expected:** s1 = 5 + 3 + 6A + 6B = 10 tiles. b1 has no tiles and appears among the chains available to found.

### Safe, dead and blocked tiles

#### C33 Safe plus unsafe merger: the safe chain survives
**Setup:** s1: 1A-11A (11, safe); b1: 11C-11E (3). Place 11B.
**Expected:** s1 survives with 15 tiles.

#### C34 A tile touching two safe chains is dead
**Setup:** s1: 1A-11A (11) and p1: 1C-11C (11). 5B touches both.
**Expected:** Placing 5B is rejected as unplayable. 5B is not among the legal placements.

#### C35 An eighth-chain tile is blocked until a merger frees a chain
**Setup:**
- All seven chains are on the board in pairs: b1 1A-2A, b2 4A-5A, s1 7A-8A, s2 10A-11A, s3 1C-2C, p1 4C-5C, p2 7C-8C.
- 12I is loose.
- Seat 0 holds 12H and 3A.

**Expected:**
- 12H is blocked, so only 3A is a legal placement.
- After 3A merges b1 and b2, 12H can found a chain again.

#### C36 Every tile in hand is unplayable: skip placement, still buy
**Setup:** s1: 1A-11A and p1: 1C-11C. Seat 0 holds only dead tiles 2B-7B.
**Expected:**
- The only legal placement action is to skip. Placing any of the tiles is rejected.
- Seat 0 may still buy shares.
- At the end of the turn all 6 tiles are discarded and 6 replacements are drawn.

#### C37 Skipping placement is rejected while a playable tile is held
**Expected:** A skip with any playable tile in hand is rejected.

#### C38 Dead tiles are discarded at the end of the turn and replaced
**Setup:** Seat 0 holds dead 5B and other playable tiles.
**Expected:**
- Ending the turn without listing 5B is rejected.
- Listing it moves 5B to the discard pile. The hand is refilled to 6 from the next deck positions.

#### C39 A dead replacement waits until the end of the next turn
**Setup:** As C38, but the next tile in the bag is 6B, which is also dead.
**Expected:**
- 6B is drawn as a replacement and kept this turn.
- At the end of seat 0's next turn it must be discarded.

#### C40 A tile that dies during the turn is discarded at the end of the same turn
**Setup:**
- s1: 1A-11A (safe); p1: 1C-10C (10).
- Seat 0 holds 5B, which can still merge because p1 is unsafe, and 11C.
- Seat 0 places 11C, making p1 safe.

**Expected:** 5B is now dead and must be discarded at the end of this turn.

#### C41 A chain refounded while players hold old shares
**Setup:** b1 is not on the board. Seat 1 kept 5 b1 shares (bank 20). Seat 0 founds b1.
**Expected:**
- Seat 0 receives the founder share (bank 19).
- Seat 1's 5 kept shares are worth the new chain's price again.

### Buying

#### C42 At most 3 shares per turn, in any mix
**Expected:**
- Buying b1, b1, p1 is accepted.
- Buying 4 shares is rejected.

#### C43 Purchases are limited by bank supply
**Setup:** The b1 bank holds 1.
**Expected:** Buying 2 b1 is rejected; buying 1 is accepted.

#### C44 Purchases are limited by cash at current prices
**Setup:** b1 has size 2 ($200) and p1 has size 2 ($400).
**Expected:**
- With $900: b1, b1, p1 ($800) is accepted; p1, p1, p1 ($1,200) is rejected.
- With $1,200: p1, p1, p1 leaves exactly $0.

#### C45 Only chains on the board can be bought
**Setup:** Seat 0 holds kept shares of inactive p2.
**Expected:** Buying p2 is rejected.

#### C46 Purchases have one canonical encoding
**Expected:** `buy: ["p1","b1"]` is rejected; `["b1","p1"]` is accepted.

### End of game

#### C47 A chain of 41+ tiles enables the declaration; final liquidation
**Setup:**
- s1 has 41 tiles; b1 has 2.
- Everyone has $1,000.
- Holdings: seat 0 holds s1 10; seat 1 holds s1 5 and b1 2; seat 2 holds b1 1 and kept p2 3, with p2 not on the board.
- Seat 0 declares.

**Expected:**

| Seat | Bonuses | Sales | Final cash |
|---|---|---|---|
| 0 | s1 majority $11,000 | $11,000 | **$23,000** |
| 1 | s1 minority $5,500 and b1 majority $2,000 | $5,500 + $400 | **$14,400** |
| 2 | b1 minority $1,000 | $200 | **$2,200** |

- Seat 2's p2 shares are worthless and stay held.
- Places are 1, 2, 3.

#### C48 All active chains safe enables the declaration; an empty board does not
**Expected:**
- With only s1 (11) and p1 (11) on the board, declaring is legal.
- With no chain on the board, declaring is rejected.

#### C49 Declaring is optional
**Setup:** An end condition holds and the player does not declare.
**Expected:** The next turn begins.

#### C50 A condition seen at the start of the turn stays declarable
**Setup:**
- At turn start only s1 (11) and p1 (11) are on the board (all safe).
- The player founds b1 (size 2), so not every chain is safe anymore.
- The player buys 1 b1 and declares.

**Expected:** The declaration is legal. The purchase happens first, then final scoring includes b1.

#### C51 Tied final cash shares the place
**Expected:** Two players finishing with equal cash both get place 1; the next player gets place 3.

#### C52 The game ends only by declaration
**Setup:**
- The bag is empty and all hands are empty.
- s1 (11 tiles) is the only chain, so the all-safe condition holds.
- All three seats skip placement and end their turns without declaring.

**Expected:**
- The game is not over; it is seat 0's turn again.
- When seat 0 then declares, the game ends with reason `declared`.
- A `stallRule` option is rejected as an unknown rule.

#### C53 The bag can empty partway through a refill
**Setup:** One tile is left in the bag. A player ends their turn holding 4 tiles.
**Expected:** They draw the 1 remaining tile and finish with 5.

### Hidden information and integrity

#### C54 Each view hides other players' hands
**Expected:**
- In seat 0's view, only seat 0's tiles can be known. Opponents' slots have no identity, and the deck order is absent.
- A spectator view knows no hand tiles.
- A player has no legal placement until their own tiles are learned.

#### C55 A placement reveals a hidden tile; conflicting claims are rejected
**Expected:**
- When an opponent places a tile, the viewer's state removes that hand slot and shows the tile on the board.
- A claim of a tile already known elsewhere (on the board, in the discard pile, or in the viewer's own hand) is rejected as a conflict.

#### C56 Redaction is idempotent and replay-consistent
**Expected:**
- `view(view(s, v), v)` equals `view(s, v)`.
- Replaying the public log plus seat v's learned tiles reproduces `view(s, v)`.

#### C57 Malformed or non-canonical actions are rejected
**Expected:** Each of these is rejected:
- extra keys
- the wrong actor
- unknown chain ids
- non-integer counts
- out-of-order discards
- reveals out of position order
- in full mode, a reveal that disagrees with the deck

#### C58 Wrong seat or wrong phase
**Expected:** Each of these is rejected:
- acting out of turn
- disposing for someone else
- choosing a survivor when there is no tie
- ordering defuncts when there is no tie
- buying before placing

## Open questions

- **Q1. Two-player rules.** Some editions add special rules for 2 players. Unsupported until the owner decides.
- **Q2. Abandonment.** What happens when a player stops taking turns: forfeit policy, timeouts and rating treatment. This is a platform question for the protocol phase; see `docs/PLAN.md`.
