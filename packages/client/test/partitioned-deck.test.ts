// biome-ignore-all lint/style/noNonNullAssertion: test fixtures use known seats, positions and deck orders.

import { chess } from '@bored-games/chess';
import {
  type Ciphertext,
  cardOf,
  cardTable,
  decryptWithSecrets,
  G,
  initialDeck,
  jointKey,
  proveShuffle,
  shuffleDeck,
} from '@bored-games/deck';
import { type DeckSpec, packetOrderFits, range } from '@bored-games/game-kit';
import { finalizeEvent, moveTemplate, type NostrEvent, parseMove } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { createToy, type ToyState } from '../../game-kit/test/toy.ts';
import { ClientError } from '../src/errors.ts';
import { deckPartitions, shuffleSchedule } from '../src/partitioned-deck.ts';
import { simulateGame } from '../src/sim.ts';
import { makeModuleGame, NOW, newSession } from './helpers.ts';

const toy = {
  ...createToy(),
  decks: () => [
    {
      id: 'cards',
      size: 12,
      partitions: [
        { id: 'a', size: 6 },
        { id: 'b', size: 6 },
      ],
    },
  ],
};
function table(seed: string, promptShares = false, secondRound?: DeckSpec['secondRound']) {
  const module = {
    ...toy,
    decks: () =>
      toy.decks().map((d) => ({ ...d, promptShares, ...(secondRound === undefined ? {} : { secondRound }) })),
  };
  const game = makeModuleGame(module, 2, seed);
  game.modules = new Map([[module.id, module]]);
  return { game, players: [newSession(game, 0), newSession(game, 1)], spectator: newSession(game, null) };
}
describe('shuffle schedule', () => {
  it('has no steps for a deckless game, or for no seats, so nothing divides by zero', () => {
    expect(deckPartitions(null)).toEqual([]);
    expect(shuffleSchedule(null, 3)).toEqual([]);
    for (const seats of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(shuffleSchedule(toy.decks()[0]!, seats)).toEqual([]);
  });

  it('a session has no shuffle step past its schedule, and a deckless one has none at all', () => {
    const stepAt = (s: unknown, step: number) => (s as { stepAt(n: number): unknown }).stepAt(step);
    const t = table('step-at', false, [{ id: 'mix', positions: [1, 2, 3] }]);
    expect(stepAt(t.spectator, 5)).toMatchObject({ seat: 1, round: 2, group: { id: 'cards/mix' } });
    for (const step of [-1, 0.5, Number.NaN, 6]) expect(() => stepAt(t.spectator, step)).toThrow(ClientError);
    const deckless = newSession(makeModuleGame(chess, 2, 'deckless-step-at'), null);
    expect(() => stepAt(deckless, 0)).toThrow(ClientError);
  });

  it('a deckless session starts in play with whole-number seats and no shuffle duty', () => {
    const game = makeModuleGame(chess, 2, 'deckless-shuffle-guard');
    const sessions = [newSession(game, 0), newSession(game, 1), newSession(game, null)];
    for (const s of sessions) {
      expect(s.view().shuffleSteps).toBe(0);
      expect(s.view().shuffleProgress).toBeNull();
      for (const seat of s.waitingFor()) expect(Number.isInteger(seat)).toBe(true);
      expect(s.duties().some((d) => d.kind === 'shuffle')).toBe(false);
    }
    expect(sessions[2]!.waitingFor()).toEqual([0]);
  });
});

describe('opt-in partitioned encrypted shuffles', () => {
  it('keeps legacy deck domains and rejects invalid partition specifications', () => {
    expect(deckPartitions(null)).toEqual([]);
    expect(deckPartitions({ id: 'cards', size: 12 })).toEqual([{ id: 'cards', size: 12, offset: 0 }]);
    for (const partitions of [
      [],
      [{ id: 'a', size: 11 }],
      [
        { id: 'a', size: 6 },
        { id: 'a', size: 6 },
      ],
      [
        { id: 'a', size: -1 },
        { id: 'b', size: 13 },
      ],
    ])
      expect(() => deckPartitions({ id: 'cards', size: 12, partitions })).toThrow();
  });
  it('each seat shuffles each partition and spectators derive the same public reveal', () => {
    const t = table('partition-shuffle');
    const sessions = [...t.players, t.spectator];
    expect(t.spectator.view().shuffleSteps).toBe(4);
    for (let step = 0; step < 4; step++) {
      const seat = Math.floor(step / 2);
      expect(t.spectator.waitingFor()).toEqual([seat]);
      expect(t.spectator.view().shuffleProgress).toEqual({ round: 1, rounds: 1, seatsDone: seat });
      const ev = t.players[seat]!.buildShuffle(t.game.rnd, NOW);
      for (const s of sessions) expect(s.receive(ev, NOW).status).toBe('accepted');
      expect(t.spectator.view().head.seq).toBe(step + 1);
    }
    for (const s of t.players) {
      const ev = s.buildDeal(t.game.rnd, NOW);
      for (const q of sessions) expect(['accepted', 'duplicate']).toContain(q.receive(ev, NOW).status);
    }
    expect(t.spectator.view().phase).toBe('play');
    expect(t.spectator.view().shuffleProgress).toBeNull();
    expect((t.spectator.view().state as { trump: { card: number } }).trump.card).toBeLessThan(6);
  });
  it('rejects a valid shuffle proof from another partition and a cross-partition input', () => {
    const t = table('partition-attack');
    const X = jointKey(t.game.ids.map((id) => G.multiply(id.deckSecret)));
    const initial = initialDeck('cards', 12);
    for (const [input, ctxDeck] of [
      [initial.slice(0, 6), 'cards/b'],
      [initial.slice(6, 12), 'cards/a'],
    ] as const) {
      const { out, psi, rPrime } = shuffleDeck(input, X, t.game.rnd);
      const proof = proveShuffle(
        input,
        out,
        X,
        psi,
        rPrime,
        { rootId: t.game.rootId, seat: 0, deckId: ctxDeck },
        t.game.rnd,
      );
      const ev = finalizeEvent(
        moveTemplate(
          {
            rootId: t.game.rootId,
            prevId: t.game.rootId,
            seq: 1,
            content: { type: 'shuffle', deck: out, proof },
          },
          NOW,
        ),
        t.game.ids[0]!.sessionSk,
        t.game.rnd,
      );
      expect(t.spectator.receive(ev, NOW).status).toBe('rejected');
    }
  });
  it('new private cards get automatic non-owner shares only with an explicit policy opt-in', () => {
    for (const promptShares of [false, true]) {
      const t = table(`partition-share-policy-${promptShares}`, promptShares);
      const sessions = [...t.players, t.spectator];
      for (let step = 0; step < 4; step++) {
        const event = t.players[Math.floor(step / 2)]!.buildShuffle(t.game.rnd, NOW);
        for (const s of sessions) s.receive(event, NOW);
      }
      for (const s of t.players) {
        const event = s.buildDeal(t.game.rnd, NOW);
        for (const q of sessions) q.receive(event, NOW);
      }
      const actor = t.players[0]!;
      const event = actor.buildAction(actor.legalActions()[0], t.game.rnd, NOW);
      for (const s of sessions) expect(s.receive(event, NOW).status).toBe('accepted');
      expect(actor.duties().some((d) => d.kind === 'share')).toBe(false);
      const other = t.players[1]!;
      expect(other.duties().some((d) => d.kind === 'share')).toBe(promptShares);
      if (promptShares) {
        expect(other.duties()).toContainEqual({ kind: 'share', positions: [5] });
        const share = other.buildShares(t.game.rnd, NOW);
        for (const s of sessions) expect(s.receive(share, NOW).status).toBe('accepted');
        const state = actor.view().state as { hands: { pos: number; card: number | null }[][] };
        expect(state.hands[0]!.find((h) => h.pos === 5)?.card).not.toBeNull();
        const watching = t.spectator.view().state as typeof state;
        expect(watching.hands[0]!.find((h) => h.pos === 5)?.card).toBeNull();
      } else expect(() => other.buildShares(t.game.rnd, NOW)).toThrow();
    }
  });
});

describe('second shuffle round (D076)', () => {
  /** Everything but each partition's first position: the positions the second round mixes. */
  const MIX = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11];
  const secondRound = [{ id: 'mix', positions: MIX }];
  const withMix: DeckSpec = { ...toy.decks()[0]!, secondRound };
  /** The positions each of the six steps of a 2-seat game with `withMix` shuffles, written out by hand. */
  const LAYOUT = [range(6), range(6).map((n) => n + 6), range(6), range(6).map((n) => n + 6), MIX, MIX];

  it('schedules every first-round step before any second-round step', () => {
    const steps = shuffleSchedule(withMix, 2);
    expect(steps.map((s) => s.seat)).toEqual([0, 0, 1, 1, 0, 1]);
    expect(steps.map((s) => s.group.id)).toEqual([
      'cards/a',
      'cards/b',
      'cards/a',
      'cards/b',
      'cards/mix',
      'cards/mix',
    ]);
    expect(steps.map((s) => s.round)).toEqual([1, 1, 1, 1, 2, 2]);
    expect(steps.map((s) => s.group.positions)).toEqual(LAYOUT);
  });

  it('gives each seat every second-round group in list order before the next seat starts', () => {
    const deck: DeckSpec = {
      ...toy.decks()[0]!,
      secondRound: [
        { id: 'm1', positions: [1, 2, 3] },
        { id: 'm2', positions: [7, 8] },
      ],
    };
    const steps = shuffleSchedule(deck, 3);
    // N = (G1 + G2) * S = (2 + 2) * 3. For t = s - G1 * S: seat floor(t / G2), group t mod G2.
    expect(steps).toHaveLength(12);
    expect(steps.map((s) => s.seat)).toEqual([0, 0, 1, 1, 2, 2, 0, 0, 1, 1, 2, 2]);
    expect(steps.map((s) => s.group.id)).toEqual([
      ...['cards/a', 'cards/b', 'cards/a', 'cards/b', 'cards/a', 'cards/b'],
      ...['cards/m1', 'cards/m2', 'cards/m1', 'cards/m2', 'cards/m1', 'cards/m2'],
    ]);
    expect(steps.map((s) => s.round)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
    expect(steps[6]?.group.positions).toEqual([1, 2, 3]);
    expect(steps[7]?.group.positions).toEqual([7, 8]);
  });

  it('puts a second round after the single shuffle of a deck without partitions', () => {
    const steps = shuffleSchedule(
      { id: 'cards', size: 12, secondRound: [{ id: 'mix', positions: [0, 5, 6] }] },
      2,
    );
    expect(steps.map((s) => s.seat)).toEqual([0, 1, 0, 1]);
    expect(steps.map((s) => s.group.id)).toEqual(['cards', 'cards', 'cards/mix', 'cards/mix']);
    expect(steps.map((s) => s.round)).toEqual([1, 1, 2, 2]);
    expect(steps[0]?.group.positions).toEqual(range(12));
  });

  it('keeps today’s schedule for plain and partitioned decks', () => {
    const plain = shuffleSchedule({ id: 'cards', size: 12 }, 3);
    expect(plain.map((s) => s.seat)).toEqual([0, 1, 2]);
    expect(plain.map((s) => s.group.id)).toEqual(['cards', 'cards', 'cards']);
    expect(plain.map((s) => s.round)).toEqual([1, 1, 1]);
    expect(plain.map((s) => s.group.positions)).toEqual([range(12), range(12), range(12)]);
    const two = shuffleSchedule(toy.decks()[0]!, 2);
    expect(two.map((s) => s.seat)).toEqual([0, 0, 1, 1]);
    expect(two.map((s) => s.group.id)).toEqual(['cards/a', 'cards/b', 'cards/a', 'cards/b']);
    expect(two.map((s) => s.round)).toEqual([1, 1, 1, 1]);
    expect(two.map((s) => s.group.positions)).toEqual(LAYOUT.slice(0, 4));
  });

  it('refuses an invalid second round', () => {
    const refused: [string, unknown][] = [
      ['no groups', []],
      [
        'a repeated id',
        [
          { id: 'mix', positions: [1, 2] },
          { id: 'mix', positions: [3, 4] },
        ],
      ],
      ['a partition id', [{ id: 'a', positions: [1, 2] }]],
      ['an empty id', [{ id: '', positions: [1, 2] }]],
      ['an id that is not a string', [{ id: 7, positions: [1, 2] }]],
      ['a position past the deck', [{ id: 'mix', positions: [1, 12] }]],
      ['a negative position', [{ id: 'mix', positions: [-1, 2] }]],
      ['positions out of order', [{ id: 'mix', positions: [3, 1] }]],
      ['a repeated position', [{ id: 'mix', positions: [2, 2] }]],
      ['a fractional position', [{ id: 'mix', positions: [1.5, 2] }]],
      ['a single position', [{ id: 'mix', positions: [1] }]],
      ['positions that are not a list', [{ id: 'mix', positions: 'ab' }]],
      [
        'two groups sharing a position',
        [
          { id: 'one', positions: [1, 2, 3] },
          { id: 'two', positions: [3, 4] },
        ],
      ],
      ['a group that is not an object', [null]],
      ['groups that are not a list', 'mix'],
    ];
    for (const [why, bad] of refused)
      expect(() => shuffleSchedule({ ...toy.decks()[0]!, secondRound: bad as never }, 2), why).toThrow(
        'invalid deck second round',
      );
    // 16 groups are the most, so 17 are refused on a deck that has room for them.
    const groups = (n: number) => range(n).map((i) => ({ id: `g${i}`, positions: [2 * i, 2 * i + 1] }));
    expect(shuffleSchedule({ id: 'big', size: 40, secondRound: groups(16) }, 2)).toHaveLength(2 + 32);
    expect(() => shuffleSchedule({ id: 'big', size: 40, secondRound: groups(17) }, 2)).toThrow(
      'invalid deck second round',
    );
    // The partitions are checked first, with their own message.
    expect(() =>
      shuffleSchedule({ id: 'cards', size: 12, partitions: [{ id: 'a', size: 11 }], secondRound }, 2),
    ).toThrow('invalid deck partitions');
  });

  it('accepts groups that are not contiguous, and one that holds the whole deck', () => {
    expect(
      shuffleSchedule({ ...toy.decks()[0]!, secondRound: [{ id: 'ends', positions: [0, 11] }] }, 2),
    ).toHaveLength(6);
    expect(
      shuffleSchedule({ ...toy.decks()[0]!, secondRound: [{ id: 'all', positions: range(12) }] }, 2),
    ).toHaveLength(6);
  });

  it('makes a session refuse a deck whose second round is invalid', () => {
    const bad = { ...toy, decks: () => [{ ...toy.decks()[0]!, secondRound: [] }] };
    const game = makeModuleGame(bad, 2, 'bad-second-round');
    game.modules = new Map([[bad.id, bad]]);
    expect(() => newSession(game, null)).toThrow(ClientError);
    expect(() => newSession(game, null)).toThrow('invalid deck second round');
  });

  it('counts a deck without partitions as one round', () => {
    const plain = { ...createToy(), decks: () => [{ id: 'cards', size: 12 }] };
    const game = makeModuleGame(plain, 2, 'plain-progress');
    game.modules = new Map([[plain.id, plain]]);
    const players = [newSession(game, 0), newSession(game, 1)];
    const spectator = newSession(game, null);
    expect(spectator.view().shuffleSteps).toBe(2);
    for (const seat of [0, 1]) {
      expect(spectator.view().shuffleProgress).toEqual({ round: 1, rounds: 1, seatsDone: seat });
      const ev = players[seat]!.buildShuffle(game.rnd, NOW);
      for (const s of [...players, spectator]) expect(s.receive(ev, NOW).status).toBe('accepted');
    }
    expect(spectator.view().phase).toBe('deal');
    expect(spectator.view().shuffleProgress).toBeNull();
  });

  /** The packet after the first `n` of `events`, rebuilt from the wire with the hand-written layout. */
  function packetAfter(events: readonly NostrEvent[], n: number): Ciphertext[] {
    let packet = initialDeck('cards', 12);
    for (const [i, ev] of events.slice(0, n).entries()) {
      const where = LAYOUT[i]!;
      const move = parseMove(ev, where.length);
      if (move.content.type !== 'shuffle') throw new Error('not a shuffle step');
      const next = packet.slice();
      for (const [j, p] of where.entries()) next[p] = move.content.deck[j]!;
      packet = next;
    }
    return packet;
  }

  it('plays a two-round shuffle to the deal; position 0 keeps its partition', () => {
    const t = table('two-round-shuffle', false, secondRound);
    const sessions = [...t.players, t.spectator];
    expect(t.spectator.view().shuffleSteps).toBe(6);
    const seats = [0, 0, 1, 1, 0, 1];
    const progress = [
      { round: 1, rounds: 2, seatsDone: 0 },
      { round: 1, rounds: 2, seatsDone: 0 },
      { round: 1, rounds: 2, seatsDone: 1 },
      { round: 1, rounds: 2, seatsDone: 1 },
      { round: 2, rounds: 2, seatsDone: 0 },
      { round: 2, rounds: 2, seatsDone: 1 },
    ];
    const steps: NostrEvent[] = [];
    while (t.spectator.view().phase === 'shuffle') {
      const step = steps.length;
      expect(step).toBeLessThan(6);
      const [seat] = t.spectator.waitingFor();
      expect(seat).toBe(seats[step]);
      for (const s of sessions) expect(s.view().shuffleProgress).toEqual(progress[step]);
      // Only the seat whose step is next owes a shuffle.
      expect(t.players.map((p) => p.duties())).toEqual(
        seats[step] === 0 ? [[{ kind: 'shuffle' }], []] : [[], [{ kind: 'shuffle' }]],
      );
      const ev = t.players[seat!]!.buildShuffle(t.game.rnd, NOW);
      for (const s of sessions) expect(s.receive(ev, NOW).status).toBe('accepted');
      steps.push(ev);
      expect(t.spectator.view().head.seq).toBe(step + 1);
    }
    expect(steps).toHaveLength(6);
    expect(t.spectator.view().phase).toBe('deal');
    expect(t.spectator.view().shuffleProgress).toBeNull();

    // An independent model of the six steps: gather and scatter by the hand-written layout, then decrypt it all.
    const secrets = t.game.ids.map((id) => id.deckSecret);
    const cards = cardTable('cards', 12);
    const order = packetAfter(steps, 6).map((c) => cardOf(cards, decryptWithSecrets(c, secrets)));
    expect(order).not.toContain(null);
    const final = order as number[];
    expect(packetOrderFits(withMix, final)).toBe(true);
    expect(final[0]).toBeLessThan(6);
    expect(final[6]).toBeGreaterThanOrEqual(6);
    // The second round carried a card of the first partition out of its half of the deck.
    expect([7, 8, 9, 10, 11].some((p) => final[p]! < 6)).toBe(true);

    for (const s of t.players) {
      const ev = s.buildDeal(t.game.rnd, NOW);
      for (const q of sessions) expect(['accepted', 'duplicate']).toContain(q.receive(ev, NOW).status);
    }
    for (const s of sessions) expect(s.view().phase).toBe('play');
    const state = (s: (typeof sessions)[number]) => s.view().state as ToyState;
    expect(state(t.spectator).trump.card).toBe(final[0]);
    expect(state(t.spectator).trump.card).toBeLessThan(6);
    // Each seat reads its own hand off the mixed positions, as the independent model says.
    expect(state(t.players[0]!).hands[0]!.map((h) => h.card)).toEqual([final[1], final[2]]);
    expect(state(t.players[1]!).hands[1]!.map((h) => h.card)).toEqual([final[3], final[4]]);
  });

  it('plays a whole game over a two-round deck: every client agrees and the audit passes', () => {
    const module = { ...toy, decks: () => [{ ...toy.decks()[0]!, secondRound }] };
    const r = simulateGame({
      seats: 2,
      seed: 'two-round-sim',
      modules: new Map([[module.id, module]]),
      game: module.id,
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
    // Six shuffle steps open the chain, then the game's own actions.
    expect(r.moves - r.actions).toBe(6);
    expect(r.actions).toBeGreaterThan(0);
  });

  it('rejects a second-round step that is proven or shaped as another step', () => {
    const t = table('two-round-attack', false, secondRound);
    const sessions = [...t.players, t.spectator];
    const steps: NostrEvent[] = [];
    for (const seat of [0, 0, 1, 1]) {
      const ev = t.players[seat]!.buildShuffle(t.game.rnd, NOW);
      for (const s of sessions) expect(s.receive(ev, NOW).status).toBe('accepted');
      steps.push(ev);
    }
    const X = jointKey(t.game.ids.map((id) => G.multiply(id.deckSecret)));
    /** A genuine shuffle of `input`, proven for `proofSeat` under `deckId`, signed by `signer`. */
    const forge = (a: {
      prev: string;
      seq: number;
      signer: number;
      proofSeat: number;
      deckId: string;
      input: Ciphertext[];
    }): NostrEvent => {
      const { out, psi, rPrime } = shuffleDeck(a.input, X, t.game.rnd);
      const ctx = { rootId: t.game.rootId, seat: a.proofSeat, deckId: a.deckId };
      const proof = proveShuffle(a.input, out, X, psi, rPrime, ctx, t.game.rnd);
      const content = { type: 'shuffle' as const, deck: out, proof };
      const template = moveTemplate({ rootId: t.game.rootId, prevId: a.prev, seq: a.seq, content }, NOW);
      return finalizeEvent(template, t.game.ids[a.signer]!.sessionSk, t.game.rnd);
    };
    const packet = packetAfter(steps, 4);
    const prev = steps[3]!.id;
    const mixInput = MIX.map((p) => packet[p]!);
    const verdict = (ev: NostrEvent) => sessions.map((s) => s.receive(ev, NOW));

    const cases: [string, NostrEvent, RegExp][] = [
      [
        'a 10-card shuffle proven under cards/a',
        forge({ prev, seq: 5, signer: 0, proofSeat: 0, deckId: 'cards/a', input: mixInput }),
        /proof does not verify/,
      ],
      [
        'a 6-card contiguous slice',
        forge({ prev, seq: 5, signer: 0, proofSeat: 0, deckId: 'cards/b', input: packet.slice(6) }),
        /wrong group size/,
      ],
      [
        'a correct mix step signed by seat 1',
        forge({ prev, seq: 5, signer: 1, proofSeat: 0, deckId: 'cards/mix', input: mixInput }),
        /must be signed by seat 0/,
      ],
      [
        'a mix step proven for seat 1 and signed by seat 0',
        forge({ prev, seq: 5, signer: 0, proofSeat: 1, deckId: 'cards/mix', input: mixInput }),
        /proof does not verify/,
      ],
    ];
    for (const [why, ev, reason] of cases) {
      for (const r of verdict(ev)) {
        expect(r.status, why).toBe('rejected');
        expect(r.status === 'rejected' ? r.reason : '', why).toMatch(reason);
      }
    }
    // At seq 1 a 10-card step is the wrong shape, on a session that has seen nothing else.
    const fresh = newSession(t.game, null);
    const initial = initialDeck('cards', 12);
    const first = forge({
      prev: t.game.rootId,
      seq: 1,
      signer: 0,
      proofSeat: 0,
      deckId: 'cards/mix',
      input: MIX.map((p) => initial[p]!),
    });
    const r = fresh.receive(first, NOW);
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' ? r.reason : '').toMatch(/wrong group size/);

    // None of that blocked the game: seat 0's genuine mix step still links at seq 5.
    const genuine = t.players[0]!.buildShuffle(t.game.rnd, NOW);
    for (const s of sessions) expect(s.receive(genuine, NOW).status).toBe('accepted');
    expect(t.spectator.view().head.seq).toBe(5);
    expect(t.spectator.waitingFor()).toEqual([1]);
  });
});

it('allows up to 64 first-round groups for personal decks and separate supply piles', () => {
  const groups = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `supply-${i}`, size: 2 }));
  expect(shuffleSchedule({ id: 'pile', size: 42, partitions: groups(21) }, 4)).toHaveLength(84);
  expect(shuffleSchedule({ id: 'pile', size: 128, partitions: groups(64) }, 2)).toHaveLength(128);
  expect(() => shuffleSchedule({ id: 'pile', size: 130, partitions: groups(65) }, 2)).toThrow(
    'invalid deck partitions',
  );
});
