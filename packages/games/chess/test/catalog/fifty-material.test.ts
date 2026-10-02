import { describe, expect, it } from 'vitest';
import { fen, play } from '../helpers.ts';

describe('fifty-move rule', () => {
  it('C36 one hundred halfmoves without a capture or pawn move draw at once', () => {
    const s1 = play(fen('4k3/8/8/8/8/8/8/R3K3 w - - 98 80'), 'a1a2');
    expect([s1.halfmove, s1.result]).toEqual([99, null]);
    const s2 = play(s1, 'e8d8');
    expect(s2.halfmove).toBe(100);
    expect(s2.result).toEqual({ reason: 'fifty-move', winner: null });
  });

  it('C37 a pawn move resets the clock', () => {
    const s = play(fen('4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80'), 'e2e3');
    expect([s.halfmove, s.result]).toEqual([0, null]);
    expect(s.positions).toHaveLength(1);
  });

  it('C38 a capture resets the clock', () => {
    const s = play(fen('4k3/8/8/8/8/8/r7/R3K3 w - - 99 80'), 'a1a2');
    expect([s.halfmove, s.result]).toEqual([0, null]);
  });

  it('C39 castling and the loss of castling rights do not reset the clock', () => {
    const s1 = play(fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 10 30'), 'e1g1');
    expect([s1.halfmove, s1.castling]).toEqual([11, 'kq']);
    const s2 = play(s1, 'a8b8');
    expect([s2.halfmove, s2.castling]).toEqual([12, 'k']);
  });
});

describe('insufficient material', () => {
  const material = { reason: 'material', winner: null };

  it('C40 king against king', () => {
    const s = play(fen('4k3/8/8/8/8/8/3p4/4K3 w - - 0 1'), 'e1d2');
    expect(s.result).toEqual(material);
  });

  it('C41 king and bishop against king', () => {
    expect(fen('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1').result).toEqual(material);
    expect(fen('4k3/8/8/8/8/8/8/4K1b1 w - - 0 1').result).toEqual(material);
  });

  it('C42 king and knight against king', () => {
    expect(fen('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1').result).toEqual(material);
    expect(fen('4k3/8/8/8/8/8/8/4K1n1 w - - 0 1').result).toEqual(material);
  });

  it('C43 kings and bishops all on one square colour', () => {
    // c1, b2 and e3 are all dark squares.
    expect(fen('4k3/8/8/8/8/8/1b6/2B1K3 w - - 0 1').result).toEqual(material);
    expect(fen('4k3/8/8/8/8/4B3/1b6/2B1K3 w - - 0 1').result).toEqual(material);
    // f1 and c4 are light squares.
    expect(fen('4k3/8/8/8/2b5/8/8/4KB2 w - - 0 1').result).toEqual(material);
  });

  it('C44 two knights against a king are not a dead position', () => {
    expect(fen('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1').result).toBeNull();
  });

  it('C45 knight against knight, and bishop against knight, are not dead positions', () => {
    expect(fen('4k3/8/8/8/8/8/1n6/1N2K3 w - - 0 1').result).toBeNull();
    expect(fen('4k3/8/8/8/8/8/1n6/2B1K3 w - - 0 1').result).toBeNull();
  });

  it('C46 opposite-coloured bishops are not a dead position', () => {
    // b3 is light, c1 is dark.
    expect(fen('4k3/8/8/8/8/1b6/8/2B1K3 w - - 0 1').result).toBeNull();
  });

  it('C47 any pawn, rook or queen keeps the game alive', () => {
    expect(fen('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1').result).toBeNull();
    expect(fen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1').result).toBeNull();
    expect(fen('4k3/8/8/8/8/8/8/3QK3 w - - 0 1').result).toBeNull();
    // A capture that leaves K+N v K ends the game at once.
    expect(play(fen('4k3/8/8/8/8/2r5/8/1N2K3 w - - 0 1'), 'b1d2').result).toBeNull();
    expect(play(fen('4k3/8/8/8/8/2r5/8/1N2K3 w - - 0 1'), 'b1c3').result).toEqual(material);
  });
});
