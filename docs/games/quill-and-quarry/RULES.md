# Quill & Quarry

Original rules text. This implementation uses the English-language 100-tile inventory, 15 × 15 board, and North American double-challenge / six-scoreless-turn convention. These are the mechanics of Scrabble under that convention; regional editions and tournament organizations differ in vocabulary, challenge penalties, and end conditions. No licensed word list, logos, artwork, branded equipment, or published rules text is included. The working name needs independent trademark clearance.

## Goal and equipment

Two to four people compete for the greatest final score. Each has a rack holding up to seven tiles. There are 100 physical tile identities, including two zero-value blanks. `src/data.ts` is the inventory and coordinate specification. Letters have the standard English frequencies and values. The field is a square of fifteen rows and fifteen columns; premium positions have their established mechanical arrangement, with original colors, symbols and visual treatment. The center is a double-word square.

## Before play

Agree on an English dictionary **and edition**. Except for proper names, abbreviations, words requiring punctuation, and standalone affixes, its word entries and inflections are available. The implementation deliberately ships no proprietary word list. Dictionary judgments are human reports, not claims that the cryptographic audit can verify.

Each seat draws one tile publicly. The earliest alphabetical letter wins the opening turn; a blank is earlier than A. Only tied seats draw again until one wins. Return every starting tile and remix all 100 tiles. Deal seven tiles to each player. Play follows the fixed seat order from the opening seat.

## A turn

Choose one of these actions:

- **Place:** Use one to seven rack tiles, in a straight row or column, making words read left-to-right or top-to-bottom. The opening play uses two or more tiles and covers the center. Every later play connects to the existing board. Old letters may fill gaps, but no empty square may interrupt the run. Every newly formed run of two or more letters must be a word. Old tiles cannot be moved or replaced. A blank takes the letter the player names for it; that assignment lasts as long as it stays on the board. A removed blank may be named anew on a later play.
- **Exchange:** Only with seven or more tiles left in the bag, set aside one to seven rack tiles. Draw the same number from the current bag *before* returning the set-aside tiles. Then remix the returned tiles with the remaining bag. Score zero and use the turn.
- **Pass:** Keep the rack and score zero. Passing is allowed even when a placement exists.

A play is provisional until the opponents' review ends. After an accepted play, refill to seven tiles, or draw the entire remainder if fewer are left.

## Scoring

For each newly formed word, add its letters' face values. Apply a letter premium only to a tile newly occupying it: 2L doubles that letter, 3L triples it. Then multiply the word by every newly covered word premium: 2W doubles, 3W triples. Multiple word premiums multiply together. Old tiles count at face value and never activate their old premiums again. A new tile that forms both a horizontal and vertical word contributes its value and its new premiums to both words. Blanks always contribute zero but activate word premiums normally. Add 50 points after word scoring when exactly seven tiles were placed; emptying a shorter rack earns no such bonus.

## Review and double challenges

Each opponent has a chance, in seat order, to accept or challenge before the rack refill. An accepted play stands even if a word is discovered invalid later.

A challenge checks every word formed by the play against the table's agreed dictionary. The challenger records the lookup result. One invalid word removes the entire play, cancels its points, and returns all its tiles to its player's rack; that player's turn is lost. If all words are valid, accept the play and skip the challenger's next turn. There is no additional points penalty. Non-adjacent challengers have their next turn marked to be skipped; intervening players take their usual turns.

The site has no dictionary oracle or server referee. A dishonest lookup report is **not detected by the end audit**. This is a trusted-table vocabulary mode, clearly labeled in the UI. A licensed deterministic lexicon and selectable alternate challenge conventions remain future work, not silently approximated features.

## Ending

An accepted play that empties a rack when the bag is empty ends the game. Six consecutive turns scoring zero also end it: passes, exchanges, invalidated plays, zero-point accepted plays and skipped turns count. An accepted positive score resets the counter. After six, the only player action offered is **Finalize scores**; there is no arbitrary move limit or extra platform stall rule.

Reveal the remaining racks, subtract each rack's face-value total from its owner, and, if a player went out, add the other players' deductions to that player's score. Blanks cost zero. Highest final score wins; ties share a place.

## Online protocol choices

One encrypted `pile` of 100 unique tile identities; the generic deck-epoch protocol remixes the whole bag after the starting draw, then only undrawn and returned tiles on an exchange. Opening positions are 0–99, epoch positions are `128 * epoch + index`. The new rack is dealt **before** an exchange epoch, so returned tiles cannot be redrawn immediately. Identity duplication is mechanically rejected and checked again by proofs / the final audit.

`promptShares` is enabled under D075. Public starting draws and final rack reveals use standard reveal actions. `handsReveal` is true only while final racks are being scored. Already-public tiles returned after an invalid play remain publicly known in the rack; an exchange hides their new position. `dealt` is append-only. `validateIntent` handles canonical placement and exchange forms; pass, review, ruling and finalization are finite legal choices. Resign stays disabled at every seat count: an early key could reveal returned tiles, and scoring reveals need a dedicated D052 review. Platform timeout controls remain available.

## Rules catalog

#### C01 Inventory and premiums
100 tiles, 187 face-value points in the bag, two blanks; 24 double-letter, 12 triple-letter, 17 double-word (including the center), and eight triple-word squares.
#### C02 Setup validation
Two through four seats, exact rules keys and a complete deck permutation.
#### C03 First-player draw and ties
Draw alphabetically, repeat ties, then restore all starting tiles before dealing.
#### C04 Blank in the opening draw
A blank precedes A.
#### C05 Opening placement
At least two letters and the center, horizontally or vertically.
#### C06 Placement geometry
No bends, disconnected words, internal holes or overwriting existing tiles.
#### C07 Existing letters
New tiles may bridge through old letters.
#### C08 Cross-word scoring
Score each newly formed word and its fresh premiums.
#### C09 Premium stacking
Letter multipliers precede multiplicative word premiums.
#### C10 Premium exhaustion
Old tiles never reactivate premiums.
#### C11 Blanks
A declared letter stays fixed; its value stays zero.
#### C12 Seven-tile bonus
Exactly seven new tiles earn fifty extra points.
#### C13 Review and refill
All opponents review before points commit and the rack refills.
#### C14 Successful challenge
Remove the whole play, restore tiles, score zero, lose the player's turn.
#### C15 Unsuccessful challenge
Accept the play and skip the challenger's next turn, including non-adjacent challengers.
#### C16 Exchange order and conservation
Draw replacements before remixing the returns; preserve all 100 identities.
#### C17 Exchange eligibility
At least seven tiles in the bag, and only distinct owned positions in canonical order.
#### C18 Pass and scoreless finish
Passing is voluntary; six scoreless turns require explicit score finalization.
#### C19 Resetting scoreless turns
An accepted positive score resets the counter.
#### C20 Going out and rack deductions
Subtract racks and award the deductions to the player who goes out.
#### C21 Ties
Equal final totals share their finishing place.
#### C22 Information boundaries
Hide other racks and bag orders; public information remains public.
#### C23 Canonical action and tile checks
Reject forged tiles, repeats, extra keys and wrong actors; never mutate input.
#### C24 Epoch and ending authenticity
Check shuffled multisets and revealed identities; disable early key disclosure.
