import type { TilestockRules } from './rules.ts';
import { NEIGHBORS } from './tiles.ts';
import { type Cell, LOOSE } from './types.ts';

/** Tile counts per chain index. */
export function chainSizes(board: readonly Cell[], chainCount: number): number[] {
  const sizes = new Array<number>(chainCount).fill(0);
  for (const cell of board) if (cell !== null && cell >= 0) sizes[cell] = (sizes[cell] ?? 0) + 1;
  return sizes;
}

export function activeChains(sizes: readonly number[]): number[] {
  const out: number[] = [];
  for (let c = 0; c < sizes.length; c++) if ((sizes[c] ?? 0) > 0) out.push(c);
  return out;
}

/** All tiles reachable from `start` through cells accepted by `pass` (start always included). */
export function flood(board: readonly Cell[], start: number, pass: (cell: Cell) => boolean): number[] {
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const t = stack.pop() as number;
    for (const n of NEIGHBORS[t] ?? []) {
      if (!seen.has(n) && pass(board[n] ?? null)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

export type TileClass =
  | { readonly kind: 'lone' }
  | { readonly kind: 'found' }
  | { readonly kind: 'grow'; readonly chain: number }
  | { readonly kind: 'merge'; readonly chains: readonly number[] }
  /** Would merge two or more safe chains: permanently unplayable. */
  | { readonly kind: 'dead' }
  /** Would found a chain while every chain is on the board: unplayable for now. */
  | { readonly kind: 'blocked' };

/** What placing `tile` on an empty cell would do. Assumes no pending tile on the board. */
export function classifyTile(board: readonly Cell[], rules: TilestockRules, tile: number): TileClass {
  const chains: number[] = [];
  let loose = false;
  for (const n of NEIGHBORS[tile] ?? []) {
    const cell = board[n] ?? null;
    if (cell === LOOSE) loose = true;
    else if (cell !== null && cell >= 0 && !chains.includes(cell)) chains.push(cell);
  }
  chains.sort((a, b) => a - b);
  if (chains.length === 0) {
    if (!loose) return { kind: 'lone' };
    const active = activeChains(chainSizes(board, rules.chains.length)).length;
    return active >= rules.chains.length ? { kind: 'blocked' } : { kind: 'found' };
  }
  if (chains.length === 1) return { kind: 'grow', chain: chains[0] as number };
  const sizes = chainSizes(board, rules.chains.length);
  const safe = chains.filter((c) => (sizes[c] ?? 0) >= rules.safeSize).length;
  return safe >= 2 ? { kind: 'dead' } : { kind: 'merge', chains };
}

export function isPlayable(cls: TileClass): boolean {
  return cls.kind !== 'dead' && cls.kind !== 'blocked';
}

/** Which end condition (if any) currently lets the active player declare the end. */
export function endCondition(board: readonly Cell[], rules: TilestockRules): 'endSize' | 'allSafe' | null {
  const sizes = chainSizes(board, rules.chains.length);
  const active = activeChains(sizes);
  if (active.some((c) => (sizes[c] ?? 0) >= rules.endSize)) return 'endSize';
  if (active.length > 0 && active.every((c) => (sizes[c] ?? 0) >= rules.safeSize)) return 'allSafe';
  return null;
}
