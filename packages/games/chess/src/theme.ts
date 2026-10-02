/**
 * User-facing names for Chess. Engine code never imports this file; the keys
 * are the engine's FEN piece letters, colors and end reasons.
 */
export const CHESS_THEME = {
  title: 'Chess',
  tagline: 'Checkmate the opposing king.',
  colors: { w: 'White', b: 'Black' },
  pieces: { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' },
  /** Unicode chess symbols, followed by U+FE0E (text presentation) by the UI. */
  glyphs: {
    K: '♔',
    Q: '♕',
    R: '♖',
    B: '♗',
    N: '♘',
    P: '♙',
    k: '♚',
    q: '♛',
    r: '♜',
    b: '♝',
    n: '♞',
    p: '♟',
  },
  reasons: {
    checkmate: 'Checkmate',
    stalemate: 'Draw by stalemate',
    repetition: 'Draw by threefold repetition',
    'fifty-move': 'Draw by the fifty-move rule',
    material: 'Draw by insufficient material',
    agreement: 'Draw by agreement',
  },
} as const;

/** "white knight" for 'N', "black pawn" for 'p'. */
export function pieceName(piece: string): string {
  const lower = piece.toLowerCase() as keyof typeof CHESS_THEME.pieces;
  const color = piece === lower ? CHESS_THEME.colors.b : CHESS_THEME.colors.w;
  return `${color.toLowerCase()} ${CHESS_THEME.pieces[lower] ?? 'piece'}`;
}
