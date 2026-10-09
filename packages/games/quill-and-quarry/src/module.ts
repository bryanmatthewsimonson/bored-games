import type { GameModule } from '@bored-games/game-kit';
import {
  apply,
  DEFAULT_RULES,
  installDeckOrder,
  invariants,
  knownTo,
  learn,
  legalActions,
  parseAction,
  pending,
  revealsOf,
  setup,
  shufflePlaintexts,
  validateRules,
  view,
} from './engine.ts';
import type { Event, Rules, State } from './types.ts';
export const quillAndQuarry: GameModule<State, Event, Rules> = {
  id: 'quill-and-quarry',
  version: '0.1.0',
  defaultRules: () => ({ ...DEFAULT_RULES }),
  validateRules,
  seatRange: () => ({ min: 2, max: 4 }),
  decks: () => [{ id: 'pile', size: 100, promptShares: true }],
  setup,
  pending,
  legalActions,
  apply,
  learn,
  knownTo,
  view,
  outcome: (s) => s.result,
  standings: (s) => s.result?.scores ?? s.scores,
  dealt: (s) => s.dealt,
  revealsOf,
  invariants,
  installDeckOrder,
  shufflePlaintexts,
  handsReveal: (s) => s.phase === 'ending',
  resignAllowed: () => false,
  validateIntent: (s, seat, raw) => {
    const a = parseAction(raw);
    if (!a || a.actor !== seat) return { ok: false, error: { code: 'actor', message: 'Use your own seat.' } };
    const r = apply(s, a);
    return r.ok ? { ok: true, value: a } : r;
  },
  coverage: (_s, events) => events.map((e) => `move:${e.type}`),
};
