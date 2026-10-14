/*
 * Fuel on stations and in the yard (RULES.md C10–C13, C16, C17): what a company can store, what fuel costs, and every
 * way it can fire its stations. Pure.
 */
import { COAL, FUEL_TOTAL, OIL, stationOf, URANIUM, WASTE, YARD_PRICES } from './data.ts';
import type { Company } from './types.ts';

/** What a set of stations can store: coal only, oil only, either (hybrids), waste, uranium. */
export interface Caps {
  readonly coal: number;
  readonly oil: number;
  readonly hybrid: number;
  readonly waste: number;
  readonly uranium: number;
}

export function capsOf(stations: readonly number[]): Caps {
  const caps = { coal: 0, oil: 0, hybrid: 0, waste: 0, uranium: 0 };
  for (const n of stations) {
    const st = stationOf(n);
    if (st === undefined || st.kind === 'green') continue;
    caps[st.kind] += 2 * st.burn;
  }
  return caps;
}

/** Whether `fuel` fits on stations with `caps`, moved between them as the company likes (C13). */
export function fits(fuel: readonly number[], caps: Caps): boolean {
  const [c = 0, o = 0, w = 0, u = 0] = fuel;
  return (
    c <= caps.coal + caps.hybrid &&
    o <= caps.oil + caps.hybrid &&
    c + o <= caps.coal + caps.oil + caps.hybrid &&
    w <= caps.waste &&
    u <= caps.uranium
  );
}

/** The cost of `k` units of fuel `r` from a yard that holds `held` of it: the cheapest units first (C12). */
export function priceOf(r: number, held: number, k: number): number {
  const prices = YARD_PRICES[r] ?? [];
  let total = 0;
  for (let j = 0; j < k; j++) total += prices[prices.length - held + j] ?? 0;
  return total;
}

/** The cost of a purchase `buy` from `yard`. */
export const costOf = (yard: readonly number[], buy: readonly number[]): number =>
  buy.reduce((t, k, r) => t + priceOf(r, yard[r] ?? 0, k), 0);

/** Units of fuel `r` neither in the yard nor on any station: the supply the restock draws on (C18). */
export function supplyOf(r: number, yard: readonly number[], companies: readonly Company[]): number {
  const held = companies.reduce((t, c) => t + (c.fuel[r] ?? 0), 0);
  return (FUEL_TOTAL[r] ?? 0) - (yard[r] ?? 0) - held;
}

/**
 * The fuel a company may keep after scrapping a station (C09): every most it can keep, as `[coal, oil, waste,
 * uranium]`. Only the split between coal and oil on hybrids is a choice, so the list is short.
 */
export function keepOptions(fuel: readonly number[], caps: Caps): number[][] {
  const [c = 0, o = 0, w = 0, u = 0] = fuel;
  const waste = Math.min(w, caps.waste);
  const uranium = Math.min(u, caps.uranium);
  const both = caps.coal + caps.oil + caps.hybrid;
  const oilFor = (coal: number): number => Math.min(o, caps.oil + caps.hybrid, both - coal);
  const maxCoal = Math.min(c, caps.coal + caps.hybrid);
  const out: number[][] = [];
  for (let coal = 0; coal <= maxCoal; coal++) {
    const oil = oilFor(coal);
    if (oil < 0) continue;
    // Maximal: one more coal would cost some oil (or there is no more coal to keep).
    if (coal < maxCoal && oilFor(coal + 1) >= oil) continue;
    out.push([coal, oil, waste, uranium]);
  }
  return out;
}

/** One way to fire: the stations, ascending, and how much of the hybrids' burn is coal (the rest is oil). */
export interface Firing {
  readonly stations: readonly number[];
  readonly hybridCoal: number;
}

/** What a firing burns, `[coal, oil, waste, uranium]`, and how many cities it can power. */
export function burnOf(f: Firing): {
  readonly burn: number[];
  readonly hybrid: number;
  readonly powers: number;
} {
  const burn = [0, 0, 0, 0];
  let hybrid = 0;
  let powers = 0;
  for (const n of f.stations) {
    const st = stationOf(n);
    if (st === undefined) continue;
    powers += st.powers;
    if (st.kind === 'coal') burn[COAL] = (burn[COAL] as number) + st.burn;
    else if (st.kind === 'oil') burn[OIL] = (burn[OIL] as number) + st.burn;
    else if (st.kind === 'waste') burn[WASTE] = (burn[WASTE] as number) + st.burn;
    else if (st.kind === 'uranium') burn[URANIUM] = (burn[URANIUM] as number) + st.burn;
    else if (st.kind === 'hybrid') hybrid += st.burn;
  }
  burn[COAL] = (burn[COAL] as number) + f.hybridCoal;
  burn[OIL] = (burn[OIL] as number) + hybrid - f.hybridCoal;
  return { burn, hybrid, powers };
}

/** Every firing the company's fuel allows (C16), the empty one first. */
export function firings(c: Company): Firing[] {
  const out: Firing[] = [];
  const n = c.stations.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const stations = c.stations.filter((_, i) => (mask >> i) & 1);
    const { hybrid } = burnOf({ stations, hybridCoal: 0 });
    for (let h = 0; h <= hybrid; h++) {
      const f = { stations, hybridCoal: h };
      const { burn } = burnOf(f);
      if (burn.every((b, r) => b >= 0 && b <= (c.fuel[r] ?? 0))) out.push(f);
    }
  }
  return out;
}

/** The cities a firing lights: no more than the company has wired. */
export const poweredBy = (c: Company, f: Firing): number => Math.min(c.cities.length, burnOf(f).powers);

/** The most cities the company could light now (C22, and the standings). */
export const bestPower = (c: Company): number => Math.max(0, ...firings(c).map((f) => poweredBy(c, f)));
