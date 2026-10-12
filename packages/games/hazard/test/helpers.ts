import { deepFreeze, range } from '@bored-games/game-kit';
import { applyAction, DEFAULT_RULES, legalActions, pendingOf, setupGame } from '../src/engine.ts';
import { PROVINCES, type ProvinceId } from '../src/map.ts';
import type { HazardAction, HazardEvent, HazardRules, HazardState } from '../src/types.ts';

/** The frozen full state at setup. The pile holds cards in `order` (default: card n at position n). */
export function fresh(
  seats: number,
  order: readonly number[] = range(44),
  rules: HazardRules = DEFAULT_RULES,
): HazardState {
  const r = setupGame({ rules, seats, mode: 'full', deckOrders: { pile: order } });
  if (!r.ok) throw new Error(r.error.message);
  return deepFreeze(r.value);
}

/** Apply `action`, which must be accepted. */
export function act(s: HazardState, action: HazardAction): HazardState {
  return step(s, action).state;
}

/** Apply `action`, which must be accepted, and return the events too. */
export function step(
  s: HazardState,
  action: HazardAction,
): { state: HazardState; events: readonly HazardEvent[] } {
  const r = applyAction(s, action);
  if (!r.ok) throw new Error(`${JSON.stringify(action)}: ${r.error.message}`);
  return { state: deepFreeze(r.state), events: r.events };
}

/** Apply `action`, which must be refused, and return the message. */
export function refused(s: HazardState, action: unknown): string {
  const r = applyAction(s, action);
  if (r.ok) throw new Error(`${JSON.stringify(action)} was accepted`);
  return r.error.message;
}

/** Every seat adds its share of the open roll, in the order pending names, up to the beacon. */
export function contributeAll(s: HazardState): HazardState {
  let t = s;
  for (let n = 0; n < t.seats + 1; n++) {
    const p = pendingOf(t);
    if (p.type === 'beacon') return t;
    if (p.type !== 'player' || p.decision !== 'contribute')
      throw new Error(`no roll is open: ${JSON.stringify(p)}`);
    t = act(t, { type: 'contribute', actor: p.seat, id: t.roll as number });
  }
  throw new Error('the roll never closed');
}

/** Every seat adds its share of the open roll, then the beacon gives `faces`; the state and the roll's events. */
export function rollStep(
  s: HazardState,
  faces: readonly number[],
): { state: HazardState; events: readonly HazardEvent[] } {
  const t = contributeAll(s);
  return step(t, { type: 'rolled', actor: 'beacon', id: t.roll as number, dice: faces });
}

/** Every seat adds its share of the open roll, then the beacon gives `faces`. */
export function contributeAndRoll(s: HazardState, faces: readonly number[]): HazardState {
  return rollStep(s, faces).state;
}

/** The first-player roll: the seat to roll starts it, and the beacon gives `faces`. */
export function orderRoll(s: HazardState, faces: readonly number[]): HazardState {
  return contributeAndRoll(act(s, { type: 'roll', actor: s.tied[0] as number }), faces);
}

/** Every seat claims, in turn, the lowest unclaimed province. */
export function claimAll(s: HazardState): HazardState {
  let t = s;
  while (t.stage === 'claim') {
    const province = PROVINCES[t.owner.indexOf(null)] as ProvinceId;
    t = act(t, { type: 'claim', actor: t.turn, province });
  }
  return t;
}

/** Every seat places, in turn, on its lowest-indexed province, until every reserve is empty. */
export function placeAll(s: HazardState): HazardState {
  let t = s;
  while (t.stage === 'place') {
    const province = PROVINCES[t.owner.indexOf(t.turn)] as ProvinceId;
    t = act(t, { type: 'place', actor: t.turn, province });
  }
  return t;
}

/** A game in its first turn: seat 0 wins the roll, provinces claimed round-robin from a1, reserves placed. */
export function opened(
  seats = 3,
  order: readonly number[] = range(44),
  rules: HazardRules = DEFAULT_RULES,
): HazardState {
  const faces = range(seats).map((i) => (i === 0 ? 6 : 1));
  return placeAll(claimAll(orderRoll(fresh(seats, order, rules), faces)));
}

/**
 * A state edited for a test: `owner` and `troops` given per province (others unchanged). The full state stays
 * consistent because the tests only move troops and owners between seats that are all still in play.
 */
export function withMap(
  s: HazardState,
  map: Partial<Record<ProvinceId, readonly [number, number]>>,
): HazardState {
  const owner = [...s.owner];
  const troops = [...s.troops];
  for (const [p, v] of Object.entries(map)) {
    const i = PROVINCES.indexOf(p as ProvinceId);
    owner[i] = (v as readonly [number, number])[0];
    troops[i] = (v as readonly [number, number])[1];
  }
  return deepFreeze({ ...s, owner, troops });
}

export { legalActions, pendingOf };

/** Seat 0's first turn with its pool placed on a1, so it may attack; then `map` applied. */
export function attacking(
  map: Partial<Record<ProvinceId, readonly [number, number]>> = {},
  rules: HazardRules = DEFAULT_RULES,
  seats = 3,
): HazardState {
  const s = opened(seats, range(44), rules);
  return withMap(act(s, { type: 'muster', actor: 0, province: 'a1', count: s.pool }), map);
}

/**
 * `s` with `seat` holding `cards` as charters. With the default order (card n at position n) each card sits at its
 * own position, which leaves the pile; the deal is recorded as the engine would.
 */
export function withHand(s: HazardState, seat: number, cards: readonly number[]): HazardState {
  const hands = s.hands.map((h, i) =>
    i === seat ? [...h, ...cards.map((card) => ({ pos: card, card, holders: [seat] }))] : h,
  );
  return deepFreeze({
    ...s,
    hands,
    pile: s.pile.filter((p) => !cards.includes(p)),
    dealt: [...s.dealt, ...cards.map((pos) => ({ deck: 'pile', pos, to: seat }))],
  });
}

/** Apply the pending reveals of a cashed set from the full state's plaintexts. */
export function revealCash(s: HazardState): { state: HazardState; events: readonly HazardEvent[] } {
  let t = s;
  let events: readonly HazardEvent[] = [];
  for (let n = 0; n < 3; n++) {
    const p = pendingOf(t);
    if (p.type !== 'reveal') break;
    const pos = p.positions[0] as number;
    const r = step(t, {
      type: 'reveal',
      actor: 'deck',
      deck: 'pile',
      pos,
      card: t.plain?.[String(pos)] as number,
    });
    t = r.state;
    events = r.events;
  }
  return { state: t, events };
}
