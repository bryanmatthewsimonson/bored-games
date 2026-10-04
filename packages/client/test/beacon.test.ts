import type { BankState } from '@bored-games/bank';
import { bank } from '@bored-games/bank';
import { G, makeRollShare } from '@bored-games/deck';
import { finalizeEvent, moveTemplate, type NostrEvent } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import type { GameSession } from '../src/session.ts';
import { deliver, makeModuleGame, NOW, newSession, statuses, T0, type TestGame } from './helpers.ts';

/*
 * The dice beacon (D058). Bank is deckless, so there is no shuffle and no deal. A roll and a contribution each
 * carry one share of the roll point. The session derives the faces once every seat has published; a player who
 * sends the faces is rejected. Chess stays on the deckless path and is covered in deckless.test.ts.
 */

const roll = (seat: number, rollId: number) => ({ type: 'roll', actor: seat, rollId });
const contribute = (seat: number, rollId: number) => ({ type: 'contribute', actor: seat, rollId });

interface Table {
  game: TestGame;
  players: GameSession[];
  spectator: GameSession;
  all: GameSession[];
}

function table(seed: string, seats = 2): Table {
  const game = makeModuleGame(bank, seats, seed);
  const players = Array.from({ length: seats }, (_, seat) => newSession(game, seat));
  const spectator = newSession(game, null);
  return { game, players, spectator, all: [...players, spectator] };
}

/** Seat `seat` builds `action` and every session receives it. */
function play(t: Table, seat: number, action: unknown, now = NOW): NostrEvent {
  const s = t.players[seat] as GameSession;
  const ev = s.buildAction(action, t.game.rnd, now);
  const r = statuses(deliver(t.all, [ev], undefined, now));
  expect(r).toEqual(t.all.map(() => 'accepted'));
  return ev;
}

function stateOf(s: GameSession): BankState {
  return s.view().state as BankState;
}

function diceOf(s: GameSession): Extract<BankState['log'][number], { kind: 'dice' }> {
  const entry = stateOf(s).log.find((line) => line.kind === 'dice');
  if (entry === undefined || entry.kind !== 'dice') throw new Error('no dice in the log');
  return entry;
}

describe('a dice beacon session (Bank)', () => {
  it('starts in play with the roller to roll, and an empty pot', () => {
    const t = table('beacon-start');
    for (const s of t.all) {
      expect(s.view()).toMatchObject({
        phase: 'play',
        shuffleSteps: 0,
        head: { seq: 0 },
        pending: { type: 'player', seat: 0, decision: 'roll' },
      });
      expect(stateOf(s)).toMatchObject({ game: 'bank', pot: 0, roller: 0, round: 0 });
    }
    expect(t.players[0]?.duties()).toEqual([{ kind: 'decide' }]);
    expect(t.players[1]?.duties()).toEqual([]);
    expect(t.players[0]?.legalActions()).toEqual([roll(0, 0)]);
  });

  it('derives the same faces for both seats and a spectator, and not before the last share', () => {
    const t = table('beacon-roll');
    play(t, 0, roll(0, 0));
    for (const s of t.all) {
      const state = stateOf(s);
      expect(state.phase).toBe('collect');
      expect(state.pot).toBe(0);
      expect(state.log.some((line) => line.kind === 'dice')).toBe(false);
      expect(s.view().pending).toEqual({ type: 'player', seat: 1, decision: 'contribute' });
    }
    expect(t.players[1]?.legalActions()).toEqual([contribute(1, 0)]);

    play(t, 1, contribute(1, 0));
    const first = diceOf(t.spectator);
    expect(first.dice[0]).toBeGreaterThanOrEqual(1);
    expect(first.dice[0]).toBeLessThanOrEqual(6);
    expect(first.dice[1]).toBeGreaterThanOrEqual(1);
    expect(first.dice[1]).toBeLessThanOrEqual(6);
    expect(first.pot).toBeGreaterThanOrEqual(2);
    expect(first.effect === 'add' || first.effect === 'seventy').toBe(true);
    for (const s of t.all) {
      expect(stateOf(s).pot).toBe(first.pot);
      expect(stateOf(s).log).toEqual(stateOf(t.spectator).log);
      expect(s.view().logHash).toBe(t.spectator.view().logHash);
      expect(s.view().pending).toEqual({ type: 'player', seat: 1, decision: 'bank-or-stay' });
    }
  });

  it('rejects a tampered roll share, a roll without one, and a player who sends the faces', () => {
    const t = table('beacon-reject');
    const id0 = t.game.ids[0];
    const id1 = t.game.ids[1];
    if (id0 === undefined || id1 === undefined) throw new Error('two seats');

    const rolled = finalizeEvent(
      moveTemplate(
        {
          rootId: t.game.rootId,
          prevId: t.game.rootId,
          seq: 1,
          content: {
            type: 'action',
            action: { type: 'rolled', actor: 'beacon', id: 0, dice: [1, 1] },
            reveals: [],
            shares: [],
          },
        },
        T0 + 50,
      ),
      id1.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(rolled, NOW)).toEqual({
      status: 'rejected',
      reason: 'a player does not send the dice',
    });

    const head = t.spectator.view().head.id;
    const bare = finalizeEvent(
      moveTemplate(
        {
          rootId: t.game.rootId,
          prevId: head,
          seq: 1,
          content: { type: 'action', action: roll(0, 0), reveals: [], shares: [] },
        },
        T0 + 60,
      ),
      id0.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(bare, NOW)).toEqual({
      status: 'rejected',
      reason: 'the roll share must be the one share for this roll',
    });

    const good = makeRollShare(id0.deckSecret, t.game.rootId, 0, t.game.rnd);
    const tampered = finalizeEvent(
      moveTemplate(
        {
          rootId: t.game.rootId,
          prevId: head,
          seq: 1,
          content: {
            type: 'action',
            action: roll(0, 0),
            reveals: [],
            shares: [{ pos: 0, share: { ...good, D: G.multiply(2n) } }],
          },
        },
        T0 + 70,
      ),
      id0.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(tampered, NOW)).toEqual({
      status: 'rejected',
      reason: 'the roll share does not verify',
    });
    expect(t.spectator.view().head.seq).toBe(0);
    expect(stateOf(t.spectator).pot).toBe(0);
  });

  it('derives the dice when two contributions fork, replaying the roller share', () => {
    const t = table('beacon-fork');
    const rolled = play(t, 0, roll(0, 0));
    const seat = t.players[1] as GameSession;
    const a = seat.buildAction(contribute(1, 0), t.game.rnd, NOW);
    const b = seat.buildAction(contribute(1, 0), t.game.rnd, NOW + 1);
    const late = newSession(t.game, null);
    expect(statuses(deliver(t.all, [a, b]))).toEqual([
      'accepted',
      'accepted',
      'accepted',
      'accepted',
      'accepted',
      'accepted',
    ]);
    // The late client sees the rival first, then the rest. Deriving still needs the roller's share on the roll.
    expect(statuses(deliver([late], [b, a, rolled]))).toEqual(['stored', 'stored', 'accepted']);
    const kept = a.id < b.id ? a : b;
    for (const s of [...t.all, late]) {
      expect(s.view()).toMatchObject({ head: { id: kept.id, seq: 2 }, equivocators: [1] });
      expect(diceOf(s).dice).toEqual(diceOf(t.spectator).dice);
      expect(stateOf(s).pot).toBe(stateOf(t.spectator).pot);
      expect(stateOf(s).pot).toBeGreaterThanOrEqual(2);
    }
  });
});
