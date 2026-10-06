import { makeRollShare } from '@bored-games/deck';
import { canonicalJson } from '@bored-games/game-kit';
import { finalizeEvent, moveTemplate, type NostrEvent, parseMove } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { chooseForTest } from '../../games/driftwrights/src/choices.ts';
import { driftwrights, type NetworkState } from '../../games/driftwrights/src/module.ts';
import type { Action } from '../../games/driftwrights/src/types.ts';
import { deliver, makeModuleGame, NOW, newSession } from './helpers.ts';

describe('Driftwrights signed multiplayer', () => {
  it('rejects legacy-domain dice and card/beacon slot substitution before accepting a valid contribution', () => {
    const game = makeModuleGame(driftwrights, 3, 'drift-proof-slots');
    game.modules = new Map([[driftwrights.id, driftwrights]]);
    const players = Array.from({ length: 3 }, (_, seat) => newSession(game, seat));
    for (const s of players) deliver(players, [s.buildShuffle(game.rnd, NOW)], undefined, NOW);
    const request = players[0]?.buildAction({ type: 'request-roll', actor: 0 }, game.rnd, NOW);
    if (!request) throw new Error('missing request');
    deliver(players, [request], undefined, NOW);
    const contributor = players[1];
    const identity = game.ids[1];
    if (!contributor || !identity) throw new Error('missing contributor');
    const good = contributor.buildBeacon(game.rnd, NOW);
    const content = parseMove(good, 25).content;
    if (content.type !== 'action') throw new Error('missing action');
    const wrongDomain = makeRollShare(identity.deckSecret, game.rootId, 0, game.rnd);
    for (const shares of [
      [{ pos: 25, share: wrongDomain }],
      [{ pos: 0, share: content.shares[0]?.share ?? wrongDomain }],
    ]) {
      const forged = finalizeEvent(
        moveTemplate(
          { rootId: game.rootId, prevId: request.id, seq: 5, content: { ...content, shares } },
          NOW,
        ),
        identity.sessionSk,
        game.rnd,
      );
      expect(players[2]?.receive(forged, NOW).status).toBe('rejected');
    }
    expect(
      deliver(players, [good], undefined, NOW)
        .flat()
        .every((r) => r.status === 'accepted'),
    ).toBe(true);
  });
  for (const seats of [3, 4])
    it(`${seats} private clients reload signed events and pass every final audit`, () => {
      const game = makeModuleGame(driftwrights, seats, `drift-signed-whole-game-${seats}`);
      game.modules = new Map([[driftwrights.id, driftwrights]]);
      const players = Array.from({ length: seats }, (_, seat) => newSession(game, seat));
      const spectator = newSession(game, null);
      const all = [...players, spectator];
      const events: NostrEvent[] = [];
      const tags = new Set<string>();
      let reloaded = false;
      for (let step = 0; step < 25000; step++) {
        let progressed = false;
        for (const [seat, s] of players.entries()) {
          const duty = s.duties()[0];
          if (!duty || duty.kind === 'attest') continue;
          let ev: NostrEvent;
          if (duty.kind === 'shuffle') ev = s.buildShuffle(game.rnd, NOW);
          else if (duty.kind === 'deal') ev = s.buildDeal(game.rnd, NOW);
          else if (duty.kind === 'share') ev = s.buildShares(game.rnd, NOW);
          else if (duty.kind === 'beacon') ev = s.buildBeacon(game.rnd, NOW);
          else if (duty.kind === 'secret') ev = s.buildSecret(game.rnd, NOW);
          else if (duty.kind === 'decide') {
            const state = s.view().state as NetworkState;
            const choices = s.legalActions();
            const first = choices[0] as { type: string } | undefined;
            if (!first) throw new Error(`no legal choice at ${state.stage}`);
            const action = ['transfer', 'declare', 'requisition-payment'].includes(first.type)
              ? first
              : chooseForTest(state, choices as Action[]);
            tags.add((action as { type: string }).type);
            ev = s.buildAction(action, game.rnd, NOW);
            if ((action as { type: string }).type === 'transfer') {
              const content = JSON.parse(ev.content);
              expect(JSON.stringify(content)).not.toContain('"labels":');
              expect(JSON.stringify(content.action)).not.toContain('"card":');
            }
          } else throw new Error('unexpected duty');
          const results = deliver(all, [ev], undefined, NOW);
          expect(
            results.flat().some((r) => r.status === 'rejected'),
            canonicalJson(results),
          ).toBe(false);
          events.push(ev);
          progressed = true;
          if (!reloaded && tags.has('transfer') && tags.has('buy-venture')) {
            const reload = newSession(game, seat);
            deliver([reload], [...events].reverse(), undefined, NOW);
            expect(reload.view().state).toEqual(s.view().state);
            players[seat] = reload;
            all[seat] = reload;
            reloaded = true;
          }
        }
        if (all.every((s) => s.view().phase === 'done')) break;
        if (!progressed) throw new Error(`stalled: ${canonicalJson(all.map((s) => s.view().pending))}`);
      }
      expect(reloaded).toBe(true);
      expect(tags.has('declare')).toBe(true);
      expect(tags.has('transfer')).toBe(true);
      for (const s of all) {
        expect(s.view().phase).toBe('done');
        expect(s.view().audit).toBe('pass');
        expect(s.view().outcome).toEqual(spectator.view().outcome);
      }
    }, 180000);
});
