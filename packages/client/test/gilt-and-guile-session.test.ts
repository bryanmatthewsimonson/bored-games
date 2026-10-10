import type { NostrEvent } from '@bored-games/protocol';
import { expect, it } from 'vitest';
import {
  type GiltAction,
  type GiltState,
  giltAndGuile,
  STRIDE,
} from '../../games/gilt-and-guile/src/index.ts';
import { deliver, makeModuleGame, NOW, newSession, trust } from './helpers.ts';

it('GiltAndGuile deals private epoch positions beyond its large opening packet and agrees with a spectator', {
  timeout: 120000,
}, () => {
  const game = makeModuleGame(giltAndGuile, 2, 'gilt-and-guile-epochs');
  game.modules = new Map([[giltAndGuile.id, giltAndGuile]]);
  const players = [newSession(game, 0), newSession(game, 1)];
  const spectator = newSession(game, null);
  const all = [...players, spectator];
  const rejected: string[] = [];
  for (let step = 0; step < 500; step++) {
    let progressed = false;
    for (const s of players) {
      const duty = s.duties()[0];
      if (!duty) continue;
      let ev: NostrEvent;
      if (duty.kind === 'shuffle') {
        ev = s.view().phase === 'shuffle' ? s.buildShuffle(game.rnd, NOW) : s.buildEpoch(game.rnd, NOW);
        trust(all, [ev]);
      } else if (duty.kind === 'deal') ev = s.buildDeal(game.rnd, NOW);
      else if (duty.kind === 'share') ev = s.buildShares(game.rnd, NOW);
      else if (duty.kind === 'seal') ev = s.buildSealed(game.rnd, NOW);
      else if (duty.kind === 'decide') {
        if ((s.view().state as GiltState).epoch >= 2) continue;
        const legal = s.legalActions() as GiltAction[];
        const a =
          legal.find((a) => a.type === 'play') ??
          legal.find((a) => a.type === 'buy' && a.kind === 'penny') ??
          legal.find((a) => a.type === 'next' || a.type === 'end');
        if (!a) throw Error('No scripted move');
        ev = s.buildAction(a, game.rnd, NOW);
      } else throw Error(`Unexpected duty ${duty.kind}`);
      for (const r of deliver(all, [ev], undefined, NOW)[0] ?? [])
        if (r.status === 'rejected') rejected.push(r.reason);
      progressed = true;
    }
    const state = players[0]!.view().state as GiltState | null;
    if (
      state &&
      state.epoch >= 2 &&
      players.every((s, seat) =>
        (s.view().state as GiltState).players[seat]?.hand.every((c) => c.card !== null),
      )
    )
      break;
    if (!progressed) break;
  }
  expect(rejected).toEqual([]);
  const state = spectator.view().state as GiltState;
  expect(state.epoch).toBeGreaterThanOrEqual(2);
  expect(state.players.every((p) => p.hand.every((c) => c.pos >= STRIDE && c.card === null))).toBe(true);
  for (const [seat, s] of players.entries()) {
    const v = s.view().state as GiltState;
    expect(s.view().head).toEqual(spectator.view().head);
    expect(v.players[seat]!.hand.every((c) => c.card !== null)).toBe(true);
    expect(v.players[1 - seat]!.hand.every((c) => c.card === null)).toBe(true);
    expect(giltAndGuile.invariants(v)).toEqual([]);
  }
});
