# Chess rules

Chess as defined by the FIDE Laws of Chess (Basic Rules of Play, Articles 1–5, plus the parts of Article 9 on draws that a computer can decide). This file is the **source of truth** for the engine in `packages/games/chess`. Display names (piece names, colours, end reasons) live in `packages/games/chess/src/theme.ts`.

## Sources and interpretations

**Sources:**
- FIDE Laws of Chess (handbook E.01, in force from 1 January 2023): Articles 1–5 (the moves, check, mate, stalemate, dead position), Article 9 (draws).
- The project plan for multi-game support (2026-10-02), and its research notes on edge cases, perft counts and the chess.com draw policy.
- chessprogramming.org "Perft Results" for the move-generator counts.

**Where FIDE leaves room or assumes an arbiter, we decided as follows:**

| Topic | Decision | Basis |
|---|---|---|
| Colours | Seat 0 is White and moves first; seat 1 is Black. | FIDE 1.2. Colour choice belongs to the lobby, not the engine |
| Automatic draws | Stalemate, threefold repetition, the fifty-move rule and insufficient material end the game **at once**, without a claim. | Online play has no arbiter to claim to; chess.com and lichess do the same. FIDE makes threefold and fifty moves *claimable* (9.2, 9.3) and makes fivefold and 75 moves automatic (9.6). A FIDE claim mode is **OPEN** (rules option `drawMode`) |
| Insufficient material | Only these are automatic: K v K, K+B v K, K+N v K, and positions with only kings and bishops whose bishops all stand on one square colour. | These are the positions where no sequence of legal moves can mate (FIDE 5.2.2, "dead position"). K+N+N v K, K+N v K+N, K+B v K+N and opposite-coloured bishops are **not** dead: a helpmate exists |
| Precedence | Checkmate beats every draw; a mating move is a win even if it is also the 100th halfmove (FIDE 9.3.2, 9.6). Then stalemate, insufficient material, repetition and fifty moves, in that order (all are draws, so the order only picks the `reason`). | FIDE 5.1.1, 9.6 |
| Repetition | "The same position" means the same placement, side to move, castling rights and en passant possibility. The en passant square counts **only if an en passant capture is actually legal**. Positions need not be consecutive; the starting position counts. | FIDE 9.2.2–9.2.3 |
| Draw offers | A draw offer rides on a move (`offerDraw: true`). It stands until the opponent's next action: the opponent accepts with `acceptDraw`, or declines by moving. | FIDE 9.1.2 (an offer is made after a move, before pressing the clock); asynchronous play needs it on the move itself |
| Resignation | **Not a module action.** The platform adds a generic resign event (any seat, at any time), handled like a forfeit (`rankWithForfeits`). | Resignation is platform-wide (PLAN Phase C2) |
| Time control | None in the engine. The platform's turn deadline and timeout forfeit apply. | PROTOCOL §8 |
| Timeout against insufficient material | A timeout is a platform forfeit **whatever the material**: the absent seat loses even when the other side has a lone king and could never mate. | FIDE 6.9 scores a flag fall as a draw when the opponent cannot mate by any series of legal moves. The platform's forfeit (PROTOCOL §8.2) knows no chess, and an asynchronous deadline is a missed turn, not a clock. Following FIDE 6.9 is **OPEN** (it would need the platform to ask the module how a forfeit scores) |
| Wire format | UCI long algebraic (`e2e4`, `e7e8q`). Castling is the king's move (`e1g1`). SAN is for display only. | Unambiguous, one encoding per move |
| Scores | Win 2, loss 0, draw 1 each. | Integers for the platform's outcome (half points ×2) |

## The board and pieces

- An 8×8 board. Squares are named `a1`–`h8` (file, then rank); White starts on ranks 1–2.
- Each side starts with a king, a queen, two rooks, two bishops, two knights and eight pawns, in the standard array (FEN `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`).
- Pieces move as in FIDE Article 3. A move may not leave the mover's own king attacked (3.9).

## Special moves

- **Castling** (3.8.2). The king moves two squares toward a rook, and that rook jumps to the square the king crossed. It is illegal if:
  - the king or that rook has moved (a right lost is lost for good, even if the piece returns);
  - that rook was captured on its home square (the right goes with it);
  - any square between the king and the rook is occupied (on the queenside that includes b1/b8);
  - the king is in check, crosses an attacked square (f1/d1, f8/d8), or would land on one. The rook's path (b1/b8) may be attacked.
- **En passant** (3.7.4). Right after an enemy pawn's double step past one of your pawns' capture squares, that pawn may capture it as if it had moved one square, **on that move only**. The captured pawn is removed from its own square. Legality is checked after both pawns are gone, so a capture that opens a line to the own king (along the rank, or along a diagonal) is illegal.
- **Promotion** (3.7.5). A pawn reaching the last rank must become a queen, rook, bishop or knight of its colour, with or without a capture. Each choice is a different move.

## End of game

| End | Result | `reason` |
|---|---|---|
| Checkmate: the side to move is in check and has no legal move | The mating side wins, 2–0 | `checkmate` |
| Stalemate: no legal move and not in check | Draw, 1–1 | `stalemate` |
| Insufficient material (the dead positions above) | Draw | `material` |
| The same position for the third time | Draw | `repetition` |
| 100 halfmoves (50 by each side) with no capture and no pawn move | Draw | `fifty-move` |
| A draw offer accepted | Draw | `agreement` |
| Resignation (platform event, PROTOCOL §8.3) | The platform ranks the resigning seat last | (platform: `resign`) |
| Timeout (PROTOCOL §8.2) | The platform ranks the absent seat last, even against a lone king (FIDE 6.9 is OPEN, see above) | (platform: `forfeit`) |

**Halfmove clock.** A capture or a pawn move resets it to 0; every other move adds 1, castling included. Losing castling rights does not reset it.

**Standings.** While play continues, `standings` is 1–1 (an even game); at the end it equals the final scores.

## Moves on the wire

- `{type: 'move', actor, uci}`. `actor` is the seat to move (0 or 1). `uci` matches `^[a-h][1-8][a-h][1-8][qrbn]?$`: lowercase, the promotion letter present **exactly** when a pawn reaches the last rank. Castling is written as the king's two-square move: `e1g1`, `e1c1`, `e8g8`, `e8c8`.
- The same with `offerDraw: true` offers a draw. The key is present only when true; `offerDraw: false` is rejected, so every move has one encoding.
- `{type: 'acceptDraw', actor}`: only by the seat to move, only while the opponent's offer from its last move stands.
- Anything else is rejected: unknown or extra keys, uppercase, `0000` (the UCI null move), a missing or extra promotion letter, the king-takes-rook castling form, a non-integer actor.

## Hidden information

None. Chess has no decks (`decks(rules) = []`), so `dealt`, `knownTo` and `revealsOf` are always empty, and `view` returns the whole state for every viewer. `learn` always returns an error (`no-hidden`): there is nothing to learn, so a learn record is a bug in the caller.

## Rule options (`ChessRules`)

| Option | Default | Notes |
|---|---|---|
| `rulesVersion` | `1` | Bumped when an option's meaning changes |
| `drawMode` | `'auto'` | The only value. **OPEN:** a FIDE claim mode (`'claim'`), where threefold and fifty moves are claimed by the player to move and fivefold and 75 moves end the game automatically |

## Edge-case catalog

Each entry has a named test in `packages/games/chess/test/catalog/` whose title starts with its id. `tests/catalog.test.ts` fails if any id below has no test, or any catalog test has no entry.

**Notation:** positions are given as FEN. A move list such as `e2e4 e7e5` alternates seats starting with the side to move. "Rejected (`code`)" names the engine error code.

### Setup and encoding

#### C01 The start position: seat 0 is White and moves first
**Setup:** a new game for two seats.
**Expected:** the standard array, White to move, castling `KQkq`, 20 legal moves, every seat's view identical. Setup with 1 or 3 seats is rejected (`seats`).

#### C02 Castling is written as the king's move
**Setup:** `r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1`.
**Expected:** `e1g1` and `e1c1` castle. `e1h1` and `e1a1` (king takes own rook) are rejected (`illegal`).

#### C03 Non-canonical encodings are rejected
**Setup:** the start position.
**Expected:** rejected (`malformed`): `E2E4`, `e2e4 ` (trailing space), `0000`, `e2-e4`, an extra key, `offerDraw: false`, `offerDraw: 1`, actor `'0'` or `0.5`, a missing actor, an unknown type. `e2e4` itself is accepted.

#### C04 The promotion letter is required exactly when a pawn reaches the last rank
**Setup:** `8/4P3/8/8/8/8/k7/4K3 w - - 0 1`.
**Expected:** `e7e8` (missing letter) is rejected (`illegal`); `e7e8Q` is rejected (`malformed`). From the start, `e2e4q` (extra letter) is rejected (`illegal`).

#### C05 Only the seat to move may act, and nothing after the end
**Setup:** the start position; then a finished game (Fool's mate).
**Expected:** a move by seat 1 at the start is rejected (`turn`). After mate, every move and `acceptDraw` is rejected (`over`).

### Castling

#### C06 Castling on both sides moves the rook
**Setup:** `r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1`.
**Expected:** after `e1g1`, the king is on g1 and the rook on f1; after `e1c1` (from the same position), the king is on c1 and the rook on d1. Black's `e8g8` and `e8c8` mirror this. SAN is `O-O` and `O-O-O`.

#### C07 A king move loses both rights for good
**Setup:** `r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1`, then `e1f1 e8f8 f1e1 f8e8`.
**Expected:** the king is home again, but castling is `-` and `e1g1` is rejected.

#### C08 A rook move loses that side's right only
**Setup:** `r3k2r/p7/8/8/8/8/8/R3K2R w KQkq - 0 1`, then `h1h2`.
**Expected:** castling is `Qkq`. After `a7a6 h2h1 a6a5` (the rook is home again) it is still `Qkq`: `e1g1` is illegal and `e1c1` legal.

#### C09 Capturing a rook on its home square removes that right
**Setup:** `r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1`, then `a1a8`.
**Expected:** castling is `Kk`: White lost the queenside right (its rook moved), Black lost the queenside right (its rook was captured).

#### C10 No castling out of check
**Setup:** `r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1` (the e2 rook checks).
**Expected:** neither `e1g1` nor `e1c1` is legal.

#### C11 No castling through an attacked square
**Setup:** `r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1` (f1 attacked), and `r3k2r/8/8/8/8/8/3r4/R3K2R w KQkq - 0 1` (d1 attacked).
**Expected:** `e1g1` is illegal in the first, `e1c1` in the second; the other side's castling stays legal.

#### C12 No castling into check
**Setup:** `r3k2r/8/8/8/8/8/6r1/R3K2R w KQkq - 0 1` (g1 attacked), and `r3k2r/8/8/8/8/8/2r5/R3K2R w KQkq - 0 1` (c1 attacked).
**Expected:** `e1g1` is illegal in the first, `e1c1` in the second.

#### C13 Queenside castling: b1 may be attacked but must be empty
**Setup:** `r3k2r/8/8/8/8/8/1r6/R3K2R w KQkq - 0 1` (b1 attacked), and `r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1` (knight on b1).
**Expected:** `e1c1` is legal in the first and illegal in the second.

#### C14 A piece between king and rook blocks castling
**Setup:** `r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1`.
**Expected:** `e1g1` is illegal; `e1c1` is legal.

### En passant

#### C15 En passant captures the pawn on its own square, right after the double step
**Setup:** `4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1`, then `d2d4`.
**Expected:** the FEN shows `d3`. `e4d3` puts the black pawn on d3 and empties d4; SAN `exd3`. The halfmove clock is 0.

#### C16 The en passant right expires after one move
**Setup:** as C15, then `d2d4 e8d8 e1d1`.
**Expected:** `e4d3` is illegal.

#### C17 En passant that exposes the king along the rank is illegal
**Setup:** `8/8/8/8/k2p3R/8/4P3/4K3 w - - 0 1`, then `e2e4`.
**Expected:** `d4e3` is illegal (the black king on a4 would face the rook on h4 once both pawns leave the rank), so the FEN after `e2e4` shows `-` for en passant.

#### C18 En passant may capture a checking pawn
**Setup:** `8/8/8/5k2/3p4/8/4P3/4K3 w - - 0 1`, then `e2e4`, which checks the king on f5.
**Expected:** Black is in check and the en passant square is `e3`; `d4e3` is legal, removes the checking pawn and ends the check.

#### C19 En passant by a pinned pawn is illegal
**Setup:** `1B6/8/8/8/5p2/6k1/4P3/4K3 w - - 0 1` (the f4 pawn is pinned to the g3 king by the bishop on b8), then `e2e4`.
**Expected:** `f4e3` would leave the b8–h2 diagonal, so it is illegal, and the state keeps no en passant square.

### Promotion

#### C20 Promotion to each piece, with or without a capture
**Setup:** `3r4/4P3/8/8/8/8/k7/4K3 w - - 0 1`.
**Expected:** eight promotion moves: `e7e8q/r/b/n` and `e7d8q/r/b/n`. Each places the chosen piece; SAN `e8=Q`, `exd8=N` and so on. The halfmove clock resets.

#### C21 Underpromotion to a knight can give check
**Setup:** `8/4P1k1/8/8/8/8/8/K7 w - - 0 1`, then `e7e8n` (a queen on e8 would not check the king on g7).
**Expected:** SAN `e8=N+`, and the moved event reports promotion `n` with check.

### Check, mate and stalemate

#### C22 A pinned piece may not move off the pin line
**Setup:** `4k3/4r3/8/8/8/8/4N3/4K3 w - - 0 1` (the knight on e2 is pinned).
**Expected:** no knight move is legal; king moves are.

#### C23 Discovered check
**Setup:** `4k3/8/8/8/8/8/4N3/4R2K w - - 0 1`.
**Expected:** a knight move off the e-file checks; SAN ends in `+`, and Black is in check.

#### C24 Double check allows only king moves
**Setup:** `4k3/8/2r5/8/4N3/8/8/K3R3 w - - 0 1`, then `e4d6`: the knight checks and uncovers the rook on e1.
**Expected:** every legal reply is a king move; `c6d6` (capturing the knight) is not legal. Without the e1 rook, `c6d6` is legal.

#### C25 Checkmate ends the game: 2–0
**Setup:** the start position, then Fool's mate `f2f3 e7e5 g2g4 d8h4`.
**Expected:** reason `checkmate`, winner seat 1, scores `[0, 2]`, places `[2, 1]`. The last SAN is `Qh4#`.

#### C26 Stalemate is a draw: 1–1
**Setup:** `7k/8/8/6Q1/8/8/8/K7 w - - 0 1`, then `g5g6`: Black is not in check and has no legal move.
**Expected:** reason `stalemate`, no winner, scores `[1, 1]`, places `[1, 1]`.

#### C27 Mate takes precedence over the fifty-move rule
**Setup:** `6k1/5ppp/8/8/8/8/8/R5K1 w - - 99 80`, then `a1a8` (a quiet back-rank mate).
**Expected:** the clock reads 100, and the result is `checkmate` for seat 0, not `fifty-move`.

#### C28 Stalemate on the hundredth halfmove is reported as stalemate
**Setup:** C26's position with the clock at 99: `7k/8/8/6Q1/8/8/8/K7 w - - 99 80`, then `g5g6`.
**Expected:** the clock reads 100; reason `stalemate`.

### Threefold repetition

#### C29 Threefold repetition draws at once; the start position counts
**Setup:** the start position, then `g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8`.
**Expected:** the start position occurs for the third time after the eighth move: reason `repetition`. After seven moves the game is still on.

#### C30 Repetitions need not be consecutive
**Setup:** the start position, then `g1f3 g8f6 f3g1 f6g8 b1c3 b8c6 c3b1 c6b8`.
**Expected:** the start position recurs after moves 4 and 8, with other positions between: the eighth move draws.

#### C31 Different castling rights make a different position
**Setup:** `r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1`; the kingside rooks shuffle `h1h2 h8h7 h2h1 h7h8` and repeat.
**Expected:** after move 8 the start placement stands for the third time with White to move, but the first time had `KQkq`, so the game goes on. The position after move 2 (rights already lost) recurs after moves 6 and 10: the tenth move draws.

#### C32 The side to move is part of the position
**Setup:** `4k3/8/8/8/8/8/8/R3K3 w - - 0 1`; the rook cycles `a1a3 a3a2 a2a1` (three moves) while the king cycles `e8d8 d8e8` (two), so placements recur with alternating sides to move.
**Expected:** after move 12 the start placement has stood three times (twice with White to move, once with Black), and the game goes on. The draw comes at move 24, the third time with White to move.

#### C33 A double step with no legal en passant capture makes no new position
**Setup:** from the start, `e2e4 e7e5 g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8`.
**Expected:** after `e7e5` no en passant is possible, so the position after `e7e5` equals the one after each knight return: the third occurrence draws.

#### C34 A legal en passant capture makes the position different
**Setup:** `1n2k3/8/8/8/4p3/8/3P4/1N2K3 w - - 0 1`, then `d2d4` (en passant `d3` is legal), then the knights shuffle `b8c6 b1c3 c6b8 c3b1` twice.
**Expected:** after move 9 the placement after `d2d4` has stood three times, but the first time with en passant possible: the game goes on.

#### C35 An en passant capture that is pseudo-legal but illegal does not count
**Setup:** C17's position, then `e2e4` and the kings shuffle `a4a5 e1d1 a5a4 d1e1` twice.
**Expected:** the position after `e2e4` counts as the same as the later ones: the ninth move draws.

### Fifty-move rule

#### C36 One hundred halfmoves without a capture or pawn move draw at once
**Setup:** `4k3/8/8/8/8/8/8/R3K3 w - - 98 80`, then two quiet moves.
**Expected:** after the first the clock is 99 and the game is on; after the second it is 100 and the result is `fifty-move`.

#### C37 A pawn move resets the clock
**Setup:** `4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80`, then `e2e3`.
**Expected:** the clock is 0 and the game is on.

#### C38 A capture resets the clock
**Setup:** `4k3/8/8/8/8/8/r7/R3K3 w - - 99 80`, then `a1a2`.
**Expected:** the clock is 0; the game goes on (K+R v K is not a dead position).

#### C39 Castling and the loss of castling rights do not reset the clock
**Setup:** `r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 10 30`, then `e1g1`, then `a8b8`.
**Expected:** the clock reads 11 and then 12.

### Insufficient material

#### C40 King against king
**Setup:** `4k3/8/8/8/8/8/3p4/4K3 w - - 0 1`, then `e1d2` (the king takes the last pawn).
**Expected:** reason `material`.

#### C41 King and bishop against king
**Setup:** `4k3/8/8/8/8/8/8/2B1K3 w - - 0 1` as a FEN import, and the same with a black bishop.
**Expected:** the imported state is already drawn by `material`.

#### C42 King and knight against king
**Setup:** `4k3/8/8/8/8/8/8/1N2K3 w - - 0 1`.
**Expected:** reason `material`.

#### C43 Kings and bishops all on one square colour
**Setup:** `4k3/8/8/8/8/8/1b6/2B1K3 w - - 0 1` (c1 and b2 are both dark), `4k3/8/8/8/8/4B3/1b6/2B1K3 w - - 0 1` (three bishops, all dark), and `4k3/8/8/8/2b5/8/8/4KB2 w - - 0 1` (f1 and c4, both light).
**Expected:** reason `material` in each.

#### C44 Two knights against a king are not a dead position
**Setup:** `4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1`.
**Expected:** no result.

#### C45 Knight against knight, and bishop against knight, are not dead positions
**Setup:** `4k3/8/8/8/8/8/1n6/1N2K3 w - - 0 1` and `4k3/8/8/8/8/8/1n6/2B1K3 w - - 0 1`.
**Expected:** no result.

#### C46 Opposite-coloured bishops are not a dead position
**Setup:** `4k3/8/8/8/8/1b6/8/2B1K3 w - - 0 1` (b3 light, c1 dark).
**Expected:** no result.

#### C47 Any pawn, rook or queen keeps the game alive
**Setup:** K+P v K, K+R v K, K+Q v K; then `4k3/8/8/8/8/2r5/8/1N2K3 w - - 0 1`.
**Expected:** no result. In the last position `b1c3` (taking the rook, leaving K+N v K) ends the game at once by `material`; `b1d2` does not.

### Draw offers

#### C48 A draw offer rides on a move and may be accepted on the next turn
**Setup:** the start position, `e2e4` with `offerDraw: true`.
**Expected:** `drawOffer` is seat 0, a `drawOffered` event; Black's legal actions include `acceptDraw`. After `acceptDraw` by seat 1: reason `agreement`, scores `[1, 1]`.

#### C49 Moving declines the offer
**Setup:** as C48, then Black plays `e7e5`.
**Expected:** a `drawDeclined` event; `drawOffer` is null; `acceptDraw` by seat 0 is rejected (`no-offer`), and later by seat 1 too.

#### C50 Only the opponent may accept, and only a standing offer
**Setup:** the start position; then after `e2e4` with an offer.
**Expected:** `acceptDraw` at the start is rejected (`no-offer`). After the offer, `acceptDraw` by seat 0 is rejected (`turn`).

#### C51 A counter-offer replaces the declined one
**Setup:** as C48, then Black plays `e7e5` with `offerDraw: true`.
**Expected:** `drawOffer` is seat 1; White may accept.

#### C52 An offer on a game-ending move is void
**Setup:** Fool's mate with `offerDraw: true` on `d8h4`.
**Expected:** reason `checkmate`; `drawOffer` is null, no `drawOffered` event, and the move's history record has `drawOffered: false` (the move list shows no offer).

### Results, views and resignation

#### C53 Standings are 1–1 during play and equal the final scores
**Setup:** a game in progress; a mate; a draw.
**Expected:** `[1, 1]` while playing; `[0, 2]` after Black mates; `[1, 1]` after a draw.

#### C54 Resignation is not a module action
**Setup:** the start position.
**Expected:** `{type: 'resign', actor: 0}` is rejected (`malformed`). Resignation is a platform event.

#### C55 Perfect information: no decks, identical views, nothing to learn
**Setup:** a game after a few moves.
**Expected:** `decks` is `[]`; `dealt`, `knownTo` and `revealsOf` are `[]`; `view(state, v)` equals the state for seats 0, 1 and spectators, and equals a view-mode setup replaying the same moves; `learn` returns `no-hidden`.

### Notation

#### C56 SAN disambiguation looks at legal moves only
**Setup:** `4k3/8/8/8/8/8/8/R4RK1 w - - 0 1` (file), `4k3/8/8/R7/8/8/8/R5K1 w - - 0 1` (rank), `2k5/8/8/8/4Q2Q/8/8/K6Q w - - 0 1` (three queens reach e1), and `4k3/8/8/8/1b6/2N5/8/4K1N1 w - - 0 1` (the c3 knight is pinned).
**Expected:** `Rad1`/`Rfd1`, `R1a3`/`R5a3`, `Qh4e1`/`Qee1`/`Q1e1`, and plain `Ne2` for `g1e2` (`Nge2` once the pinning bishop is gone).

#### C57 FEN writes the en passant square only when a capture is legal
**Setup:** from the start, `e2e4`; and C15's `d2d4`.
**Expected:** after `e2e4`, the FEN's en passant field is `-`; after C15's `d2d4`, it is `d3`. Importing a FEN with an en passant square that allows no legal capture drops it.
