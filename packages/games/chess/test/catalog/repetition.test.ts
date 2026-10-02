import { describe, expect, it } from 'vitest';
import type { ChessState } from '../../src/index.ts';
import { fen, play, start } from '../helpers.ts';

/** Plays moves one at a time, returning the state after each. */
function each(s: ChessState, moves: string): ChessState[] {
  const out: ChessState[] = [];
  let state = s;
  for (const uci of moves.split(' ')) {
    state = play(state, uci);
    out.push(state);
  }
  return out;
}

const resultAt = (states: readonly ChessState[], n: number): string | null =>
  states[n - 1]?.result?.reason ?? null;

describe('threefold repetition', () => {
  it('C29 threefold repetition draws at once; the start position counts', () => {
    const states = each(start(), 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8');
    expect(resultAt(states, 7)).toBeNull();
    expect(states[7]?.result).toEqual({ reason: 'repetition', winner: null });
  });

  it('C30 repetitions need not be consecutive', () => {
    const states = each(start(), 'g1f3 g8f6 f3g1 f6g8 b1c3 b8c6 c3b1 c6b8');
    expect(resultAt(states, 7)).toBeNull();
    expect(resultAt(states, 8)).toBe('repetition');
  });

  it('C31 different castling rights make a different position', () => {
    const states = each(
      fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'),
      'h1h2 h8h7 h2h1 h7h8 h1h2 h8h7 h2h1 h7h8 h1h2 h8h7',
    );
    // After move 8 the placement and side match the start for the third time, but the start had KQkq.
    expect(states[7]?.positions.at(-1)?.split(' ')[0]).toBe(states[3]?.positions.at(-1)?.split(' ')[0]);
    expect(resultAt(states, 8)).toBeNull();
    // The position after move 2 (rights already lost) recurs after moves 6 and 10.
    expect(resultAt(states, 9)).toBeNull();
    expect(resultAt(states, 10)).toBe('repetition');
  });

  it('C32 the side to move is part of the position', () => {
    const cycle = 'a1a3 e8d8 a3a2 d8e8 a2a1 e8d8 a1a3 d8e8 a3a2 e8d8 a2a1 d8e8';
    const states = each(fen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), `${cycle} ${cycle}`);
    const placement = (s: ChessState | undefined) => s?.positions.at(-1)?.split(' ')[0];
    const start = '4k3/8/8/8/8/8/8/R3K3';
    // The start placement has now stood three times (move 0 and 12 with White to move, move 5 with Black).
    expect([placement(states[4]), placement(states[11])]).toEqual([start, start]);
    expect(states[4]?.turn).toBe('b');
    expect(resultAt(states, 12)).toBeNull();
    expect(states.slice(0, 23).every((s) => s.result === null)).toBe(true);
    expect(resultAt(states, 24)).toBe('repetition');
  });

  it('C33 a double step with no legal en passant capture makes no new position', () => {
    const states = each(start(), 'e2e4 e7e5 g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8');
    expect(states[1]?.ep).toBeNull();
    expect(resultAt(states, 9)).toBeNull();
    expect(resultAt(states, 10)).toBe('repetition');
  });

  it('C34 a legal en passant capture makes the position different', () => {
    const states = each(
      fen('1n2k3/8/8/8/4p3/8/3P4/1N2K3 w - - 0 1'),
      'd2d4 b8c6 b1c3 c6b8 c3b1 b8c6 b1c3 c6b8 c3b1',
    );
    expect(states[0]?.ep).toBe('d3');
    // The placement after d2d4 (Black to move) has stood three times, once with en passant possible.
    expect(states[8]?.positions.filter((k) => k.startsWith('1n2k3/8/8/8/3Pp3/8/8/1N2K3 b'))).toEqual([
      '1n2k3/8/8/8/3Pp3/8/8/1N2K3 b - d3',
      '1n2k3/8/8/8/3Pp3/8/8/1N2K3 b - -',
      '1n2k3/8/8/8/3Pp3/8/8/1N2K3 b - -',
    ]);
    expect(resultAt(states, 9)).toBeNull();
  });

  it('C35 an en passant capture that is pseudo-legal but illegal does not count', () => {
    const states = each(
      fen('8/8/8/8/k2p3R/8/4P3/4K3 w - - 0 1'),
      'e2e4 a4a5 e1d1 a5a4 d1e1 a4a5 e1d1 a5a4 d1e1',
    );
    expect(states[0]?.ep).toBeNull();
    expect(resultAt(states, 8)).toBeNull();
    expect(resultAt(states, 9)).toBe('repetition');
  });
});
