import { deepFreeze, packetOrderFits } from '@bored-games/game-kit';
import {
  DECK_ID,
  deckOf,
  FIELD_BASE,
  FIELD_COUNT,
  HAND_SIZES,
  pilesOf,
  ROLES,
  type Role,
  roleBase,
  SURGE_BASE,
} from '../src/data.ts';
import {
  applyAction,
  DEFAULT_RULES,
  installDeckOrder,
  pendingOf,
  setupGame,
  shufflePlaintexts,
} from '../src/engine.ts';
import { checkInvariants } from '../src/invariants.ts';
import { CITY_COUNT } from '../src/map.ts';
import type { SpreadAction, SpreadEvent, SpreadRules, SpreadState } from '../src/types.ts';

export interface DeckPlan {
  /** Spread cards top first (the first nine are the opening infection); the rest follow ascending. */
  spread?: readonly number[];
  /** Field cards (0–52) in deal and draw order; the rest follow ascending. */
  field?: readonly number[];
  /** Per pile, the index of its surge within the pile (default: last). */
  surgeAt?: readonly number[];
  /** Roles by seat; the rest follow in role order. */
  roles?: readonly Role[];
}

const fill = (first: readonly number[], all: number): number[] => [
  ...first,
  ...Array.from({ length: all }, (_, i) => i).filter((i) => !first.includes(i)),
];

/** A deck order the shuffle rounds can produce, laid out as `plan` says. */
export function deckOrder(seats: number, plan: DeckPlan = {}, rules: SpreadRules = DEFAULT_RULES): number[] {
  const order: number[] = [];
  fill(plan.spread ?? [], CITY_COUNT).forEach((c, pos) => {
    order[pos] = c;
  });
  const field = fill(plan.field ?? [], FIELD_COUNT);
  const hand = (HAND_SIZES[seats] ?? 2) * seats;
  for (let i = 0; i < hand; i++) order[FIELD_BASE + i] = FIELD_BASE + (field[i] as number);
  let next = hand;
  pilesOf(rules, seats).forEach((positions, k) => {
    const at = plan.surgeAt?.[k] ?? positions.length - 1;
    positions.forEach((pos, j) => {
      if (j === at) order[pos] = SURGE_BASE + k;
      else order[pos] = FIELD_BASE + (field[next++] as number);
    });
  });
  const roles = fill(
    (plan.roles ?? []).map((r) => ROLES.indexOf(r)),
    ROLES.length,
  );
  roles.forEach((r, i) => {
    order[roleBase(rules) + i] = roleBase(rules) + r;
  });
  if (!packetOrderFits(deckOf(rules, seats), order)) throw new Error('the plan does not fit the deck');
  return order;
}

/** Apply `action`, which must be accepted; checks the invariants. */
export function step(
  s: SpreadState,
  action: unknown,
): { state: SpreadState; events: readonly SpreadEvent[] } {
  const r = applyAction(s, action);
  if (!r.ok) throw new Error(`${JSON.stringify(action)}: ${r.error.message}`);
  const problems = checkInvariants(r.state);
  if (problems.length > 0)
    throw new Error(`${JSON.stringify(action)} broke invariants: ${problems.join('; ')}`);
  return { state: deepFreeze(r.state), events: r.events };
}

/** Run the deck: every pending reveal and restack, from the full state's order (a restack keeps the spent order). */
export function settle(s: SpreadState, events: SpreadEvent[] = []): SpreadState {
  let t = s;
  for (let guard = 0; guard < 400; guard++) {
    const p = pendingOf(t);
    if (p.type === 'reveal') {
      const pos = p.positions[0] as number;
      const r = step(t, { type: 'reveal', actor: 'deck', deck: DECK_ID, pos, card: t.plain?.[String(pos)] });
      events.push(...r.events);
      t = r.state;
    } else if (p.type === 'shuffle') {
      const installed = installDeckOrder(t, p.epoch, shufflePlaintexts(t));
      if (!installed.ok) throw new Error(installed.error.message);
      const r = step(installed.state, { type: 'epoch', actor: 'deck', epoch: p.epoch, size: p.from.length });
      events.push(...r.events);
      t = r.state;
    } else return t;
  }
  throw new Error('the deck never settled');
}

/** A started game: setup and its reveal done, the first player to act. */
export function started(seats: number, plan: DeckPlan = {}, rules: SpreadRules = DEFAULT_RULES): SpreadState {
  const r = setupGame({
    rules,
    seats,
    mode: 'full',
    deckOrders: { [DECK_ID]: deckOrder(seats, plan, rules) },
  });
  if (!r.ok) throw new Error(r.error.message);
  return settle(deepFreeze(r.value));
}

/** Apply `action`, then run the deck; returns the events too. */
export function run(s: SpreadState, action: SpreadAction): { state: SpreadState; events: SpreadEvent[] } {
  const r = step(s, action);
  const events = [...r.events];
  return { state: settle(r.state, events), events };
}
export const act = (s: SpreadState, action: SpreadAction): SpreadState => run(s, action).state;

/** Apply `action`, which must be refused, and return the message. */
export function refused(s: SpreadState, action: unknown): string {
  const r = applyAction(s, action);
  if (r.ok) throw new Error(`${JSON.stringify(action)} was accepted`);
  return r.error.message;
}

/** The active seat ends its actions; the draw and the spread run (windows passed). */
export function endTurn(s: SpreadState): { state: SpreadState; events: SpreadEvent[] } {
  let r = run(s, { type: 'end', actor: s.turn });
  const events = [...r.events];
  for (let guard = 0; guard < 50; guard++) {
    const p = pendingOf(r.state);
    if (p.type !== 'player' || p.decision !== 'relief') break;
    r = run(r.state, { type: 'pass', actor: p.seat });
    events.push(...r.events);
  }
  return { state: r.state, events };
}

/** The state with some fields replaced, frozen. */
export const edit = (s: SpreadState, patch: Partial<SpreadState>): SpreadState =>
  deepFreeze({ ...s, ...patch });

/** An empty board: no cases anywhere. */
export const clean = (s: SpreadState): SpreadState => edit(s, { cases: s.cases.map(() => [0, 0, 0, 0]) });

/** Replace one seat's hand; the cards leave every other hand. */
export const withHand = (s: SpreadState, seat: number, hand: readonly number[]): SpreadState =>
  edit(s, {
    hands: s.hands.map((h, i) =>
      i === seat ? [...hand].sort((a, b) => a - b) : h.filter((f) => !hand.includes(f)),
    ),
  });

/** Put one pawn somewhere. */
export const at = (s: SpreadState, seat: number, city: number): SpreadState =>
  edit(s, { at: s.at.map((c, i) => (i === seat ? city : c)) });

/** Set the cases of one strain in one city. */
export const cases = (s: SpreadState, city: number, strain: number, n: number): SpreadState =>
  edit(s, { cases: s.cases.map((c, i) => (i === city ? c.map((m, k) => (k === strain ? n : m)) : c)) });

/** Roles by seat. */
export const roles = (...rs: Role[]): Role[] => rs;
