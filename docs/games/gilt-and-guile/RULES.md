# Gilt & Guile

An original theatre-company theme implementing the complete **Dominion second-edition base-game catalog**: 26 kingdom cards plus seven basic cards. Ten kingdom piles are chosen for each table. Expansion cards and the six retired first-edition cards are not part of this edition. This document is the rules source of truth; all public names, prose, and SVG artwork are independently created. No name-clearance conclusion is asserted.

## Setup and goal

Two to four players compete for acclaim. Each starts with seven Pennies and three Playbills, shuffled into a ten-card deck; draw five. Seating determines the first player. A table chooses exactly ten distinct company piles, either from a curated preset or individually. An empty rules object selects First Performance. Unselected piles never count as empty supply piles.

Use ten cards per action pile. Victory piles, including Repertoire when selected, contain eight cards for two players or twelve for three/four. The supply has 60 Pennies less the seven per player, 40 Banknotes, 30 Endowments, and ten Scandals per opponent. The seven basic piles are always present. Unused cards and starter packets remain outside play.

## Turn sequence

1. Begin with one action, one buy, and zero coins. Spend an action to play an action from hand; finish every instruction before continuing. Bonuses add to the current turn's resources.
2. When finished with actions, play any treasures in any order. Penny provides one coin, Banknote two, Endowment three. Proceeding to buying closes treasure play.
3. Each purchase spends one buy and the printed price. Take a card from a nonempty supply pile. You may stop without buying, and may buy zero-cost cards or Scandals.
4. Discard the hand and all cards in play, then draw five. The turn is now complete. Unspent actions, buys, and coins do not carry over.

Gains normally go to discard and spend neither a buy nor coins. An effect may specify hand or deck instead. Trash removes a card permanently. Resolve instructions in order and as far as possible. A gain with a ceiling can choose a cheaper card. A mandatory trash requires a card when one is available; optional trashes may be declined.

Only shuffle a discard when an instruction needs cards from an empty deck. Keep partially drawn cards out of that shuffle. If both zones are empty, draw fewer. Putting a card onto a deck never causes an early shuffle.

## Complete card mapping and independently written effects

Reference names occur only in this developer documentation. Public navigation uses the single approved “Compare to Dominion” phrase, linking to [BoardGameGeek 36218](https://boardgamegeek.com/boardgame/36218).

| Original card | Reference card | Cost | Effect |
| --- | --- | ---: | --- |
| Penny | Copper | 0 | Provides 1 coin when played. |
| Banknote | Silver | 3 | Provides 2 coins when played. |
| Endowment | Gold | 6 | Provides 3 coins when played. |
| Playbill | Estate | 2 | Worth 1 acclaim at the end. |
| Playhouse | Duchy | 5 | Worth 3 acclaim at the end. |
| Grand Stage | Province | 8 | Worth 6 acclaim at the end. |
| Scandal | Curse | 0 | Lose 1 acclaim at the end. |
| Rehearsal | Cellar | 2 | +1 action. Discard any number of cards, then draw that many. |
| Arcade | Market | 5 | Draw 1. +1 action, +1 buy, +1 coin. |
| Impresario | Merchant | 3 | Draw 1. +1 action. The first Banknote you play this turn provides an extra coin. |
| Rivalry | Militia | 4 | +2 coins. Each opponent discards down to 3 cards. |
| Investor | Mine | 5 | You may trash a treasure from your hand. If you do, gain a treasure costing up to 3 more into your hand. |
| Understudy | Moat | 2 | Draw 2. You may reveal this from your hand to ignore an attack on you. Keep this card in your hand. |
| Renovation | Remodel | 4 | Trash a card from your hand, then gain a card costing up to 2 more. |
| Script Room | Smithy | 4 | Draw 3 cards. |
| Ensemble | Village | 3 | Draw 1. +2 actions. |
| Propmaker | Workshop | 3 | Gain a card costing up to 4. |
| Costumier | Artisan | 6 | Gain a card costing up to 5 into your hand. Then put a card from your hand on top of your deck. |
| Headliner | Bandit | 5 | Gain an Endowment. Each opponent reveals their top 2 cards, trashes one revealed treasure other than a Penny if possible, and discards the rest. |
| Booking Office | Bureaucrat | 4 | Gain a Banknote onto your deck. Each opponent puts a victory card from their hand onto their deck, showing it. Anyone without one reveals their hand. |
| Cutting Room | Chapel | 2 | Trash up to 4 cards from your hand. |
| Opening Night | Council Room | 5 | Draw 4. +1 buy. Each opponent draws 1 card. |
| Gala | Festival | 5 | +2 actions. +1 buy. +2 coins. |
| Repertoire | Gardens | 4 | Worth 1 acclaim for every complete 10 cards you own. Count all zones at the end. |
| Encore | Harbinger | 3 | Draw 1. +1 action. You may put a card from your discard pile onto your deck. |
| Duet | Laboratory | 5 | Draw 2. +1 action. |
| Reading Room | Library | 5 | Draw until you have 7 cards in hand. You may set aside action cards as you draw them; discard those set aside after you finish. |
| Cashbox | Moneylender | 4 | You may trash a Penny from your hand. If you do, +3 coins. |
| Audition | Poacher | 4 | Draw 1. +1 action. +1 coin. Discard one card per empty supply pile. |
| Stage Door | Sentry | 5 | Draw 1. +1 action. Look at the top 2 cards of your deck. Trash any, then discard any, then return the rest in your chosen order. |
| Double Bill | Throne Room | 4 | You may play an action card from your hand twice. Fully finish its first play before its second. |
| Busker | Vassal | 3 | +2 coins. Discard the top card of your deck. If it is an action, you may play it. |
| Critic | Witch | 5 | Draw 2. Each opponent gains a Scandal. |

## Timing and choices

- Attack victims respond in seating order. Each attack offers an Understudy reaction before it affects that victim; revealing it spends neither the card nor an action. A repeated attack gives a new reaction opportunity. Opening Night is not an attack.
- Headliner's victim chooses which eligible revealed treasure to trash. If none is eligible, discard both revealed cards. Penny is never an eligible trash for this attack. Empty Endowment supply does not prevent the attack.
- Booking Office accepts any victory card, including Repertoire. A victim without one reveals their whole hand. Costumier's hand-to-deck choice, unlike Booking Office's, stays private.
- Double Bill plays one chosen action twice without spending additional actions. Complete its first resolution before its second. Nested Double Bills can choose different actions on each resolution. The chosen action enters play only once. Every Impresario play independently adds a bonus to the first Banknote played that turn.
- Reading Room considers newly drawn cards one at a time. Actions may be set aside privately; these cannot be shuffled during this effect. On reaching seven cards or exhausting deck and discard, publicly discard all set-aside cards. A player already holding seven draws nothing.
- Stage Door privately inspects up to two cards after its ordinary draw. Finish optional trashes, then optional discards, then order the survivors. The UI selects bottom first, top last. Returned private identities stay private, and a later draw by their owner preserves their knowledge.
- Audition counts only active empty supply piles, after its draw. Discard as many as required, or the entire hand if shorter.
- Busker reveals and discards its top card; if it is an action, it may move into play and resolve without an action cost.
- All discards are public, including end-of-turn cleanup and Reading Room set-asides. Other hands and unexposed inspected cards remain private. A known card placed on a deck remains known until reshuffled.

## Ending and scoring

After completing the current turn, end if Grand Stage is empty or any three active supply piles are empty. Do not give an equalizing round. Count every owned card in every zone. Playbill is 1 acclaim, Playhouse 3, Grand Stage 6, Scandal −1. Each Repertoire scores floor(total cards owned / 10), counting itself. Higher acclaim ranks first; ties favor fewer completed turns, otherwise tied places are shared. Scores are computed from public ownership counts, not private hand identities.

## Online implementation

The encrypted opening packet contains 498 cards in 37 independent partitions: four starter groups and 33 supply types. Only selected piles are playable. Personal discard reshuffles use existing proof-backed epochs with stride 512, avoiding aliasing with the opening packet. Gains reveal their supply identities. Cleanup and other explicit public reveals append public assignments to the existing dealt log before requesting decryption. A requested card remains hidden from other views until the reveal resolves. This uses the standard prompt-share and saved-share vetting flow; a public position is never privately reassigned. Prompt shares are enabled under D075. Resign is disabled because releasing a deck secret early requires a separate analysis.

Reading Room set-aside and private top-deck choices encode positions without identities. Hidden eligibility is checked by full-state replay at audit. Existing peer-based dealing limitations remain; this adds no trusted referee. Public reveal claims are checked cryptographically. State and transitions remain pure JSON and never depend on UI decisions or external randomness.

The central table contains the supply, played cards, decisions, and private hand. Scores, player discard inspection, and the journal occupy the right sidebar on desktop and stack below on mobile. Original SVG illustrations are CC0-1.0. Catalog status is experimental. Its own BoardGameGeek ID and year are null because it has no independently published entry; comparison metadata carries the reference ID.

## Rules test catalog

#### C01 starts each player with seven resources, three landmarks, and five cards in hand
Verified by the corresponding catalog test.

#### C02 sizes the supply for two, three and four players
Verified by the corresponding catalog test.

#### C03 enforces action, treasure and buy phases and exact encodings
Verified by the corresponding catalog test.

#### C04 buys spend coins and buys and put the gained card into discard
Verified by the corresponding catalog test.

#### C05 cleanup discards hand and play, draws five, and resets the next turn
Verified by the corresponding catalog test.

#### C06 reshuffles only when drawing requires it and uses nonoverlapping epoch positions
Verified by the corresponding catalog test.

#### C07 Rehearsal discards any number before drawing replacements
Verified by the corresponding catalog test.

#### C08 Arcade provides one card, action, buy and coin
Verified by the corresponding catalog test.

#### C09 Impresario bonuses stack but apply to the first Banknote only
Verified by the corresponding catalog test.

#### C10 Rivalry asks each opponent to discard down to three
Verified by the corresponding catalog test.

#### C11 Understudy draws two or blocks without leaving its owner hand
Verified by the corresponding catalog test.

#### C12 Investor optionally upgrades a treasure by up to three into the hand
Verified by the corresponding catalog test.

#### C13 Renovation trashes and gains a card costing up to two more
Verified by the corresponding catalog test.

#### C14 Script Room draws three and Ensemble draws one with two actions
Verified by the corresponding catalog test.

#### C15 Propmaker gains a card costing up to four without spending resources
Verified by the corresponding catalog test.

#### C16 supply endings wait until the turn ends
Verified by the corresponding catalog test.

#### C17 scoring counts all owned landmarks and penalties with fewer-turn tiebreak
Verified by the corresponding catalog test.

#### C18 private views hide opponents hands and all deck orders
Verified by the corresponding catalog test.

#### C19 rejects wrong actors, false card claims, invalid setups and altered shuffles
Verified by the corresponding catalog test.

#### C20 full games preserve private views, card conservation, replay and legal choices
Verified by the corresponding catalog test.

#### C21 offers all 26 distinct company piles and validates ten-pile configurations
Verified by the corresponding catalog test.

#### C22 Costumier gains into hand then privately top-decks any hand card
Verified by the corresponding catalog test.

#### C23 Headliner gains funding, respects a block and lets a victim choose an eligible treasure
Verified by the corresponding catalog test.

#### C24 Booking Office top-decks funding and forces a revealed victory or a revealed empty-of-victories hand
Verified by the corresponding catalog test.

#### C25 Cutting Room may stop early and never trashes more than four
Verified by the corresponding catalog test.

#### C26 Opening Night draws for opponents without an attack response and Gala supplies its full bonuses
Verified by the corresponding catalog test.

#### C27 Repertoire scores each copy using total ownership and uses victory pile sizes
Verified by the corresponding catalog test.

#### C28 Encore can recover any discard and Duet draws while replacing its action
Verified by the corresponding catalog test.

#### C29 Reading Room offers private action set-asides and discards them only after drawing ends
Verified by the corresponding catalog test.

#### C30 Cashbox requires a Penny and Audition counts active empty piles after drawing
Verified by the corresponding catalog test.

#### C31 Stage Door inspects privately, separates trash and discard, and controls next draw order
Verified by the corresponding catalog test.

#### C32 Double Bill resolves nested plays fully and repeats draw and resource bonuses
Verified by the corresponding catalog test.

#### C33 Busker reveals its discard and may play an action without using an action
Verified by the corresponding catalog test.

#### C34 Critic draws then distributes penalties with one reaction opportunity per opponent
Verified by the corresponding catalog test.

#### C35 all curated supplies conserve cards, replay and agree with private player and spectator views
Verified by the corresponding catalog test.

#### C36 Public top-deck memory
Public cards returned to a deck do not populate another viewer’s private memory.
