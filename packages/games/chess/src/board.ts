/**
 * The move generator: a small mutable position with make/unmake, used by the
 * engine (on a fresh copy per call, so states are never mutated) and by perft.
 *
 * Squares are 0..63 with a1 = 0, b1 = 1, ..., h8 = 63 (index = rank * 8 + file).
 * Pieces are small integers: type 1..6 (pawn, knight, bishop, rook, queen,
 * king), plus 8 for Black. 0 is an empty square.
 *
 * Moves are integers: from | to << 6 | promotion type << 12 | flag << 15.
 */

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export const BLACK = 8;

/** Side: 0 = White, 1 = Black. */
export type Side = 0 | 1;

export const FLAG_NONE = 0;
export const FLAG_DOUBLE = 1;
export const FLAG_EN_PASSANT = 2;
export const FLAG_CASTLE = 3;

/** Castling-right bits: White kingside, White queenside, Black kingside, Black queenside. */
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

export interface Pos {
  board: number[];
  side: Side;
  castling: number;
  /** The square passed over by the last double step, or -1. */
  ep: number;
  halfmove: number;
  fullmove: number;
  kings: [number, number];
}

export interface Undo {
  readonly captured: number;
  readonly capSq: number;
  readonly castling: number;
  readonly ep: number;
  readonly halfmove: number;
}

export const fileOf = (sq: number): number => sq & 7;
export const rankOf = (sq: number): number => sq >> 3;
export const typeOf = (piece: number): number => piece & 7;
export const sideOf = (piece: number): Side => (piece & BLACK ? 1 : 0);

export const moveFrom = (m: number): number => m & 63;
export const moveTo = (m: number): number => (m >> 6) & 63;
export const movePromo = (m: number): number => (m >> 12) & 7;
export const moveFlag = (m: number): number => (m >> 15) & 3;
const encode = (from: number, to: number, promo: number, flag: number): number =>
  from | (to << 6) | (promo << 12) | (flag << 15);

// ---------------------------------------------------------------- tables

function onBoard(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

function steps(deltas: readonly (readonly [number, number])[]): number[][] {
  const out: number[][] = [];
  for (let sq = 0; sq < 64; sq++) {
    const list: number[] = [];
    for (const [df, dr] of deltas) {
      const f = fileOf(sq) + df;
      const r = rankOf(sq) + dr;
      if (onBoard(f, r)) list.push(r * 8 + f);
    }
    out.push(list);
  }
  return out;
}

const KNIGHT_DELTAS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
] as const;
const KING_DELTAS = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
] as const;
/** Directions 0..3 are orthogonal (rook), 4..7 diagonal (bishop). */
const RAY_DELTAS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const;

const KNIGHT_TARGETS = steps(KNIGHT_DELTAS);
const KING_TARGETS = steps(KING_DELTAS);
/** RAYS[dir][sq]: the squares from sq outward in direction dir, nearest first. */
const RAYS: number[][][] = RAY_DELTAS.map(([df, dr]) => {
  const out: number[][] = [];
  for (let sq = 0; sq < 64; sq++) {
    const ray: number[] = [];
    let f = fileOf(sq) + df;
    let r = rankOf(sq) + dr;
    while (onBoard(f, r)) {
      ray.push(r * 8 + f);
      f += df;
      r += dr;
    }
    out.push(ray);
  }
  return out;
});

/** Rights kept when a move touches a square: moving from or capturing on a king or rook home square loses them. */
const CASTLE_KEEP: number[] = Array.from({ length: 64 }, () => 15);
CASTLE_KEEP[4] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_KEEP[7] = 15 & ~CASTLE_WK;
CASTLE_KEEP[0] = 15 & ~CASTLE_WQ;
CASTLE_KEEP[60] = 15 & ~(CASTLE_BK | CASTLE_BQ);
CASTLE_KEEP[63] = 15 & ~CASTLE_BK;
CASTLE_KEEP[56] = 15 & ~CASTLE_BQ;

// ---------------------------------------------------------------- attacks

/** Whether `sq` is attacked by any piece of side `by`. */
export function isAttacked(pos: Pos, sq: number, by: Side): boolean {
  const b = pos.board;
  const color = by === 1 ? BLACK : 0;
  const f = fileOf(sq);
  if (by === 0) {
    if (f > 0 && sq >= 9 && b[sq - 9] === PAWN) return true;
    if (f < 7 && sq >= 7 && b[sq - 7] === PAWN) return true;
  } else {
    if (f < 7 && sq + 9 < 64 && b[sq + 9] === (PAWN | BLACK)) return true;
    if (f > 0 && sq + 7 < 64 && b[sq + 7] === (PAWN | BLACK)) return true;
  }
  for (const t of KNIGHT_TARGETS[sq] as number[]) if (b[t] === (KNIGHT | color)) return true;
  for (const t of KING_TARGETS[sq] as number[]) if (b[t] === (KING | color)) return true;
  for (let dir = 0; dir < 8; dir++) {
    const slider = dir < 4 ? ROOK : BISHOP;
    for (const t of (RAYS[dir] as number[][])[sq] as number[]) {
      const p = b[t] as number;
      if (p === 0) continue;
      if ((p === (slider | color) || p === (QUEEN | color)) && sideOf(p) === by) return true;
      break;
    }
  }
  return false;
}

export function inCheck(pos: Pos, side: Side = pos.side): boolean {
  return isAttacked(pos, pos.kings[side], side === 0 ? 1 : 0);
}

// ---------------------------------------------------------------- generation

const PROMOTIONS = [QUEEN, ROOK, BISHOP, KNIGHT] as const;

function pushPawn(out: number[], from: number, to: number, flag: number): void {
  const r = rankOf(to);
  if (r === 7 || r === 0) for (const p of PROMOTIONS) out.push(encode(from, to, p, flag));
  else out.push(encode(from, to, 0, flag));
}

/** Pseudo-legal moves for the side to move (own king may be left attacked; castling conditions are checked). */
export function pseudoMoves(pos: Pos): number[] {
  const out: number[] = [];
  const b = pos.board;
  const side = pos.side;
  const enemy: Side = side === 0 ? 1 : 0;
  const isEnemy = (p: number): boolean => p !== 0 && sideOf(p) === enemy;
  for (let sq = 0; sq < 64; sq++) {
    const piece = b[sq] as number;
    if (piece === 0 || sideOf(piece) !== side) continue;
    const type = typeOf(piece);
    if (type === PAWN) {
      const dir = side === 0 ? 8 : -8;
      const one = sq + dir;
      if (b[one] === 0) {
        pushPawn(out, sq, one, FLAG_NONE);
        const startRank = side === 0 ? 1 : 6;
        if (rankOf(sq) === startRank && b[one + dir] === 0) out.push(encode(sq, one + dir, 0, FLAG_DOUBLE));
      }
      for (const df of [-1, 1]) {
        const f = fileOf(sq) + df;
        if (f < 0 || f > 7) continue;
        const t = one + df;
        if (isEnemy(b[t] as number)) pushPawn(out, sq, t, FLAG_NONE);
        else if (t === pos.ep) out.push(encode(sq, t, 0, FLAG_EN_PASSANT));
      }
    } else if (type === KNIGHT || type === KING) {
      for (const t of (type === KNIGHT ? KNIGHT_TARGETS : KING_TARGETS)[sq] as number[]) {
        const p = b[t] as number;
        if (p === 0 || isEnemy(p)) out.push(encode(sq, t, 0, FLAG_NONE));
      }
    } else {
      const first = type === BISHOP ? 4 : 0;
      const last = type === ROOK ? 4 : 8;
      for (let dir = first; dir < last; dir++) {
        for (const t of (RAYS[dir] as number[][])[sq] as number[]) {
          const p = b[t] as number;
          if (p === 0) {
            out.push(encode(sq, t, 0, FLAG_NONE));
            continue;
          }
          if (isEnemy(p)) out.push(encode(sq, t, 0, FLAG_NONE));
          break;
        }
      }
    }
  }
  castlingMoves(pos, out);
  return out;
}

function castlingMoves(pos: Pos, out: number[]): void {
  const b = pos.board;
  const side = pos.side;
  const home = side === 0 ? 0 : 56;
  const king = home + 4;
  const kingSide = side === 0 ? CASTLE_WK : CASTLE_BK;
  const queenSide = side === 0 ? CASTLE_WQ : CASTLE_BQ;
  if ((pos.castling & (kingSide | queenSide)) === 0) return;
  const enemy: Side = side === 0 ? 1 : 0;
  const color = side === 0 ? 0 : BLACK;
  if (b[king] !== (KING | color) || isAttacked(pos, king, enemy)) return;
  if (
    pos.castling & kingSide &&
    b[home + 7] === (ROOK | color) &&
    b[home + 5] === 0 &&
    b[home + 6] === 0 &&
    !isAttacked(pos, home + 5, enemy) &&
    !isAttacked(pos, home + 6, enemy)
  ) {
    out.push(encode(king, home + 6, 0, FLAG_CASTLE));
  }
  if (
    pos.castling & queenSide &&
    b[home] === (ROOK | color) &&
    b[home + 1] === 0 &&
    b[home + 2] === 0 &&
    b[home + 3] === 0 &&
    !isAttacked(pos, home + 3, enemy) &&
    !isAttacked(pos, home + 2, enemy)
  ) {
    out.push(encode(king, home + 2, 0, FLAG_CASTLE));
  }
}

export function makeMove(pos: Pos, m: number): Undo {
  const b = pos.board;
  const from = moveFrom(m);
  const to = moveTo(m);
  const promo = movePromo(m);
  const flag = moveFlag(m);
  const piece = b[from] as number;
  const side = pos.side;
  let capSq = to;
  if (flag === FLAG_EN_PASSANT) capSq = side === 0 ? to - 8 : to + 8;
  const undo: Undo = {
    captured: b[capSq] as number,
    capSq,
    castling: pos.castling,
    ep: pos.ep,
    halfmove: pos.halfmove,
  };
  b[capSq] = 0;
  b[from] = 0;
  b[to] = promo ? promo | (side === 1 ? BLACK : 0) : piece;
  if (flag === FLAG_CASTLE) {
    const kingSide = to > from;
    const rookFrom = kingSide ? from + 3 : from - 4;
    const rookTo = kingSide ? from + 1 : from - 1;
    b[rookTo] = b[rookFrom] as number;
    b[rookFrom] = 0;
  }
  if (typeOf(piece) === KING) pos.kings[side] = to;
  pos.castling &= (CASTLE_KEEP[from] as number) & (CASTLE_KEEP[to] as number);
  pos.ep = flag === FLAG_DOUBLE ? (from + to) >> 1 : -1;
  pos.halfmove = typeOf(piece) === PAWN || undo.captured !== 0 ? 0 : pos.halfmove + 1;
  if (side === 1) pos.fullmove++;
  pos.side = side === 0 ? 1 : 0;
  return undo;
}

export function unmakeMove(pos: Pos, m: number, undo: Undo): void {
  const b = pos.board;
  const from = moveFrom(m);
  const to = moveTo(m);
  const flag = moveFlag(m);
  const side: Side = pos.side === 0 ? 1 : 0;
  pos.side = side;
  if (side === 1) pos.fullmove--;
  const moved = movePromo(m) ? PAWN | (side === 1 ? BLACK : 0) : (b[to] as number);
  b[from] = moved;
  b[to] = 0;
  b[undo.capSq] = undo.captured;
  if (flag === FLAG_CASTLE) {
    const kingSide = to > from;
    const rookFrom = kingSide ? from + 3 : from - 4;
    const rookTo = kingSide ? from + 1 : from - 1;
    b[rookFrom] = b[rookTo] as number;
    b[rookTo] = 0;
  }
  if (typeOf(moved) === KING) pos.kings[side] = from;
  pos.castling = undo.castling;
  pos.ep = undo.ep;
  pos.halfmove = undo.halfmove;
}

/** Fully legal moves for the side to move: pseudo-legal moves that leave the own king unattacked. */
export function legalMoves(pos: Pos): number[] {
  const side = pos.side;
  const enemy: Side = side === 0 ? 1 : 0;
  const out: number[] = [];
  for (const m of pseudoMoves(pos)) {
    const undo = makeMove(pos, m);
    if (!isAttacked(pos, pos.kings[side], enemy)) out.push(m);
    unmakeMove(pos, m, undo);
  }
  return out;
}

/** Leaf-node count of the legal move tree (bulk-counted at depth 1). */
export function perftPos(pos: Pos, depth: number): number {
  if (depth <= 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    const undo = makeMove(pos, m);
    n += perftPos(pos, depth - 1);
    unmakeMove(pos, m, undo);
  }
  return n;
}

export function clonePos(pos: Pos): Pos {
  return { ...pos, board: pos.board.slice(), kings: [pos.kings[0], pos.kings[1]] };
}

// ---------------------------------------------------------------- names

const FILES = 'abcdefgh';
const PIECE_LETTERS = ' pnbrqk';

export function squareName(sq: number): string {
  return `${FILES[fileOf(sq)]}${rankOf(sq) + 1}`;
}

/** Parses "e4" to a square index, or null. */
export function squareIndex(name: unknown): number | null {
  if (typeof name !== 'string' || !/^[a-h][1-8]$/.test(name)) return null;
  return (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97);
}

/** The FEN letter of a piece code: uppercase for White, lowercase for Black. */
export function pieceLetter(piece: number): string {
  const l = PIECE_LETTERS[typeOf(piece)] ?? '?';
  return sideOf(piece) === 0 ? l.toUpperCase() : l;
}

/** Parses a FEN piece letter to a piece code, or 0. */
export function pieceCode(letter: unknown): number {
  if (typeof letter !== 'string' || letter.length !== 1) return 0;
  const lower = letter.toLowerCase();
  const type = PIECE_LETTERS.indexOf(lower);
  if (type < 1) return 0;
  return letter === lower ? type | BLACK : type;
}

export function uciOf(m: number): string {
  const promo = movePromo(m);
  return `${squareName(moveFrom(m))}${squareName(moveTo(m))}${promo ? (PIECE_LETTERS[promo] ?? '') : ''}`;
}
