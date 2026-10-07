/*
 * `DeckSpec.promptShares` (game-kit types.ts) switches on the session's automatic share and seal duties in play. Any
 * game may set it: a standing exception to D050 (D075) until the relay referee dealer prevents cheating. This records
 * which registered games set it, so that adding or dropping the flag shows up in review; the repo guard
 * (tests/repo-guards.test.ts) keeps the flag out of code that is not a game module.
 */
import { describe, expect, it } from 'vitest';
import { MODULES } from '../src/net.ts';

/** The registered games whose decks set `promptShares`. Any game may (D075); this list only records which do. */
const PROMPT_SHARES_USED: readonly string[] = ['luster', 'right-of-way', 'driftwrights', 'room-for-doubt'];

describe('promptShares record (D075)', () => {
  for (const [id, module] of MODULES) {
    it(`${id}: ${PROMPT_SHARES_USED.includes(id) ? 'sets' : 'does not set'} promptShares`, () => {
      const decks = module.decks(module.defaultRules()) as readonly { id: string; promptShares?: boolean }[];
      const flagged = decks.filter((d) => d.promptShares === true).map((d) => d.id);
      if (PROMPT_SHARES_USED.includes(id)) expect(flagged.length).toBeGreaterThan(0);
      else expect(flagged, `${id} sets promptShares on ${flagged.join(', ')}: record it here`).toEqual([]);
    });
  }

  it('records only registered modules', () => {
    for (const id of PROMPT_SHARES_USED) expect(MODULES.has(id), id).toBe(true);
  });
});
