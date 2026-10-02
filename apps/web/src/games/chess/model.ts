/*
 * Pure helpers for the Chess screen: board order, square labels and highlights, keyboard steps, the move list,
 * captured material, the status line, the draw offer and the result. No DOM and no hooks, so they are unit-tested
 * directly. The engine's display helpers (`legalMovesFrom`, `checkedKingSquare`, `capturedPieces`, ...) do the
 * chess; this file only words and orders it. Names come from the engine's theme.
 */
import {
  type ChessAction,
  type ChessState,
  capturedPieces,
  checkedKingSquare,
  type LegalMove,
  lastMove,
  legalMovesFrom,
  type MoveRecord,
  materialDiff,
  PIECE_VALUES,
  type Piece,
  type PromotionLetter,
  pieceAt,
} from '@bored-games/chess';
import { CHESS_THEME, pieceName } from '@bored-games/chess/theme';
import type { Outcome } from '@bored-games/protocol';

const FILES = 'abcdefgh';

/** The four promotion choices, best first. */
export const PROMOTIONS: readonly PromotionLetter[] = ['q', 'r', 'b', 'n'];

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

/** The colour (seat) a piece belongs to: 0 for White, 1 for Black. */
export const pieceSeat = (piece: Piece): number => (piece === piece.toUpperCase() ? 0 : 1);

/** The colour name of a seat. */
export const colorName = (seat: number): string => (seat === 0 ? CHESS_THEME.colors.w : CHESS_THEME.colors.b);

/** A seat's piece of a promotion letter: 'q' is 'Q' for White, 'q' for Black. */
export const promotionPiece = (seat: number, letter: PromotionLetter): Piece =>
  (seat === 0 ? letter.toUpperCase() : letter) as Piece;

/** "Queen" for 'q'. */
export const promotionName = (letter: PromotionLetter): string => {
  const n = CHESS_THEME.pieces[letter];
  return n.charAt(0).toUpperCase() + n.slice(1);
};

/** A legal destination of the selected piece: a quiet move, or a capture (en passant included). */
export type TargetKind = 'move' | 'capture';

/** What each square shows: its piece, its highlights and its accessible name. */
export interface SquareView {
  square: string;
  piece: Piece | null;
  dark: boolean;
  /** "e4, white knight", then the square's state: "legal move" or "capture", "last move", "in check". */
  label: string;
  /** Part of the last move (from or to). */
  last: boolean;
  /** The king in check. */
  check: boolean;
  selected: boolean;
  /** A legal destination of the selected piece, or null. */
  target: TargetKind | null;
  /** The rank shown on this square's edge (the left column), or null. */
  rankHint: string | null;
  /** The file shown on this square's edge (the bottom row), or null. */
  fileHint: string | null;
}

/** A square's base accessible name: "e4, white knight", or "e4, empty". */
export function squareLabel(state: ChessState, square: string): string {
  const p = pieceAt(state, square);
  return p === null ? `${square}, empty` : `${square}, ${pieceName(p)}`;
}

/** The legal moves of the piece on `from` to `to`: one, or four for a promotion. */
export function movesTo(state: ChessState, from: string, to: string): LegalMove[] {
  return legalMovesFrom(state, from).filter((m) => m.to === to);
}

/** Whether a legal move captures: a piece on the target, or a pawn changing file (en passant). */
function isCapture(state: ChessState, m: LegalMove): boolean {
  if (pieceAt(state, m.to) !== null) return true;
  const piece = pieceAt(state, m.from);
  return piece !== null && piece.toLowerCase() === 'p' && m.from[0] !== m.to[0];
}

export function squareViews(state: ChessState, flipped: boolean, selected: string | null): SquareView[] {
  const last = lastMove(state);
  const lastSquares = last === null ? [] : [last.uci.slice(0, 2), last.uci.slice(2, 4)];
  const check = checkedKingSquare(state);
  const targets = new Map<string, TargetKind>();
  if (selected !== null)
    for (const m of legalMovesFrom(state, selected))
      targets.set(m.to, isCapture(state, m) ? 'capture' : 'move');
  return boardSquares(flipped).map((square, i) => {
    const target = targets.get(square) ?? null;
    const isLast = lastSquares.includes(square);
    const isCheck = square === check;
    const isSelected = square === selected;
    // "Selected" is the button's pressed state (aria-pressed), so the label leaves it out.
    const notes = [
      target === 'capture' ? 'capture' : target === 'move' ? 'legal move' : '',
      isLast ? 'last move' : '',
      isCheck ? 'in check' : '',
    ].filter((n) => n !== '');
    return {
      square,
      piece: pieceAt(state, square),
      dark: isDark(square),
      label: [squareLabel(state, square), ...notes].join(', '),
      last: isLast,
      check: isCheck,
      selected: isSelected,
      target,
      rankHint: i % 8 === 0 ? (square[1] as string) : null,
      fileHint: i >= 56 ? (square[0] as string) : null,
    };
  });
}

/**
 * The square keyboard focus moves to from `square` on `key`, as the board is shown (ArrowUp is up the screen,
 * whichever side is at the bottom); Home and End go to the row's ends. Null for any other key. Stops at the edge.
 */
export function stepSquare(square: string, key: string, flipped: boolean): string | null {
  const order = boardSquares(flipped);
  const i = order.indexOf(square);
  if (i < 0) return null;
  const row = Math.floor(i / 8);
  const col = i % 8;
  const at = (r: number, c: number) => order[Math.min(7, Math.max(0, r)) * 8 + Math.min(7, Math.max(0, c))];
  switch (key) {
    case 'ArrowUp':
      return at(row - 1, col) ?? null;
    case 'ArrowDown':
      return at(row + 1, col) ?? null;
    case 'ArrowLeft':
      return at(row, col - 1) ?? null;
    case 'ArrowRight':
      return at(row, col + 1) ?? null;
    case 'Home':
      return at(row, 0) ?? null;
    case 'End':
      return at(row, 7) ?? null;
    default:
      return null;
  }
}

/** One move in the list: its SAN, whether it carried a draw offer, and its index in the history. */
export interface MoveCell {
  san: string;
  offer: boolean;
  ply: number;
}

/** One row of the move list: the move number, White's move and Black's (null when not played). */
export interface MoveRow {
  n: number;
  white: MoveCell | null;
  black: MoveCell | null;
}

/** The move list in numbered rows of two, as played. */
export function moveRows(history: readonly MoveRecord[]): MoveRow[] {
  const rows: MoveRow[] = [];
  history.forEach((m, ply) => {
    const cell: MoveCell = { san: m.san, offer: m.drawOffered, ply };
    let row = rows[rows.length - 1];
    if (row === undefined || row.n !== m.moveNumber) {
      row = { n: m.moveNumber, white: null, black: null };
      rows.push(row);
    }
    if (m.seat === 0) row.white = cell;
    else row.black = cell;
  });
  return rows;
}

/** One side's captures: the pieces it took, most valuable first, and its material lead in pawns (0 if none). */
export interface MaterialView {
  captured: Piece[];
  lead: number;
}

const value = (p: Piece): number => PIECE_VALUES[p.toLowerCase()] ?? 0;

/** Per seat: the pieces it captured and its material lead (from the board, so promotions count). */
export function materialViews(state: ChessState): [MaterialView, MaterialView] {
  const { byWhite, byBlack } = capturedPieces(state);
  const order = (ps: readonly Piece[]) => [...ps].sort((a, b) => value(b) - value(a) || (a < b ? -1 : 1));
  const diff = materialDiff(state);
  return [
    { captured: order(byWhite), lead: Math.max(0, diff) },
    { captured: order(byBlack), lead: Math.max(0, -diff) },
  ];
}

/** "2 pawns and a knight", or "nothing", for screen readers. */
export function capturedText(pieces: readonly Piece[]): string {
  if (pieces.length === 0) return 'nothing';
  const counts = new Map<string, number>();
  for (const p of pieces) {
    const name = CHESS_THEME.pieces[p.toLowerCase() as keyof typeof CHESS_THEME.pieces];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const parts = [...counts].map(([name, n]) => (n === 1 ? `a ${name}` : `${n} ${name}s`));
  return parts.length === 1 ? (parts[0] as string) : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
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

const seatName = (names: readonly string[], seat: number): string =>
  `${names[seat] ?? colorName(seat)} (${colorName(seat)})`;

/** "Your move (White)", "Bo to move (Black): check", or how the game ended on the board. */
export function statusLine(state: ChessState, names: readonly string[], mySeat: number | null): string {
  if (state.result !== null) return boardResult(state, names);
  const seat = state.turn === 'w' ? 0 : 1;
  const who = mySeat === seat ? 'Your move' : `${names[seat] ?? colorName(seat)} to move`;
  const check = checkedKingSquare(state) === null ? '' : ': check';
  return `${who} (${colorName(seat)})${check}`;
}

/** The standing draw offer as this viewer should read it, or null when none stands. */
export interface DrawNotice {
  /** `incoming`: the viewer may accept it; `outgoing`: the viewer made it; `other`: a spectator's view. */
  kind: 'incoming' | 'outgoing' | 'other';
  text: string;
}

export function drawNotice(
  state: ChessState,
  names: readonly string[],
  mySeat: number | null,
): DrawNotice | null {
  const by = state.drawOffer;
  if (by === null || state.result !== null) return null;
  const other = 1 - by;
  if (mySeat === by)
    return {
      kind: 'outgoing',
      text: `You offered a draw with your last move. ${seatName(names, other)} can accept it, or decline by moving.`,
    };
  if (mySeat === other)
    return {
      kind: 'incoming',
      text: `${seatName(names, by)} offers a draw. Accept it, or decline by making your move.`,
    };
  return { kind: 'other', text: `${seatName(names, by)} offers a draw.` };
}

/** The end on the board: "Checkmate: Ann (Black) wins", "Draw by stalemate". */
function boardResult(state: ChessState, names: readonly string[]): string {
  const r = state.result;
  if (r === null) return '';
  const reason = CHESS_THEME.reasons[r.reason];
  if (r.winner === null) return reason;
  return `${reason}: ${seatName(names, r.winner)} wins`;
}

/** The game's result for the results view. */
export interface ResultView {
  /** "1–0", "0–1" or "½–½", from the outcome's places. */
  score: string;
  /** "Checkmate: Bo (Black) wins", "Bo (Black) resigned: Ann (White) wins", "Draw by stalemate". */
  headline: string;
  /** Why, in a sentence. */
  detail: string;
}

/**
 * The score from the outcome's places, not its scores: after a resignation or a timeout the platform ranks the
 * seats by `standings`, which stay 1–1 during play, so only the places say who won (D048).
 */
export function scoreText(outcome: Outcome): string {
  const [w, b] = outcome.places;
  if (w === undefined || b === undefined || w === b) return '½–½';
  return w < b ? '1–0' : '0–1';
}

/**
 * The result as the platform settled it: the board's own end, a resignation or a timeout. The winner comes from
 * the outcome's places (the resigning or absent seat is last). Null while the game goes on.
 */
export function resultView(
  state: ChessState,
  outcome: Outcome | null,
  names: readonly string[],
  resigned: readonly number[],
  forfeits: readonly number[],
): ResultView | null {
  if (outcome === null) return null;
  const score = scoreText(outcome);
  const winner = outcome.places.findIndex(
    (p, i) => p === 1 && outcome.places.every((q, j) => j === i || q > p),
  );
  const wins = winner >= 0 ? `${seatName(names, winner)} wins` : 'No winner';
  const who = (seats: readonly number[]) => seats.map((s) => seatName(names, s)).join(' and ');
  if (outcome.reason === 'resign') {
    return {
      score,
      headline: `${who(resigned)} resigned: ${wins}`,
      detail: '',
    };
  }
  if (outcome.reason === 'forfeit' && state.result === null) {
    const late = forfeits.length > 0 ? who(forfeits) : 'A player';
    return {
      score,
      headline: winner >= 0 ? `${wins} on time` : 'The game ended by forfeit',
      detail: `${late} missed the move deadline and forfeits the game.`,
    };
  }
  const r = state.result;
  if (r === null) return { score, headline: wins, detail: '' };
  const board = boardResult(state, names);
  const loser = r.winner === null ? (state.turn === 'w' ? 0 : 1) : 1 - r.winner;
  const details: Record<typeof r.reason, string> = {
    checkmate: `${seatName(names, loser)} is in check and has no legal move.`,
    stalemate: `${seatName(names, loser)} has no legal move but is not in check.`,
    repetition: 'The same position occurred for the third time.',
    'fifty-move': 'Each side made fifty moves without a capture or a pawn move.',
    material: 'Neither side has enough pieces left to checkmate.',
    // After acceptDraw nothing moves, so the seat to move accepted.
    agreement: `${seatName(names, state.turn === 'w' ? 0 : 1)} accepted the draw offer.`,
  };
  // A forfeit found at the end (an equivocation) moves a seat last whatever the board says.
  if (outcome.reason === 'forfeit' && winner >= 0)
    return { score, headline: `${board}; after the forfeit, ${wins}`, detail: details[r.reason] };
  return { score, headline: board, detail: details[r.reason] };
}

const pieceWord = (p: Piece): string =>
  CHESS_THEME.pieces[p.toLowerCase() as keyof typeof CHESS_THEME.pieces];

/**
 * A played move in words, for screen readers: "knight to c6", "pawn takes bishop on b7, promotes to queen",
 * "castles kingside", then ", check" or ", checkmate".
 */
export function spokenMove(m: MoveRecord): string {
  const to = m.uci.slice(2, 4);
  let words: string;
  if (m.san.startsWith('O-O-O')) words = 'castles queenside';
  else if (m.san.startsWith('O-O')) words = 'castles kingside';
  else {
    const piece = pieceWord(m.piece);
    words = m.captured === null ? `${piece} to ${to}` : `${piece} takes ${pieceWord(m.captured)} on ${to}`;
    const promo = m.uci[4] as PromotionLetter | undefined;
    if (promo !== undefined) words += `, promotes to ${CHESS_THEME.pieces[promo]}`;
  }
  if (m.san.endsWith('#')) words += ', checkmate';
  else if (m.san.endsWith('+')) words += ', check';
  return words;
}

/**
 * What the screen's live region says: the opponent's last move ("Bo (Black) played knight to c6, check, and
 * offers a draw."), then the result once the game is over. The viewer's own moves are not read back. Empty when
 * there is nothing to say.
 */
export function liveAnnouncement(
  state: ChessState,
  names: readonly string[],
  mySeat: number | null,
  result: ResultView | null,
): string {
  const parts: string[] = [];
  const last = lastMove(state);
  if (last !== null && last.seat !== mySeat) {
    const offer = last.drawOffered ? ', and offers a draw' : '';
    parts.push(`${seatName(names, last.seat)} played ${spokenMove(last)}${offer}.`);
  }
  if (result !== null) parts.push(`Game over, ${result.score}: ${result.headline}.`);
  return parts.join(' ');
}

/** Whether `action` is one of the viewer's legal actions (the controller's list), compared field by field. */
export function isLegal(legal: readonly unknown[], action: ChessAction): boolean {
  return (legal as readonly ChessAction[]).some(
    (a) =>
      a.type === action.type &&
      a.actor === action.actor &&
      (a.type !== 'move' ||
        (action.type === 'move' &&
          a.uci === action.uci &&
          (a.offerDraw ?? false) === (action.offerDraw ?? false))),
  );
}
