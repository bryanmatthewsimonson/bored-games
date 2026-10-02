import {
  FLAG_CASTLE,
  FLAG_EN_PASSANT,
  fileOf,
  inCheck,
  legalMoves,
  makeMove,
  moveFlag,
  moveFrom,
  movePromo,
  moveTo,
  PAWN,
  type Pos,
  pieceLetter,
  rankOf,
  squareName,
  typeOf,
  unmakeMove,
} from './board.ts';

/**
 * Standard Algebraic Notation for a legal move `m` in `pos` without the check
 * suffix, given the legal moves of the position. Disambiguation looks at legal
 * moves only: the file if that is enough, else the rank, else both.
 */
export function sanBody(pos: Pos, m: number, legal: readonly number[]): string {
  const from = moveFrom(m);
  const to = moveTo(m);
  const flag = moveFlag(m);
  const piece = pos.board[from] as number;
  let san: string;
  if (flag === FLAG_CASTLE) {
    san = to > from ? 'O-O' : 'O-O-O';
  } else {
    const capture = pos.board[to] !== 0 || flag === FLAG_EN_PASSANT;
    if (typeOf(piece) === PAWN) {
      san = capture ? `${squareName(from)[0]}x${squareName(to)}` : squareName(to);
      const promo = movePromo(m);
      if (promo) san += `=${pieceLetter(promo)}`;
    } else {
      const rivals = legal.filter(
        (o) => moveTo(o) === to && moveFrom(o) !== from && pos.board[moveFrom(o)] === piece,
      );
      let dis = '';
      if (rivals.length > 0) {
        const name = squareName(from);
        if (!rivals.some((o) => fileOf(moveFrom(o)) === fileOf(from))) dis = name[0] as string;
        else if (!rivals.some((o) => rankOf(moveFrom(o)) === rankOf(from))) dis = name[1] as string;
        else dis = name;
      }
      san = `${pieceLetter(piece).toUpperCase()}${dis}${capture ? 'x' : ''}${squareName(to)}`;
    }
  }
  return san;
}

/** The SAN check suffix for a position just reached: '#' for mate, '+' for check, else ''. */
export function checkSuffix(after: Pos, replies: readonly number[]): string {
  if (!inCheck(after)) return '';
  return replies.length === 0 ? '#' : '+';
}

/** Full SAN (with '+' or '#') for a legal move `m` in `pos`. `pos` is restored afterwards. */
export function sanOf(pos: Pos, m: number, legal: readonly number[]): string {
  const body = sanBody(pos, m, legal);
  const undo = makeMove(pos, m);
  const suffix = checkSuffix(pos, legalMoves(pos));
  unmakeMove(pos, m, undo);
  return body + suffix;
}
