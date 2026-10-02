import { type ChainReactionState, chainReaction } from '@bored-games/chain-reaction';
import { type Ciphertext, makeShare } from '@bored-games/deck';
import { canonicalJson, createRng, type GameModule, type Rng } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type Hex,
  type NostrEvent,
  parseMove,
  parseShares,
  secretTemplate,
  sharesTemplate,
  timeoutTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { rankWithForfeits } from '../src/audit.ts';
import { ClientError } from '../src/errors.ts';
import { GameSession } from '../src/session.ts';
import type { Identity, SessionView } from '../src/types.ts';
import {
  catchUp,
  deliver,
  LATE,
  makeGame,
  NOW,
  newSession,
  ROOT_SEEN,
  shuffleAll,
  statuses,
  T0,
  type TestGame,
  trust,
  unshared,
} from './helpers.ts';

/*
 * Timeouts by local receipt time (D030 Rulings 10 and 11): the deadline runs from the latest time this client
 * first saw the root, a chain move, or a Shares event or secret that removed a seat from the stall set. No
 * `created_at` counts, neither the claim's nor any other event's.
 */

const SEATS = 3;
const HAND = 6;
const DECK = 108;
/** The test table's deadline: three days. */
const D = 259_200;
/** A local clock reading at which the tests' clients first saw the events of a catch-up. */
const T1 = T0 + 50_000;
const LONG = 600_000;
/** A date far from any local clock reading, in either direction. */
const FAR = 1_000_000_000;

type Action = { type: string; actor: number; declareEnd?: boolean };

/** A Timeout claim by seat `by` naming `seat` at head `headId`, built by hand. */
function claim(game: TestGame, by: number, seat: number, headId: Hex, createdAt: number): NostrEvent {
  const sk = game.ids[by]?.sessionSk as Uint8Array;
  return finalizeEvent(timeoutTemplate({ rootId: game.rootId, headId, seat }, createdAt), sk, game.rnd);
}

const rejected = (reason: string) => ({ status: 'rejected', reason });

const actionOf = (ev: NostrEvent): Action =>
  (parseMove(ev, DECK).content as { action: unknown }).action as Action;

/** A fresh session for `seat` that received `timed` in order, each event first seen at its time. */
function replay(
  game: TestGame,
  seat: number | null,
  timed: readonly (readonly [NostrEvent, number])[],
): GameSession {
  const s = newSession(game, seat);
  trust(
    [s],
    timed.map(([ev]) => ev),
  );
  for (const [ev, at] of timed) s.receive(ev, at);
  return s;
}

describe('timeouts during the shuffle and the deal', () => {
  const game = makeGame(SEATS, 'client-timeout-setup');
  let steps: NostrEvent[];
  /** Each seat's deal. */
  let deals: NostrEvent[];

  beforeAll(() => {
    const players = [0, 1, 2].map((seat) => newSession(game, seat));
    steps = shuffleAll(game, players);
    deals = players.map((s, k) => s.buildDeal(game.rnd, T0 + 200 + k));
  });

  it('names the next shuffler once the deadline has passed since the root was first seen, and claims only then', () => {
    const [s0, s1] = [newSession(game, 0), newSession(game, 1)];
    const watcher = newSession(game, null);
    expect(s1.timeoutTarget(ROOT_SEEN + D - 1)).toBeNull();
    expect(s1.timeoutTarget(ROOT_SEEN + D)).toBe(0);
    // A client that first saw the root later gives the shuffler longer.
    expect(newSession(game, 1, ROOT_SEEN + 1000).timeoutTarget(ROOT_SEEN + D)).toBeNull();
    // The stalled seat cannot claim; a spectator claims nothing.
    expect(s0.timeoutTarget(LATE)).toBeNull();
    expect(watcher.timeoutTarget(LATE)).toBeNull();
    expect(() => s1.buildTimeout(0, game.rnd, ROOT_SEEN + D - 1)).toThrow(ClientError);
    expect(() => s1.buildTimeout(1, game.rnd, LATE)).toThrow(ClientError);
    expect(() => s1.buildTimeout(2, game.rnd, LATE)).toThrow(ClientError);
    expect(() => s0.buildTimeout(1, game.rnd, LATE)).toThrow(ClientError);
    expect(() => watcher.buildTimeout(0, game.rnd, LATE)).toThrow(ClientError);
  });

  it('stores a claim until the local deadline, then accepts it on tick or on the next event', () => {
    const watcher = newSession(game, null);
    const ev = newSession(game, 1).buildTimeout(0, game.rnd, ROOT_SEEN + D);
    // One second early by the local clock.
    expect(watcher.receive(ev, ROOT_SEEN + D - 1)).toEqual({ status: 'stored' });
    expect(watcher.view().phase).toBe('shuffle');
    watcher.tick(ROOT_SEEN + D - 1);
    expect(watcher.view().phase).toBe('shuffle');
    watcher.tick(ROOT_SEEN + D);
    const v = watcher.view();
    expect(v.phase).toBe('cancelled');
    expect(v.outcome).toBeNull();
    expect(v.audit).toBe('pending');
    expect(v.forfeits).toEqual([0]);
    expect(watcher.receive(ev, LATE)).toEqual({ status: 'duplicate' });

    // The next event is judged after the stored claims: the step that arrives too late changes nothing.
    const other = newSession(game, null);
    expect(other.receive(ev, ROOT_SEEN + D - 1)).toEqual({ status: 'stored' });
    trust([other], steps);
    expect(other.receive(steps[0], ROOT_SEEN + D)).toEqual({ status: 'stored' });
    expect(other.view().phase).toBe('cancelled');
    expect(other.view().head.seq).toBe(0);

    // The stalled seat sees it too; nothing is due from anyone any more.
    const s0 = newSession(game, 0);
    expect(s0.duties()).toEqual([{ kind: 'shuffle' }]);
    expect(s0.receive(ev, LATE)).toEqual({ status: 'accepted' });
    expect(s0.view().phase).toBe('cancelled');
    expect(s0.duties()).toEqual([]);
    expect(() => s0.buildShuffle(game.rnd, LATE)).toThrow(ClientError);
  });

  it("ignores the claim's own date: one dated far ahead or long before counts once the local deadline passes", () => {
    for (const date of [ROOT_SEEN - FAR, ROOT_SEEN + FAR]) {
      const watcher = newSession(game, null);
      expect(watcher.receive(claim(game, 1, 0, game.rootId, date), ROOT_SEEN + D - 1)).toEqual({
        status: 'stored',
      });
      watcher.tick(ROOT_SEEN + D);
      expect(watcher.view().phase).toBe('cancelled');
      expect(watcher.view().forfeits).toEqual([0]);
    }
  });

  it('rejects a claim by a stalled seat or not by a seated key; the seat it names is a shape check only', () => {
    const watcher = newSession(game, null);
    const root = game.rootId;
    expect(watcher.receive(claim(game, 0, 1, root, LATE), LATE)).toEqual(
      rejected('the claimant, seat 0, is stalled at the head'),
    );
    expect(watcher.receive(claim(game, 1, 1, root, LATE), LATE)).toEqual(
      rejected('a seat cannot claim a timeout against itself'),
    );
    expect(watcher.receive(claim(game, 1, 5, root, LATE), LATE)).toEqual(rejected('there is no seat 5'));
    const byNpub = finalizeEvent(
      timeoutTemplate({ rootId: root, headId: root, seat: 0 }, LATE),
      game.npubSks[1] as Uint8Array,
      game.rnd,
    );
    expect(watcher.receive(byNpub, LATE)).toEqual(rejected('not signed by a seated session key'));
    expect(watcher.view().phase).toBe('shuffle');
    expect(watcher.view().forfeits).toEqual([]);
    // A claim naming seat 2, which is not stalled, still ends the game: the stalled seat 0 forfeits.
    expect(watcher.receive(claim(game, 1, 2, root, LATE), LATE)).toEqual({ status: 'accepted' });
    expect(watcher.view().phase).toBe('cancelled');
    expect(watcher.view().forfeits).toEqual([0]);
  });

  it('rejects a claim against an old head, and holds one against a head it has not seen yet', () => {
    const step = steps[0] as NostrEvent;
    const old = claim(game, 1, 0, game.rootId, LATE);
    const ahead = claim(game, 2, 1, step.id, LATE);

    const late = catchUp(game, null, [step]);
    expect(late.receive(old, LATE)).toEqual(rejected('the claim names an old head'));
    expect(late.view().phase).toBe('shuffle');

    const early = newSession(game, null);
    expect(early.receive(ahead, T1)).toEqual({ status: 'stored' });
    trust([early], [step]);
    expect(early.receive(step, T1)).toEqual({ status: 'accepted' });
    // The step was first seen at T1: the deadline runs from there.
    expect(early.view().phase).toBe('shuffle');
    early.tick(T1 + D);
    expect(early.view().phase).toBe('cancelled');
    expect(early.view().forfeits).toEqual([1]);
    expect(early.view().head).toEqual({ id: step.id, seq: 1 });
  });

  it('cancels the game for a stall in the deal: every stalled seat forfeits, whichever seat each claim names (c)', () => {
    const events = [...steps, deals[0] as NostrEvent];
    const s0 = catchUp(game, 0, events, undefined, T1);
    expect(s0.view().pendingSince).toBe(T1);
    expect(s0.timeoutTarget(T1 + D - 1)).toBeNull();
    expect(s0.timeoutTarget(T1 + D)).toBe(1);
    // Seats 1 and 2 are stalled themselves.
    expect(catchUp(game, 1, events, undefined, T1).timeoutTarget(LATE)).toBeNull();
    const a = s0.buildTimeout(1, game.rnd, T1 + D);
    const b = s0.buildTimeout(2, game.rnd, T1 + D);
    const views = [
      [a, b],
      [b, a],
    ].map((pair) => {
      const watcher = catchUp(game, null, events, undefined, T1);
      expect(statuses(deliver([watcher], pair, undefined, T1 + D))).toEqual(['accepted', 'duplicate']);
      const v = watcher.view();
      expect(v.phase).toBe('cancelled');
      expect(v.outcome).toBeNull();
      expect(v.forfeits).toEqual([1, 2]);
      // The fold stops: a late deal changes nothing.
      expect(watcher.receive(deals[1], LATE)).toEqual({ status: 'stored' });
      expect(watcher.view().phase).toBe('cancelled');
      return canonicalJson(watcher.view());
    });
    expect(views[0]).toBe(views[1]);
  });

  it('does not count a useless share as progress: a stalled seat cannot put its own deadline off (Ruling 11)', () => {
    const events = [...steps, deals[0] as NostrEvent];
    // Seat 1 publishes one of the shares it owes, half a deadline in: it is still stalled.
    const drip = finalizeEvent(
      sharesTemplate(
        { rootId: game.rootId, shares: parseShares(deals[1] as NostrEvent).shares.slice(0, 1) },
        T1,
      ),
      game.ids[1]?.sessionSk as Uint8Array,
      game.rnd,
    );
    const watcher = catchUp(game, null, events, undefined, T1);
    expect(watcher.receive(drip, T1 + D / 2)).toEqual({ status: 'accepted' });
    expect(watcher.view().pendingSince).toBe(T1);
    expect(watcher.receive(claim(game, 0, 1, watcher.view().head.id, T1), T1 + D)).toEqual({
      status: 'accepted',
    });
    expect(watcher.view().forfeits).toEqual([1, 2]);

    // A whole deal removes its seat from the stall set: that is progress.
    const other = catchUp(game, null, events, undefined, T1);
    expect(other.receive(deals[2], T1 + D / 2)).toEqual({ status: 'accepted' });
    expect(other.view().pendingSince).toBe(T1 + D / 2);
    const c = claim(game, 0, 1, other.view().head.id, T1);
    expect(other.receive(c, T1 + D)).toEqual({ status: 'stored' });
    other.tick(T1 + D / 2 + D);
    expect(other.view().phase).toBe('cancelled');
    expect(other.view().forfeits).toEqual([1]);
  });

  it('judges a stored claim after the progress an event makes: the same result in either order', () => {
    // Seats 1 and 2 are stalled. Seat 2 claims, then deals: its deal is progress, so seat 1 gets a fresh deadline.
    const events = [...steps, deals[0] as NostrEvent];
    const c = claim(game, 2, 1, (steps[SEATS - 1] as NostrEvent).id, T1);
    const views = [
      [
        [c, T1 + D],
        [deals[2] as NostrEvent, T1 + D + 1],
      ],
      [
        [deals[2] as NostrEvent, T1 + D],
        [c, T1 + D + 1],
      ],
    ].map((timed) => {
      const watcher = catchUp(game, null, events, undefined, T1);
      for (const [ev, at] of timed as [NostrEvent, number][]) watcher.receive(ev, at);
      expect(watcher.view().phase).toBe('deal');
      expect(watcher.view().forfeits).toEqual([]);
      const p = watcher.view().pendingSince;
      watcher.tick(p + D - 1);
      expect(watcher.view().phase).toBe('deal');
      watcher.tick(p + D);
      expect(watcher.view().phase).toBe('cancelled');
      expect(watcher.view().forfeits).toEqual([1]);
      return p;
    });
    // P is when the deal was first seen, in each order.
    expect(views).toEqual([T1 + D + 1, T1 + D]);
  });

  it('keeps the 4 lowest-id claims per signer per head, whatever the arrival order', () => {
    const root = game.rootId;
    const six = [0, 1, 2, 3, 4, 5]
      .map((i) => claim(game, 1, 0, root, T0 + i))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const keptBy = (order: NostrEvent[]): string[] => {
      const watcher = newSession(game, null);
      for (const ev of order) watcher.receive(ev, ROOT_SEEN);
      // Delivered again: the kept ones are still waiting (`duplicate`), the rest hit the limit.
      return six.map((ev) => {
        const r = watcher.receive(ev, ROOT_SEEN);
        return r.status === 'rejected' ? r.reason : r.status;
      });
    };
    const want = ['duplicate', 'duplicate', 'duplicate', 'duplicate', 'claim limit', 'claim limit'];
    expect(keptBy(six)).toEqual(want);
    expect(keptBy([...six].reverse())).toEqual(want);

    // Another signer has its own allowance; the kept claims still decide.
    const watcher = newSession(game, null);
    for (const ev of six) watcher.receive(ev, ROOT_SEEN);
    expect(watcher.receive(claim(game, 2, 0, root, T0), ROOT_SEEN)).toEqual({ status: 'stored' });
    watcher.tick(LATE);
    expect(watcher.view().phase).toBe('cancelled');
    expect(watcher.view().forfeits).toEqual([0]);
  });

  it('keeps at most 8 claims per signer naming heads it has not seen', () => {
    const watcher = newSession(game, null);
    const head = (i: number): Hex => i.toString(16).padStart(64, 'a');
    for (let i = 0; i < 8; i++) {
      expect(watcher.receive(claim(game, 1, 0, head(i), T0), ROOT_SEEN)).toEqual({ status: 'stored' });
    }
    expect(watcher.receive(claim(game, 1, 0, head(8), T0), ROOT_SEEN)).toEqual(rejected('claim limit'));
    expect(watcher.receive(claim(game, 2, 0, head(8), T0), ROOT_SEEN)).toEqual({ status: 'stored' });
  });
});

/** The uniform fuzz policy, except that it declares the end whenever it may, so games end quickly. */
function choose(legal: readonly unknown[], rng: Rng): unknown {
  return (legal as Action[]).find((a) => a.declareEnd === true) ?? rng.pick(legal);
}

describe('timeouts during play and at the end', () => {
  // A short game: the end may be declared once a chain reaches 4 tiles.
  const game = makeGame(SEATS, 'client-timeout-play', { ...chainReaction.defaultRules(), endSize: 4 });
  let players: GameSession[];
  let spectator: GameSession;
  /** The shuffle steps and the deals. */
  let setup: NostrEvent[];
  let moves: NostrEvent[];
  /** The spectator's module events after each move. */
  let eventsAt: (readonly unknown[])[];
  let lastAt = 0;

  beforeAll(() => {
    players = [0, 1, 2].map((seat) => newSession(game, seat));
    spectator = newSession(game, null);
    const all = [...players, spectator];
    setup = shuffleAll(game, players, [spectator]);
    const deals = players.map((s, k) => s.buildDeal(game.rnd, T0 + 200 + k));
    deliver(all, deals);
    setup.push(...deals);
    moves = [];
    eventsAt = [];
    const rng = createRng('client-timeout-play-policy');
    let t = T0 + 1000;
    while (spectator.view().phase === 'play') {
      if (moves.length > 500) throw new Error('the game does not end');
      const pending = spectator.view().pending;
      if (pending.type !== 'player') throw new Error('no player decision is pending');
      const s = players[pending.seat] as GameSession;
      const ev = s.buildAction(choose(s.legalActions(), rng), game.rnd, t++);
      const results = statuses(deliver(all, [ev]));
      if (results.some((r) => r !== 'accepted'))
        throw new Error(`move ${moves.length}: ${results.join(', ')}`);
      moves.push(ev);
      eventsAt.push(spectator.view().events);
    }
    lastAt = t;
  }, LONG);

  /** The index of a move that passes the turn to another seat, with a move before it. */
  const turnPassing = (): number => {
    const seatOf = (ev: NostrEvent): number => actionOf(ev).actor;
    return moves.findIndex(
      (ev, i) => i > 0 && i + 1 < moves.length && seatOf(ev) !== seatOf(moves[i + 1] as NostrEvent),
    );
  };

  it('owes no share duty in the end phase, though drawn tiles are not all shared: the secrets reveal them', () => {
    const v = spectator.view();
    expect(v.phase).toBe('end');
    const state = v.state as ChainReactionState;
    const owing = [0, 1, 2].filter((k) => unshared(game, [...setup, ...moves], state, k).length > 0);
    expect(owing.length).toBeGreaterThan(0);
    for (const s of players) expect(s.duties()).toEqual([{ kind: 'secret' }]);
  });

  it('cancels the game for a stall before the first game action', () => {
    const watcher = catchUp(game, null, setup, undefined, T1);
    const first = (watcher.view().pending as { seat: number }).seat;
    const claimant = (first + 1) % SEATS;
    const s = catchUp(game, claimant, setup, undefined, T1);
    expect(watcher.view().pendingSince).toBe(T1);
    expect(s.timeoutTarget(T1 + D - 1)).toBeNull();
    expect(s.timeoutTarget(T1 + D)).toBe(first);
    const ev = s.buildTimeout(first, game.rnd, T1 + D);
    expect(watcher.receive(ev, T1 + D)).toEqual({ status: 'accepted' });
    const v = watcher.view();
    expect(v.phase).toBe('cancelled');
    expect(v.outcome).toBeNull();
    expect(v.forfeits).toEqual([first]);
  });

  it('ends the game by forfeit for a stall in mid-play, ranking the others by standings, for good', () => {
    expect(moves.length).toBeGreaterThan(4);
    const k = 3;
    const prefix = [...setup, ...moves.slice(0, k)];
    const watcher = catchUp(game, null, prefix, undefined, T1);
    // The module event log matches the one the live spectator had at that point.
    expect(watcher.view().events).toEqual(eventsAt[k - 1]);
    const stalled = (watcher.view().pending as { seat: number }).seat;
    const claimant = (stalled + 1) % SEATS;
    const other = (stalled + 2) % SEATS;
    const s = catchUp(game, claimant, prefix, undefined, T1);
    const due = T1 + D;
    expect(s.timeoutTarget(due - 1)).toBeNull();
    expect(s.timeoutTarget(due)).toBe(stalled);
    expect(() => s.buildTimeout(other, game.rnd, due)).toThrow(ClientError);
    const head = watcher.view().head;

    const ev = s.buildTimeout(stalled, game.rnd, due);
    expect(statuses(deliver([watcher, s], [ev], undefined, due))).toEqual(['accepted', 'accepted']);
    for (const x of [watcher, s]) {
      const v = x.view();
      expect(v.phase).toBe('done');
      // The audit cannot run without every secret; it records the forfeit (D030 Ruling 7).
      expect(v.audit).toEqual({ fail: [stalled], reason: 'timeout' });
      expect(v.forfeits).toEqual([stalled]);
      const standings = chainReaction.standings(v.state as ChainReactionState);
      expect(v.outcome).toEqual(rankWithForfeits(standings, [stalled], null));
      expect(v.outcome?.reason).toBe('forfeit');
      expect(v.outcome?.places[stalled]).toBe(SEATS);
      // The result can be attested; nothing else is due.
      expect(x.duties()).toEqual(x === s ? [{ kind: 'attest' }] : []);
      expect(x.legalActions()).toEqual([]);
      expect(x.timeoutTarget(LATE)).toBeNull();
    }
    // The outcome is final: the stalled seat's move, arriving now, is stored and changes nothing; nor does a
    // second claim naming another seat.
    expect(watcher.receive(moves[k], due + 1)).toEqual({ status: 'stored' });
    expect(watcher.view().head).toEqual(head);
    expect(watcher.receive(ev, LATE)).toEqual({ status: 'duplicate' });
    expect(watcher.receive(claim(game, claimant, other, head.id, T0), LATE)).toEqual({ status: 'duplicate' });
    expect(watcher.view().forfeits).toEqual([stalled]);

    // A reload that feeds the same events in first-seen order reaches the same result.
    const reloaded = replay(game, null, [
      ...prefix.map((e) => [e, T1] as const),
      [ev, due] as const,
      [moves[k] as NostrEvent, due + 1] as const,
    ]);
    expect(canonicalJson(reloaded.view())).toBe(canonicalJson(watcher.view()));
  });

  it('a move dated far ahead does not dodge a claim: the deadline runs from when it was first seen (a)', () => {
    const k = turnPassing();
    expect(k).toBeGreaterThan(0);
    const x = actionOf(moves[k] as NostrEvent).actor;
    const prefix = [...setup, ...moves.slice(0, k)];
    const sx = catchUp(game, x, prefix, undefined, T1);
    const ev = sx.buildAction(actionOf(moves[k] as NostrEvent), game.rnd, T0 + FAR);
    const seen = T1 + 100;
    const watcher = catchUp(game, null, prefix, undefined, T1);
    for (const s of [watcher, sx]) expect(s.receive(ev, seen)).toEqual({ status: 'accepted' });
    expect(watcher.view().pendingSince).toBe(seen);
    const y = (watcher.view().pending as { seat: number }).seat;
    expect(y).not.toBe(x);
    // The seat after X misses its deadline; X claims at seen + D, by its local clock.
    expect(sx.timeoutTarget(seen + D - 1)).toBeNull();
    expect(sx.timeoutTarget(seen + D)).toBe(y);
    const c = sx.buildTimeout(y, game.rnd, seen + D);
    expect(watcher.receive(c, seen + D - 1)).toEqual({ status: 'stored' });
    watcher.tick(seen + D);
    expect(watcher.view().phase).toBe('done');
    expect(watcher.view().forfeits).toEqual([y]);
  });

  it('a backdated move published late gives the next seat a full deadline from when it was seen (b)', () => {
    const k = turnPassing();
    const x = actionOf(moves[k] as NostrEvent).actor;
    const prefix = [...setup, ...moves.slice(0, k)];
    const sx = catchUp(game, x, prefix, undefined, T1);
    // X sits out its own deadline, then publishes a move dated long before.
    const ev = sx.buildAction(actionOf(moves[k] as NostrEvent), game.rnd, T0 - FAR);
    const seen = T1 + D + 5;
    const watcher = catchUp(game, null, prefix, undefined, T1);
    expect(watcher.receive(ev, seen)).toEqual({ status: 'accepted' });
    const y = (watcher.view().pending as { seat: number }).seat;
    const z = [0, 1, 2].find((s) => s !== x && s !== y) ?? x;
    const sz = catchUp(game, z, [...prefix, ev], undefined, seen);
    expect(sz.timeoutTarget(seen + 1)).toBeNull();
    expect(sz.timeoutTarget(seen + D - 1)).toBeNull();
    expect(sz.timeoutTarget(seen + D)).toBe(y);
    // An early claim against Y waits.
    expect(watcher.receive(claim(game, z, y, ev.id, T0), seen + 1)).toEqual({ status: 'stored' });
    expect(watcher.view().phase).toBe('play');
    watcher.tick(seen + D - 1);
    expect(watcher.view().phase).toBe('play');
    watcher.tick(seen + D);
    expect(watcher.view().phase).toBe('done');
    expect(watcher.view().forfeits).toEqual([y]);
  });

  it('reproduces P when the same events are fed again with their first-seen times (d)', () => {
    const prefix = [...setup, ...moves.slice(0, 4)];
    const timed = prefix.map((ev, i) => [ev, T1 + 60 * i] as const);
    const a = replay(game, 0, timed);
    const last = T1 + 60 * (prefix.length - 1);
    expect(a.view().pendingSince).toBe(last);
    for (const order of [timed, [...timed].reverse()]) {
      const b = replay(game, 0, order);
      expect(b.view().pendingSince).toBe(last);
      for (const now of [last + D - 1, last + D]) expect(b.timeoutTarget(now)).toBe(a.timeoutTarget(now));
    }
  });

  it('judges a stored claim at the end after the progress a secret makes, in either order', () => {
    const secret = (k: number): NostrEvent => {
      const id = game.ids[k] as Identity;
      return finalizeEvent(
        secretTemplate({ rootId: game.rootId, deckSecret: id.deckSecret }, T0),
        id.sessionSk,
        game.rnd,
      );
    };
    const head = (moves[moves.length - 1] as NostrEvent).id;
    // Seat 0's secret is in; seats 1 and 2 withhold theirs. Seat 1 claims, then reveals its own.
    const c = claim(game, 1, 2, head, T0);
    const results = [
      [c, secret(1)],
      [secret(1), c],
    ].map((pair) => {
      const watcher = catchUp(game, null, [...setup, ...moves], undefined, T1);
      expect(watcher.view().phase).toBe('end');
      expect(watcher.receive(secret(0), T1)).toEqual({ status: 'accepted' });
      watcher.receive(pair[0], T1 + D);
      watcher.receive(pair[1], T1 + D + 1);
      // Seat 2 has a fresh deadline from the later secret, whichever came first.
      expect(watcher.view().phase).toBe('end');
      const p = watcher.view().pendingSince;
      watcher.tick(p + D);
      const v = watcher.view();
      expect(v.phase).toBe('done');
      expect(v.audit).toEqual({ fail: [2], reason: 'withheld secret' });
      return [p, canonicalJson({ ...v, pendingSince: 0 })];
    });
    expect(results.map(([p]) => p)).toEqual([T1 + D + 1, T1 + D]);
    expect(results[0]?.[1]).toBe(results[1]?.[1]);
  });

  it('keeps the module events of the canonical chain, frozen, from the setup reveals to the end', () => {
    const v = spectator.view();
    expect(Object.isFrozen(v.events)).toBe(true);
    expect(v.events.length).toBeLessThanOrEqual(300);
    const types = (eventsAt[0] as { type: string }[]).map((e) => e.type);
    expect(types.slice(0, SEATS)).toEqual(Array(SEATS).fill('setupTileRevealed'));
    expect(types).toContain('firstPlayer');
    expect((v.events[v.events.length - 1] as { type: string }).type).toBe('gameEnded');
    // Every seat's log has the same public events; a seat's own learns may add to it.
    for (const p of players) expect(p.view().events.length).toBeGreaterThanOrEqual(v.events.length);
  });

  it('keeps only the last 300 events', () => {
    const s = newSession(game, null);
    const record = (s as unknown as { record(e: readonly unknown[]): void }).record.bind(s);
    record(Array.from({ length: 250 }, (_, i) => ({ type: 'test', i })));
    record(Array.from({ length: 100 }, (_, i) => ({ type: 'test', i: 250 + i })));
    const events = s.view().events as { i: number }[];
    expect(events.length).toBe(300);
    expect(events[0]?.i).toBe(50);
    expect(events[299]?.i).toBe(349);
  });

  it('ends the game with the withheld secret failed when a seat does not reveal it in time', () => {
    const all = [...players, spectator];
    for (const v of all.map((s) => s.view())) expect(v.phase).toBe('end');
    const secrets = [0, 1].map((k) => (players[k] as GameSession).buildSecret(game.rnd, lastAt + k));
    // Each secret removes its seat from the stall set: progress, first seen at NOW + 10 and NOW + 11.
    for (const [i, ev] of secrets.entries()) {
      expect(statuses(deliver(all, [ev], undefined, NOW + 10 + i))).toEqual(Array(4).fill('accepted'));
    }
    const due = NOW + 11 + D;
    expect(spectator.view().pendingSince).toBe(NOW + 11);
    const s0 = players[0] as GameSession;
    expect(s0.timeoutTarget(due - 1)).toBeNull();
    expect(s0.timeoutTarget(due)).toBe(2);
    expect((players[2] as GameSession).timeoutTarget(LATE)).toBeNull();
    const ev = s0.buildTimeout(2, game.rnd, due);
    expect(statuses(deliver(all, [ev], undefined, due))).toEqual(Array(4).fill('accepted'));

    const declared = chainReaction.outcome(spectator.view().state as ChainReactionState);
    expect(declared).not.toBeNull();
    const views = all.map((s) => s.view());
    for (const v of views) {
      expect(v.phase).toBe('done');
      expect(v.audit).toEqual({ fail: [2], reason: 'withheld secret' });
      expect(v.forfeits).toEqual([2]);
      expect(v.outcome).toEqual(rankWithForfeits(declared?.scores ?? [], [2], declared?.places ?? []));
      expect(v.outcome?.places[2]).toBe(SEATS);
    }
    expect(new Set(views.map((v) => canonicalJson([v.outcome, v.audit, v.logHash]))).size).toBe(1);
    // The result can be attested; the late secret changes nothing.
    expect(s0.duties()).toEqual([{ kind: 'attest' }]);
    const late = finalizeEvent(
      (players[2] as GameSession).attestTemplate(LATE),
      game.npubSks[2] as Uint8Array,
      game.rnd,
    );
    expect(spectator.receive(late, LATE)).toEqual({ status: 'accepted' });
    expect(spectator.view().attested).toEqual([2]);
    const before = canonicalJson(spectator.view());
    expect(() => (players[2] as GameSession).buildSecret(game.rnd, LATE)).toThrow(ClientError);
    const id2 = game.ids[2] as Identity;
    const secret = finalizeEvent(
      secretTemplate({ rootId: game.rootId, deckSecret: id2.deckSecret }, LATE),
      id2.sessionSk,
      game.rnd,
    );
    expect(spectator.receive(secret, LATE)).toEqual({ status: 'stored' });
    expect(canonicalJson(spectator.view())).toBe(before);
  });
});

/**
 * Chain Reaction with each seat's first hand position left out of `dealt` until the setup tiles are revealed, so
 * the deal round does not cover it: once play starts, the first player needs every other seat's share of it.
 */
const lateFirstSlots: GameModule<unknown, { readonly type: string }, unknown> = {
  ...(chainReaction as unknown as GameModule<unknown, { readonly type: string }, unknown>),
  dealt(state) {
    const all = chainReaction.dealt(state as ChainReactionState);
    if ((state as ChainReactionState).phase.kind !== 'setup') return all;
    return all.filter((d) => d.to === null || (d.pos - SEATS) % HAND !== 0);
  },
};

describe('timeouts: a pending seat that waits for other seats’ shares', () => {
  const game = makeGame(SEATS, 'client-timeout-wait');
  const modules = new Map([[chainReaction.id, lateFirstSlots]]);
  let players: GameSession[];
  let finalDeck: Ciphertext[];
  let first = -1;

  /** Seat `k`'s Shares event for every other seat's first hand position. */
  function firstSlotShares(k: number, createdAt: number): NostrEvent {
    const id = game.ids[k] as Identity;
    const shares = [0, 1, 2]
      .filter((j) => j !== k)
      .map((j) => {
        const pos = SEATS + j * HAND;
        const ctx = { rootId: game.rootId, deckId: 'tiles', pos };
        return { pos, share: makeShare(id.deckSecret, finalDeck[pos] as Ciphertext, ctx, game.rnd) };
      });
    return finalizeEvent(sharesTemplate({ rootId: game.rootId, shares }, createdAt), id.sessionSk, game.rnd);
  }

  beforeAll(() => {
    players = [0, 1, 2].map((seat) =>
      GameSession.create({
        modules,
        table: game.table,
        joins: game.joins,
        root: game.root,
        me: game.ids[seat] as Identity,
        rootSeenAt: ROOT_SEEN,
      }),
    );
    const steps = shuffleAll(game, players);
    finalDeck = (parseMove(steps[SEATS - 1], DECK).content as { deck: Ciphertext[] }).deck;
    deliver(
      players,
      players.map((s, k) => s.buildDeal(game.rnd, T0 + 200 + k)),
    );
    first = ((players[0] as GameSession).view().pending as { seat: number }).seat;
  });

  it('blames the seats whose shares the pending seat needs, then the pending seat once they are in', () => {
    const f = players[first] as GameSession;
    const [k1, k2] = [0, 1, 2].filter((k) => k !== first) as [number, number];
    const view = (k: number): SessionView => (players[k] as GameSession).view();
    expect(view(first).phase).toBe('play');
    // Every seat owes its shares of the others' first tiles (D039); the first player cannot decide, since one of
    // its tiles is still hidden from it.
    const owes = (k: number) => ({
      kind: 'share',
      positions: [0, 1, 2].filter((j) => j !== k).map((j) => SEATS + j * HAND),
    });
    for (const k of [0, 1, 2]) expect(players[k]?.duties()).toEqual([owes(k)]);
    expect(f.timeoutTarget(LATE)).toBe(k1);
    // The seats it waits for are stalled themselves, so they cannot claim.
    expect(players[k1]?.timeoutTarget(LATE)).toBeNull();
    expect(players[k2]?.timeoutTarget(LATE)).toBeNull();
    const head = view(first).head.id;
    // Kept, though rejected now: it is judged again as the fold and the clock move.
    expect(players[k1]?.receive(claim(game, k1, first, head, LATE), NOW)).toEqual(
      rejected(`the claimant, seat ${k1}, is stalled at the head`),
    );

    // Each Shares event removes a seat from the stall set: progress (Ruling 11).
    deliver(players, [firstSlotShares(k1, T0)], undefined, NOW + 100);
    expect(view(first).pendingSince).toBe(NOW + 100);
    expect(f.duties()).toEqual([owes(first)]);
    expect(players[k1]?.duties()).toEqual([]);
    expect(f.timeoutTarget(LATE)).toBe(k2);
    expect(players[k1]?.timeoutTarget(LATE)).toBe(k2);
    expect(players[k2]?.timeoutTarget(LATE)).toBeNull();

    deliver(players, [firstSlotShares(k2, T0)], undefined, NOW + 200);
    expect(view(first).pendingSince).toBe(NOW + 200);
    expect(f.duties()).toEqual([owes(first), { kind: 'decide' }]);
    expect(f.timeoutTarget(LATE)).toBeNull();
    expect(players[k1]?.timeoutTarget(NOW + 200 + D - 1)).toBeNull();
    expect(players[k1]?.timeoutTarget(NOW + 200 + D)).toBe(first);
    expect(players[k2]?.timeoutTarget(LATE)).toBe(first);
    // The claim kept earlier counts once k1's own clock passes the deadline from the last progress.
    players[k1]?.tick(NOW + 200 + D - 1);
    expect(view(k1).phase).toBe('play');
    players[k1]?.tick(NOW + 200 + D);
    // No game action yet: the game is cancelled.
    expect(view(k1).phase).toBe('cancelled');
    expect(view(k1).forfeits).toEqual([first]);
  });
});
