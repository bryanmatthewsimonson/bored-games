import { describe, expect, it } from 'vitest';
import { chess, DEFAULT_RULES, legalActionsOf, START_FEN, toFen } from '../../src/index.ts';
import { act, fen, legal, move, play, rejects, start } from '../helpers.ts';

describe('setup and encoding', () => {
  it('C01 the start position: seat 0 is White and moves first', () => {
    const s = start();
    expect(toFen(s)).toBe(START_FEN);
    expect(chess.pending(s)).toEqual({ type: 'player', seat: 0, decision: 'move' });
    expect(legalActionsOf(s, 0).filter((a) => a.type === 'move' && !a.offerDraw)).toHaveLength(20);
    expect(legalActionsOf(s, 1)).toEqual([]);
    expect(chess.seatRange(DEFAULT_RULES)).toEqual({ min: 2, max: 2 });
    for (const seats of [1, 3]) {
      const r = chess.setup({ rules: DEFAULT_RULES, seats, mode: 'full', deckOrders: {} });
      expect(r.ok ? null : r.error.code).toBe('seats');
    }
    for (const viewer of [0, 1, null]) {
      const v = chess.setup({ rules: DEFAULT_RULES, seats: 2, mode: 'view', viewer });
      expect(v.ok && v.value).toEqual(s);
    }
  });

  it('C02 castling is written as the king move', () => {
    const s = fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(legal(s, 'e1g1')).toBe(true);
    expect(legal(s, 'e1c1')).toBe(true);
    rejects(s, move(s, 'e1h1'), 'illegal');
    rejects(s, move(s, 'e1a1'), 'illegal');
  });

  it('C03 non-canonical encodings are rejected', () => {
    const s = start();
    const ok = { type: 'move', actor: 0, uci: 'e2e4' };
    expect(act(s, ok).state.turn).toBe('b');
    for (const bad of [
      { ...ok, uci: 'E2E4' },
      { ...ok, uci: 'e2e4 ' },
      { ...ok, uci: '0000' },
      { ...ok, uci: 'e2-e4' },
      { ...ok, uci: 'e2e4x' },
      { ...ok, extra: 1 },
      { ...ok, offerDraw: false },
      { ...ok, offerDraw: 1 },
      { ...ok, actor: '0' },
      { ...ok, actor: 0.5 },
      { ...ok, actor: 2 },
      { type: 'move', uci: 'e2e4' },
      { type: 'Move', actor: 0, uci: 'e2e4' },
      { type: 'acceptDraw', actor: 0, uci: 'e2e4' },
      null,
      'e2e4',
      ['move', 0, 'e2e4'],
    ]) {
      rejects(s, bad, 'malformed');
    }
    const hostile = Object.defineProperty({ type: 'move', actor: 0 }, 'uci', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    rejects(s, hostile, 'malformed');
  });

  it('C04 the promotion letter is required exactly when a pawn reaches the last rank', () => {
    const s = fen('8/4P3/8/8/8/8/k7/4K3 w - - 0 1');
    rejects(s, move(s, 'e7e8'), 'illegal');
    rejects(s, move(s, 'e7e8Q'), 'malformed');
    expect(legal(s, 'e7e8q')).toBe(true);
    const s0 = start();
    rejects(s0, move(s0, 'e2e4q'), 'illegal');
    rejects(s0, move(s0, 'g1f3n'), 'illegal');
  });

  it('C05 only the seat to move may act, and nothing after the end', () => {
    const s = start();
    rejects(s, { type: 'move', actor: 1, uci: 'e7e5' }, 'turn');
    const over = play(s, 'f2f3 e7e5 g2g4 d8h4');
    expect(over.result?.reason).toBe('checkmate');
    rejects(over, { type: 'move', actor: 0, uci: 'a2a3' }, 'over');
    rejects(over, { type: 'acceptDraw', actor: 0 }, 'over');
    expect(chess.pending(over)).toEqual({ type: 'over' });
    expect(legalActionsOf(over, 0)).toEqual([]);
  });
});
