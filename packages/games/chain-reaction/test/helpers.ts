import { expect } from 'vitest';
import {
  applyAction,
  type ChainReactionAction,
  type ChainReactionEvent,
  type ChainReactionRules,
  type ChainReactionState,
  checkInvariants,
  DEFAULT_RULES,
  endCondition,
  LOOSE,
  TILE_COUNT,
  tileColumn,
  tileId,
  tileIndex,
  tileRow,
} from '../src/index.ts';

/** Parses "1A-5A 7C 5A-5D" into tile indices (ranges run along one row or one column). */
export function tiles(spec: string): number[] {
  const out: number[] = [];
  for (const part of spec.split(/[\s,]+/).filter(Boolean)) {
    const [a, b] = part.split('-');
    const from = tileIndex(a);
    if (from === null) throw new Error(`bad tile ${a}`);
    if (b === undefined) {
      out.push(from);
      continue;
    }
    const to = tileIndex(b);
    if (to === null) throw new Error(`bad tile ${b}`);
    if (tileRow(from) === tileRow(to)) {
      for (let c = tileColumn(from); c <= tileColumn(to); c++) out.push(tileRow(from) * 12 + c - 1);
    } else if (tileColumn(from) === tileColumn(to)) {
      for (let r = tileRow(from); r <= tileRow(to); r++) out.push(r * 12 + tileColumn(from) - 1);
    } else throw new Error(`range ${part} must share a row or column`);
  }
  return out;
}

export interface ScenarioSpec {
  readonly seats?: number;
  readonly rules?: Partial<ChainReactionRules>;
  /** Chain id -> tile spec. */
  readonly chains?: Readonly<Record<string, string>>;
  readonly loose?: string;
  /** One tile spec per seat (hands may hold fewer than 6). */
  readonly hands?: readonly string[];
  /** Chain id -> holdings per seat. Unspecified holdings are 0. */
  readonly shares?: Readonly<Record<string, readonly number[]>>;
  readonly cash?: readonly number[];
  readonly turn?: number;
  readonly phase?: 'place' | 'buy';
  /** Tiles at the front of the bag, in draw order. */
  readonly bag?: string;
  /** Put every tile not otherwise placed in the discard pile (so the bag holds only `bag`). */
  readonly emptyBag?: boolean;
  /**
   * Give 1 share of each active chain nobody holds to the last seat, so the
   * state satisfies "every chain on the board has a shareholder". Default true.
   */
  readonly autoHolders?: boolean;
}

/** Builds a full-mode mid-game state. Throws if the result violates an invariant. */
export function scenario(spec: ScenarioSpec): ChainReactionState {
  const seats = spec.seats ?? 3;
  const rules: ChainReactionRules = { ...DEFAULT_RULES, ...spec.rules };
  const chainCount = rules.chains.length;
  const board: (number | null)[] = new Array(TILE_COUNT).fill(null);
  const used = new Set<number>();
  const claim = (t: number): void => {
    if (used.has(t)) throw new Error(`tile ${tileId(t)} used twice`);
    used.add(t);
  };
  for (const [id, spec_] of Object.entries(spec.chains ?? {})) {
    const c = rules.chains.findIndex((x) => x.id === id);
    if (c < 0) throw new Error(`unknown chain ${id}`);
    for (const t of tiles(spec_)) {
      claim(t);
      board[t] = c;
    }
  }
  for (const t of tiles(spec.loose ?? '')) {
    claim(t);
    board[t] = LOOSE;
  }
  const onBoard = board.flatMap((c, t) => (c === null ? [] : [t]));
  if (onBoard.length < seats)
    throw new Error('scenario needs at least one board tile per seat (setup tiles)');
  const setupTiles = onBoard.slice(0, seats);
  const otherBoard = onBoard.slice(seats);
  const hands = Array.from({ length: seats }, (_, s) => tiles(spec.hands?.[s] ?? ''));
  for (const h of hands) for (const t of h) claim(t);
  const bagFront = tiles(spec.bag ?? '');
  for (const t of bagFront) claim(t);
  const rest = Array.from({ length: TILE_COUNT }, (_, t) => t).filter((t) => !used.has(t));
  const discard = spec.emptyBag ? rest : [];
  const bagRest = spec.emptyBag ? [] : rest;

  const order: number[] = [...setupTiles, ...otherBoard, ...discard];
  const handSlots = hands.map((h) =>
    h.map((t) => {
      order.push(t);
      return { pos: order.length - 1, tile: t };
    }),
  );
  const next = order.length;
  order.push(...bagFront, ...bagRest);

  const shares = Array.from({ length: seats }, () => new Array<number>(chainCount).fill(0));
  for (const [id, holdings] of Object.entries(spec.shares ?? {})) {
    const c = rules.chains.findIndex((x) => x.id === id);
    if (c < 0) throw new Error(`unknown chain ${id}`);
    holdings.forEach((n, s) => {
      (shares[s] as number[])[c] = n;
    });
  }
  if (spec.autoHolders ?? true) {
    for (let c = 0; c < chainCount; c++) {
      const active = board.includes(c);
      if (active && shares.every((p) => p[c] === 0)) (shares[seats - 1] as number[])[c] = 1;
    }
  }
  const bank = rules.chains.map(
    (_, c) => rules.sharesPerChain - shares.reduce((sum, p) => sum + (p[c] ?? 0), 0),
  );
  const phase = spec.phase ?? 'place';
  const turnSeat = spec.turn ?? 0;
  const state: ChainReactionState = {
    game: 'chain-reaction',
    rules,
    seats,
    mode: 'full',
    viewer: null,
    deck: { order, next },
    setupTiles,
    board,
    players: Array.from({ length: seats }, (_, s) => ({
      cash: spec.cash?.[s] ?? rules.startingCash,
      shares: shares[s] as number[],
      hand: handSlots[s] ?? [],
    })),
    bank,
    discard: discard.slice().sort((a, b) => a - b),
    firstPlayer: 0,
    turn: { seat: turnSeat, number: 10, endCondition: endCondition(board, rules) },
    phase: { kind: phase },
    result: null,
    seq: 0,
  };
  const violations = checkInvariants(state);
  if (violations.length > 0) throw new Error(`invalid scenario: ${violations.join('; ')}`);
  return state;
}

export interface Step {
  readonly state: ChainReactionState;
  readonly events: readonly ChainReactionEvent[];
}

/** Applies an action that must succeed and leave a sound state. */
export function act(state: ChainReactionState, action: unknown): Step {
  const res = applyAction(state, action);
  if (!res.ok) throw new Error(`rejected ${JSON.stringify(action)}: ${res.error.code} ${res.error.message}`);
  expect(checkInvariants(res.state)).toEqual([]);
  return { state: res.state, events: res.events };
}

/** Applies a sequence of actions that must all succeed. */
export function run(state: ChainReactionState, actions: readonly unknown[]): Step {
  let step: Step = { state, events: [] };
  const events: ChainReactionEvent[] = [];
  for (const a of actions) {
    step = act(step.state, a);
    events.push(...step.events);
  }
  return { state: step.state, events };
}

/** Asserts that an action is rejected, optionally with a given error code. */
export function rejects(state: ChainReactionState, action: unknown, code?: string): void {
  const res = applyAction(state, action);
  expect(res.ok, `expected rejection of ${JSON.stringify(action)}`).toBe(false);
  if (!res.ok && code) expect(res.error.code).toBe(code);
}

export function posOf(state: ChainReactionState, seat: number, tile: string): number {
  const t = tileIndex(tile);
  const slot = state.players[seat]?.hand.find((h) => h.tile === t);
  if (!slot) throw new Error(`seat ${seat} does not hold ${tile}`);
  return slot.pos;
}

export function place(state: ChainReactionState, seat: number, tile: string): ChainReactionAction {
  return { type: 'place', actor: seat, pos: posOf(state, seat, tile), tile };
}

export function endTurn(
  seat: number,
  opts: { buy?: string[]; declareEnd?: boolean; discard?: { pos: number; tile: string }[] } = {},
): ChainReactionAction {
  return {
    type: 'endTurn',
    actor: seat,
    buy: opts.buy ?? [],
    declareEnd: opts.declareEnd ?? false,
    discard: opts.discard ?? [],
  };
}

export function dispose(seat: number, chain: string, sell: number, trade: number): ChainReactionAction {
  return { type: 'dispose', actor: seat, chain, sell, trade };
}

export function sizeOf(state: ChainReactionState, chain: string): number {
  const c = state.rules.chains.findIndex((x) => x.id === chain);
  return state.board.filter((x) => x === c).length;
}

export function chainTiles(state: ChainReactionState, chain: string): string[] {
  const c = state.rules.chains.findIndex((x) => x.id === chain);
  return state.board.flatMap((x, t) => (x === c ? [tileId(t)] : []));
}

export function cellOf(state: ChainReactionState, tile: string): number | null {
  return state.board[tileIndex(tile) as number] ?? null;
}

export function sharesOf(state: ChainReactionState, seat: number, chain: string): number {
  const c = state.rules.chains.findIndex((x) => x.id === chain);
  return state.players[seat]?.shares[c] ?? 0;
}

export function bankOf(state: ChainReactionState, chain: string): number {
  const c = state.rules.chains.findIndex((x) => x.id === chain);
  return state.bank[c] ?? 0;
}

export function cash(state: ChainReactionState): number[] {
  return state.players.map((p) => p.cash);
}

export function ofType<T extends ChainReactionEvent['type']>(
  events: readonly ChainReactionEvent[],
  type: T,
): Extract<ChainReactionEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<ChainReactionEvent, { type: T }>[];
}
