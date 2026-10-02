import { describe, expect, it } from 'vitest';
import { chess, isCheck, legalMoveList } from '../../src/index.ts';
import { act, at, fen, move, play, start } from '../helpers.ts';

describe('promotion', () => {
  it('C20 promotion to each piece, with or without a capture', () => {
    const s = fen('3r4/4P3/8/8/8/8/k7/4K3 w - - 0 1');
    const promos = legalMoveList(s)
      .filter((m) => m.promotion !== null)
      .map((m) => m.uci);
    expect(promos).toEqual(['e7d8b', 'e7d8n', 'e7d8q', 'e7d8r', 'e7e8b', 'e7e8n', 'e7e8q', 'e7e8r']);
    for (const [uci, piece, san] of [
      ['e7e8q', 'Q', 'e8=Q'],
      ['e7e8r', 'R', 'e8=R'],
      ['e7e8b', 'B', 'e8=B'],
      ['e7e8n', 'N', 'e8=N'],
      ['e7d8q', 'Q', 'exd8=Q'],
      ['e7d8n', 'N', 'exd8=N'],
    ] as const) {
      const r = act(s, move(s, uci));
      expect(at(r.state, uci.slice(2, 4))).toBe(piece);
      expect(at(r.state, 'e7')).toBeNull();
      expect(r.state.history[0]?.san).toBe(san);
      expect(r.state.halfmove).toBe(0);
    }
  });

  it('C21 underpromotion to a knight can give check', () => {
    const s = fen('8/4P1k1/8/8/8/8/8/K7 w - - 0 1');
    const r = act(s, move(s, 'e7e8n'));
    expect(r.state.history[0]?.san).toBe('e8=N+');
    expect(r.events.find((e) => e.type === 'moved')).toMatchObject({ promotion: 'n', check: true });
    expect(chess.coverage?.(r.state, r.events)).toContain('move:underpromotion');
  });
});

describe('check, mate and stalemate', () => {
  it('C22 a pinned piece may not move off the pin line', () => {
    const s = fen('4k3/4r3/8/8/8/8/4N3/4K3 w - - 0 1');
    const moves = legalMoveList(s);
    expect(moves.filter((m) => m.from === 'e2')).toEqual([]);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.from === 'e1')).toBe(true);
  });

  it('C23 discovered check', () => {
    const s = fen('4k3/8/8/8/8/8/4N3/4R2K w - - 0 1');
    const r = act(s, move(s, 'e2c3'));
    expect(r.state.history[0]?.san).toBe('Nc3+');
    expect(isCheck(r.state)).toBe(true);
  });

  it('C24 double check allows only king moves', () => {
    const s = fen('4k3/8/2r5/8/4N3/8/8/K3R3 w - - 0 1');
    const r = act(s, move(s, 'e4d6'));
    expect(r.state.history[0]?.san).toBe('Nd6+');
    const replies = legalMoveList(r.state);
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.every((m) => m.from === 'e8')).toBe(true);
    // A single checker on d6 could be captured by the rook.
    const single = fen('4k3/8/2r5/8/4N3/8/8/K7 w - - 0 1');
    expect(legalMoveList(play(single, 'e4d6')).map((m) => m.uci)).toContain('c6d6');
  });

  it('C25 checkmate ends the game 2-0', () => {
    const s = play(start(), 'f2f3 e7e5 g2g4 d8h4');
    expect(s.result).toEqual({ reason: 'checkmate', winner: 1 });
    expect(chess.outcome(s)).toEqual({ places: [2, 1], scores: [0, 2], reason: 'checkmate' });
    expect(s.history.map((h) => h.san)).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
  });

  it('C26 stalemate is a draw 1-1', () => {
    const s = play(fen('7k/8/8/6Q1/8/8/8/K7 w - - 0 1'), 'g5g6');
    expect(s.result).toEqual({ reason: 'stalemate', winner: null });
    expect(chess.outcome(s)).toEqual({ places: [1, 1], scores: [1, 1], reason: 'stalemate' });
    expect(isCheck(s)).toBe(false);
  });

  it('C27 mate takes precedence over the fifty-move rule', () => {
    const s = play(fen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 99 80'), 'a1a8');
    expect(s.halfmove).toBe(100);
    expect(s.result).toEqual({ reason: 'checkmate', winner: 0 });
  });

  it('C28 stalemate on the hundredth halfmove is reported as stalemate', () => {
    const s = play(fen('7k/8/8/6Q1/8/8/8/K7 w - - 99 80'), 'g5g6');
    expect(s.halfmove).toBe(100);
    expect(s.result?.reason).toBe('stalemate');
  });
});
