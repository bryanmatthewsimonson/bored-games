/*
 * The Current Affairs rules engine (docs/games/current-affairs/RULES.md). Pure: `apply` never throws or mutates, and
 * every move has one accepted encoding. The station stack is a shuffled encrypted deck (`pile`, with prompt
 * shares, D075): each draw turns up its next position by a public reveal, and Era III reshuffles what lies under the
 * stack as a deck epoch (D073). The opening order is drawn by the dice beacon (D058).
 */
import {
  type ApplyResult,
  type DeckSpec,
  type Outcome,
  type Pending,
  packetOrderFits,
  type Result,
  type SetupInput,
} from '@bored-games/game-kit';
import {
  DECK_STATIONS,
  OPENING_MARKET,
  OPENING_YARD,
  payFor,
  RESTOCK,
  SLOT_COST,
  START_MONEY,
  SUBSTATIONS,
  TABLES,
  type Table,
  YARD_PRICES,
} from './data.ts';
import {
  bestPower,
  burnOf,
  capsOf,
  costOf,
  type Firing,
  firings,
  fits,
  keepOptions,
  poweredBy,
  supplyOf,
} from './fuel.ts';
import { lineCosts, regionSets } from './graph.ts';
import { CITY_COUNT, CITY_REGION } from './map.ts';
import type {
  After,
  Company,
  CurrentAction,
  CurrentEvent,
  CurrentRules,
  CurrentState,
  Entry,
  RollPurpose,
} from './types.ts';

export const DEFAULT_RULES: CurrentRules = { rulesVersion: 1 };
export const MIN_SEATS = 2;
export const MAX_SEATS = 6;
/** The most history lines the state keeps. */
export const HISTORY_LIMIT = 60;
/** Sides of each opening-order die: 60 divides evenly by 2, 3, 4, 5 and 6 (C05). */
export const ORDER_SIDES = 60;

/** The deck's id: `pile`, the id the client runs reshuffle epochs for (D073), as Hazard's and Holler's. */
export const DECK_ID = 'pile';
/**
 * The station stack (C03): the green 13 alone in its own group, so it lies on top, then the 33 stations shuffled by
 * every seat. Every draw is a public reveal; every other seat's open app releases its share at once (D075).
 */
export const STATION_DECK: DeckSpec = {
  id: DECK_ID,
  size: DECK_STATIONS.length,
  partitions: [
    { id: 'top', size: 1 },
    { id: 'stack', size: DECK_STATIONS.length - 1 },
  ],
  promptShares: true,
};
/** The stride between reshuffles' positions (PROTOCOL §5, D073): the Era III reshuffle deals positions 128 + i. */
export const EPOCH_STRIDE = 128;
/** The station a card id stands for. */
export const stationOfCard = (card: number): number | undefined => DECK_STATIONS[card];
const cardOfStation = (station: number): number => DECK_STATIONS.indexOf(station);

/* --------------------------------------------------------------------------------------------- helpers */

const int = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && !Object.is(x, -0);
const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x: Record<string, unknown>, ks: readonly string[]): boolean =>
  Object.keys(x).sort().join(',') === [...ks].sort().join(',');
const plainArray = (x: unknown): x is unknown[] => Array.isArray(x) && Object.keys(x).length === x.length;
const vector = (x: unknown): x is number[] => plainArray(x) && x.length === 4 && x.every(int);
const ascending = (x: unknown): x is number[] =>
  plainArray(x) && x.every(int) && x.every((n, i) => i === 0 || (x[i - 1] as number) < (n as number));
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const fail = (message: string): ApplyResult<CurrentState, CurrentEvent> => ({
  ok: false,
  error: { code: 'invalid', message },
});

export const tableOf = (s: { readonly seats: number }): Table => TABLES[s.seats] as Table;
const companyOf = (s: CurrentState, seat: number): Company => s.companies[seat] as Company;
const withCompany = (s: CurrentState, seat: number, f: (c: Company) => Company): CurrentState => ({
  ...s,
  companies: s.companies.map((c, i) => (i === seat ? f(c) : c)),
});
export const maxCities = (s: CurrentState): number => Math.max(0, ...s.companies.map((c) => c.cities.length));
const highest = (c: Company): number => c.stations.at(-1) ?? 0;

/** Record a history line and its event. */
function note(s: CurrentState, ev: CurrentEvent[], entry: Entry): CurrentState {
  ev.push({ ...entry, type: entry.kind } as CurrentEvent);
  return { ...s, history: [...s.history, entry].slice(-HISTORY_LIMIT) };
}

/** Seats clockwise from the one after `from`, not including `from`. */
const clockwise = (seats: number, from: number): number[] =>
  Array.from({ length: seats - 1 }, (_, k) => (from + 1 + k) % seats);

/** The cities of the regions in play, as a lookup. */
const inPlayOf = (s: CurrentState): boolean[] =>
  Array.from({ length: CITY_COUNT }, (_, c) => s.regions.includes(CITY_REGION[c] ?? -1));

/** How many stations of the market can be put up: four in Eras I and II, all of them in Era III (C06, C20). */
export const onOffer = (s: CurrentState): readonly number[] =>
  s.era === 3 ? s.market : s.market.slice(0, 4);

/* ------------------------------------------------------------------------------------------ rules, setup */

export function validateRules(raw: unknown): Result<CurrentRules> {
  if (!obj(raw) || !keys(raw, ['rulesVersion']) || raw.rulesVersion !== 1)
    return { ok: false, error: { code: 'rules', message: 'Current Affairs rules are { rulesVersion: 1 }' } };
  return { ok: true, value: DEFAULT_RULES };
}

export function setupGame(input: SetupInput<CurrentRules>): Result<CurrentState> {
  const rules = validateRules(input.rules);
  if (!rules.ok) return rules;
  if (!int(input.seats) || input.seats < MIN_SEATS || input.seats > MAX_SEATS)
    return { ok: false, error: { code: 'seats', message: 'Current Affairs is played by 2 to 6 players' } };
  const seats = input.seats;
  const table = TABLES[seats] as Table;
  let plain: Record<string, number> | null = null;
  if (input.mode === 'full') {
    const order = input.deckOrders[DECK_ID];
    if (order === undefined || !packetOrderFits(STATION_DECK, order))
      return { ok: false, error: { code: 'deck', message: 'The station order must fit the station deck.' } };
    plain = Object.fromEntries(order.map((card, pos) => [String(pos), card]));
  } else if (input.viewer !== null && (!int(input.viewer) || input.viewer >= seats))
    return { ok: false, error: { code: 'viewer', message: 'Invalid viewer.' } };
  const drawn = DECK_STATIONS.length - table.removed;
  const s: CurrentState = {
    game: 'current-affairs',
    rules: rules.value,
    seats,
    regions: [],
    round: 0,
    era: 1,
    eraNext: false,
    phase: 'opening',
    order: Array.from({ length: seats }, (_, i) => i),
    companies: Array.from({ length: seats }, () => ({
      money: START_MONEY,
      cities: [],
      stations: [],
      fuel: [0, 0, 0, 0],
    })),
    houses: Array.from({ length: CITY_COUNT }, () => []),
    market: OPENING_MARKET,
    eraCardShown: false,
    stack: {
      next: Array.from({ length: drawn }, (_, i) => i),
      out: Array.from({ length: table.removed }, (_, i) => drawn + i),
      eraCard: true,
      under: [],
      shuffling: false,
      shuffled: false,
    },
    gone: [],
    yard: OPENING_YARD,
    auctionDone: Array.from({ length: seats }, () => false),
    sold: 0,
    lot: null,
    scrapping: null,
    owed: 0,
    reveal: null,
    posOf: {},
    dealt: [],
    plain,
    queue: [],
    roll: null,
    contributors: [],
    rolls: [],
    after: null,
    actor: 0,
    history: [],
    result: null,
  };
  // The first decision is the regions in play (C02); the order is drawn after it.
  return { ok: true, value: s };
}

/** The seat that chooses the regions in play for the table (C02): the first seat, the table's creator. */
export const REGION_CHOOSER = 0;

/** Every set of regions the table may play in: as many as the player count asks, touching as one block (C02). */
export const regionChoices = (s: { readonly seats: number }): number[][] => regionSets(tableOf(s).regions);

/** Open a roll: every seat adds a share, from the one after the last actor round to it (D058). */
function openRoll(s: CurrentState, purpose: RollPurpose, count: number, sides: number): CurrentState {
  const id = s.rolls.length;
  return {
    ...s,
    roll: { id, purpose, count, sides },
    rolls: [...s.rolls, { id, last: s.actor }],
    contributors: [...clockwise(s.seats, s.actor), s.actor],
  };
}

/* ----------------------------------------------------------------------------------------------- parse */

/** The one accepted encoding of each action, or null. Never throws. */
export function parseAction(raw: unknown): CurrentAction | null {
  try {
    if (!obj(raw) || typeof raw.type !== 'string') return null;
    const { type, actor } = raw;
    if (type === 'rolled') {
      const { id, dice } = raw;
      if (!keys(raw, ['type', 'actor', 'id', 'dice']) || actor !== 'beacon' || !int(id)) return null;
      if (!plainArray(dice) || dice.length < 1 || dice.length > 64 || !dice.every(int)) return null;
      return { type, actor, id, dice: [...(dice as number[])] };
    }
    if (type === 'reveal') {
      const { deck, pos, card } = raw;
      if (!keys(raw, ['type', 'actor', 'deck', 'pos', 'card']) || actor !== 'deck' || deck !== DECK_ID)
        return null;
      return int(pos) && int(card) && card < DECK_STATIONS.length ? { type, actor, deck, pos, card } : null;
    }
    if (type === 'epoch') {
      const { epoch, size } = raw;
      if (!keys(raw, ['type', 'actor', 'epoch', 'size']) || actor !== 'deck') return null;
      return int(epoch) && int(size) ? { type, actor, epoch, size } : null;
    }
    if (!int(actor)) return null;
    switch (type) {
      case 'contribute':
        return keys(raw, ['type', 'actor', 'id']) && int(raw.id) ? { type, actor, id: raw.id } : null;
      case 'regions':
        return keys(raw, ['type', 'actor', 'regions']) && ascending(raw.regions)
          ? { type, actor, regions: [...raw.regions] }
          : null;
      case 'open':
        return keys(raw, ['type', 'actor', 'station', 'bid']) && int(raw.station) && int(raw.bid)
          ? { type, actor, station: raw.station, bid: raw.bid }
          : null;
      case 'bid':
        return keys(raw, ['type', 'actor', 'amount']) && int(raw.amount)
          ? { type, actor, amount: raw.amount }
          : null;
      case 'pass':
      case 'fold':
      case 'done':
        return keys(raw, ['type', 'actor']) ? { type, actor } : null;
      case 'scrap':
        return keys(raw, ['type', 'actor', 'station', 'keep']) && int(raw.station) && vector(raw.keep)
          ? { type, actor, station: raw.station, keep: [...raw.keep] }
          : null;
      case 'fuel':
        return keys(raw, ['type', 'actor', 'buy']) && vector(raw.buy)
          ? { type, actor, buy: [...raw.buy] }
          : null;
      case 'build':
        return keys(raw, ['type', 'actor', 'city']) && int(raw.city) ? { type, actor, city: raw.city } : null;
      case 'power':
        return keys(raw, ['type', 'actor', 'stations', 'hybridCoal']) &&
          ascending(raw.stations) &&
          int(raw.hybridCoal)
          ? { type, actor, stations: [...raw.stations], hybridCoal: raw.hybridCoal }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------------------------- pending */

/** The seat whose turn it is to put a station up, or null when every seat has bought or passed (C06). */
export function chooserOf(s: CurrentState): number | null {
  if (s.phase !== 'auction') return null;
  return s.order.find((seat) => !s.auctionDone[seat]) ?? null;
}

export function pendingOf(s: CurrentState): Pending {
  if (s.phase === 'over') return { type: 'over' };
  if (s.reveal !== null) return { type: 'reveal', deck: DECK_ID, positions: [s.reveal] };
  if (s.stack.shuffling)
    return {
      type: 'shuffle',
      deck: DECK_ID,
      epoch: 1,
      from: s.stack.under.map((u) => ({ deck: DECK_ID, pos: u.pos })),
    };
  if (s.roll !== null) {
    const next = s.contributors[0];
    if (next !== undefined) return { type: 'player', seat: next, decision: 'contribute' };
    return { type: 'beacon', id: s.roll.id };
  }
  if (s.phase === 'opening' && s.regions.length === 0)
    return { type: 'player', seat: REGION_CHOOSER, decision: 'regions' };
  if (s.scrapping !== null) return { type: 'player', seat: s.scrapping.seat, decision: 'scrap' };
  if (s.lot !== null) return { type: 'player', seat: s.lot.turn, decision: 'bid' };
  if (s.phase === 'auction') return { type: 'player', seat: chooserOf(s) ?? 0, decision: 'open' };
  return { type: 'player', seat: s.queue[0] ?? 0, decision: s.phase };
}

/** The roll a `contribute` carries a beacon share for: the open one (D058). Never throws. */
export function beaconFor(s: CurrentState, raw: unknown): number | null {
  try {
    return obj(raw) && raw.type === 'contribute' ? (s.roll?.id ?? null) : null;
  } catch {
    return null;
  }
}

export function rollShapeOf(s: CurrentState): { count: number; sides: number } {
  return s.roll === null ? { count: 1, sides: 6 } : { count: s.roll.count, sides: s.roll.sides };
}

/* ------------------------------------------------------------------------------------- legal choices */

/** What wiring `city` would cost `seat` now, or null if it may not (C14, C15). */
export function buildCost(
  s: CurrentState,
  seat: number,
  city: number,
  costs?: readonly number[],
  anyMoney = false,
): number | null {
  if (!int(city) || city >= CITY_COUNT) return null;
  const c = companyOf(s, seat);
  const here = s.houses[city] ?? [];
  if (!s.regions.includes(CITY_REGION[city] ?? -1)) return null;
  if (here.includes(seat) || here.length >= s.era || c.cities.length >= SUBSTATIONS) return null;
  const line = (costs ?? lineCosts(c.cities, inPlayOf(s)))[city] ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(line)) return null;
  const cost = line + (SLOT_COST[here.length] as number);
  return anyMoney || cost <= c.money ? cost : null;
}

/** Every city `seat` can wire now, with its cost. */
export function buildOptions(
  s: CurrentState,
  seat: number,
  anyMoney = false,
): { city: number; cost: number }[] {
  const costs = lineCosts(companyOf(s, seat).cities, inPlayOf(s));
  const out: { city: number; cost: number }[] = [];
  for (let city = 0; city < CITY_COUNT; city++) {
    const cost = buildCost(s, seat, city, costs, anyMoney);
    if (cost !== null) out.push({ city, cost });
  }
  return out;
}

/** Whether `seat` may buy `buy` now (C12): from the yard, on its stations, within its money. */
export function canBuy(s: CurrentState, seat: number, buy: readonly number[]): boolean {
  const c = companyOf(s, seat);
  if (buy.length !== 4 || sum(buy) === 0) return false;
  if (buy.some((k, r) => k > (s.yard[r] ?? 0))) return false;
  if (
    !fits(
      c.fuel.map((f, r) => f + (buy[r] ?? 0)),
      capsOf(c.stations),
    )
  )
    return false;
  return costOf(s.yard, buy) <= c.money;
}

/** The purchases the list offers (any other legal purchase is accepted through validateIntent). */
export function fuelOffers(s: CurrentState, seat: number): number[][] {
  const out: number[][] = [];
  const seen = new Set<string>();
  const add = (buy: number[]) => {
    const key = buy.join(',');
    if (!seen.has(key) && canBuy(s, seat, buy)) {
      seen.add(key);
      out.push(buy);
    }
  };
  const c = companyOf(s, seat);
  // Enough to fire every station once, coal first on hybrids.
  const all = burnOf({ stations: c.stations, hybridCoal: 0 });
  const need = [...all.burn];
  need[0] = (need[0] as number) + all.hybrid;
  need[1] = (need[1] as number) - all.hybrid;
  const refuel = need.map((n, r) => Math.max(0, n - (c.fuel[r] ?? 0)));
  add(refuel.map((k, r) => Math.min(k, s.yard[r] ?? 0)));
  for (let r = 0; r < 4; r++) {
    const one = [0, 0, 0, 0];
    one[r] = 1;
    add(one);
    for (let k = s.yard[r] ?? 0; k > 1; k--) {
      const buy = [0, 0, 0, 0];
      buy[r] = k;
      if (canBuy(s, seat, buy)) {
        add(buy);
        break;
      }
    }
  }
  return out;
}

/** The opening bids the list offers: each station on offer at its number. */
function openOffers(s: CurrentState, seat: number): CurrentAction[] {
  const money = companyOf(s, seat).money;
  return onOffer(s)
    .filter((n) => n <= money)
    .map((n) => ({ type: 'open', actor: seat, station: n, bid: n }));
}

/** Whether `seat` may pass instead of opening an auction: never in round 1, unless it can afford nothing (C06). */
const mayPass = (s: CurrentState, seat: number): boolean => s.round > 1 || openOffers(s, seat).length === 0;

export function legalActions(s: CurrentState, seat: number): readonly CurrentAction[] {
  const p = pendingOf(s);
  if (p.type !== 'player' || p.seat !== seat) return [];
  const c = companyOf(s, seat);
  switch (p.decision) {
    case 'contribute':
      return [{ type: 'contribute', actor: seat, id: s.roll?.id ?? 0 }];
    case 'regions':
      return regionChoices(s).map((regions): CurrentAction => ({ type: 'regions', actor: seat, regions }));
    case 'scrap': {
      const sc = s.scrapping;
      if (sc === null) return [];
      const out: CurrentAction[] = [];
      for (const n of c.stations) {
        if (n === sc.bought) continue;
        const rest = c.stations.filter((m) => m !== n);
        for (const keep of keepOptions(c.fuel, capsOf(rest)))
          out.push({ type: 'scrap', actor: seat, station: n, keep });
      }
      return out;
    }
    case 'bid': {
      const bid = s.lot?.bid ?? 0;
      const raises = [1, 5, 10].map((d) => bid + d).filter((a) => a <= c.money);
      return [
        ...raises.map((amount): CurrentAction => ({ type: 'bid', actor: seat, amount })),
        { type: 'fold', actor: seat },
      ];
    }
    case 'open':
      return [...openOffers(s, seat), ...(mayPass(s, seat) ? [{ type: 'pass', actor: seat } as const] : [])];
    case 'fuel':
      return [
        ...fuelOffers(s, seat).map((buy): CurrentAction => ({ type: 'fuel', actor: seat, buy })),
        { type: 'done', actor: seat },
      ];
    case 'build':
      return [
        ...buildOptions(s, seat).map(({ city }): CurrentAction => ({ type: 'build', actor: seat, city })),
        { type: 'done', actor: seat },
      ];
    case 'power':
      return firings(c).map(
        (f): CurrentAction => ({
          type: 'power',
          actor: seat,
          stations: f.stations,
          hybridCoal: f.hybridCoal,
        }),
      );
    default:
      return [];
  }
}

/** Accepts any legal opening bid, raise, purchase or scrap, beyond the few the list offers. */
export function validateIntent(s: CurrentState, seat: number, raw: unknown): Result<unknown> {
  const a = parseAction(raw);
  if (a === null || a.actor !== seat || !['open', 'bid', 'fuel', 'scrap'].includes(a.type))
    return {
      ok: false,
      error: { code: 'intent', message: 'Not an opening bid, a raise, a purchase or a scrap.' },
    };
  const r = applyAction(s, a);
  return r.ok ? { ok: true, value: a } : r;
}

/* ---------------------------------------------------------------------------------------------- apply */

export function applyAction(s: CurrentState, raw: unknown): ApplyResult<CurrentState, CurrentEvent> {
  try {
    const a = parseAction(raw);
    if (a === null) return fail('Not a Current Affairs action.');
    const ev: CurrentEvent[] = [];
    const r = dispatch(s, a, ev);
    return typeof r === 'string' ? fail(r) : { ok: true, state: r, events: ev };
  } catch {
    return fail('Invalid action.');
  }
}

function dispatch(s: CurrentState, a: CurrentAction, ev: CurrentEvent[]): CurrentState | string {
  if (s.phase === 'over') return 'The game is over.';
  const p = pendingOf(s);
  if (a.type === 'rolled')
    return p.type === 'beacon' && p.id === a.id ? applyRolled(s, a.dice, ev) : 'No roll is awaited.';
  if (a.type === 'reveal')
    return p.type === 'reveal' ? applyReveal(s, a.pos, a.card, ev) : 'No reveal is pending.';
  if (a.type === 'epoch')
    return p.type === 'shuffle' ? applyEpoch(s, a.epoch, a.size, ev) : 'No reshuffle is pending.';
  if (p.type !== 'player' || p.seat !== a.actor) return 'It is not your decision.';
  const t: CurrentState = { ...s, actor: a.actor };
  switch (a.type) {
    case 'contribute':
      return p.decision === 'contribute' && s.roll?.id === a.id
        ? { ...s, contributors: s.contributors.slice(1) }
        : 'No share of that roll is owed.';
    case 'regions': {
      if (p.decision !== 'regions') return 'The regions are already chosen.';
      const regions = a.regions;
      if (!regionChoices(s).some((set) => set.join(',') === regions.join(',')))
        return `Choose ${tableOf(s).regions} regions that touch as one block.`;
      const u = note({ ...t, regions }, ev, { kind: 'regions', regions });
      return openRoll(u, 'order', s.seats - 1, ORDER_SIDES);
    }
    case 'scrap':
      return p.decision === 'scrap'
        ? applyScrap(t, a.actor, a.station, a.keep, ev)
        : 'Nothing is to be scrapped.';
    case 'open':
      return p.decision === 'open'
        ? applyOpen(t, a.actor, a.station, a.bid, ev)
        : 'You cannot open an auction now.';
    case 'pass':
      if (p.decision !== 'open') return 'You cannot pass now.';
      if (!mayPass(s, a.actor)) return 'Every company must buy a station in the first round.';
      return nextChooser(
        note({ ...t, auctionDone: t.auctionDone.map((d, i) => d || i === a.actor) }, ev, {
          kind: 'pass',
          seat: a.actor,
        }),
        ev,
      );
    case 'bid':
      return p.decision === 'bid' ? applyBid(t, a.actor, a.amount, ev) : 'No auction awaits your bid.';
    case 'fold':
      return p.decision === 'bid' ? applyFold(t, a.actor, ev) : 'No auction awaits your bid.';
    case 'fuel':
      if (p.decision !== 'fuel') return 'It is not the fuel phase.';
      return applyFuel(t, a.actor, a.buy, ev);
    case 'build':
      return p.decision === 'build' ? applyBuild(t, a.actor, a.city, ev) : 'It is not the wiring phase.';
    case 'done':
      if (p.decision !== 'fuel' && p.decision !== 'build') return 'There is nothing to finish.';
      return p.decision === 'fuel'
        ? toNextFuel({ ...t, queue: t.queue.slice(1) }, ev)
        : toNextBuild({ ...t, queue: t.queue.slice(1) }, ev);
    case 'power':
      return p.decision === 'power'
        ? applyPower(t, a.actor, { stations: a.stations, hybridCoal: a.hybridCoal }, ev)
        : 'It is not payday.';
    default:
      return 'That is not a move now.';
  }
}

/* ----------------------------------------------------------------------------------------------- rolls */

function applyRolled(s: CurrentState, dice: readonly number[], ev: CurrentEvent[]): CurrentState | string {
  const roll = s.roll;
  if (roll === null) return 'No roll is awaited.';
  if (dice.length !== roll.count || dice.some((d) => d < 1 || d > roll.sides))
    return 'Those dice do not fit the roll.';
  const t: CurrentState = { ...s, roll: null, contributors: [] };
  switch (roll.purpose) {
    case 'order': {
      // Fisher–Yates: die i picks among the seats not yet placed; 60 divides evenly, so each pick is even (C05).
      const order = Array.from({ length: s.seats }, (_, i) => i);
      for (let i = 0; i < s.seats - 1; i++) {
        const j = i + (((dice[i] as number) - 1) % (s.seats - i));
        [order[i], order[j]] = [order[j] as number, order[i] as number];
      }
      return startRound(note({ ...t, order }, ev, { kind: 'order', order }), ev);
    }
    default:
      return 'Unknown roll.';
  }
}

/* --------------------------------------------------------------------------------------- the market */

/**
 * Draw the next card (C19, C21, C23): the stack's next position is turned up by a public reveal (play waits for it),
 * or the Era III card comes, or nothing when the stack is empty.
 */
function drawCard(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  const st = s.stack;
  const pos = st.next[0];
  if (pos !== undefined)
    return {
      ...s,
      stack: { ...st, next: st.next.slice(1) },
      reveal: pos,
      dealt: [...s.dealt, { deck: DECK_ID, pos, to: null }],
    };
  if (st.eraCard) return placeDrawn({ ...s, stack: { ...st, eraCard: false } }, 'era', ev);
  return note(s, ev, { kind: 'drew', station: null });
}

/** The pending position is turned up: its station joins the market (or leaves, if small), and play goes on. */
function applyReveal(s: CurrentState, pos: number, card: number, ev: CurrentEvent[]): CurrentState | string {
  if (s.reveal !== pos) return 'That station is not being turned up.';
  if (s.plain !== null && s.plain[String(pos)] !== card) return 'That is not the station at that position.';
  const station = stationOfCard(card) as number;
  const seen =
    s.market.includes(station) ||
    s.gone.includes(station) ||
    s.stack.under.some((u) => u.station === station) ||
    s.companies.some((c) => c.stations.includes(station));
  if (seen || (s.posOf[String(station)] !== undefined && !s.stack.shuffled))
    return 'That station is already face up.';
  const t: CurrentState = { ...s, reveal: null, posOf: { ...s.posOf, [String(station)]: pos } };
  return settle(placeDrawn(t, station, ev), ev);
}

/** Era III's reshuffle is in (C21): the stations that were under the stack are drawn from its new positions. */
function applyEpoch(s: CurrentState, epoch: number, size: number, ev: CurrentEvent[]): CurrentState | string {
  const st = s.stack;
  if (!st.shuffling || epoch !== 1 || size !== st.under.length) return 'That is not the pending reshuffle.';
  const next = st.under.map((_, i) => EPOCH_STRIDE * epoch + i);
  if (s.plain !== null && next.some((pos) => s.plain?.[String(pos)] === undefined))
    return 'The reshuffled order is not installed.';
  const t: CurrentState = { ...s, stack: { ...st, next, under: [], shuffling: false, shuffled: true } };
  return settle(note(t, ev, { kind: 'shuffled', cards: size }), ev);
}

/** Full mode only: the stations under the stack in their new order (PROTOCOL §5, D073). Emits nothing. */
export function installDeckOrder(
  s: CurrentState,
  epoch: number,
  order: readonly number[],
): ApplyResult<CurrentState, CurrentEvent> {
  if (s.plain === null) return fail('A view has no station order.');
  if (!s.stack.shuffling || epoch !== 1) return fail('No such reshuffle is pending.');
  const want = shufflePlaintexts(s)
    .slice()
    .sort((x, y) => x - y);
  const got = [...order].sort((x, y) => x - y);
  if (got.length !== want.length || got.some((c, i) => c !== want[i]))
    return fail('The order is not a shuffle of the stations under the stack.');
  const plain = { ...s.plain };
  order.forEach((card, i) => {
    plain[String(EPOCH_STRIDE * epoch + i)] = card;
  });
  return { ok: true, state: { ...s, plain }, events: [] };
}

/** The card ids of the stations being reshuffled, in `from` order; empty outside full mode. */
export const shufflePlaintexts = (s: CurrentState): readonly number[] =>
  s.plain !== null && s.stack.shuffling ? s.stack.under.map((u) => cardOfStation(u.station)) : [];

/** Take the lowest station of the market out of the game. */
function removeLowest(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  const low = s.market[0];
  if (low === undefined) return s;
  return note({ ...s, market: s.market.slice(1), gone: [...s.gone, low] }, ev, {
    kind: 'removed',
    station: low,
  });
}

/** Era III's shuffle (C21): what lies under the stack is reshuffled at once, by a deck epoch when it holds any. */
function shuffleStack(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  const st = s.stack;
  if (st.under.length === 0)
    return note({ ...s, stack: { ...st, shuffled: true } }, ev, { kind: 'shuffled', cards: 0 });
  return { ...s, stack: { ...st, shuffling: true } };
}

/** A drawn card joins the market, in number order; the Era III card does what its phase says (C20). */
function placeDrawn(s: CurrentState, card: number | 'era', ev: CurrentEvent[]): CurrentState {
  if (card !== 'era') {
    const t = note(s, ev, { kind: 'drew', station: card });
    return { ...t, market: [...t.market, card].sort((a, b) => a - b) };
  }
  // The stack is shuffled at once, whenever the card comes up (the 2009 ruling).
  if (s.phase === 'auction') return shuffleStack({ ...s, eraCardShown: true }, ev);
  // Drawn while wiring or at payday: the card and the lowest station leave, and nothing replaces them. Era III
  // begins at the coming payday, or (drawn at payday) with the next round.
  const t = shuffleStack(removeLowest(s, ev), ev);
  if (s.phase === 'build') return { ...t, eraNext: true };
  // Era III begins with the next round; if Era II never began, its changes come first (C20): the lowest station
  // leaves once and is replaced. The replacement is owed to the draw loop this card came from.
  const u = t.era === 1 ? { ...eraTwoChange(t, ev), owed: t.owed + 1 } : t;
  return note({ ...u, era: 3 }, ev, { kind: 'era', era: 3 });
}

/**
 * Era II's changes (C20): from now on two companies a city and the Era II restock, and once, the lowest station of the
 * market leaves the game. The caller owes its replacement. Also run first when Era III begins before Era II: the
 * 2018 rulebook, "first perform all changes for Step 2 before directly continuing with the changes for Step 3".
 */
const eraTwoChange = (s: CurrentState, ev: CurrentEvent[]): CurrentState =>
  removeLowest(note({ ...s, era: 2 }, ev, { kind: 'era', era: 2 }), ev);

/**
 * Keep the market sound (C11): a station numbered no higher than some company's city count leaves the game, and
 * every owed replacement is drawn. Stops at an open roll; `resume` carries on from `after` once it is settled.
 */
function settle(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  let t = s;
  for (let guard = 0; guard < 200; guard++) {
    if (t.roll !== null || t.reveal !== null || t.stack.shuffling) return t;
    const low = t.market[0];
    if (low !== undefined && low <= maxCities(t)) {
      t = { ...removeLowest(t, ev), owed: t.owed + 1 };
      continue;
    }
    if (t.owed > 0) {
      t = drawCard({ ...t, owed: t.owed - 1 }, ev);
      continue;
    }
    return resume(t, ev);
  }
  return t;
}

/** Carry on from where the draw interrupted play. */
function resume(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  const after = s.after;
  const t: CurrentState = { ...s, after: null };
  switch (after) {
    case 'auction':
      return nextChooser(t, ev);
    case 'auctionEnd':
      return endAuction(t, ev, true);
    case 'build':
      return toNextBuild(t, ev);
    case 'buildEnd':
      return endBuild(t, ev);
    case 'round':
      return startRound(t, ev);
    default:
      return t;
  }
}

/** Owe `n` replacement draws, then settle and carry on from `after`. */
const replace = (s: CurrentState, n: number, after: After, ev: CurrentEvent[]): CurrentState =>
  settle({ ...s, owed: s.owed + n, after }, ev);

/* ---------------------------------------------------------------------------------------------- rounds */

/** Phase 1 (C05): the order by cities, then by the highest station. Round 1 keeps the order the dice drew. */
export function rankedOrder(s: CurrentState): number[] {
  return Array.from({ length: s.seats }, (_, i) => i).sort((a, b) => {
    const ca = companyOf(s, a);
    const cb = companyOf(s, b);
    return cb.cities.length - ca.cities.length || highest(cb) - highest(ca) || a - b;
  });
}

function startRound(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  const round = s.round + 1;
  let t: CurrentState = note(
    {
      ...s,
      round,
      phase: 'auction',
      auctionDone: s.companies.map(() => false),
      sold: 0,
      lot: null,
      queue: [],
    },
    ev,
    { kind: 'round', round },
  );
  if (round > 1) {
    const order = rankedOrder(t);
    t = note({ ...t, order }, ev, { kind: 'order', order });
  }
  return nextChooser(t, ev);
}

/* --------------------------------------------------------------------------------------------- auction */

/** The next seat to put a station up, or the end of the auction (C06). Every seat decides for itself. */
function nextChooser(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  return chooserOf(s) === null ? endAuction(s, ev, false) : s;
}

function applyOpen(
  s: CurrentState,
  seat: number,
  station: number,
  bid: number,
  ev: CurrentEvent[],
): CurrentState | string {
  if (!onOffer(s).includes(station)) return 'That station is not on offer.';
  if (bid < station) return `The opening bid is at least ${station}.`;
  if (bid > companyOf(s, seat).money) return 'You cannot bid more than you have.';
  const rivals = clockwise(s.seats, seat).filter((x) => !s.auctionDone[x]);
  const lot = {
    station,
    bid,
    leader: seat,
    opener: seat,
    active: [seat, ...rivals],
    turn: rivals[0] ?? seat,
  };
  return lastIn({ ...s, lot }, ev);
}

/** Who bids after `seat`: the next active seat clockwise. */
function nextBidder(active: readonly number[], seats: number, seat: number): number {
  return clockwise(seats, seat).find((x) => active.includes(x)) ?? seat;
}

function applyBid(s: CurrentState, seat: number, amount: number, ev: CurrentEvent[]): CurrentState | string {
  const lot = s.lot;
  if (lot === null) return 'No auction is under way.';
  if (amount <= lot.bid) return `A bid must beat ${lot.bid}.`;
  if (amount > companyOf(s, seat).money) return 'You cannot bid more than you have.';
  return lastIn(
    { ...s, lot: { ...lot, bid: amount, leader: seat, turn: nextBidder(lot.active, s.seats, seat) } },
    ev,
  );
}

function applyFold(s: CurrentState, seat: number, ev: CurrentEvent[]): CurrentState | string {
  const lot = s.lot;
  if (lot === null) return 'No auction is under way.';
  const active = lot.active.filter((x) => x !== seat);
  return lastIn({ ...s, lot: { ...lot, active, turn: nextBidder(active, s.seats, seat) } }, ev);
}

/**
 * The last company in wins (C07). A bidder who cannot beat the bid still folds by its own decision: money is hidden,
 * so the game never folds for it.
 */
function lastIn(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  const lot = s.lot;
  if (lot === null) return s;
  if (lot.active.length > 1) return { ...s, lot };
  return win({ ...s, lot: null }, lot.leader, lot.station, lot.bid, ev);
}

function win(
  s: CurrentState,
  seat: number,
  station: number,
  price: number,
  ev: CurrentEvent[],
): CurrentState {
  let t = withCompany(s, seat, (c) => ({
    ...c,
    money: c.money - price,
    stations: [...c.stations, station].sort((a, b) => a - b),
  }));
  t = note(
    {
      ...t,
      actor: seat,
      market: t.market.filter((n) => n !== station),
      auctionDone: t.auctionDone.map((d, i) => d || i === seat),
      sold: t.sold + 1,
    },
    ev,
    { kind: 'won', seat, station, price },
  );
  if (companyOf(t, seat).stations.length > tableOf(t).maxStations)
    return { ...t, scrapping: { seat, bought: station } };
  return afterSale(t, ev);
}

/** A sold station is replaced at once (C08), even once the Era III card lies in the market (C20). */
const afterSale = (s: CurrentState, ev: CurrentEvent[]): CurrentState => replace(s, 1, 'auction', ev);

function applyScrap(
  s: CurrentState,
  seat: number,
  station: number,
  keep: readonly number[],
  ev: CurrentEvent[],
): CurrentState | string {
  const sc = s.scrapping;
  const c = companyOf(s, seat);
  if (sc === null || station === sc.bought || !c.stations.includes(station))
    return 'Scrap one of your other stations.';
  const rest = c.stations.filter((n) => n !== station);
  if (keep.some((k, r) => k > (c.fuel[r] ?? 0)) || !fits(keep, capsOf(rest)))
    return 'Keep only fuel you have and your other stations can hold.';
  const lost = c.fuel.map((f, r) => f - (keep[r] ?? 0));
  const t = withCompany(s, seat, (x) => ({ ...x, stations: rest, fuel: [...keep] }));
  return afterSale(
    note({ ...t, scrapping: null, gone: [...t.gone, station] }, ev, { kind: 'scrap', seat, station, lost }),
    ev,
  );
}

/** The end of the auction phase (C08, C20, C05): an unsold round, the Era III card, round 1's new order. */
function endAuction(s: CurrentState, ev: CurrentEvent[], unsoldDone: boolean): CurrentState {
  let t = s;
  if (!unsoldDone && t.round > 1 && t.sold === 0) return replace(removeLowest(t, ev), 1, 'auctionEnd', ev);
  if (t.eraCardShown) {
    // Era II's changes first if it never began, with their replacement; then this function runs again (C20, C21).
    if (t.era === 1) return replace(eraTwoChange(t, ev), 1, 'auctionEnd', ev);
    t = note({ ...removeLowest({ ...t, eraCardShown: false }, ev), era: 3 }, ev, { kind: 'era', era: 3 });
  }
  if (t.round === 1) {
    const order = rankedOrder(t);
    t = note({ ...t, order }, ev, { kind: 'order', order });
  }
  return toNextFuel({ ...t, phase: 'fuel', queue: [...t.order].reverse() }, ev);
}

/* ------------------------------------------------------------------------------------------------ fuel */

/**
 * Whether one unit of some fuel the yard holds would fit on `seat`'s stations: public facts only, never its money,
 * which is hidden (a company that cannot pay still decides, and finishes).
 */
const canStoreAny = (s: CurrentState, seat: number): boolean => {
  const c = companyOf(s, seat);
  const caps = capsOf(c.stations);
  return [0, 1, 2, 3].some(
    (r) =>
      (s.yard[r] ?? 0) > 0 &&
      fits(
        c.fuel.map((f, i) => f + (i === r ? 1 : 0)),
        caps,
      ),
  );
};

/** Pass over companies that could store no fuel the yard holds; after the last, wiring begins (C12). */
function toNextFuel(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  let queue = s.queue;
  while (queue.length > 0 && !canStoreAny(s, queue[0] as number)) queue = queue.slice(1);
  if (queue.length > 0) return { ...s, queue };
  return toNextBuild({ ...s, phase: 'build', queue: [...s.order].reverse() }, ev);
}

function applyFuel(
  s: CurrentState,
  seat: number,
  buy: readonly number[],
  ev: CurrentEvent[],
): CurrentState | string {
  if (!canBuy(s, seat, buy)) return 'You cannot buy that fuel.';
  const cost = costOf(s.yard, buy);
  const t = withCompany(s, seat, (c) => ({
    ...c,
    money: c.money - cost,
    fuel: c.fuel.map((f, r) => f + (buy[r] ?? 0)),
  }));
  const u = note({ ...t, yard: t.yard.map((y, r) => y - (buy[r] ?? 0)) }, ev, {
    kind: 'fuel',
    seat,
    bought: [...buy],
    cost,
  });
  return toNextFuel({ ...u, queue: u.queue.slice(1) }, ev);
}

/* ---------------------------------------------------------------------------------------------- wiring */

/**
 * Pass over companies that could wire no city whatever their money (no room, no substation, no route); a company
 * that only cannot pay still decides, and finishes, as money is hidden (C15).
 */
function toNextBuild(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  let queue = s.queue;
  while (queue.length > 0 && buildOptions(s, queue[0] as number, true).length === 0) queue = queue.slice(1);
  if (queue.length > 0) return { ...s, queue };
  return endBuild({ ...s, queue: [] }, ev);
}

function applyBuild(s: CurrentState, seat: number, city: number, ev: CurrentEvent[]): CurrentState | string {
  const cost = buildCost(s, seat, city);
  if (cost === null) return 'You cannot wire that city now.';
  const t = withCompany(s, seat, (c) => ({ ...c, money: c.money - cost, cities: [...c.cities, city] }));
  const u = note({ ...t, houses: t.houses.map((h, i) => (i === city ? [...h, seat] : h)) }, ev, {
    kind: 'built',
    seat,
    city,
    cost,
  });
  return replace(u, 0, 'build', ev);
}

/** After wiring (C21, C15, C20): the end of the game, Era II, then payday. */
function endBuild(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  const table = tableOf(s);
  const most = maxCities(s);
  if (most >= table.end) return finish(s, ev);
  // Era II begins once a company reaches its count, or, if it has not, just before Era III does (C20, C21).
  if (s.era === 1 && (most >= table.eraTwo || s.eraNext))
    return replace(eraTwoChange(s, ev), 1, 'buildEnd', ev);
  let t: CurrentState = { ...s, phase: 'power', queue: [...s.order] };
  if (t.eraNext) t = note({ ...t, era: 3, eraNext: false }, ev, { kind: 'era', era: 3 });
  return toNextPower(t, ev);
}

/* ---------------------------------------------------------------------------------------------- payday */

/** A company with nothing to choose (no city, or no station it can fire) is paid without a decision (C16). */
function toNextPower(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  let t = s;
  while (t.queue.length > 0) {
    const seat = t.queue[0] as number;
    const c = companyOf(t, seat);
    if (c.cities.length > 0 && firings(c).length > 1) return t;
    t = payday(t, seat, { stations: [], hybridCoal: 0 }, ev);
  }
  return endRound(t, ev);
}

function payday(s: CurrentState, seat: number, f: Firing, ev: CurrentEvent[]): CurrentState {
  const c = companyOf(s, seat);
  const powered = poweredBy(c, f);
  const paid = payFor(powered);
  const { burn } = burnOf(f);
  const t = withCompany(s, seat, (x) => ({
    ...x,
    money: x.money + paid,
    fuel: x.fuel.map((n, r) => n - (burn[r] ?? 0)),
  }));
  return note({ ...t, queue: t.queue.slice(1) }, ev, { kind: 'power', seat, powered, paid });
}

function applyPower(s: CurrentState, seat: number, f: Firing, ev: CurrentEvent[]): CurrentState | string {
  const c = companyOf(s, seat);
  if (!f.stations.every((n) => c.stations.includes(n))) return 'Fire only your own stations.';
  if (!firings(c).some((g) => g.stations.join(',') === f.stations.join(',') && g.hybridCoal === f.hybridCoal))
    return 'Your fuel cannot fire those stations that way.';
  return toNextPower(payday(s, seat, f, ev), ev);
}

/** After payday (C18, C19): restock the yard, shuffle in Era III, move the market on, and a new round. */
function endRound(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  const restock = RESTOCK[s.seats]?.[s.era - 1] ?? [0, 0, 0, 0];
  const added = restock.map((k, r) =>
    Math.max(
      0,
      Math.min(k, supplyOf(r, s.yard, s.companies), (YARD_PRICES[r]?.length ?? 0) - (s.yard[r] ?? 0)),
    ),
  );
  let t = note({ ...s, yard: s.yard.map((y, r) => y + (added[r] ?? 0)) }, ev, { kind: 'restock', added });
  if (t.era === 3) return replace(removeLowest(t, ev), 1, 'round', ev);
  const top = t.market.at(-1);
  if (top === undefined) return replace(t, 0, 'round', ev);
  t = note(
    {
      ...t,
      market: t.market.slice(0, -1),
      // The highest station of Eras I and II was always drawn from the deck, so it has a position (invariants).
      stack: { ...t.stack, under: [...t.stack.under, { pos: t.posOf[String(top)] ?? -1, station: top }] },
    },
    ev,
    { kind: 'under', station: top },
  );
  return replace(t, 1, 'round', ev);
}

/* ------------------------------------------------------------------------------------------------- end */

/** Places by cities powered, then money, then cities (C22); tied seats share a place. */
export function placesOf(powered: readonly number[], s: CurrentState): number[] {
  const key = (i: number): number[] => [
    powered[i] ?? 0,
    companyOf(s, i).money,
    companyOf(s, i).cities.length,
  ];
  const beats = (i: number, j: number): boolean => {
    const a = key(i);
    const b = key(j);
    for (let k = 0; k < a.length; k++)
      if ((a[k] as number) !== (b[k] as number)) return (a[k] as number) > (b[k] as number);
    return false;
  };
  return powered.map((_, i) => 1 + powered.filter((_, j) => beats(j, i)).length);
}

function finish(s: CurrentState, ev: CurrentEvent[]): CurrentState {
  const powered = s.companies.map(bestPower);
  const result: Outcome = { places: placesOf(powered, s), scores: powered, reason: 'cities' };
  return note({ ...s, phase: 'over', queue: [], result }, ev, { kind: 'end', powered });
}

/** Scores as if the game ended now: the cities each company could light (public data only). */
export const standingsOf = (s: CurrentState): readonly number[] =>
  s.result?.scores ?? s.companies.map(bestPower);
