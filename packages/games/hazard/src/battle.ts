/*
 * Attacks, dice, captures, the march and the end of a turn (RULES.md "Attack" and "March"). Pure.
 */
import type { Applied } from './engine.ts';
import type { HazardAction, HazardState } from './types.ts';

export function battleLegal(_s: HazardState, _seat: number): HazardAction[] {
  return [];
}

export function applyBattle(_s: HazardState, _a: HazardAction): Applied | string {
  return 'Not yet.';
}
