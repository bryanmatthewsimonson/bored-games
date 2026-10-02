import { describe, expect, it } from 'vitest';
import { isCheck, toFen } from '../../src/index.ts';
import { act, at, fen, legal, move, play } from '../helpers.ts';

describe('en passant', () => {
  it('C15 en passant captures the pawn on its own square, right after the double step', () => {
    const s = play(fen('4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1'), 'd2d4');
    expect(s.ep).toBe('d3');
    expect(toFen(s)).toBe('4k3/8/8/8/3Pp3/8/8/4K3 b - d3 0 1');
    const r = act(s, move(s, 'e4d3'));
    expect([at(r.state, 'd3'), at(r.state, 'd4'), at(r.state, 'e4')]).toEqual(['p', null, null]);
    expect(r.state.history[1]).toMatchObject({ san: 'exd3', captured: 'P' });
    expect(r.events.find((e) => e.type === 'moved')).toMatchObject({ enPassant: true, captured: 'P' });
    expect(r.state.halfmove).toBe(0);
  });

  it('C16 the en passant right expires after one move', () => {
    const s = play(fen('4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1'), 'd2d4 e8d8 e1d1');
    expect(s.ep).toBeNull();
    expect(legal(s, 'e4d3')).toBe(false);
  });

  it('C17 en passant that exposes the king along the rank is illegal', () => {
    const s = play(fen('8/8/8/8/k2p3R/8/4P3/4K3 w - - 0 1'), 'e2e4');
    expect(legal(s, 'd4e3')).toBe(false);
    expect(s.ep).toBeNull();
    expect(toFen(s).split(' ')[3]).toBe('-');
  });

  it('C18 en passant may capture a checking pawn', () => {
    const s = play(fen('8/8/8/5k2/3p4/8/4P3/4K3 w - - 0 1'), 'e2e4');
    expect(isCheck(s)).toBe(true);
    expect(s.ep).toBe('e3');
    const after = play(s, 'd4e3');
    expect(at(after, 'e4')).toBeNull();
    expect(isCheck(after)).toBe(false);
  });

  it('C19 en passant by a pinned pawn is illegal', () => {
    const s = play(fen('1B6/8/8/8/5p2/6k1/4P3/4K3 w - - 0 1'), 'e2e4');
    expect(legal(s, 'f4e3')).toBe(false);
    expect(s.ep).toBeNull();
  });
});
