// biome-ignore-all lint/style/noNonNullAssertion: constructed test fixtures use known seats and positions.
import { range } from '@bored-games/game-kit';
import { DECK_SIZES, type DeckId, TIER_DECKS } from '../src/data.ts';
import { luster } from '../src/module.ts';
import type { LusterPlayer, LusterRules, LusterState } from '../src/types.ts';
export const ORDERS = Object.fromEntries(
  (Object.keys(DECK_SIZES) as DeckId[]).map((id) => [id, range(DECK_SIZES[id])]),
);
export function step(s: LusterState, a: unknown): LusterState {
  const r = luster.apply(s, a);
  if (!r.ok) throw new Error(r.error.message);
  return r.state;
}
export function revealAll(s: LusterState): LusterState {
  for (;;) {
    const p = luster.pending(s);
    if (p.type !== 'reveal') return s;
    s = step(s, {
      type: 'reveal',
      actor: 'deck',
      deck: p.deck,
      pos: p.positions[0],
      card: ORDERS[p.deck]?.[p.positions[0]!],
    });
  }
}
/** The `any` gem rule (fewer colors at any time), for tests whose filler moves take a single gem. */
export const ANY: LusterRules = { target: 15, gems: 'any' };
export function ready(seats = 2, rules: LusterRules = luster.defaultRules()): LusterState {
  const r = luster.setup({ rules, seats, mode: 'full', deckOrders: ORDERS });
  if (!r.ok) throw new Error(r.error.message);
  return revealAll(r.value);
}
export function holding(s: LusterState, seat: number, tokens: number[]): LusterState {
  return {
    ...s,
    players: s.players.map((p, i) => (i === seat ? { ...p, tokens } : p)),
    supply: s.supply.map((n, i) => n + s.players[seat]!.tokens[i]! - tokens[i]!),
  };
}
/** Explicit constructed positions for rule edge cases; full-play conservation is checked by fuzz tests. */
export function player(s: LusterState, seat: number, patch: Partial<LusterPlayer>): LusterState {
  return { ...s, players: s.players.map((p, i) => (i === seat ? { ...p, ...patch } : p)) };
}
export function collection(counts: readonly number[]) {
  return counts.flatMap((n, bonus) =>
    range(n).map((i) => ({
      deck: TIER_DECKS[0]!,
      pos: bonus * 8 + i,
      card: bonus === 0 ? 24 + i : bonus === 1 ? i : bonus === 2 ? 32 + i : bonus === 3 ? 8 + i : 16 + i,
      private: false,
    })),
  );
}
