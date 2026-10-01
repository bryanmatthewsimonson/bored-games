import { type ChainReactionState, chainReaction } from '@bored-games/chain-reaction';
import { type Ciphertext, makeShare } from '@bored-games/deck';
import { canonicalJson, createRng, type GameModule, type Rng } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type Hex,
  type NostrEvent,
  parseMove,
  secretTemplate,
  sharesTemplate,
  timeoutTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { rankWithForfeits } from '../src/audit.ts';
import { ClientError } from '../src/errors.ts';
import { GameSession } from '../src/session.ts';
import type { Identity, SessionView } from '../src/types.ts';
import { deliver, makeGame, newSession, statuses, T0, type TestGame } from './helpers.ts';

const SEATS = 3;
const HAND = 6;
const DECK = 108;
/** The test table's deadline: three days. */
const D = 259_200;
/** The root's `created_at` (see `makeGame`), the first baseline of the deadline. */
const ROOT_AT = T0 + 10;
/** A local clock reading past every deadline in these tests. */
const LATE = T0 + 10_000_000;
const LONG = 600_000;

type Action = { type: string; actor: number; declareEnd?: boolean };

/*
 * Shuffle proofs take about a second each to verify, and they are covered in shuffle-phase.test.ts. These tests
 * mark the steps they publish as already verified in each session that receives them (a test-only shortcut
 * through a private field), so a fresh session can catch up on a game cheaply.
 */
function trust(sessions: readonly GameSession[], events: readonly NostrEvent[]): void {
  for (const s of sessions) {
    const checked = (s as unknown as { shuffleChecked: Map<Hex, boolean> }).shuffleChecked;
    for (const ev of events) checked.set(ev.id, true);
  }
}

/** Each seat builds its shuffle step in turn; every step goes to every session. Returns the steps. */
function shuffleAll(game: TestGame, players: readonly GameSession[], others: readonly GameSession[] = []) {
  const steps: NostrEvent[] = [];
  for (const [k, s] of players.entries()) {
    const ev = s.buildShuffle(game.rnd, T0 + 100 + k);
    trust([...players, ...others], [ev]);
    deliver([...players, ...others], [ev]);
    steps.push(ev);
  }
  return steps;
}

/** A fresh session for `seat` (null: a spectator) that has accepted every one of `events`. */
function catchUp(
  game: TestGame,
  seat: number | null,
  events: readonly NostrEvent[],
  // biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
  modules: ReadonlyMap<string, GameModule<any, any, any>> = game.modules,
): GameSession {
  const s = GameSession.create({
    modules,
    table: game.table,
    joins: game.joins,
    root: game.root,
    me: seat === null ? null : (game.ids[seat] as Identity),
  });
  trust([s], events);
  const results = statuses(deliver([s], events, undefined, LATE));
  if (results.some((r) => r !== 'accepted')) throw new Error(`catch-up: ${results.join(', ')}`);
  return s;
}

/** A Timeout claim by seat `by` against `seat` at head `headId`, built by hand. */
function claim(game: TestGame, by: number, seat: number, headId: Hex, createdAt: number): NostrEvent {
  const sk = game.ids[by]?.sessionSk as Uint8Array;
  return finalizeEvent(timeoutTemplate({ rootId: game.rootId, headId, seat }, createdAt), sk, game.rnd);
}

const rejected = (reason: string) => ({ status: 'rejected', reason });

describe('timeouts during the shuffle and the deal', () => {
  const game = makeGame(SEATS, 'client-timeout-setup');
  let steps: NostrEvent[];
  /** Each seat's deal, dated T0 + 200 + seat. */
  let deals: NostrEvent[];
  /** Seat 2's deal dated far ahead. */
  let farDeal: NostrEvent;
  const FAR = T0 + 1_000_000_000;

  beforeAll(() => {
    const players = [0, 1, 2].map((seat) => newSession(game, seat));
    steps = shuffleAll(game, players);
    deals = players.map((s, k) => s.buildDeal(game.rnd, T0 + 200 + k));
    farDeal = (players[2] as GameSession).buildDeal(game.rnd, FAR);
  });

  it('names the next shuffler once the deadline has passed since the root, and builds a claim only then', () => {
    const [s0, s1] = [newSession(game, 0), newSession(game, 1)];
    const watcher = newSession(game, null);
    expect(s1.timeoutTarget(ROOT_AT + D - 1)).toBeNull();
    expect(s1.timeoutTarget(ROOT_AT + D)).toBe(0);
    // The stalled seat cannot claim against itself; a spectator claims nothing.
    expect(s0.timeoutTarget(LATE)).toBeNull();
    expect(watcher.timeoutTarget(LATE)).toBeNull();
    expect(() => s1.buildTimeout(0, game.rnd, ROOT_AT + D - 1)).toThrow(ClientError);
    expect(() => s1.buildTimeout(1, game.rnd, LATE)).toThrow(ClientError);
    expect(() => s1.buildTimeout(2, game.rnd, LATE)).toThrow(ClientError);
    expect(() => watcher.buildTimeout(0, game.rnd, LATE)).toThrow(ClientError);
  });

  it('stores a claim the local clock has not reached yet, and accepts it on tick once it has', () => {
    const s0 = newSession(game, 0);
    const watcher = newSession(game, null);
    const ev = newSession(game, 1).buildTimeout(0, game.rnd, ROOT_AT + D);
    // One second early by the local clock.
    expect(watcher.receive(ev, ROOT_AT + D - 1)).toEqual({ status: 'stored' });
    expect(watcher.view().phase).toBe('shuffle');
    watcher.tick(ROOT_AT + D - 1);
    expect(watcher.view().phase).toBe('shuffle');
    watcher.tick(ROOT_AT + D);
    const v = watcher.view();
    expect(v.phase).toBe('cancelled');
    expect(v.outcome).toBeNull();
    expect(v.audit).toBe('pending');
    expect(v.forfeits).toEqual([0]);
    expect(watcher.receive(ev, LATE)).toEqual({ status: 'duplicate' });

    // The stalled seat sees it too; nothing is due from anyone any more.
    expect(s0.duties()).toEqual([{ kind: 'shuffle' }]);
    expect(s0.receive(ev, LATE)).toEqual({ status: 'accepted' });
    expect(s0.view().phase).toBe('cancelled');
    expect(s0.duties()).toEqual([]);
    expect(() => s0.buildShuffle(game.rnd, LATE)).toThrow(ClientError);
  });

  it("does not accept a claim dated past the deadline until the local clock reaches the claim's date", () => {
    const watcher = newSession(game, null);
    const ev = newSession(game, 1).buildTimeout(0, game.rnd, ROOT_AT + D + 50);
    // The local clock has not reached the deadline.
    expect(watcher.receive(ev, ROOT_AT + D - 10)).toEqual({ status: 'stored' });
    // Past the deadline, but before the claim's date.
    watcher.tick(ROOT_AT + D + 49);
    expect(watcher.view().phase).toBe('shuffle');
    watcher.tick(ROOT_AT + D + 50);
    expect(watcher.view().phase).toBe('cancelled');
    expect(watcher.view().forfeits).toEqual([0]);
  });

  it('rejects a claim dated before the deadline, against a seat that is not stalled, or by the stalled seat', () => {
    const watcher = newSession(game, null);
    const root = game.rootId;
    expect(watcher.receive(claim(game, 1, 0, root, ROOT_AT + D - 1), LATE)).toEqual(
      rejected('the claim is dated before the deadline'),
    );
    expect(watcher.receive(claim(game, 1, 2, root, ROOT_AT + D), LATE)).toEqual(
      rejected('seat 2 is not stalled at the head'),
    );
    expect(watcher.receive(claim(game, 0, 0, root, ROOT_AT + D), LATE)).toEqual(
      rejected('a seat cannot claim a timeout against itself'),
    );
    expect(watcher.receive(claim(game, 1, 5, root, ROOT_AT + D), LATE)).toEqual(
      rejected('there is no seat 5'),
    );
    const byNpub = finalizeEvent(
      timeoutTemplate({ rootId: root, headId: root, seat: 0 }, ROOT_AT + D),
      game.npubSks[1] as Uint8Array,
      game.rnd,
    );
    expect(watcher.receive(byNpub, LATE)).toEqual(rejected('not signed by a seated session key'));
    expect(watcher.view().phase).toBe('shuffle');
    expect(watcher.view().forfeits).toEqual([]);
  });

  it('rejects a claim against an old head, and holds one against a head it has not seen yet', () => {
    const step = steps[0] as NostrEvent;
    const old = claim(game, 1, 0, game.rootId, step.created_at + D);
    const ahead = claim(game, 2, 1, step.id, step.created_at + D);

    const late = catchUp(game, null, [step]);
    expect(late.receive(old, LATE)).toEqual(rejected('the claim names an old head'));
    expect(late.view().phase).toBe('shuffle');

    const early = newSession(game, null);
    expect(early.receive(ahead, LATE)).toEqual({ status: 'stored' });
    expect(early.view().phase).toBe('shuffle');
    trust([early], [step]);
    expect(early.receive(step, LATE)).toEqual({ status: 'accepted' });
    expect(early.view().phase).toBe('cancelled');
    expect(early.view().forfeits).toEqual([1]);
    expect(early.view().head).toEqual({ id: step.id, seq: 1 });
  });

  it('cancels the game for a stall in the deal, against a seat whose deal is missing', () => {
    const events = [...steps, deals[0] as NostrEvent];
    const watcher = catchUp(game, null, events);
    const s0 = catchUp(game, 0, events);
    const due = T0 + 200 + D;
    expect(watcher.view().pendingSince).toBe(T0 + 200);
    expect(s0.timeoutTarget(due - 1)).toBeNull();
    expect(s0.timeoutTarget(due)).toBe(1);
    const ev = s0.buildTimeout(1, game.rnd, due);
    expect(statuses(deliver([watcher, s0], [ev], undefined, due))).toEqual(['accepted', 'accepted']);
    for (const s of [watcher, s0]) {
      const v = s.view();
      expect(v.phase).toBe('cancelled');
      expect(v.outcome).toBeNull();
      expect(v.forfeits).toEqual([1]);
    }
    expect(s0.timeoutTarget(LATE)).toBeNull();
    expect(() => s0.buildTimeout(2, game.rnd, LATE)).toThrow(ClientError);
    // The fold stops: a late deal changes nothing.
    expect(watcher.receive(deals[1], LATE)).toEqual({ status: 'stored' });
    expect(watcher.view().phase).toBe('cancelled');
  });

  it('ignores events dated after the claim: a deal dated far ahead does not put the claim off', () => {
    const events = [...steps, deals[0] as NostrEvent, farDeal];
    const watcher = catchUp(game, null, events);
    const s0 = catchUp(game, 0, events);
    const due = T0 + 200 + D;
    // The view shows the far date; a claim dated before it ignores that deal.
    expect(watcher.view().pendingSince).toBe(FAR);
    expect(s0.timeoutTarget(due - 1)).toBeNull();
    expect(s0.timeoutTarget(due)).toBe(1);
    // As of the claim's date, seat 2 has not dealt either.
    expect(() => s0.buildTimeout(2, game.rnd, due)).not.toThrow();
    const ev = s0.buildTimeout(1, game.rnd, due);
    expect(watcher.receive(ev, due)).toEqual({ status: 'accepted' });
    expect(watcher.view().phase).toBe('cancelled');
    expect(watcher.view().forfeits).toEqual([1]);
  });

  it('decides between valid claims by the lowest id, whatever their arrival order', () => {
    const events = [...steps, deals[0] as NostrEvent];
    const head = (steps[SEATS - 1] as NostrEvent).id;
    const due = T0 + 200 + D;
    const a = claim(game, 0, 1, head, due);
    const b = claim(game, 0, 2, head, due + 1);
    const [low, high] = a.id < b.id ? [a, b] : [b, a];
    const lowSeat = low === a ? 1 : 2;

    const x = catchUp(game, null, events);
    expect(x.receive(low, LATE)).toEqual({ status: 'accepted' });
    expect(x.receive(high, LATE)).toEqual({ status: 'duplicate' });
    const y = catchUp(game, null, events);
    expect(y.receive(high, LATE)).toEqual({ status: 'accepted' });
    expect(y.view().forfeits).toEqual([lowSeat === 1 ? 2 : 1]);
    // The lower id takes over.
    expect(y.receive(low, LATE)).toEqual({ status: 'accepted' });
    for (const s of [x, y]) {
      expect(s.view().phase).toBe('cancelled');
      expect(s.view().forfeits).toEqual([lowSeat]);
    }
    expect(canonicalJson(x.view())).toBe(canonicalJson(y.view()));
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

  it('cancels the game for a stall before the first game action', () => {
    const watcher = catchUp(game, null, setup);
    const first = (watcher.view().pending as { seat: number }).seat;
    const claimant = (first + 1) % SEATS;
    const s = catchUp(game, claimant, setup);
    const due = watcher.view().pendingSince + D;
    expect(watcher.view().pendingSince).toBe(T0 + 202);
    expect(s.timeoutTarget(due - 1)).toBeNull();
    expect(s.timeoutTarget(due)).toBe(first);
    const ev = s.buildTimeout(first, game.rnd, due);
    expect(watcher.receive(ev, due)).toEqual({ status: 'accepted' });
    const v = watcher.view();
    expect(v.phase).toBe('cancelled');
    expect(v.outcome).toBeNull();
    expect(v.forfeits).toEqual([first]);
  });

  it('ends the game by forfeit for a stall in mid-play, ranking the others by standings', () => {
    expect(moves.length).toBeGreaterThan(4);
    const k = 3;
    const prefix = [...setup, ...moves.slice(0, k)];
    const watcher = catchUp(game, null, prefix);
    // The module event log matches the one the live spectator had at that point.
    expect(watcher.view().events).toEqual(eventsAt[k - 1]);
    const stalled = (watcher.view().pending as { seat: number }).seat;
    const claimant = (stalled + 1) % SEATS;
    const other = (stalled + 2) % SEATS;
    const s = catchUp(game, claimant, prefix);
    const due = watcher.view().pendingSince + D;
    expect(watcher.view().pendingSince).toBe((moves[k - 1] as NostrEvent).created_at);
    expect(s.timeoutTarget(due - 1)).toBeNull();
    expect(s.timeoutTarget(due)).toBe(stalled);
    expect(() => s.buildTimeout(other, game.rnd, due)).toThrow(ClientError);
    const head = watcher.view().head;
    expect(watcher.receive(claim(game, claimant, other, head.id, due), LATE)).toEqual(
      rejected(`seat ${other} is not stalled at the head`),
    );

    const ev = s.buildTimeout(stalled, game.rnd, due);
    expect(statuses(deliver([watcher, s], [ev], undefined, due))).toEqual(['accepted', 'accepted']);
    for (const x of [watcher, s]) {
      const v = x.view();
      expect(v.phase).toBe('done');
      expect(v.audit).toBe('pending');
      expect(v.forfeits).toEqual([stalled]);
      const standings = chainReaction.standings(v.state as ChainReactionState);
      expect(v.outcome).toEqual(rankWithForfeits(standings, [stalled], null));
      expect(v.outcome?.reason).toBe('forfeit');
      expect(v.outcome?.places[stalled]).toBe(SEATS);
      // The audit is skipped, so there is nothing to attest, and nothing else is due.
      expect(x.duties()).toEqual([]);
      expect(x.legalActions()).toEqual([]);
      expect(x.timeoutTarget(LATE)).toBeNull();
    }
    // The stalled seat's move, arriving now, changes nothing.
    expect(watcher.receive(moves[k], LATE)).toEqual({ status: 'stored' });
    expect(watcher.view().head).toEqual(head);
    expect(watcher.receive(ev, LATE)).toEqual({ status: 'duplicate' });
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
    expect(statuses(deliver(all, secrets))).toEqual(Array(8).fill('accepted'));
    const due = lastAt + 1 + D;
    expect(spectator.view().pendingSince).toBe(lastAt + 1);
    const s0 = players[0] as GameSession;
    expect(s0.timeoutTarget(due - 1)).toBeNull();
    expect(s0.timeoutTarget(due)).toBe(2);
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
    // The first player cannot decide: one of its tiles is still hidden from it.
    expect(f.duties()).toEqual([]);
    expect(f.timeoutTarget(LATE)).toBe(k1);
    expect(players[k1]?.timeoutTarget(LATE)).toBe(k2);
    expect(players[k2]?.timeoutTarget(LATE)).toBe(k1);
    const head = view(first).head.id;
    const due = view(first).pendingSince + D;
    expect(players[k1]?.receive(claim(game, k1, first, head, due), LATE)).toEqual(
      rejected(`seat ${first} is not stalled at the head`),
    );

    deliver(players, [firstSlotShares(k1, T0 + 300)]);
    expect(f.duties()).toEqual([]);
    expect(f.timeoutTarget(LATE)).toBe(k2);
    expect(players[k2]?.timeoutTarget(LATE)).toBeNull();

    deliver(players, [firstSlotShares(k2, T0 + 301)]);
    expect(f.duties()).toEqual([{ kind: 'decide' }]);
    expect(f.timeoutTarget(LATE)).toBeNull();
    expect(players[k1]?.timeoutTarget(LATE)).toBe(first);
    expect(players[k2]?.timeoutTarget(LATE)).toBe(first);
    // The claim rejected earlier is still too early: the shares moved the game's last progress.
    expect(view(k1).phase).toBe('play');
  });
});
