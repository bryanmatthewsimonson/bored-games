import { gameSeed } from '@bored-games/game-kit';
import { expect, it } from 'vitest';
import { STICKS_POLICIES } from '../../../tools/fuzz/src/sticks-and-stones.ts';
import { sticksAndStones } from '../../games/sticks-and-stones/src/index.ts';
import { simulateGame } from '../src/sim.ts';

/*
 * A scoring reveal without reshuffle epochs (D089): Sticks & Stones turns up each face-down card at the end while it
 * is still dealt to its holder (`handsReveal`). Every seat owes its share then, the holder's own included; before
 * the fix the holder's app had no such duty, the reveal never completed and the holder was timed out.
 */
it('a scoring reveal of a held card asks its holder for a share, and the game ends with the audit passing', {
  timeout: 300_000,
}, () => {
  let endings = 0;
  const recording: typeof sticksAndStones = {
    ...sticksAndStones,
    apply: (s, a) => {
      const r = sticksAndStones.apply(s, a);
      if (r.ok && r.state.stage === 'ending' && s.stage !== 'ending' && r.state.full) endings++;
      return r;
    },
  };
  const chief = STICKS_POLICIES[0];
  if (chief === undefined) throw new Error('no policy');
  const report = simulateGame({
    seats: 2,
    seed: gameSeed('sim', 0),
    modules: new Map([[recording.id, recording]]),
    game: recording.id,
    policy: (state, seat, legal, rng) => chief.choose(state as never, seat, legal, rng),
    maxRounds: 100_000,
  });
  expect(report.failures).toEqual([]);
  expect(report.claims).toBe(0);
  expect(report.audit).toBe('pass');
  expect(report.phase).toBe('done');
  expect(endings).toBeGreaterThan(0);
});
