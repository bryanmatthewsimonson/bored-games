import { expect } from 'vitest';
import {
  applyAction,
  type BankEvent,
  type BankRules,
  type BankState,
  checkInvariants,
  DEFAULT_RULES,
  legalActionsOf,
  pendingOf,
  setupGame,
} from '../src/index.ts';

export function rules(over: Partial<BankRules> = {}): BankRules {
  return { ...DEFAULT_RULES, ...over };
}

export function setup(seats = 3, gameRules: BankRules = DEFAULT_RULES): BankState {
  const result = setupGame({ rules: gameRules, seats, mode: 'full', deckOrders: {} });
  if (!result.ok) throw new Error(result.error.message);
  expect(checkInvariants(result.value)).toEqual([]);
  return result.value;
}

export interface Played {
  readonly state: BankState;
  readonly events: readonly BankEvent[];
}

/** Applies one action, asserting it is accepted, pure and sound. */
export function act(s: BankState, action: unknown): Played {
  const before = JSON.stringify(s);
  const result = applyAction(s, action);
  if (!result.ok) {
    throw new Error(`rejected ${JSON.stringify(action)}: ${result.error.code} ${result.error.message}`);
  }
  expect(JSON.stringify(s)).toBe(before);
  expect(checkInvariants(result.state)).toEqual([]);
  return { state: result.state, events: result.events };
}

export function rejects(s: BankState, action: unknown, code: string): void {
  const before = JSON.stringify(s);
  const result = applyAction(s, action);
  let label: string;
  try {
    label = JSON.stringify(action);
  } catch {
    label = 'an unprintable action';
  }
  expect(result.ok, `expected ${label} to be rejected`).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
  expect(JSON.stringify(s)).toBe(before);
}

/** Stay until the roller is asked. */
export function toRoller(s: BankState): BankState {
  let state = s;
  while (state.phase === 'call') {
    const pending = pendingOf(state);
    if (pending.type !== 'player' || pending.seat === state.roller) return state;
    state = act(state, { type: 'stay', actor: pending.seat }).state;
  }
  return state;
}

/** From a call window, roll `dice` and resolve them. Other seats stay, then contribute. */
export function playRoll(s: BankState, dice: readonly [number, number]): Played {
  let state = toRoller(s);
  const id = state.nextRollId;
  const roller = state.roller;
  state = act(state, { type: 'roll', actor: roller, rollId: id }).state;
  while (state.phase === 'collect') {
    const seat = state.owe[0] as number;
    state = act(state, { type: 'contribute', actor: seat, rollId: id }).state;
  }
  expect(state.phase).toBe('beacon');
  return act(state, { type: 'rolled', actor: 'beacon', id, dice: [dice[0], dice[1]] });
}

/**
 * End the open round with a bust, so nobody is paid. Rolls that are still safe add 2. An empty pot is not
 * banked: a round with no roll yet has to be rolled before it can end.
 */
export function bustRound(s: BankState): BankState {
  let state = s;
  const round = s.round;
  while (state.round === round && state.phase === 'call') {
    const dice: readonly [number, number] = state.rolls >= 3 ? [1, 6] : [1, 1];
    state = playRoll(state, dice).state;
  }
  return state;
}

/** Bank whenever the pending seat may. Stops when this round ends or the dice must be rolled. */
export function bankTheRound(s: BankState): BankState {
  let state = s;
  const round = s.round;
  while (state.phase === 'call' && state.round === round) {
    const pending = pendingOf(state);
    if (pending.type !== 'player') break;
    const bank = legalActionsOf(state, pending.seat).find(
      (action) => (action as { type?: string }).type === 'bank',
    );
    if (bank === undefined) break;
    state = act(state, bank).state;
  }
  return state;
}
