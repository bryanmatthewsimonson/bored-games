/*
 * The muster and the charters: drawing, cashing a set, reshuffles and the transfer on elimination (RULES.md
 * "Muster" and "Charters"). Pure.
 */
import type { Applied } from './engine.ts';
import type { HazardAction, HazardState } from './types.ts';

export function chartersLegal(_s: HazardState, _seat: number): HazardAction[] {
  return [];
}

export function applyCharters(_s: HazardState, _a: HazardAction): Applied | string {
  return 'Not yet.';
}
