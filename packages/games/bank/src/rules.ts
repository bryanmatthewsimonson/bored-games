import type { Result } from '@bored-games/game-kit';

/**
 * Bank rule options. A round cannot run forever: `maxRollsPerRound` ends it (D015, D058). Values marked OPEN in
 * docs/games/bank/RULES.md are not options yet.
 */
export interface BankRules {
  /** Version of these rules; bumped when an option's meaning changes. */
  readonly rulesVersion: 1;
  /** How many rounds are played. */
  readonly rounds: 5 | 10 | 20;
  /**
   * `table`: between rolls, every player still in may bank, asked in seat order with the roller last.
   * `turn`: only the roller may bank, and only before rolling.
   */
  readonly banking: 'table' | 'turn';
  /** After this many resolutions in one round, everyone still in banks and the round ends. */
  readonly maxRollsPerRound: 30;
}

export const ROUND_CHOICES = [5, 10, 20] as const;
export const BANKING_CHOICES = ['table', 'turn'] as const;

export const DEFAULT_RULES: BankRules = {
  rulesVersion: 1,
  rounds: 10,
  banking: 'table',
  maxRollsPerRound: 30,
};

const KEYS = ['rulesVersion', 'rounds', 'banking', 'maxRollsPerRound'] as const;

const fail = (message: string): Result<BankRules> => ({ ok: false, error: { code: 'rules', message } });

export function validateRules(input: unknown): Result<BankRules> {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return fail('rules must be an object');
  const r = input as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== KEYS.length || KEYS.some((key) => !Object.hasOwn(r, key)))
    return fail('rules must have exactly rulesVersion, rounds, banking and maxRollsPerRound');
  if (r.rulesVersion !== 1) return fail('rulesVersion must be 1');
  if (r.rounds !== 5 && r.rounds !== 10 && r.rounds !== 20) return fail('rounds must be 5, 10 or 20');
  if (r.banking !== 'table' && r.banking !== 'turn') return fail("banking must be 'table' or 'turn'");
  if (r.maxRollsPerRound !== 30) return fail('maxRollsPerRound must be 30');
  return {
    ok: true,
    value: { rulesVersion: 1, rounds: r.rounds, banking: r.banking, maxRollsPerRound: 30 },
  };
}
