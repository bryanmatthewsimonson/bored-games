import type { GameModule, Learn, SetupInput } from '@bored-games/game-kit';
import { DECK_SIZES, type DeckId, TIER_DECKS } from './data.ts';
import { luster as core } from './module.ts';
import type { LusterEvent, LusterRules, LusterState } from './types.ts';

/** Four logical decks in one encrypted packet; each group has a separate shuffle proof. */
export const LUSTER_DECK = {
  id: 'glass',
  size: 100,
  // Owner-authorized Luster-only exception to D050; other games keep turn-piggybacked shares.
  promptShares: true,
  partitions: [...TIER_DECKS, 'patrons'].map((id) => ({ id, size: DECK_SIZES[id as DeckId] })),
};
export const DECK_OFFSETS: Readonly<Record<DeckId, number>> = {
  'tier-1': 0,
  'tier-2': 40,
  'tier-3': 70,
  patrons: 90,
};
function logical(pos: number): DeckId | null {
  if (!Number.isSafeInteger(pos) || pos < 0 || pos >= 100) return null;
  return pos < 40 ? 'tier-1' : pos < 70 ? 'tier-2' : pos < 90 ? 'tier-3' : 'patrons';
}
function physical(l: Learn): Learn {
  return {
    deck: 'glass',
    pos: DECK_OFFSETS[l.deck as DeckId] + l.pos,
    card: DECK_OFFSETS[l.deck as DeckId] + l.card,
  };
}
function setup(input: SetupInput<LusterRules>) {
  try {
    if (input.mode === 'view') return core.setup(input);
    const order = input.deckOrders.glass;
    if (!Array.isArray(order) || order.length !== 100)
      return { ok: false as const, error: { code: 'deck', message: 'Invalid glass deck.' } };
    const deckOrders = Object.fromEntries(
      LUSTER_DECK.partitions.map((p) => [
        p.id,
        order
          .slice(DECK_OFFSETS[p.id as DeckId], DECK_OFFSETS[p.id as DeckId] + p.size)
          .map((card) => card - DECK_OFFSETS[p.id as DeckId]),
      ]),
    );
    return core.setup({ ...input, deckOrders });
  } catch {
    return { ok: false as const, error: { code: 'setup', message: 'Invalid glass setup.' } };
  }
}
export const lusterNostr: GameModule<LusterState, LusterEvent, LusterRules> = {
  ...core,
  decks: () => [LUSTER_DECK],
  setup,
  pending: (s) => {
    const p = core.pending(s);
    return p.type === 'reveal'
      ? { ...p, deck: 'glass', positions: p.positions.map((pos) => DECK_OFFSETS[p.deck as DeckId] + pos) }
      : p;
  },
  apply: (s, raw) => {
    try {
      if (raw !== null && typeof raw === 'object' && 'type' in raw && raw.type === 'reveal') {
        const a = raw as Record<string, unknown>;
        const deck = logical(a.pos as number);
        if (a.deck !== 'glass' || deck === null || typeof a.card !== 'number' || logical(a.card) !== deck)
          return { ok: false as const, error: { code: 'reveal', message: 'Reveal is outside its tier.' } };
        return core.apply(s, {
          ...a,
          deck,
          pos: (a.pos as number) - DECK_OFFSETS[deck],
          card: a.card - DECK_OFFSETS[deck],
        });
      }
      return core.apply(s, raw);
    } catch {
      return { ok: false as const, error: { code: 'action', message: 'Invalid action.' } };
    }
  },
  dealt: (s) =>
    core.dealt(s).map((d) => ({ ...d, deck: 'glass', pos: DECK_OFFSETS[d.deck as DeckId] + d.pos })),
  knownTo: (s, seat) => core.knownTo(s, seat).map(physical),
  revealsOf: (s, a) => core.revealsOf(s, a).map(physical),
  learn: (s, l) => {
    const deck = logical(l.pos);
    if (l.deck !== 'glass' || deck === null || logical(l.card) !== deck)
      return { ok: false as const, error: { code: 'learn', message: 'Private card is outside its tier.' } };
    return core.learn(s, { deck, pos: l.pos - DECK_OFFSETS[deck], card: l.card - DECK_OFFSETS[deck] });
  },
};
