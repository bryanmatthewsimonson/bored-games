/*
 * The Current Affairs screen model (D091): pure helpers that turn the state, the legal moves and the history into
 * what the screen shows. Names come only from the theme; every rule question is the engine's.
 */
import {
  bestPower,
  buildCost,
  burnOf,
  type Company,
  type CurrentAction,
  type CurrentState,
  canBuy,
  capsOf,
  costOf,
  type Entry,
  type Firing,
  FUELS,
  firings,
  fits,
  onOffer,
  payFor,
  pendingOf,
  poweredBy,
  priceOf,
  REGIONS,
  SUBSTATIONS,
  stationOf,
  tableOf,
} from '@bored-games/current-affairs';
import { CURRENT_THEME as THEME } from '@bored-games/current-affairs/theme';

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export const ROMAN: readonly string[] = ['I', 'II', 'III'];
export const eraName = (era: number): string => `${THEME.words.era} ${ROMAN[era - 1] ?? era}`;

export const seatName = (names: readonly string[], seat: number): string =>
  names[seat] ?? `Player ${seat + 1}`;
export const cityName = (city: number): string => THEME.cities[city] ?? `City ${city + 1}`;
export const regionName = (r: number): string => THEME.regions[REGIONS[r] ?? 'frost'];
export const fuelName = (r: number): string => THEME.fuels[FUELS[r] ?? 'coal'];
export const money = (n: number): string => `${THEME.words.money}${n}`;

/** "a, b and c". */
export function listText(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}

/** "2 coal, 1 oil": a fuel vector in words, or "nothing". */
export function fuelText(v: readonly number[]): string {
  const parts = v.flatMap((n, r) => (n > 0 ? [`${n} ${fuelName(r).toLowerCase()}`] : []));
  return parts.length === 0 ? 'nothing' : parts.join(', ');
}

/** A station in words: "coal, burns 3, powers 5". */
export function stationSpec(n: number): string {
  const st = stationOf(n);
  if (st === undefined) return '';
  const kind = THEME.kinds[st.kind].toLowerCase();
  const cities = `${st.powers} ${st.powers === 1 ? 'city' : 'cities'}`;
  return st.kind === 'green' ? `${kind}, powers ${cities}` : `${kind}, burns ${st.burn}, powers ${cities}`;
}

export const stationText = (n: number): string => `Station ${n} (${stationSpec(n)})`;

/** The phase in the theme's words. */
export function phaseName(s: CurrentState): string {
  switch (s.phase) {
    case 'opening':
      return 'Setting up';
    case 'over':
      return 'Game over';
    default:
      return THEME.phases[s.phase];
  }
}

/** The seat whose decision (or share) is awaited, or null. */
export function actingSeat(s: CurrentState): number | null {
  const p = pendingOf(s);
  return p.type === 'player' ? p.seat : null;
}

/** The status line at the top of the screen. */
export function statusLine(s: CurrentState, names: readonly string[], me: number | null): string {
  const who = (seat: number): string => (seat === me ? 'You' : seatName(names, seat));
  const whom = (seat: number): string => (seat === me ? 'you' : seatName(names, seat));
  const verb = (seat: number, mine: string, theirs: string): string => (seat === me ? mine : theirs);
  if (s.phase === 'over') {
    const places = s.result?.places ?? [];
    const winners = places.flatMap((p, seat) => (p === 1 ? [seat] : []));
    const best = s.result?.scores[winners[0] ?? 0] ?? 0;
    const list = listText(winners.map(who));
    const wins = winners.length === 1 && winners[0] !== me ? 'wins' : 'win';
    return `Game over. ${list} ${wins}, powering ${best} ${best === 1 ? 'city' : 'cities'}.`;
  }
  if (s.roll !== null) {
    switch (s.roll.purpose) {
      case 'regions':
        return 'Drawing the regions in play…';
      case 'order':
        return 'Drawing the order of the first round…';
      default:
        return 'Drawing a power station from the stack…';
    }
  }
  const p = pendingOf(s);
  if (p.type !== 'player') return '';
  const seat = p.seat;
  switch (p.decision) {
    case 'scrap':
      return `${who(seat)} ${verb(seat, 'are', 'is')} over the limit of ${tableOf(s).maxStations} stations: ${verb(seat, 'scrap', 'scraps')} an older one.`;
    case 'bid': {
      const lot = s.lot;
      if (lot === null) return '';
      return `Station ${lot.station}: ${who(lot.leader)} ${verb(lot.leader, 'lead', 'leads')} at ${money(lot.bid)}; ${whom(seat)} ${verb(seat, 'raise or fold', 'raises or folds')}.`;
    }
    case 'open':
      return s.round === 1
        ? `${who(seat)} ${verb(seat, 'put', 'puts')} a station up for auction.`
        : `${who(seat)} ${verb(seat, 'put', 'puts')} a station up for auction, or ${verb(seat, 'pass', 'passes')}.`;
    case 'fuel':
      return `${who(seat)} ${verb(seat, 'buy', 'buys')} fuel.`;
    case 'build':
      return `${who(seat)} ${verb(seat, 'wire', 'wires')} cities.`;
    case 'power':
      return `Payday: ${whom(seat)} ${verb(seat, 'fire', 'fires')} ${verb(seat, 'your', 'their')} stations.`;
    default:
      return '';
  }
}

/** One history line in plain words. */
export function logLine(e: Entry, names: readonly string[]): string {
  const who = (seat: number): string => seatName(names, seat);
  switch (e.kind) {
    case 'regions':
      return `The regions in play: ${listText(e.regions.map(regionName))}.`;
    case 'order':
      return `Player order: ${e.order.map(who).join(', ')}.`;
    case 'round':
      return `Round ${e.round} begins.`;
    case 'pass':
      return `${who(e.seat)} passes in this auction.`;
    case 'won':
      return `${who(e.seat)} buys station ${e.station} for ${money(e.price)}.`;
    case 'scrap':
      return sum(e.lost) > 0
        ? `${who(e.seat)} scraps station ${e.station}, dropping ${fuelText(e.lost)}.`
        : `${who(e.seat)} scraps station ${e.station}.`;
    case 'drew':
      return e.station === null
        ? 'The stack is empty: no station comes up.'
        : `Station ${e.station} comes up.`;
    case 'removed':
      return `Station ${e.station} leaves the game.`;
    case 'under':
      return `Station ${e.station} goes under the stack.`;
    case 'fuel':
      return `${who(e.seat)} buys ${fuelText(e.bought)} for ${money(e.cost)}.`;
    case 'built':
      return `${who(e.seat)} wires ${cityName(e.city)} for ${money(e.cost)}.`;
    case 'power':
      return e.powered === 0
        ? `${who(e.seat)} powers no city and is paid ${money(e.paid)}.`
        : `${who(e.seat)} powers ${e.powered} ${e.powered === 1 ? 'city' : 'cities'} and is paid ${money(e.paid)}.`;
    case 'era':
      return `${eraName(e.era)} begins.`;
    case 'shuffled':
      return `The Era III card comes up: the stack is shuffled (${e.cards} ${e.cards === 1 ? 'station' : 'stations'}).`;
    case 'restock':
      return sum(e.added) === 0
        ? 'The fuel yard gets nothing: the supply is empty.'
        : `The fuel yard is restocked with ${fuelText(e.added)}.`;
    case 'end':
      return `The game ends. Cities powered: ${e.powered.map((n, seat) => `${who(seat)} ${n}`).join(', ')}.`;
    default:
      return '';
  }
}

/** What the viewer may do now, grouped from the legal list. */
export interface Offers {
  /** Stations the viewer may put up (at their number or more). */
  readonly opens: readonly number[];
  readonly pass: boolean;
  /** The raises the list offers (1, 5 and 10 over the bid, as far as money goes); any other is accepted too. */
  readonly raises: readonly number[];
  readonly fold: boolean;
  /** Scrapping: each station that may go, with the fuel each fullest keep would leave. */
  readonly scraps: ReadonlyMap<number, readonly (readonly number[])[]>;
  /** A fuel turn is open. */
  readonly fuel: boolean;
  /** Wiring: each city that may be wired, with its cost now. */
  readonly builds: ReadonlyMap<number, number>;
  /** A fuel or wiring turn may end. */
  readonly done: boolean;
  /** Payday: every way to fire. */
  readonly firings: readonly Firing[];
}

export const NO_OFFERS: Offers = {
  opens: [],
  pass: false,
  raises: [],
  fold: false,
  scraps: new Map(),
  fuel: false,
  builds: new Map(),
  done: false,
  firings: [],
};

export function offersOf(s: CurrentState, me: number | null, legal: readonly CurrentAction[]): Offers {
  if (me === null || legal.length === 0) return NO_OFFERS;
  const opens: number[] = [];
  const raises: number[] = [];
  const scraps = new Map<number, number[][]>();
  const builds = new Map<number, number>();
  const fires: Firing[] = [];
  let pass = false;
  let fold = false;
  let fuel = false;
  let done = false;
  for (const a of legal) {
    switch (a.type) {
      case 'open':
        opens.push(a.station);
        break;
      case 'pass':
        pass = true;
        break;
      case 'bid':
        raises.push(a.amount);
        break;
      case 'fold':
        fold = true;
        break;
      case 'scrap':
        scraps.set(a.station, [...(scraps.get(a.station) ?? []), [...a.keep]]);
        break;
      case 'fuel':
        fuel = true;
        break;
      case 'build': {
        const cost = buildCost(s, me, a.city);
        if (cost !== null) builds.set(a.city, cost);
        break;
      }
      case 'done':
        done = true;
        // A fuel turn always lists `done`, even when the list offers no purchase.
        if (s.phase === 'fuel') fuel = true;
        break;
      case 'power':
        fires.push({ stations: a.stations, hybridCoal: a.hybridCoal });
        break;
      default:
        break;
    }
  }
  return { opens, pass, raises, fold, scraps, fuel, builds, done, firings: fires };
}

/* ------------------------------------------------------------------------------------------- the market */

/** The market as the screen lays it out: on offer and coming up (Era III: one row, all on offer). */
export function marketRows(s: CurrentState): { offer: readonly number[]; coming: readonly number[] } {
  const offer = onOffer(s);
  return { offer, coming: s.market.filter((n) => !offer.includes(n)) };
}

/** The stack in words. */
export function stackText(s: CurrentState): string {
  const st = s.stack;
  const toDraw = st.top.length + st.draws;
  if (st.shuffled) {
    if (toDraw === 0) return 'The stack is empty.';
    return `Stack: ${toDraw} ${toDraw === 1 ? 'station' : 'stations'} to draw.`;
  }
  const out = st.pool.length - st.draws;
  const parts = [`${toDraw} to draw`];
  if (st.eraCard) parts.push('then the Era III card');
  if (st.under.length > 0) parts.push(`${st.under.length} laid under`);
  return `Stack: ${parts.join(', ')}${out > 0 ? ` (${out} out unseen)` : ''}.`;
}

/* ---------------------------------------------------------------------------------------------- fuel */

/** The price of the next unit of fuel `r` once `already` units are in the basket, or null when none is left. */
export function nextPrice(yard: readonly number[], r: number, already: number): number | null {
  const held = yard[r] ?? 0;
  if (already >= held) return null;
  return priceOf(r, held, already + 1) - priceOf(r, held, already);
}

/** The basket with one more (or one fewer) unit of `r`. */
export const stepBuy = (buy: readonly number[], r: number, d: number): number[] =>
  buy.map((k, i) => (i === r ? Math.max(0, k + d) : k));

/** Whether one more unit of `r` may go in the basket: in the yard, on the stations, within the money. */
export const canAdd = (s: CurrentState, seat: number, buy: readonly number[], r: number): boolean =>
  canBuy(s, seat, stepBuy(buy, r, 1));

/** A fuel basket checked: its cost, and why it cannot be bought (null when it can). */
export function basketOf(
  s: CurrentState,
  seat: number,
  buy: readonly number[],
): { readonly cost: number; readonly problem: string | null } {
  const c = s.companies[seat];
  const cost = costOf(s.yard, buy);
  if (c === undefined) return { cost, problem: 'No company.' };
  if (sum(buy) === 0) return { cost, problem: 'Choose fuel with + and −, or buy nothing.' };
  if (buy.some((k, r) => k > (s.yard[r] ?? 0))) return { cost, problem: 'The yard does not hold that much.' };
  if (
    !fits(
      c.fuel.map((f, r) => f + (buy[r] ?? 0)),
      capsOf(c.stations),
    )
  )
    return { cost, problem: 'Your stations cannot store that much.' };
  if (cost > c.money) return { cost, problem: `You have only ${money(c.money)}.` };
  return { cost, problem: canBuy(s, seat, buy) ? null : 'You cannot buy that.' };
}

/** How much more of each fuel a company's stations can store, each fuel alone (C10, C13). */
export function roomOf(c: Company): number[] {
  const caps = capsOf(c.stations);
  return [0, 1, 2, 3].map((r) => {
    let k = 0;
    while (k < 40 && fits(stepBuy(c.fuel, r, k + 1), caps)) k++;
    return k;
  });
}

/**
 * The basket to offer first: the fuel that would let a company fire every station once (coal first on hybrids), as
 * far as the yard holds it; when the money does not stretch that far, the cheapest units of it that it does. Null
 * when not even one unit of it can be bought.
 */
export function refuelBasket(s: CurrentState, seat: number): number[] | null {
  const c = s.companies[seat];
  if (c === undefined) return null;
  const all = burnOf({ stations: c.stations, hybridCoal: 0 });
  const need = [...all.burn];
  need[0] = (need[0] ?? 0) + all.hybrid;
  need[1] = (need[1] ?? 0) - all.hybrid;
  const want = need.map((n, r) => Math.min(Math.max(0, n - (c.fuel[r] ?? 0)), s.yard[r] ?? 0));
  if (canBuy(s, seat, want)) return want;
  // Unit by unit, the cheapest next unit of what is wanted, while it can be bought.
  let buy = [0, 0, 0, 0];
  for (;;) {
    let pick = -1;
    let price = Number.POSITIVE_INFINITY;
    for (let r = 0; r < 4; r++) {
      if ((buy[r] ?? 0) >= (want[r] ?? 0) || !canAdd(s, seat, buy, r)) continue;
      const p = nextPrice(s.yard, r, buy[r] ?? 0) ?? Number.POSITIVE_INFINITY;
      if (p < price) {
        pick = r;
        price = p;
      }
    }
    if (pick < 0) break;
    buy = stepBuy(buy, pick, 1);
  }
  return sum(buy) > 0 ? buy : null;
}

/* ------------------------------------------------------------------------------------------- payday */

const sameStations = (a: readonly number[], b: readonly number[]): boolean => a.join(',') === b.join(',');

/** The ways a set of stations can be fired (one per coal-and-oil split on the hybrids); empty if they cannot. */
export const splitsOf = (all: readonly Firing[], stations: readonly number[]): Firing[] =>
  all.filter((f) => sameStations(f.stations, stations));

/** Whether key `a` beats key `b`, compared in order. */
function beats(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/** The firing to offer first: the most cities, then the least fuel burnt, then the fewest stations. */
export function bestFiring(c: Company, all: readonly Firing[] = firings(c)): Firing {
  let best: Firing = { stations: [], hybridCoal: 0 };
  let key: readonly number[] = [-1, 0, 0];
  for (const f of all) {
    const k = [poweredBy(c, f), -sum(burnOf(f).burn), -f.stations.length];
    if (beats(k, key)) {
      best = f;
      key = k;
    }
  }
  return best;
}

/** A firing's result: the cities lit and the pay. */
export function firingResult(c: Company, f: Firing): { powered: number; pay: number; burn: number[] } {
  const powered = poweredBy(c, f);
  return { powered, pay: payFor(powered), burn: burnOf(f).burn };
}

/* ---------------------------------------------------------------------------------------- companies */

export interface CompanyRow {
  readonly seat: number;
  readonly name: string;
  readonly money: number;
  readonly cities: number;
  /** Substations still unbuilt. */
  readonly left: number;
  readonly stations: readonly number[];
  readonly fuel: readonly number[];
  /** 1-based place in the player order. */
  readonly position: number;
  /** The cities it could power now (the standings, C25). */
  readonly canPower: number;
  readonly acting: boolean;
  readonly place: number | null;
}

export function companyRows(s: CurrentState, names: readonly string[]): CompanyRow[] {
  const acting = s.phase === 'over' || s.roll !== null ? null : actingSeat(s);
  return s.companies.map((c, seat) => ({
    seat,
    name: seatName(names, seat),
    money: c.money,
    cities: c.cities.length,
    left: SUBSTATIONS - c.cities.length,
    stations: c.stations,
    fuel: c.fuel,
    position: s.order.indexOf(seat) + 1,
    canPower: s.result?.scores[seat] ?? bestPower(c),
    acting: acting === seat,
    place: s.result?.places[seat] ?? null,
  }));
}

/** The fuel stored on each station, as the screen draws it: each fuel on its own stations first, then hybrids. */
export function fuelByStation(c: Company): Map<number, number[]> {
  const left = [...c.fuel];
  const out = new Map<number, number[]>();
  const take = (r: number, room: number): number => {
    const k = Math.min(room, left[r] ?? 0);
    left[r] = (left[r] ?? 0) - k;
    return k;
  };
  const kindIndex: Record<string, number> = { coal: 0, oil: 1, waste: 2, uranium: 3 };
  for (const n of c.stations) {
    const st = stationOf(n);
    const on = [0, 0, 0, 0];
    const r = st === undefined ? undefined : kindIndex[st.kind];
    if (st !== undefined && r !== undefined) on[r] = take(r, 2 * st.burn);
    out.set(n, on);
  }
  for (const n of c.stations) {
    const st = stationOf(n);
    if (st?.kind !== 'hybrid') continue;
    const on = out.get(n) ?? [0, 0, 0, 0];
    const coal = take(0, 2 * st.burn);
    on[0] = coal;
    on[1] = take(1, 2 * st.burn - coal);
    out.set(n, on);
  }
  return out;
}

/** The last city wired, for the map to mark. */
export function lastWired(s: CurrentState): number | null {
  for (let i = s.history.length - 1; i >= 0; i--) {
    const e = s.history[i];
    if (e?.kind === 'built') return e.city;
  }
  return null;
}
