# Bank rules

Bank, the folk push-your-luck dice game. This file is the **source of truth** for the engine in `packages/games/bank`. Display names live in `packages/games/bank/src/theme.ts`. The public title is Bank. This is not a commercial edition: there is no Shield, no secret simultaneous banking, no timer, and no Bank Run or Speed Banker.

## Sources and interpretations

**Sources:**

- Family Game Shelf, "How to Play the Bank Dice Game" (2024).
- BoardGameGeek 412804, Bank.
- ThunderHive's public description of the dice game BANK, for the scoring only.

**Where those sources leave room, we decided as follows (D058):**

| Topic | Decision | Basis |
|---|---|---|
| Safe rolls | The first three rolls of **each round** are safe. | BGG and ThunderHive. Family Game Shelf says "of the game" once, then describes rounds |
| A safe 7 | Adds 70 to the pot. | All three sources |
| A safe double | Adds the face sum (2, 4, 6, 8, 10 or 12). It does not double the pot. | The sources special-case doubles only once busts are live |
| An unsafe 7 | Busts the round. Anyone who has not banked scores nothing more for it. A 7 is never doubles (1+6, 2+5, 3+4). | All three sources |
| An unsafe double | The pot doubles. The face sum is not also added. | All three sources |
| Any other roll | The face sum is added. | All three sources |
| Banking | Adds the current pot to that player's score, leaves the pot for everyone else, and that player sits out the rest of the round. Banking 0 is legal. | All three sources |
| Who may bank | By default, everyone still in the round, between rolls. The variant `turn` asks only the roller. | The table game is a shout. This site has no race window (GAME-SYSTEMS §4.8), so the default is a seat-order poll that pays the same. `turn` is a named option (§4.10) |
| Poll order | Non-rollers, in seat order starting after the roller, then the roller. The roller is never skipped. A seat who already stayed on this pot is skipped, unless they have since become the roller. | The pot does not change during the poll, and banking is public |
| A roller who already stayed | May only roll. They had their chance to bank this pot. | The poll asks each seat once per pot |
| Round end | A bust, every player still in having banked, or 30 resolutions. | The 30-roll cap is this site's rule so a round cannot run forever (D015) |
| The 30th roll | If it is not a bust, everyone still in banks the pot and the round ends. If it busts, the bust stands and nobody is paid for a wiped pot. | The cap is an end, not a second payout |
| Next roller | The seat after whoever took the last human action of the round: the bust roller, the last banker, or the roller of the capping roll. | The dice move around the table |
| Seats | 2 to 6. Best at 3 to 5. More than 6 is **OPEN** and unbuilt. | The sources; a larger table is a different poll |
| Rounds | 5, 10 or 20. The default is 10. | A short game is 5; 20 is a long one |
| Ties | Places share the gap: two firsts, the next score is third. | The platform's outcome (1, 1, 3) |
| Fair dice | Every seat contributes to a key-committed beacon. The faces are derived, not sent. Contributions go out on their own, because the roll is the same for every seat. | GAME-SYSTEMS §4.3, D058; for engine 0.2.0, PROTOCOL-v2 §6.2 and D060. This is not a hidden-information prompt (D050) |
| Resignation | Not a module action. Two seats: rated. Three or more: unrated, the resigner last. | D052. Bank has no deck secret to attach |

## Engine versions

Two versions of the engine ship (PROTOCOL-v2 §2 items 5 and 6; D060). Every rule in this file holds for both, except where a rule names one version.

| Version | Protocol | After a Roll | Contributions |
|---|---|---|---|
| 0.2.0, the current engine | 2 only | The beacon pends at once. No seat has a decision until the faces are applied. | Every seat, the roller included, sends a roll Shares event bound to the Roll move, in any order (PROTOCOL-v2 §6.2). There is no `contribute` action. |
| 0.1.0, for v1 games in progress | 1 only | Each other seat is asked for a `contribute` turn. | Turns in a fixed order that ends on the seat after the roller (PROTOCOL §6.3a, D058). |

- New tables use 0.2.0.
- A client never creates or joins a protocol 1 Bank table. It keeps folding protocol 1 Bank games already in progress, with 0.1.0, which the app registers as `bank@0.1.0`.
- Both versions take the same rule options, the same setup and the same banking, pot and round rules. Their states have the same shape. Under 0.2.0 the `collect` phase never occurs, `owe` is always empty, and each roll's schedule entry has `last: null`, because any seat may contribute last.
- The roll list differs. Under 0.2.0 it holds `{id, count: 2, sides: 6}` (a protocol 2 roll entry). Under 0.1.0 it holds `{id, last}`. Only 0.1.0 has `beaconOf`.

## The pot

- Two dice, each showing 1 to 6.
- The pot starts at 0 each round. Scores start at 0 and carry across rounds.
- A resolution is safe while fewer than three resolutions have happened **this round**.
- Safe and the sum is 7: add 70.
- Safe otherwise: add the sum. Doubles are not special.
- Unsafe and the sum is 7: the round busts. The pot becomes 0. Seats still in score nothing more.
- Unsafe and doubles: replace the pot with twice the pot. Do not also add the sum.
- Otherwise: add the sum.
- Money is a safe integer. A resolution that would leave that range is rejected. It does not come up in a 30-roll round.

## Banking

Between resolutions, while the round is open:

- **An unrolled round.** The pot is 0 and nobody has rolled yet. The roller is asked to roll, and that is the only action. Bank and Stay are rejected. This is the start of every round, including the first.
- **Table** (the default), once this round has a roll. Walk the seats after the roller, wrapping around. Skip anyone already out, and anyone who has stayed on this pot, but never skip the roller. The roller is therefore last.
  - A non-roller chooses **Bank** or **Stay**.
  - The roller chooses **Bank** or **Roll**. Stay is rejected.
  - A seat who stayed earlier, and later became the roller because the previous roller banked, chooses **Roll** only.
- **Turn.** Only the roller is asked, and only for **Bank** or **Roll**. There is no Stay. A bust can happen before the other seats are offered the pot. This is a different game; the table names it.
- **Bank** adds the current pot to that seat's score and removes them from the round. The pot is unchanged. An empty pot cannot be banked. If the banker was the roller and someone is still in, the next seat still in becomes the roller.
- **Stay** records the seat. The pot, the scores and who is in are unchanged.
- The pot does not change during the poll. After a resolution that continues the round, the stays are forgotten and the poll starts again with the same roller.

## How a roll is committed

The roller names the next roll id and does not send faces. The pot is unchanged.

**Engine 0.2.0.**
- The beacon pends at once.
- Every seat, the roller included, publishes its contribution in a roll Shares event bound to the Roll move (PROTOCOL-v2 §6.2). They can arrive in any order.
- An open window sends its contribution on its own. There is no button: the roll is one public result, and every seat is deciding on it.
- The roller can contribute only once its Roll is signed, since the roll point needs the Roll's id. So it learns nothing before it rolls.
- Whoever contributes last learns the faces first. That seat can only withhold, not choose them.
- While the beacon pends, every seat without a contribution is stalled. A closed window withholds by doing nothing, and that is the platform's timeout (PROTOCOL-v2 §6.4).

**Engine 0.1.0.**
- Every other seat publishes its share as a `contribute` turn, in an order that **ends on the seat after the roller** (D058).
- An open window sends that share on its own. There is no button.
- The last publisher learns the faces first and can only withhold, not choose them.
- A closed window withholds by doing nothing, and that is the platform's timeout (PROTOCOL §8.2).

**Both versions.** When every contribution is in, the session derives the two faces and applies them. A second resolution of the same id is rejected. Faces outside 1..6 are rejected. A player does not send the faces.

## How a round ends

| End | Who is paid | Next roller |
|---|---|---|
| Bust (an unsafe 7) | Nobody who was still in. Earlier banks stand. | The seat after the roller who rolled the 7 |
| Everyone still in has banked | Each of them already took the pot, once | The seat after the last banker |
| The 30th resolution, and it was not a bust | Everyone still in banks the pot, then the round ends | The seat after the roller of that roll |
| The 30th resolution, and it busted | The bust. The cap does not pay a wiped pot | The seat after that roller |

The next round starts at pot 0, with everyone in, no stays, and the safe-three count back at zero. Roll ids are never reused. After the last round the game is over.

## How the game ends

The highest score wins. `reason` is `score`. Tied scores share a place, and the next lower score skips to the following place (two scores tied for first: places 1, 1, 3).

While the game continues, `standings` is the score of each seat. At the end it equals `outcome.scores`. A timeout ranks the absent seat last by the platform's rule (higher score is better), whatever this module reports.

Resignation is a platform event. It is not in this module.

## Playing on this site

- **The dice.** After the roller commits a roll, each open window sends its share: every window with engine 0.2.0, the roller's included, and every other window with 0.1.0. The faces appear when those shares are in. There is no tap, because there is nothing to hide. A window that stays closed can still hold its share back, and the others can claim that seat's timeout.
- **The 30-roll cap**, above. A round of non-sevens would otherwise never end (D015).
- **Resign** and **timeouts** are the platform's (PROTOCOL §8). Bank has no hidden cards, so a resign attaches no deck secret.
- There is no one-minute timer and no secret banking.

## Hidden information

None. `decks(rules)` is empty, so `dealt`, `knownTo` and `revealsOf` are always empty, and `view` returns the whole state. `learn` returns `no-hidden`. The dice beacon is a fairness protocol, not a hidden hand: once the faces are derived, every seat sees them.

## Moves on the wire

One encoding each. Unknown keys, a missing actor, a non-integer actor, and a flag present as `false` are rejected.

- `{type: 'bank', actor}` — the pending seat banks the current pot.
- `{type: 'stay', actor}` — a non-roller, in a table game, stays.
- `{type: 'roll', actor, rollId}` — the roller commits roll `rollId`, which must be the next id. No faces.
- `{type: 'contribute', actor, rollId}` — engine 0.1.0 only: the pending seat contributes to the open roll. Engine 0.2.0 rejects the type as unknown (`malformed`): its contributions are roll Shares events, not moves.
- `{type: 'rolled', actor: 'beacon', id, dice: [a, b]}` — derived, not sent by a player. `a` and `b` are integers from 1 to 6, and `id` is the open roll. A `rolled` action with any other actor, such as a seat, is `malformed` in both versions. The session also refuses any player-sent `rolled` before it reaches the engine.

## Rule options (`BankRules`)

| Option | Default | Legal |
|---|---|---|
| `rulesVersion` | `1` | `1` |
| `rounds` | `10` | `5`, `10`, `20` |
| `banking` | `'table'` | `'table'`, `'turn'` |
| `maxRollsPerRound` | `30` | `30` only. A longer cap is **OPEN** |

## Edge-case catalog

#### C01 Setup of three seats asks the roller to roll, with an empty pot

Seat 0 is the roller and the only seat asked. The action is roll. Pot and scores are 0. Bank and Stay are rejected.

#### C02 The default is ten rounds at the table, for two to six seats

`defaultRules` is version 1, 10 rounds, table banking, 30 rolls. One seat and seven seats are rejected.

#### C03 Rules other than the three options are rejected

Exactly the four keys. Rounds are 5, 10 or 20. Banking is `table` or `turn`. The cap is 30. Version is 1.

#### C04 Staying changes nothing but who has passed

Pot, scores and who is in stay put. The seat is recorded, and the next seat is asked.

#### C05 Banking pays the pot to that seat and leaves the pot

The score increases by the pot. The seat is out. The pot is the same number.

#### C06 Two seats can bank the same pot

The second bank of an equal pot is the shared bank the fuzzer counts.

#### C07 An empty pot cannot be banked

Before the first roll of a round, banking is rejected. The seat stays in and the score stays 0. The same is true at the start of the next round.

#### C08 A seat who banked is not asked again

The walk skips them for the rest of the round.

#### C09 A roller who banks hands the dice to the next seat still in

The pot stays. The new roller is the next seat who has not banked.

#### C10 A seat who stayed and then becomes the roller may only roll

Bank and Stay are rejected. They already passed on this pot.

#### C11 The turn variant asks only the roller to bank or roll

At the start the roller may only roll. Stay is rejected from every seat. After a roll, the roller may bank or roll. When the roller banks, the next seat still in becomes the roller and is asked.

#### C12 A safe roll adds the face sum

The first roll of 1 and 2 makes the pot 3. No stay was asked before it, and the passed list is empty.

#### C13 A safe seven adds 70

1 and 6 on a safe roll add 70, not 7.

#### C14 A safe double adds the pips, and does not double

Double 1s on a safe roll add 2. The pot does not become 0.

#### C15 An unsafe roll that is not a seven or a double adds the face sum

After three safe rolls, 1 and 3 add 4.

#### C16 An unsafe double doubles the pot and does not also add the pips

A pot of 9 doubled by 2 and 2 becomes 18, not 13.

#### C17 An unsafe seven busts the round and keeps what was already banked

A seat who banked 9 keeps it. The pot becomes 0. The next round starts.

#### C18 Rolling commits the next id and does not change the pot

The roll action carries the next id and no faces. The pot and the resolution count stay put until the faces are applied. Engine 0.1.0: the roll opens the collection, the roll owes the roller's beacon share (`beaconOf`), and a bank action owes none.

#### C19 Engine 0.1.0: contributions are every other seat, ending on the seat after the roller

Four seats, roller 0: seats 2, then 3, then 1. Six seats, roller 3: 5, 0, 1, 2, 4. Two seats: the other seat.

#### C20 The wrong seat, the wrong id and a second resolution are rejected

A roll id must be the next one. The same id does not resolve twice. Engine 0.1.0: a contribution must be the pending seat and the open id.

#### C21 Faces outside 1 to 6 are rejected

0, 7, a single face, three faces and a fractional face are rejected. The roll stays open.

#### C22 The next roller is the seat after the last actor, and the safe rolls start over

A bust by seat 0 makes seat 1 the next roller. A 7 in the new round adds 70.

#### C23 The game is over after the chosen number of rounds

Five rounds, each ended by a bust, and the game is over. Pending is `over`. Scores that never left 0 stay 0.

#### C24 The 30th roll banks everyone still in, unless it busts

Thirty adds of 3, from a pot that the three safe rolls brought to 9, pay 90 to each seat still in and end the round. A 7 on that 30th roll busts instead and pays nobody.

#### C25 A tie shares first place and the next score is third

Scores 10, 10 and 0 place 1, 1 and 3.

#### C26 Standings match the scores, the view is the whole state, and nothing is hidden

`standings` is the score array during play and equals the final scores. `view` is the state. `learn` is `no-hidden`. There is no deck.

#### C27 Extra keys and a false flag are rejected

`stay: false`, a string actor, a missing actor, an unknown type and a throwing getter are malformed. The state is unchanged.

#### C28 A new round asks the roller to roll before anyone banks

Round 1 asks seat 0 to roll. After a bust, the next roller is asked to roll, and the other seats have no action yet.

#### C29 A bust pays nobody who is still in the round

The only bank in the log is the one taken before the bust.

#### C30 The roller cannot stay

Stay from the roller is rejected. The roller banks or rolls.

#### C31 A pot that would leave the safe integers is rejected

Adding to, or doubling, a pot already at the limit is rejected. The state is unchanged.

#### C32 Engine 0.2.0: a roll pends the beacon at once

After the roll, the beacon pends for that roll id. There is no `collect` phase, nobody owes a turn, and no seat has a legal action until the faces are applied. The faces then resolve as usual.

#### C33 Engine 0.2.0: each roll is a roll entry of two six-sided dice

Each roll appends `{id, count: 2, sides: 6}` to the roll list. Ids are never reused, across rounds too, and the list only grows. Engine 0.1.0's list holds `{id, last}` instead.

#### C34 Engine 0.2.0: there is no contribute action and no beaconOf

`contribute` is rejected as `malformed` in every phase, for every seat and every roll id. The module has no `beaconOf`.

#### C35 A player-sent rolled is rejected

A `rolled` action whose actor is a seat, or anything but `beacon`, is `malformed`, in both versions and in every phase. The state is unchanged.

#### C36 Engine 0.2.0 runs under protocol 2 only, engine 0.1.0 under protocol 1 only

The current module, Bank 0.2.0, declares protocol 2 only. Bank 0.1.0 declares protocol 1 only. Both have the id `bank`.
