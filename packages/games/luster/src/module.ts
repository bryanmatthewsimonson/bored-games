import type { GameModule, Learn } from '@bored-games/game-kit';
import { DECK_SIZES, type DeckId, TIER_DECKS, workshop } from './data.ts';
import {
  applyAction,
  DEFAULT_RULES,
  learnCard,
  legalActions,
  parseAction,
  pendingOf,
  score,
  setupGame,
  validateRules,
} from './engine.ts';
import { checkInvariants } from './invariants.ts';
import type { LusterEvent, LusterRules, LusterState } from './types.ts';

export const LUSTER_ID = 'luster';
export const LUSTER_VERSION = '0.2.0';
export function revealsOf(s: LusterState, raw: unknown): Learn[] {
  const a = parseAction(raw);
  if (a?.type !== 'buy') return [];
  const h = s.players[a.actor]?.reserved.find((h) => h.private && h.deck === a.deck && h.pos === a.pos);
  return h && workshop(a.deck, a.card) ? [{ deck: a.deck, pos: a.pos, card: a.card }] : [];
}
export const luster: GameModule<LusterState, LusterEvent, LusterRules> = {
  id: LUSTER_ID,
  version: LUSTER_VERSION,
  // Runs unchanged under both protocols (PROTOCOL-v2 §2 item 6).
  protocols: [1, 2],
  defaultRules: () => DEFAULT_RULES,
  validateRules,
  seatRange: () => ({ min: 2, max: 4 }),
  decks: () => ([...TIER_DECKS, 'patrons'] as DeckId[]).map((id) => ({ id, size: DECK_SIZES[id] })),
  setup: setupGame,
  pending: pendingOf,
  legalActions,
  apply: applyAction,
  learn: learnCard,
  knownTo: (s, seat) =>
    (s.players[seat]?.reserved ?? []).flatMap((h) =>
      h.private && h.card !== null ? [{ deck: h.deck, pos: h.pos, card: h.card }] : [],
    ),
  view: (s, viewer) => ({
    ...s,
    mode: 'view',
    viewer,
    decks: {
      'tier-1': { ...s.decks['tier-1'], order: null },
      'tier-2': { ...s.decks['tier-2'], order: null },
      'tier-3': { ...s.decks['tier-3'], order: null },
      patrons: { ...s.decks.patrons, order: null },
    },
    players: s.players.map((p, seat) => ({
      ...p,
      reserved: p.reserved.map((h) => (h.private && seat !== viewer ? { ...h, card: null } : h)),
    })),
  }),
  dealt: (s) => s.dealt,
  revealsOf,
  outcome: (s) => s.result,
  standings: (s) => s.players.map(score),
  invariants: checkInvariants,
  // Public refills during play require a separate Resign protocol review before opting in.
  resignAllowed: () => false,
  coverage: (_s, events) => events.map((e) => `move:${e.action.type}`),
};
