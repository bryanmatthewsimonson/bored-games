import { chess } from '@bored-games/chess';
import { G, initialDeck, jointKey, makeShare, proveShuffle, shuffleDeck } from '@bored-games/deck';
import {
  finalizeEvent,
  moveTemplate,
  type NostrEvent,
  secretTemplate,
  sharesTemplate,
} from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import type { GameSession } from '../src/session.ts';
import { simulateGame } from '../src/sim.ts';
import type { Identity } from '../src/types.ts';
import {
  deliver,
  LATE,
  MODULES,
  makeModuleGame,
  NOW,
  newSession,
  statuses,
  T0,
  type TestGame,
} from './helpers.ts';

/*
 * Deckless games (D045): a game whose module has no deck (Chess) has no shuffle, no deal, no shares and no secrets.
 * The session starts in play, moves 1.. are game actions, and the audit runs as soon as the game is over.
 */

/** Fool's mate: 1. f3 e5 2. g4 Qh4#, by seat (White is seat 0). */
const FOOLS_MATE: readonly [number, string][] = [
  [0, 'f2f3'],
  [1, 'e7e5'],
  [0, 'g2g4'],
  [1, 'd8h4'],
];

const move = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });

interface Table {
  game: TestGame;
  players: GameSession[];
  spectator: GameSession;
  all: GameSession[];
}

function table(seed: string): Table {
  const game = makeModuleGame(chess, 2, seed);
  const players = [newSession(game, 0), newSession(game, 1)];
  const spectator = newSession(game, null);
  return { game, players, spectator, all: [...players, spectator] };
}

/** Seat `seat` builds `uci` and every session receives it at `now`; returns the move. */
function play(t: Table, seat: number, uci: string, now = NOW): NostrEvent {
  const s = t.players[seat] as GameSession;
  const ev = s.buildAction(move(seat, uci), t.game.rnd, now);
  const r = statuses(deliver(t.all, [ev], undefined, now));
  expect(r).toEqual(['accepted', 'accepted', 'accepted']);
  return ev;
}

/** Each seat signs its attestation with its npub; every session receives both. */
function attestAll(t: Table): NostrEvent[] {
  return t.players.map((s, seat) => {
    const ev = finalizeEvent(s.attestTemplate(NOW), t.game.npubSks[seat] as Uint8Array, t.game.rnd);
    deliver(t.all, [ev]);
    return ev;
  });
}

describe('a deckless session (Chess)', () => {
  it('starts in play with the view-mode state set up, and White to decide', () => {
    const t = table('deckless-start');
    const v = t.spectator.view();
    expect(v).toMatchObject({
      phase: 'play',
      shuffleSteps: 0,
      head: { seq: 0 },
      pending: { type: 'player', seat: 0 },
    });
    expect(v.state).toMatchObject({ game: 'chess', turn: 'w' });
    expect(t.players[0]?.duties()).toEqual([{ kind: 'decide' }]);
    expect(t.players[1]?.duties()).toEqual([]);
    expect(t.players[0]?.legalActions()).toHaveLength(40);
    for (const s of t.all) expect(s.waitingFor()).toEqual([0]);
  });

  it("plays Fool's mate to done at once, with a passing audit, and both seats attest", () => {
    const t = table('deckless-mate');
    for (const [seat, uci] of FOOLS_MATE) play(t, seat, uci);
    for (const s of t.all) {
      const v = s.view();
      expect(v).toMatchObject({ phase: 'done', audit: 'pass', forfeits: [], head: { seq: 4 } });
      expect(v.outcome).toEqual({ places: [2, 1], reason: 'checkmate', scores: [0, 2] });
    }
    // No secret is owed: the attestation is the only duty, and the game waits on nobody.
    expect(t.players.map((s) => s.duties())).toEqual([[{ kind: 'attest' }], [{ kind: 'attest' }]]);
    for (const s of t.all) expect(s.waitingFor()).toEqual([]);
    attestAll(t);
    for (const s of t.all) expect(s.view().attested).toEqual([0, 1]);
    expect(t.players.map((s) => s.duties())).toEqual([[], []]);
  });

  it('folds the same moves delivered out of order and twice', () => {
    const t = table('deckless-order');
    const moves = FOOLS_MATE.map(([seat, uci]) => play(t, seat, uci));
    const late = newSession(t.game, null);
    deliver([late], moves, [3, 1, 3, 2, 0, 1]);
    expect(late.view()).toMatchObject({
      phase: 'done',
      head: { seq: 4 },
      logHash: t.spectator.view().logHash,
    });
  });

  it('rejects Shares and Secret events, moves carrying shares, and shuffle steps', () => {
    const t = table('deckless-reject');
    const id = t.game.ids[0] as Identity;
    const shares = finalizeEvent(
      sharesTemplate({ rootId: t.game.rootId, shares: [] }, T0 + 50),
      id.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(shares, NOW)).toEqual({
      status: 'rejected',
      reason: 'a deckless game has no shares',
    });
    const secret = finalizeEvent(
      secretTemplate({ rootId: t.game.rootId, deckSecret: id.deckSecret }, T0 + 50),
      id.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(secret, NOW)).toEqual({
      status: 'rejected',
      reason: 'a deckless game has no deck secrets',
    });

    const X = jointKey([G.multiply(id.deckSecret)]);
    const input = initialDeck('dummy', 1);
    const { out, psi, rPrime } = shuffleDeck(input, X, t.game.rnd);
    // A share of a re-encrypted (so valid) ciphertext; the deckless session must refuse it before any check.
    const share = makeShare(
      id.deckSecret,
      out[0] as (typeof out)[0],
      { rootId: t.game.rootId, deckId: 'dummy', pos: 0 },
      t.game.rnd,
    );
    const withShare = finalizeEvent(
      moveTemplate(
        {
          rootId: t.game.rootId,
          prevId: t.game.rootId,
          seq: 1,
          content: { type: 'action', action: move(0, 'e2e4'), reveals: [], shares: [{ pos: 0, share }] },
        },
        T0 + 50,
      ),
      id.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(withShare, NOW)).toEqual({
      status: 'rejected',
      reason: 'a deckless game carries no shares or reveals',
    });

    const proof = proveShuffle(
      input,
      out,
      X,
      psi,
      rPrime,
      { rootId: t.game.rootId, seat: 0, deckId: 'dummy' },
      t.game.rnd,
    );
    const step = finalizeEvent(
      moveTemplate(
        {
          rootId: t.game.rootId,
          prevId: t.game.rootId,
          seq: 1,
          content: { type: 'shuffle', deck: out, proof },
        },
        T0 + 50,
      ),
      id.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(step, NOW)).toEqual({
      status: 'rejected',
      reason: 'move 1 must be a game action',
    });
    expect(t.spectator.view().head.seq).toBe(0);
  });

  it('a timeout after a few moves is a forfeit, not a cancel: the stalled seat is last', () => {
    const t = table('deckless-timeout');
    for (const [seat, uci] of FOOLS_MATE.slice(0, 3)) play(t, seat, uci);
    // Black (seat 1) is to move and never does.
    const white = t.players[0] as GameSession;
    expect(white.timeoutTarget(NOW + 10)).toBeNull();
    expect(white.timeoutTarget(LATE)).toBe(1);
    const claim = white.buildTimeout(1, t.game.rnd, LATE);
    expect(statuses(deliver(t.all, [claim], undefined, LATE))).toEqual(['accepted', 'accepted', 'accepted']);
    for (const s of t.all) {
      expect(s.view()).toMatchObject({
        phase: 'done',
        forfeits: [1],
        audit: { fail: [1], reason: 'timeout' },
        outcome: { places: [1, 2], reason: 'forfeit', scores: [1, 1] },
      });
    }
    attestAll(t);
    for (const s of t.all) expect(s.view().attested).toEqual([0, 1]);
  });

  it('a timeout before the first move cancels the game', () => {
    const t = table('deckless-cancel');
    const black = t.players[1] as GameSession;
    expect(black.timeoutTarget(LATE)).toBe(0);
    const claim = black.buildTimeout(0, t.game.rnd, LATE);
    deliver(t.all, [claim], undefined, LATE);
    for (const s of t.all)
      expect(s.view()).toMatchObject({ phase: 'cancelled', outcome: null, forfeits: [0] });
  });

  it('two valid moves on one prev flag the seat; fork choice keeps the lowest id and the game goes on', () => {
    const t = table('deckless-fork');
    const white = t.players[0] as GameSession;
    // 1. f3 or 1. g4: either transposes into Fool's mate.
    const a = white.buildAction(move(0, 'f2f3'), t.game.rnd, NOW);
    const b = white.buildAction(move(0, 'g2g4'), t.game.rnd, NOW);
    const late = newSession(t.game, null);
    deliver(t.all, [a, b]);
    deliver([late], [b, a]);
    const first = a.id < b.id ? a : b;
    for (const s of [...t.all, late]) {
      expect(s.view()).toMatchObject({ head: { id: first.id, seq: 1 }, equivocators: [0], forfeits: [0] });
    }
    play(t, 1, 'e7e5');
    play(t, 0, first === a ? 'g2g4' : 'f2f3');
    play(t, 1, 'd8h4');
    for (const s of t.all) {
      const v = s.view();
      expect(v).toMatchObject({ phase: 'done', audit: 'pass', equivocators: [0], forfeits: [0] });
      expect(v.outcome).toEqual({ places: [2, 1], reason: 'forfeit', scores: [0, 2] });
    }
    // A late rival on the old prev never displaces the chain.
    const rival = finalizeEvent(
      moveTemplate(
        {
          rootId: t.game.rootId,
          prevId: t.game.rootId,
          seq: 1,
          content: { type: 'action', action: move(0, 'e2e4'), reveals: [], shares: [] },
        },
        T0 + 60,
      ),
      (t.game.ids[0] as Identity).sessionSk,
      t.game.rnd,
    );
    deliver(t.all, [rival]);
    for (const s of t.all) expect(s.view()).toMatchObject({ phase: 'done', head: { seq: 4 } });
  });

  it('a whole simulated game ends done with a passing audit and both attestations', () => {
    const r = simulateGame({
      seats: 2,
      seed: 'deckless-sim',
      modules: MODULES,
      game: chess.id,
      // Any legal action, draw offers and acceptances included, so the game ends soon.
      policy: (_state, _seat, legal, rng) => rng.pick(legal),
    });
    expect(r.failures).toEqual([]);
    expect(r).toMatchObject({
      phase: 'done',
      audit: 'pass',
      forfeits: [],
      equivocators: [],
      attested: [0, 1],
    });
    expect(r.actions).toBe(r.moves);
    expect(r.actions).toBeGreaterThan(0);
  });
});
