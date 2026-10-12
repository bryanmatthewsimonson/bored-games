import type { GameModule } from '@bored-games/game-kit';
import { installDeckOrder, shufflePlaintexts } from './charters.ts';
import {
  applyAction,
  beaconFor,
  DEFAULT_RULES,
  legalActions,
  PILE,
  parseAction,
  pendingOf,
  rollShapeOf,
  setupGame,
  validateRules,
} from './engine.ts';
import { checkInvariants, coverageOf } from './invariants.ts';
import type { HazardAction, HazardEvent, HazardRules, HazardState } from './types.ts';
import { knownTo, learnCard, viewOf } from './view.ts';

/**
 * Whether `a` is an offered muster or march with another troop count. The list offers only 1 and the most; any
 * count between is as legal, and `apply` checks it. Every other move must be one the list offers exactly.
 */
function widens(legal: readonly HazardAction[], a: HazardAction): boolean {
  if (a.type === 'muster') return legal.some((b) => b.type === 'muster' && b.province === a.province);
  if (a.type === 'march') return legal.some((b) => b.type === 'march' && b.from === a.from && b.to === a.to);
  return false;
}

export const HAZARD_ID = 'hazard';
export const HAZARD_VERSION = '0.1.0';

/** Hazard (D088): dice from the beacon (D058) and one charter deck with prompt shares (D075). */
export const hazard: GameModule<HazardState, HazardEvent, HazardRules> = {
  id: HAZARD_ID,
  version: HAZARD_VERSION,
  defaultRules: () => DEFAULT_RULES,
  validateRules,
  seatRange: () => ({ min: 3, max: 6 }),
  decks: () => [PILE],
  setup: setupGame,
  pending: pendingOf,
  legalActions,
  apply: applyAction,
  validateIntent: (s, seat, raw) => {
    const a = parseAction(raw);
    if (a === null || a.actor !== seat)
      return { ok: false, error: { code: 'actor', message: 'Use your own seat.' } };
    if (!widens(legalActions(s, seat), a))
      return { ok: false, error: { code: 'intent', message: 'Choose one of the offered moves.' } };
    const r = applyAction(s, a);
    return r.ok ? { ok: true, value: a } : r;
  },
  learn: learnCard,
  knownTo,
  view: viewOf,
  outcome: (s) => s.result,
  standings: (s) => Array.from({ length: s.seats }, (_, seat) => s.owner.filter((o) => o === seat).length),
  dealt: (s) => s.dealt,
  revealsOf: () => [],
  invariants: checkInvariants,
  coverage: coverageOf,
  rolls: (s) => s.rolls,
  beaconOf: beaconFor,
  rollShape: rollShapeOf,
  installDeckOrder,
  shufflePlaintexts,
  resignAllowed: () => false,
};
