import { bank } from '@bored-games/bank';
import { type ChainReactionState, chainReaction } from '@bored-games/chain-reaction';
import { chess } from '@bored-games/chess';
import { createRng } from '@bored-games/game-kit';
import { DECK_OFFSETS, type LusterState, luster } from '@bored-games/luster';
import {
  endAttestTemplate,
  finalizeEvent,
  type Hex,
  logHash,
  type NostrEvent,
  parseAttestV2,
  resignTemplate,
  secretTemplate,
  timeoutTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Duty, Identity, ResultId } from '../../src/types.ts';
import { GameSessionV2 } from '../../src/v2/session.ts';
import { resultKey } from '../../src/v2/store.ts';
import { LATE, MODULES, NOW, ROOT_SEEN } from '../helpers.ts';
import {
  type AnyModule,
  act,
  actionAt,
  buildAuto,
  decider,
  inOrders,
  replay,
  runAuto,
  send,
  shuffleAll,
  type V2Table,
  v2Session,
  v2Table,
} from './helpers-v2.ts';

/*
 * Timeout claims and Resigns under protocol 2 (PROTOCOL-v2 §5.3, §5.5, §8.1, §8.3; build plan T12; vector 5 of §12.2,
 * in part): with no fork held, a client counts the first claim or Resign by v1's rules as §8 amends them, final
 * while no fork is held; a Resign counts once its named head is on the chain, and is scored at S along that head's
 * line, stopping at the first held fork past it; moves past a counted claim or Resign keep linking, unscored, so a
 * fork past them is found; a claim forfeiting only this seat counts before its own deadline only on its player's
 * confirmation (N2). Also the persisted first-standing times (review of T11, L-A).
 */

const mv = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });
const prevOf = (ev: NostrEvent): Hex =>
  (ev.tags.find((x) => x[0] === 'e' && x[3] === 'prev') as string[])[1] as Hex;
const hex = (rng: ReturnType<typeof createRng>): Hex =>
  Array.from({ length: 64 }, () => '0123456789abcdef'[rng.int(16)]).join('') as Hex;

/** The log hash of the line to `head` over the moves in `events` (PROTOCOL-v2 §4.3). */
function hashTo(t: V2Table, events: readonly NostrEvent[], head: Hex): Hex {
  const prev = new Map(events.filter((e) => e.kind === 7452).map((e) => [e.id, prevOf(e)]));
  const ids: Hex[] = [];
  for (let at = head; at !== t.game.rootId; at = prev.get(at) as Hex) ids.push(at);
  return logHash(ids.reverse());
}

/** An end attestation of `r` by `seat`'s session key, its log hash over `events` unless given. */
function endOf(
  t: V2Table,
  seat: number,
  r: ResultId,
  events: readonly NostrEvent[],
  opts: { hash?: Hex; at?: number } = {},
): NostrEvent {
  return finalizeEvent(
    endAttestTemplate(
      {
        rootId: t.game.rootId,
        headId: r.head,
        end: { kind: r.kind, forfeit: r.forfeit, logHash: opts.hash ?? hashTo(t, events, r.head) },
      },
      opts.at ?? NOW,
    ),
    (t.game.ids[seat] as Identity).sessionSk,
    t.game.rnd,
  );
}

/** A Timeout claim by `claimant` naming `head` against `seat`, built by hand (no deadline check). */
const claimOf = (t: V2Table, claimant: number, head: Hex, seat: number, at = NOW): NostrEvent =>
  finalizeEvent(
    timeoutTemplate({ rootId: t.game.rootId, headId: head, seat }, at, '2'),
    (t.game.ids[claimant] as Identity).sessionSk,
    t.game.rnd,
  );

/** A Resign by `seat` naming `head`, built by hand (a deckless game: no secret). */
const resignOf = (t: V2Table, seat: number, head: Hex, at = NOW): NostrEvent =>
  finalizeEvent(
    resignTemplate({ rootId: t.game.rootId, headId: head }, at, '2'),
    (t.game.ids[seat] as Identity).sessionSk,
    t.game.rnd,
  );

/** Chess moves built by each seat's session and delivered to every session of `t`. */
function play(t: V2Table, moves: [number, string][]): NostrEvent[] {
  return moves.map(([k, uci]) => act(t, k, mv(k, uci)));
}

const tickAll = (t: V2Table, now: number): void => {
  for (const s of t.all) s.tick(now);
};

const chessTable = (seed: string): V2Table => v2Table(chess as AnyModule, 2, seed);

describe('Resigns counted with no fork held (Chess)', () => {
  it('V2-42 counts a Resign only once its named head is on the chain: before that it waits and the game stays live, in every arrival order', () => {
    const t = chessTable('t12-wait');
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
    ]);
    expect(t.players[1]?.canResign()).toBe(true);
    const r = (t.players[1] as GameSessionV2).buildResign(t.game.rnd, NOW);
    expect(r.tags).toContainEqual(['e', (m[2] as NostrEvent).id, '', 'head']);
    // A table that gets the Resign before the head it names: held, not counted.
    const x = replay(t, [m[0] as NostrEvent, m[1] as NostrEvent]);
    expect(send(x, r)).toEqual(['stored', 'stored', 'stored']);
    for (const s of x.all) expect(s.view()).toMatchObject({ phase: 'play', result: null, resigned: [] });
    expect(x.players[0]?.duties()).toEqual([{ kind: 'decide' }]);
    // The head arrives: the Resign counts on every session, scored at S = its head (the resigner is to move).
    expect(send(x, m[2] as NostrEvent)).toEqual(['accepted', 'accepted', 'accepted']);
    const want: ResultId = { kind: 'resign', head: (m[2] as NostrEvent).id, forfeit: [1] };
    for (const s of x.all)
      expect(s.view()).toMatchObject({
        phase: 'done',
        result: want,
        stood: false,
        fork: null,
        resigned: [1],
        resignId: r.id,
        head: { id: (m[2] as NostrEvent).id },
        outcome: { places: [1, 2], reason: 'resign' },
        audit: { fail: [1], reason: 'resign' },
      });
    expect(x.players.map((s) => s.duties())).toEqual([[{ kind: 'end' }], [{ kind: 'end' }]]);
    expect(x.players.map((s) => s.canResign())).toEqual([false, false]);
    // Delivered in order, the Resign is `accepted` (it counts at once).
    const y = replay(t, m);
    expect(send(y, r)).toEqual(['accepted', 'accepted', 'accepted']);
    inOrders(t, [...m, r], 't12-wait', 4);
  });

  it('V2-42 never counts a Resign naming a held move off the chain (an invalid move), however play goes on', () => {
    const t = chessTable('t12-side');
    const m1 = act(t, 0, mv(0, 'e2e4'));
    // Black's illegal move on m1: held, judged invalid at its prev, never on the chain.
    const bad = actionAt(t, 1, m1.id, 2, mv(1, 'e7e4'));
    expect(send(t, bad)[0]).toBe('rejected');
    const r = resignOf(t, 1, bad.id);
    expect(send(t, r)).toEqual(['stored', 'stored', 'stored']);
    for (const s of t.all) expect(s.view()).toMatchObject({ phase: 'play', result: null });
    play(t, [
      [1, 'e7e5'],
      [0, 'g1f3'],
    ]);
    tickAll(t, LATE);
    for (const s of t.all) expect(s.view()).toMatchObject({ phase: 'play', result: null, resigned: [] });
    inOrders(t, t.log, 't12-side');
  });

  it("keeps v1's cancel rule: a Resign naming the root raced by another seat's first action cancels; a stale one by a seat that has played is its loss, the same in either order", () => {
    const t = chessTable('t12-cancel');
    const m1 = act(t, 0, mv(0, 'e2e4'));
    // Black resigns naming the root: it has no game action on the line to S (White's raced move 1 is scored).
    const raced = resignOf(t, 1, t.game.rootId);
    const a = inOrders(t, [m1, raced], 't12-raced');
    for (const s of a.all)
      expect(s.view()).toMatchObject({
        phase: 'cancelled',
        result: null,
        outcome: null,
        resigned: [1],
        forfeits: [1],
        resignId: raced.id,
      });
    expect(a.players.map((s) => s.duties())).toEqual([[], []]);
    // White resigns naming the root after its own move 1: S passes its action, so it is a loss, not a cancel. A
    // client that gets the Resign first counts it at once (a cancel, with no action by White held) and then folds
    // move 1 past it, which moves S past White's action: every order ends at the same result.
    const stale = resignOf(t, 0, t.game.rootId);
    const b = inOrders(t, [m1, stale], 't12-stale');
    const want: ResultId = { kind: 'resign', head: t.game.rootId, forfeit: [0] };
    for (const s of b.all)
      expect(s.view()).toMatchObject({
        phase: 'done',
        result: want,
        resigned: [0],
        head: { id: m1.id },
        outcome: { places: [2, 1], reason: 'resign' },
      });
    const first = replay(t, [stale]);
    expect(first.spectator.view()).toMatchObject({ phase: 'cancelled', resigned: [0] });
    send(first, m1);
    expect(first.spectator.view()).toMatchObject({ phase: 'done', result: want });
  });

  it("V2-17 gives a Resign the identity (resign, H, k) on every client, its end attestation's log hash over H's line and its stats attestation's over the line to S", () => {
    const t = chessTable('t12-ident');
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
    ]);
    // Black resigns naming m2 (it saw its own move as the head), while White's move 3 races it.
    const r = resignOf(t, 1, (m[1] as NostrEvent).id);
    const m3 = actionAt(t, 0, (m[1] as NostrEvent).id, 3, mv(0, 'g1f3'));
    const log = [...m, m3, r];
    const x = inOrders(t, log, 't12-ident', 5);
    const want: ResultId = { kind: 'resign', head: (m[1] as NostrEvent).id, forfeit: [1] };
    // S extends H through the contiguous moves of the seat pending at H (White's raced move 3).
    for (const s of x.all) expect(s.view()).toMatchObject({ result: want, head: { id: m3.id } });
    const ends = x.players.map((s) => s.buildEndAttest(t.game.rnd, NOW));
    for (const ev of ends) {
      const a = parseAttestV2(ev);
      expect(a).toMatchObject({
        variant: 'end',
        headId: want.head,
        end: { kind: 'resign', forfeit: [1], logHash: hashTo(t, log, want.head) },
      });
      send(x, ev);
    }
    for (const s of x.all) expect(s.view().endAttested).toEqual([0, 1]);
    const stats = (x.players[0] as GameSessionV2).attestTemplate(NOW);
    expect(JSON.parse(stats.content)).toMatchObject({
      logHash: hashTo(t, log, m3.id),
      outcome: { places: [1, 2], reason: 'resign' },
    });
    expect(hashTo(t, log, m3.id)).not.toBe(hashTo(t, log, want.head));
  });
});

describe("v1's Resign refusals are unchanged (v1 §8.3, PROTOCOL-v2 §8.3)", () => {
  /** A Resign by `seat` naming the root, with its deck secret. */
  const deckResign = (t: V2Table, seat: number): NostrEvent => {
    const id = t.game.ids[seat] as Identity;
    return finalizeEvent(
      resignTemplate({ rootId: t.game.rootId, headId: t.game.rootId, secret: id.deckSecret }, NOW, '2'),
      id.sessionSk,
      t.game.rnd,
    );
  };
  // Luster opts out of Resign; this copy opts in, to show the 2-seat deck refusal on its own.
  const optIn = { ...luster, resignAllowed: () => true } as AnyModule;
  const withOptIn = new Map([...MODULES, [luster.id, optIn]]);
  const withLuster = new Map([...MODULES, [luster.id, luster as AnyModule]]);

  it('refuses a Resign in a 2-seat game with a deck, and where the module opts out; allows it with 3 seats when the module allows it', () => {
    const two = v2Table(optIn, 2, 't12-refuse-2', luster.defaultRules(), withOptIn);
    expect(two.players.map((s) => s.canResign())).toEqual([false, false]);
    expect(() => two.players[0]?.buildResign(two.game.rnd, NOW)).toThrow(/not allowed/);
    expect(send(two, deckResign(two, 0))).toEqual(['rejected', 'rejected', 'rejected']);
    const opted = v2Table(luster as AnyModule, 3, 't12-refuse-out', luster.defaultRules(), withLuster);
    expect(opted.players.map((s) => s.canResign())).toEqual([false, false, false]);
    expect(send(opted, deckResign(opted, 1))).toEqual(opted.all.map(() => 'rejected'));
    const three = v2Table(optIn, 3, 't12-allow-3', luster.defaultRules(), withOptIn);
    expect(three.players.map((s) => s.canResign())).toEqual([true, true, true]);
    const r = (three.players[1] as GameSessionV2).buildResign(three.game.rnd, NOW);
    expect(JSON.parse(r.content)).toMatchObject({ type: 'resign' });
    expect(JSON.parse(r.content).secret).toEqual(expect.any(String));
    // Before any game action: it cancels; every other seat still owes its Secret reveal (v1 §8.3 "Cancelled").
    expect(send(three, r)).toEqual(three.all.map(() => 'accepted'));
    for (const s of three.all) expect(s.view()).toMatchObject({ phase: 'cancelled', resigned: [1] });
    expect(three.players.map((s) => s.duties())).toEqual([[{ kind: 'secret' }], [], [{ kind: 'secret' }]]);
  });

  it('allows no Resign while a fork is held (the game is stopped)', () => {
    const t = chessTable('t12-refuse-fork');
    send(t, actionAt(t, 0, t.game.rootId, 1, mv(0, 'e2e4')));
    send(t, actionAt(t, 0, t.game.rootId, 1, mv(0, 'd2d4')));
    for (const s of t.all) expect(s.view().stop).toMatchObject({ at: t.game.rootId, seat: 0 });
    expect(t.players.map((s) => s.canResign())).toEqual([false, false]);
    expect(() => t.players[1]?.buildResign(t.game.rnd, NOW)).toThrow(/not live/);
  });
});

describe('the Resign and Timeout claim builders', () => {
  it('V2-01 (partial) builds the Resign and the Timeout claim with exactly one ["proto","2"] tag', () => {
    const t = chessTable('t12-proto');
    act(t, 0, mv(0, 'e2e4'));
    const r = (t.players[1] as GameSessionV2).buildResign(t.game.rnd, NOW);
    tickAll(t, LATE);
    // Black is to move: White may claim against it once its deadline passed; Black, stalled, may not claim.
    const c = (t.players[0] as GameSessionV2).buildTimeout(1, t.game.rnd, LATE);
    expect(t.players[1]?.timeoutTarget(LATE)).toBeNull();
    expect(() => t.players[1]?.buildTimeout(0, t.game.rnd, LATE)).toThrow(/no timeout claim/);
    for (const ev of [r, c]) expect(ev.tags.filter((x) => x[0] === 'proto')).toEqual([['proto', '2']]);
    expect(r.kind).toBe(7457);
    expect(c.kind).toBe(7454);
  });
});

describe('Timeout claims counted with no fork held (Chess)', () => {
  it("V2-17 accepts a claim at the head by this client's own clock, with the seats stalled then as its identity; never one naming an old head or signed by a stalled seat", () => {
    const t = chessTable('t12-claim');
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
    ]);
    const head = (m[2] as NostrEvent).id;
    // White cannot claim before its own deadline.
    const w = t.players[0] as GameSessionV2;
    expect(w.timeoutTarget(NOW)).toBeNull();
    expect(() => w.buildTimeout(1, t.game.rnd, NOW)).toThrow(/no timeout claim/);
    // Black (seat 1) is to move. A claim by Black itself (stalled) and one naming an old head never count.
    const byStalled = claimOf(t, 1, head, 0);
    const old = claimOf(t, 0, (m[1] as NostrEvent).id, 1);
    expect(send(t, byStalled)).toEqual(['stored', 'stored', 'stored']);
    expect(send(t, old)).toEqual(['stored', 'stored', 'stored']);
    tickAll(t, LATE);
    for (const s of t.all) expect(s.view()).toMatchObject({ phase: 'play', result: null });
    // White's own claim, once its deadline passed.
    expect(w.timeoutTarget(LATE)).toBe(1);
    const claim = w.buildTimeout(1, t.game.rnd, LATE);
    expect(claim.tags).toContainEqual(['proto', '2']);
    // Received after the deadline: it counts at once, on Black's own session too (its own deadline passed).
    expect(send(t, claim)).toEqual(['accepted', 'accepted', 'accepted']);
    const want: ResultId = { kind: 'claim', head, forfeit: [1] };
    for (const s of t.all)
      expect(s.view()).toMatchObject({
        phase: 'done',
        result: want,
        forfeits: [1],
        audit: { fail: [1], reason: 'timeout' },
        outcome: { places: [1, 2] },
      });
    // Final: a later Resign or claim changes nothing, and no seat may claim or resign.
    send(t, resignOf(t, 0, head));
    for (const s of t.all) expect(s.view().result).toEqual(want);
    expect(t.players.map((s) => s.canResign())).toEqual([false, false]);
    expect(t.players.map((s) => s.timeoutTarget(LATE))).toEqual([null, null]);
    // Received before the deadline, the same claim waits for this client's clock.
    const early = replay(t, [...m, claim]);
    for (const s of early.all) expect(s.view().result).toBeNull();
    tickAll(early, LATE);
    for (const s of early.all) expect(s.view().result).toEqual(want);
  });

  it('cancels the game for a claim accepted before the first game action (v1 §8.2): no result, the stalled seat forfeits', () => {
    const t = chessTable('t12-claim-cancel');
    const claim = claimOf(t, 1, t.game.rootId, 0);
    send(t, claim);
    for (const s of t.all) expect(s.view()).toMatchObject({ phase: 'play', result: null });
    tickAll(t, LATE);
    for (const s of t.all)
      expect(s.view()).toMatchObject({ phase: 'cancelled', result: null, outcome: null, forfeits: [0] });
    expect(t.players.map((s) => s.duties())).toEqual([[], []]);
  });

  it('V2-23 keeps folding moves past a counted claim, unscored, and finds a fork past it: the claim stands if every seat but the forker attested it, else the stop overrides it', () => {
    const t = chessTable('t12-past');
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
    ]);
    const head = (m[2] as NostrEvent).id;
    tickAll(t, LATE);
    const claim = (t.players[0] as GameSessionV2).buildTimeout(1, t.game.rnd, LATE);
    send(t, claim);
    const want: ResultId = { kind: 'claim', head, forfeit: [1] };
    for (const s of t.all) expect(s.view().result).toEqual(want);
    const ends = runAuto(t, ['end']);
    expect(ends.map((x) => x.seat).sort()).toEqual([0, 1]);
    const scored = t.spectator.view();
    // Black (timed out) moves anyway, and White answers: both link on the walk, past the claim's head, unscored.
    const b4 = actionAt(t, 1, head, 4, mv(1, 'b8c6'));
    expect(send(t, b4)).toEqual(['accepted', 'accepted', 'accepted']);
    const w5 = actionAt(t, 0, b4.id, 5, mv(0, 'f1c4'));
    expect(send(t, w5)).toEqual(['accepted', 'accepted', 'accepted']);
    for (const s of t.all) {
      expect(s.chainSeq(w5.id)).toBe(5);
      expect(s.view()).toMatchObject({
        result: want,
        head: { id: head },
        outcome: scored.outcome,
        fork: null,
      });
    }
    // Black forks at w5: the walk ends there, past the claim's head. White attested the claim and signed nothing
    // off its line, so the claim stands against the fork, which only records Black.
    const f1 = actionAt(t, 1, w5.id, 6, mv(1, 'g8f6'));
    const f2 = actionAt(t, 1, w5.id, 6, mv(1, 'f8c5'));
    send(t, f1);
    send(t, f2);
    const stood = inOrders(t, t.log, 't12-past-stood');
    for (const s of stood.all)
      expect(s.view()).toMatchObject({
        result: want,
        stood: true,
        stop: null,
        fork: { at: w5.id, seat: 1 },
        equivocators: [1],
        outcome: scored.outcome,
      });
    // Without White's end attestation the claim does not stand: the fork stops the game, Black last (A2).
    const white = (ends.find((x) => x.seat === 0) as { ev: NostrEvent }).ev;
    const stop = inOrders(
      t,
      t.log.filter((ev) => ev.id !== white.id),
      't12-past-stop',
    );
    for (const s of stop.all)
      expect(s.view()).toMatchObject({
        result: null,
        stood: false,
        stop: { at: w5.id, seat: 1, cancelled: false },
        outcome: { places: [1, 2], reason: 'stop' },
      });
  });
});

describe('S stops at the first held fork past the named head (Chess)', () => {
  it('V2-43 computes S along the named head’s line forward and stops it at the first held fork past H; with no fork it runs along the chain', () => {
    const t = chessTable('t12-s');
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
    ]);
    const H = (m[1] as NostrEvent).id;
    // Black resigns naming m2; it then plays on anyway (its own later move counts: S0 passes it).
    const r = resignOf(t, 1, H);
    const m3 = actionAt(t, 0, H, 3, mv(0, 'g1f3'));
    const m4 = actionAt(t, 1, m3.id, 4, mv(1, 'b8c6'));
    const m5 = actionAt(t, 0, m4.id, 5, mv(0, 'f1c4'));
    const want: ResultId = { kind: 'resign', head: H, forfeit: [1] };
    // No fork: S is just after Black's last move m4, extended through White's contiguous move m5.
    const a = inOrders(t, [...m, r, m3, m4, m5], 't12-s-chain');
    for (const s of a.all)
      expect(s.view()).toMatchObject({ result: want, stood: false, head: { id: m5.id }, phase: 'done' });
    // Black attests its Resign; White forks at m4 (a second move 5). The fork is past H, so S stops at m4: neither
    // side is scored. Black attested and signed nothing off H's line, so the Resign stands against White's fork.
    const end = endOf(t, 1, want, [...m, m3]);
    const m5b = actionAt(t, 0, m4.id, 5, mv(0, 'd2d4'));
    const b = inOrders(t, [...m, r, m3, m4, m5, end, m5b], 't12-s-fork');
    for (const s of b.all)
      expect(s.view()).toMatchObject({
        result: want,
        stood: true,
        fork: { at: m4.id, seat: 0 },
        head: { id: m4.id },
        resigned: [1],
        outcome: { places: [1, 2], reason: 'resign' },
      });
    // A fork at H itself (two moves 3) leaves S at H.
    const m3b = actionAt(t, 0, H, 3, mv(0, 'd2d4'));
    const c = inOrders(t, [...m, r, m3, m3b, end], 't12-s-at-h');
    for (const s of c.all)
      expect(s.view()).toMatchObject({ result: want, stood: true, fork: { at: H }, head: { id: H } });
  });
});

describe('the own-forfeit question (PROTOCOL-v2 §8.1, review N2; Chess)', () => {
  it('V2-52 (partial) N2: a claim published right after a move does not end the game on the online seat; its move makes the claim fail everywhere', () => {
    const t = chessTable('t12-n2');
    // H (seat 1) has been watching since its sync, before the game's moves arrived.
    const h = t.players[1] as GameSessionV2;
    h.noteSync(ROOT_SEEN, ROOT_SEEN + 5);
    const m1 = act(t, 0, mv(0, 'e2e4'));
    const claim = claimOf(t, 0, m1.id, 1);
    expect(send(t, claim)).toEqual(['stored', 'stored', 'stored']);
    // Not accepted (H's deadline has not passed, no confirmation), and not asked: H watched the head arrive.
    expect(h.view()).toMatchObject({ phase: 'play', result: null, ownForfeit: null });
    expect(h.duties()).toEqual([{ kind: 'decide' }]);
    // A device that was not watching (the head came in its latest sync) is asked, and still accepts nothing.
    const away = replay(t, [m1]);
    const ha = away.players[1] as GameSessionV2;
    ha.noteSync(NOW - 1, NOW + 1);
    send(away, claim);
    expect(ha.view()).toMatchObject({ result: null, ownForfeit: { claim: claim.id } });
    expect(away.players[0]?.view().ownForfeit).toBeNull();
    expect(away.spectator.view().ownForfeit).toBeNull();
    // H moves: the claim names an old head, so it fails on every client, whatever their clocks.
    for (const x of [t, away]) {
      act(x, 1, mv(1, 'e7e5'));
      tickAll(x, LATE);
      for (const s of x.all)
        expect(s.view()).toMatchObject({ phase: 'play', result: null, ownForfeit: null });
      expect(x.players[0]?.duties()).toEqual([{ kind: 'decide' }]);
    }
  });

  it('V2-52 (partial) a returning client asks about a claim forfeiting only its seat, accepts and end-attests it only on confirmation, and otherwise only once its own deadline passes', () => {
    const t = chessTable('t12-return');
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
    ]);
    tickAll(t, LATE);
    const claim = (t.players[0] as GameSessionV2).buildTimeout(1, t.game.rnd, LATE);
    send(t, claim);
    const want: ResultId = { kind: 'claim', head: (m[2] as NostrEvent).id, forfeit: [1] };
    expect(t.spectator.view().result).toEqual(want);
    // Black's device comes back: it held moves 1 and 2 (their saved first-seen times), and its sync brings move 3
    // and the claim, fresh.
    const BACK = LATE + 1_000;
    const deadline = t.spectator.view().deadline;
    const returning = (confirmed: Hex[] = []): GameSessionV2 => {
      const s = GameSessionV2.create({
        modules: t.game.modules,
        table: t.game.table,
        joins: t.game.joins,
        root: t.game.root,
        me: t.game.ids[1] as Identity,
        rootSeenAt: ROOT_SEEN,
        confirmedForfeits: confirmed,
      });
      s.receive(m[0], NOW);
      s.receive(m[1], NOW);
      s.receive(m[2], BACK + 1);
      s.receive(claim, BACK + 2);
      s.noteSync(BACK, BACK + 5);
      s.tick(BACK + 5);
      return s;
    };
    const b = returning();
    expect(b.view()).toMatchObject({
      phase: 'play',
      result: null,
      ownForfeit: { claim: claim.id },
      pendingSince: BACK + 1,
    });
    // "Play" stays possible: the decision is still owed.
    expect(b.duties()).toEqual([{ kind: 'decide' }]);
    expect(b.view().ownForfeit).toEqual({ claim: claim.id, head: want.head });
    expect(b.confirmOwnForfeit(claim.id)).toBe(true);
    // Only the call that made the confirmed claim count says so.
    expect(b.confirmOwnForfeit(claim.id)).toBe(false);
    expect(b.view()).toMatchObject({ phase: 'done', result: want, ownForfeit: null });
    expect(b.confirmedForfeits()).toEqual([claim.id]);
    expect(b.duties()).toEqual([{ kind: 'end' }]);
    const end = parseAttestV2(b.buildEndAttest(t.game.rnd, BACK + 6));
    expect(end).toMatchObject({ headId: want.head, end: { kind: 'claim', forfeit: [1] } });
    // A reload that passes the confirmation back accepts it as soon as the events are in.
    expect(returning([claim.id]).view()).toMatchObject({ result: want, ownForfeit: null });
    // With no confirmation: not before its own deadline, then by v1's own-clock rule.
    const c = returning();
    c.tick(BACK + 1 + deadline - 1);
    expect(c.view()).toMatchObject({ result: null, ownForfeit: { claim: claim.id } });
    expect(c.duties()).toEqual([{ kind: 'decide' }]);
    c.tick(BACK + 1 + deadline);
    expect(c.view()).toMatchObject({ result: want, ownForfeit: null });
    // A device that was watching (move 3 first seen before its latest sync) is never asked, and still waits for
    // its deadline; a spectator cannot confirm.
    const w = returning();
    w.noteSync(BACK + 3, BACK + 4);
    expect(w.view()).toMatchObject({ result: null, ownForfeit: null });
    expect(() => t.spectator.confirmOwnForfeit(claim.id)).toThrow(/spectator/);
    // A confirmation of a claim that does not forfeit only this seat changes nothing.
    const white = v2Session(t.game, 0);
    for (const ev of [...m, claim]) white.receive(ev, NOW);
    expect(white.confirmOwnForfeit(claim.id)).toBe(false);
    expect(white.view().result).toBeNull();
  });
});

describe('claims forfeiting several seats: a pending Luster refill (3 seats)', () => {
  const registry = new Map([...MODULES, [luster.id, luster as AnyModule]]);
  let t: V2Table;
  beforeAll(() => {
    t = v2Table(luster as AnyModule, 3, 't12-luster', luster.defaultRules(), registry);
    shuffleAll(t);
    runAuto(t);
  }, 600_000);

  const physical = (deck: string, pos: number): number =>
    DECK_OFFSETS[deck as keyof typeof DECK_OFFSETS] + pos;

  it('V2-17 forfeits every seat missing a share of the refill when the claim is accepted: the identity lists them, on every client', () => {
    const k = decider(t) as number;
    const s = t.players[k] as GameSessionV2;
    const state = s.view().state as LusterState;
    const onDisplay = new Set(
      luster
        .dealt(state)
        .filter((d) => d.to === null)
        .map((d) => d.pos),
    );
    const reserve = (s.legalActions() as { type: string; deck: string; pos: number }[]).find(
      (a) => a.type === 'reserve' && a.deck === 'tier-1' && onDisplay.has(physical(a.deck, a.pos)),
    );
    const move = act(t, k, reserve);
    expect(t.spectator.waitingFor()).toEqual([0, 1, 2]);
    // One seat releases its share of the refill; the other two withhold theirs.
    const giver = (k + 1) % 3;
    const d = (t.players[giver] as GameSessionV2).duties().find((x) => x.kind === 'release');
    send(t, buildAuto(t, giver, d as Duty));
    const stalled = [0, 1, 2].filter((x) => x !== giver);
    expect(t.spectator.waitingFor()).toEqual(stalled);
    const g = t.players[giver] as GameSessionV2;
    expect(g.timeoutTarget(NOW)).toBeNull();
    expect(g.timeoutTarget(LATE)).toBe(stalled[0]);
    const claim = g.buildTimeout(stalled[0] as number, t.game.rnd, LATE);
    // Accepted by every client by its own clock, the forfeiting seats' own included (it forfeits more than them):
    // at once by the claimant's (its clock is past the deadline), by the others' once theirs is.
    expect(send(t, claim)).toEqual(t.all.map((x) => (x === g ? 'accepted' : 'stored')));
    for (const x of t.all) expect(x.view().result === null).toBe(x !== g);
    tickAll(t, LATE);
    const want: ResultId = { kind: 'claim', head: move.id, forfeit: stalled };
    for (const x of t.all) {
      const v = x.view();
      expect(v).toMatchObject({ phase: 'done', result: want, forfeits: stalled, ownForfeit: null });
      expect(v.audit).toEqual({ fail: stalled, reason: 'timeout' });
      for (const j of stalled) expect(v.outcome?.places[j]).toBe(2);
      expect(v.outcome?.places[giver]).toBe(1);
    }
    // Every seat end-attests the same identity, the forfeiting seats included (PROTOCOL-v2 §7.1).
    runAuto(t, ['end']);
    for (const x of t.all) expect(x.view().endAttested).toEqual([0, 1, 2]);
    expect(resultKey(want)).toBe(`claim|${move.id}|${stalled.join(',')}`);
  }, 120_000);
});

describe('a counted Resign in a game with a deck: the End phase and the partial audit (Chain Reaction, 3 seats)', () => {
  // C skips a placement though it holds a playable tile (a forged `skipPlace`: the others cannot see its hand) and
  // ends its turn; O then resigns at H's turn, with no fork held. Every seat but O owes its Secret reveal.
  let t: V2Table;
  let C: number;
  let H: number;
  let O: number;
  let log: NostrEvent[];
  let resign: NostrEvent;
  const honest = (x: V2Table): GameSessionV2[] =>
    [x.players[H], x.players[O], x.spectator] as GameSessionV2[];

  beforeAll(() => {
    t = v2Table(chainReaction as AnyModule, 3, 't12-cr');
    shuffleAll(t);
    runAuto(t, ['deal', 'release']);
    C = (t.spectator.view().pending as { seat: number }).seat;
    H = (C + 1) % 3;
    O = (C + 2) % 3;
    const v = t.spectator.view();
    expect((v.state as ChainReactionState).phase.kind).toBe('place');
    const skip = actionAt(t, C, v.head.id, v.head.seq + 1, { type: 'skipPlace', actor: C });
    expect(send(t, skip, honest(t))).toEqual(['accepted', 'accepted', 'accepted']);
    const v2 = t.spectator.view();
    const end = { type: 'endTurn', actor: C, buy: [], declareEnd: false, discard: [] };
    send(t, actionAt(t, C, v2.head.id, v2.head.seq + 1, end), honest(t));
    for (let i = 0; i < 20; i++) {
      const k = [H, O].find((x) =>
        (t.players[x] as GameSessionV2).duties().some((d) => d.kind === 'release'),
      );
      if (k === undefined) break;
      const d = (t.players[k] as GameSessionV2).duties().find((x) => x.kind === 'release');
      send(t, buildAuto(t, k, d as Duty), honest(t));
    }
    expect((t.spectator.view().pending as { seat: number }).seat).toBe(H);
    const o = t.players[O] as GameSessionV2;
    expect(o.canResign()).toBe(true);
    resign = o.buildResign(t.game.rnd, NOW);
    log = [...t.log];
  }, 600_000);

  it('V2-39 runs the partial audit up to S on a Resign this client counted, once every secret is in: the cheat forfeits above the resigner', () => {
    const x = replay(t, log);
    const hs = honest(x);
    expect(send(x, resign, hs)).toEqual(['accepted', 'accepted', 'accepted']);
    const head = t.spectator.view().head.id;
    const want: ResultId = { kind: 'resign', head, forfeit: [O] };
    for (const s of hs) expect(s.view()).toMatchObject({ phase: 'end', result: want, resigned: [O] });
    // O's secret came with its Resign; H owes its own, and C's is missing.
    expect(x.spectator.waitingFor()).toEqual([C, H].sort((a, b) => a - b));
    expect((x.players[H] as GameSessionV2).duties()).toEqual([{ kind: 'end' }]);
    for (const k of [H, O]) send(x, (x.players[k] as GameSessionV2).buildEndAttest(t.game.rnd, NOW), hs);
    send(x, (x.players[H] as GameSessionV2).buildSecret(t.game.rnd, NOW), hs);
    expect(x.spectator.waitingFor()).toEqual([C]);
    // C publishes its secret (its own session is stuck before its skip and owes nothing; built by hand here).
    const cId = t.game.ids[C] as Identity;
    const cSecret = finalizeEvent(
      secretTemplate({ rootId: t.game.rootId, deckSecret: cId.deckSecret }, NOW, '2'),
      cId.sessionSk,
      t.game.rnd,
    );
    send(x, cSecret, hs);
    for (const s of hs) {
      const v = s.view();
      expect(v).toMatchObject({ phase: 'done', result: want, resigned: [O] });
      expect(v.forfeits).toEqual([C, O].sort((a, b) => a - b));
      expect(v.audit).toMatchObject({ fail: [C, O].sort((a, b) => a - b) });
      expect((v.audit as { reason: string }).reason).toMatch(/^resign; /);
      expect(v.outcome?.places[O]).toBe(3);
      expect(v.outcome?.places[C]).toBe(2);
      expect(v.outcome?.places[H]).toBe(1);
      expect(v.outcome).toMatchObject({
        reason: 'resign',
        unrated: true,
        endedBy: { type: 'resign', seat: O },
      });
    }
  });

  it('accepts an End-phase claim against a withheld secret after a counted Resign, with no fork held, by its own clock', () => {
    const x = replay(t, log);
    const hs = honest(x);
    send(x, resign, hs);
    send(x, (x.players[H] as GameSessionV2).buildEndAttest(t.game.rnd, NOW), hs);
    send(x, (x.players[H] as GameSessionV2).buildSecret(t.game.rnd, NOW), hs);
    const h = x.players[H] as GameSessionV2;
    expect(h.timeoutTarget(NOW)).toBeNull();
    expect(h.timeoutTarget(LATE)).toBe(C);
    const claim = h.buildTimeout(C, t.game.rnd, LATE);
    // It names S (here the Resign's head: H is pending there and has not moved).
    expect(claim.tags).toContainEqual(['e', t.spectator.view().head.id, '', 'head']);
    send(x, claim, hs);
    for (const s of hs) s.tick(LATE);
    for (const s of hs) {
      const v = s.view();
      expect(v).toMatchObject({ phase: 'done', resigned: [O] });
      expect(v.audit).toEqual({ fail: [C, O].sort((a, b) => a - b), reason: 'resign; withheld secret' });
    }
  });
});

describe('the first-standing time is persisted (review of T11, L-A)', () => {
  // Fool's mate: Black (seat 1) mates at move 4; it then forks at move 1, so it is E. White's end attestation of the
  // mate makes it stand; first seen at +1000.
  let t: V2Table;
  let m: NostrEvent[];
  let X: ResultId;
  let att: NostrEvent;
  let rival: NostrEvent;
  let junkClaim: NostrEvent;
  let junkEnd: NostrEvent;
  let seen: Map<string, number>;
  const rng = createRng('t12-la');
  beforeAll(() => {
    t = chessTable('t12-la');
    m = play(t, [
      [0, 'f2f3'],
      [1, 'e7e5'],
      [0, 'g2g4'],
      [1, 'd8h4'],
    ]);
    X = { kind: 'over', head: (m[3] as NostrEvent).id, forfeit: [] };
    att = endOf(t, 0, X, m);
    rival = actionAt(t, 1, (m[0] as NostrEvent).id, 2, mv(1, 'd7d5'), NOW + 1);
    junkClaim = claimOf(t, 1, hex(rng), 0, NOW + 2);
    junkEnd = endOf(t, 1, X, m, { hash: hex(rng) });
    seen = new Map<string, number>([
      ...m.map((e, i): [string, number] => [e.id, ROOT_SEEN + 1 + i]),
      [rival.id, ROOT_SEEN + 5],
      [att.id, ROOT_SEEN + 1000],
      [junkClaim.id, ROOT_SEEN + 50_000],
      [junkEnd.id, ROOT_SEEN + 50_001],
    ]);
  });
  const feed = (
    order: NostrEvent[],
    times: Map<string, number> = seen,
    saved?: Record<string, number>,
  ): GameSessionV2 => {
    const s = GameSessionV2.create({
      modules: t.game.modules,
      table: t.game.table,
      joins: t.game.joins,
      root: t.game.root,
      me: null,
      rootSeenAt: ROOT_SEEN,
      ...(saved === undefined ? {} : { savedStanding: saved }),
    });
    for (const ev of order) s.receive(ev, times.get(ev.id) as number);
    return s;
  };

  it('a refeed by kind with an E junk claim and a junk end attestation keeps the deadline: refused and waiting events do not move it', () => {
    const arrival = feed([...m, rival, att, junkClaim, junkEnd]);
    expect(arrival.view()).toMatchObject({ stood: true, result: X, pendingSince: ROOT_SEEN + 1000 });
    expect(arrival.standingTimes()).toEqual({ [resultKey(X)]: ROOT_SEEN + 1000 });
    // By kind (7452, 7454, 7456): the junk claim waits for a head nobody holds, and the junk attestation's log hash
    // does not match (rejected): neither counts toward when the result first stood.
    const byKind = feed([...m, rival, junkClaim, att, junkEnd]);
    expect(byKind.view()).toMatchObject({ stood: true, pendingSince: ROOT_SEEN + 1000 });
    expect(byKind.standingTimes()).toEqual(arrival.standingTimes());
  });

  it('a refeed in saved order with a live event delivered mid-way keeps the saved first-standing time', () => {
    const arrival = feed([...m, rival, att, junkClaim, junkEnd]);
    const saved = arrival.standingTimes();
    // A live junk move by E (random prev, first seen at the reload), delivered before the refeed reaches the
    // attestation: held and waiting, so without the saved time it would set the first-standing time to the reload.
    const RELOAD = ROOT_SEEN + 200_000;
    const live = actionAt(t, 1, hex(rng), 7, mv(1, 'a7a6'), NOW + 3);
    const times = new Map(seen).set(live.id, RELOAD);
    const order = [...m, live, rival, att, junkClaim, junkEnd];
    expect(feed(order, times).view().pendingSince).toBe(RELOAD);
    const restored = feed(order, times, saved);
    expect(restored.view()).toMatchObject({ stood: true, result: X, pendingSince: ROOT_SEEN + 1000 });
    expect(restored.standingTimes()).toEqual(saved);
  });
  it("the fallback floor counts every held event rule (b) reads by a seat other than E, refused ones included, and not E's refused ones (review of T12, L-1)", () => {
    // An end attestation of X by White (not E) with a wrong log hash: held and refused (it counts for no result), and
    // anchored at X's head, so it blocks nothing. Fed before the attestation in a refeed, the floor counts it: rule (b)
    // reads it, so such an event can make a result stand by blocking a rival (rule (c)). The same by Black (E) does
    // not count: rule (b) ignores E's events.
    const lateWhite = endOf(t, 0, X, m, { hash: hex(rng), at: NOW + 4 });
    const lateBlack = endOf(t, 1, X, m, { hash: hex(rng), at: NOW + 5 });
    const times = new Map(seen).set(lateWhite.id, ROOT_SEEN + 3000).set(lateBlack.id, ROOT_SEEN + 4000);
    const arrival = feed([...m, rival, att, lateWhite, lateBlack], times);
    expect(arrival.receive(lateWhite, ROOT_SEEN + 3000).status).toBe('rejected');
    expect(arrival.view()).toMatchObject({ stood: true, pendingSince: ROOT_SEEN + 1000 });
    expect(feed([...m, rival, lateWhite, att], times).view().pendingSince).toBe(ROOT_SEEN + 3000);
    expect(feed([...m, rival, lateBlack, att], times).view().pendingSince).toBe(ROOT_SEEN + 1000);
  });
});

describe('stored claims are judged before each event is folded (review of T12, H-1)', () => {
  it("V2-17 counts a claim already due when the stalled seat's late move arrives: live with no tick, on a refeed in first-seen order, and on any refeed with the saved counted result", () => {
    const t = chessTable('t12-h1');
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
    ]);
    const head = (m[2] as NostrEvent).id;
    const deadline = t.spectator.view().deadline;
    const want: ResultId = { kind: 'claim', head, forfeit: [1] };
    // White's claim reaches this client just before its own deadline; Black (timed out, "Play" chosen on its
    // returning device) moves just after it.
    const claim = claimOf(t, 0, head, 1, NOW + deadline);
    const b4 = actionAt(t, 1, head, 4, mv(1, 'b8c6'));
    const times = new Map<string, number>([
      ...m.map((e): [string, number] => [e.id, NOW]),
      [claim.id, NOW + deadline - 10],
      [b4.id, NOW + deadline + 5],
    ]);
    const all = [...m, claim, b4];
    const make = (seat: number | null, saved?: ReturnType<GameSessionV2['countedResult']>): GameSessionV2 =>
      GameSessionV2.create({
        modules: t.game.modules,
        table: t.game.table,
        joins: t.game.joins,
        root: t.game.root,
        me: seat === null ? null : (t.game.ids[seat] as Identity),
        rootSeenAt: ROOT_SEEN,
        ...(saved === undefined ? {} : { savedCounted: saved }),
      });
    const feed = (s: GameSessionV2, order: readonly NostrEvent[]): GameSessionV2 => {
      for (const ev of order) s.receive(ev, times.get(ev.id) as number);
      return s;
    };
    // Live, with no tick between the deadline and the late move: the claim counts first, the move links past it.
    const live = feed(make(null), all);
    expect(live.view()).toMatchObject({ result: want, head: { id: head } });
    expect(live.chainSeq(b4.id)).toBe(4);
    // A client that counted the claim on a tick, then reloads and refeeds in first-seen order at saved times.
    const ticked = make(null);
    feed(ticked, [...m, claim]);
    ticked.tick(NOW + deadline);
    expect(ticked.view().result).toEqual(want);
    feed(ticked, [b4]);
    for (const seat of [null, 0, 1]) {
      const re = feed(make(seat), all);
      re.tick(NOW + deadline + 100);
      expect(re.view()).toMatchObject({ phase: 'done', result: want });
      expect(re.duties().some((d) => d.kind === 'decide')).toBe(false);
    }
    // A refeed in another order (the move before the claim) loses the count, unless the counted result is restored.
    const byKind = feed(make(0), [...m, b4, claim]);
    byKind.tick(NOW + deadline + 100);
    expect(byKind.view().result).toBeNull();
    const saved = ticked.countedResult();
    expect(saved).toEqual({ kind: 'claim', id: claim.id, head, forfeit: [1] });
    const restored = feed(make(0, saved), [...m, b4, claim]);
    expect(restored.view()).toMatchObject({ phase: 'done', result: want });
    expect(restored.countedResult()).toEqual(saved);
    // While its events are missing, the saved result waits (the game ended here, its outcome pending), and nothing
    // else counts meanwhile.
    const waiting = feed(make(0, saved), [...m, b4]);
    waiting.tick(LATE);
    expect(waiting.view()).toMatchObject({
      phase: 'end',
      result: null,
      outcome: null,
      awaitingCounted: saved,
    });
    expect(waiting.countedResult()).toEqual(saved);
  });

  it('V2-17 restores a saved claim whose event never comes back by any held claim of its identity, and owes nothing meanwhile: no move, no claim past its own end attestation (T12 fix round 2, M-1)', () => {
    const t = chessTable('t12-m1-trap');
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
    ]);
    const head = (m[2] as NostrEvent).id;
    const deadline = t.spectator.view().deadline;
    const want: ResultId = { kind: 'claim', head, forfeit: [1] };
    const claim = claimOf(t, 0, head, 1, NOW + deadline);
    const saved = { kind: 'claim' as const, id: claim.id, head, forfeit: [1] };
    const b4 = actionAt(t, 1, head, 4, mv(1, 'b8c6'));
    // White's client counted its claim and saved it; after a reload the relays send Black's late move, not the claim.
    const w = GameSessionV2.create({
      modules: t.game.modules,
      table: t.game.table,
      joins: t.game.joins,
      root: t.game.root,
      me: t.game.ids[0] as Identity,
      rootSeenAt: ROOT_SEEN,
      savedCounted: saved,
    });
    for (const ev of m) w.receive(ev, NOW);
    w.receive(b4, NOW + deadline + 5);
    w.tick(NOW + deadline + 100);
    expect(w.view()).toMatchObject({ phase: 'end', result: null, awaitingCounted: saved, forfeits: [1] });
    // It owes no decision and never plays past the result it attested, nor claims against Black, nor resigns.
    expect(w.duties()).toEqual([]);
    expect(w.legalActions()).toEqual([]);
    expect(() => w.buildAction(mv(0, 'f1c4'), t.game.rnd, NOW + deadline + 100)).toThrow(/no decide duty/);
    expect(w.timeoutTarget(NOW + 5 * deadline)).toBeNull();
    expect(w.canResign()).toBe(false);
    expect(w.countedResult()).toEqual(saved);
    // Another claim of the same identity (here a fresh one by White at that head) restores it: the scoring never
    // reads the event id.
    const other = claimOf(t, 0, head, 1, NOW + deadline + 7);
    w.receive(other, NOW + 5 * deadline);
    expect(w.view()).toMatchObject({ phase: 'done', result: want, awaitingCounted: null });
    expect(w.countedResult()).toEqual({ ...saved, id: other.id });
    expect(w.duties()).toEqual([{ kind: 'end' }]);
  });

  it('V2-17 restores a saved claim the cap evicted on a refeed in another order, by a lower-id claim of the same identity (T12 fix round 2, M-1)', () => {
    const t = chessTable('t12-m1-evict');
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
    ]);
    const head = (m[2] as NostrEvent).id;
    const deadline = t.spectator.view().deadline;
    const claims = [0, 1, 2, 3, 4]
      .map((i) => claimOf(t, 0, head, 1, NOW + deadline + i))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const top = claims[4] as NostrEvent;
    // The original client counted `top` (it came first) and saved it; four lower ids later evicted it from the cap.
    const o = v2Session(t.game, null);
    for (const ev of m) o.receive(ev, NOW);
    o.receive(top, NOW + deadline + 1);
    for (const c of claims.slice(0, 4)) o.receive(c, NOW + deadline + 2);
    const saved = o.countedResult();
    expect(saved?.id).toBe(top.id);
    // A refeed with the lower ids first: `top` is refused for good, and a lower id of the same identity restores it.
    const r = GameSessionV2.create({
      modules: t.game.modules,
      table: t.game.table,
      joins: t.game.joins,
      root: t.game.root,
      me: null,
      rootSeenAt: ROOT_SEEN,
      savedCounted: saved,
    });
    for (const ev of m) r.receive(ev, NOW);
    for (const c of claims.slice(0, 4)) r.receive(c, NOW + deadline + 2);
    expect(r.receive(top, NOW + deadline + 2)).toEqual({ status: 'rejected', reason: 'claim limit' });
    expect(r.view()).toMatchObject({ phase: 'done', result: { kind: 'claim', head, forfeit: [1] } });
    expect(r.countedResult()).toEqual({
      kind: 'claim',
      id: (claims[0] as NostrEvent).id,
      head,
      forfeit: [1],
    });
  });

  it("V2-17 keeps an honest claimant from forfeiting on a third seat that folds the timed-out seat's late move before its next tick (Bank, 3 seats)", () => {
    const t = v2Table(bank as AnyModule, 3, 't12-h1-bank');
    runAuto(t);
    for (let i = 0; i < 3; i++) {
      const k = decider(t) as number;
      send(t, (t.players[k] as GameSessionV2).buildAction(t.players[k]?.legalActions()[0], t.game.rnd, NOW));
      runAuto(t);
    }
    const B = decider(t) as number;
    const A = (B + 1) % 3;
    const C = (B + 2) % 3;
    const head = t.spectator.view().head.id;
    const deadline = t.spectator.view().deadline;
    const want: ResultId = { kind: 'claim', head, forfeit: [B] };
    const claim = claimOf(t, A, head, B, NOW + deadline);
    const late = (t.players[B] as GameSessionV2).buildAction(
      t.players[B]?.legalActions()[0],
      t.game.rnd,
      NOW + deadline,
    );
    // A counts its claim on sending it, its own deadline passed.
    const a = v2Session(t.game, A);
    for (const ev of t.log) a.receive(ev, NOW);
    expect(a.receive(claim, NOW + deadline).status).toBe('accepted');
    // C saw the head a second later; the claim reaches it just before its own deadline, B's late move just after,
    // before C's next tick. C counts the claim as A did, so it never times the honest A out.
    const c = v2Session(t.game, C);
    for (const ev of t.log) c.receive(ev, NOW + 1);
    expect(c.receive(claim, NOW + deadline).status).toBe('stored');
    c.receive(late, NOW + deadline + 6);
    a.receive(late, NOW + deadline + 6);
    for (const s of [a, c]) expect(s.view()).toMatchObject({ phase: 'done', result: want });
    expect(c.timeoutTarget(NOW + 3 * deadline)).toBeNull();
  });
});
