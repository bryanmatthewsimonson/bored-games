import { describe, expect, it } from 'vitest';
import { applyAction, fromFen, legalActionsOf, perft, START_FEN } from '../src/index.ts';
import type { ChessState } from '../src/types.ts';

/**
 * Perft counts from chessprogramming.org ("Perft Results"). `fast` depths run
 * in `pnpm check`; set CHESS_PERFT_DEEP=1 for the deeper ones (recorded in
 * docs/PLAN.md).
 */
interface Case {
  readonly name: string;
  readonly fen: string;
  readonly counts: readonly number[];
  readonly fast: number;
  readonly deep: number;
}

const CASES: readonly Case[] = [
  {
    name: 'start',
    fen: START_FEN,
    counts: [20, 400, 8902, 197281, 4865609, 119060324],
    fast: 4,
    deep: 6,
  },
  {
    name: 'kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    counts: [48, 2039, 97862, 4085603, 193690690],
    fast: 3,
    deep: 5,
  },
  {
    name: 'position 3',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    counts: [14, 191, 2812, 43238, 674624, 11030083, 178633661],
    fast: 5,
    deep: 7,
  },
  {
    name: 'position 4',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    counts: [6, 264, 9467, 422333, 15833292],
    fast: 4,
    deep: 5,
  },
  {
    name: 'position 4 mirrored',
    fen: 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1',
    counts: [6, 264, 9467, 422333, 15833292],
    fast: 4,
    deep: 5,
  },
  {
    name: 'position 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    counts: [44, 1486, 62379, 2103487, 89941194],
    fast: 4,
    deep: 5,
  },
  {
    name: 'position 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    counts: [46, 2079, 89890, 3894594, 164075551],
    fast: 3,
    deep: 5,
  },
];

const DEEP = process.env.CHESS_PERFT_DEEP === '1';

describe('perft (move generator)', () => {
  for (const c of CASES) {
    const depth = DEEP ? c.deep : c.fast;
    for (let d = 1; d <= depth; d++) {
      it(`${c.name} depth ${d} = ${c.counts[d - 1]}`, () => {
        expect(perft(c.fen, d)).toEqual({ ok: true, value: c.counts[d - 1] });
      });
    }
  }
});

/** The same count through the public module API (legalActions + apply on JSON states). */
function modulePerft(s: ChessState, depth: number): number {
  if (depth === 0) return 1;
  const seat = s.turn === 'w' ? 0 : 1;
  const moves = legalActionsOf(s, seat).filter((a) => a.type === 'move' && !('offerDraw' in a));
  if (depth === 1) return moves.length;
  let n = 0;
  for (const a of moves) {
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(r.error.message);
    // A game ended by an automatic draw still has moves on the board for perft's purposes.
    n += r.state.result ? perftIgnoringDraws(r.state, depth - 1) : modulePerft(r.state, depth - 1);
  }
  return n;
}

function perftIgnoringDraws(s: ChessState, depth: number): number {
  if (s.result?.reason === 'checkmate' || s.result?.reason === 'stalemate') return 0;
  return modulePerft({ ...s, result: null }, depth);
}

describe('perft through the module API', () => {
  it('start depth 3 = 8902', () => {
    const s = fromFen(START_FEN);
    if (!s.ok) throw new Error(s.error.message);
    expect(modulePerft(s.value, 3)).toBe(8902);
  });
  it('kiwipete depth 2 = 2039', () => {
    const s = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    if (!s.ok) throw new Error(s.error.message);
    expect(modulePerft(s.value, 2)).toBe(2039);
  });
  it('position 4 depth 3 = 9467', () => {
    const s = fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
    if (!s.ok) throw new Error(s.error.message);
    expect(modulePerft(s.value, 3)).toBe(9467);
  });
});
