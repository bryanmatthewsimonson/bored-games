# Holler rules

Holler plays the shedding game Uno (BoardGameGeek 2223) under its own names. This file is the **source of truth** for the engine in `packages/games/holler`. Display names live in `packages/games/holler/src/theme.ts`. The public title is Holler. The declaration is Holler!.

Suits are Notch, Tide, Seed, and Kiln. Each suit is also a pattern, so color is never the only signal. Actions are Halt, Swing, Pull, Mark, and Levy. There is no licensed art pack. The catalog may name the reference game once, inside the compare line, with BoardGameGeek id 2223.

## The deck

108 cards.

- Four suits. Each suit has one 0, two of each rank 1 through 9, two Halts, two Swings, and two Pulls.
- Four Marks and four Levies. They have no suit.

A card matches the discard when it shares the suit, the rank, or the action kind. A Mark or a Levy matches anything. A Mark or a Levy names the suit that follows it.

## The deal

Two to ten seats. Deal seven cards, round-robin, one card at a time. Set the next card as the starter.

- A number: the first seat plays, and that suit is active.
- A Halt: the first seat is skipped. Seat 1 plays.
- A Swing at three or more seats: direction reverses, and seat `n − 1` plays.
- A Swing at two seats: seat 1 plays. Direction stays forward.
- A Pull: seat 0 draws two, then seat 1 plays.
- A Mark: seat 0 names the suit, then plays.
- A Levy: set that card aside, out of the draw, and turn the next undealt card. Do this for at most four distinct Levies. The fifth card, whatever it is, becomes the starter. A set-aside Levy stays out until the next round shuffles all 108 cards.

## A turn

Play one card that matches, or draw one when nothing matches. A drawn card may be played at once when it matches, and may be kept even when it matches. When it does not match, it is kept. A voluntary draw is one card. The other seats each see that card once, in seat order, before the drawer decides. A draw is not offered while a card can be played.

While any card in the pending seat's hand is still unknown, that seat has no listed action.

## Halt, Swing, and Pull

After the card's effect, the next seat is one step in the current direction.

- Halt skips that seat. Direction stays.
- At two seats, Halt and Swing both skip, so the same seat plays again. Direction stays.
- At three or more seats, Swing reverses direction first, then the next seat is one step in the new direction.
- Pull makes the next seat draw two and skips them.

## Mark and Levy

The played card names the next suit.

A Levy is legal only when the hand has no card of the suit that was active. A Mark does not count as that suit. An off-suit card of the same rank or kind does not count either. The next seat may accept or challenge.

- Accept: that seat draws four and misses.
- Challenge: the seat who played the Levy says whether the play was clean. The bit is a claim about the hand, not a reveal of it.
- Clean: the challenger draws six and misses.
- Unclean: the seat who played the Levy draws four, and the challenger plays.

A fully known hand has one honest answer. An empty known hand is clean, because nothing of the old suit remains. A hand that was hidden when the Levy was played may be answered either way; the table did not see the cards. A false answer on a known hand is rejected.

## Holler

The seat who plays down to one card may say Holler on that play. The declaration is recorded before the card's effect. If the effect refills the hand, the declaration is cleared.

Omitting it opens a catch window after the effect, when the hand is still exactly one card and still undeclared. Seats are asked in increasing index, starting after the player, ignoring direction. The first catch makes that player draw two, and later seats are not asked. If everyone passes, there is no penalty, and the declaration stands, so the last card can be played later.

The last card carries no declaration. It is legal only after one was recorded. No window opens on the play from one card to zero.

The round ends when the last card's effect leaves the hand empty. A Pull still makes the next seat draw before the score. A Levy still offers accept or challenge. An unclean answer draws four back onto the seat who would have gone out, clears the declaration, and the round continues.

## The draw pile

When a draw needs more cards than the pile holds, and at least one card sits under the top of the discard, shuffle every discard except that top and finish the draw from the new pile. The top card stays. When nothing sits under the top, the draw takes what remains, even if that is nothing, and the turn continues. There is no shuffle of an empty pile.

A catch that draws nothing, because the pile was empty and nothing was under the top, still records the declaration when the hand is one card. Otherwise that seat could never play the last card.

## The score

The seat who went out scores the cards left in every other hand. A rank scores its face. Halt, Swing, and Pull score 20. Mark and Levy score 50. No other seat scores that round. The hands are revealed before the total is applied, including cards a final Pull or Levy draw just dealt.

The match continues while every score is under 500. The round that reaches 500 ends the match. The highest score wins. Tied scores share a place and the next score skips: two scores of 10 and a 0 finish (1, 1, 3). A tie for second, under a higher score, is (1, 2, 2).

## Resignation

Resign is not a module action. A table of two seats refuses Resign; that refusal belongs to the platform. At three or more seats the platform accepts it.

## Catalog

#### C01 Setup deals 7 to each seat round-robin and reveals one starter

#### C02 Seat range is 2 to 10. 1 and 11 are rejected

#### C03 A starter Levy is set aside and the next undealt card is turned

#### C04 A starter Halt skips seat 0

#### C05 A starter Swing at 3 or more seats reverses, and the first turn is seat n − 1

#### C06 A starter Mark: seat 0 names the suit, then plays

#### C07 A number matches by suit

#### C08 A number matches by rank

#### C09 An action matches by kind across suits, including a Pull played onto a Pull

#### C10 An action matches by suit

#### C11 A Mark may be played on anything, and the play names the suit

#### C12 A Levy may be played on anything when the hand has no card of the active suit

#### C13 A Levy is illegal in full mode when the hand has a card of the active suit

#### C14 A Mark in hand does not block a Levy

#### C15 An off-suit card of the same rank or kind does not block a Levy

#### C16 A view that cannot see the hand accepts a well-formed Levy

#### C17 The next seat may accept a Levy, draws 4, and misses

#### C18 The next seat may challenge before accepting

#### C19 A clean answer makes the challenger draw 6 and miss

#### C20 An unclean answer makes the player who played the Levy draw 4, and the challenger plays

#### C21 A false clean bit is rejected when every card of that hand is known

#### C22 A challenge from any seat but the next is rejected

#### C23 A challenge after accept is rejected

#### C24 Draw is legal only when nothing in the hand matches

#### C25 The drawn card may be played at once when it matches

#### C26 The drawn card may be kept when it matches

#### C27 The drawn card must be kept when it does not match

#### C28 A voluntary draw does not continue

#### C29 Cover is the only action while a voluntary draw is uncovered, one other seat at a time

#### C30 legalActions is empty whenever any card in the pending hand is unknown, including a Levy on a partial hand

#### C31 Halt skips the next seat

#### C32 Swing at 3 or more seats flips direction, then the next seat is one step that way

#### C33 Swing at 2 seats skips and does not change direction

#### C34 Pull draws 2 for the next seat and skips them

#### C35 A play down to one card with the declaration records it and opens no window

#### C36 A play down to one card without the flag opens a catch window

#### C37 The first catch draws 2; later seats are not asked

#### C38 A window everyone passes leaves that seat free to go out later

#### C39 The last card, after a declaration, ends the round once its effect has finished

#### C40 A last card that is a Levy answered unclean does not end the round

#### C41 An empty draw pile shuffles every discard except the top

#### C42 The top discard stays across that shuffle

#### C43 When nothing remains under the top, a required draw takes nothing further and the turn continues

#### C44 A set-aside starter Levy stays out until the next round shuffles all 108 cards

#### C45 The seat who went out scores rank, 20 per action, and 50 per Mark or Levy

#### C46 The match continues while every score is under 500 and ends on the round that reaches 500

#### C47 Tied scores share a place and the next score skips (1, 1, 3)

#### C48 standings is the match-score array during play and equals outcome.scores at the end

#### C49 apply rejects {type:"resign"}

#### C50 A second encoding is rejected: a false declaration, an extra key, or a suit on a number

#### C51 A seat who owes a Pull cannot answer it by playing another Pull

#### C52 A play from a seat that is not pending is rejected

#### C53 A 0 or a 7 does not move any other card

#### C54 Views hide other hands and the draw pile. A played card is public

#### C55 learn commutes with a later play and emits no events

#### C56 Invariants: live zones are one deck, and a repeated index across epochs is re-encryption

#### C57 The engine has no resign action. A two-seat refusal is the platform's

#### C58 A forced draw that empties the pile resumes after the epoch from resume

#### C59 Going out on a Pull still makes the next seat draw before the score

#### C60 An action from outside the pending turn is rejected. No jump-in encoding exists
