import { createHash } from 'node:crypto';
import { chess } from '@bored-games/chess';
import { createRng } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type Hex,
  type NostrEvent,
  resignTemplate,
  timeoutTemplate,
} from '@bored-games/protocol';
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
 * Resign (PROTOCOL §4.9, §8.3, D045): allowed only in 2-seat games without a deck. A Resign counts as soon as it
 * is received, whatever head it names, and like an accepted timeout it is final for the client that received it:
 * later moves, claims and resigns change nothing. A resign received after the result is final changes nothing.
 */

/** A 64-hex id nobody holds. */
const junkId = (s: string): Hex => createHash('sha256').update(s, 'utf8').digest('hex');

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

/** Seat `seat` builds `uci`; every session in `to` receives it. Returns the move. */
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

/** `n` resigns by `seat` with ids below `below`, naming heads nobody holds (ground through `created_at`). */
function lowResigns(game: TestGame, seat: number, below: Hex, n: number): NostrEvent[] {
  const out: NostrEvent[] = [];
  for (let i = 0; out.length < n; i++) {
    const ev = resignEvent(game, seat, junkId(`junk-${i}`), T0 + 1000 + i);
    if (ev.id < below) out.push(ev);
  }
  return out;
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

describe('resign in a 2-seat game without a deck (Chess)', () => {
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
    expect(() => black.buildResign(t.game.rnd, T0 + 501)).toThrow(/game is over/);
    expect(t.players.map((s) => s.duties())).toEqual([[{ kind: 'attest' }], [{ kind: 'attest' }]]);
    for (const [seat, s] of t.players.entries()) {
      const ev = finalizeEvent(s.attestTemplate(NOW), t.game.npubSks[seat] as Uint8Array, t.game.rnd);
      deliver(t.all, [ev]);
    }
    for (const s of t.all) expect(s.view().attested).toEqual([0, 1]);
    // A copy and a second resign by the same seat are duplicates; the other seat's resign comes too late.
    expect(statuses(deliver(t.all, [r, resignEvent(t.game, 1, t.game.rootId)]))).toEqual(
      Array(6).fill('duplicate'),
    );
    expect(deliver(t.all, [resignEvent(t.game, 0, t.game.rootId)])[0]?.map((x) => x.status)).toEqual(
      Array(3).fill('rejected'),
    );
    for (const s of t.all) expect(s.view()).toMatchObject({ resigned: [1], outcome: { places: [1, 2] } });
  });

  it('counts on receipt whatever head it names: an unknown head, an older head or the root', () => {
    for (const head of ['unknown', 'older', 'root'] as const) {
      const t = chessTable(`resign-head-${head}`);
      const m1 = play(t, 0, 'd2d4');
      play(t, 1, 'd7d5');
      const named = head === 'unknown' ? junkId('nowhere') : head === 'older' ? m1.id : t.game.rootId;
      expect(t.spectator.receive(resignEvent(t.game, 0, named), NOW)).toEqual({ status: 'accepted' });
      expect(t.spectator.view()).toMatchObject({ phase: 'done', head: { seq: 2 }, resigned: [0] });
      expect(t.spectator.view().outcome?.places).toEqual([2, 1]);
    }
  });

  it('is final: a move received after it is stored and changes nothing (each client keeps its first result)', () => {
    const t = chessTable('resign-final');
    const m1 = play(t, 0, 'e2e4');
    const m2 = play(t, 1, 'e7e5');
    // Black resigns while White's third move is in flight.
    const r = resignEvent(t.game, 1, m2.id);
    const m3 = (t.players[0] as GameSession).buildAction(move(0, 'g1f3'), t.game.rnd, NOW);
    const a = newSession(t.game, null);
    const b = newSession(t.game, null);
    deliver([a], [m1, m2, r]);
    expect(a.receive(m3, NOW)).toEqual({ status: 'stored' });
    deliver([b], [m1, m2, m3, r]);
    // Same winner and reason; the logs differ by the raced move (the claim-race residual, PROTOCOL §11).
    expect(summary(a)).toMatchObject({
      phase: 'done',
      head: { seq: 2 },
      resigned: [1],
      outcome: { places: [1, 2] },
    });
    expect(summary(b)).toMatchObject({
      phase: 'done',
      head: { seq: 3 },
      resigned: [1],
      outcome: { places: [1, 2] },
    });
  });

  it('a resign received after the chain is over changes nothing; a mate received after a resign is stored', () => {
    const t = chessTable('resign-mate');
    const pre = [play(t, 0, 'f2f3'), play(t, 1, 'e7e5'), play(t, 0, 'g2g4')];
    // White resigns while Black mates.
    const r = resignEvent(t.game, 0, (pre[2] as NostrEvent).id);
    const mate = (t.players[1] as GameSession).buildAction(move(1, 'd8h4'), t.game.rnd, NOW);
    const a = newSession(t.game, null);
    const b = newSession(t.game, null);
    deliver([a], [...pre, mate]);
    expect(a.receive(r, NOW)).toEqual({ status: 'rejected', reason: 'the game is already over' });
    expect(summary(a)).toMatchObject({
      phase: 'done',
      resigned: [],
      audit: 'pass',
      outcome: { places: [2, 1], reason: 'checkmate', scores: [0, 2] },
    });
    deliver([b], [...pre, r]);
    expect(b.receive(mate, NOW)).toEqual({ status: 'stored' });
    expect(summary(b)).toMatchObject({
      phase: 'done',
      resigned: [0],
      outcome: { places: [2, 1], reason: 'resign' },
    });
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

  it('a resign received first makes a later timeout claim fail; a claim accepted first makes a later resign fail', () => {
    const t = chessTable('resign-timeout');
    const m1 = play(t, 0, 'e2e4');
    const claim = (t.players[0] as GameSession).buildTimeout(1, t.game.rnd, LATE);
    const r = resignEvent(t.game, 0, m1.id);
    const a = newSession(t.game, null);
    const b = newSession(t.game, null);
    deliver([a, b], [m1]);
    // a: the resign first. White resigned: Black wins, and White's claim against Black changes nothing.
    expect(a.receive(r, LATE)).toEqual({ status: 'accepted' });
    expect(a.receive(claim, LATE)).toEqual({ status: 'rejected', reason: 'the game is already over' });
    expect(a.view()).toMatchObject({
      phase: 'done',
      resigned: [0],
      forfeits: [0],
      outcome: { places: [2, 1] },
    });
    // b: the claim first. Black timed out: White wins, and White's resign changes nothing.
    expect(b.receive(claim, LATE)).toEqual({ status: 'accepted' });
    expect(b.receive(r, LATE)).toEqual({ status: 'rejected', reason: 'the game is already over' });
    expect(b.view()).toMatchObject({
      phase: 'done',
      resigned: [],
      forfeits: [1],
      audit: { fail: [1], reason: 'timeout' },
      outcome: { places: [1, 2], reason: 'forfeit' },
    });
    // Different orders, different results: the claim-race residual (PROTOCOL §11), now with resigns in it.
  });

  it('cannot be retracted: a flood of lower-id resigns and a timeout claim after it change nothing', () => {
    const t = chessTable('resign-flood');
    play(t, 0, 'e2e4');
    const white = t.players[0] as GameSession;
    // White resigns on Black's turn; Black attests and leaves.
    const r = white.buildResign(t.game.rnd, T0 + 500);
    deliver(t.all, [r]);
    const before = t.all.map(summary);
    expect(before[2]).toMatchObject({ phase: 'done', resigned: [0], outcome: { places: [2, 1] } });
    // Later White floods ground low-id resigns naming junk heads, then claims a timeout against Black.
    const flood = lowResigns(t.game, 0, r.id, 9);
    const claim = finalizeEvent(
      timeoutTemplate({ rootId: t.game.rootId, headId: t.spectator.view().head.id, seat: 1 }, LATE),
      (t.game.ids[0] as Identity).sessionSk,
      t.game.rnd,
    );
    deliver(t.all, [...flood, claim], undefined, LATE);
    expect(t.all.map(summary)).toEqual(before);
    for (const s of t.all) expect(s.receive(claim, LATE + 1).status).toBe('rejected');
    // A client that gets the flood before the real resign counts the flood's first resign at once: same winner.
    const late = newSession(t.game, null);
    deliver([late], [...flood, r, claim], undefined, LATE);
    expect(late.view()).toMatchObject({ resigned: [0], forfeits: [0] });
    // The kept resign of the seat is its lowest id.
    const kept = (late as unknown as { resigns: Map<number, { id: Hex }> }).resigns.get(0)?.id;
    expect(kept).toBe([...flood, r].map((e) => e.id).sort()[0]);
  });

  it('a resign and an equivocation: both seats forfeit and share the last place', () => {
    const t = chessTable('resign-equivocate');
    const white = t.players[0] as GameSession;
    const a = white.buildAction(move(0, 'e2e4'), t.game.rnd, NOW);
    const b = white.buildAction(move(0, 'd2d4'), t.game.rnd, NOW);
    deliver(t.all, [a, b]);
    deliver(t.all, [resignEvent(t.game, 1, t.game.rootId)]);
    for (const s of t.all)
      expect(s.view()).toMatchObject({
        phase: 'done',
        resigned: [1],
        forfeits: [0, 1],
        outcome: { places: [1, 1] },
      });
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

  it('a simulated seat that resigns on its turn ends the game done, last, and everyone agrees and attests', () => {
    for (const atSeq of [0, 1, 6]) {
      const r = simulateGame({
        seats: 2,
        seed: `resign-sim-${atSeq}`,
        modules: MODULES,
        game: chess.id,
        policy: (_s, _seat, legal, rng) =>
          rng.pick(legal.filter((a) => (a as { offerDraw?: true }).offerDraw !== true)),
        adversary: adversary('resign', 1, 2, atSeq),
      });
      expect(r.failures).toEqual([]);
      expect(unexpected(r, 1)).toEqual([]);
      expect(r.phase).toBe('done');
    }
  });
});

describe('resign elsewhere is not allowed (D045: until the owner decides)', () => {
  it('a 3-seat Chain Reaction game rejects every Resign, in any order, and plays on', () => {
    const game = makeGame(3, 'resign-cr');
    const players = [0, 1, 2].map((seat) => newSession(game, seat));
    const spectator = newSession(game, null);
    const all = [...players, spectator];
    shuffleAll(game, players, [spectator]);
    const deals = players.map((s, k) => s.buildDeal(game.rnd, T0 + 200 + k));
    deliver(all, deals);
    const rng = createRng('resign-cr-policy');
    for (let i = 0; i < 3; i++) {
      const p = spectator.view().pending;
      if (p.type !== 'player') throw new Error('no decision pending');
      const s = players[p.seat] as GameSession;
      deliver(all, [s.buildAction(rng.pick(s.legalActions()), game.rnd, T0 + 1000 + i)]);
    }
    for (const s of all) expect(s.canResign()).toBe(false);
    expect(() => (players[1] as GameSession).buildResign(game.rnd, T0 + 2000)).toThrow(/not allowed/);
    const r = resignEvent(game, 1, spectator.view().head.id);
    const reason = 'resigning is allowed only in 2-seat games without a deck';
    expect(deliver(all, [r, r]).flat()).toEqual(Array(8).fill({ status: 'rejected', reason }));
    for (const s of all) expect(s.view()).toMatchObject({ phase: 'play', resigned: [] });
    expect(players.some((s) => s.duties().some((d) => d.kind === 'decide'))).toBe(true);
  });
});
