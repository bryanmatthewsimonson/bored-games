import { type ChainReactionState, chainReaction } from '@bored-games/chain-reaction';
import { chess } from '@bored-games/chess';
import { randomScalar } from '@bored-games/deck';
import { canonicalJson, createRng, type Pending, range, shuffle } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type Hex,
  type NostrEvent,
  resignTemplate,
  secretTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameSession } from '../src/session.ts';
import type { Identity } from '../src/types.ts';
import { forgeAction } from './cheat.ts';
import {
  deliver,
  LATE,
  makeGame,
  makeModuleGame,
  NOW,
  newSession,
  shuffleAll,
  statuses,
  T0,
  type TestGame,
  trust,
} from './helpers.ts';

/*
 * Resign in games with a deck and of 3+ seats (PROTOCOL §4.9, §8.3, D052), on a 4-seat Chain Reaction game played
 * once (the shuffle proofs are the slow part) and replayed from its events. A counted Resign ends the game for
 * everyone, ranked as if the game ended now with the resigning seat last, unrated, recording who ended it. The
 * Resign carries the seat's deck secret; the others owe theirs, and once every secret is in a partial audit replays
 * the log the resign ended. A Resign that counts before any game action cancels the game.
 */

const SEATS = 4;
const LONG = 900_000;
/** The game's deadline (the test table's): 3 days. */
const DEADLINE = 259_200;

type Action = { type: string; actor: number; declareEnd?: boolean };

interface Fixture {
  game: TestGame;
  steps: NostrEvent[];
  deals: NostrEvent[];
  moves: NostrEvent[];
  /** The decision each move answered: `pending[i]` before `moves[i]` linked. */
  pending: Pending[];
  /** Whether a seat's legal actions held a `place` before `moves[i]`, per seat (only the pending seat's). */
  canPlace: boolean[];
}

let fx: Fixture;

/** The shuffle, the deal and the first `k` game actions. */
const prefix = (k: number): NostrEvent[] => [...fx.steps, ...fx.deals, ...fx.moves.slice(0, k)];

/** A fresh session for `seat` (null: a spectator) holding `events`, each first seen at `now`. */
function client(seat: number | null, events: readonly NostrEvent[], now = NOW): GameSession {
  const s = newSession(fx.game, seat);
  trust([s], fx.steps);
  const r = statuses(deliver([s], events, undefined, now));
  if (r.some((x) => x !== 'accepted')) throw new Error(`catch-up: ${r.join(', ')}`);
  return s;
}

/** A fresh session for `seat` after the first `k` game actions. */
const at = (k: number, seat: number | null, now = NOW): GameSession => client(seat, prefix(k), now);

/** The seat whose decision move `k` answered (the pending seat after `k` actions). */
function pendingSeat(k: number): number {
  const p = fx.pending[k] as Pending;
  if (p.type !== 'player') throw new Error(`no player decision before move ${k}`);
  return p.seat;
}

const identity = (seat: number): Identity => fx.game.ids[seat] as Identity;

/** Seat `seat`'s Secret reveal, built directly (a test shortcut past the `secret` duty). */
const secretOf = (seat: number, createdAt = NOW): NostrEvent =>
  finalizeEvent(
    secretTemplate({ rootId: fx.game.rootId, deckSecret: identity(seat).deckSecret }, createdAt),
    identity(seat).sessionSk,
    fx.game.rnd,
  );

/** A Resign by `seat` naming `headId`, with `secret` (its own by default; null for none). */
function resignEvent(
  seat: number,
  headId: Hex,
  secret: bigint | null = identity(seat).deckSecret,
): NostrEvent {
  return finalizeEvent(
    resignTemplate({ rootId: fx.game.rootId, headId, secret }, T0 + 500),
    identity(seat).sessionSk,
    fx.game.rnd,
  );
}

/** The parts of a view every client must agree on. */
const summary = (s: GameSession) => {
  const v = s.view();
  return canonicalJson({
    phase: v.phase,
    head: v.head,
    logHash: v.logHash,
    outcome: v.outcome,
    audit: v.audit,
    forfeits: v.forfeits,
    resigned: v.resigned,
    equivocators: v.equivocators,
  });
};

const others = (but: readonly number[]): number[] => range(SEATS).filter((k) => !but.includes(k));

/** The first `k` at or after `from` whose decision is seat `seat`'s `decision` (any seat when null). */
function findMove(test: (p: Pending, k: number) => boolean, from = 0): number {
  for (let k = from; k < fx.moves.length; k++) if (test(fx.pending[k] as Pending, k)) return k;
  throw new Error('no such move in the fixture game');
}

beforeAll(() => {
  const game = makeGame(SEATS, 'resign-deck');
  const players = range(SEATS).map((seat) => newSession(game, seat));
  const spectator = newSession(game, null);
  const all = [...players, spectator];
  const steps = shuffleAll(game, players, [spectator]);
  const deals = players.map((s, k) => s.buildDeal(game.rnd, T0 + 200 + k));
  deliver(all, deals);
  const rng = createRng('resign-deck-policy');
  const moves: NostrEvent[] = [];
  const pending: Pending[] = [];
  const canPlace: boolean[] = [];
  let mergers = 0;
  // Play on, never declaring the end, until a few merger decisions have come by.
  while (moves.length < 160 && (mergers < 3 || moves.length < 40)) {
    const p = spectator.view().pending;
    if (p.type !== 'player') throw new Error(`no decision pending after ${moves.length} moves`);
    const s = players[p.seat] as GameSession;
    const legal = s.legalActions() as Action[];
    const choices = legal.filter((a) => a.declareEnd !== true);
    if (['chooseSurvivor', 'orderDefunct', 'dispose'].includes(p.decision)) mergers++;
    pending.push(p);
    canPlace.push(legal.some((a) => a.type === 'place'));
    const ev = s.buildAction(rng.pick(choices.length > 0 ? choices : legal), game.rnd, NOW);
    const r = statuses(deliver(all, [ev]));
    if (r.some((x) => x !== 'accepted')) throw new Error(`move ${moves.length}: ${r.join(', ')}`);
    moves.push(ev);
  }
  pending.push(spectator.view().pending);
  canPlace.push(false);
  fx = { game, steps, deals, moves, pending, canPlace };
}, LONG);

describe('a counted resign in a 4-seat Chain Reaction game', () => {
  it(
    'ends the game for everyone: secrets, a partial audit, an unrated ranking, and the same attestation everywhere',
    () => {
      const k = 12;
      const r = pendingSeat(k);
      const resigner = at(k, r);
      expect(resigner.canResign()).toBe(true);
      const resign = resigner.buildResign(fx.game.rnd, T0 + 500);
      // A deck game's Resign carries the seat's deck secret.
      expect(JSON.parse(resign.content)).toEqual({
        secret: expect.any(String),
        type: 'resign',
      });
      expect(resigner.receive(resign, NOW)).toEqual({ status: 'accepted' });
      // The resigner owes nothing; the others owe their secrets. Nobody decides any more.
      expect(resigner.duties()).toEqual([]);
      expect(resigner.view()).toMatchObject({
        phase: 'end',
        outcome: null,
        audit: 'pending',
        resigned: [r],
        forfeits: [r],
      });
      const players = others([r]).map((seat) => at(k, seat));
      deliver(players, [resign]);
      const secrets: NostrEvent[] = [];
      for (const s of players) {
        expect(s.view().phase).toBe('end');
        expect(s.duties()).toEqual([{ kind: 'secret' }]);
        expect(s.legalActions()).toEqual([]);
        expect(s.canResign()).toBe(false);
        secrets.push(s.buildSecret(fx.game.rnd, NOW + 1));
      }
      const seated = [resigner, ...players];
      deliver(seated, secrets);
      const standings = chainReaction.standings(resigner.view().state as ChainReactionState);
      for (const s of seated) {
        expect(s.view()).toMatchObject({
          phase: 'done',
          head: { seq: SEATS + k },
          resigned: [r],
          forfeits: [r],
          audit: { fail: [r], reason: 'resign' },
          outcome: {
            reason: 'resign',
            scores: standings,
            unrated: true,
            endedBy: { type: 'resign', seat: r },
          },
        });
        const places = s.view().outcome?.places as number[];
        // Ranked as if the game ended now, the resigning seat alone in last place.
        expect(places[r]).toBe(SEATS);
        for (const j of others([r])) {
          expect(places[j]).toBe(
            1 + others([r]).filter((i) => (standings[i] as number) > (standings[j] as number)).length,
          );
        }
      }
      const attests = seated.map((s) => {
        const seat = s.view().mySeat as number;
        expect(s.duties()).toEqual([{ kind: 'attest' }]);
        return finalizeEvent(s.attestTemplate(NOW + 2), fx.game.npubSks[seat] as Uint8Array, fx.game.rnd);
      });
      // Every seat signs the same content, which records the unrated result and who ended it.
      expect(new Set(attests.map((a) => a.content)).size).toBe(1);
      expect(JSON.parse(attests[0]?.content as string).outcome).toMatchObject({
        unrated: true,
        endedBy: { seat: r, type: 'resign' },
      });
      deliver(seated, attests);
      for (const s of seated) expect(s.view().attested).toEqual(range(SEATS));
      const want = summary(resigner);

      // Every client reaches the same result and accepts every attestation, whatever the delivery order.
      const events = [...prefix(k), resign, ...secrets, ...attests];
      for (const seed of ['a', 'b', 'c', 'd']) {
        const order = shuffle(range(events.length), createRng(`resign-deck-order-${seed}`));
        const late = [newSession(fx.game, null), newSession(fx.game, (seed.charCodeAt(0) - 97) % SEATS)];
        trust(late, fx.steps);
        deliver(late, events, order);
        for (const s of late) {
          expect(summary(s)).toBe(want);
          expect(s.view().attested).toEqual(range(SEATS));
        }
      }
    },
    LONG,
  );

  it('a seat that is not pending may resign; a move raced at the same head changes the log, not the loser', () => {
    const k = 20;
    const p = pendingSeat(k);
    const r = (p + 2) % SEATS;
    const resign = at(k, r).buildResign(fx.game.rnd, T0 + 500);
    const move = fx.moves[k] as NostrEvent;
    const a = at(k, null);
    const b = at(k, null);
    deliver([a], [resign, move]);
    deliver([b], [move, resign]);
    expect(a.receive(move, NOW)).toEqual({ status: 'duplicate' });
    deliver(
      [a, b],
      others([r]).map((seat) => secretOf(seat)),
    );
    for (const [s, seq] of [
      [a, SEATS + k],
      [b, SEATS + k + 1],
    ] as const) {
      expect(s.view()).toMatchObject({
        phase: 'done',
        head: { seq },
        resigned: [r],
        audit: { fail: [r], reason: 'resign' },
        outcome: { unrated: true, endedBy: { type: 'resign', seat: r } },
      });
      expect(s.view().outcome?.places[r]).toBe(SEATS);
    }
  });

  it(
    'during a merger decision: ranked by the standings mid-merger, and the partial audit passes',
    () => {
      const k = findMove((p) => p.type === 'player' && ['orderDefunct', 'dispose'].includes(p.decision));
      const s = at(k, null);
      const state = s.view().state as ChainReactionState;
      expect(state.phase.kind).toBe('merger');
      const r = pendingSeat(k);
      deliver([s], [resignEvent(r, s.view().head.id), ...others([r]).map((seat) => secretOf(seat))]);
      expect(s.view()).toMatchObject({
        phase: 'done',
        audit: { fail: [r], reason: 'resign' },
        outcome: { scores: chainReaction.standings(state), unrated: true },
      });
      expect(s.view().outcome?.places[r]).toBe(SEATS);
    },
    LONG,
  );

  it('waits for the head it names (the head gate), and keeps its secret meanwhile', () => {
    const k = 8;
    const r = pendingSeat(k - 1);
    // The resigner played move k and resigned; this client gets the resign first.
    const resign = resignEvent(r, (fx.moves[k - 1] as NostrEvent).id);
    const s = at(k - 1, (r + 1) % SEATS);
    expect(s.receive(resign, NOW)).toEqual({ status: 'stored' });
    expect(s.view()).toMatchObject({ phase: 'play', resigned: [] });
    expect(s.canResign()).toBe(true);
    expect(s.receive(fx.moves[k - 1], NOW)).toEqual({ status: 'accepted' });
    expect(s.view()).toMatchObject({ phase: 'end', head: { seq: SEATS + k }, resigned: [r], forfeits: [r] });
    expect(s.duties()).toEqual([{ kind: 'secret' }]);
    // The resign's secret was kept while it waited: only the three others are owed.
    deliver(
      [s],
      others([r]).map((seat) => secretOf(seat)),
    );
    expect(s.view()).toMatchObject({ phase: 'done', audit: { fail: [r], reason: 'resign' } });
  });

  it('a seat whose secret is in already resigns: only the remaining secrets are owed', () => {
    const k = 5;
    const s = at(k, null);
    // Seat 3's secret arrived early (kept, as before any end), then seat 0 resigns.
    expect(s.receive(secretOf(3), NOW)).toEqual({ status: 'stored' });
    deliver([s], [resignEvent(0, s.view().head.id)]);
    expect(s.view().phase).toBe('end');
    deliver([s], [secretOf(1), secretOf(2)]);
    expect(s.view()).toMatchObject({ phase: 'done', resigned: [0] });
  });
});

describe('what a deck-game Resign must carry', () => {
  it('rejects a secret that is not the seat’s, and records the rejection', () => {
    const k = 6;
    const s = at(k, null);
    const head = s.view().head.id;
    for (const secret of [identity(2).deckSecret, randomScalar(fx.game.rnd)]) {
      const bad = resignEvent(1, head, secret);
      const reason = "the resign's deck secret does not match seat 1's deck key";
      expect(s.receive(bad, NOW)).toEqual({ status: 'rejected', reason });
      expect(s.receive(bad, NOW)).toEqual({ status: 'rejected', reason });
    }
    expect(s.view()).toMatchObject({ phase: 'play', resigned: [] });
  });

  it('rejects a resign without a secret in a game with a deck', () => {
    const s = at(6, null);
    const bare = resignEvent(1, s.view().head.id, null);
    expect(s.receive(bare, NOW)).toMatchObject({
      status: 'rejected',
      reason: expect.stringMatching(/^bad-content/),
    });
    expect(s.view()).toMatchObject({ phase: 'play', resigned: [] });
  });

  it('rejects a resign with a secret in a deckless game (Chess)', () => {
    const game = makeModuleGame(chess, 2, 'resign-deckless-secret');
    const s = newSession(game, null);
    const id = game.ids[0] as Identity;
    const ev = finalizeEvent(
      resignTemplate({ rootId: game.rootId, headId: game.rootId, secret: id.deckSecret }, T0 + 500),
      id.sessionSk,
      game.rnd,
    );
    expect(s.receive(ev, NOW)).toMatchObject({
      status: 'rejected',
      reason: expect.stringMatching(/^bad-content/),
    });
    expect(s.view()).toMatchObject({ phase: 'play', resigned: [] });
  });
});

describe('a deck-game resign before any game action cancels the game, with no secret owed', () => {
  it('at the root, during the shuffle', () => {
    const players = range(SEATS).map((seat) => newSession(fx.game, seat));
    const resign = (players[2] as GameSession).buildResign(fx.game.rnd, T0 + 50);
    deliver(players, [resign]);
    for (const s of players) {
      expect(s.view()).toMatchObject({ phase: 'cancelled', outcome: null, resigned: [2], forfeits: [2] });
      expect(s.duties()).toEqual([]);
      expect(s.timeoutTarget(LATE)).toBeNull();
    }
  });

  it('after the shuffle, during the deal and before the first action', () => {
    for (const events of [fx.steps, [...fx.steps, ...fx.deals]]) {
      const s = client(1, events);
      expect(s.view().phase).toBe(events.length === fx.steps.length ? 'deal' : 'play');
      // The head is the last shuffle step, not the root: no game action yet, so it cancels.
      const resign = s.buildResign(fx.game.rnd, T0 + 300);
      const spectator = client(null, events);
      deliver([s, spectator], [resign]);
      for (const c of [s, spectator]) {
        expect(c.view()).toMatchObject({
          phase: 'cancelled',
          outcome: null,
          audit: 'pending',
          resigned: [1],
        });
        expect(c.duties()).toEqual([]);
      }
    }
  });
});

describe('after a deck-game resign', () => {
  it('a withheld secret is claimed after a full deadline from the resign, and the seat forfeits too', () => {
    const k = 10;
    const r = pendingSeat(k);
    const w = (r + 1) % SEATS;
    const c = (r + 2) % SEATS;
    const claimant = at(k, c);
    const spectator = at(k, null);
    const resign = resignEvent(r, claimant.view().head.id);
    // The resign comes a day after the last move: the deadline for the secrets runs from it.
    const resignSeen = NOW + 86_400;
    deliver([claimant, spectator], [resign], undefined, resignSeen);
    deliver(
      [claimant, spectator],
      others([r, w]).map((seat) => secretOf(seat)),
      undefined,
      resignSeen,
    );
    expect(claimant.view().phase).toBe('end');
    expect(claimant.timeoutTarget(resignSeen + DEADLINE - 1)).toBeNull();
    expect(claimant.timeoutTarget(resignSeen + DEADLINE)).toBe(w);
    const claim = claimant.buildTimeout(w, fx.game.rnd, resignSeen + DEADLINE);
    expect(spectator.receive(claim, resignSeen + DEADLINE - 1)).toEqual({ status: 'stored' });
    expect(spectator.view().phase).toBe('end');
    spectator.tick(resignSeen + DEADLINE);
    expect(claimant.receive(claim, resignSeen + DEADLINE)).toEqual({ status: 'accepted' });
    const forfeits = [r, w].sort();
    for (const s of [claimant, spectator]) {
      expect(s.view()).toMatchObject({
        phase: 'done',
        resigned: [r],
        forfeits,
        audit: { fail: forfeits, reason: 'resign; withheld secret' },
        outcome: { reason: 'resign', unrated: true, endedBy: { type: 'resign', seat: r } },
      });
      // The two forfeiting seats share the last place.
      const places = s.view().outcome?.places as number[];
      expect(places[r]).toBe(SEATS - 1);
      expect(places[w]).toBe(SEATS - 1);
    }
    // A late secret changes nothing: the result is final.
    const before = summary(spectator);
    expect(spectator.receive(secretOf(w), LATE)).toEqual({ status: 'stored' });
    expect(summary(spectator)).toBe(before);
  });

  it(
    'the partial audit fails the seat that forged an action before the resign',
    () => {
      const k = findMove(
        (p, i) => p.type === 'player' && p.decision === 'place' && (fx.canPlace[i] ?? false),
        4,
      );
      const f = pendingSeat(k);
      // The forger skips its placement while holding a playable tile; nobody else can see its hand.
      const forged = forgeAction(at(k, f), { type: 'skipPlace', actor: f }, fx.game.rnd, NOW);
      const r = (f + 1) % SEATS;
      const resigner = client(r, [...prefix(k), forged]);
      const resign = resigner.buildResign(fx.game.rnd, T0 + 500);
      const s = client(null, [...prefix(k), forged]);
      deliver([s, resigner], [resign, ...others([r]).map((seat) => secretOf(seat))]);
      const forfeits = [f, r].sort();
      for (const c of [s, resigner]) {
        expect(c.view()).toMatchObject({
          phase: 'done',
          resigned: [r],
          forfeits,
          audit: {
            fail: forfeits,
            reason: `resign; move ${SEATS + k + 1} by seat ${f} fails: playable: you hold a playable tile`,
          },
          outcome: { reason: 'resign', unrated: true, endedBy: { type: 'resign', seat: r } },
        });
        expect(c.view().outcome?.places[f]).toBe(SEATS - 1);
      }
    },
    LONG,
  );

  it('a resign racing a timeout claim: each client keeps what it counted first', () => {
    const k = 14;
    const p = pendingSeat(k);
    const c = (p + 1) % SEATS;
    const r = (p + 2) % SEATS;
    // Seat p has stalled past the deadline; seat c claims while seat r resigns.
    const claim = at(k, c).buildTimeout(p, fx.game.rnd, LATE);
    const resign = resignEvent(r, at(k, null).view().head.id);
    const first = at(k, null);
    const second = at(k, null);
    // The claim first: p times out and forfeits; the game ends rated, and the resign is too late.
    expect(first.receive(claim, LATE)).toEqual({ status: 'accepted' });
    expect(first.receive(resign, LATE)).toEqual({ status: 'rejected', reason: 'the game is already over' });
    expect(first.view()).toMatchObject({
      phase: 'done',
      resigned: [],
      forfeits: [p],
      audit: { fail: [p], reason: 'timeout' },
      outcome: { reason: 'forfeit' },
    });
    expect(first.view().outcome).not.toHaveProperty('unrated');
    // The resign first: the claim's claimant now owes its secret, so the claim fails; the secrets end the game.
    expect(second.receive(resign, LATE)).toEqual({ status: 'accepted' });
    expect(second.receive(claim, LATE)).toEqual({
      status: 'rejected',
      reason: `the claimant, seat ${c}, is stalled at the head`,
    });
    const secrets = others([r]).map((seat) => secretOf(seat));
    deliver([first, second], secrets, undefined, LATE);
    expect(second.view()).toMatchObject({
      phase: 'done',
      resigned: [r],
      forfeits: [r],
      audit: { fail: [r], reason: 'resign' },
      outcome: { unrated: true },
    });
    // Different orders, different results: the claim-race residual (PROTOCOL §11).
    expect(first.view()).toMatchObject({ resigned: [], forfeits: [p] });
  });

  it('a resign that arrives after the game is cancelled or over changes nothing', () => {
    const s = newSession(fx.game, null);
    deliver([s], [resignEvent(3, fx.game.rootId)]);
    expect(s.view().phase).toBe('cancelled');
    expect(s.receive(resignEvent(1, fx.game.rootId), NOW)).toEqual({
      status: 'rejected',
      reason: 'the game is already over',
    });
    expect(s.view()).toMatchObject({ phase: 'cancelled', resigned: [3] });
  });
});
