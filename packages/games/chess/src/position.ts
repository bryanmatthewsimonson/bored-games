import type { Result } from '@bored-games/game-kit';
import {
  BISHOP,
  BLACK,
  CASTLE_BK,
  CASTLE_BQ,
  CASTLE_WK,
  CASTLE_WQ,
  FLAG_EN_PASSANT,
  fileOf,
  inCheck,
  KING,
  KNIGHT,
  legalMoves,
  moveFlag,
  PAWN,
  type Pos,
  pieceCode,
  pieceLetter,
  ROOK,
  rankOf,
  type Side,
  squareIndex,
  squareName,
  typeOf,
} from './board.ts';
import { type ChessRules, DEFAULT_RULES, validateRules } from './rules.ts';
import type { ChessResult, ChessState, Color, Piece } from './types.ts';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const CASTLE_LETTERS: readonly [string, number][] = [
  ['K', CASTLE_WK],
  ['Q', CASTLE_WQ],
  ['k', CASTLE_BK],
  ['q', CASTLE_BQ],
];

export function castlingString(bits: number): string {
  const s = CASTLE_LETTERS.filter(([, bit]) => bits & bit)
    .map(([l]) => l)
    .join('');
  return s === '' ? '-' : s;
}

function castlingBits(field: string): number {
  let bits = 0;
  for (const [l, bit] of CASTLE_LETTERS) if (field.includes(l)) bits |= bit;
  return bits;
}

export const sideOfColor = (c: Color): Side => (c === 'w' ? 0 : 1);
export const colorOfSide = (s: Side): Color => (s === 0 ? 'w' : 'b');

/** A mutable move-generator position for a state (a fresh copy; the state is never touched). */
export function toPos(s: ChessState): Pos {
  const board = s.board.map((p) => (p === null ? 0 : pieceCode(p)));
  const kings: [number, number] = [board.indexOf(KING), board.indexOf(KING | BLACK)];
  return {
    board,
    side: sideOfColor(s.turn),
    castling: castlingBits(s.castling),
    ep: s.ep === null ? -1 : (squareIndex(s.ep) ?? -1),
    halfmove: s.halfmove,
    fullmove: s.fullmove,
    kings,
  };
}

export function boardOf(pos: Pos): (Piece | null)[] {
  return pos.board.map((p) => (p === 0 ? null : (pieceLetter(p) as Piece)));
}

export function placementOf(board: readonly number[]): string {
  const ranks: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[r * 8 + f] as number;
      if (p === 0) {
        empty++;
        continue;
      }
      if (empty > 0) row += String(empty);
      empty = 0;
      row += pieceLetter(p);
    }
    if (empty > 0) row += String(empty);
    ranks.push(row);
  }
  return ranks.join('/');
}

/** The repetition key: FEN fields 1-4 (the en passant square only when a capture is legal). */
export function positionKey(pos: Pos): string {
  return `${placementOf(pos.board)} ${colorOfSide(pos.side)} ${castlingString(pos.castling)} ${
    pos.ep < 0 ? '-' : squareName(pos.ep)
  }`;
}

/**
 * Clears the en passant square unless an en passant capture is legal, given
 * the legal moves of the side to move. Removing it changes no other move.
 */
export function normalizeEp(pos: Pos, legal: readonly number[]): void {
  if (pos.ep >= 0 && !legal.some((m) => moveFlag(m) === FLAG_EN_PASSANT)) pos.ep = -1;
}

/**
 * Insufficient material, decided automatically: K v K, K+B v K, K+N v K, and
 * any position with only kings and bishops whose bishops all stand on squares
 * of one color.
 */
export function insufficientMaterial(board: readonly number[]): boolean {
  let minors = 0;
  let knights = 0;
  let lightBishops = 0;
  let darkBishops = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq] as number;
    if (p === 0) continue;
    const t = typeOf(p);
    if (t === KING) continue;
    if (t === KNIGHT) {
      knights++;
      minors++;
    } else if (t === BISHOP) {
      minors++;
      // a1 (file 0 + rank 0, even) is a dark square.
      if ((fileOf(sq) + rankOf(sq)) % 2 === 0) darkBishops++;
      else lightBishops++;
    } else return false;
  }
  if (minors <= 1) return true;
  return knights === 0 && (lightBishops === 0 || darkBishops === 0);
}

/**
 * The automatic result of a position, checked in precedence order: checkmate,
 * stalemate, insufficient material, threefold repetition, fifty moves.
 * `legal` is the legal move list of the side to move.
 */
export function automaticResult(
  pos: Pos,
  legal: readonly number[],
  positions: readonly string[],
): ChessResult | null {
  if (legal.length === 0) {
    if (inCheck(pos)) return { reason: 'checkmate', winner: pos.side === 0 ? 1 : 0 };
    return { reason: 'stalemate', winner: null };
  }
  if (insufficientMaterial(pos.board)) return { reason: 'material', winner: null };
  const key = positions[positions.length - 1];
  if (key !== undefined && positions.filter((k) => k === key).length >= 3)
    return { reason: 'repetition', winner: null };
  if (pos.halfmove >= 100) return { reason: 'fifty-move', winner: null };
  return null;
}

/** The FEN of a state. The en passant field is written only when a capture is legal (it always is when set). */
export function toFen(s: ChessState): string {
  const pos = toPos(s);
  return `${positionKey(pos)} ${s.halfmove} ${s.fullmove}`;
}

const err = (code: string, message: string): Result<ChessState> => ({ ok: false, error: { code, message } });

/**
 * A state from a FEN string: six space-separated fields, strictly validated
 * (one king each, no pawns on the first or last rank, castling rights that
 * match the king and rook squares, a plausible en passant square, the side not
 * to move not in check). The history starts empty, and an automatic result
 * that already holds (mate, stalemate, dead position, fifty moves) is set.
 */
export function fromFen(fen: unknown, rules: ChessRules = DEFAULT_RULES): Result<ChessState> {
  const vr = validateRules(rules);
  if (!vr.ok) return vr;
  if (typeof fen !== 'string') return err('fen', 'FEN must be a string');
  const fields = fen.split(' ');
  if (fields.length !== 6) return err('fen', 'FEN must have six space-separated fields');
  const [placement, turn, castling, ep, half, full] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const ranks = placement.split('/');
  if (ranks.length !== 8) return err('fen', 'placement must have eight ranks');
  const board: number[] = new Array<number>(64).fill(0);
  for (let i = 0; i < 8; i++) {
    const rank = 7 - i;
    let file = 0;
    for (const ch of ranks[i] as string) {
      if (ch >= '1' && ch <= '8') {
        file += ch.charCodeAt(0) - 48;
        continue;
      }
      const code = pieceCode(ch);
      if (code === 0) return err('fen', `unknown piece ${ch}`);
      if (file > 7) return err('fen', `rank ${rank + 1} is too long`);
      board[rank * 8 + file] = code;
      file++;
    }
    if (file !== 8) return err('fen', `rank ${rank + 1} must have eight squares`);
  }
  if (board.filter((p) => p === KING).length !== 1 || board.filter((p) => p === (KING | BLACK)).length !== 1)
    return err('fen', 'each side must have exactly one king');
  for (let f = 0; f < 8; f++) {
    if (typeOf(board[f] as number) === PAWN || typeOf(board[56 + f] as number) === PAWN)
      return err('fen', 'no pawn may stand on the first or last rank');
  }

  if (turn !== 'w' && turn !== 'b') return err('fen', 'side to move must be w or b');
  const side: Side = turn === 'w' ? 0 : 1;

  if (castling !== '-' && !/^K?Q?k?q?$/.test(castling))
    return err('fen', 'castling must be "-" or KQkq order');
  if (castling === '') return err('fen', 'castling must be "-" or KQkq order');
  const castle = castling === '-' ? 0 : castlingBits(castling);
  const needs: readonly [number, number, number][] = [
    [CASTLE_WK, 4, 7],
    [CASTLE_WQ, 4, 0],
    [CASTLE_BK, 60, 63],
    [CASTLE_BQ, 60, 56],
  ];
  for (const [bit, king, rook] of needs) {
    if (!(castle & bit)) continue;
    const color = king === 4 ? 0 : BLACK;
    if (board[king] !== (KING | color) || board[rook] !== (ROOK | color))
      return err('fen', 'a castling right needs its king and rook on their home squares');
  }

  let epSq = -1;
  if (ep !== '-') {
    const sq = squareIndex(ep);
    if (sq === null) return err('fen', 'en passant must be "-" or a square');
    const dir = side === 0 ? -8 : 8; // from the target square toward the pawn that double-stepped
    const theirPawn = PAWN | (side === 0 ? BLACK : 0);
    if (
      rankOf(sq) !== (side === 0 ? 5 : 2) ||
      board[sq] !== 0 ||
      board[sq - dir] !== 0 ||
      board[sq + dir] !== theirPawn
    )
      return err('fen', 'en passant square does not follow a double step');
    epSq = sq;
  }

  if (!/^(0|[1-9][0-9]{0,5})$/.test(half)) return err('fen', 'halfmove clock must be a non-negative integer');
  if (!/^[1-9][0-9]{0,5}$/.test(full)) return err('fen', 'fullmove number must be a positive integer');

  const pos: Pos = {
    board,
    side,
    castling: castle,
    ep: epSq,
    halfmove: Number(half),
    fullmove: Number(full),
    kings: [board.indexOf(KING), board.indexOf(KING | BLACK)],
  };
  if (inCheck(pos, side === 0 ? 1 : 0)) return err('fen', 'the side not to move is in check');
  const legal = legalMoves(pos);
  normalizeEp(pos, legal);
  const positions = [positionKey(pos)];
  return {
    ok: true,
    value: {
      game: 'chess',
      rules: vr.value,
      board: boardOf(pos),
      turn: colorOfSide(side),
      castling: castlingString(pos.castling),
      ep: pos.ep < 0 ? null : squareName(pos.ep),
      halfmove: pos.halfmove,
      fullmove: pos.fullmove,
      positions,
      drawOffer: null,
      history: [],
      result: automaticResult(pos, legal, positions),
    },
  };
}
