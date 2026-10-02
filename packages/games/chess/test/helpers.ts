import { expect } from 'vitest';
import {
  applyAction,
  type ChessAction,
  type ChessEvent,
  type ChessState,
  checkInvariants,
  DEFAULT_RULES,
  fromFen,
  START_FEN,
  seatToMove,
  setupGame,
} from '../src/index.ts';

/** A state from FEN; throws on a bad FEN (tests only). */
export function fen(text: string): ChessState {
  const r = fromFen(text);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

export function start(): ChessState {
  const r = setupGame({ rules: DEFAULT_RULES, seats: 2, mode: 'full', deckOrders: {} });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

export const startFen = START_FEN;

export function move(s: ChessState, uci: string, offerDraw = false): ChessAction {
  const a = { type: 'move', actor: seatToMove(s), uci } as const;
  return offerDraw ? { ...a, offerDraw: true } : a;
}

export interface Played {
  readonly state: ChessState;
  readonly events: readonly ChessEvent[];
}

/** Applies one action, asserting it is accepted and the result is sound. */
export function act(s: ChessState, action: unknown): Played {
  const r = applyAction(s, action);
  if (!r.ok) throw new Error(`rejected ${JSON.stringify(action)}: ${r.error.code} ${r.error.message}`);
  expect(checkInvariants(r.state)).toEqual([]);
  return { state: r.state, events: r.events };
}

/** Plays space-separated UCI moves, each by the seat to move. */
export function play(s: ChessState, moves: string): ChessState {
  let state = s;
  for (const uci of moves.split(/\s+/).filter(Boolean)) state = act(state, move(state, uci)).state;
  return state;
}

/** Asserts that `action` is rejected with `code`. */
export function rejects(s: ChessState, action: unknown, code: string): void {
  const r = applyAction(s, action);
  let label: string;
  try {
    label = JSON.stringify(action);
  } catch {
    label = 'an unprintable action';
  }
  expect(r.ok, `expected ${label} to be rejected`).toBe(false);
  if (!r.ok) expect(r.error.code).toBe(code);
}

export function legal(s: ChessState, uci: string): boolean {
  return applyAction(s, move(s, uci)).ok;
}

export function ofType<T extends ChessEvent['type']>(
  events: readonly ChessEvent[],
  type: T,
): Extract<ChessEvent, { type: T }>[] {
  return events.filter((e): e is Extract<ChessEvent, { type: T }> => e.type === type);
}

/** The piece on a square. */
export function at(s: ChessState, square: string): string | null {
  const sq = (square.charCodeAt(1) - 49) * 8 + (square.charCodeAt(0) - 97);
  return s.board[sq] ?? null;
}
