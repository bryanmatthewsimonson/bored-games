/*
 * `DeckSpec.promptShares` (game-kit types.ts) switches on the session's automatic share duty in play, an
 * owner-authorized exception to D050 for Luster (D059 item 8) and Right of Way (D066). Every other game keeps turn-piggybacked
 * shares (PROTOCOL §6.2) until protocol v2. This fails if any other registered module's deck sets the flag; the
 * repo guard (tests/repo-guards.test.ts) checks the sources too, for modules the app does not register.
 */
import { describe, expect, it } from 'vitest';
import { MODULES } from '../src/net.ts';

/** The modules allowed to set `promptShares` (owner-approved). Adding one needs an owner decision. */
const PROMPT_SHARES_ALLOWED: readonly string[] = ['luster', 'right-of-way', 'driftwrights'];

describe('promptShares allowlist', () => {
  for (const [id, module] of MODULES) {
    it(`${id}: ${PROMPT_SHARES_ALLOWED.includes(id) ? 'may' : 'does not'} set promptShares`, () => {
      const decks = module.decks(module.defaultRules()) as readonly { id: string; promptShares?: boolean }[];
      const flagged = decks.filter((d) => d.promptShares === true).map((d) => d.id);
      if (PROMPT_SHARES_ALLOWED.includes(id)) expect(flagged.length).toBeGreaterThan(0);
      else expect(flagged, `${id} sets promptShares on ${flagged.join(', ')}`).toEqual([]);
    });
  }

  it('lists only registered modules', () => {
    for (const id of PROMPT_SHARES_ALLOWED) expect(MODULES.has(id), id).toBe(true);
  });
});
