// biome-ignore-all lint/style/noNonNullAssertion: test fixtures use known seats and steps.

import type { ChainReactionState } from '@bored-games/chain-reaction';
import {
  type Ciphertext,
  cardOf,
  cardTable,
  decryptWithSecrets,
  initialDeck,
  jointKey,
  proveShuffle,
  shuffleDeck,
  verifyShuffle,
} from '@bored-games/deck';
import { range } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type MoveContent,
  moveTemplate,
  type NostrEvent,
  parseMove,
  parseRoot,
  parseShares,
  sharesTemplate,
} from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { createToy } from '../../game-kit/test/toy.ts';
import { ClientError } from '../src/errors.ts';
import type { GameSession } from '../src/session.ts';
import {
  deliver,
  LATE,
  makeGame,
  makeModuleGame,
  NOW,
  newSession,
  statuses,
  T0,
  type TestGame,
  trust,
} from './helpers.ts';

/*
 * Any-order setup shuffles (D093): a root tagged `["shuffle-order","any"]` lets each seat take its block of a
 * round's groups in any order. Chain Reaction has a plain 108-tile deck, one group, so every step is a block; the
 * partitioned toy has two groups, so a block is two steps.
 */

const DECK = 108;
const SEATS = 3;
const HAND = 6;
const ANY = { shuffleOrder: 'any' } as const;
type Shuffle = Extract<MoveContent, { type: 'shuffle' }>;

/** A 3-seat Chain Reaction game, its root tagged any-order unless `seatOrder`, with every seat and a spectator. */
function crGame(seed: string, seatOrder = false) {
  const game = makeGame(SEATS, seed, undefined, seatOrder ? {} : ANY);
  return {
    game,
    players: range(SEATS).map((seat) => newSession(game, seat)),
    spectator: newSession(game, null),
  };
}

const toyModule = createToy();
/** The partitioned toy of `partitioned-deck.test.ts`: 12 cards in two groups, plus an optional second round. */
function toyGame(seed: string, secondRound = false) {
  const module = {
    ...toyModule,
    decks: () => [
      {
        id: 'cards',
        size: 12,
        partitions: [
          { id: 'a', size: 6 },
          { id: 'b', size: 6 },
        ],
        ...(secondRound ? { secondRound: [{ id: 'mix', positions: [1, 2, 3] }] } : {}),
      },
    ],
  };
  const game = makeModuleGame(module, SEATS, seed, undefined, ANY);
  game.modules = new Map([[module.id, module]]);
  return {
    game,
    players: range(SEATS).map((seat) => newSession(game, seat)),
    spectator: newSession(game, null),
  };
}

const shuffleOf = (ev: NostrEvent): Shuffle => parseMove(ev, DECK).content as Shuffle;
const jointKeyOf = (game: TestGame) => jointKey(parseRoot(game.root).seats.map((s) => s.deckKey));

/** `content` as move `seq` after `prevId`, signed by `seat`'s session key and dated `createdAt`. */
function signed(
  game: TestGame,
  seat: number,
  seq: number,
  prevId: string,
  content: MoveContent,
  createdAt = T0 + 500,
): NostrEvent {
  const t = moveTemplate({ rootId: game.rootId, prevId, seq, content }, createdAt);
  return finalizeEvent(t, game.ids[seat]!.sessionSk, game.rnd);
}

/** Seat `seat`'s honest shuffle of the whole of `input` as step `seq` after `prevId`, its proof bound to `seat`. */
function stepBy(
  game: TestGame,
  seat: number,
  seq: number,
  prevId: string,
  input: readonly Ciphertext[],
): NostrEvent {
  const X = jointKeyOf(game);
  const { out, psi, rPrime } = shuffleDeck(input, X, game.rnd);
  const ctx = { rootId: game.rootId, seat, deckId: 'tiles' };
  const proof = proveShuffle(input, out, X, psi, rPrime, ctx, game.rnd);
  return signed(game, seat, seq, prevId, { type: 'shuffle', deck: out, proof });
}

/**
 * `shuffleAll` with the seats in `order`: each builds its step on the head in turn, and every step goes to every
 * session, marked verified there. `players[k]` must be seat k's session. Returns the steps in seq order.
 */
function shuffleInOrder(
  game: TestGame,
  players: readonly GameSession[],
  order: readonly number[],
  others: readonly GameSession[] = [],
): NostrEvent[] {
  return order.map((seat, k) => {
    const ev = players[seat]!.buildShuffle(game.rnd, T0 + 100 + k);
    trust([...players, ...others], [ev]);
    deliver([...players, ...others], [ev]);
    return ev;
  });
}

/** A fresh session of `game` for `seat` (null: a spectator) that trusts `trusted` and has received `events`. */
function holding(
  game: TestGame,
  seat: number | null,
  events: readonly NostrEvent[],
  trusted: readonly NostrEvent[] = events,
): GameSession {
  const s = newSession(game, seat);
  trust([s], trusted);
  deliver([s], events);
  return s;
}

/** The toy's move content: its groups hold 6 cards. */
const toyContent = (ev: NostrEvent): MoveContent => parseMove(ev, 6).content;

/** The shares of Shares event `of`, signed by `seat`'s session key: they fail under that seat's deck key. */
function sharesBy(game: TestGame, seat: number, of: NostrEvent, createdAt: number): NostrEvent {
  const t = sharesTemplate({ rootId: game.rootId, shares: parseShares(of).shares }, createdAt);
  return finalizeEvent(t, game.ids[seat]!.sessionSk, game.rnd);
}

interface SplitDecks {
  game: TestGame;
  /** Every shuffle step of both branches. */
  steps: NostrEvent[];
  /** The winning and the losing branch, in seq order. */
  win: NostrEvent[];
  lose: NostrEvent[];
  /** Seat 0's deal on the losing deck. */
  d0: NostrEvent;
  /** Seats 1 and 2's deals on the winning deck. */
  deals: NostrEvent[];
}

let splitMemo: SplitDecks | null = null;

/**
 * Two complete, honest rival decks of one 3-seat game, built once: seats 1 and 2 race on the root, and the other
 * two seats then finish each branch, seat 0 shuffling on both. Both branches are settled and equally long, so the
 * lower id on the root wins. Seat 0 sees the losing deck before the winner and deals on it; seats 1 and 2 deal on
 * the winning deck.
 */
function splitDecks(): SplitDecks {
  if (splitMemo !== null) return splitMemo;
  const { game } = crGame('any-split');
  const a = newSession(game, 1).buildShuffle(game.rnd, T0 + 100);
  const b = newSession(game, 2).buildShuffle(game.rnd, T0 + 101);
  const a0 = holding(game, 0, [a]).buildShuffle(game.rnd, T0 + 102);
  const a2 = holding(game, 2, [a, a0]).buildShuffle(game.rnd, T0 + 103);
  const b0 = holding(game, 0, [b]).buildShuffle(game.rnd, T0 + 104);
  const b1 = holding(game, 1, [b, b0]).buildShuffle(game.rnd, T0 + 105);
  const [onA, onB] = [
    [a, a0, a2],
    [b, b0, b1],
  ];
  const steps = [...onA, ...onB];
  const [win, lose]: [NostrEvent[], NostrEvent[]] = a.id < b.id ? [onA, onB] : [onB, onA];
  const dealer = holding(game, 0, lose, steps);
  expect(dealer.duties()).toEqual([{ kind: 'deal' }]);
  const d0 = dealer.buildDeal(game.rnd, T0 + 200);
  const deals = [1, 2].map((seat, k) => holding(game, seat, win, steps).buildDeal(game.rnd, T0 + 201 + k));
  splitMemo = { game, steps, win, lose, d0, deals };
  return splitMemo;
}

/** Each session's shuffle duty rank, or null when it owes no shuffle. */
const ranks = (players: readonly GameSession[]) =>
  players.map((s) => {
    const duty = s.duties().find((d) => d.kind === 'shuffle');
    return duty === undefined ? null : duty.rank;
  });

describe('any-order setup shuffle (D093)', () => {
  it('any eligible seat may take the first step, and its proof binds its own seat', () => {
    const { game, players, spectator } = crGame('any-first');
    const all = [...players, spectator];
    for (const s of all) expect(s.view().shuffleOrder).toBe('any');
    const ev = players[2]!.buildShuffle(game.rnd, T0 + 100);
    // The spectator verifies the proof; the players take it as checked, to keep the test quick.
    trust(players, [ev]);
    expect(statuses(deliver(all, [ev]))).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
    for (const s of all) {
      expect(s.view().head).toEqual({ id: ev.id, seq: 1 });
      expect(s.view().equivocators).toEqual([]);
    }
    // The proof's context names the signer, seat 2, not seat 0 as the seat-order schedule would.
    const input = initialDeck('tiles', DECK);
    const { deck, proof } = shuffleOf(ev);
    const ctx = (seat: number) => ({ rootId: game.rootId, seat, deckId: 'tiles' });
    expect(verifyShuffle(input, deck, jointKeyOf(game), proof, ctx(2))).toBe(true);
    expect(verifyShuffle(input, deck, jointKeyOf(game), proof, ctx(0))).toBe(false);
  });

  it('an ineligible signer is refused', () => {
    const { game, players, spectator } = crGame('any-ineligible');
    const first = players[2]!.buildShuffle(game.rnd, T0 + 100);
    trust([...players, spectator], [first]);
    deliver([...players, spectator], [first]);
    // A plain deck is one group, so seat 2's block is done: step 2 is seat 0's or seat 1's.
    expect(players[2]!.duties()).toEqual([]);
    expect(() => players[2]!.buildShuffle(game.rnd, T0 + 101)).toThrow(ClientError);
    const reason = 'shuffle step 2 may not be signed by seat 2';
    // A valid proof does not help: the step is refused at the head...
    const again = stepBy(game, 2, 2, first.id, shuffleOf(first).deck);
    expect(spectator.receive(again, NOW)).toEqual({ status: 'rejected', reason });
    expect(spectator.view().head).toEqual({ id: first.id, seq: 1 });
    // ...and below it, on a client whose chain has moved on. A second such step flags nobody: seat 2 could sign
    // neither, so neither is a well-formed step on that prev.
    const next = players[0]!.buildShuffle(game.rnd, T0 + 102);
    const seat1 = players[1]!;
    trust([seat1], [next]);
    expect(seat1.receive(next, NOW)).toEqual({ status: 'accepted' });
    expect(seat1.receive(again, NOW)).toEqual({ status: 'rejected', reason });
    const twice = signed(game, 2, 2, first.id, shuffleOf(again), T0 + 501);
    expect(seat1.receive(twice, NOW)).toEqual({ status: 'rejected', reason });
    expect(seat1.view().equivocators).toEqual([]);
    expect(seat1.view().head).toEqual({ id: next.id, seq: 2 });
  });

  it('duties rank the eligible seats', () => {
    const { game, players, spectator } = crGame('any-duties');
    expect(players.map((s) => s.duties())).toEqual([
      [{ kind: 'shuffle', rank: 0 }],
      [{ kind: 'shuffle', rank: 1 }],
      [{ kind: 'shuffle', rank: 2 }],
    ]);
    expect(spectator.duties()).toEqual([]);
    shuffleInOrder(game, players, [0], [spectator]);
    expect(players.map((s) => s.duties())).toEqual([
      [],
      [{ kind: 'shuffle', rank: 0 }],
      [{ kind: 'shuffle', rank: 1 }],
    ]);
    shuffleInOrder(game, players, [2], [spectator]);
    expect(ranks(players)).toEqual([null, 0, null]);
  });

  it('stalled and waitingFor name every remaining seat at a block boundary, and the block signer mid-block', () => {
    const { game, players, spectator } = toyGame('any-waiting');
    const all = [...players, spectator];
    // Seat 1, then seat 2, then seat 0, each shuffling both groups.
    const signers = [1, 1, 2, 2, 0, 0];
    const waiting = [[0, 1, 2], [1], [0, 2], [2], [0], [0]];
    for (const [step, signer] of signers.entries()) {
      const due = waiting[step]!;
      for (const s of all) expect(s.waitingFor()).toEqual(due);
      expect(spectator.view().pending).toEqual({ type: 'player', seat: due[0], decision: 'shuffle' });
      expect(ranks(players)).toEqual(
        range(SEATS).map((seat) => (due.includes(seat) ? due.indexOf(seat) : null)),
      );
      const ev = players[signer]!.buildShuffle(game.rnd, NOW);
      expect(statuses(deliver(all, [ev]))).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
    }
    for (const s of all) expect(s.view().phase).toBe('deal');
  });

  it('shuffleProgress counts finished blocks', () => {
    const { game, players, spectator } = toyGame('any-progress');
    const all = [...players, spectator];
    const progress = () => spectator.view().shuffleProgress;
    expect(progress()).toEqual({ round: 1, rounds: 1, seatsDone: 0 });
    for (const [seat, seatsDone] of [
      [2, 0],
      [2, 1],
      [0, 1],
      [0, 2],
    ] as const) {
      deliver(all, [players[seat]!.buildShuffle(game.rnd, NOW)]);
      expect(progress()).toEqual({ round: 1, rounds: 1, seatsDone });
    }
  });

  it('shuffleProgress starts again in the second round, which any seat may open', () => {
    const { game, players, spectator } = toyGame('any-progress-2', true);
    const all = [...players, spectator];
    const progress = () => spectator.view().shuffleProgress;
    // Round 1 in order 2, 0, 1 (two steps each); round 2 (one group) in order 1, 2, 0.
    const plan = [
      [2, 1, 0],
      [2, 1, 1],
      [0, 1, 1],
      [0, 1, 2],
      [1, 1, 2],
      [1, 2, 0],
      [1, 2, 1],
      [2, 2, 2],
      [0, null, null],
    ] as const;
    expect(progress()).toEqual({ round: 1, rounds: 2, seatsDone: 0 });
    for (const [seat, round, seatsDone] of plan) {
      deliver(all, [players[seat]!.buildShuffle(game.rnd, NOW)]);
      expect(progress()).toEqual(round === null ? null : { round, rounds: 2, seatsDone });
    }
    for (const s of all) expect(s.view().phase).toBe('deal');
  });

  it('shuffleRivals reports a rival step held on a shuffle prev of the chain; a race flags nobody', () => {
    const { game, players } = toyGame('any-rivals');
    // Seats 1 and 2 both open the round on the root; both steps verify there.
    const [a, b] = [
      players[1]!.buildShuffle(game.rnd, T0 + 100),
      players[2]!.buildShuffle(game.rnd, T0 + 101),
    ];
    const heads = [
      [a, b],
      [b, a],
    ].map(([x, y]) => {
      const s = newSession(game, null);
      expect(s.receive(x, NOW)).toEqual({ status: 'accepted' });
      expect(s.view().shuffleRivals).toBe(false);
      // Seat 0, eligible on the root, signs seat 1's output as its own: the proof binds seat 1, so it is
      // rejected, and a rejected step is no rival.
      const copied = signed(game, 0, 1, game.rootId, toyContent(a));
      expect(s.receive(copied, NOW)).toEqual({
        status: 'rejected',
        reason: 'the shuffle proof does not verify',
      });
      expect(s.view().shuffleRivals).toBe(false);
      expect(['accepted', 'stored']).toContain(s.receive(y, NOW).status);
      expect(s.view().shuffleRivals).toBe(true);
      expect(s.view().equivocators).toEqual([]);
      return s.view().head;
    });
    // Equal length and neither settled: the lower id heads the chain, whichever arrived first.
    const low = a.id < b.id ? a : b;
    expect(heads).toEqual([
      { id: low.id, seq: 1 },
      { id: low.id, seq: 1 },
    ]);
  });

  it('at the root every seat is stalled, so no seat can claim', () => {
    const { game, players, spectator } = crGame('any-root-stall');
    for (const s of [...players, spectator]) expect(s.waitingFor()).toEqual([0, 1, 2]);
    for (const [seat, s] of players.entries()) {
      expect(s.timeoutTarget(LATE)).toBeNull();
      expect(() => s.buildTimeout((seat + 1) % SEATS, game.rnd, LATE)).toThrow(ClientError);
    }
  });

  it('a claim at a block boundary forfeits every seat still owing its block and cancels the game', () => {
    const { game, players, spectator } = crGame('any-claim');
    const all = [...players, spectator];
    shuffleInOrder(game, players, [1], [spectator]);
    for (const s of all) expect(s.waitingFor()).toEqual([0, 2]);
    expect(players.map((s) => s.timeoutTarget(LATE))).toEqual([null, 0, null]);
    const claim = players[1]!.buildTimeout(2, game.rnd, LATE);
    expect(statuses(deliver(all, [claim], undefined, LATE))).toEqual(Array(4).fill('accepted'));
    for (const s of all) {
      expect(s.view().phase).toBe('cancelled');
      expect(s.view().forfeits).toEqual([0, 2]);
    }
  });

  it('seat order is unchanged', () => {
    const { game, players, spectator } = crGame('seat-order', true);
    expect(spectator.view().shuffleOrder).toBe('seat');
    expect(players.map((s) => s.duties())).toEqual([[{ kind: 'shuffle', rank: 0 }], [], []]);
    expect(spectator.waitingFor()).toEqual([0]);
    expect(() => players[1]!.buildShuffle(game.rnd, T0 + 100)).toThrow(ClientError);
    const [first] = shuffleInOrder(game, players, [0]);
    // Seat 1 signs seat 0's step as its own, at the root: the signer is refused before any proof is checked.
    const early = signed(game, 1, 1, game.rootId, shuffleOf(first!));
    expect(spectator.receive(early, NOW)).toEqual({
      status: 'rejected',
      reason: 'shuffle step 1 must be signed by seat 0',
    });
    trust([spectator], [first!]);
    expect(spectator.receive(first, NOW)).toEqual({ status: 'accepted' });
    expect(spectator.waitingFor()).toEqual([1]);
    expect(spectator.view().shuffleProgress).toEqual({ round: 1, rounds: 1, seatsDone: 1 });
  });

  it('a whole any-order game shuffles in order 2,0,1, deals and reaches play', () => {
    const { game, players, spectator } = crGame('any-whole');
    const all = [...players, spectator];
    const steps = shuffleInOrder(game, players, [2, 0, 1], [spectator]);
    for (const s of all) {
      expect(s.view().phase).toBe('deal');
      expect(s.view().head).toEqual({ id: steps[2]!.id, seq: 3 });
      expect(s.deckSteps()).toEqual(steps.map((ev) => ev.id));
    }
    // The final deck decrypts under all three deck secrets to every tile once.
    const table = cardTable('tiles', DECK);
    const secrets = game.ids.map((id) => id.deckSecret);
    const truth = shuffleOf(steps[2]!).deck.map(
      (ct) => cardOf(table, decryptWithSecrets(ct, secrets)) as number,
    );
    expect([...truth].sort((a, b) => a - b)).toEqual(range(DECK));

    for (const [k, s] of players.entries()) {
      expect(s.duties()).toEqual([{ kind: 'deal' }]);
      deliver(all, [s.buildDeal(game.rnd, T0 + 200 + k)]);
    }
    for (const s of all) expect(s.view().phase).toBe('play');
    expect(new Set(all.map((s) => s.view().logHash)).size).toBe(1);
    // Each seat reads its own hand off the final deck.
    for (const [seat, s] of players.entries()) {
      const hand = (s.view().state as ChainReactionState).players[seat]!.hand.map((h) => h.tile);
      expect(hand).toEqual(range(HAND).map((i) => truth[SEATS + seat * HAND + i]));
    }
  });
});

describe('honest races, settled branches and the split deal (D093)', () => {
  it('an honest race resolves by fork choice and flags no one', () => {
    const { game, players, spectator } = crGame('any-race');
    const all = [...players, spectator];
    // Seats 1 and 2 both open the round on the root, each seeing only its own step at first.
    const a = players[1]!.buildShuffle(game.rnd, T0 + 100);
    const b = players[2]!.buildShuffle(game.rnd, T0 + 101);
    trust(all, [a, b]);
    expect(players[1]!.receive(a, NOW)).toEqual({ status: 'accepted' });
    expect(players[2]!.receive(b, NOW)).toEqual({ status: 'accepted' });
    deliver([players[1]!], [b]);
    deliver([players[2]!], [a]);
    deliver([players[0]!], [a, b]);
    deliver([spectator], [b, a]);
    // Equal length and neither settled: the lower id heads the chain on every client.
    const [win, loserSeat]: [NostrEvent, number] = a.id < b.id ? [a, 2] : [b, 1];
    for (const s of all) {
      expect(s.view().head).toEqual({ id: win.id, seq: 1 });
      expect(s.view().equivocators).toEqual([]);
      expect(s.view().forfeits).toEqual([]);
      expect(s.view().shuffleRivals).toBe(true);
      expect(s.waitingFor()).toEqual([0, loserSeat]);
    }
    // The loser still owes its block, now on the winner's step, behind seat 0.
    const loser = players[loserSeat]!;
    expect(loser.duties()).toEqual([{ kind: 'shuffle', rank: 1 }]);
    const again = loser.buildShuffle(game.rnd, T0 + 102);
    const m = parseMove(again, DECK);
    expect([m.seq, m.prevId]).toEqual([2, win.id]);
    trust(all, [again]);
    expect(statuses(deliver(all, [again]))).toEqual(Array(4).fill('accepted'));
    for (const s of all) {
      expect(s.view().head).toEqual({ id: again.id, seq: 2 });
      expect(s.view().equivocators).toEqual([]);
      expect(s.waitingFor()).toEqual([0]);
    }
  });

  it('a longer branch beats a lower id', () => {
    const { game, players, spectator } = crGame('any-longer');
    const all = [...players, spectator];
    const a = players[1]!.buildShuffle(game.rnd, T0 + 100);
    const b = players[2]!.buildShuffle(game.rnd, T0 + 101);
    const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
    const loSeat = lo === a ? 1 : 2;
    // Seat 0 holds only the higher-id step, and shuffles on it.
    trust(all, [a, b]);
    deliver([players[0]!], [hi]);
    const c = players[0]!.buildShuffle(game.rnd, T0 + 102);
    trust(all, [c]);
    deliver([players[0]!], [c, lo]);
    deliver([players[1]!], [a, b, c]);
    deliver([players[2]!], [b, c, a]);
    deliver([spectator], [c, lo, hi]);
    for (const s of all) {
      expect(s.view().head).toEqual({ id: c.id, seq: 2 });
      expect(s.deckSteps()).toEqual([hi.id, c.id]);
      expect(s.view().equivocators).toEqual([]);
      expect(s.waitingFor()).toEqual([loSeat]);
    }
    expect(ranks(players)).toEqual(range(SEATS).map((seat) => (seat === loSeat ? 0 : null)));
  });

  it('two steps by one eligible seat on one prev still flag it', () => {
    const { game, players, spectator } = crGame('any-twice');
    const all = [...players, spectator];
    const x = players[1]!.buildShuffle(game.rnd, T0 + 100);
    // The same shuffle again under another date: a second, distinct step on the root.
    const y = signed(game, 1, 1, game.rootId, shuffleOf(x), T0 + 101);
    // Seat 2 races on the root honestly.
    const z = players[2]!.buildShuffle(game.rnd, T0 + 102);
    trust(all, [x, y, z]);
    deliver(all, [x, z, y]);
    for (const s of all) {
      expect(s.view().equivocators).toEqual([1]);
      expect(s.view().forfeits).toEqual([1]);
    }
  });

  it('a split deal times out with no forfeits', () => {
    const { game, steps, win, lose, d0, deals } = splitDecks();
    // Seat 0's session dealt on the losing deck, the only one it held; the others start empty.
    const sessions = [0, 1, 2, null].map((seat) =>
      holding(game, seat, seat === 0 ? [...lose, d0] : [], steps),
    );
    const [dealer, one] = sessions;
    expect(dealer!.duties()).toEqual([]);
    deliver(sessions, [...win, ...deals, ...lose, d0]);
    for (const s of sessions) {
      expect(s.view().phase).toBe('deal');
      expect(s.view().head).toEqual({ id: win[2]!.id, seq: SEATS });
      expect(s.view().equivocators).toEqual([]);
      expect(s.view().shuffleRivals).toBe(true);
      expect(s.waitingFor()).toEqual([0]);
    }
    // Seat 0 dealt on the losing deck, so it never deals again: the deal can't complete.
    expect(dealer!.duties()).toEqual([]);
    expect(one!.timeoutTarget(LATE)).toBe(0);
    const claim = one!.buildTimeout(0, game.rnd, LATE);
    for (const s of sessions) {
      expect(s.receive(claim, LATE)).toEqual({ status: 'accepted' });
      expect(s.view().phase).toBe('cancelled');
      expect(s.view().forfeits).toEqual([]);
      expect(s.view().outcome).toBeNull();
    }
  });

  it("one seat's garbage share in the deal does not make a split: it forfeits", () => {
    const { game, players, spectator } = crGame('any-garbage');
    const all = [...players, spectator];
    shuffleInOrder(game, players, [0, 1, 2], [spectator]);
    const d0 = players[0]!.buildDeal(game.rnd, T0 + 200);
    const d2 = players[2]!.buildDeal(game.rnd, T0 + 202);
    // Seat 1 publishes seat 0's shares as its own, which fail, and never deals.
    const junk = sharesBy(game, 1, d0, T0 + 201);
    const results = deliver(all, [d0, d2, junk]);
    expect(results[2]!.map((r) => r.status)).toEqual(Array(4).fill('rejected'));
    for (const s of all) {
      expect(s.view().phase).toBe('deal');
      expect(s.view().equivocators).toEqual([]);
      expect(s.view().shuffleRivals).toBe(false);
      expect(s.waitingFor()).toEqual([1]);
    }
    expect(players[1]!.duties()).toEqual([]);
    const claim = players[0]!.buildTimeout(1, game.rnd, LATE);
    for (const s of all) {
      expect(s.receive(claim, LATE)).toEqual({ status: 'accepted' });
      expect(s.view().phase).toBe('cancelled');
      expect(s.view().forfeits).toEqual([1]);
    }
  });

  it('a garbage share beside a held rival deck is no split: its seat forfeits', () => {
    const { game, steps, win, lose, deals } = splitDecks();
    // Both complete decks are held, but seat 0 publishes seat 1's shares as its own: they fit neither deck.
    const junk = sharesBy(game, 0, deals[0]!, T0 + 300);
    const sessions = [0, 1, 2, null].map((seat) =>
      holding(game, seat, [...win, ...lose, ...deals, junk], steps),
    );
    for (const s of sessions) {
      expect(s.view().phase).toBe('deal');
      expect(s.view().equivocators).toEqual([]);
      expect(s.view().shuffleRivals).toBe(true);
      expect(s.waitingFor()).toEqual([0]);
    }
    const claim = sessions[1]!.buildTimeout(0, game.rnd, LATE);
    for (const s of sessions) {
      expect(s.receive(claim, LATE)).toEqual({ status: 'accepted' });
      expect(s.view().phase).toBe('cancelled');
      expect(s.view().forfeits).toEqual([0]);
    }
  });

  it('a held shuffle equivocation still blames the equivocator in the deal', () => {
    const { game } = crGame('any-f7');
    const E = 2;
    const s0 = newSession(game, 0).buildShuffle(game.rnd, T0 + 100);
    const s1 = holding(game, 1, [s0]).buildShuffle(game.rnd, T0 + 101);
    // Seat 2 signs two rival final steps.
    const e = holding(game, E, [s0, s1]);
    const x = e.buildShuffle(game.rnd, T0 + 102);
    const y = e.buildShuffle(game.rnd, T0 + 103);
    const [lo, hi] = x.id < y.id ? [x, y] : [y, x];
    const steps = [s0, s1, lo, hi];
    // Seat 0 deals on the lower id, seat 1 on the higher.
    const d0 = holding(game, 0, [s0, s1, lo], steps).buildDeal(game.rnd, T0 + 200);
    const d1 = holding(game, 1, [s0, s1, hi], steps).buildDeal(game.rnd, T0 + 201);
    const sessions = [0, 1, E, null].map((seat) => holding(game, seat, [...steps, d0, d1], steps));
    for (const s of sessions) {
      expect(s.view().phase).toBe('deal');
      expect(s.view().head).toEqual({ id: lo.id, seq: SEATS });
      expect(s.view().equivocators).toEqual([E]);
      expect(s.waitingFor()).toEqual([E]);
    }
    const claim = sessions[0]!.buildTimeout(E, game.rnd, LATE);
    for (const s of sessions) {
      expect(s.receive(claim, LATE)).toEqual({ status: 'accepted' });
      expect(s.view().phase).toBe('cancelled');
      expect(s.view().forfeits).toEqual([E]);
    }
  });

  it('junk steps from an ineligible seat do not raise shuffleRivals', () => {
    const { game, players, spectator } = toyGame('any-junk');
    const all = [...players, spectator];
    // Blocks by seats 1, 0 and 2, two steps each: the deck is complete.
    const chain = [1, 1, 0, 0, 2, 2].map((seat) => {
      const ev = players[seat]!.buildShuffle(game.rnd, NOW);
      deliver(all, [ev]);
      return ev;
    });
    expect(spectator.view().phase).toBe('deal');
    expect(spectator.view().shuffleRivals).toBe(false);
    // Seat 1 finished its block at step 2, so it may not sign step 3. It floods that prev with four copies of
    // step 3: the first three are refused, and the fourth, past the candidate cap, is held unjudged.
    const reason = 'shuffle step 3 may not be signed by seat 1';
    const junk = range(4).map((i) => signed(game, 1, 3, chain[1]!.id, toyContent(chain[2]!), T0 + 600 + i));
    expect(junk.map((ev) => spectator.receive(ev, NOW))).toEqual([
      { status: 'rejected', reason },
      { status: 'rejected', reason },
      { status: 'rejected', reason },
      { status: 'stored' },
    ]);
    expect(spectator.view().shuffleRivals).toBe(false);
    expect(spectator.view().equivocators).toEqual([]);
    // Seat 2, which may sign step 3 there, is a rival.
    const rival = signed(game, 2, 3, chain[1]!.id, toyContent(chain[2]!), T0 + 700);
    trust([spectator], [rival]);
    expect(spectator.receive(rival, NOW)).toEqual({ status: 'stored' });
    expect(spectator.view().shuffleRivals).toBe(true);
    expect(spectator.view().head).toEqual({ id: chain[5]!.id, seq: 6 });
  });

  it("forkSteps leaves out an ineligible seat's steps", () => {
    const { game, players, spectator } = toyGame('any-fork-steps');
    const all = [...players, spectator];
    // Blocks by seats 1 and 0: step 5 is seat 2's.
    const chain = [1, 1, 0, 0].map((seat) => {
      const ev = players[seat]!.buildShuffle(game.rnd, NOW);
      deliver(all, [ev]);
      return ev;
    });
    // Seat 1 signs two steps where it may not (step 3 after its own block); seat 2 two where it may (step 5).
    const junk = range(2).map((i) => signed(game, 1, 3, chain[1]!.id, toyContent(chain[2]!), T0 + 600 + i));
    const twice = range(2).map((i) => signed(game, 2, 5, chain[3]!.id, toyContent(chain[2]!), T0 + 700 + i));
    trust([spectator], twice);
    deliver([spectator], [...junk, ...twice]);
    expect(spectator.view().equivocators).toEqual([2]);
    const [on, off] = twice[0]!.id < twice[1]!.id ? twice : [twice[1]!, twice[0]!];
    expect(spectator.view().head).toEqual({ id: on!.id, seq: 5 });
    expect(spectator.forkSteps()).toEqual([off!.id]);
  });
});
