import { expect } from 'vitest';
import {
  applyAction,
  cardAt,
  checkInvariants,
  DECK_SIZE,
  DEFAULT_RULES,
  type HollerEvent,
  type HollerState,
  legalActionsOf,
  pendingOf,
  setupGame,
} from '../src/index.ts';

export function handPos(seats: number, seat: number, index: number): number {
  return index * seats + seat;
}

export function starterPos(seats: number): number {
  return 7 * seats;
}

/** A permutation of 0..107 with `placed` positions pinned to those cards. */
export function deck(placed: Record<number, number> = {}): number[] {
  const order = Array.from({ length: DECK_SIZE }, () => -1);
  const used = new Set<number>();
  for (const [pos, card] of Object.entries(placed)) {
    const at = Number(pos);
    if (order[at] !== -1) throw new Error(`position ${at} placed twice`);
    if (used.has(card)) throw new Error(`card ${card} placed twice`);
    order[at] = card;
    used.add(card);
  }
  let next = 0;
  for (let i = 0; i < DECK_SIZE; i++) {
    if (order[i] !== -1) continue;
    while (used.has(next)) next += 1;
    order[i] = next;
    used.add(next);
  }
  return order;
}

export function setup(seats = 2, placed: Record<number, number> = {}): HollerState {
  const result = setupGame({
    rules: DEFAULT_RULES,
    seats,
    mode: 'full',
    deckOrders: { pile: deck(placed) },
  });
  if (!result.ok) throw new Error(result.error.message);
  expect(checkInvariants(result.value)).toEqual([]);
  return result.value;
}

export interface Played {
  readonly state: HollerState;
  readonly events: readonly HollerEvent[];
}

/** Applies one action, asserting it is accepted, pure and sound. */
export function act(s: HollerState, action: unknown): Played {
  const before = JSON.stringify(s);
  const result = applyAction(s, action);
  if (!result.ok) {
    throw new Error(`rejected ${JSON.stringify(action)}: ${result.error.code} ${result.error.message}`);
  }
  expect(JSON.stringify(s)).toBe(before);
  expect(checkInvariants(result.state)).toEqual([]);
  return { state: result.state, events: result.events };
}

export function rejects(s: HollerState, action: unknown, code: string): void {
  const before = JSON.stringify(s);
  const result = applyAction(s, action);
  expect(result.ok, `expected ${JSON.stringify(action)} to be rejected`).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
  expect(JSON.stringify(s)).toBe(before);
}

export function reveal(s: HollerState): HollerState {
  if (s.phase.type !== 'reveal') throw new Error(`not a reveal (${s.phase.type})`);
  const pos = s.phase.positions[0];
  if (pos === undefined) throw new Error('no reveal position');
  const card = cardAt(s.orders, pos);
  if (card === null) throw new Error(`no card at ${pos}`);
  return act(s, { type: 'reveal', actor: 'deck', deck: 'pile', pos, card }).state;
}

export function revealAll(s: HollerState): HollerState {
  let state = s;
  for (let i = 0; i < 120 && state.phase.type === 'reveal'; i++) state = reveal(state);
  return state;
}

export function posOf(s: HollerState, seat: number, card: number): number {
  const slot = s.hands[seat]?.find((entry) => entry.card === card);
  if (!slot) throw new Error(`seat ${seat} has no card ${card}`);
  return slot.pos;
}

export function playCard(
  s: HollerState,
  seat: number,
  card: number,
  extra: { readonly suit?: 0 | 1 | 2 | 3; readonly holler?: true } = {},
): HollerState {
  const action: {
    type: 'play';
    actor: number;
    pos: number;
    card: number;
    suit?: 0 | 1 | 2 | 3;
    holler?: true;
  } = { type: 'play', actor: seat, pos: posOf(s, seat, card), card };
  if (extra.suit !== undefined) action.suit = extra.suit;
  if (extra.holler) action.holler = true;
  return act(s, action).state;
}

export function opening(s: HollerState): number[] {
  const order = s.orders[0];
  if (!order) throw new Error('no opening order');
  return [...order];
}

export function pendingSeat(s: HollerState): number {
  const pending = pendingOf(s);
  if (pending.type !== 'player') throw new Error(`not a player decision (${pending.type})`);
  return pending.seat;
}

export function typesOf(s: HollerState, seat = pendingSeat(s)): string[] {
  return legalActionsOf(s, seat).map((action) => (action as { type: string }).type);
}
