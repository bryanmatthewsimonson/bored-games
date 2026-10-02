/*
 * Pure helpers for the Chess screen: board order, square labels, the move list, the status line and the result.
 * No DOM and no hooks, so they are unit-tested directly. The engine's display helpers (`legalMovesFrom`,
 * `checkedKingSquare`, `pieceAt`, ...) do the chess; this file only words and orders it.
 */
import {
  type ChessAction,
  type ChessState,
  checkedKingSquare,
  type LegalMove,
  lastMove,
  legalMovesFrom,
  type MoveRecord,
  type Piece,
  type PromotionLetter,
  pieceAt,
} from '@bored-games/chess';
import { CHESS_THEME, pieceName } from '@bored-games/chess/theme';
import type { Outcome } from '@bored-games/protocol';

const FILES = 'abcdefgh';

/** U+FE0E: show the chess symbols as text, not as emoji. */
export const TEXT_PRESENTATION = '︎';

/** The 64 square names in display order, top-left first: rank 8 down for White, rank 1 down for Black. */
export function boardSquares(flipped: boolean): string[] {
  const out: string[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = flipped ? row + 1 : 8 - row;
      const file = flipped ? 7 - col : col;
      out.push(`${FILES[file]}${rank}`);
    }
  }
  return out;
}

/** Whether a square is a dark one (a1 is dark). */
export function isDark(square: string): boolean {
  const file = FILES.indexOf(square[0] as string);
  const rank = Number(square[1]);
  return (file + rank) % 2 === 1;
}

/** The text glyph of a piece. */
export const glyph = (piece: Piece): string => `${CHESS_THEME.glyphs[piece]}${TEXT_PRESENTATION}`;

/** The colour (seat) a piece belongs to: 0 for White, 1 for Black. */
export const pieceSeat = (piece: Piece): number => (piece === piece.toUpperCase() ? 0 : 1);

/** The colour name of a seat. */
export const colorName = (seat: number): string => (seat === 0 ? CHESS_THEME.colors.w : CHESS_THEME.colors.b);

/** A square's accessible name: "e4, white knight", or "e4, empty". */
export function squareLabel(state: ChessState, square: string): string {
  const p = pieceAt(state, square);
  return p === null ? `${square}, empty` : `${square}, ${pieceName(p)}`;
}

/** What each square shows: its piece, and its highlights. */
export interface SquareView {
  square: string;
  piece: Piece | null;
  dark: boolean;
  label: string;
  /** Part of the last move (from or to). */
  last: boolean;
  /** The king in check. */
  check: boolean;
  selected: boolean;
  /** A legal destination of the selected piece. */
  target: boolean;
}

export function squareViews(state: ChessState, flipped: boolean, selected: string | null): SquareView[] {
  const last = lastMove(state);
  const lastSquares = last === null ? [] : [last.uci.slice(0, 2), last.uci.slice(2, 4)];
  const check = checkedKingSquare(state);
  const targets = new Set(selected === null ? [] : legalMovesFrom(state, selected).map((m) => m.to));
  return boardSquares(flipped).map((square) => ({
    square,
    piece: pieceAt(state, square),
    dark: isDark(square),
    label: squareLabel(state, square),
    last: lastSquares.includes(square),
    check: square === check,
    selected: square === selected,
    target: targets.has(square),
  }));
}

/** One row of the move list: the move number, White's SAN and Black's (null when not played yet). */
export interface MoveRow {
  n: number;
  white: string | null;
  black: string | null;
}

/** The move list in rows of two, as played. */
export function moveRows(history: readonly MoveRecord[]): MoveRow[] {
  const rows: MoveRow[] = [];
  for (const m of history) {
    const san = m.drawOffered ? `${m.san} (=)` : m.san;
    let row = rows[rows.length - 1];
    if (row === undefined || row.n !== m.moveNumber) {
      row = { n: m.moveNumber, white: null, black: null };
      rows.push(row);
    }
    if (m.seat === 0) row.white = san;
    else row.black = san;
  }
  return rows;
}

/** The legal moves of the piece on `from` to `to`: one, or four for a promotion. */
export function movesTo(state: ChessState, from: string, to: string): LegalMove[] {
  return legalMovesFrom(state, from).filter((m) => m.to === to);
}

/**
 * The move action for `from` → `to`, with `promotion` when the pawn promotes, and a draw offer when asked; null
 * when it is not a legal move.
 */
export function moveAction(
  state: ChessState,
  seat: number,
  from: string,
  to: string,
  promotion: PromotionLetter,
  offerDraw: boolean,
): ChessAction | null {
  const moves = movesTo(state, from, to);
  const m = moves.find((x) => x.promotion === null) ?? moves.find((x) => x.promotion === promotion);
  if (m === undefined) return null;
  return offerDraw
    ? { type: 'move', actor: seat, uci: m.uci, offerDraw: true }
    : { type: 'move', actor: seat, uci: m.uci };
}

/** Whether the seat to act may accept a standing draw offer. */
export const canAcceptDraw = (legal: readonly unknown[]): boolean =>
  (legal as readonly ChessAction[]).some((a) => a.type === 'acceptDraw');

/** "White to move", "Black to move: check", or how the game ended on the board. */
export function statusLine(state: ChessState, names: readonly string[], mySeat: number | null): string {
  if (state.result !== null) return boardResult(state, names);
  const seat = state.turn === 'w' ? 0 : 1;
  const who = mySeat === seat ? 'Your move' : `${names[seat] ?? colorName(seat)} to move`;
  const check = checkedKingSquare(state) === null ? '' : ': check';
  return `${who} (${colorName(seat)})${check}`;
}

/** The end on the board: "Checkmate: Ann (Black) wins", "Draw by stalemate". */
function boardResult(state: ChessState, names: readonly string[]): string {
  const r = state.result;
  if (r === null) return '';
  const reason = CHESS_THEME.reasons[r.reason];
  if (r.winner === null) return reason;
  return `${reason}: ${names[r.winner] ?? colorName(r.winner)} (${colorName(r.winner)}) wins`;
}

/**
 * The result as the platform settled it: the board's own end, or a resignation or timeout (places from the
 * outcome, the resigning or absent seat last). Null while the game goes on.
 */
export function resultText(
  state: ChessState,
  outcome: Outcome | null,
  names: readonly string[],
  resigned: readonly number[],
): string | null {
  if (outcome === null) return null;
  const name = (seat: number) => `${names[seat] ?? colorName(seat)} (${colorName(seat)})`;
  const winner = outcome.places.findIndex(
    (p, i) => p === 1 && outcome.places.every((q, j) => j === i || q > p),
  );
  if (outcome.reason === 'resign') {
    const who = resigned.map(name).join(' and ');
    return winner >= 0 ? `${who} resigned: ${name(winner)} wins` : `${who} resigned`;
  }
  if (outcome.reason === 'forfeit' && state.result === null) {
    return winner >= 0 ? `${name(winner)} wins on time` : 'The game ended by forfeit';
  }
  if (state.result !== null) {
    const board = boardResult(state, names);
    // A forfeit found at the end (an equivocation) moves a seat last whatever the board says.
    if (outcome.reason === 'forfeit' && winner >= 0)
      return `${board}; after the forfeit, ${name(winner)} wins`;
    return board;
  }
  return null;
}
