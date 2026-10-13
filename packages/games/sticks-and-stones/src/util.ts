/*
 * Small pure helpers shared by the engine's files.
 */
import type { Clan, SticksEvent, SticksState } from './types.ts';

export type Applied = { readonly state: SticksState; readonly events: readonly SticksEvent[] };

export const failure = (message: string) => ({ ok: false as const, error: { code: 'invalid', message } });
export const int = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && !Object.is(x, -0);
export const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
export const keys = (x: Record<string, unknown>, ks: readonly string[]): boolean =>
  Object.keys(x).sort().join(',') === [...ks].sort().join(',');
export const plainArray = (x: unknown): x is unknown[] =>
  Array.isArray(x) && Object.keys(x).length === x.length;
export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export const withArray = <T>(xs: readonly T[], i: number, v: T): T[] => {
  const out = [...xs];
  out[i] = v;
  return out;
};

/** The state with `seat`'s clan replaced by `f` of it. */
export const withClan = (s: SticksState, seat: number, f: (c: Clan) => Clan): SticksState => ({
  ...s,
  clans: s.clans.map((c, i) => (i === seat ? f(c) : c)),
});

/** The seats in round order, from `first`. */
export const roundOrder = (seats: number, first: number): number[] =>
  Array.from({ length: seats }, (_, k) => (first + k) % seats);

/** Add goods (a `[w, b, s, g]` vector, possibly negative) to a stock. */
export const addGoods = (stock: readonly number[], delta: readonly number[]): number[] =>
  stock.map((n, i) => n + (delta[i] ?? 0));

/** The highest harvest and the most people a clan can reach (RULES.md C12). */
export const MAX_FIELD = 10;
export const MAX_PEOPLE = 10;
/** The most a tool tile is worth, and the most tiles. */
export const MAX_TOOL = 4;
export const MAX_TOOLS = 3;

/**
 * One step up the tool ladder (RULES.md C11): a new tile worth 1 while there are fewer than three; then the lowest
 * tile goes up by one, an unused one first (so the step can still help this round); nothing past three 4s.
 */
export function gainTool(c: Clan): Clan {
  if (c.tools.length < MAX_TOOLS) return { ...c, tools: [...c.tools, 1], used: [...c.used, false] };
  const low = Math.min(...c.tools);
  if (low >= MAX_TOOL) return c;
  const unused = c.tools.findIndex((v, i) => v === low && !c.used[i]);
  const i = unused >= 0 ? unused : c.tools.indexOf(low);
  return { ...c, tools: withArray(c.tools, i, low + 1) };
}

/** One step on the harvest track, to at most 10. */
export const gainField = (c: Clan): Clan => ({ ...c, field: Math.min(MAX_FIELD, c.field + 1) });

/** Every subset of `0..n-1`, as ascending index lists, the empty one first. */
export function subsets(n: number): number[][] {
  const out: number[][] = [];
  for (let mask = 0; mask < 1 << n; mask++)
    out.push(Array.from({ length: n }, (_, i) => i).filter((i) => (mask >> i) & 1));
  return out;
}
