// biome-ignore-all lint/style/noNonNullAssertion: test fixtures use known seats, positions and deck orders.

import { readFileSync } from 'node:fs';
import { chess } from '@bored-games/chess';
import * as deck from '@bored-games/deck';
import { G, initialDeck, jointKey, proveShuffle, shuffleDeck } from '@bored-games/deck';
import { finalizeEvent, moveTemplate } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { createToy } from '../../game-kit/test/toy.ts';
import { deckPartitions, shuffleStepGroup, shuffleStepSeat } from '../src/partitioned-deck.ts';
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
function table(seed: string, promptShares = false) {
  const module = { ...toy, decks: () => toy.decks().map((d) => ({ ...d, promptShares })) };
  const game = makeModuleGame(module, 2, seed);
  game.modules = new Map([[module.id, module]]);
  return { game, players: [newSession(game, 0), newSession(game, 1)], spectator: newSession(game, null) };
}
describe('shuffle step arithmetic', () => {
  const legacy = deckPartitions({ id: 'cards', size: 12 });
  const two = deckPartitions(toy.decks()[0]!);

  it('maps each step to its seat and group, one group or several', () => {
    expect([0, 1, 2].map((s) => shuffleStepSeat(s, legacy))).toEqual([0, 1, 2]);
    expect([0, 1, 2].map((s) => shuffleStepGroup(s, legacy)?.id)).toEqual(['cards', 'cards', 'cards']);
    expect([0, 1, 2, 3].map((s) => shuffleStepSeat(s, two))).toEqual([0, 0, 1, 1]);
    expect([0, 1, 2, 3].map((s) => shuffleStepGroup(s, two)?.id)).toEqual([
      'cards/a',
      'cards/b',
      'cards/a',
      'cards/b',
    ]);
  });

  it('never divides by zero: a deckless game (no groups) has no shuffler and no group', () => {
    const none = deckPartitions(null);
    expect(none).toEqual([]);
    for (const step of [0, 1, 5]) {
      expect(shuffleStepSeat(step, none)).toBeNull();
      expect(shuffleStepGroup(step, none)).toBeNull();
    }
    for (const step of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(shuffleStepSeat(step, two)).toBeNull();
      expect(shuffleStepGroup(step, two)).toBeNull();
    }
  });

  it('a deckless session starts in play with whole-number seats and no shuffle duty', () => {
    const game = makeModuleGame(chess, 2, 'deckless-shuffle-guard');
    const sessions = [newSession(game, 0), newSession(game, 1), newSession(game, null)];
    for (const s of sessions) {
      expect(s.view().shuffleSteps).toBe(0);
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
      const ev = t.players[seat]!.buildShuffle(t.game.rnd, NOW);
      for (const s of sessions) expect(s.receive(ev, NOW).status).toBe('accepted');
      expect(t.spectator.view().head.seq).toBe(step + 1);
    }
    for (const s of t.players) {
      const ev = s.buildDeal(t.game.rnd, NOW);
      for (const q of sessions) expect(['accepted', 'duplicate']).toContain(q.receive(ev, NOW).status);
    }
    expect(t.spectator.view().phase).toBe('play');
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

describe('the deck package partitioned-shuffle vectors (PROTOCOL-v2 §12.2 item 2) reproduce with the v1 client rules', () => {
  // A v1 gap (D060): conforming v1 clients must reproduce the vectors. This uses the client's own arithmetic
  // (deckPartitions, shuffleStepSeat, shuffleStepGroup) and verifies each step as GameSession.shuffleVerifies does.
  it('groups, step seats, domains, input slices, proofs and packets all match', () => {
    type Entry = number | [string, string];
    const v = JSON.parse(
      readFileSync(new URL('../../deck/test/vectors/partitioned-v1.json', import.meta.url), 'utf8'),
    ) as {
      rootId: string;
      deckId: string;
      size: number;
      groups: { id: string; size: number; offset: number; domain: string }[];
      jointKey: string;
      steps: {
        seat: number;
        domain: string;
        offset: number;
        size: number;
        input: Entry[];
        output: Entry[];
        proof: unknown;
        packet: Entry[];
      }[];
    };
    const groups = deckPartitions({
      id: v.deckId,
      size: v.size,
      partitions: v.groups.map((g) => ({ id: g.id, size: g.size })),
    });
    expect(groups).toEqual(v.groups.map((g) => ({ id: g.domain, offset: g.offset, size: g.size })));
    const decode = (es: readonly Entry[]) =>
      es.map((e) =>
        typeof e === 'number'
          ? deck.initialDeck(v.deckId, e + 1)[e]!
          : { a: deck.decodePoint(e[0]), b: deck.decodePoint(e[1]) },
      );
    const X = deck.decodePoint(v.jointKey);
    let packet = deck.initialDeck(v.deckId, v.size);
    expect(v.steps).toHaveLength(groups.length * 2);
    for (const [s, step] of v.steps.entries()) {
      const group = shuffleStepGroup(s, groups)!;
      expect(shuffleStepSeat(s, groups)).toBe(step.seat);
      expect([group.id, group.offset, group.size]).toEqual([step.domain, step.offset, step.size]);
      const input = packet.slice(group.offset, group.offset + group.size);
      const listedIn = decode(step.input);
      expect(input.every((c, i) => c.a.equals(listedIn[i]!.a) && c.b.equals(listedIn[i]!.b))).toBe(true);
      const output = decode(step.output);
      const proof = deck.decodeShuffleProof(step.proof, group.size);
      const ctx = { rootId: v.rootId, seat: shuffleStepSeat(s, groups)!, deckId: group.id };
      expect(deck.verifyShuffle(input, output, X, proof, ctx)).toBe(true);
      packet = [...packet.slice(0, group.offset), ...output, ...packet.slice(group.offset + group.size)];
      const listed = decode(step.packet);
      expect(packet.every((c, i) => c.a.equals(listed[i]!.a) && c.b.equals(listed[i]!.b))).toBe(true);
    }
  });
});
