import { describe, expect, it } from 'vitest';
import { act, at, fen, legal, move, play } from '../helpers.ts';

const BOTH = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

describe('castling', () => {
  it('C06 castling on both sides moves the rook', () => {
    const s = fen(BOTH);
    const k = act(s, move(s, 'e1g1'));
    expect([at(k.state, 'g1'), at(k.state, 'f1'), at(k.state, 'h1'), at(k.state, 'e1')]).toEqual([
      'K',
      'R',
      null,
      null,
    ]);
    expect(k.state.castling).toBe('kq');
    expect(k.state.history[0]?.san).toBe('O-O');
    expect(k.events.find((e) => e.type === 'moved')).toMatchObject({ castle: 'kingside' });
    const q = act(s, move(s, 'e1c1'));
    expect([at(q.state, 'c1'), at(q.state, 'd1'), at(q.state, 'a1'), at(q.state, 'b1')]).toEqual([
      'K',
      'R',
      null,
      null,
    ]);
    expect(q.state.history[0]?.san).toBe('O-O-O');
    const b = fen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
    const bk = play(b, 'e8g8');
    expect([at(bk, 'g8'), at(bk, 'f8'), bk.castling]).toEqual(['k', 'r', 'KQ']);
    const bq = play(b, 'e8c8');
    expect([at(bq, 'c8'), at(bq, 'd8'), bq.history[0]?.san]).toEqual(['k', 'r', 'O-O-O']);
  });

  it('C07 a king move loses both rights for good', () => {
    const s = play(fen(BOTH), 'e1f1 e8f8 f1e1 f8e8');
    expect(at(s, 'e1')).toBe('K');
    expect(s.castling).toBe('-');
    expect(legal(s, 'e1g1')).toBe(false);
    expect(legal(s, 'e1c1')).toBe(false);
  });

  it('C08 a rook move loses that side right only', () => {
    const s0 = fen('r3k2r/p7/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const s1 = play(s0, 'h1h2');
    expect(s1.castling).toBe('Qkq');
    const s2 = play(s1, 'a7a6 h2h1 a6a5');
    expect(s2.castling).toBe('Qkq');
    expect(legal(s2, 'e1g1')).toBe(false);
    expect(legal(s2, 'e1c1')).toBe(true);
  });

  it('C09 capturing a rook on its home square removes that right', () => {
    const s = play(fen(BOTH), 'a1a8');
    expect(s.castling).toBe('Kk');
    expect(legal(s, 'e8c8')).toBe(false);
  });

  it('C10 no castling out of check', () => {
    const s = fen('r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1');
    expect(legal(s, 'e1g1')).toBe(false);
    expect(legal(s, 'e1c1')).toBe(false);
  });

  it('C11 no castling through an attacked square', () => {
    const f1 = fen('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1');
    expect(legal(f1, 'e1g1')).toBe(false);
    expect(legal(f1, 'e1c1')).toBe(true);
    const d1 = fen('r3k2r/8/8/8/8/8/3r4/R3K2R w KQkq - 0 1');
    expect(legal(d1, 'e1c1')).toBe(false);
    expect(legal(d1, 'e1g1')).toBe(true);
  });

  it('C12 no castling into check', () => {
    const g1 = fen('r3k2r/8/8/8/8/8/6r1/R3K2R w KQkq - 0 1');
    expect(legal(g1, 'e1g1')).toBe(false);
    expect(legal(g1, 'e1c1')).toBe(true);
    const c1 = fen('r3k2r/8/8/8/8/8/2r5/R3K2R w KQkq - 0 1');
    expect(legal(c1, 'e1c1')).toBe(false);
    expect(legal(c1, 'e1g1')).toBe(true);
  });

  it('C13 queenside castling: b1 may be attacked but must be empty', () => {
    expect(legal(fen('r3k2r/8/8/8/8/8/1r6/R3K2R w KQkq - 0 1'), 'e1c1')).toBe(true);
    expect(legal(fen('r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1'), 'e1c1')).toBe(false);
  });

  it('C14 a piece between king and rook blocks castling', () => {
    const s = fen('r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1');
    expect(legal(s, 'e1g1')).toBe(false);
    expect(legal(s, 'e1c1')).toBe(true);
  });
});
