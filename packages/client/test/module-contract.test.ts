import { describe, it } from 'vitest';
import { MODULES } from './helpers.ts';
import { checkResignMidGame, checkResignOffered, seatCounts } from './resign-contract.ts';

/*
 * The Resign contract (PROTOCOL §4.9, §8.3, D052, D090; resign-contract.ts) over every module these tests register.
 * The web tests run it over every module the app registers (apps/web/test/module-contract.test.ts), which is the
 * list that ships. Resign is never disabled: every module allows it at every seat count, and a seat that resigns
 * mid-game, whatever the game is waiting for, ends the game the same way on every client.
 */

const LONG = 600_000;

describe('Resign in every game, at every seat count (D090)', () => {
  for (const module of MODULES.values()) {
    it(
      `${module.id}: every seat may resign at every seat count, and every client accepts it`,
      () => checkResignOffered(module),
      LONG,
    );
    const seats = seatCounts(module)[0] as number;
    it(
      `${module.id}: a resign mid-game ends the game alike on every client (${seats} seats)`,
      () => {
        checkResignMidGame(module, seats);
      },
      LONG,
    );
  }
});
