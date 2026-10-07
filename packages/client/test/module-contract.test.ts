import { describe, expect, it } from 'vitest';
import { MODULES } from './helpers.ts';
import { checkRevealContract, resignSeatCounts } from './reveal-contract.ts';

/*
 * Contract checks the session relies on for every module with a deck that these tests register (PROTOCOL §8.3,
 * D052; reveal-contract.ts). The web tests run the same check over every module the app registers
 * (apps/web/test/module-contract.test.ts), which is the list that ships. Holler is the reviewed exception
 * inside the helper (D073): a scoring reveal, an epoch, and a grant may pend during play.
 */

describe('modules with a deck pend public reveals only before the first player action', () => {
  for (const module of MODULES.values()) {
    if (module.decks(module.defaultRules()).length === 0) continue;
    it(`${module.id}`, () => {
      const seats = resignSeatCounts(module);
      expect(seats.length, `${module.id} opts out of Resign; the web test exempts it`).toBeGreaterThan(0);
      checkRevealContract(module, seats);
    });
  }
});
