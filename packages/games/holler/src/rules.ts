import type { Result } from '@bored-games/game-kit';

/** Holler has no table options. The seat count is the only setup choice, and it is not part of the rules object. */
export interface HollerRules {
  readonly rulesVersion: 1;
}

export const DEFAULT_RULES: HollerRules = { rulesVersion: 1 };

const fail = (message: string): Result<HollerRules> => ({
  ok: false,
  error: { code: 'rules', message },
});

export function validateRules(input: unknown): Result<HollerRules> {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return fail('rules must be an object');
  const rules = input as Record<string, unknown>;
  const keys = Object.keys(rules);
  if (keys.length !== 1 || !Object.hasOwn(rules, 'rulesVersion'))
    return fail('rules must have exactly rulesVersion');
  if (rules.rulesVersion !== 1) return fail('rulesVersion must be 1');
  return { ok: true, value: { rulesVersion: 1 } };
}
