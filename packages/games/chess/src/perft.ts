import type { Result } from '@bored-games/game-kit';
import { clonePos, legalMoves, makeMove, perftPos, uciOf } from './board.ts';
import { fromFen, toPos } from './position.ts';

/** Perft: the number of leaf nodes of the legal move tree to `depth` from a FEN (tests and tools). */
export function perft(fen: string, depth: number): Result<number> {
  const s = fromFen(fen);
  if (!s.ok) return s;
  return { ok: true, value: perftPos(toPos(s.value), depth) };
}

/** Per-move perft counts ("divide"), keyed by UCI, for locating a mismatch. */
export function divide(fen: string, depth: number): Result<Record<string, number>> {
  const s = fromFen(fen);
  if (!s.ok) return s;
  const pos = toPos(s.value);
  const out: Record<string, number> = {};
  for (const m of legalMoves(pos)) {
    const child = clonePos(pos);
    makeMove(child, m);
    out[uciOf(m)] = perftPos(child, depth - 1);
  }
  return { ok: true, value: out };
}
