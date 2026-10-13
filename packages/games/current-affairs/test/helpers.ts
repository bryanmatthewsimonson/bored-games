import { deepFreeze } from '@bored-games/game-kit';
import { FUEL_TOTAL } from '../src/data.ts';
import { applyAction, DEFAULT_RULES, legalActions, pendingOf, setupGame } from '../src/engine.ts';
import { checkInvariants } from '../src/invariants.ts';
import type { Company, CurrentAction, CurrentEvent, CurrentRules, CurrentState } from '../src/types.ts';

/** The frozen full state at setup: the regions roll is open. */
export function fresh(seats: number, rules: CurrentRules = DEFAULT_RULES): CurrentState {
  const r = setupGame({ rules, seats, mode: 'full', deckOrders: {} });
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

/** Resolve every open draw roll with `face` (1 draws the lowest station still unseen). */
export function drawAll(s: CurrentState, face = 1): CurrentState {
  let t = s;
  while (t.roll !== null) t = rollWith(t, [face]);
  return t;
}

/** The game at its first auction: the regions roll gives `regionFace`, the order roll `orderDice` (all ones: 0, 1, …). */
export function started(
  seats: number,
  regionFace = 1,
  orderDice: readonly number[] = Array.from({ length: seats - 1 }, () => 1),
): CurrentState {
  return rollWith(rollWith(fresh(seats), [regionFace]), orderDice);
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
  while (t.lot !== null && t.roll === null) t = act(t, { type: 'fold', actor: t.lot.turn });
  return t;
}

/** The seat to choose opens `station` at `bid` (its number by default); everyone else folds; draws take `face`. */
export function sell(s: CurrentState, station: number, bid = station, face = 1): CurrentState {
  return drawAll(foldAll(act(s, { type: 'open', actor: turnOf(s), station, bid })), face);
}

/** The company whose turn it is ends its fuel or wiring turn. */
export const done = (s: CurrentState): CurrentState => act(s, { type: 'done', actor: turnOf(s) });

/** End every fuel or wiring turn of the current phase. */
export function skipPhase(s: CurrentState): CurrentState {
  const phase = s.phase;
  let t = s;
  while (t.phase === phase && t.roll === null) t = done(t);
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
 * `seat` owns `stations` too, taken from wherever they lie (the market, the stack, out of the game, another
 * company), so every station stays in one place.
 */
export function own(s: CurrentState, seat: number, stations: readonly number[]): CurrentState {
  const out = (xs: readonly number[]) => xs.filter((n) => !stations.includes(n));
  const pool = out(s.stack.pool);
  const t = patch(s, {
    market: out(s.market),
    gone: out(s.gone),
    stack: {
      ...s.stack,
      top: out(s.stack.top),
      pool,
      draws: Math.min(s.stack.draws, pool.length),
      under: out(s.stack.under),
      boxed: out(s.stack.boxed),
    },
    companies: s.companies.map((c) => ({ ...c, stations: out(c.stations) })),
  });
  return withCompany(t, seat, (c) => ({
    ...c,
    stations: [...c.stations, ...stations].sort((a, b) => a - b),
  }));
}

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
 * fires the last firing listed; draws take `face`.
 */
export function nextRound(s: CurrentState, face = 1): CurrentState {
  const round = s.round;
  let t = s;
  // A round with nothing on offer has no auction to wait in: it starts at the fuel phase.
  while (!(t.round > round && t.roll === null && (t.phase === 'auction' || t.sold === 0))) {
    if (t.phase === 'over') return t;
    if (t.roll !== null) t = rollWith(t, [face]);
    else if (t.phase === 'fuel' || t.phase === 'build') t = done(t);
    else if (t.phase === 'power') t = act(t, legal(t, turnOf(t)).at(-1) as CurrentAction);
    else if (t.lot !== null) t = act(t, { type: 'fold', actor: t.lot.turn });
    else if (t.phase === 'auction' && t.scrapping === null) t = act(t, { type: 'pass', actor: turnOf(t) });
    else throw new Error(`nextRound from ${t.phase}`);
  }
  return t;
}

/** The invariant violations of `s` (surgery must keep it sound). */
export const problems = (s: CurrentState): readonly string[] => checkInvariants(s);

export const legal = (s: CurrentState, seat: number): readonly CurrentAction[] => legalActions(s, seat);

export { DEFAULT_RULES };
