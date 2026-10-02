/**
 * Read-only helpers for the UI and tests. None of them changes a state.
 */
import {
  inCheck,
  legalMoves,
  moveFrom,
  movePromo,
  moveTo,
  pieceLetter,
  squareIndex,
  squareName,
  uciOf,
} from './board.ts';
import { toPos } from './position.ts';
import { sanOf } from './san.ts';
import type { ChessState, MoveRecord, Piece, PromotionLetter } from './types.ts';

export interface LegalMove {
  readonly uci: string;
  readonly from: string;
  readonly to: string;
  readonly promotion: PromotionLetter | null;
  readonly san: string;
}

/** Every legal move of the side to move, in UCI order; [] once the game is over. */
export function legalMoveList(s: ChessState): LegalMove[] {
  if (s.result) return [];
  const pos = toPos(s);
  const legal = legalMoves(pos);
  return legal
    .map((m) => ({
      uci: uciOf(m),
      from: squareName(moveFrom(m)),
      to: squareName(moveTo(m)),
      promotion: movePromo(m) ? (pieceLetter(movePromo(m)).toLowerCase() as PromotionLetter) : null,
      san: sanOf(pos, m, legal),
    }))
    .sort((a, b) => (a.uci < b.uci ? -1 : a.uci > b.uci ? 1 : 0));
}

/** The legal moves of the piece on `square` (for highlighting targets); [] for a bad square. */
export function legalMovesFrom(s: ChessState, square: string): LegalMove[] {
  if (squareIndex(square) === null) return [];
  return legalMoveList(s).filter((m) => m.from === square);
}

/** SAN for `uci` in the current position, or null when it is not a legal move. */
export function san(s: ChessState, uci: string): string | null {
  return legalMoveList(s).find((m) => m.uci === uci)?.san ?? null;
}

/** Whether the side to move is in check. */
export function isCheck(s: ChessState): boolean {
  return inCheck(toPos(s));
}

/** The square of the king in check (for highlighting), or null. */
export function checkedKingSquare(s: ChessState): string | null {
  const pos = toPos(s);
  return inCheck(pos) ? squareName(pos.kings[pos.side]) : null;
}

/** The piece on a square ("e4"), or null. */
export function pieceAt(s: ChessState, square: string): Piece | null {
  const sq = squareIndex(square);
  return sq === null ? null : (s.board[sq] ?? null);
}

export function lastMove(s: ChessState): MoveRecord | null {
  return s.history[s.history.length - 1] ?? null;
}

/** The move list with SAN, as played. */
export function moveHistory(s: ChessState): readonly MoveRecord[] {
  return s.history;
}

/** Pieces captured so far: `byWhite` are Black pieces White took, and the other way round. */
export function capturedPieces(s: ChessState): { readonly byWhite: Piece[]; readonly byBlack: Piece[] } {
  const byWhite: Piece[] = [];
  const byBlack: Piece[] = [];
  for (const h of s.history) {
    if (h.captured === null) continue;
    (h.seat === 0 ? byWhite : byBlack).push(h.captured);
  }
  return { byWhite, byBlack };
}

/** Conventional piece values: pawn 1, knight 3, bishop 3, rook 5, queen 9. */
export const PIECE_VALUES: Readonly<Record<string, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** White's material minus Black's, in pawns, from the board. */
export function materialDiff(s: ChessState): number {
  let diff = 0;
  for (const p of s.board) {
    if (p === null) continue;
    const v = PIECE_VALUES[p.toLowerCase()] ?? 0;
    diff += p === p.toUpperCase() ? v : -v;
  }
  return diff;
}
