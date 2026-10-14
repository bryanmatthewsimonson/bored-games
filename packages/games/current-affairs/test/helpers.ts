import { deepFreeze } from '@bored-games/game-kit';
import { DECK_STATIONS, FUEL_TOTAL } from '../src/data.ts';
import {
  applyAction,
  DECK_ID,
  DEFAULT_RULES,
  installDeckOrder,
  legalActions,
  pendingOf,
  REGION_CHOOSER,
  regionChoices,
  setupGame,
  shufflePlaintexts,
} from '../src/engine.ts';
import { checkInvariants } from '../src/invariants.ts';
import type { Company, CurrentAction, CurrentEvent, CurrentRules, CurrentState } from '../src/types.ts';

/** The card id of a station in the deck `pile` (13 is card 0; the stack's stations follow, ascending). */
export const cardOf = (station: number): number => DECK_STATIONS.indexOf(station);

/**
 * A deck order: 13 on top (position 0), then `stations` in the order given, then every other station ascending. The
 * default draws 13, 11, 12, 14, 15, … (the lowest unseen each time).
 */
export function deckOrder(stations: readonly number[] = []): number[] {
  const first = stations.map(cardOf);
  const rest = DECK_STATIONS.map((_, card) => card).filter((card) => card !== 0 && !first.includes(card));
  return [0, ...first, ...rest];
}

/** The frozen full state at setup, with the deck in `order`: seat 0 is to choose the regions in play. */
export function fresh(
  seats: number,
  order: readonly number[] = deckOrder(),
  rules: CurrentRules = DEFAULT_RULES,
): CurrentState {
  const r = setupGame({ rules, seats, mode: 'full', deckOrders: { [DECK_ID]: order } });
  if (!r.ok) throw new Error(r.error.message);
  return deepFreeze(r.value);
}

/** Apply `action`, which must be accepted, and return the events too. */
export function step(
  s: CurrentState,
  action: CurrentAction,
): { state: CurrentState; events: readonly CurrentEvent[] } {
  const r = applyAction(s, action);
  if (!r.ok) throw new Error(`${JSON.stringify(action)}: ${r.error.message}`);
  const problems = checkInvariants(r.state);
  if (problems.length > 0)
    throw new Error(`${JSON.stringify(action)} broke invariants: ${problems.join('; ')}`);
  return { state: deepFreeze(r.state), events: r.events };
}

export const act = (s: CurrentState, action: CurrentAction): CurrentState => step(s, action).state;

/** Apply `action`, which must be refused, and return the message. */
export function refused(s: CurrentState, action: unknown): string {
  const r = applyAction(s, action);
  if (r.ok) throw new Error(`${JSON.stringify(action)} was accepted`);
  return r.error.message;
}

/** Every seat in `s.contributors` adds its share of the open roll, then the beacon gives `faces`. */
export function rollStep(
  s: CurrentState,
  faces: readonly number[],
): { state: CurrentState; events: readonly CurrentEvent[] } {
  if (s.roll === null) throw new Error('no roll is open');
  const id = s.roll.id;
  let t = s;
  for (const seat of s.contributors) t = act(t, { type: 'contribute', actor: seat, id });
  const p = pendingOf(t);
  if (p.type !== 'beacon') throw new Error(`the roll still waits: ${JSON.stringify(p)}`);
  return step(t, { type: 'rolled', actor: 'beacon', id, dice: faces });
}
export const rollWith = (s: CurrentState, faces: readonly number[]): CurrentState => rollStep(s, faces).state;

/** Turn up the pending position, with the station the full state knows is there. */
export function revealStep(s: CurrentState): { state: CurrentState; events: readonly CurrentEvent[] } {
  const pos = s.reveal;
  if (pos === null || s.plain === null) throw new Error('no reveal is pending');
  return step(s, { type: 'reveal', actor: 'deck', deck: DECK_ID, pos, card: s.plain[String(pos)] as number });
}
export const revealNext = (s: CurrentState): CurrentState => revealStep(s).state;

/**
 * The Era III reshuffle: install `order` (card ids of the stations under the stack; by default as they were laid)
 * and apply the epoch.
 */
export function epochStep(
  s: CurrentState,
  order: readonly number[] = shufflePlaintexts(s),
): { state: CurrentState; events: readonly CurrentEvent[] } {
  const r = installDeckOrder(s, 1, order);
  if (!r.ok) throw new Error(r.error.message);
  return step(deepFreeze(r.state), { type: 'epoch', actor: 'deck', epoch: 1, size: order.length });
}

/** Turn up every pending draw, and apply the Era III reshuffle as laid, until a player decides. */
export function drawAll(s: CurrentState): CurrentState {
  let t = s;
  for (let p = pendingOf(t); p.type === 'reveal' || p.type === 'shuffle'; p = pendingOf(t))
    t = p.type === 'reveal' ? revealNext(t) : epochStep(t).state;
  return t;
}

/** Seat 0 chooses `regions` (by default the first set listed: 0, 1, 2 for three regions, so cities 0–20 are in play). */
export function chosen(
  s: CurrentState,
  regions: readonly number[] = regionChoices(s)[0] as number[],
): CurrentState {
  return act(s, { type: 'regions', actor: REGION_CHOOSER, regions });
}

/**
 * The game at its first auction: seat 0 chooses `regions`, the order roll gives `orderDice` (all ones: 0, 1, …), the
 * deck is in `order`.
 */
export function started(
  seats: number,
  regions: readonly number[] | null = null,
  orderDice: readonly number[] = Array.from({ length: seats - 1 }, () => 1),
  order: readonly number[] = deckOrder(),
): CurrentState {
  const s = fresh(seats, order);
  return rollWith(chosen(s, regions ?? (regionChoices(s)[0] as number[])), orderDice);
}

/** The seat the engine waits on (a player decision). */
export function turnOf(s: CurrentState): number {
  const p = pendingOf(s);
  if (p.type !== 'player') throw new Error(`no player decision: ${JSON.stringify(p)}`);
  return p.seat;
}

/** Every bidder still in the lot folds, so the opener (or the leader) takes it. */
export function foldAll(s: CurrentState): CurrentState {
  let t = s;
  while (t.lot !== null && pendingOf(t).type === 'player') t = act(t, { type: 'fold', actor: t.lot.turn });
  return t;
}

/** The seat to choose opens `station` at `bid` (its number by default); everyone else folds; draws are turned up. */
export function sell(s: CurrentState, station: number, bid = station): CurrentState {
  return drawAll(foldAll(act(s, { type: 'open', actor: turnOf(s), station, bid })));
}

/** The company whose turn it is ends its fuel or wiring turn. */
export const done = (s: CurrentState): CurrentState => act(s, { type: 'done', actor: turnOf(s) });

/** End every fuel or wiring turn of the current phase. */
export function skipPhase(s: CurrentState): CurrentState {
  const phase = s.phase;
  let t = s;
  while (t.phase === phase && pendingOf(t).type === 'player') t = done(t);
  return t;
}

/** A state with `seat`'s company changed (for positions the rules could reach more slowly). */
export function withCompany(s: CurrentState, seat: number, f: (c: Company) => Company): CurrentState {
  return deepFreeze({ ...s, companies: s.companies.map((c, i) => (i === seat ? f(c) : c)) });
}

/** A state with some fields replaced (for positions the rules could reach more slowly). */
export const patch = (s: CurrentState, fields: Partial<CurrentState>): CurrentState =>
  deepFreeze({ ...s, ...fields });

/** `seat` holds substations in `cities` (houses included), in that order. */
export function wired(s: CurrentState, seat: number, cities: readonly number[]): CurrentState {
  const t = withCompany(s, seat, (c) => ({ ...c, cities: [...c.cities, ...cities] }));
  return patch(t, { houses: t.houses.map((h, city) => (cities.includes(city) ? [...h, seat] : h)) });
}

/**
 * `seat` owns `stations` too, taken from wherever they lie (the market, under the stack, out of the game, another
 * company, or the deck: the position that holds it is no longer drawn), so every station stays in one place.
 */
export function own(s: CurrentState, seat: number, stations: readonly number[]): CurrentState {
  const t = patch(s, { ...offBoard(s, stations), stack: offStack(s, stations) });
  return withCompany(t, seat, (c) => ({
    ...c,
    stations: [...c.stations, ...stations].sort((a, b) => a - b),
  }));
}

/** The market, the stations out of the game and the companies, without `stations`. */
function offBoard(s: CurrentState, stations: readonly number[]): Partial<CurrentState> {
  const out = (xs: readonly number[]) => xs.filter((n) => !stations.includes(n));
  return {
    market: out(s.market),
    gone: out(s.gone),
    companies: s.companies.map((c) => ({ ...c, stations: out(c.stations) })),
  };
}

/** The stack without `stations`: their deck positions are dropped, and they leave the stations under it. */
function offStack(s: CurrentState, stations: readonly number[]): CurrentState['stack'] {
  const cards = stations.map(cardOf);
  const holds = (pos: number) => cards.includes(s.plain?.[String(pos)] ?? -1);
  return {
    ...s.stack,
    next: s.stack.next.filter((pos) => !holds(pos)),
    out: s.stack.out.filter((pos) => !holds(pos)),
    under: s.stack.under.filter((u) => !stations.includes(u.station)),
  };
}

/** Lay `stations` under the stack (from wherever they lie), each with the deck position that held it. */
export function layUnder(s: CurrentState, stations: readonly number[]): CurrentState {
  const plain = s.plain ?? {};
  const posOf = (station: number): number =>
    Number(Object.keys(plain).find((pos) => plain[pos] === cardOf(station)) ?? -1);
  const stack = offStack(s, stations);
  return patch(s, {
    ...offBoard(s, stations),
    stack: {
      ...stack,
      under: [...stack.under, ...stations.map((station) => ({ pos: posOf(station), station }))],
    },
  });
}

/** The stack with its draws before the Era III card set aside unseen: the next draw is the Era III card. */
export const eraCardNext = (s: CurrentState): CurrentState =>
  patch(s, { stack: { ...s.stack, next: [], out: [...s.stack.next, ...s.stack.out] } });

/** `seat` holds `fuel`; what the supply cannot give comes off the yard (its cheapest units). */
export function fuelled(s: CurrentState, seat: number, fuel: readonly number[]): CurrentState {
  const t = withCompany(s, seat, (c) => ({ ...c, fuel: [...fuel] }));
  const held = (r: number) => t.companies.reduce((n, c) => n + (c.fuel[r] ?? 0), 0);
  return patch(t, {
    yard: t.yard.map((y, r) => Math.max(0, Math.min(y, (FUEL_TOTAL[r] as number) - held(r)))),
  });
}

/**
 * Play on to the next round's auction: every company passes (round 2 on) or folds, buys no fuel and wires nothing,
 * and fires the last firing listed; draws are turned up as the deck lies.
 */
export function nextRound(s: CurrentState): CurrentState {
  const round = s.round;
  let t = s;
  for (let p = pendingOf(t); !(t.round > round && p.type === 'player'); p = pendingOf(t)) {
    if (p.type === 'over') return t;
    if (p.type === 'reveal' || p.type === 'shuffle') t = drawAll(t);
    else if (p.type !== 'player') throw new Error(`nextRound at ${JSON.stringify(p)}`);
    else if (p.decision === 'fuel' || p.decision === 'build') t = done(t);
    else if (p.decision === 'power') t = act(t, legal(t, p.seat).at(-1) as CurrentAction);
    else if (p.decision === 'bid') t = act(t, { type: 'fold', actor: p.seat });
    else if (p.decision === 'open') t = act(t, { type: 'pass', actor: p.seat });
    else throw new Error(`nextRound at ${p.decision}`);
  }
  return t;
}

/** The invariant violations of `s` (surgery must keep it sound). */
export const problems = (s: CurrentState): readonly string[] => checkInvariants(s);

export const legal = (s: CurrentState, seat: number): readonly CurrentAction[] => legalActions(s, seat);

export { DEFAULT_RULES };
