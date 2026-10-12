import { deepFreeze, range } from '@bored-games/game-kit';
import { DISCOVERY_COUNT, MONUMENT_COUNT } from '../src/data.ts';
import { applyAction, DECK_ID, DEFAULT_RULES, legalActions, pendingOf, setupGame } from '../src/engine.ts';
import type { Clan, Spot, SticksAction, SticksEvent, SticksRules, SticksState } from '../src/types.ts';

/**
 * A deck order whose discoveries start with `cards` and whose monuments start with `monuments` (as monument
 * numbers 0–27); the rest follow in number order.
 */
export function orderWith(cards: readonly number[] = [], monuments: readonly number[] = []): number[] {
  const d = [...cards, ...range(DISCOVERY_COUNT).filter((c) => !cards.includes(c))];
  const m = [...monuments, ...range(MONUMENT_COUNT).filter((c) => !monuments.includes(c))];
  return [...d, ...m.map((n) => n + DISCOVERY_COUNT)];
}

/** The frozen full state at setup, before any reveal. */
export function fresh(
  seats: number,
  order: readonly number[] = orderWith(),
  rules: SticksRules = DEFAULT_RULES,
): SticksState {
  const r = setupGame({ rules, seats, mode: 'full', deckOrders: { [DECK_ID]: order } });
  if (!r.ok) throw new Error(r.error.message);
  return deepFreeze(r.value);
}

/** Apply `action`, which must be accepted, and return the events too. */
export function step(
  s: SticksState,
  action: SticksAction,
): { state: SticksState; events: readonly SticksEvent[] } {
  const r = applyAction(s, action);
  if (!r.ok) throw new Error(`${JSON.stringify(action)}: ${r.error.message}`);
  return { state: deepFreeze(r.state), events: r.events };
}

export const act = (s: SticksState, action: SticksAction): SticksState => step(s, action).state;

/** Apply `action`, which must be refused, and return the message. */
export function refused(s: SticksState, action: unknown): string {
  const r = applyAction(s, action);
  if (r.ok) throw new Error(`${JSON.stringify(action)} was accepted`);
  return r.error.message;
}

/** Turn up every pending reveal from the deck order. */
export function revealAll(s: SticksState): SticksState {
  let t = s;
  for (let p = pendingOf(t); p.type === 'reveal'; p = pendingOf(t))
    for (const pos of p.positions)
      t = act(t, { type: 'reveal', actor: 'deck', deck: DECK_ID, pos, card: t.order?.[pos] as number });
  return t;
}

/** The game at its first placement: the opening reveals done. */
export const started = (seats: number, order?: readonly number[], rules?: SticksRules): SticksState =>
  revealAll(fresh(seats, order, rules));

/** Every seat adds its share of the open roll, then the beacon gives `faces`. */
export function rollStep(
  s: SticksState,
  faces: readonly number[],
): { state: SticksState; events: readonly SticksEvent[] } {
  let t = s;
  for (let p = pendingOf(t); p.type === 'player' && p.decision === 'contribute'; p = pendingOf(t))
    t = act(t, { type: 'contribute', actor: p.seat, id: t.roll as number });
  const p = pendingOf(t);
  if (p.type !== 'beacon') throw new Error(`no roll is open: ${JSON.stringify(p)}`);
  return step(t, { type: 'rolled', actor: 'beacon', id: p.id, dice: faces });
}
export const rollWith = (s: SticksState, faces: readonly number[]): SticksState => rollStep(s, faces).state;

export const place = (s: SticksState, seat: number, spot: Spot, count = 1): SticksState =>
  act(s, { type: 'place', actor: seat, spot, count });

/** A state with `seat`'s clan changed (for set-ups the rules could reach more slowly). */
export function withClan(s: SticksState, seat: number, f: (c: Clan) => Clan): SticksState {
  return deepFreeze({ ...s, clans: s.clans.map((c, i) => (i === seat ? f(c) : c)) });
}

/** Place the given moves in turn (each `[seat, spot, count]`), then return the state. */
export function placeAll(s: SticksState, moves: readonly (readonly [number, Spot, number?])[]): SticksState {
  return moves.reduce((t, [seat, spot, count]) => place(t, seat, spot, count ?? 1), s);
}

/** Everyone still placing hunts with all their people; then everyone still resolving rolls all ones. */
export function huntRound(s: SticksState): SticksState {
  let t = s;
  while (t.stage === 'place') t = place(t, t.turn, 'hunt', t.home[t.turn] ?? 0);
  while (t.stage === 'resolve') {
    const seat = t.turn;
    const n = t.spots.hunt[seat] ?? 0;
    t = rollWith(
      act(t, { type: 'use', actor: seat, spot: 'hunt' }),
      Array.from({ length: n }, () => 1),
    );
  }
  return t;
}

export const legal = (s: SticksState, seat: number) => legalActions(s, seat);

export { DEFAULT_RULES };
