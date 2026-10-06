import { type DeckSpec, deepFreeze, type Rng, range, shuffle } from '@bored-games/game-kit';
import { expect } from 'vitest';
import { CHARTER_OFFSET, DECK_ID, DECK_SIZE, FREIGHT_SIZE, GROUPS } from '../src/deck.ts';
import { pendingOf } from '../src/engine.ts';
import { rightOfWay } from '../src/module.ts';
import type { RowAction, RowState } from '../src/types.ts';

/** A packet order that shuffles each group within itself, as the partitioned shuffle does. */
export function railOrder(_deck: DeckSpec, rng: Rng): number[] {
  return GROUPS.flatMap((g) =>
    shuffle(
      range(g.size).map((n) => n + g.offset),
      rng,
    ),
  );
}

/** The identity packet order (position p holds card p), with `swaps` applied: [position, card] pairs. */
export function orderWith(swaps: readonly (readonly [number, number])[] = []): number[] {
  const order = range(DECK_SIZE);
  for (const [pos, card] of swaps) {
    const at = order.indexOf(card);
    const held = order[pos] as number;
    order[pos] = card;
    order[at] = held;
  }
  return order;
}

/** Freight cards by colour: the k-th card (0-based) of colour c (0–7), or the k-th Engine (c = 8). */
export const card = (c: number, k = 0): number => (c === 8 ? 96 + k : c * 12 + k);

export function setup(seats: number, order: readonly number[] = orderWith()): RowState {
  const r = rightOfWay.setup({
    rules: { map: 'ferrovia' },
    seats,
    mode: 'full',
    deckOrders: { [DECK_ID]: order },
  });
  if (!r.ok) throw new Error(r.error.message);
  return settle(deepFreeze(r.value));
}

/** Apply an action that must be accepted, then the public reveals it leads to. */
export function act(s: RowState, action: unknown): RowState {
  const r = rightOfWay.apply(s, action);
  if (!r.ok) throw new Error(`${JSON.stringify(action)}: ${r.error.message}`);
  return settle(deepFreeze(r.state));
}

/** An action's rejection message, or null when it is accepted. */
export function refused(s: RowState, action: unknown): string | null {
  const r = rightOfWay.apply(s, action);
  return r.ok ? null : r.error.message;
}

/** Apply pending public reveals from the deck order. */
export function settle(s: RowState): RowState {
  let t = s;
  for (let i = 0; i < 1000; i++) {
    const p = pendingOf(t);
    if (p.type !== 'reveal') return t;
    const pos = p.positions[0] as number;
    const r = rightOfWay.apply(t, {
      type: 'reveal',
      actor: 'deck',
      deck: DECK_ID,
      pos,
      card: t.order?.[pos],
    });
    if (!r.ok) throw new Error(`reveal ${pos}: ${r.error.message}`);
    t = deepFreeze(r.state);
  }
  throw new Error('reveals did not settle');
}

/** Every seat keeps all three first charters, in turn. */
export function keepAll(s: RowState): RowState {
  let t = s;
  while (t.phase === 'keep') t = act(t, { type: 'keep', actor: t.turn, keep: [0, 1, 2] });
  return t;
}

/** A game in its first turn, every seat keeping all its charters. */
export const started = (seats: number, order?: readonly number[]): RowState => keepAll(setup(seats, order));

/** The legal actions of the seat to act. */
export const legal = (s: RowState): RowAction[] => rightOfWay.legalActions(s, s.turn) as RowAction[];

export function only<T extends RowAction['type']>(s: RowState, type: T): Extract<RowAction, { type: T }>[] {
  return legal(s).filter((a): a is Extract<RowAction, { type: T }> => a.type === type);
}

/** Replace a seat's hand with the given freight cards (full mode, test set-up only). */
export function withHand(s: RowState, seat: number, cards: readonly number[]): RowState {
  const order = s.order as number[];
  return deepFreeze({
    ...s,
    players: s.players.map((p, i) =>
      i === seat ? { ...p, hand: cards.map((c) => ({ pos: order.indexOf(c), card: c, open: false })) } : p,
    ),
  });
}

export const charterCard = (t: number): number => CHARTER_OFFSET + t;
export { FREIGHT_SIZE, GROUPS };

export function expectOk(s: RowState): void {
  expect(rightOfWay.invariants(s)).toEqual([]);
}
