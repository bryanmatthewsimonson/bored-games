# Luster — base-game rules

An original presentation of the standard Splendor base-game mechanics, with a random starting player as requested for online Luster. The tabletop rule chooses the youngest player; Luster deliberately replaces that convention. This prose is newly written, not a reproduction of a published rulebook. No expansions or Duel mechanics apply.

## Components and goal

Two to four merchants build collections of developments and complete noble commissions. Developments and nobles provide **prestige**. Once someone reaches 15 prestige, finish the current round so everyone has taken the same number of turns. Most prestige wins; among equal scores, fewer purchased developments wins. Players still tied share their place. Reserved cards and nobles are not developments for this tiebreak.

There are 90 developments: 40 Mines cards, 30 Workshops cards and 20 Guilds cards. Each has an exact five-color cost, one permanent color discount, and 0–5 prestige. There are ten noble commissions worth three prestige apiece, with requirements expressed in development discounts. Components also include seven tokens of each of five colors (Diamond, Sapphire, Emerald, Ruby, Onyx), plus five Gold tokens that substitute for any color: 40 tokens total.

## Setup

Shuffle each development tier separately and reveal four cards per tier. Shuffle the ten nobles and reveal one more than the player count; put the rest aside. Use four tokens per regular color for two players, five for three, or seven for four; always use five Gold tokens. Everyone starts with no cards and no tokens. Choose the starting player at random, then follow table order from that player, wrapping around to the beginning. A round ends after the player immediately before the starting player has finished their turn. This also determines the end of the final round, so everyone receives equal turns.

## Your turn

Choose exactly one main action:

- **Take gems:** take one token in each of up to three different regular colors, or two of one regular color if at least four of that color are in the supply before taking them. Gold tokens cannot be gathered. Taking fewer than three different colors is allowed (**OPEN**, see [Open questions and platform rules](#open-questions-and-platform-rules)).
- **Reserve:** take one exposed development or the unseen top development of one tier. Keep at most three reservations. Take one Gold token if any remain, even if this takes you past ten tokens; you may reserve when no Gold tokens remain. Keep reserved cards face down in your hand. A card taken from the market was already public and may be remembered from the move history; an unseen draw is private to you. Reservations cannot be discarded or exchanged and grant no discount or prestige until purchased.
- **Purchase:** buy one exposed development or one of your reservations. For each color, subtract the number of your purchased developments with that color bonus from its cost, stopping at zero. Pay the remaining price using colored tokens and/or Gold tokens; Gold tokens may replace colored tokens even if you have the colored tokens. Choose exactly how to pay. Put paid tokens into the supply and add the development to your collection. The new development's discount is usable on future turns. Free purchases still use your main action.

Immediately replace an exposed card that was bought or reserved with the next card of its own tier. An exhausted tier leaves an empty space. A blind reservation consumes the next card of its tier without changing the exposed market.

After your main action, return tokens of your choice until you hold at most ten, counting Gold tokens. You may return tokens just taken. Then check nobles: if your purchased development bonuses meet a visible noble's requirements, take it at no cost. You must take an eligible noble; if several qualify, choose exactly one. A noble is worth three prestige and grants no development discount. A noble visit is additional to your main action and is checked after every turn, including gathering or reserving.

The game has no discretionary pass. If no main action can be performed, pass (a **platform rule**, see [Open questions and platform rules](#open-questions-and-platform-rules)). There is no invented round limit, stalemate scoring, or automatic end before 15 prestige.

## Open questions and platform rules

Checked on 2026-10-04 against the published base-game rulebook's turn actions (the English rules as reproduced by rulespal.com, "Splendor rulebook", and Dized's licensed rules, "Taking tokens") and the Dized Splendor FAQ. BoardGameGeek and the publisher's PDF host were not reachable, so these are secondary sources.

- **Taking fewer than three colors: OPEN.** The rulebook's action is "Take 3 gem tokens of different colors", with no "up to". The Dized FAQ answers the case where three cannot be taken: "The action 'take three different tokens' allows you to pick only two different tokens, or even one, if all the other piles are depleted. So take as many as you can and are allowed." So the published rule, as the FAQ reads it, allows fewer only when fewer colors are available. Luster's engine (and this page, above) allow fewer than three different colors at any time, which is the looser, common house reading. Until the owner rules, the current behaviour stands; the strict reading would be a rules option (for example `takeFewer: 'always' | 'onlyWhenShort'`) and a DECISIONS entry. A rule-change in the engine must also change `legalActions` and catalog C02.
- **Pass when no main action is possible: platform rule.** The published rules have no pass and do not say what happens when a player can neither take gems, reserve nor buy (possible when the supply is drained, the player holds three reservations and can afford nothing). Luster adds a forced pass in exactly that case so that a turn always has a legal move; a discretionary pass is not allowed. This is a platform necessity, so that a turn always has a legal move (games end only by declaration, never by stalling: D015, D016), not a published rule.

## Online play

Table order sets turn order. NOSTR carries signed actions; the existing encrypted shuffle and private deal protect unseen cards. Buying a blind reservation publishes its identity, checked against the shuffled deck during the final audit. Opponents and spectators see token holdings, development bonuses, prestige, nobles, and the tier and count of reservations. All reserved cards are displayed face down outside their owner’s hand, with no face artwork, cost, bonus or score. A market reservation’s prior public identity remains in replay/history; an unseen reservation’s identity is not disclosed during play. All deck positions keep their original public/private assignment when a card moves into a collection.

Resign is disabled pending a review of public market refills during play. Existing platform timeouts apply. Final-round scoring waits for necessary public refill reveals; an unavailable reveal is handled by the existing protocol deadline, not by a different game rule.

Click a gem stack to add that color to your selection. A second click selects a legal pair; a further click clears that color. Click a selected gem in the tray to remove one, or Clear to start over. Confirm with Take gems. While returning excess tokens, the stacks show your own hand and the confirmation becomes Return gems. All clicks must be able to complete a legal token action.

Click a development to open its buy/reserve panel; the card's whole face also works with Enter or Space. The price shown includes your permanent discounts. When multiple payments are possible, click a colored payment gem to replace one with Gold, or the Gold beside it to swap back. Buy card confirms the chosen exact payment. Reserve card takes the selected public card; clicking a tier's deck opens a panel to reserve an unseen card instead. Click an eligible noble's card to choose it. Your reserved cards appear in a separate hand area and can be clicked to buy them. The right-hand desktop sidebar shows every player’s score, gems, discounts, nobles and face-down reservation counts; on smaller screens the player panels move below the board. Escape or Close dismisses the card panel.

## Verification catalog

#### C01 Components and setup
90 developments split 40/30/20; eight/six/four cards per bonus color per tier; exact numerical-table fingerprint; ten nobles; 4/5/7 regular tokens and five Gold tokens; four exposed cards per tier and seats+1 nobles.

#### C02 Take and return gems
Up to three distinct regular colors; pairs require at least four in supply; no Gold gathering; token returns include newly gathered tokens and must leave exactly ten.

#### C03 Reservations
Three-card maximum; exposed or blind; a Gold token when available, optional supply exhaustion, no discarding; immediate tier replacement; blind deal consumes its tier cursor.

#### C04 Purchasing
Permanent discounts, free purchases, exact payment with optional Gold substitution, supply conservation, no bonus from reservations.

#### C05 Noble visits
Development bonuses alone qualify; visits cost no tokens; one compulsory eligible noble per turn; choice among several; not counted as developments.

#### C06 Final round and tiebreak
Reach 15 then finish the round; equal turns; highest prestige first, then fewest purchased developments, then shared places.

#### C07 Private information and audit hooks
Private reservation redaction and owner-only learn; immutable assignments; correct revealsOf claims; forged identities rejected by full audit; prior market identities remain replayable; every opponent reservation is displayed face down.

#### C08 Invalid input and determinism
Malformed actions, extra fields, wrong actor, invalid setup/rules/deck/reveal and hostile getters rejected without throwing or mutating state; every enumerated legal action applies.

#### C09 Exhausted tiers
No replenishment past a tier's size; blind reservation of an empty tier is unavailable; buy a reservation to free capacity.

#### C10 Random starting player and rotated rounds
Every seat has equal probability. Choose from fixed-position, jointly shuffled public setup cards; reveal delivery order cannot affect the choice. Full replay, players and spectators agree. Round numbers advance on return to the starting player; the final round ends at their predecessor, after all required returns and noble decisions.
