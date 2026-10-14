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
    const toyContent = (ev: NostrEvent) => parseMove(ev, 6).content;
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
