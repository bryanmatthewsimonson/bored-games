import { type BankState, bank } from '@bored-games/bank';
import { chainReaction } from '@bored-games/chain-reaction';
import { chess } from '@bored-games/chess';
import { canonicalJson, createRng } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type Hex,
  type NostrEvent,
  type ParsedMove,
  parseMove,
  timeoutTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Identity } from '../../src/types.ts';
import { gameRecord } from '../../src/v2/record.ts';
import type { GameSessionV2 } from '../../src/v2/session.ts';
import { NOW, ROOT_SEEN } from '../helpers.ts';
import {
  type AnyModule,
  act,
  actionAt,
  decider,
  digest,
  inOrders,
  quick,
  replay,
  runAuto,
  send,
  signedMove,
  trustSteps,
  type V2Table,
  v2Table,
} from './helpers-v2.ts';

/*
 * Forks and the stop (PROTOCOL-v2 §5.1, §5.2, §5.6, §5.7; build plan T10; vector 5 of §12.2, in part): the topmost
 * fork decides and no branch is ever picked; every M1 equivocator shares the last places; a stop is cancelled only
 * when no game action is held at or past P on a valid line (H1), otherwise scored by `standings` at P (all 0 before
 * play); while stopped nothing is owed. Each scenario is replayed in several arrival orders, with duplicates, and
 * every session (each seat and a spectator) must reach the same views and duties.
 */

const mv = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });

/** A Chess table where `plies` are played in turn; returns it and the moves. */
function chessGame(seed: string, plies: readonly [number, string][]): { t: V2Table; moves: NostrEvent[] } {
  const t = v2Table(chess as AnyModule, 2, seed);
  const moves = plies.map(([seat, uci]) => act(t, seat, mv(seat, uci)));
  return { t, moves };
}

const idOf = (ev: NostrEvent): Hex => ev.id;

describe('the stop in a deckless 2-seat game (Chess)', () => {
  const opening: [number, string][] = [
    [0, 'e2e4'],
    [1, 'e7e5'],
    [0, 'g1f3'],
    [1, 'b8c6'],
  ];

  it("V2-22 scores a 2-seat stop during play as E's rated loss: E last, the other first, scores the standings at P, reason stop", () => {
    const { t, moves } = chessGame('stop-2', opening);
    const [, m2, m3] = moves as [NostrEvent, NostrEvent, NostrEvent, NostrEvent];
    // White signs a second move 3 on m2: a fork at m2, signed by seat 0.
    const rival = actionAt(t, 0, m2.id, 3, mv(0, 'f1c4'));
    const log = [...t.log, rival];
    const r = inOrders(t, log, 'stop-2');
    const standings = chess.standings(r.spectator.view().state as never);
    for (const s of r.all) {
      const v = s.view();
      expect(v.fork).toEqual({ at: m2.id, seat: 0, certificate: [m3.id, rival.id].sort() });
      expect(v.stop).toEqual({ at: m2.id, seat: 0, cancelled: false });
      expect(v).toMatchObject({ phase: 'done', result: null, stood: false, head: { id: m2.id, seq: 2 } });
      expect(v.outcome).toEqual({ places: [2, 1], reason: 'stop', scores: [...standings] });
      expect(v.equivocators).toEqual([0]);
      expect(v.forfeits).toEqual([0]);
      // A deckless game has no audit after a stop: the record names the equivocators, as a timeout its forfeits.
      expect(v.audit).toEqual({ fail: [0], reason: 'stop' });
      expect(v.secretWithheld).toEqual([]);
      expect(v.auditIncomplete).toBe(false);
      expect(v.pendingSince).toBe(ROOT_SEEN);
    }
    expect(gameRecord(r.spectator.view())).toEqual({
      ending: 'stop',
      places: [2, 1],
      rated: [true, true],
      endedBy: 0,
      equivocators: [0],
      secretWithheld: [],
      auditIncomplete: false,
    });
  });

  it('V2-15 picks no branch at a fork: a side that reached mate, or the longer side, is never scored', () => {
    // Fool's mate is one move away for Black; Black signs the mate and a quiet rival on the same prev.
    const { t, moves } = chessGame('stop-branch', [
      [0, 'f2f3'],
      [1, 'e7e5'],
      [0, 'g2g4'],
    ]);
    const m3 = moves[2] as NostrEvent;
    const mate = actionAt(t, 1, m3.id, 4, mv(1, 'd8h4'));
    const quiet = actionAt(t, 1, m3.id, 4, mv(1, 'b8c6'));
    // The quiet side goes on for two more moves: it is the longer side.
    const q5 = actionAt(t, 0, quiet.id, 5, mv(0, 'b1c3'));
    const q6 = actionAt(t, 1, q5.id, 6, mv(1, 'g8f6'));
    const r = inOrders(t, [...t.log, mate, quiet, q5, q6], 'stop-branch');
    for (const s of r.all) {
      const v = s.view();
      expect(v.stop).toEqual({ at: m3.id, seat: 1, cancelled: false });
      // The mate is not the result, and nothing past P is scored: Black, who mated on one side, is last.
      expect(v.result).toBeNull();
      expect(v.head).toEqual({ id: m3.id, seq: 3 });
      expect(v.outcome).toMatchObject({ places: [1, 2], reason: 'stop' });
      expect(chess.pending(v.state as never).type).toBe('player');
      for (const id of [mate, quiet, q5, q6].map(idOf)) expect(s.chainSeq(id)).toBeNull();
      expect(s.duties()).toEqual([]);
    }
  });

  it('V2-16 judges only the topmost fork: a later fork above moves P up, a fork below is never judged on its own, in any order', () => {
    const { t, moves } = chessGame('stop-topmost', [...opening, [0, 'f1c4'], [1, 'g8f6']]);
    const [, m2, m3, m4, m5] = moves as [NostrEvent, NostrEvent, NostrEvent, NostrEvent, NostrEvent];
    // White forks at m4 (a second move 5), and again at m2 (a second move 3): the topmost is at m2.
    const low = actionAt(t, 0, m4.id, 5, mv(0, 'd2d3'));
    const high = actionAt(t, 0, m2.id, 3, mv(0, 'b1c3'));
    // The low fork alone: the walk ends at m4.
    const lowOnly = replay(t, [...t.log, low]);
    expect(lowOnly.spectator.view().stop).toEqual({ at: m4.id, seat: 0, cancelled: false });
    // Junk below the high fork's rival: a seat-1 move on m2 (not its turn: invalid), and two seat-0 moves on it.
    // That line is not valid, so the pair on it records nobody.
    const junk = actionAt(t, 1, m2.id, 3, mv(1, 'a7a6'));
    const j1 = actionAt(t, 0, junk.id, 4, mv(0, 'a2a3'));
    const j2 = actionAt(t, 0, junk.id, 4, mv(0, 'h2h3'));
    const r = inOrders(t, [...t.log, low, high, junk, j1, j2], 'stop-topmost', 4);
    for (const s of r.all) {
      const v = s.view();
      expect(v.fork).toEqual({ at: m2.id, seat: 0, certificate: [m3.id, high.id].sort() });
      expect(v.stop).toEqual({ at: m2.id, seat: 0, cancelled: false });
      expect(v.equivocators).toEqual([0]);
      expect(v.outcome).toMatchObject({ places: [2, 1], reason: 'stop' });
      expect(s.chainSeq(m5.id)).toBeNull();
    }
  });

  it('V2-50 records a 2-seat double equivocation as a tie: both seats share the place, P the higher fork', () => {
    const { t, moves } = chessGame('stop-double', opening);
    const [, m2, m3] = moves as [NostrEvent, NostrEvent, NostrEvent, NostrEvent];
    // Black forks at m3 (a second move 4); White forks above it, at m2. m3's line runs through one side of the
    // higher fork and is valid, so Black is an equivocator too (M1).
    const black = actionAt(t, 1, m3.id, 4, mv(1, 'd7d6'));
    const white = actionAt(t, 0, m2.id, 3, mv(0, 'd2d4'));
    const r = inOrders(t, [...t.log, black, white], 'stop-double', 4);
    const scores = chess.standings(r.spectator.view().state as never);
    for (const s of r.all) {
      const v = s.view();
      expect(v.stop).toEqual({ at: m2.id, seat: 0, cancelled: false });
      expect(v.equivocators).toEqual([0, 1]);
      expect(v.outcome).toEqual({ places: [1, 1], reason: 'stop', scores: [...scores] });
      expect(v.forfeits).toEqual([0, 1]);
    }
    expect(gameRecord(r.spectator.view())).toMatchObject({
      ending: 'stop',
      places: [1, 1],
      rated: [true, true],
      endedBy: 0,
      equivocators: [0, 1],
    });
  });

  it("H1: a fork at the root signed after play began is E's loss, never a cancel; P before play, so scores are 0", () => {
    const { t } = chessGame('stop-root', opening);
    const second = actionAt(t, 0, t.game.rootId, 1, mv(0, 'd2d4'));
    const r = inOrders(t, [...t.log, second], 'stop-root');
    for (const s of r.all) {
      const v = s.view();
      expect(v.stop).toEqual({ at: t.game.rootId, seat: 0, cancelled: false });
      expect(v.outcome).toEqual({ places: [2, 1], reason: 'stop', scores: [0, 0] });
      expect(v.head).toEqual({ id: t.game.rootId, seq: 0 });
    }
    // Even with no move but the two firsts, a deckless fork is never a cancel: both are game actions at P.
    const bare = v2Table(chess as AnyModule, 2, 'stop-root-bare');
    const a = actionAt(bare, 0, bare.game.rootId, 1, mv(0, 'e2e4'));
    const b = actionAt(bare, 0, bare.game.rootId, 1, mv(0, 'd2d4'));
    const r2 = inOrders(bare, [a, b], 'stop-root-bare');
    expect(r2.spectator.view().stop).toEqual({ at: bare.game.rootId, seat: 0, cancelled: false });
    expect(r2.spectator.view().outcome).toEqual({ places: [2, 1], reason: 'stop', scores: [0, 0] });
  });

  it('V2-24 accepts no Timeout claim while stopped: claims are held, nobody is stalled, and no claim can be built', () => {
    const { t, moves } = chessGame('stop-claims', opening);
    const m4 = moves[3] as NostrEvent;
    const rival = actionAt(t, 1, (moves[2] as NostrEvent).id, 4, mv(1, 'g8f6'));
    send(t, rival);
    const claim = finalizeEvent(
      timeoutTemplate({ rootId: t.game.rootId, headId: (moves[2] as NostrEvent).id, seat: 1 }, NOW, '2'),
      (t.game.ids[0] as Identity).sessionSk,
      t.game.rnd,
    );
    const late = NOW + 100 * 86_400;
    for (const s of t.all) {
      expect(s.receive(claim, late)).toEqual({ status: 'stored' });
      s.tick(late);
      expect(s.waitingFor()).toEqual([]);
      expect(s.view()).toMatchObject({ result: null, stop: { seat: 1, cancelled: false } });
      expect(s.view().outcome).toMatchObject({ places: [1, 2], reason: 'stop' });
      expect(s.chainSeq(m4.id)).toBeNull();
    }
    for (const p of t.players) {
      expect(p.timeoutTarget(late)).toBeNull();
      expect(() => p.buildTimeout(1, t.game.rnd, late)).toThrow();
    }
  });

  it('V2-38 (partial) publishes no end or stats attestation for a stop: none is owed, and neither can be built', () => {
    const { t, moves } = chessGame('stop-attest', opening);
    send(t, actionAt(t, 0, (moves[1] as NostrEvent).id, 3, mv(0, 'd2d4')));
    for (const p of t.players) {
      expect(p.duties()).toEqual([]);
      expect(() => p.buildEndAttest(t.game.rnd, NOW)).toThrow(/no end duty/);
      expect(() => p.attestTemplate(NOW)).toThrow(/no attest duty/);
      expect(p.view().endAttested).toEqual([]);
      expect(p.view().attested).toEqual([]);
    }
  });
});

describe('the stop with 3 seats (Bank 0.2.0)', () => {
  let t: V2Table;
  /** Each decision taken: the seat, the head it was taken on, its seq, the legal actions there and the action. */
  const decisions: { seat: number; prev: Hex; seq: number; legal: unknown[]; action: unknown }[] = [];

  beforeAll(() => {
    t = v2Table(bank as AnyModule, 3, 'stop-bank');
    const rng = createRng('stop-bank');
    for (let i = 0; i < 60; i++) {
      runAuto(t, ['roll']);
      const k = decider(t);
      if (k === null) break;
      const s = t.players[k] as GameSessionV2;
      const legal = [...s.legalActions()];
      const head = s.view().head;
      const action = quick(legal, k, rng);
      act(t, k, action);
      decisions.push({ seat: k, prev: head.id, seq: head.seq + 1, legal, action });
      const state = t.spectator.view().state as BankState;
      if (state.round >= 2 && decisions.length >= 12) break;
    }
    runAuto(t, ['roll']);
  }, 300_000);

  /** The decisions where another legal action was open, with one (`alt`), in play order. */
  const choices = () =>
    decisions
      .map((d, i) => ({ ...d, i, alt: d.legal.find((a) => canonicalJson(a) !== canonicalJson(d.action)) }))
      .filter((d) => d.alt !== undefined);

  /** The places of a stop: non-equivocators by score (ties share), then the equivocators sharing the last. */
  const expectedPlaces = (scores: readonly number[], eq: readonly number[]): number[] => {
    const top = scores.map((_, k) => k).filter((k) => !eq.includes(k));
    return scores.map((x, k) =>
      eq.includes(k) ? top.length + 1 : 1 + top.filter((j) => (scores[j] as number) > x).length,
    );
  };

  it('V2-22 scores a 3-seat stop during play: E last and rated, the others by standings at P and unrated', () => {
    const all = choices();
    const d = all[all.length - 1] as (typeof all)[number];
    const rival = actionAt(t, d.seat, d.prev, d.seq, d.alt, NOW + 1);
    const r = inOrders(t, [...t.log, rival], 'stop-bank-3', 2);
    const v = r.spectator.view();
    expect(v.stop).toEqual({ at: d.prev, seat: d.seat, cancelled: false });
    const scores = bank.standings(v.state as BankState);
    // Banked points at P: the standings decide the other seats' places.
    expect(scores.some((x) => x > 0)).toBe(true);
    expect(v.outcome).toEqual({
      places: expectedPlaces(scores, [d.seat]),
      reason: 'stop',
      scores: [...scores],
    });
    expect(v.outcome?.places[d.seat]).toBe(3);
    expect(v.equivocators).toEqual([d.seat]);
    expect(gameRecord(v)).toMatchObject({
      ending: 'stop',
      rated: [0, 1, 2].map((k) => k === d.seat),
      endedBy: d.seat,
      equivocators: [d.seat],
    });
    for (const p of r.players) expect(p.duties()).toEqual([]);
  });

  it("V2-50 records a colluder's higher fork and the lower fork's seat as equivocators, sharing the last places; P is the higher fork", () => {
    // Seat A forks late; seat B (another seat) forks earlier, above it, on A's line.
    const all = choices();
    const low = all[all.length - 1] as (typeof all)[number];
    const high = all.find((d) => d.i < low.i && d.seat !== low.seat) as (typeof all)[number];
    expect(high).toBeDefined();
    expect(high.seq).toBeLessThan(low.seq);
    const lowRival = actionAt(t, low.seat, low.prev, low.seq, low.alt, NOW + 2);
    const highRival = actionAt(t, high.seat, high.prev, high.seq, high.alt, NOW + 3);
    const r = inOrders(t, [...t.log, lowRival, highRival], 'stop-bank-m1', 2);
    const eq = [low.seat, high.seat].sort((a, b) => a - b);
    for (const s of r.all) {
      const v = s.view();
      expect(v.stop).toEqual({ at: high.prev, seat: high.seat, cancelled: false });
      expect(v.equivocators).toEqual(eq);
      const scores = bank.standings(v.state as BankState);
      expect(v.outcome).toEqual({ places: expectedPlaces(scores, eq), reason: 'stop', scores: [...scores] });
      for (const k of eq) expect(v.outcome?.places[k]).toBe(2);
    }
    expect(gameRecord(r.spectator.view())).toMatchObject({
      rated: [0, 1, 2].map((k) => eq.includes(k)),
      endedBy: high.seat,
      equivocators: eq,
    });
    // Without the higher fork the low one is the stop, and only its seat is recorded.
    const alone = replay(t, [...t.log, lowRival]);
    expect(alone.spectator.view()).toMatchObject({
      stop: { at: low.prev, seat: low.seat },
      equivocators: [low.seat],
    });
  });
});

describe('forks in the shuffle and the deal, and late forks there (Chain Reaction, 3 seats)', () => {
  let base: V2Table;
  let steps: NostrEvent[];
  let deals: NostrEvent[];

  beforeAll(() => {
    base = v2Table(chainReaction as AnyModule, 3, 'stop-cr');
    steps = [];
    for (let k = 0; k < 3; k++) {
      const ev = (base.players[k] as GameSessionV2).buildShuffle(base.game.rnd, NOW);
      trustSteps(base.all, [ev]);
      send(base, ev);
      steps.push(ev);
    }
    deals = runAuto(base, ['deal']).map((x) => x.ev);
    const rng = createRng('stop-cr');
    for (let i = 0; i < 4; i++) {
      const k = decider(base) as number;
      act(base, k, quick(base.players[k]?.legalActions() ?? [], k, rng));
      runAuto(base, ['release']);
    }
  }, 300_000);

  /** A rival of shuffle step `i` (0-based) by its seat: the same output reversed, well-formed, its proof failing. */
  const rivalStep = (t: V2Table, i: number): NostrEvent => {
    const m = parseMove(steps[i], 108, '2') as ParsedMove;
    const c = m.content as Extract<ParsedMove['content'], { type: 'shuffle' }>;
    return signedMove(t, i, m.prevId, m.seq, { ...c, deck: [...c.deck].reverse() }, NOW + 7);
  };

  const cancelledEverywhere = (t: V2Table, at: Hex, seat: number): void => {
    for (const s of t.all) {
      const v = s.view();
      expect(v.stop).toEqual({ at, seat, cancelled: true });
      expect(v).toMatchObject({ phase: 'cancelled', outcome: null, result: null, forfeits: [] });
      expect(v.equivocators).toEqual([seat]);
      expect(v.secretWithheld).toEqual([]);
      expect(v.auditIncomplete).toBe(false);
      expect(s.waitingFor()).toEqual([]);
    }
    // A cancel owes nothing, not even a secret, attests nothing (V2-38), and records the seat that forked.
    for (const p of t.players) {
      expect(p.duties()).toEqual([]);
      expect(() => p.buildEndAttest(t.game.rnd, NOW)).toThrow(/no end duty/);
      expect(() => p.attestTemplate(NOW)).toThrow(/no attest duty/);
    }
    expect(gameRecord(t.spectator.view())).toEqual({
      ending: 'cancelled',
      places: [],
      rated: [false, false, false],
      endedBy: seat,
      equivocators: [seat],
      secretWithheld: [],
      auditIncomplete: false,
    });
  };

  it('V2-22 cancels a shuffle fork: no game action is held at or past P', () => {
    const rival = rivalStep(base, 1);
    const r = inOrders(base, [...steps.slice(0, 2), rival], 'stop-cr-shuffle');
    cancelledEverywhere(r, (steps[0] as NostrEvent).id, 1);
  });

  it('V2-22 cancels a deal-phase fork, also with a game action held on the rival whose line is not valid', () => {
    // Every step and deal is in (play could start), then the last shuffler signs a rival step 3.
    const rival = rivalStep(base, 2);
    const r = inOrders(base, [...steps, ...deals, rival], 'stop-cr-deal');
    cancelledEverywhere(r, (steps[1] as NostrEvent).id, 2);
    // A game action on the rival step: at or past P, but its line holds a step whose proof fails.
    const first = base.spectator.view().pending as { seat: number };
    const onRival = actionAt(base, first.seat, rival.id, 4, { type: 'x' }, NOW + 8);
    const r2 = inOrders(base, [...steps, ...deals, rival, onRival], 'stop-cr-deal-2', 2);
    cancelledEverywhere(r2, (steps[1] as NostrEvent).id, 2);
  });

  it("H1: a fork at an old shuffle step signed after play began is E's loss, P before play: the others share first, scores 0", () => {
    const rival = rivalStep(base, 1);
    const r = inOrders(base, [...base.log, rival], 'stop-cr-late', 2);
    for (const s of r.all) {
      const v = s.view();
      expect(v.stop).toEqual({ at: (steps[0] as NostrEvent).id, seat: 1, cancelled: false });
      expect(v.outcome).toEqual({ places: [1, 3, 1], reason: 'stop', scores: [0, 0, 0] });
      expect(v.equivocators).toEqual([1]);
      expect(v.phase).toBe('done');
    }
    // A stop in a deck game owes every seat its secret, and nothing else.
    for (const p of r.players) expect(p.duties()).toEqual([{ kind: 'secret' }]);
    expect(gameRecord(r.spectator.view())).toMatchObject({ ending: 'stop', rated: [false, true, false] });
  });

  it('V2-22 scores two first game actions on the last shuffle step as a stop before play, not a cancel', () => {
    const t = replay(base, [...steps, ...deals]);
    const k = decider(t) as number;
    const legal = t.players[k]?.legalActions() ?? [];
    expect(legal.length).toBeGreaterThan(1);
    // Both built on P (the last step) before either is sent.
    const a = (t.players[k] as GameSessionV2).buildAction(legal[0], t.game.rnd, NOW);
    const b = (t.players[k] as GameSessionV2).buildAction(legal[legal.length - 1], t.game.rnd, NOW + 1);
    const r = inOrders(base, [...steps, ...deals, a, b], 'stop-cr-first', 2);
    for (const s of r.all) {
      const v = s.view();
      expect(v.stop).toEqual({ at: (steps[2] as NostrEvent).id, seat: k, cancelled: false });
      expect(v.outcome).toEqual({
        places: [0, 1, 2].map((j) => (j === k ? 3 : 1)),
        reason: 'stop',
        scores: [0, 0, 0],
      });
      expect(v.equivocators).toEqual([k]);
    }
  });

  it('V2-24 owes no release while stopped, though positions are owed, and stalls nobody', () => {
    // The next decider signs two moves on the head: a stop during play.
    const t = replay(base);
    const k = decider(t) as number;
    const legal = t.players[k]?.legalActions() ?? [];
    expect(legal.length).toBeGreaterThan(1);
    const a = (t.players[k] as GameSessionV2).buildAction(legal[0], t.game.rnd, NOW);
    const b = (t.players[k] as GameSessionV2).buildAction(legal[legal.length - 1], t.game.rnd, NOW + 1);
    send(t, a);
    send(t, b);
    for (const p of t.players) {
      expect(p.duties()).toEqual([{ kind: 'secret' }]);
      expect(() => p.buildRelease(t.game.rnd, NOW)).toThrow(/no release duty/);
      expect(p.legalActions()).toEqual([]);
    }
    expect(t.spectator.waitingFor()).toEqual([]);
    expect(t.spectator.view().owed).toEqual({ reveal: [], roll: [] });
    expect(digest(t)).toBe(digest(replay(base, [...base.log, b, a])));
  });
});
