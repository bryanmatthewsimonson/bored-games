/*
 * Invariants of every reachable state (the fuzzer checks them after each step) and rare-event tags for its coverage
 * report.
 */
import { FUEL_TOTAL, STATIONS, TABLES, type Table, YARD_PRICES } from './data.ts';
import { capsOf, fits } from './fuel.ts';
import { CITY_COUNT, CITY_REGION } from './map.ts';
import type { CurrentEvent, CurrentState } from './types.ts';

const int = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

export function checkInvariants(s: CurrentState): string[] {
  const out: string[] = [];
  const table = TABLES[s.seats] as Table;
  s.companies.forEach((c, i) => {
    if (!int(c.money)) out.push(`seat ${i} has money ${c.money}`);
    if (c.fuel.length !== 4 || !c.fuel.every(int)) out.push(`seat ${i} fuel ${JSON.stringify(c.fuel)}`);
    const scrapping = s.scrapping?.seat === i;
    if (c.stations.length > table.maxStations + (scrapping ? 1 : 0))
      out.push(`seat ${i} has too many stations`);
    if (!scrapping && !fits(c.fuel, capsOf(c.stations))) out.push(`seat ${i} stores more fuel than it can`);
    if (c.cities.length > 22) out.push(`seat ${i} has more than 22 substations`);
    for (const city of c.cities)
      if (!(s.houses[city] ?? []).includes(i)) out.push(`seat ${i} city ${city} has no house`);
    if (new Set(c.cities).size !== c.cities.length) out.push(`seat ${i} wired a city twice`);
  });
  for (let r = 0; r < 4; r++) {
    const yard = s.yard[r] ?? -1;
    if (!int(yard) || yard > (YARD_PRICES[r]?.length ?? 0)) out.push(`yard ${r} holds ${yard}`);
    const held = s.companies.reduce((t, c) => t + (c.fuel[r] ?? 0), 0);
    if (yard + held > (FUEL_TOTAL[r] ?? 0)) out.push(`fuel ${r}: ${yard} in the yard and ${held} held`);
  }
  // Every station is in exactly one place.
  const st = s.stack;
  const places = [
    ...s.market,
    ...s.companies.flatMap((c) => c.stations),
    ...s.gone,
    ...st.top,
    ...st.pool,
    ...st.under,
    ...st.boxed,
  ].sort((a, b) => a - b);
  const all = STATIONS.map((x) => x.n);
  if (places.join(',') !== all.join(',')) out.push(`stations are not each in one place: ${places.join(',')}`);
  if (!int(st.draws) || st.draws > st.pool.length) out.push(`stack draws ${st.draws} of ${st.pool.length}`);
  if (s.market.some((n, i) => i > 0 && (s.market[i - 1] as number) >= n)) out.push('market not ascending');
  if (s.houses.length !== CITY_COUNT) out.push('houses length');
  s.houses.forEach((h, city) => {
    if (h.length > s.era) out.push(`city ${city} holds ${h.length} in era ${s.era}`);
    if (h.length > 0 && !s.regions.includes(CITY_REGION[city] ?? -1)) out.push(`city ${city} is not in play`);
    for (const seat of h)
      if (!(s.companies[seat]?.cities ?? []).includes(city)) out.push(`city ${city} seat ${seat}`);
  });
  if (s.phase !== 'opening' && [...s.order].sort().join(',') !== s.companies.map((_, i) => i).join(','))
    out.push(`order ${s.order.join(',')}`);
  if ((s.phase === 'over') !== (s.result !== null)) out.push('result and phase disagree');
  if (s.roll !== null && s.rolls.at(-1)?.id !== s.roll.id) out.push('the open roll is not the last');
  if (s.history.length > 60) out.push('history too long');
  return out;
}

export function coverageOf(_s: CurrentState, events: readonly CurrentEvent[]): string[] {
  const tags: string[] = [];
  for (const e of events) {
    if (e.type === 'era') tags.push(`era:${e.era}`);
    if (e.type === 'scrap') tags.push('move:scrap');
    if (e.type === 'scrap' && e.lost.some((n) => n > 0)) tags.push('move:scrapLost');
    if (e.type === 'shuffled') tags.push('stack:shuffled');
    if (e.type === 'drew' && e.station === null) tags.push('stack:empty');
    if (e.type === 'pass') tags.push('move:pass');
    if (e.type === 'removed') tags.push('market:removed');
    if (e.type === 'end') tags.push('end:cities');
  }
  if (events.some((e) => e.type === 'era' && e.era === 3)) {
    if (_s.phase === 'fuel') tags.push('era3:auction');
    if (_s.phase === 'power') tags.push('era3:build');
    if (_s.phase === 'auction' && _s.round > 0) tags.push('era3:payday');
  }
  return tags;
}
