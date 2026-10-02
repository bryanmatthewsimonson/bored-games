/*
 * The Chess screen's pure helpers, and the board rendered without a DOM.
 */
import { applyAction, type ChessState, chess, fromFen, START_FEN } from '@bored-games/chess';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { BoardGrid } from '../src/games/chess/game.tsx';
import {
  boardSquares,
  canAcceptDraw,
  capturedText,
  drawNotice,
  isDark,
  materialViews,
  moveAction,
  moveRows,
  resultView,
  scoreText,
  squareLabel,
  squareViews,
  statusLine,
  stepSquare,
} from '../src/games/chess/model.ts';
import { PIECE_SVG, pieceSrc } from '../src/games/chess/pieces/cburnett.ts';
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

  it('labels squares with their piece for screen readers', () => {
    const s = start();
    expect(squareLabel(s, 'g1')).toBe('g1, white knight');
    expect(squareLabel(s, 'e8')).toBe('e8, black king');
    expect(squareLabel(s, 'e4')).toBe('e4, empty');
  });

  it('has an SVG image for each of the 12 pieces', () => {
    const pieces = Object.keys(PIECE_SVG).sort();
    expect(pieces).toEqual(['B', 'K', 'N', 'P', 'Q', 'R', 'b', 'k', 'n', 'p', 'q', 'r']);
    for (const p of pieces) {
      const svg = PIECE_SVG[p as keyof typeof PIECE_SVG];
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">'), p).toBe(true);
      expect(svg.endsWith('</svg>'), p).toBe(true);
    }
    expect(pieceSrc('K').startsWith('data:image/svg+xml,')).toBe(true);
  });

  it('moves keyboard focus by arrow keys as the board is shown, stopping at the edge', () => {
    expect(stepSquare('e2', 'ArrowUp', false)).toBe('e3');
    expect(stepSquare('e2', 'ArrowUp', true)).toBe('e1');
    expect(stepSquare('e2', 'ArrowLeft', false)).toBe('d2');
    expect(stepSquare('e2', 'ArrowLeft', true)).toBe('f2');
    expect(stepSquare('a8', 'ArrowUp', false)).toBe('a8');
    expect(stepSquare('a8', 'ArrowLeft', false)).toBe('a8');
    expect(stepSquare('c5', 'Home', false)).toBe('a5');
    expect(stepSquare('c5', 'End', true)).toBe('a5');
    expect(stepSquare('c5', 'x', false)).toBeNull();
    expect(stepSquare('z9', 'ArrowUp', false)).toBeNull();
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
    expect(v.find((x) => x.square === 'g1')?.label).toBe('g1, white knight, selected');
    expect(v.find((x) => x.square === 'f3')?.label).toBe('f3, empty, legal move');
    expect(v.find((x) => x.square === 'f3')?.target).toBe('move');
    // Edge coordinates: ranks down the left column, files along the bottom row.
    expect(v.filter((x) => x.rankHint !== null).map((x) => x.rankHint)).toEqual([
      '8',
      '7',
      '6',
      '5',
      '4',
      '3',
      '2',
      '1',
    ]);
    expect(v.filter((x) => x.fileHint !== null).map((x) => x.fileHint)).toEqual([...'abcdefgh']);
    const after = play(s, 'e2e4', 'f7f6', 'd1h5');
    const v2 = squareViews(after, true, null);
    expect(
      v2
        .filter((x) => x.last)
        .map((x) => x.square)
        .sort(),
    ).toEqual(['d1', 'h5']);
    expect(v2.find((x) => x.check)?.square).toBe('e8');
    expect(v2.find((x) => x.check)?.label).toBe('e8, black king, in check');
    expect(v2.find((x) => x.square === 'h5')?.label).toBe('h5, white queen, last move');
    expect(v2.filter((x) => x.fileHint !== null).map((x) => x.fileHint)).toEqual([...'hgfedcba']);
  });

  it('rings captures, en passant included, and dots quiet moves', () => {
    const s = play(start(), 'e2e4', 'd7d5', 'e4e5', 'f7f5');
    const v = squareViews(s, false, 'e5');
    const kinds = Object.fromEntries(v.filter((x) => x.target !== null).map((x) => [x.square, x.target]));
    expect(kinds).toEqual({ e6: 'move', f6: 'capture' });
    const t = squareViews(play(start(), 'e2e4', 'd7d5'), false, 'e4');
    expect(t.find((x) => x.square === 'd5')?.label).toBe('d5, black pawn, capture, last move');
  });

  it('counts captured pieces and the material lead per side', () => {
    const s = play(start(), 'e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3', 'd5a2', 'a1a2');
    const [w, b] = materialViews(s);
    expect(w).toEqual({ captured: ['q', 'p'], lead: 8 });
    expect(b).toEqual({ captured: ['P', 'P'], lead: 0 });
    expect(capturedText(w.captured)).toBe('a queen and a pawn');
    expect(capturedText(b.captured)).toBe('2 pawns');
    expect(capturedText([])).toBe('nothing');
  });

  it('words a standing draw offer for each viewer', () => {
    const s0 = start();
    const r = applyAction(s0, { type: 'move', actor: 0, uci: 'e2e4', offerDraw: true });
    if (!r.ok) throw new Error(r.error.message);
    expect(drawNotice(r.state, NAMES, 1)).toEqual({
      kind: 'incoming',
      text: 'Ann (White) offers a draw. Accept it, or decline by making your move.',
    });
    expect(drawNotice(r.state, NAMES, 0)?.kind).toBe('outgoing');
    expect(drawNotice(r.state, NAMES, null)?.kind).toBe('other');
    expect(drawNotice(s0, NAMES, 0)).toBeNull();
    expect(drawNotice(play(r.state, 'e7e5'), NAMES, 1)).toBeNull();
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

  it('lists moves in numbered pairs, with draw offers marked', () => {
    const s = play(start(), 'f2f3', 'e7e5', 'g2g4');
    expect(moveRows(s.history)).toEqual([
      {
        n: 1,
        white: { san: 'f3', offer: false, ply: 0 },
        black: { san: 'e5', offer: false, ply: 1 },
      },
      { n: 2, white: { san: 'g4', offer: false, ply: 2 }, black: null },
    ]);
    const mated = applyAction(s, { type: 'move', actor: 1, uci: 'd8h4', offerDraw: true });
    if (!mated.ok) throw new Error('mate');
    // The offer on the mating move is void, so the list does not mark it.
    expect(moveRows(mated.state.history)[1]?.black).toEqual({ san: 'Qh4#', offer: false, ply: 3 });
    const offered = applyAction(s, { type: 'move', actor: 1, uci: 'a7a6', offerDraw: true });
    if (!offered.ok) throw new Error('offer');
    expect(moveRows(offered.state.history)[1]?.black).toEqual({ san: 'a6', offer: true, ply: 3 });
  });

  it('words the status and the result: mate, resign and timeout', () => {
    const s = start();
    expect(statusLine(s, NAMES, 0)).toBe('Your move (White)');
    expect(statusLine(s, NAMES, 1)).toBe('Ann to move (White)');
    const mate = play(s, 'f2f3', 'e7e5', 'g2g4', 'd8h4');
    expect(statusLine(mate, NAMES, 0)).toBe('Checkmate: Bo (Black) wins');
    expect(resultView(mate, { places: [2, 1], reason: 'checkmate', scores: [0, 2] }, NAMES, [], [])).toEqual({
      score: '0–1',
      headline: 'Checkmate: Bo (Black) wins',
      detail: 'Ann (White) is in check and has no legal move.',
    });
    expect(resultView(s, null, NAMES, [], [])).toBeNull();
    // After a resign or a timeout the scores stay 1–1 (standings during play); the places say who won (D048).
    expect(resultView(s, { places: [1, 2], reason: 'resign', scores: [1, 1] }, NAMES, [1], [1])).toEqual({
      score: '1–0',
      headline: 'Bo (Black) resigned: Ann (White) wins',
      detail: '',
    });
    expect(resultView(s, { places: [2, 1], reason: 'forfeit', scores: [1, 1] }, NAMES, [], [0])).toEqual({
      score: '0–1',
      headline: 'Bo (Black) wins on time',
      detail: 'Ann (White) missed the move deadline and forfeits the game.',
    });
    expect(scoreText({ places: [1, 1], reason: 'agreement', scores: [1, 1] })).toBe('½–½');
  });

  it('explains every board ending', () => {
    const offer = applyAction(start(), { type: 'move', actor: 0, uci: 'e2e4', offerDraw: true });
    if (!offer.ok) throw new Error('offer');
    const agreed = applyAction(offer.state, { type: 'acceptDraw', actor: 1 });
    if (!agreed.ok) throw new Error('accept');
    const draw = { places: [1, 1], reason: 'agreement', scores: [1, 1] };
    expect(resultView(agreed.state, draw, NAMES, [], [])).toEqual({
      score: '½–½',
      headline: 'Draw by agreement',
      detail: 'Bo (Black) accepted the draw offer.',
    });
    const stale = fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', chess.defaultRules());
    if (!stale.ok) throw new Error(stale.error.message);
    const fakeEnd = (reason: 'stalemate' | 'repetition' | 'fifty-move' | 'material'): ChessState => ({
      ...stale.value,
      result: { reason, winner: null },
    });
    expect(resultView(fakeEnd('stalemate'), draw, NAMES, [], [])?.detail).toBe(
      'Bo (Black) has no legal move but is not in check.',
    );
    for (const reason of ['repetition', 'fifty-move', 'material'] as const) {
      const v = resultView(fakeEnd(reason), draw, NAMES, [], []);
      expect(v?.headline).toMatch(/^Draw by /);
      expect(v?.detail).not.toBe('');
    }
  });
});

describe('BoardGrid', () => {
  it('renders 64 labelled buttons, one in the tab order, with coordinates on the edges', () => {
    const tree = renderTree(
      h(BoardGrid, {
        squares: squareViews(start(), false, 'g1'),
        interactive: true,
        tabSquare: 'g1',
        movable: new Set(['g1']),
        dragFrom: null,
        onSquare: () => {},
      }),
    );
    const buttons = findAll(tree, (el) => el.tag === 'button');
    expect(buttons).toHaveLength(64);
    expect(buttons[0]?.attrs['aria-label']).toBe('a8, black rook');
    expect(buttons[63]?.attrs['data-square']).toBe('h1');
    expect(buttons.filter((b) => b.attrs.tabIndex === 0).map((b) => b.attrs['data-square'])).toEqual(['g1']);
    const marks = findAll(tree, (el) => String(el.attrs.class ?? '').startsWith('chess-mark'));
    expect(marks.map((m) => m.attrs.class)).toEqual(['chess-mark move', 'chess-mark move']);
    expect(findAll(tree, (el) => el.tag === 'img')).toHaveLength(32);
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
