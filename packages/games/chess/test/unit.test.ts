import { describe, expect, it } from 'vitest';
import {
  applyAction,
  capturedPieces,
  checkedKingSquare,
  checkInvariants,
  chess,
  DEFAULT_RULES,
  isCheck,
  lastMove,
  legalMovesFrom,
  materialDiff,
  moveHistory,
  pieceAt,
  validateRules,
} from '../src/index.ts';
import { CHESS_THEME, pieceName } from '../src/theme.ts';
import { fen, play, start } from './helpers.ts';

describe('rules', () => {
  it('accepts only the supported options', () => {
    expect(validateRules(DEFAULT_RULES)).toEqual({ ok: true, value: DEFAULT_RULES });
    for (const bad of [
      null,
      [],
      {},
      { rulesVersion: 2, drawMode: 'auto' },
      { rulesVersion: 1, drawMode: 'claim' },
      { rulesVersion: 1, drawMode: 'auto', extra: true },
    ]) {
      expect(validateRules(bad).ok).toBe(false);
    }
    const r = chess.setup({ rules: { rulesVersion: 1 } as never, seats: 2, mode: 'full', deckOrders: {} });
    expect(r.ok).toBe(false);
    const v = chess.setup({ rules: DEFAULT_RULES, seats: 2, mode: 'view', viewer: 2 });
    expect(v.ok).toBe(false);
  });
});

describe('apply', () => {
  it('never mutates its input', () => {
    const s = play(start(), 'e2e4 e7e5');
    const before = JSON.stringify(s);
    applyAction(s, { type: 'move', actor: 0, uci: 'g1f3' });
    applyAction(s, { type: 'move', actor: 0, uci: 'g1f3', offerDraw: true });
    applyAction(s, { type: 'acceptDraw', actor: 0 });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('lists each legal move plain and with an offer, in UCI order', () => {
    const actions = chess.legalActions(start(), 0) as { uci?: string; offerDraw?: true }[];
    expect(actions).toHaveLength(40);
    expect(actions[0]).toEqual({ type: 'move', actor: 0, uci: 'a2a3' });
    expect(actions[20]).toEqual({ type: 'move', actor: 0, uci: 'a2a3', offerDraw: true });
  });
});

describe('display helpers', () => {
  it('lists the legal moves of one piece', () => {
    const s = start();
    expect(legalMovesFrom(s, 'g1').map((m) => `${m.uci} ${m.san}`)).toEqual(['g1f3 Nf3', 'g1h3 Nh3']);
    expect(legalMovesFrom(s, 'e1')).toEqual([]);
    expect(legalMovesFrom(s, 'z9')).toEqual([]);
    const promo = legalMovesFrom(fen('8/4P3/8/8/8/8/k7/4K3 w - - 0 1'), 'e7');
    expect(promo.map((m) => m.promotion)).toEqual(['b', 'n', 'q', 'r']);
  });

  it('reports check, the last move, captures and material', () => {
    const s = play(start(), 'e2e4 d7d5 e4d5 d8d5 b1c3 d5e5');
    expect(isCheck(s)).toBe(true);
    expect(checkedKingSquare(s)).toBe('e1');
    expect(checkedKingSquare(start())).toBeNull();
    expect(lastMove(s)).toMatchObject({ seat: 1, moveNumber: 3, uci: 'd5e5', san: 'Qe5+' });
    expect(lastMove(start())).toBeNull();
    expect(moveHistory(s).map((h) => h.san)).toEqual(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qe5+']);
    expect(capturedPieces(s)).toEqual({ byWhite: ['p'], byBlack: ['P'] });
    expect(materialDiff(s)).toBe(0);
    expect(materialDiff(fen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'))).toBe(5);
    expect(pieceAt(s, 'e5')).toBe('q');
    expect(pieceAt(s, 'e4')).toBeNull();
  });

  it('names pieces for the UI', () => {
    expect(pieceName('N')).toBe('white knight');
    expect(pieceName('p')).toBe('black pawn');
    expect(CHESS_THEME.reasons['fifty-move']).toMatch(/fifty/);
  });
});

describe('invariants', () => {
  it('flag broken states', () => {
    const s = start();
    expect(checkInvariants(s)).toEqual([]);
    expect(checkInvariants({ ...s, ep: 'e3' })).not.toEqual([]);
    expect(
      checkInvariants({ ...s, castling: 'KQkq', board: s.board.map((p, i) => (i === 7 ? null : p)) }),
    ).not.toEqual([]);
    expect(checkInvariants({ ...s, positions: [] })).not.toEqual([]);
    expect(checkInvariants({ ...s, drawOffer: 0 })).not.toEqual([]);
    expect(checkInvariants({ ...s, result: { reason: 'checkmate', winner: 0 } })).not.toEqual([]);
    expect(checkInvariants({ ...s, board: s.board.map((p) => (p === 'K' ? null : p)) })).not.toEqual([]);
  });
});
