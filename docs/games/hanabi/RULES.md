# Hanabi rules

Hanabi is a cooperative card game by Antoine Bauza (2010; Cocktail Games, R&R Games, Asmodee). The players are fireworks makers who must put on a show together, but each holds a hand they cannot see, and they may speak only through a small, costed set of clues. This file is the **source of truth** for a future engine in `packages/games/hanabi`. No engine, UI or package exists yet (D054).

**Status: spec only. The build is blocked on Phase K** (sealed shares and a prompt-reveal protocol, see "Hidden information" below and `docs/GAME-SYSTEMS.md` §4.1, "Hanabi design note"). Until the package exists, `tests/catalog.test.ts` lists `hanabi` as spec only (`SPEC_ONLY`) and does not require catalog tests. The moment `packages/games/hanabi` is created, that entry must be removed and every `#### Cnn` below needs an `it('Cnn …')` test.

The public name is "Hanabi" (owner's choice, D054). There is no trademark-safe brand pack for it: unlike Chain Reaction (D046), the name and the game are used as published. Colour ids below are plain words; display names and the score-band texts belong to `src/theme.ts` when the package exists.

## Sources and interpretations

**Sources.**
- The Hanabi rulebook (Antoine Bauza; Cocktail Games / R&R Games). The rulebook PDF could **not** be fetched in the writing session (HTTP 403), so the rules below come from the author's knowledge of it, cross-checked against the secondary sources that could be read: the Wikipedia article "Hanabi (card game)", the Zatu "How to play Hanabi" page, the officialgamerules.org summary and web-search summaries of the rulebook. Rules checked against at least two of those are marked **verified** in the table; rules known only from the rulebook as remembered are marked **recalled**.
- `docs/GAME-SYSTEMS.md` §4.1 (grant model, sealed shares, prompt and piggybacked duties) and §4.7 (co-op outcome, honour rules).

**Rules decisions and open points.**

| Topic | Decision | Basis |
|---|---|---|
| Components | 50 cards: five colours, each with ranks 1, 1, 1, 2, 2, 3, 3, 4, 4, 5. 8 clue tokens and 3 fuse tokens. The rulebook calls them "information" and "storm" (or fuse) tokens. | **verified** |
| Players and hand size | 2–5 players. 5 cards each with 2 or 3 players, 4 cards each with 4 or 5. | **verified** |
| Seeing cards | Each player holds their hand facing away: every player sees every other hand, nobody sees their own. | **verified** |
| Actions | On a turn a player takes exactly one of: give a clue, discard a card, play a card. | **verified** |
| Clue | Costs 1 clue token. Names one other player and **one** colour or **one** rank, never both. It must be complete (every card of that colour or rank in the target's hand is pointed at) and correct. | **verified** (complete and correct, one colour or number, not to oneself, costs a token) |
| Clue touching nothing | A clue must touch at least one card: "you have no 3s" is not allowed. | **recalled** (the rulebook requires information that points at cards) |
| Clue at 0 tokens | Not allowed. | **verified** |
| Discard | Regains 1 clue token. Not allowed while all 8 clue tokens are available. | token regain **verified**; the ban at 8 **recalled** |
| Play | The card must be the next rank of its colour (a 1 starts a firework). A 5 completes a firework and regains 1 clue token if fewer than 8 are available. A card that is not the next rank is a misplay: it is discarded face up and a fuse token is lost. | **verified** |
| Draw | After a play or discard the player draws the top card of the deck, if any. Clues never draw. | **verified** |
| Third fuse | The game ends at once and is lost: the display "goes up in flames". The score is **0**. | the end is **verified**; **score 0** is **recalled** from the rulebook's scoring section (the sources read did not state it). Keeping the points is a rules option, **OPEN** (`fuseLoss: 'keep'`) |
| All fireworks complete | At 25 points the game ends at once, a perfect win. | **verified** |
| Deck runs out | When the last card is drawn, each player takes **one more turn**, including the player who drew it. No one draws during these turns. | **verified** ("everyone, including the player that took that last card, gets one more turn") |
| Score | The sum, over the five colours, of the highest rank played on each firework. 0–25. | **verified** |
| Score bands | The rulebook gives a spoken verdict per band: 0–5, 6–10, 11–15, 16–20, 21–24, 25. Display text only, no rule effect; the wording is our own and is **OPEN** (final text in `theme.ts`). | bands **verified** (Zatu) |
| First player | The rulebook picks the first player by a table custom (whoever last saw fireworks). **Platform decision:** seat 0. | custom **recalled**; seat 0 is ours |
| Order of cards in hand | At a table, players keep their cards in any order. **Platform decision:** the log has one canonical slot order (see "The hand and its slots"); a viewer-side reorder is a UI matter. | **OPEN** (what the rulebook says about rearranging was not verified) |
| Clue memory | At a table players must remember clues. **Platform decision** below: the log is the memory, and a client may show the clue marks on each card. | **OPEN** whether a strict "no marks" option is wanted |
| Talk | The rulebook forbids any hint beyond clues: no comments, faces, pauses or reordering that carries information. | **verified** in spirit (Zatu: "you're not supposed to run your hand over your cards") |
| Variants | A sixth suit (rainbow, multicolour or black) and others, **OPEN** (see "Variants"). Not part of the base rules. | the rainbow cards **verified** as an advanced option (Zatu) |

## Components and setup

- **Cards:** 50. Each of the five colours has ten cards: three of rank 1, two each of ranks 2, 3 and 4, one of rank 5. Colour ids: `white`, `yellow`, `green`, `blue`, `red` (plain words; no brand).
- **Tokens:** 8 clue tokens (all available at the start) and 3 fuse tokens (none used). The clue count never goes below 0 or above 8. A third lost fuse ends the game.
- **Fireworks:** one per colour, each starting at 0 (empty). A firework's top rank is its score.
- **Discard pile:** face up, public, in the order cards were discarded or misplayed.
- **Setup:** the 50 cards are shuffled by the deck protocol (one deck, `decks(rules)` has one entry of 50). The cards are dealt in deck order, **seat 0's whole hand first, then seat 1's, and so on**, so seat `s` receives the positions `s × h` to `s × h + h − 1` (h is the hand size). The draw pile is the rest, and each draw takes the next position. Seat 0 moves first.
- **Cards left after the deal:** 40 (2 seats), 35 (3), 34 (4), 30 (5).

## A turn

On its turn the acting seat takes exactly one of three actions. Then the turn passes to the next seat in seat order (the last seat to seat 0), unless the game ended.

### Give a clue
- The actor names **another seat** (the target) and **one** colour or **one** rank.
- It costs one clue token, so it is illegal at 0 tokens.
- The clue **touches every card** in the target's hand of that colour, or of that rank. The touched slots are derived from the hand and are never chosen by the actor.
- A clue that touches no card is illegal.
- A clue has no other effect: no draw, no change to the fireworks or the deck. Everyone sees it, and it is recorded in the public log.

### Discard a card
- The actor discards one card from its own hand, by slot, face up onto the discard pile.
- It regains one clue token. It is **illegal while there are 8 clue tokens**.
- The actor then draws a replacement (see "Drawing").

### Play a card
- The actor plays one card from its own hand, by slot, onto its colour's firework.
- **Success:** the card's rank is exactly the firework's top rank plus one (a 1 on an empty firework). The firework's top rank becomes the card's rank. If the card is a 5 and fewer than 8 clue tokens are available, one clue token is regained. A 5 at 8 tokens regains nothing.
- **Misplay:** any other card (a rank too high, or a rank already played, a duplicate). The card goes face up to the discard pile and one fuse token is lost. The firework does not change and no clue token is regained.
- A play is always legal, whatever the tokens. The actor then draws a replacement (see "Drawing").

### Drawing
After a play (successful or not) or a discard, the actor draws the top card of the deck and adds it to its hand. If the deck is empty, nothing is drawn and nothing is wrong: the hand gets smaller. Clues never draw.

### The hand and its slots
- A hand is an ordered list. **Slot 0 is the oldest card.** A new card goes to the **last** slot. When a card leaves the hand, the cards after it move down by one. This is the engine's canonical order, and every action and every clue refers to it.
- A client may let a player move its own cards around on screen. That is a view matter and never appears in the log, so the log's slot numbers stay canonical. **OPEN:** the rulebook leaves hand order to the table.
- Clue marks: the public log says, for every card, which clues touched it and which clues were given while it was in the hand without touching it. A client may show these as marks (for example "red", "not 3") on the holder's cards. This is public information derived from the log, and it replaces the memory a player has at a table.

## End of game

The game ends at the first of these, checked after every action:

| End | When | Score | `reason` |
|---|---|---|---|
| Fuses | The third fuse token is lost | **0** (a loss; `fuseLoss: 'keep'` is an **OPEN** option) | `fuses` |
| Perfect | All five fireworks are at 5 | 25 | `perfect` |
| Deck | The last card has been drawn and every seat has taken one more turn | the sum of the fireworks | `deck` |

- **Immediate ends.** A third fuse or a 25th point ends the game on the spot, with no more turns. If both could happen the same turn, the fuse is checked first (a misplay cannot complete a firework, so in practice they never coincide).
- **The final round.** The draw that takes the deck to 0 cards starts it. Let Q be the seat that drew. The seats Q+1, Q+2, …, up to and including Q each take **one** more turn, so there are exactly as many final turns as seats, and Q's is the last. A seat that gets a final turn may give a clue (if tokens allow), discard (if below 8) or play. Nobody draws. After the final turn the game ends and the score is the sum of the fireworks.
- **No stall rule needed.** A game always ends: a clue costs a token that only a discard or a completed firework returns, and each of those uses a card from the deck, so the deck and the final round bound the game. A game that does not end is a bug in the engine or the fuzz policies (D015, D016).
- **Scoring.** Score = the sum of the five fireworks' top ranks (0–25), or 0 after the third fuse.
- **Score bands (display text only).** 0–5 a poor show, 6–10 a modest one, 11–15 decent, 16–20 good, 21–24 great, 25 legendary. The final wording is **OPEN** and goes in `theme.ts`; it has no effect on rules.

## Outcome

Hanabi is **cooperative**: there is one shared result.
- Every seat has place 1 and the same score: `standings` equals the shared score for every seat during play and at the end.
- `Outcome.coop` (GAME-SYSTEMS §4.7) is `'loss'` after the third fuse. **OPEN:** whether it is `'win'` after any other end or only at 25. Recommended: a loss only on the third fuse, win otherwise, with the score as the real result. To be settled with §4.7 when Phase K lands.
- A timeout or resign ends a co-op game as a loss for everyone (§4.7). **OPEN:** whether the fireworks' score is kept for display. Resign in games of 3 or more seats is still an open platform question (PLAN question 11).
- Ratings treat co-op separately (Phase 4).

## Hidden information

- **Viewer sets.** A card in seat Q's hand is visible to **every seat except Q**. The deck is visible to nobody. Fireworks and the discard pile are public. In grant terms (GAME-SYSTEMS §4.1.3): a dealt card's viewer set is all seats but its holder.
- **`view(state, viewer)`.** A seat sees every other hand exactly and its own hand as hidden cards (with the public clue marks). The deck shows only its size. A spectator (`viewer: null`) sees no hand while the game runs (a spectator has no seat, so no sealed share), and everything once the game has ended and the cards are revealed.
- **Reveal on play or discard.** A played or discarded card becomes public, the holder included. It turns on a platform reveal, and the engine learns the card from the reveal, never from the holder.
- **Cryptography.** Privacy comes from the deck protocol, never from the UI alone (GAME-SYSTEMS §2.1). With two seats the viewer set has one member, so today's shares are nearly enough. With three or more seats the cards need **sealed shares** between the viewers, and the draw and reveal timing needs a **prompt-reveal protocol**: the seat after the drawer must see the new card before it acts, which turn-piggybacked shares cannot give (see "Hanabi design note" in GAME-SYSTEMS §4.1).
- **Dependency: build blocked on Phase K.** Do not start the engine's package, UI, fuzz target or e2e until the sealed-share crypto and the cheat-proof prompt-reveal protocol are approved (owner instruction, J0, D054).
- **The initial deal** also needs the viewers' shares before the first turn, so seat 0 can see the other hands. That is a setup round of sealed shares, part of the same dependency.
- **At the end** every card is revealed and audited, as in every deck game.

## Platform decisions

- **Asynchronous play.** Each seat moves in its own time within the table's deadline (1, 3 or 7 days, D020). A turn is one action. A seat that misses the deadline ends the game (see "Outcome").
- **The communication rule is an honour rule.** The platform has no table chat for the game, and no out-of-game talk can be seen or stopped: players can speak elsewhere (GAME-SYSTEMS §4.7, PROTOCOL §11). The rules say players must not hint beyond clues, and the app only offers the three actions. Like collusion, it rests on honour.
- **Seat order.** The creator's explicit seat order (D021) is the turn order. Seat 0 moves first, and the turn passes to the next seat, wrapping.
- **Deterministic encoding.** Every action has exactly one accepted encoding (CLAUDE.md), described in the next section.
- **Outcome.** Cooperative and shared (see "Outcome"): places are all equal.
- **Rules options** (the `rules-hash` in the Join binds them): see "Rule options" below. The base game has none that change play.

## Actions on the wire (prose)

- **Clue.** An action of type `clue` with the actor (an integer seat), the `target` (an integer seat, not the actor), a `kind` (`colour` or `rank`) and a `value`: a colour id for `colour`, an integer 1 to 5 for `rank`. The touched slots are not part of the action: they are derived. A move that carries them is rejected.
- **Play.** An action of type `play` with the actor and the `slot`, an integer from 0 to the hand's size minus 1.
- **Discard.** An action of type `discard` with the actor and the `slot`, in the same way.
- **Rejected as non-canonical:** unknown or extra keys, a missing key, strings in place of integers, `value` that does not match `kind` (a rank with `colour`, a colour not in the deck, rank 0 or 6), a slot out of range or not an integer, an unknown action type, an actor who is not the seat to move, and any action after the game ended.
- **Revealed cards.** The card a play or discard turns public is not written by the actor: it comes from the platform reveal, so a player cannot choose or misreport it.

## Variants (OPEN rules options for later, not base rules)

None of these is part of the base rules. Each would be a rules option bound by the `rules-hash`, decided and logged when wanted. Card counts and clue behaviour for the extra suit are **not** specified here and must be taken from the publisher's rules for that variant.
- **Sixth suit, rainbow / multicolour:** an extra firework. Variants differ on whether a colour clue touches the rainbow cards as well as its own colour, and on how many cards the suit has. The deck size, hand size and scores (to 30) would change. **OPEN.**
- **Sixth suit that no colour clue touches** ("black"/colourless): clued by rank only. **OPEN.**
- **`fuseLoss: 'keep'`:** keep the fireworks' score after the third fuse. **OPEN.**
- **Hand size and token counts** other than the base game. **OPEN.**
- **A strict clue memory option** (no marks on cards). **OPEN.**

## Rule options (`HanabiRules`)

| Option | Default | Notes |
|---|---|---|
| `rulesVersion` | `1` | Bumped when an option's meaning changes |

Future options are the **OPEN** items above.

## Edge-case catalog

Once the engine exists, each entry has a named test in `packages/games/hanabi/test/catalog/` whose title starts with its id, and `tests/catalog.test.ts` enforces it (today it only checks that the ids are well formed and unique, because Hanabi is spec only).

**Notation:** seats and slots are numbered from 0. "Tokens" are clue tokens. "Fuses" are fuse tokens lost so far. A firework is written `red 2` for top rank 2.

### Setup and components

#### C01 The deck has 50 cards: per colour three 1s, two each of 2, 3 and 4, and one 5
Five colours of ten cards each give fifty cards, and the cards of one colour and rank are indistinguishable by rules.

#### C02 A game starts with 8 tokens, 0 fuses lost and every firework at 0
The score is 0, the discard pile is empty and no clue has been given.

#### C03 Two to five seats are accepted; one and six are rejected
Setup with any other number of seats fails.

#### C04 Hand size is 5 with two or three seats and 4 with four or five
Every seat is dealt that many cards at setup.

#### C05 The draw pile after the deal holds 40, 35, 34 and 30 cards for 2, 3, 4 and 5 seats
Fifty minus seats times hand size.

#### C06 Seat 0 moves first and the turn passes in seat order, wrapping after the last seat
No action changes who moves next, except the end of the game.

#### C07 Hands are dealt seat by seat from the top of the deck, then draws take the next position
Seat 0 gets the first hand-size positions, seat 1 the next, and the first draw takes the position after the last dealt card.

### Encoding and legality

#### C08 Only the seat to move may act, and nothing is accepted after the end
An action by any other seat is rejected, and so is every action once the game is over.

#### C09 Non-canonical encodings are rejected
Extra or missing keys, string numbers, rank 0 or 6, an unknown colour, a clue without a target, a clue that carries its touched slots and an unknown action type are all rejected.

#### C10 A slot must be an integer inside the hand
A slot below 0, at or above the hand size, or not an integer is rejected for play and discard.

#### C11 A clue's value must match its kind
A `rank` clue with a colour id, or a `colour` clue with a number, is rejected.

#### C12 Slots are canonical: a new card goes last and the cards after a removed one move down
After seat 0 discards slot 1 of a five-card hand and draws, the old slots 2 to 4 become 1 to 3 and the new card is slot 4.

### Giving clues

#### C13 A clue costs exactly one token
Tokens drop by one, from 8 to 7 for example.

#### C14 A clue at 0 tokens is rejected
There is no way to give information for free.

#### C15 A clue to yourself is rejected
The target must be another seat.

#### C16 A clue names one colour or one rank, never both
The action has one kind and one value, and a clue about "red 3" cannot be given.

#### C17 A clue touches every card of that colour or rank in the target's hand
The touched slots are derived, so a clue of rank 1 touches all of the target's 1s and cannot pick only some.

#### C18 A clue that would touch no card is rejected
A colour or rank that the target does not hold cannot be named, so "no cards" is never information.

#### C19 A clue that adds nothing new is still legal if it touches a card
Giving the same clue twice, or clueing a card that is already known, costs a token and is accepted.

#### C20 A clue draws nothing and changes neither the fireworks nor the deck
Only the tokens and the public record of clues change.

#### C21 Everyone sees a clue, and the target learns which slots it touched and did not touch
Slots that were not touched are known not to be that colour or rank.

#### C22 A clue at 8 tokens is legal
Clues are limited only by the token count, and 8 tokens is the most there can be.

### Discarding

#### C23 A discard regains one token
From 3 tokens a discard leaves 4.

#### C24 A discard at 8 tokens is rejected
Tokens never go above 8, so the action is illegal there.

#### C25 A discarded card goes face up onto the discard pile and becomes public
The discard pile keeps the order of discarding, and every seat, the holder included, may see the card.

#### C26 A discard draws a replacement if the deck has a card
The new card is the holder's last slot, and the deck shrinks by one.

#### C27 A discard with an empty deck regains the token, draws nothing and shrinks the hand
Drawing from an empty deck does nothing and is not an error.

### Playing

#### C28 A card of rank one above its firework's top rank is a success
A red 3 on `red 2` makes `red 3`.

#### C29 A 1 is playable on an empty firework and any higher rank is not
A 2 on an empty firework is a misplay.

#### C30 A duplicate of an already played card is a misplay
A red 2 on `red 2` or on `red 4` is a misplay: the rank must be exactly one above the top.

#### C31 A misplay loses one fuse and the card is discarded face up
The firework does not change, no token is regained and the card is public in the discard pile.

#### C32 A successful 5 regains a token when fewer than 8 are available
At 7 tokens a played 5 makes 8.

#### C33 A successful 5 at 8 tokens gives no token
Tokens stay 8, and the play is otherwise a success.

#### C34 A successful card of rank 1 to 4 gives no token
Only completing a firework regains a token.

#### C35 A play is legal at any token count and whatever the card
A player may play a card it knows nothing about, at 0 or 8 tokens alike.

#### C36 A play draws a replacement if the deck has a card, and nothing if it is empty
A successful play and a misplay draw alike, and an empty deck leaves a smaller hand.

#### C37 A played or discarded card becomes public, the holder included
The engine learns the card from the platform reveal, never from the holder's claim.

### Ending the game

#### C38 The third fuse ends the game at once with score 0
Even with fireworks at 20 the score is 0 and no seat takes another turn.

#### C39 The third fuse on the turn that draws the last card gives 0 and no final round
The fuse is checked first, so the final round never starts.

#### C40 Completing all five fireworks ends the game at once with 25
It ends before the deck runs out and before any final turn, even while the deck still has cards.

#### C41 Drawing the last card starts a final round of exactly one turn per seat
The seats after the drawer take their turns in order and the drawer takes the last one, so a three-seat game has three more turns.

#### C42 The drawer of the last card also gets a final turn
The drawer's own turn already ended with the draw, and it takes one more turn at the end of the round.

#### C43 The last card may be drawn by a play or by a discard alike
Both actions draw, so both can start the final round.

#### C44 In the final round nobody draws and hands shrink by at most one per seat
Plays and discards draw nothing, and a seat takes only one final turn, so every hand still has a card.

#### C45 A clue is legal in the final round if tokens allow
The final round does not remove clues, and a clue does not extend it.

#### C46 A third fuse in the final round gives score 0
The misplay in the last turn loses everything, as at any time.

#### C47 Completing the fireworks in the final round ends the game at once
The remaining final turns are not played.

#### C48 After the last final turn the score is the sum of the five tops
Fireworks at 5, 3, 0, 4 and 2 give 14.

#### C49 A legal action always exists until the game ends
At 8 tokens a clue or a play is legal, at 0 tokens a discard or a play is, and hands are never empty before the end.

#### C50 Every game ends after finitely many turns
Clues need tokens that only discards and completed fireworks return, and each of those uses a card from the deck, so the deck and the final round end the game.

### Results and views

#### C51 The outcome is shared: every seat has place 1 and the same score
`standings` is the same for every seat and equals the fireworks' score, and during play it equals the current sum.

#### C52 A timeout or resign ends the game as a co-op loss for everyone
The platform ends it, and the engine is not asked.

#### C53 Each seat's view hides its own hand and shows every other hand
A seat's own cards are hidden, the others' are exact, the deck shows only its size, and the fireworks and the discard pile are public.

#### C54 A spectator sees no hand during play and everything after the end
A spectator has no seat and so no sealed share.

#### C55 Clue marks are derived from the public log
For each card in a hand, the clues that touched it and the clues given while it was there that did not touch it are known to everyone.
