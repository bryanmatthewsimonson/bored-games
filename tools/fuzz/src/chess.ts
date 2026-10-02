import type { ChessAction, ChessState } from '@bored-games/chess';
import type { FuzzPolicy, Rng } from '@bored-games/game-kit';

/**
 * Fuzzing policies for Chess. Test drivers only, never players:
 * - random: a uniformly random legal move, never offering or accepting a draw;
 * - capturer: prefers captures and promotions, so games reach mates and bare
 *   endings more often;
 * - drawOffers: random moves, offering a draw now and then, and accepting a
 *   standing offer half of the time.
 */

type Move = Extract<ChessAction, { type: 'move' }>;

function plainMoves(legal: readonly unknown[]): Move[] {
  return (legal as ChessAction[]).filter((a): a is Move => a.type === 'move' && a.offerDraw === undefined);
}

function weighted<T>(items: readonly T[], weight: (item: T) => number, rng: Rng): T {
  const ws = items.map((i) => Math.max(0, weight(i)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return rng.pick(items);
  let x = rng.float() * total;
  for (let i = 0; i < items.length; i++) {
    x -= ws[i] as number;
    if (x < 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}

const FILES = 'abcdefgh';
function squareIndex(name: string): number {
  return (name.charCodeAt(1) - 49) * 8 + FILES.indexOf(name[0] as string);
}

function isCapture(s: ChessState, uci: string): boolean {
  const to = uci.slice(2, 4);
  if (s.board[squareIndex(to)] !== null) return true;
  const piece = s.board[squareIndex(uci.slice(0, 2))];
  return (piece === 'P' || piece === 'p') && uci[0] !== uci[2];
}

export const CHESS_POLICIES: readonly FuzzPolicy<ChessState>[] = [
  {
    name: 'random',
    choose: (_s, _seat, legal, rng) => rng.pick(plainMoves(legal)),
  },
  {
    name: 'capturer',
    choose: (s, _seat, legal, rng) =>
      weighted(
        plainMoves(legal),
        (a) => 1 + (isCapture(s, a.uci) ? 6 : 0) + (a.uci.length === 5 ? 10 : 0),
        rng,
      ),
  },
  {
    name: 'drawOffers',
    choose(s, seat, legal, rng) {
      const accept = (legal as ChessAction[]).find((a) => a.type === 'acceptDraw');
      if (accept && rng.float() < 0.5) return accept;
      const move = rng.pick(plainMoves(legal));
      if (s.history.length > 20 && rng.float() < 0.03) return { ...move, actor: seat, offerDraw: true };
      return move;
    },
  },
];

/** Tags every rare path the fuzzer should reach; the CLI reports any that stay at zero. */
export const CHESS_EXPECTED_COVERAGE: readonly string[] = [
  'end:checkmate',
  'end:stalemate',
  'end:repetition',
  'end:fifty-move',
  'end:material',
  'end:agreement',
  'move:castle:kingside',
  'move:castle:queenside',
  'move:enPassant',
  'move:promotion',
  'move:underpromotion',
  'move:promotionCapture',
  'draw:offered',
  'draw:declined',
];
