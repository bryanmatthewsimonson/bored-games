import type { Result } from '@bored-games/game-kit';

/**
 * Chess rule options. Values marked OPEN in docs/games/chess/RULES.md are
 * options here with a single supported value for now.
 */
export interface ChessRules {
  /** Version of these rules; bumped when an option's meaning changes. */
  readonly rulesVersion: 1;
  /**
   * How draws other than agreement happen. 'auto': stalemate, threefold
   * repetition, the fifty-move rule and insufficient material end the game at
   * once. A FIDE-style claim mode is OPEN.
   */
  readonly drawMode: 'auto';
}

export const DEFAULT_RULES: ChessRules = { rulesVersion: 1, drawMode: 'auto' };

const fail = (message: string): Result<ChessRules> => ({ ok: false, error: { code: 'rules', message } });

export function validateRules(input: unknown): Result<ChessRules> {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return fail('rules must be an object');
  const r = input as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== 2 || !Object.hasOwn(r, 'rulesVersion') || !Object.hasOwn(r, 'drawMode'))
    return fail('rules must have exactly rulesVersion and drawMode');
  if (r.rulesVersion !== 1) return fail('rulesVersion must be 1');
  if (r.drawMode !== 'auto') return fail("drawMode must be 'auto'");
  return { ok: true, value: { rulesVersion: 1, drawMode: 'auto' } };
}
