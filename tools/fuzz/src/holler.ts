import type { FuzzPolicy } from '@bored-games/game-kit';
import type { HollerState } from '@bored-games/holler';

/**
 * Fuzzing policies for Holler. Test drivers only, never players:
 * - uniform: a uniformly random legal action;
 * - caller: prefers a declaration and never challenges while another action is legal.
 */

function declares(action: unknown): boolean {
  return action !== null && typeof action === 'object' && (action as { holler?: boolean }).holler === true;
}

function isChallenge(action: unknown): boolean {
  return action !== null && typeof action === 'object' && (action as { type?: string }).type === 'challenge';
}

export const HOLLER_POLICIES: readonly FuzzPolicy<HollerState>[] = [
  {
    name: 'uniform',
    choose: (_state, _seat, legal, rng) => rng.pick(legal),
  },
  {
    name: 'caller',
    choose(_state, _seat, legal, rng) {
      const declared = legal.filter(declares);
      if (declared.length > 0) return rng.pick(declared);
      const calm = legal.filter((action) => !isChallenge(action));
      return rng.pick(calm.length > 0 ? calm : legal);
    },
  },
];

/** Tags a long run must actually hit. */
export const HOLLER_EXPECTED_COVERAGE: readonly string[] = [
  'starter:levy',
  'starter:swing2',
  'challenge:clean',
  'challenge:unclean',
  'holler',
  'catch',
  'reshuffle',
  'empty-draw',
  'score:500',
  'resume',
];
