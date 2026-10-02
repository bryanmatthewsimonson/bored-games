import { chainReaction } from '@bored-games/chain-reaction';
import { chess } from '@bored-games/chess';
import { createRng } from '@bored-games/game-kit';
import { finalizeEvent, type NostrEvent, resignTemplate } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import type { GameSession } from '../src/session.ts';
import { simulateGame } from '../src/sim.ts';
import type { Identity } from '../src/types.ts';
import { adversary, unexpected } from './adversaries.ts';
import {
  deliver,
  LATE,
  MODULES,
  makeGame,
  makeModuleGame,
  NOW,
  newSession,
  shuffleAll,
  statuses,
  T0,
  type TestGame,
} from './helpers.ts';

/*
 * Resign (PROTOCOL §4.9, §8.3, D045): a platform event any seat may publish while the game is live. It ends the
 * game with the resigning seat last. Its effect is a function of the event set: a resign naming an older head is
 * still a resign, moves keep linking, and a chain that reaches the module's `over` stands.
 */

const move = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });

interface Table {
  game: TestGame;
  players: GameSession[];
  spectator: GameSession;
  all: GameSession[];
}

function chessTable(seed: string): Table {
  const game = makeModuleGame(chess, 2, seed);
  const players = [newSession(game, 0), newSession(game, 1)];
  const spectator = newSession(game, null);
  return { game, players, spectator, all: [...players, spectator] };
}

/** Seat `seat` builds `uci`; every session receives it. Returns the move. */
function play(t: Table, seat: number, uci: string, to: readonly GameSession[] = t.all): NostrEvent {
  const ev = (t.players[seat] as GameSession).buildAction(move(seat, uci), t.game.rnd, NOW);
  deliver(to, [ev]);
  return ev;
}

/** A resign by `seat` naming `headId`, signed with its session key. */
function resignEvent(game: TestGame, seat: number, headId: string, createdAt = T0 + 500): NostrEvent {
  const id = game.ids[seat] as Identity;
  return finalizeEvent(resignTemplate({ rootId: game.rootId, headId }, createdAt), id.sessionSk, game.rnd);
}

/** The parts of a view every client must agree on. */
const summary = (s: GameSession) => {
  const v = s.view();
  return {
    phase: v.phase,
    head: v.head,
    logHash: v.logHash,
    outcome: v.outcome,
    audit: v.audit,
    forfeits: v.forfeits,
    resigned: v.resigned,
  };
};

describe('resign in a 2-seat game (Chess)', () => {
  it('ends the game with the resigning seat last; only attestations are due afterwards', () => {
    const t = chessTable('resign-basic');
    play(t, 0, 'e2e4');
    play(t, 1, 'e7e5');
    const black = t.players[1] as GameSession;
    expect(black.canResign()).toBe(true);
    // Black resigns on White's turn.
    const r = black.buildResign(t.game.rnd, T0 + 500);
    expect(statuses(deliver(t.all, [r]))).toEqual(['accepted', 'accepted', 'accepted']);
    for (const s of t.all) {
      expect(s.view()).toMatchObject({
        phase: 'done',
        head: { seq: 2 },
        resigned: [1],
        forfeits: [1],
        audit: { fail: [1], reason: 'resign' },
        outcome: { places: [1, 2], reason: 'resign', scores: [1, 1] },
      });
      expect(s.canResign()).toBe(false);
      expect(s.legalActions()).toEqual([]);
      expect(s.timeoutTarget(LATE)).toBeNull();
    }
    expect(() => black.buildResign(t.game.rnd, T0 + 501)).toThrow(/not live/);
    expect(t.players.map((s) => s.duties())).toEqual([[{ kind: 'attest' }], [{ kind: 'attest' }]]);
    for (const [seat, s] of t.players.entries()) {
      const ev = finalizeEvent(s.attestTemplate(NOW), t.game.npubSks[seat] as Uint8Array, t.game.rnd);
      deliver(t.all, [ev]);
    }
    for (const s of t.all) expect(s.view().attested).toEqual([0, 1]);
    // A second copy and a second resign by the same seat change nothing.
    expect(statuses(deliver(t.all, [r, resignEvent(t.game, 1, t.game.rootId)]))).toEqual(
      Array(6).fill('duplicate'),
    );
  });

  it('races a move: a resign naming an older head still counts, and the move links in any order', () => {
    const t = chessTable('resign-race');
    const m1 = play(t, 0, 'e2e4');
    const m2 = play(t, 1, 'e7e5');
    // Black resigns having seen only move 1; White's move 3 is in flight at the same time.
    const r = resignEvent(t.game, 1, m1.id);
    const m3 = (t.players[0] as GameSession).buildAction(move(0, 'g1f3'), t.game.rnd, NOW);
    const a = newSession(t.game, null);
    const b = newSession(t.game, null);
    const c = newSession(t.game, null);
    deliver([a], [m1, m2, r, m3]);
    deliver([b], [m1, m2, m3, r]);
    deliver([c], [r, m3, m2, m1]);
    const want = summary(a);
    expect(want).toMatchObject({
      phase: 'done',
      head: { seq: 3 },
      resigned: [1],
      outcome: { reason: 'resign' },
    });
    expect(summary(b)).toEqual(want);
    expect(summary(c)).toEqual(want);
  });

  it('a resign whose head is not held yet is stored, and counts once the head arrives', () => {
    const t = chessTable('resign-unknown-head');
    const m1 = play(t, 0, 'd2d4');
    const late = newSession(t.game, null);
    const r = resignEvent(t.game, 0, m1.id);
    expect(late.receive(r, NOW)).toEqual({ status: 'stored' });
    expect(late.view()).toMatchObject({ phase: 'play', resigned: [] });
    expect(late.receive(m1, NOW)).toEqual({ status: 'accepted' });
    expect(late.view()).toMatchObject({ phase: 'done', resigned: [0], outcome: { places: [2, 1] } });
  });

  it('a move that ends the game while a resign races it stands: a finished game is never reopened', () => {
    const t = chessTable('resign-mate');
    const pre = [play(t, 0, 'f2f3'), play(t, 1, 'e7e5'), play(t, 0, 'g2g4')];
    // White resigns while Black mates.
    const r = resignEvent(t.game, 0, (pre[2] as NostrEvent).id);
    const mate = (t.players[1] as GameSession).buildAction(move(1, 'd8h4'), t.game.rnd, NOW);
    const a = newSession(t.game, null);
    const b = newSession(t.game, null);
    deliver([a], [...pre, r]);
    expect(a.view()).toMatchObject({ phase: 'done', resigned: [0], outcome: { reason: 'resign' } });
    expect(a.receive(mate, NOW)).toEqual({ status: 'accepted' });
    deliver([b], [...pre, mate]);
    expect(b.receive(r, NOW)).toEqual({ status: 'rejected', reason: 'the game is already over' });
    for (const s of [a, b]) {
      expect(summary(s)).toMatchObject({
        phase: 'done',
        resigned: [],
        forfeits: [],
        audit: 'pass',
        outcome: { places: [2, 1], reason: 'checkmate', scores: [0, 2] },
      });
    }
    expect(summary(a)).toEqual(summary(b));
  });

  it('a resign before the first move cancels the game', () => {
    const t = chessTable('resign-cancel');
    const r = (t.players[0] as GameSession).buildResign(t.game.rnd, T0 + 50);
    deliver(t.all, [r]);
    for (const s of t.all) {
      expect(s.view()).toMatchObject({ phase: 'cancelled', outcome: null, forfeits: [0], resigned: [0] });
      expect(s.duties()).toEqual([]);
    }
  });

  it('outranks a timeout accepted during play', () => {
    const t = chessTable('resign-timeout');
    const m1 = play(t, 0, 'e2e4');
    const white = t.players[0] as GameSession;
    const claim = white.buildTimeout(1, t.game.rnd, LATE);
    const r = resignEvent(t.game, 1, m1.id);
    const a = newSession(t.game, 0);
    const b = newSession(t.game, null);
    deliver([a, b], [m1]);
    deliver([a], [claim, r], undefined, LATE);
    deliver([b], [r, claim], undefined, LATE);
    expect(a.view().forfeits).toEqual([1]);
    expect(summary(a)).toEqual(summary(b));
    expect(summary(b)).toMatchObject({ phase: 'done', resigned: [1], outcome: { reason: 'resign' } });
  });

  it('rejects a resign by a stranger or for another game', () => {
    const t = chessTable('resign-reject');
    const other = makeModuleGame(chess, 2, 'resign-other');
    const stranger = finalizeEvent(
      resignTemplate({ rootId: t.game.rootId, headId: t.game.rootId }, T0),
      other.ids[0]?.sessionSk as Uint8Array,
      t.game.rnd,
    );
    expect(t.spectator.receive(stranger, NOW)).toEqual({
      status: 'rejected',
      reason: 'not signed by a seated session key',
    });
    expect(t.spectator.receive(resignEvent(other, 0, other.rootId), NOW)).toEqual({
      status: 'rejected',
      reason: 'the event is for another game',
    });
    expect(t.spectator.view().phase).toBe('play');
  });

  it('a simulated seat that resigns mid-game ends it done, last, and everyone agrees and attests', () => {
    const r = simulateGame({
      seats: 2,
      seed: 'resign-sim',
      modules: MODULES,
      game: chess.id,
      policy: (_s, _seat, legal, rng) =>
        rng.pick(legal.filter((a) => (a as { offerDraw?: true }).offerDraw !== true)),
      adversary: adversary('resign', 1, 2, 6),
    });
    expect(r.failures).toEqual([]);
    expect(unexpected(r, 1)).toEqual([]);
    expect(r.attested).toEqual([0, 1]);
  });
});

describe('resign in a 3-seat game (Chain Reaction)', () => {
  it('ends the game at once: the resigning seat last, the others ranked by standings, and all agree', () => {
    const game = makeGame(3, 'resign-cr');
    const players = [0, 1, 2].map((seat) => newSession(game, seat));
    const spectator = newSession(game, null);
    const all = [...players, spectator];
    const steps = shuffleAll(game, players, [spectator]);
    const deals = players.map((s, k) => s.buildDeal(game.rnd, T0 + 200 + k));
    deliver(all, deals);
    const rng = createRng('resign-cr-policy');
    const moves: NostrEvent[] = [];
    for (let i = 0; i < 6; i++) {
      const p = spectator.view().pending;
      if (p.type !== 'player') throw new Error('no decision pending');
      const s = players[p.seat] as GameSession;
      const ev = s.buildAction(rng.pick(s.legalActions()), game.rnd, T0 + 1000 + i);
      deliver(all, [ev]);
      moves.push(ev);
    }
    const r = (players[1] as GameSession).buildResign(game.rnd, T0 + 2000);
    expect(statuses(deliver(all, [r]))).toEqual(Array(4).fill('accepted'));
    const v = spectator.view();
    const standings = chainReaction.standings(chainReaction.view(v.state as never, null));
    expect(v).toMatchObject({
      phase: 'done',
      resigned: [1],
      forfeits: [1],
      audit: { fail: [1], reason: 'resign' },
    });
    expect(v.outcome?.reason).toBe('resign');
    expect(v.outcome?.scores).toEqual(standings);
    expect(v.outcome?.places[1]).toBe(3);
    for (const s of all) expect(summary(s)).toEqual(summary(spectator));
    // Nobody owes a share, a decision or a secret: only attestations.
    expect(players.map((s) => s.duties())).toEqual([
      [{ kind: 'attest' }],
      [{ kind: 'attest' }],
      [{ kind: 'attest' }],
    ]);
    // A late client that gets everything in another order agrees.
    const late = newSession(game, null);
    for (const ev of steps)
      (late as unknown as { shuffleChecked: Map<string, boolean> }).shuffleChecked.set(ev.id, true);
    deliver([late], [r, ...moves.slice().reverse(), ...deals, ...steps.slice().reverse()]);
    expect(summary(late)).toEqual(summary(spectator));
  });
});
