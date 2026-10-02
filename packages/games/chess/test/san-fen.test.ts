import { describe, expect, it } from 'vitest';
import { fromFen, START_FEN, san, toFen } from '../src/index.ts';
import { fen, play, start } from './helpers.ts';

describe('SAN on known positions', () => {
  it('names the opening moves of a known game', () => {
    // The Opera Game, Morphy v Duke of Brunswick and Count Isouard, Paris 1858.
    const ucis =
      'e2e4 e7e5 g1f3 d7d6 d2d4 c8g4 d4e5 g4f3 d1f3 d6e5 f1c4 g8f6 f3b3 d8e7 b1c3 c7c6 c1g5 b7b5 c3b5 c6b5 c4b5 b8d7 e1c1 a8d8 d1d7 d8d7 h1d1 e7e6 b5d7 f6d7 b3b8 d7b8 d1d8';
    const s = play(start(), ucis);
    expect(s.history.map((h) => h.san).join(' ')).toBe(
      'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#',
    );
    expect(s.result).toEqual({ reason: 'checkmate', winner: 0 });
  });

  it('writes pawn captures, promotions, castling with check and mate', () => {
    expect(san(fen('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1'), 'e4d5')).toBe('exd5');
    expect(san(fen('3r2k1/4P3/8/8/8/8/8/4K3 w - - 0 1'), 'e7d8q')).toBe('exd8=Q+');
    expect(san(fen('5k2/8/8/8/8/8/8/4K2R w K - 0 1'), 'e1g1')).toBe('O-O+');
    expect(san(fen('r3k3/8/8/8/8/8/8/3K4 b q - 0 1'), 'e8c8')).toBe('O-O-O+');
    expect(san(fen('k7/8/1K6/8/8/8/8/6Q1 w - - 0 1'), 'g1g8')).toBe('Qg8#');
    expect(san(start(), 'e2e5')).toBeNull();
    expect(san(start(), 'nonsense')).toBeNull();
  });

  it('disambiguates knights by file and by rank', () => {
    const s = fen('4k3/8/8/8/8/8/8/1N1NK3 w - - 0 1');
    expect(san(s, 'b1c3')).toBe('Nbc3');
    expect(san(s, 'd1c3')).toBe('Ndc3');
    const r = fen('4k3/8/8/1N6/8/1N6/8/4K3 w - - 0 1');
    expect(san(r, 'b5d4')).toBe('N5d4');
    expect(san(r, 'b3d4')).toBe('N3d4');
  });
});

describe('FEN', () => {
  const FENS = [
    START_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3',
  ];

  it('round-trips normalized FENs', () => {
    for (const f of FENS) expect(toFen(fen(f))).toBe(f);
  });

  it('tracks the clocks and the en passant square through play', () => {
    const s = play(start(), 'e2e4 d7d5 e4e5 f7f5');
    expect(toFen(s)).toBe('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
    expect(toFen(play(s, 'g1f3'))).toBe('rnbqkbnr/ppp1p1pp/8/3pPp2/8/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 3');
  });

  it('rejects malformed or impossible FENs', () => {
    const bad = [
      '',
      42,
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 extra',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR  w KQkq - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1',
      'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNRR w KQkq - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w KQkq - 0 1',
      'rnbqqbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKKNR w KQkq - 0 1',
      'Pnbqkbnr/1ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w kqKQ - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkqK - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 w KQkq - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e4 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - -1 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 01 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 0',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1.5',
      // The side not to move (Black) is in check.
      '4k3/8/8/8/8/8/8/4RK2 w - - 0 1',
    ];
    for (const f of bad) expect(fromFen(f).ok, String(f)).toBe(false);
  });

  it('accepts a FEN whose side to move is already mated', () => {
    const mated = fen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(mated.result).toEqual({ reason: 'checkmate', winner: 1 });
  });
});
