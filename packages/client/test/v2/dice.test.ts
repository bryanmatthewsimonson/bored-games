import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type BankState, bank } from '@bored-games/bank';
import {
  decodePoint,
  encodePoint,
  G,
  initialDeck,
  makeMoveRollShare,
  moveRollPoint,
  proveShuffle,
  rollSeed,
  shuffleDeck,
} from '@bored-games/deck';
import { faces } from '@bored-games/dice';
import { canonicalJson, createRng, type GameModule, type RollEntry, shuffle } from '@bored-games/game-kit';
import {
  finalizeEvent,
  getPublicKey,
  type Hex,
  moveTemplate,
  type NostrEvent,
  parseSharesV2,
  rollSharesTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { type DiceVectors, diceFile } from '../../scripts/dice-v2.ts';
import type { LoggedAction } from '../../src/audit.ts';
import type { Duty, Identity } from '../../src/types.ts';
import { GameSessionV2 } from '../../src/v2/session.ts';
import type { Walk } from '../../src/v2/walk.ts';
import { MODULES, NOW, ROOT_SEEN } from '../helpers.ts';
import {
  type AnyModule,
  act,
  decider,
  quick,
  replay,
  runAuto,
  send,
  statusesOf,
  type V2Table,
  v2Table,
} from './helpers-v2.ts';

/*
 * Dice under protocol 2 (PROTOCOL-v2 §6.2, build plan T9): the rolls a game action requests, (M, 0) … (M, r−1);
 * roll Shares events verified against their requesting move's points and kept once per (seat, M, n); the derived
 * `rolled` action from the seat-ordered seed; the `roll` duty and `buildRoll`; stalls on a pending beacon; and
 * vector 7 (§12.2 item 7) for Bank 0.2.0. A small two-roll module checks the mapping of several roll entries and
 * their `count` and `sides`.
 */

const FILE = new URL('../vectors/dice-v2.json', import.meta.url);

const walkOf = (s: GameSessionV2): Walk => (s as unknown as { current: Walk }).current;
const logOf = (s: GameSessionV2): readonly LoggedAction[] => walkOf(s).line.log;
const rolledOf = (s: GameSessionV2): LoggedAction[] => logOf(s).filter((x) => x.actor === 'beacon');
const anchorOf = (ev: NostrEvent): string | undefined =>
  ev.tags.find((t) => t[0] === 'e' && t[3] === 'anchor')?.[1];
const rollDuties = (s: GameSessionV2): Extract<Duty, { kind: 'roll' }>[] =>
  s.duties().filter((d): d is Extract<Duty, { kind: 'roll' }> => d.kind === 'roll');
const snapshot = (s: GameSessionV2): string =>
  canonicalJson({
    view: s.view(),
    duties: s.duties(),
    waiting: s.waitingFor(),
    held: s.heldSet(),
    legal: s.legalActions(),
    ahead: s.aheadOfHead(),
  });

/** A roll Shares event by `seat` naming `move`, with `D` for each index of `indices` made against `pointMove`. */
function rollEvent(
  t: V2Table,
  seat: number,
  move: Hex,
  indices: number[],
  anchor: Hex,
  pointMove: Hex = move,
  at = NOW,
): NostrEvent {
  const id = t.game.ids[seat] as Identity;
  const shares = indices.map((n) => ({
    pos: n,
    share: makeMoveRollShare(id.deckSecret, t.game.rootId, pointMove, n, t.game.rnd),
  }));
  return finalizeEvent(
    rollSharesTemplate({ rootId: t.game.rootId, anchorId: anchor, moveId: move, shares }, at),
    id.sessionSk,
    t.game.rnd,
  );
}

/** A game-action Move by `seat` on `prev`, signed by hand (no duty check). */
function actionMove(
  t: V2Table,
  seat: number,
  prev: Hex,
  seq: number,
  action: unknown,
  at = NOW,
  shares: { pos: number; share: ReturnType<typeof makeMoveRollShare> }[] = [],
): NostrEvent {
  return finalizeEvent(
    moveTemplate(
      { rootId: t.game.rootId, prevId: prev, seq, content: { type: 'action', action, reveals: [], shares } },
      at,
      '2',
    ),
    (t.game.ids[seat] as Identity).sessionSk,
    t.game.rnd,
  );
}

describe('vector 7: dice in Bank 0.2.0 (PROTOCOL-v2 §12.2 item 7)', () => {
  const file = readFileSync(FILE, 'utf8');
  const v = JSON.parse(file) as DiceVectors;
  /** A spectator built from the file's own table, Joins and root, holding M. */
  const spectator = (): GameSessionV2 => {
    const s = GameSessionV2.create({
      modules: MODULES,
      table: v.table,
      joins: v.joins,
      root: v.root,
      me: null,
      rootSeenAt: ROOT_SEEN,
    });
    expect(s.receive(v.move, NOW)).toEqual({ status: 'accepted' });
    return s;
  };

  it('regenerates test/vectors/dice-v2.json byte for byte', () => {
    expect(diceFile()).toBe(file);
  }, 120_000);

  it("V2-35 derives the faces from the seat-ordered seed by faces(seed, count, sides), the same in every order of the contributions, the requester's last included", () => {
    // Every intermediate value from the file alone: the point, each D = x_k·H(M, 0), the seed and the faces.
    const point = moveRollPoint(v.root.id, v.move.id, 0);
    expect(encodePoint(point)).toBe(v.roll.point);
    for (const c of v.contributions) {
      const x = BigInt(`0x${(v.identities[c.seat] as { deckSecret: string }).deckSecret}`);
      expect(encodePoint(point.multiply(x))).toBe(c.D);
      expect(encodePoint(parseSharesV2(c.event).shares[0]?.share.D as never)).toBe(c.D);
    }
    const bytes = v.contributions.map((c) => decodePoint(c.D).toBytes(true));
    // An independent SHA-256 (node:crypto) over the 33-byte compressed points, in seat order.
    const seed = Uint8Array.from(createHash('sha256').update(Buffer.concat(bytes)).digest());
    expect(Buffer.from(seed).toString('hex')).toBe(v.rollSeed);
    expect(faces(seed, v.roll.count, v.roll.sides)).toEqual(v.faces);
    expect(v.rolled).toEqual({
      actor: 'beacon',
      action: { type: 'rolled', actor: 'beacon', id: v.roll.id, dice: v.faces },
      seq: 1,
    });
    // Every order: the roll waits for the last contribution, whoever sends it, and then it is the same roll.
    expect(v.orders).toHaveLength(6);
    expect(v.orders.filter((o) => o.requesterLast)).toHaveLength(2);
    const ends = new Set<string>();
    for (const o of v.orders) {
      const s = spectator();
      expect(s.waitingFor()).toEqual([0, 1, 2]);
      for (const [i, step] of o.steps.entries()) {
        const c = v.contributions[step.seat] as DiceVectors['contributions'][number];
        expect(s.receive(c.event, NOW).status).toBe(step.status);
        expect(s.waitingFor()).toEqual(step.waiting);
        expect(rolledOf(s)).toEqual(i < 2 ? [] : [v.rolled]);
        expect(s.view().pending.type).toBe(i < 2 ? 'beacon' : 'player');
      }
      expect((s.view().state as BankState).log.at(-1)).toMatchObject({ dice: v.faces });
      ends.add(snapshot(s));
    }
    expect(ends.size).toBe(1);
  });

  it('two devices of one seat contribute the same D: the second is a duplicate, never a fork, and nothing changes (vector 7)', () => {
    expect(v.secondDevice.D).toBe((v.contributions[v.secondDevice.seat] as { D: string }).D);
    expect(v.secondDevice.event.id).not.toBe(
      (v.contributions[v.secondDevice.seat] as { event: NostrEvent }).event.id,
    );
    const s = spectator();
    const plain = spectator();
    for (const step of v.twoDevices.steps) {
      const ev =
        step.device === 2
          ? v.secondDevice.event
          : (v.contributions[step.seat] as DiceVectors['contributions'][number]).event;
      expect(s.receive(ev, NOW).status).toBe(step.status);
      expect(s.waitingFor()).toEqual(step.waiting);
      if (step.device === 1) plain.receive(ev, NOW);
    }
    expect(v.twoDevices.steps.find((x) => x.device === 2)?.status).toBe('duplicate');
    expect(s.view().fork).toBeNull();
    expect(canonicalJson(s.view())).toBe(canonicalJson(plain.view()));
    // Both are held (rule (b) and the rebroadcast count them); only one contribution is kept.
    expect(s.heldSet().filter((x) => x.kind === 'roll')).toHaveLength(4);
    expect(rolledOf(s)).toEqual([v.rolled]);
    // The second device first: it is kept, and the first device's event is then the duplicate.
    const swapped = spectator();
    swapped.receive(v.secondDevice.event, NOW);
    expect(
      swapped.receive((v.contributions[v.secondDevice.seat] as { event: NostrEvent }).event, NOW).status,
    ).toBe('duplicate');
  });

  it("a rival Roll is a fork at the root: the roller's stop, the same in every order, no contribution to either Roll owed (vector 7, T10)", () => {
    const fresh = (): GameSessionV2 =>
      GameSessionV2.create({
        modules: MODULES,
        table: v.table,
        joins: v.joins,
        root: v.root,
        me: null,
        rootSeenAt: ROOT_SEEN,
      });
    const r = v.rival;
    const roller = v.requester;
    expect(r.orders.length).toBeGreaterThanOrEqual(4);
    const ends = new Set<string>();
    for (const o of r.orders) {
      const s = fresh();
      for (const [i, x] of o.order.entries()) {
        const ev =
          x === 'M'
            ? v.move
            : x === 'rival'
              ? r.event
              : (v.contributions[x] as DiceVectors['contributions'][number]).event;
        expect(s.receive(ev, NOW).status).toBe(o.statuses[i]);
      }
      const view = s.view();
      expect(view.fork).toEqual(o.fork);
      expect(view.fork).toEqual({
        at: v.root.id,
        seat: roller,
        certificate: [v.move.id, r.event.id].sort(),
      });
      // Not cancelled (both Rolls are valid game actions at P), P before play: the others share first, all 0.
      expect(view.stop).toEqual({ at: v.root.id, seat: roller, cancelled: false });
      expect(o.stop).toEqual(view.stop);
      expect(view.equivocators).toEqual([roller]);
      expect(view.outcome).toEqual({
        places: [0, 1, 2].map((k) => (k === roller ? 3 : 1)),
        reason: 'stop',
        scores: [0, 0, 0],
      });
      expect(o.outcome).toEqual(view.outcome);
      expect(view.phase).toBe('done');
      expect(s.waitingFor()).toEqual([]);
      expect(view.owed.roll).toEqual([]);
      // No roll was derived on the walk: it ends at the root.
      expect(rolledOf(s)).toEqual([]);
      ends.add(snapshot(s));
    }
    expect(ends.size).toBe(1);
    expect(r.duties).toEqual([[], [], []]);
  });
});

describe('Bank 0.2.0 under protocol 2: the first roll (3 seats)', () => {
  let t: V2Table;
  let roller: number;
  /** The roller's Roll, the requesting move M. */
  let M: NostrEvent;
  /** Every seat's contribution to (M, 0), built by its duty and not yet delivered. */
  let contributionsOf: NostrEvent[];
  beforeAll(() => {
    t = v2Table(bank as AnyModule, 3, 'v2-dice');
    roller = decider(t) as number;
    const s = t.players[roller] as GameSessionV2;
    M = act(t, roller, s.legalActions()[0]);
    contributionsOf = t.players.map((p) => p.buildRoll(M.id, t.game.rnd, NOW));
  });

  it('V2-31 maps the roll entry a Roll appends to (M, 0), and owes every seat a roll duty for it', () => {
    expect(t.spectator.view().pending).toEqual({ type: 'beacon', id: 0 });
    expect([...walkOf(t.spectator).rolls]).toEqual([[0, { move: M.id, n: 0, id: 0, count: 2, sides: 6 }]]);
    expect([...walkOf(t.spectator).requests]).toEqual([[M.id, 1]]);
    for (const p of t.players)
      expect(p.duties()).toEqual([{ kind: 'roll', move: M.id, indices: [0], anchor: M.id }]);
  });

  it('V2-27 anchors every roll Shares event on the head it was built on (card Shares events: prompt-release.test.ts); V2-01 (partial) at proto 2', () => {
    for (const ev of contributionsOf) {
      expect(anchorOf(ev)).toBe(M.id);
      expect(ev.tags.filter((tag) => tag[0] === 'proto')).toEqual([['proto', '2']]);
      expect(parseSharesV2(ev)).toMatchObject({ type: 'roll', moveId: M.id, shares: [{ pos: 0 }] });
    }
  });

  it('V2-36 treats every seat without a contribution to the pending roll as stalled, the requester included; a roll Shares event that removes one is progress', () => {
    const c = replay(t);
    expect(c.spectator.waitingFor()).toEqual([0, 1, 2]);
    expect(c.spectator.view().owed).toEqual({ reveal: [], roll: [0, 1, 2] });
    const since = c.spectator.view().pendingSince;
    const order = [roller, (roller + 1) % 3, (roller + 2) % 3];
    const left = [0, 1, 2];
    for (const [i, seat] of order.entries()) {
      const at = NOW + 1000 * (i + 1);
      for (const s of c.all) expect(s.receive(contributionsOf[seat], at)).toEqual({ status: 'accepted' });
      left.splice(left.indexOf(seat), 1);
      if (i < 2) {
        expect(c.spectator.waitingFor()).toEqual(left);
        expect(c.spectator.view().owed.roll).toEqual(left);
      }
      // Progress (v1 §8.1, D030 Ruling 11): the contribution's first-seen time.
      expect(c.spectator.view().pendingSince).toBe(at);
    }
    expect(since).toBeLessThan(NOW + 1000);
    // The roll is derived: the next decision is pending, and nobody owes a contribution.
    expect(c.spectator.view().pending.type).toBe('player');
    expect(c.spectator.view().owed.roll).toEqual([]);
    expect(rolledOf(c.spectator)).toHaveLength(1);
    for (const p of c.players) expect(rollDuties(p)).toEqual([]);
  });

  it("V2-32 verifies each contribution against its requesting move's point (deck id roll, position n) and keeps one per (seat, M, n); an invalid one is still held", () => {
    const c = replay(t);
    const s = c.spectator;
    const k = (roller + 1) % 3;
    // Made for another move's point (the root id stands in for a rival M), named for M: it fails.
    const wrongPoint = rollEvent(c, k, M.id, [0], M.id, c.game.rootId);
    expect(s.receive(wrongPoint, NOW)).toEqual({
      status: 'rejected',
      reason: `the contribution to roll 0 of move ${M.id} does not verify`,
    });
    // An index M did not request: invalid as a whole, even though its index 0 verifies.
    const tooMany = rollEvent(c, k, M.id, [0, 1], M.id, M.id, NOW + 1);
    expect(s.receive(tooMany, NOW)).toEqual({
      status: 'rejected',
      reason: `move ${M.id} requested 1 roll, not roll 1`,
    });
    // A requesting move nobody holds: it waits (stored), counted by its anchor all the same.
    const unknown = rollEvent(c, k, 'ab'.repeat(32), [0], M.id);
    expect(s.receive(unknown, NOW)).toEqual({ status: 'stored' });
    // All three are held (D066), none counts: seat k is still stalled.
    expect(s.heldSet().map((x) => x.id)).toEqual([wrongPoint.id, tooMany.id, unknown.id].sort());
    expect(s.waitingFor()).toEqual([0, 1, 2]);
    expect(s.receive(tooMany, NOW).status).toBe('rejected');
    // The real one counts; a second event by the same seat with the same D (another proof) is a duplicate.
    expect(s.receive(contributionsOf[k] as NostrEvent, NOW)).toEqual({ status: 'accepted' });
    const again = rollEvent(c, k, M.id, [0], M.id, M.id, NOW + 2);
    expect(again.id).not.toBe((contributionsOf[k] as NostrEvent).id);
    expect(s.receive(again, NOW)).toEqual({ status: 'duplicate' });
    expect(s.waitingFor()).toEqual([0, 1, 2].filter((x) => x !== k));
  });

  it('V2-32 a roll Shares event naming a held move that is not a game action, or a game action that requested no roll, is invalid', () => {
    const c = replay(t);
    const s = c.spectator;
    const id0 = c.game.ids[0] as Identity;
    // A shuffle-shaped move 1 in this deckless game: held (shape-bad), and not a game action.
    const input = initialDeck('dummy', 1);
    const { out, psi, rPrime } = shuffleDeck(input, G.multiply(id0.deckSecret), c.game.rnd);
    const proof = proveShuffle(
      input,
      out,
      G.multiply(id0.deckSecret),
      psi,
      rPrime,
      { rootId: c.game.rootId, seat: 0, deckId: 'dummy' },
      c.game.rnd,
    );
    const step = finalizeEvent(
      moveTemplate(
        {
          rootId: c.game.rootId,
          prevId: c.game.rootId,
          seq: 1,
          content: { type: 'shuffle', deck: out, proof },
        },
        NOW,
        '2',
      ),
      id0.sessionSk,
      c.game.rnd,
    );
    expect(s.receive(step, NOW)).toEqual({
      status: 'rejected',
      reason: 'move 1 must be a game action',
    });
    const onStep = rollEvent(c, 1, step.id, [0], M.id);
    expect(s.receive(onStep, NOW)).toEqual({
      status: 'rejected',
      reason: `the requesting move ${step.id} is not a game action`,
    });
    // After the roll, the next decision (bank or stay) requests no roll.
    for (const ev of contributionsOf) s.receive(ev, NOW);
    const decider2 = (s.view().pending as { seat: number }).seat;
    const next = actionMove(c, decider2, M.id, 2, { type: 'stay', actor: decider2 });
    const bankIt = actionMove(c, decider2, M.id, 2, { type: 'bank', actor: decider2 });
    const linked = [next, bankIt].find((ev) => s.receive(ev, NOW).status === 'accepted');
    expect(linked).toBeDefined();
    const onAction = rollEvent(c, 1, (linked as NostrEvent).id, [0], (linked as NostrEvent).id);
    expect(s.receive(onAction, NOW)).toEqual({
      status: 'rejected',
      reason: `move ${(linked as NostrEvent).id} requested 0 rolls, not roll 0`,
    });
  });

  it('V2-33 treats as invalid a Move that carries a contribution, a player-sent rolled, and any game action while the beacon is pending; each is still held', () => {
    const c = replay(t);
    const s = c.spectator;
    const next = (roller + 1) % 3;
    const id = c.game.ids[roller] as Identity;
    const share = makeMoveRollShare(id.deckSecret, c.game.rootId, M.id, 0, c.game.rnd);
    const carrying = actionMove(c, next, M.id, 2, { type: 'stay', actor: next }, NOW, [{ pos: 0, share }]);
    expect(s.receive(carrying, NOW)).toEqual({
      status: 'rejected',
      reason: 'a deckless game carries no shares or reveals',
    });
    const dice = actionMove(c, roller, M.id, 2, { type: 'rolled', actor: 'beacon', id: 0, dice: [6, 6] });
    expect(s.receive(dice, NOW)).toEqual({ status: 'rejected', reason: 'a player does not send the dice' });
    // Invalid at M's point while the beacon waits, but not for good (judged again once the roll is derived, §6.2):
    // stored, never rejected, so no caller drops it as final (review of T9, L1).
    const early = actionMove(c, next, M.id, 2, { type: 'stay', actor: next }, NOW + 1);
    expect(s.receive(early, NOW)).toEqual({ status: 'stored' });
    expect(walkOf(s).judged.get(early.id)).toMatchObject({ kind: 'wait' });
    // Held: received again the first two stay rejected, the early one is a duplicate; the walk has not moved.
    for (const ev of [carrying, dice]) expect(s.receive(ev, NOW).status).toBe('rejected');
    expect(s.receive(early, NOW).status).toBe('duplicate');
    expect(s.view().head).toEqual({ id: M.id, seq: 1 });
    // A shape-bad move and a player-sent roll never become valid, whatever arrives.
    for (const ev of contributionsOf) s.receive(ev, NOW);
    for (const ev of [carrying, dice]) expect(s.receive(ev, NOW).status).toBe('rejected');
  });

  it('a game action signed while the beacon was pending is judged again once the roll is derived: the walk caches judgements by the derived rolls (review of T6/T7, L2)', () => {
    // The decision that follows the roll, from a table that holds every contribution.
    const done = replay(t, [...t.log, ...contributionsOf]);
    const p = done.spectator.view().pending as { type: string; seat: number };
    expect(p.type).toBe('player');
    const action = (done.players[p.seat] as GameSessionV2).legalActions()[0];
    const early = actionMove(t, p.seat, M.id, 2, action, NOW + 3);
    // Early first: invalid at M's point while the beacon is pending (stored: not final), then valid once the last
    // contribution arrives.
    const a = replay(t);
    expect(statusesOf(a.all, early)).toEqual(a.all.map(() => 'stored'));
    for (const s of a.all) expect(s.branchOf(early.id)).toBe('ahead');
    for (const ev of contributionsOf) send(a, ev);
    for (const s of a.all) expect(s.view().head).toEqual({ id: early.id, seq: 2 });
    // The contributions first: valid at once. Both orders end in the same state.
    const b = replay(t, [...t.log, ...contributionsOf]);
    expect(statusesOf(b.all, early)).toEqual(b.all.map(() => 'accepted'));
    for (const [i, s] of a.all.entries()) expect(snapshot(s)).toBe(snapshot(b.all[i] as GameSessionV2));
  });

  it('V2-34 (partial) owes its contribution only once the requesting move is on its chain, never while a fork is held; the requester contributes after its own move', () => {
    // Before M is held, no seat owes anything, the requester included, and buildRoll refuses.
    const before = replay(t, t.log.slice(0, -1));
    for (const p of before.players) {
      expect(rollDuties(p)).toEqual([]);
      expect(() => p.buildRoll(M.id, t.game.rnd, NOW)).toThrow(/no roll duty is due/);
    }
    expect(before.players[roller]?.duties()).toEqual([{ kind: 'decide' }]);
    // The requester's own contribution comes after its move.
    send(before, M);
    expect(rollDuties(before.players[roller] as GameSessionV2)).toEqual([
      { kind: 'roll', move: M.id, indices: [0], anchor: M.id },
    ]);
    // A rival Roll by the roller on the same prev: a fork. No seat owes or builds a contribution to either.
    const forked = replay(t);
    const rival = actionMove(
      forked,
      roller,
      M.tags.find((x) => x[3] === 'prev')?.[1] as Hex,
      1,
      {
        type: 'roll',
        actor: roller,
        rollId: 0,
      },
      NOW + 9,
    );
    send(forked, rival);
    expect(forked.spectator.view().fork).toMatchObject({ seat: roller });
    for (const p of forked.players) {
      expect(p.duties()).toEqual([]);
      expect(() => p.buildRoll(M.id, t.game.rnd, NOW)).toThrow(/no roll duty is due/);
      expect(() => p.buildRoll(rival.id, t.game.rnd, NOW)).toThrow(/no roll duty is due/);
    }
    // While a fork is held nobody is shown as owing a contribution (§5.7: no seat is stalled).
    expect(forked.spectator.view().owed.roll).toEqual([]);
    expect(forked.spectator.waitingFor()).toEqual([]);
  });
});

/** Two rolls per turn: three four-sided dice, then one twenty-sided die. Over after each seat's turn. */
interface PairState {
  readonly seats: number;
  readonly turn: number;
  readonly turns: number;
  readonly rolls: readonly RollEntry[];
  readonly open: readonly number[];
  readonly faces: readonly (readonly number[])[];
}
const PAIR_ENTRIES = [
  { count: 3, sides: 4 },
  { count: 1, sides: 20 },
] as const;
/** Each seat's sum of faces: turn t's two rolls are faces 2t and 2t+1. */
const pairScores = (s: PairState): number[] =>
  Array.from({ length: s.seats }, (_, k) =>
    s.faces
      .filter((_, i) => Math.floor(i / 2) % s.seats === k)
      .flat()
      .reduce((a, b) => a + b, 0),
  );
const fail = (message: string) => ({ ok: false as const, error: { code: 'illegal', message } });
const pair: GameModule<PairState, { readonly type: string }, { readonly turns: 1 }> = {
  id: 'pair-roller',
  version: '0.0.1',
  protocols: [2],
  defaultRules: () => ({ turns: 1 }),
  validateRules: (r) =>
    canonicalJson(r) === '{"turns":1}' ? { ok: true, value: { turns: 1 } } : fail('rules are {"turns":1}'),
  seatRange: () => ({ min: 2, max: 4 }),
  decks: () => [],
  setup: (input) => ({
    ok: true,
    value: { seats: input.seats, turn: 0, turns: 0, rolls: [], open: [], faces: [] },
  }),
  pending: (s) => {
    if (s.open.length > 0) return { type: 'beacon', id: s.open[0] as number };
    if (s.turns >= s.seats) return { type: 'over' };
    return { type: 'player', seat: s.turn, decision: 'roll' };
  },
  legalActions: (s, seat) =>
    s.open.length === 0 && s.turns < s.seats && seat === s.turn ? [{ type: 'roll', actor: seat }] : [],
  apply: (s, a) => {
    const x = a as { type?: unknown; actor?: unknown; id?: unknown; dice?: unknown };
    if (canonicalJson(a) === canonicalJson({ type: 'roll', actor: s.turn })) {
      if (s.open.length > 0 || s.turns >= s.seats) return fail('not now');
      const base = s.rolls.length;
      const added = PAIR_ENTRIES.map((e, i) => ({ id: base + i, ...e }));
      const state = { ...s, rolls: [...s.rolls, ...added], open: added.map((e) => e.id) };
      return { ok: true, state, events: [{ type: 'rolling' }] };
    }
    if (x.type === 'rolled' && x.actor === 'beacon' && x.id === s.open[0] && Array.isArray(x.dice)) {
      const entry = s.rolls.find((e) => e.id === x.id) as RollEntry;
      const dice = x.dice as unknown[];
      if (
        dice.length !== entry.count ||
        dice.some((d) => !Number.isSafeInteger(d) || (d as number) < 1 || (d as number) > entry.sides)
      )
        return fail('bad dice');
      const open = s.open.slice(1);
      const done = open.length === 0;
      const state = {
        ...s,
        open,
        faces: [...s.faces, dice as number[]],
        turn: done ? (s.turn + 1) % s.seats : s.turn,
        turns: done ? s.turns + 1 : s.turns,
      };
      return { ok: true, state, events: [{ type: 'rolled' }] };
    }
    return fail('bad action');
  },
  learn: () => fail('no cards'),
  knownTo: () => [],
  view: (s) => s,
  outcome: (s) => {
    if (s.turns < s.seats) return null;
    const scores = pairScores(s);
    return { places: scores.map((x) => 1 + scores.filter((y) => y > x).length), scores, reason: 'declared' };
  },
  standings: (s) => pairScores(s),
  dealt: () => [],
  revealsOf: () => [],
  invariants: () => [],
  rolls: (s) => s.rolls,
};

describe('several rolls from one game action (a two-roll test module, 2 seats)', () => {
  const registry = new Map([...MODULES, [pair.id, pair as AnyModule]]);
  let t: V2Table;
  let M: NostrEvent;
  beforeAll(() => {
    t = v2Table(pair as AnyModule, 2, 'v2-dice-pair', pair.defaultRules(), registry);
    M = act(t, 0, { type: 'roll', actor: 0 });
  });

  it('V2-31 maps the roll entries one game action appends to (M, 0) … (M, r−1) in list order; one roll Shares event per requesting move holds every index', () => {
    expect([...walkOf(t.spectator).rolls]).toEqual([
      [0, { move: M.id, n: 0, id: 0, count: 3, sides: 4 }],
      [1, { move: M.id, n: 1, id: 1, count: 1, sides: 20 }],
    ]);
    for (const p of t.players)
      expect(p.duties()).toEqual([{ kind: 'roll', move: M.id, indices: [0, 1], anchor: M.id }]);
    const ev = (t.players[1] as GameSessionV2).buildRoll(M.id, t.game.rnd, NOW);
    expect(parseSharesV2(ev).shares.map((x) => x.pos)).toEqual([0, 1]);
  });

  it('V2-32 a roll Shares event with one contribution that fails is invalid as a whole: none of its contributions is kept', () => {
    const c = replay(t);
    const id = c.game.ids[1] as Identity;
    const shares = [
      { pos: 0, share: makeMoveRollShare(id.deckSecret, c.game.rootId, M.id, 0, c.game.rnd) },
      // Index 1's contribution made for index 0's point: its proof fails at position 1.
      { pos: 1, share: makeMoveRollShare(id.deckSecret, c.game.rootId, M.id, 0, c.game.rnd) },
    ];
    const half = finalizeEvent(
      rollSharesTemplate({ rootId: c.game.rootId, anchorId: M.id, moveId: M.id, shares }, NOW),
      id.sessionSk,
      c.game.rnd,
    );
    expect(c.spectator.receive(half, NOW)).toEqual({
      status: 'rejected',
      reason: `the contribution to roll 1 of move ${M.id} does not verify`,
    });
    expect(c.spectator.waitingFor()).toEqual([0, 1]);
    expect(c.players[1]?.receive(half, NOW).status).toBe('rejected');
    expect(c.players[1]?.duties()).toEqual([{ kind: 'roll', move: M.id, indices: [0, 1], anchor: M.id }]);
  });

  it("V2-35 draws each roll's faces with its own entry's count and sides, from the seed of its own index n", () => {
    const c = replay(t);
    runAuto(c, ['roll']);
    // Each seat's contributions, in seat order; roll n's seed is the hash of the seats' D for index n.
    const bySeat = [0, 1].map((seat) => {
      const key = getPublicKey((c.game.ids[seat] as Identity).sessionSk);
      return parseSharesV2(c.log.find((ev) => ev.kind === 7453 && ev.pubkey === key) as NostrEvent);
    });
    const want = PAIR_ENTRIES.map((e, n) =>
      faces(rollSeed(bySeat.map((x) => (x.shares[n] as (typeof x.shares)[number]).share)), e.count, e.sides),
    );
    expect(rolledOf(c.spectator).map((x) => (x.action as { dice: number[] }).dice)).toEqual(want);
    expect(rolledOf(c.spectator).map((x) => (x.action as { id: number }).id)).toEqual([0, 1]);
    expect(rolledOf(c.spectator).every((x) => x.seq === 1)).toBe(true);
    expect((c.spectator.view().state as PairState).faces).toEqual(want);
    expect(c.spectator.view().pending).toEqual({ type: 'player', seat: 1, decision: 'roll' });
  });
});

describe('review follow-ups after T9 (L3, I1)', () => {
  let t: V2Table;
  let roller: number;
  let M: NostrEvent;
  let contributionsOf: NostrEvent[];
  beforeAll(() => {
    t = v2Table(bank as AnyModule, 3, 'v2-dice-followups');
    roller = decider(t) as number;
    M = act(t, roller, (t.players[roller] as GameSessionV2).legalActions()[0]);
    contributionsOf = t.players.map((p) => p.buildRoll(M.id, t.game.rnd, NOW));
  });

  const proofsOf = (s: GameSessionV2): Map<Hex, string | null> =>
    (s as unknown as { caches: { rolls: { proofs: Map<Hex, string | null> } } }).caches.rolls.proofs;

  it('L3: a roll Shares event whose requesting move is a held game action off the walk is stored with no proof checked', () => {
    const c = replay(t);
    const s = c.spectator;
    // A held game action off the walk: a stay on the root by a seat that is not pending (invalid at its prev).
    const other = (roller + 1) % 3;
    const off = actionMove(c, other, c.game.rootId, 1, { type: 'stay', actor: other });
    expect(s.receive(off, NOW).status).toBe('rejected');
    // 40 indices, each made against the off-walk move's points: never verified, whatever their number.
    const big = rollEvent(c, 1, off.id, [...Array(40).keys()], M.id);
    const started = performance.now();
    expect(s.receive(big, NOW)).toEqual({ status: 'stored' });
    expect(performance.now() - started).toBeLessThan(200);
    expect(proofsOf(s).has(big.id)).toBe(false);
    // Held all the same (D066), counted by its anchor; received again, still stored work-free (a duplicate).
    expect(s.heldSet().map((x) => x.id)).toContain(big.id);
    expect(s.receive(big, NOW)).toEqual({ status: 'duplicate' });
    expect(proofsOf(s).has(big.id)).toBe(false);
    // The same indices naming the requesting move on the walk: rejected by the index check, before any proof.
    const onWalk = rollEvent(c, 1, M.id, [...Array(40).keys()], M.id);
    expect(s.receive(onWalk, NOW)).toEqual({
      status: 'rejected',
      reason: `move ${M.id} requested 1 roll, not roll 1`,
    });
    expect(proofsOf(s).has(onWalk.id)).toBe(false);
  });

  it('I1: pendingSince is the root time while a fork is held, the same whether contributions came before the rival or after', () => {
    const prev = M.tags.find((x) => x[3] === 'prev')?.[1] as Hex;
    const rival = actionMove(t, roller, prev, 1, { type: 'roll', actor: roller, rollId: 0 }, NOW + 9);
    // Contributions first (each removes a stalled seat: progress), then the rival Roll: a fork at the root.
    const a = replay(t);
    for (const [i, ev] of contributionsOf.slice(0, 2).entries())
      a.spectator.receive(ev, NOW + 1000 * (i + 1));
    expect(a.spectator.view().pendingSince).toBe(NOW + 2000);
    a.spectator.receive(rival, NOW + 3000);
    // The rival first: the contributions name a move off the walk (stored), and nothing was progress.
    const b = replay(t);
    b.spectator.receive(rival, NOW + 3000);
    for (const [i, ev] of contributionsOf.slice(0, 2).entries())
      b.spectator.receive(ev, NOW + 1000 * (i + 1));
    for (const x of [a, b]) {
      expect(x.spectator.view().fork).toMatchObject({ seat: roller });
      expect(x.spectator.view().pendingSince).toBe(ROOT_SEEN);
      expect(x.spectator.waitingFor()).toEqual([]);
    }
    expect(snapshot(a.spectator)).toBe(snapshot(b.spectator));
  });
});

describe('Bank 0.2.0 under protocol 2: a whole game (3 seats)', () => {
  const rules = { ...bank.defaultRules(), rounds: 5 };
  let t: V2Table;
  beforeAll(() => {
    t = v2Table(bank as AnyModule, 3, 'v2-dice-game', rules);
    const rng = createRng('v2-dice-game');
    for (let i = 0; i < 5000; i++) {
      runAuto(t, ['roll']);
      const k = decider(t);
      if (k === null) break;
      act(t, k, quick((t.players[k] as GameSessionV2).legalActions(), k, rng));
    }
    runAuto(t);
  }, 300_000);

  it('V2-39 (partial) plays to over with every roll contributed by every seat; the audit replays the logged rolls and passes', () => {
    const v = t.spectator.view();
    expect(v.phase).toBe('done');
    expect(v.audit).toBe('pass');
    expect(v.result).toMatchObject({ kind: 'over', forfeit: [] });
    const rolls = rolledOf(t.spectator);
    const moves = walkOf(t.spectator).chain.length;
    expect(rolls.length).toBeGreaterThan(5);
    // One derived roll per Roll action, logged at its requesting move's seq.
    const rollMoves = walkOf(t.spectator).chain.filter(
      (h) => h.m.content.type === 'action' && (h.m.content.action as { type: string }).type === 'roll',
    );
    expect(rolls.map((x) => x.seq)).toEqual(rollMoves.map((h) => h.m.seq));
    expect(moves).toBe(v.head.seq);
    for (const p of t.players) expect(p.duties()).toEqual([{ kind: 'attest' }]);
    expect(v.endAttested).toEqual([0, 1, 2]);
  });

  it('reaches the same views, duties and held set from the same events in other arrival orders, with duplicates', () => {
    const base = t.all.map(snapshot);
    const rng = createRng('v2-dice-orders');
    for (let round = 0; round < 3; round++) {
      const order = shuffle(
        [...t.log.keys(), ...Array.from({ length: 20 }, () => rng.int(t.log.length))],
        rng,
      );
      const c = replay(t, t.log, order);
      expect(c.all.map(snapshot)).toEqual(base);
    }
  }, 300_000);
});
