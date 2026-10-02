/*
 * The Chess screen's pure helpers, and the board rendered without a DOM.
 */
import { applyAction, type ChessState, chess, fromFen, START_FEN } from '@bored-games/chess';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { ChessBoard } from '../src/games/chess/game.tsx';
import {
  boardSquares,
  canAcceptDraw,
  glyph,
  isDark,
  moveAction,
  moveRows,
  resultText,
  squareLabel,
  squareViews,
  statusLine,
} from '../src/games/chess/model.ts';
import { CHESS_RULES_SECTIONS, ChessRulesContent } from '../src/games/chess/rules-page.tsx';
import { findAll, renderTree, spokenText } from './render-tree.ts';

const NAMES = ['Ann', 'Bo'];

function start(): ChessState {
  const r = chess.setup({ rules: chess.defaultRules(), seats: 2, mode: 'view', viewer: null });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function play(s: ChessState, ...ucis: string[]): ChessState {
  let state = s;
  for (const uci of ucis) {
    const r = applyAction(state, { type: 'move', actor: state.turn === 'w' ? 0 : 1, uci });
    if (!r.ok) throw new Error(`${uci}: ${r.error.message}`);
    state = r.state;
  }
  return state;
}

describe('chess board model', () => {
  it('orders squares from White’s side, or flipped for Black', () => {
    const w = boardSquares(false);
    expect(w).toHaveLength(64);
    expect([w[0], w[7], w[56], w[63]]).toEqual(['a8', 'h8', 'a1', 'h1']);
    const b = boardSquares(true);
    expect([b[0], b[7], b[56], b[63]]).toEqual(['h1', 'a1', 'h8', 'a8']);
    expect(new Set(b)).toEqual(new Set(w));
    expect(isDark('a1')).toBe(true);
    expect(isDark('h1')).toBe(false);
  });

  it('labels squares with their piece for screen readers, and shows text glyphs', () => {
    const s = start();
    expect(squareLabel(s, 'g1')).toBe('g1, white knight');
    expect(squareLabel(s, 'e8')).toBe('e8, black king');
    expect(squareLabel(s, 'e4')).toBe('e4, empty');
    expect(glyph('K')).toBe('♔︎');
    expect(glyph('p')).toBe('♟︎');
  });

  it('marks the selected piece, its targets, the last move and a king in check', () => {
    const s = start();
    const v = squareViews(s, false, 'g1');
    expect(
      v
        .filter((x) => x.target)
        .map((x) => x.square)
        .sort(),
    ).toEqual(['f3', 'h3']);
    expect(v.find((x) => x.square === 'g1')?.selected).toBe(true);
    const after = play(s, 'e2e4', 'f7f6', 'd1h5');
    const v2 = squareViews(after, true, null);
    expect(
      v2
        .filter((x) => x.last)
        .map((x) => x.square)
        .sort(),
    ).toEqual(['d1', 'h5']);
    expect(v2.find((x) => x.check)?.square).toBe('e8');
  });

  it('builds the move action, with the chosen promotion and a draw offer', () => {
    const s = start();
    expect(moveAction(s, 0, 'e2', 'e4', 'q', false)).toEqual({ type: 'move', actor: 0, uci: 'e2e4' });
    expect(moveAction(s, 0, 'e2', 'e4', 'q', true)).toEqual({
      type: 'move',
      actor: 0,
      uci: 'e2e4',
      offerDraw: true,
    });
    expect(moveAction(s, 0, 'e2', 'e5', 'q', false)).toBeNull();
    const promo = fromFen('8/4P3/8/8/8/8/k7/4K3 w - - 0 1', chess.defaultRules());
    if (!promo.ok) throw new Error(promo.error.message);
    expect(moveAction(promo.value, 0, 'e7', 'e8', 'n', false)).toEqual({
      type: 'move',
      actor: 0,
      uci: 'e7e8n',
    });
    expect(moveAction(promo.value, 0, 'e7', 'e8', 'q', false)?.type).toBe('move');
    expect(canAcceptDraw([{ type: 'acceptDraw', actor: 1 }])).toBe(true);
    expect(canAcceptDraw([{ type: 'move', actor: 1, uci: 'e7e5' }])).toBe(false);
  });

  it('lists moves in numbered pairs', () => {
    const s = play(start(), 'f2f3', 'e7e5', 'g2g4');
    expect(moveRows(s.history)).toEqual([
      { n: 1, white: 'f3', black: 'e5' },
      { n: 2, white: 'g4', black: null },
    ]);
    const mated = applyAction(s, { type: 'move', actor: 1, uci: 'd8h4' });
    if (!mated.ok) throw new Error('mate');
    expect(moveRows(mated.state.history)[1]).toEqual({ n: 2, white: 'g4', black: 'Qh4#' });
  });

  it('words the status and the result: mate, resign and timeout', () => {
    const s = start();
    expect(statusLine(s, NAMES, 0)).toBe('Your move (White)');
    expect(statusLine(s, NAMES, 1)).toBe('Ann to move (White)');
    const mate = play(s, 'f2f3', 'e7e5', 'g2g4', 'd8h4');
    expect(statusLine(mate, NAMES, 0)).toBe('Checkmate: Bo (Black) wins');
    expect(resultText(mate, { places: [2, 1], reason: 'checkmate', scores: [0, 2] }, NAMES, [])).toBe(
      'Checkmate: Bo (Black) wins',
    );
    expect(resultText(s, null, NAMES, [])).toBeNull();
    expect(resultText(s, { places: [1, 2], reason: 'resign', scores: [1, 1] }, NAMES, [1])).toBe(
      'Bo (Black) resigned: Ann (White) wins',
    );
    expect(resultText(s, { places: [2, 1], reason: 'forfeit', scores: [1, 1] }, NAMES, [])).toBe(
      'Bo (Black) wins on time',
    );
  });
});

describe('ChessBoard', () => {
  it('renders 64 labelled buttons with coordinates on the edges', () => {
    const tree = renderTree(
      h(ChessBoard, { squares: squareViews(start(), false, null), interactive: true, onSquare: () => {} }),
    );
    const buttons = findAll(tree, (el) => el.tag === 'button');
    expect(buttons).toHaveLength(64);
    expect(buttons[0]?.attrs['aria-label']).toBe('a8, black rook');
    expect(buttons[63]?.attrs['data-square']).toBe('h1');
    expect(spokenText(tree)).not.toContain('undefined');
  });
});

describe('ChessRulesContent', () => {
  it('renders every section, each the target of a game-aware contents link', () => {
    const tree = renderTree(h(ChessRulesContent, {}));
    const titles = findAll(tree, (el) => el.tag === 'h2').map((el) => spokenText([el]));
    expect(titles).toEqual(['Contents', ...CHESS_RULES_SECTIONS.map((s) => s.title)]);
    const links = findAll(tree, (el) => el.tag === 'a').map((a) => a.attrs.href);
    for (const s of CHESS_RULES_SECTIONS) expect(links).toContain(`#/rules/chess/${s.id}`);
    expect(START_FEN).toContain('rnbqkbnr');
  });
});
