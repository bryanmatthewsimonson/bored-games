import { expect } from 'vitest';
import {
  type BankEvent,
  type BankModule,
  type BankRules,
  type BankState,
  bank,
  bankV1,
  DEFAULT_RULES,
} from '../src/index.ts';

/**
 * Both engines: Bank 0.2.0 (protocol 2, the current one) and Bank 0.1.0 (protocol 1, kept for v1 games in
 * progress). The shared catalog runs against each, so a rule the two share cannot drift in one of them.
 */
export const ENGINES: readonly BankModule[] = [bank, bankV1];

export function rules(over: Partial<BankRules> = {}): BankRules {
  return { ...DEFAULT_RULES, ...over };
}

export interface Played {
  readonly state: BankState;
  readonly events: readonly BankEvent[];
}

/** Test drivers bound to one engine `m`. Every accepted action is checked pure and sound for that engine. */
export function engine(m: BankModule) {
  function setup(seats = 3, gameRules: BankRules = DEFAULT_RULES): BankState {
    const result = m.setup({ rules: gameRules, seats, mode: 'full', deckOrders: {} });
    if (!result.ok) throw new Error(result.error.message);
    expect(m.invariants?.(result.value)).toEqual([]);
    return result.value;
  }

  /** Applies one action, asserting it is accepted, pure and sound. */
  function act(s: BankState, action: unknown): Played {
    const before = JSON.stringify(s);
    const result = m.apply(s, action);
    if (!result.ok) {
      throw new Error(`rejected ${JSON.stringify(action)}: ${result.error.code} ${result.error.message}`);
    }
    expect(JSON.stringify(s)).toBe(before);
    expect(m.invariants?.(result.state)).toEqual([]);
    return { state: result.state, events: result.events };
  }

  function rejects(s: BankState, action: unknown, code: string): void {
    const before = JSON.stringify(s);
    const result = m.apply(s, action);
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
  function toRoller(s: BankState): BankState {
    let state = s;
    while (state.phase === 'call') {
      const pending = m.pending(state);
      if (pending.type !== 'player' || pending.seat === state.roller) return state;
      state = act(state, { type: 'stay', actor: pending.seat }).state;
    }
    return state;
  }

  /**
   * From a call window, roll `dice` and resolve them. Other seats stay; with engine 0.1.0 they then contribute
   * in turn. With engine 0.2.0 the beacon pends at once (the session folds the contributions).
   */
  function playRoll(s: BankState, dice: readonly [number, number]): Played {
    let state = toRoller(s);
    const id = state.nextRollId;
    const roller = state.roller;
    state = act(state, { type: 'roll', actor: roller, rollId: id }).state;
    while (state.phase === 'collect') {
      const seat = state.owe[0] as number;
      state = act(state, { type: 'contribute', actor: seat, rollId: id }).state;
    }
    expect(state.phase).toBe('beacon');
    expect(m.pending(state)).toEqual({ type: 'beacon', id });
    return act(state, { type: 'rolled', actor: 'beacon', id, dice: [dice[0], dice[1]] });
  }

  /**
   * End the open round with a bust, so nobody is paid. Rolls that are still safe add 2. An empty pot is not
   * banked: a round with no roll yet has to be rolled before it can end.
   */
  function bustRound(s: BankState): BankState {
    let state = s;
    const round = s.round;
    while (state.round === round && state.phase === 'call') {
      const dice: readonly [number, number] = state.rolls >= 3 ? [1, 6] : [1, 1];
      state = playRoll(state, dice).state;
    }
    return state;
  }

  /** Bank whenever the pending seat may. Stops when this round ends or the dice must be rolled. */
  function bankTheRound(s: BankState): BankState {
    let state = s;
    const round = s.round;
    while (state.phase === 'call' && state.round === round) {
      const pending = m.pending(state);
      if (pending.type !== 'player') break;
      const bankAction = m
        .legalActions(state, pending.seat)
        .find((action) => (action as { type?: string }).type === 'bank');
      if (bankAction === undefined) break;
      state = act(state, bankAction).state;
    }
    return state;
  }

  return { setup, act, rejects, toRoller, playRoll, bustRound, bankTheRound };
}
