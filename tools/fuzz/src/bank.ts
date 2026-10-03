import type { BankState } from '@bored-games/bank';
import type { FuzzPolicy, Rng } from '@bored-games/game-kit';

/**
 * Fuzzing policies for Bank. Test drivers only, never players:
 * - random: a uniformly random legal action;
 * - cautious: after the safe rolls, bank once the pot is at least 20;
 * - greedy: bank only at 100, or when this seat is the last one still in;
 * - stubborn: never bank, so a round can reach the 30-roll cap.
 */

function isBank(action: unknown): boolean {
  return action !== null && typeof action === 'object' && (action as { type?: string }).type === 'bank';
}

function others(legal: readonly unknown[], rng: Rng): unknown {
  const rest = legal.filter((action) => !isBank(action));
  return rng.pick(rest.length > 0 ? rest : legal);
}

function stillIn(s: BankState): number {
  return s.inRound.filter(Boolean).length;
}

export const BANK_POLICIES: readonly FuzzPolicy<BankState>[] = [
  {
    name: 'random',
    choose: (_s, _seat, legal, rng) => rng.pick(legal),
  },
  {
    name: 'cautious',
    choose(s, _seat, legal, rng) {
      const bank = legal.find(isBank);
      if (bank !== undefined && s.rolls >= 3 && s.pot >= 20) return bank;
      return others(legal, rng);
    },
  },
  {
    name: 'greedy',
    choose(s, _seat, legal, rng) {
      const bank = legal.find(isBank);
      if (bank !== undefined && (s.pot >= 100 || stillIn(s) === 1)) return bank;
      return others(legal, rng);
    },
  },
  {
    name: 'stubborn',
    choose: (_s, _seat, legal, rng) => others(legal, rng),
  },
];

/** Tags the 10,000-game run must actually hit. */
export const BANK_EXPECTED_COVERAGE: readonly string[] = [
  'roll:safe7',
  'roll:bust',
  'roll:double',
  'bank:shared',
  'round:all-banked',
  'round:cap',
  'end:score',
];
