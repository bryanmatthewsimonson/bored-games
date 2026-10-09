import type { NostrEvent } from '@bored-games/protocol';
import { expect, it } from 'vitest';
import { quillAndQuarry, type State, TILES } from '../../games/quill-and-quarry/src/index.ts';
import { deliver, makeModuleGame, newSession, statuses, T0 } from './helpers.ts';

it('dispatches epochs by capability, keeps returned letters private, and audits final racks', () => {
  const game = makeModuleGame(quillAndQuarry, 2, 'quill-live-regression');
  game.modules = new Map([...game.modules, [quillAndQuarry.id, quillAndQuarry]]);
  const players = [newSession(game, 0), newSession(game, 1)],
    spectator = newSession(game, null),
    all = [...players, spectator];
  const events: NostrEvent[] = [];
  let date = T0 + 100;
  const state = (seat: number | null = null): State =>
    (seat === null ? spectator : players[seat])?.view().state as State;
  function publish(event: NostrEvent) {
    events.push(event);
    const r = statuses(deliver(all, [event], undefined, event.created_at));
    expect(r).not.toContain('rejected');
  }
  function pump() {
    for (let guard = 0; guard < 250; guard++) {
      let sent = false;
      for (const player of players) {
        const duty = player.duties()[0];
        let event: NostrEvent | null = null;
        if (duty?.kind === 'shuffle')
          event =
            player.view().phase === 'shuffle'
              ? player.buildShuffle(game.rnd, date++)
              : player.buildEpoch(game.rnd, date++);
        if (duty?.kind === 'deal') event = player.buildDeal(game.rnd, date++);
        if (duty?.kind === 'share') event = player.buildShares(game.rnd, date++);
        if (duty?.kind === 'secret') event = player.buildSecret(game.rnd, date++);
        if (event) {
          publish(event);
          sent = true;
          break;
        }
      }
      if (!sent) return;
    }
    throw new Error('Automatic duties did not settle');
  }
  function act(action: unknown) {
    const s = state(),
      player = players[s.turn];
    if (!player) throw new Error('Missing player');
    publish(player.buildAction(action, game.rnd, date++));
    pump();
  }
  pump();
  expect(state().epoch).toBe(1);
  expect(state().phase).toBe('turn');
  for (const seat of [0, 1]) {
    expect(state(seat).hands[seat]?.every((h) => h.card !== null)).toBe(true);
    expect(state(seat).hands[1 - seat]?.every((h) => h.card === null)).toBe(true);
  }
  const actor = state().turn,
    hand = state(actor).hands[actor] ?? [];
  const tiles = hand
    .slice(0, 2)
    .map((h, i) => ({ cell: 112 + i, pos: h.pos, card: h.card, letter: TILES[h.card ?? -1]?.letter || 'A' }));
  act({ type: 'place', actor, tiles });
  act({ type: 'accept', actor: state().turn });
  const exchangeSeat = state().turn,
    pos = state(exchangeSeat).hands[exchangeSeat]?.[0]?.pos;
  const bagBefore = state().bag.length;
  act({ type: 'exchange', actor: exchangeSeat, positions: [pos] });
  expect(state().epoch).toBe(2);
  expect(state().bag).toHaveLength(bagBefore);
  expect(
    state()
      .hands.flat()
      .every((h) => h.card === null),
  ).toBe(true);
  const late = newSession(game, null);
  for (const event of events) late.receive(event, date);
  expect(late.view().state).toEqual(spectator.view().state);
  for (let i = 0; i < 5; i++) act({ type: 'pass', actor: state().turn });
  act({ type: 'finish', actor: state().turn });
  expect(state().phase).toBe('over');
  expect(
    state()
      .hands.flat()
      .every((h) => h.card !== null),
  ).toBe(true);
  for (const session of all) expect(session.view().audit).toBe('pass');
}, 120_000);
