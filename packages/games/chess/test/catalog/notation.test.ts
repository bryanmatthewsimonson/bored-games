import { describe, expect, it } from 'vitest';
import { san, toFen } from '../../src/index.ts';
import { fen, play, start } from '../helpers.ts';

describe('notation', () => {
  it('C56 SAN disambiguation looks at legal moves only', () => {
    const file = fen('4k3/8/8/8/8/8/8/R4RK1 w - - 0 1');
    expect(san(file, 'a1d1')).toBe('Rad1');
    expect(san(file, 'f1d1')).toBe('Rfd1');
    const rank = fen('4k3/8/8/R7/8/8/8/R5K1 w - - 0 1');
    expect(san(rank, 'a1a3')).toBe('R1a3');
    expect(san(rank, 'a5a3')).toBe('R5a3');
    const both = fen('2k5/8/8/8/4Q2Q/8/8/K6Q w - - 0 1');
    expect(san(both, 'h4e1')).toBe('Qh4e1');
    expect(san(both, 'e4e1')).toBe('Qee1');
    expect(san(both, 'h1e1')).toBe('Q1e1');
    const pinned = fen('4k3/8/8/8/1b6/2N5/8/4K1N1 w - - 0 1');
    expect(san(pinned, 'g1e2')).toBe('Ne2');
    expect(san(pinned, 'c3e2')).toBeNull();
    const free = fen('4k3/8/8/8/8/2N5/8/4K1N1 w - - 0 1');
    expect(san(free, 'g1e2')).toBe('Nge2');
  });

  it('C57 FEN writes the en passant square only when a capture is legal', () => {
    expect(toFen(play(start(), 'e2e4'))).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(toFen(play(fen('4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1'), 'd2d4')).split(' ')[3]).toBe('d3');
    const imported = fen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(imported.ep).toBeNull();
    expect(toFen(imported)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  });
});
