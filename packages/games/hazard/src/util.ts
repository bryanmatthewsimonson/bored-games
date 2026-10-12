/*
 * Small pure helpers shared by the engine's files.
 */
import { PROVINCES, type ProvinceId, provinceIndex } from './map.ts';
import type { HazardEvent, HazardState } from './types.ts';

export type Applied = { readonly state: HazardState; readonly events: readonly HazardEvent[] };

export const failure = (message: string) => ({ ok: false as const, error: { code: 'invalid', message } });
export const int = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && !Object.is(x, -0);
export const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
export const keys = (x: Record<string, unknown>, ks: readonly string[]): boolean =>
  Object.keys(x).sort().join(',') === [...ks].sort().join(',');
export const plainArray = (x: unknown): x is unknown[] =>
  Array.isArray(x) && Object.keys(x).length === x.length;

/** The index of a province, for the `owner` and `troops` arrays. */
export const at = (p: ProvinceId): number => provinceIndex(p);

/** The provinces `seat` holds, in PROVINCES order. */
export const heldBy = (s: HazardState, seat: number): ProvinceId[] =>
  PROVINCES.filter((_, i) => s.owner[i] === seat);

/** Seats still on the map, in seat order. */
export const alive = (s: HazardState): number[] =>
  Array.from({ length: s.seats }, (_, i) => i).filter((i) => !s.out.includes(i));

/** The next seat after `seat` that is still in play. */
export const nextAlive = (s: HazardState, seat: number): number => {
  for (let k = 1; k <= s.seats; k++) {
    const n = (seat + k) % s.seats;
    if (!s.out.includes(n)) return n;
  }
  return seat;
};

export const withArray = <T>(xs: readonly T[], i: number, v: T): T[] => {
  const out = [...xs];
  out[i] = v;
  return out;
};
