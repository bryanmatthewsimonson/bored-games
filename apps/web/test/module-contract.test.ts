/*
 * The Resign contract (PROTOCOL §4.9, §8.3, D052, D090) over every module the app registers (`MODULES`, net.ts),
 * the list that ships, rather than the client tests' own registry. The owner: "Don't disable Resign. It shouldn't
 * be disabled anywhere in Bored Games." So every registered module allows Resign at every seat count (there is no
 * opt-out hook), and in every one a seat that resigns mid-game, whatever the game is waiting for then (a public or
 * scoring reveal, a dice beacon, a reshuffle epoch, a sealed share, a private show, another seat's decision), ends
 * the game for everyone: every remaining seat publishes its secret, the partial audit passes, the resigner is last,
 * and every client agrees (packages/client/test/resign-contract.ts), each game played by its first fuzz policy.
 */
import type { GameModule } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import {
  checkResignMidGame,
  checkResignOffered,
  seatCounts,
} from '../../../packages/client/test/resign-contract.ts';
import { TARGETS } from '../../../tools/fuzz/src/index.ts';
import { MODULES } from '../src/net.ts';

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
type AnyModule = GameModule<any, any, any>;

const LONG = 900_000;

describe('D090: Resign in every registered game, at every seat count', () => {
  const modules = [...MODULES.values()] as AnyModule[];

  it('covers every registered module, and none can opt out', () => {
    expect(modules.map((m) => m.id)).toContain('chain-reaction');
    expect(modules.filter((m) => 'resignAllowed' in m).map((m) => m.id)).toEqual([]);
  });

  for (const module of modules) {
    it(
      `${module.id}: every seat may resign at every seat count (${seatCounts(module).join(', ')})`,
      () => checkResignOffered(module),
      LONG,
    );
    const seats = seatCounts(module)[0] as number;
    it(
      `${module.id}: a resign mid-game ends the game alike on every client (${seats} seats)`,
      () => {
        // Each game's first fuzz policy, as `pnpm sim` plays it: uniform moves end some games (Room for Doubt's
        // wrong indictments) before anyone can resign.
        const target = TARGETS[module.id];
        const policy = target?.policies[0];
        checkResignMidGame(module, seats, {
          ...(policy === undefined
            ? {}
            : { policy: (state, seat, legal, rng) => policy.choose(state, seat, legal, rng) }),
          ...(target?.simDeadline === undefined ? {} : { deadline: target.simDeadline }),
        });
      },
      LONG,
    );
  }
});
