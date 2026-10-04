# Luster — base-game rules

An original presentation of the standard Splendor base-game mechanics, with a random starting player as requested for online Luster. The tabletop rule chooses the youngest player; Luster deliberately replaces that convention. This prose is newly written, not a reproduction of a published rulebook. No expansions or Duel mechanics apply.

## Components and goal

Two to four glassmakers build collections of workshops and complete patron commissions. Workshops and patrons provide **radiance**. Once someone reaches 15 radiance, finish the current round so everyone has taken the same number of turns. Most radiance wins; among equal scores, fewer purchased workshops wins. Players still tied share their place. Reserved cards and patrons are not workshops for this tiebreak.

There are 90 workshops: 40 Study cards, 30 Studio cards and 20 Atelier cards. Each has an exact five-color cost, one permanent color discount, and 0–5 radiance. There are ten patron commissions worth three radiance apiece, with requirements expressed in workshop discounts. Components also include seven tokens of each of five colors (Ivory, Azure, Moss, Rose, Ink), plus five Prism tokens that substitute for any color: 40 tokens total.

## Setup

Shuffle each workshop tier separately and reveal four cards per tier. Shuffle the ten patrons and reveal one more than the player count; put the rest aside. Use four tokens per regular color for two players, five for three, or seven for four; always use five Prisms. Everyone starts with no cards and no tokens. Choose the starting player at random, then follow table order from that player, wrapping around to the beginning. A round ends after the player immediately before the starting player has finished their turn. This also determines the end of the final round, so everyone receives equal turns.

## Your turn

Choose exactly one main action:

- **Gather light:** take one token in each of up to three different regular colors, or two of one regular color if at least four of that color are in the supply before taking them. Prism tokens cannot be gathered. Taking fewer than three different colors is allowed.
- **Reserve:** take one exposed workshop or the unseen top workshop of one tier. Keep at most three reservations. Take one Prism if any remain, even if this takes you past ten tokens; you may reserve when no Prisms remain. Reserving an exposed card leaves its identity public; a blind reservation is private to you. Reservations cannot be discarded or exchanged and grant no discount or radiance until purchased.
- **Purchase:** buy one exposed workshop or one of your reservations. For each color, subtract the number of your purchased workshops with that color bonus from its cost, stopping at zero. Pay the remaining price using colored tokens and/or Prisms; Prisms may replace colored tokens even if you have the colored tokens. Choose exactly how to pay. Put paid tokens into the supply and add the workshop to your collection. The new workshop's discount is usable on future turns. Free purchases still use your main action.

Immediately replace an exposed card that was bought or reserved with the next card of its own tier. An exhausted tier leaves an empty space. A blind reservation consumes the next card of its tier without changing the exposed market.

After your main action, return tokens of your choice until you hold at most ten, counting Prisms. You may return tokens just taken. Then check patrons: if your purchased workshop bonuses meet a visible patron's requirements, take it at no cost. You must take an eligible patron; if several qualify, choose exactly one. A patron is worth three radiance and grants no workshop discount. A patron visit is additional to your main action and is checked after every turn, including gathering or reserving.

The game has no discretionary pass. If no main action can be performed, pass. There is no invented round limit, stalemate scoring, or automatic end before 15 radiance.

## Online play

Table order sets turn order. NOSTR carries signed actions; the existing encrypted shuffle and private deal protect unseen cards. Buying a blind reservation publishes its identity, checked against the shuffled deck during the final audit. Opponents and spectators see token holdings, workshop bonuses, radiance, patrons, and public reservations. They see the tier and count of blind reservations, but not their identities. All deck positions keep their original public/private assignment when a card moves into a collection.

Resign is disabled pending a review of public market refills during play. Existing platform timeouts apply. Final-round scoring waits for necessary public refill reveals; an unavailable reveal is handled by the existing protocol deadline, not by a different game rule.

## Verification catalog

#### C01 Components and setup
90 workshops split 40/30/20; eight/six/four cards per bonus color per tier; exact numerical-table fingerprint; ten patrons; 4/5/7 regular tokens and five Prisms; four exposed cards per tier and seats+1 patrons.

#### C02 Gather and return light
Up to three distinct regular colors; pairs require at least four in supply; no Prism gathering; token returns include newly gathered tokens and must leave exactly ten.

#### C03 Reservations
Three-card maximum; exposed or blind; a Prism when available, optional supply exhaustion, no discarding; immediate tier replacement; blind deal consumes its tier cursor.

#### C04 Purchasing
Permanent discounts, free purchases, exact payment with optional Prism substitution, supply conservation, no bonus from reservations.

#### C05 Patron visits
Workshop bonuses alone qualify; visits cost no tokens; one compulsory eligible patron per turn; choice among several; not counted as workshops.

#### C06 Final round and tiebreak
Reach 15 then finish the round; equal turns; highest radiance first, then fewest purchased workshops, then shared places.

#### C07 Private information and audit hooks
Private reservation redaction and owner-only learn; immutable assignments; correct revealsOf claims; forged identities rejected by full audit; public reservations remain visible.

#### C08 Invalid input and determinism
Malformed actions, extra fields, wrong actor, invalid setup/rules/deck/reveal and hostile getters rejected without throwing or mutating state; every enumerated legal action applies.

#### C09 Exhausted tiers
No replenishment past a tier's size; blind reservation of an empty tier is unavailable; buy a reservation to free capacity.

#### C10 Random starting player and rotated rounds
Every seat has equal probability. Choose from fixed-position, jointly shuffled public setup cards; reveal delivery order cannot affect the choice. Full replay, players and spectators agree. Round numbers advance on return to the starting player; the final round ends at their predecessor, after all required returns and patron decisions.
