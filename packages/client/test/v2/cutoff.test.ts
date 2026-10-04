import { type BankState, bank } from '@bored-games/bank';
import { chess } from '@bored-games/chess';
import { type Ciphertext, G, makeShare } from '@bored-games/deck';
import { canonicalJson, createRng } from '@bored-games/game-kit';
import {
  cardSharesTemplate,
  endAttestTemplate,
  finalizeEvent,
  type Hex,
  logHash,
  type NostrEvent,
  resignTemplate,
  timeoutTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Identity, ResultId, SessionViewV2 } from '../../src/types.ts';
import { gameRecord } from '../../src/v2/record.ts';
import type { GameSessionV2 } from '../../src/v2/session.ts';
import { NOW } from '../helpers.ts';
import {
  type AnyModule,
  act,
  actionAt,
  decider,
  inOrders,
  quick,
  replay,
  runAuto,
  type V2Table,
  v2Table,
} from './helpers-v2.ts';

/*
 * The cutoff and standing results (PROTOCOL-v2 §5.3–§5.5; build plan T11; vector 5 of §12.2, in part), in deckless
 * games: a result attested by every seat but E, with nothing signed off its line by a seat other than E, and alone,
 * stands against a held fork, and the fork only records E; otherwise the fork stops the game, overriding any claim
 * or Resign that does not stand (A2). Each scenario is replayed in several arrival orders, with duplicates, and every
 * session (each seat and a spectator) must reach the same views and duties.
 */

const mv = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });
const prevOf = (ev: NostrEvent): Hex =>
  (ev.tags.find((x) => x[0] === 'e' && x[3] === 'prev') as string[])[1] as Hex;

/** The log hash of the line to `head` over the moves in `events` (PROTOCOL-v2 §4.3). */
function hashTo(t: V2Table, events: readonly NostrEvent[], head: Hex): Hex {
  const prev = new Map(events.filter((e) => e.kind === 7452).map((e) => [e.id, prevOf(e)]));
  const ids: Hex[] = [];
  for (let at = head; at !== t.game.rootId; at = prev.get(at) as Hex) ids.push(at);
  return logHash(ids.reverse());
}

/** An end attestation of `r` by `seat` (its session key, or its npub), its log hash over `events` unless given. */
function endOf(
  t: V2Table,
  seat: number,
  r: ResultId,
  events: readonly NostrEvent[],
  opts: { npub?: boolean; hash?: Hex; at?: number } = {},
): NostrEvent {
  const sk =
    opts.npub === true ? (t.game.npubSks[seat] as Uint8Array) : (t.game.ids[seat] as Identity).sessionSk;
  return finalizeEvent(
    endAttestTemplate(
      {
        rootId: t.game.rootId,
        headId: r.head,
        end: { kind: r.kind, forfeit: r.forfeit, logHash: opts.hash ?? hashTo(t, events, r.head) },
      },
      opts.at ?? NOW,
    ),
    sk,
    t.game.rnd,
  );
}

/** A card Shares event by `seat` anchored on `anchor`: in a deckless game it is held (D066) and counts for (b). */
function sharesOn(t: V2Table, seat: number, anchor: Hex, at = NOW): NostrEvent {
  const id = t.game.ids[seat] as Identity;
  const ct: Ciphertext = { a: G, b: G.multiply(2n) };
  const share = makeShare(id.deckSecret, ct, { rootId: t.game.rootId, deckId: 'x', pos: 0 }, t.game.rnd);
  return finalizeEvent(
    cardSharesTemplate({ rootId: t.game.rootId, anchorId: anchor, shares: [{ pos: 0, share }] }, at),
    id.sessionSk,
    t.game.rnd,
  );
}

/** A Timeout claim by `claimant` naming `head` against `seat`. */
const claimOf = (t: V2Table, claimant: number, head: Hex, seat: number, at = NOW): NostrEvent =>
  finalizeEvent(
    timeoutTemplate({ rootId: t.game.rootId, headId: head, seat }, at, '2'),
    (t.game.ids[claimant] as Identity).sessionSk,
    t.game.rnd,
  );

/** A Resign by `seat` naming `head` (a deckless game: no secret). */
const resignOf = (t: V2Table, seat: number, head: Hex, at = NOW): NostrEvent =>
  finalizeEvent(
    resignTemplate({ rootId: t.game.rootId, headId: head }, at, '2'),
    (t.game.ids[seat] as Identity).sessionSk,
    t.game.rnd,
  );

const over = (head: Hex): ResultId => ({ kind: 'over', head, forfeit: [] });

/** Every session of `t` shows result `r` standing against the fork at `at` signed by `seat`. */
function expectStood(t: V2Table, r: ResultId, at: Hex, seat: number): SessionViewV2 {
  for (const s of t.all) {
    const v = s.view();
    expect(v.result).toEqual(r);
    expect(v).toMatchObject({ stood: true, stop: null, fork: { at, seat } });
    expect(v.equivocators).toContain(seat);
  }
  return t.spectator.view();
}

/** Every session of `t` shows the stop at `at` signed by `seat`, scored (not cancelled), with no result. */
function expectStop(t: V2Table, at: Hex, seat: number): SessionViewV2 {
  for (const s of t.all) {
    const v = s.view();
    expect(v).toMatchObject({
      result: null,
      stood: false,
      stop: { at, seat, cancelled: false },
      phase: 'done',
    });
    expect(v.outcome).toMatchObject({ reason: 'stop' });
    expect(v.outcome?.places[seat]).toBe(t.all.length - 1);
  }
  return t.spectator.view();
}

describe('a standing over result (Chess)', () => {
  // Fool's mate: Black (seat 1) mates at move 4. White, the loser, attests the end; Black then forks at its own old
  // prev (a second move 2 on m1), having attested nothing.
  let t: V2Table;
  let m: NostrEvent[];
  let attest: NostrEvent;
  let rival: NostrEvent;
  let X: ResultId;

  beforeAll(() => {
    t = v2Table(chess as AnyModule, 2, 'cut-over');
    m = (
      [
        [0, 'f2f3'],
        [1, 'e7e5'],
        [0, 'g2g4'],
        [1, 'd8h4'],
      ] as const
    ).map(([k, u]) => act(t, k, mv(k, u)));
    X = over((m[3] as NostrEvent).id);
    expect(t.players[0]?.duties()).toEqual([{ kind: 'end' }]);
    attest = (t.players[0] as GameSessionV2).buildEndAttest(t.game.rnd, NOW);
    rival = actionAt(t, 1, (m[0] as NostrEvent).id, 2, mv(1, 'd7d5'), NOW + 1);
  });

  const P = () => (m[0] as NostrEvent).id;

  it('V2-18 lets an over result stand after a later fork by a seat that attested nothing: the fork only records E', () => {
    const r = inOrders(t, [...m, attest, rival], 'cut-over-stands');
    const v = expectStood(r, X, P(), 1);
    // Scored as without the fork: Black's mate, at its head, with the audit (deckless: at once).
    const declared = chess.outcome(v.state as never);
    expect(v).toMatchObject({ phase: 'done', head: { id: X.head, seq: 4 }, audit: 'pass', forfeits: [] });
    expect(v.outcome).toEqual({ places: [2, 1], reason: declared?.reason, scores: declared?.scores });
    expect(v.equivocators).toEqual([1]);
    expect(v.endAttested).toEqual([0]);
    // While the fork is held nothing new is attested (§5.7): no end or stats attestation duty.
    for (const p of r.players) expect(p.duties()).toEqual([]);
    expect(() => (r.players[1] as GameSessionV2).buildEndAttest(r.game.rnd, NOW)).toThrow(/no end duty/);
    expect(gameRecord(v)).toEqual({
      ending: 'over',
      places: [2, 1],
      rated: [true, true],
      endedBy: null,
      equivocators: [1],
      secretWithheld: [],
      auditIncomplete: false,
    });
    // Without White's attestation the fork stops the game: Black, who mated on its line, is last (V2-15).
    const stopped = expectStop(replay(t, [...m, rival]), P(), 1);
    expect(stopped.outcome?.places).toEqual([1, 2]);
  });

  it('V2-11, V2-18 counts an attestation by the npub, and every one ever held: a later one does not withdraw it', () => {
    const byNpub = endOf(t, 0, X, m, { npub: true });
    // White also attests another (invalid: not over there) result later; the first still counts.
    const other = endOf(t, 0, over((m[2] as NostrEvent).id), m, { at: NOW + 5 });
    const r = inOrders(t, [...m, byNpub, other, rival], 'cut-over-npub');
    expectStood(r, X, P(), 1);
  });

  it('V2-18 blocks it with an event a seat other than E signed on the rival side: a Shares event, a Move, an end attestation', () => {
    const blockers = [
      sharesOn(t, 0, rival.id),
      actionAt(t, 0, rival.id, 3, mv(0, 'e2e4'), NOW + 2),
      endOf(t, 0, over(rival.id), [...m, rival]),
    ];
    for (const [i, b] of blockers.entries()) {
      const r = inOrders(t, [...m, attest, rival, b], `cut-over-block-${i}`, 2);
      expect(expectStop(r, P(), 1).outcome?.places).toEqual([1, 2]);
    }
    // Signed by E, the same kinds of events block nothing.
    const byE = [sharesOn(t, 1, rival.id), endOf(t, 1, over(rival.id), [...m, rival])];
    const r = inOrders(t, [...m, attest, rival, ...byE], 'cut-over-byE', 2);
    expectStood(r, X, P(), 1);
  });

  it('V2-19 lets no event at or past the head block it', () => {
    // White's junk past the end (a move on the mating move), a Shares event anchored on the head and one on the
    // junk, and an end attestation naming the junk: all at or past X's head, so none is off its line.
    const junk = actionAt(t, 0, X.head, 5, mv(0, 'e2e4'), NOW + 3);
    const past = [
      junk,
      sharesOn(t, 0, X.head),
      sharesOn(t, 0, junk.id),
      endOf(t, 0, over(junk.id), [...m, junk]),
    ];
    const r = inOrders(t, [...m, attest, rival, ...past], 'cut-over-past', 3);
    expectStood(r, X, P(), 1);
  });

  it('V2-20 (partial) gives every session the same standing result, or stop, in every arrival order: eight orders with anchors that resolve late', () => {
    // An anchor and a head naming a move past the end that arrives in any order, a blocker on the rival in one set
    // and not the other: the stand or the stop is a function of the held set alone.
    const junk = actionAt(t, 0, X.head, 5, mv(0, 'c2c4'), NOW + 6);
    const named = [sharesOn(t, 0, junk.id), endOf(t, 0, over(junk.id), [...m, junk])];
    expectStood(inOrders(t, [...m, attest, rival, ...named, junk], 'cut-over-orders', 8), X, P(), 1);
    const blocker = sharesOn(t, 0, rival.id);
    expectStop(inOrders(t, [...m, attest, rival, ...named, junk, blocker], 'cut-over-orders-2', 8), P(), 1);
  });

  it('V2-19 counts an unresolved anchor or head as off the line: it blocks until the event it names is held', () => {
    // A move past the head that this client does not hold yet, named by a Shares event and an end attestation.
    const junk = actionAt(t, 0, X.head, 5, mv(0, 'd2d4'), NOW + 4);
    for (const named of [sharesOn(t, 0, junk.id), endOf(t, 0, over(junk.id), [...m, junk])]) {
      const r = inOrders(t, [...m, attest, rival, named], `cut-over-unresolved-${named.kind}`, 2);
      expectStop(r, P(), 1);
      // Once the named move arrives it resolves past the head, and the result stands, in any order.
      const resolved = inOrders(t, [...m, attest, rival, named, junk], `cut-over-resolved-${named.kind}`, 2);
      expectStood(resolved, X, P(), 1);
    }
    // Signed by E, an unresolved anchor blocks nothing.
    const r = inOrders(t, [...m, attest, rival, sharesOn(t, 1, 'ab'.repeat(32))], 'cut-over-unresolved-E', 2);
    expectStood(r, X, P(), 1);
  });
});

describe('two results, claims and Resigns (Chess; proposal §6.7)', () => {
  // White mates at move 5 on the line e4 f6 d4 g5 Qh5#. Black (seat 1) is the adversary throughout.
  const plies = [
    [0, 'e2e4'],
    [1, 'f7f6'],
    [0, 'd2d4'],
    [1, 'g7g5'],
    [0, 'd1h5'],
  ] as const;

  /** The mating line on `prev`'s successor chain, built by hand from move `from` (1-based) on `prev`. */
  function lineFrom(t: V2Table, prev: Hex, from: number, at = NOW): NostrEvent[] {
    const out: NostrEvent[] = [];
    let p = prev;
    for (let i = from - 1; i < plies.length; i++) {
      const [k, u] = plies[i] as (typeof plies)[number];
      const ev = actionAt(t, k, p, i + 1, mv(k, u), at + i);
      out.push(ev);
      p = ev.id;
    }
    return out;
  }

  it('V2-18, V2-21: two devices and a resign, first trace: the resign and the end both stand (rule (c)), so the fork stops the game', () => {
    const t = v2Table(chess as AnyModule, 2, 'cut-resign-1');
    const line = lineFrom(t, t.game.rootId, 1);
    const m1 = line[0] as NostrEvent;
    const end = line[4] as NostrEvent;
    // Black resigns naming m1 (device 0a counts it there and attests); device 0b plays on to the end and attests it.
    const resign = resignOf(t, 1, m1.id);
    const R: ResultId = { kind: 'resign', head: m1.id, forfeit: [1] };
    const rival = actionAt(t, 1, m1.id, 2, mv(1, 'e7e5'), NOW + 9);
    const att = [endOf(t, 0, R, line), endOf(t, 0, over(end.id), line)];
    const r = inOrders(t, [...line, resign, rival, ...att], 'cut-resign-1');
    expect(expectStop(r, m1.id, 1).outcome?.places).toEqual([1, 2]);
    expect(gameRecord(r.spectator.view())).toMatchObject({ ending: 'stop', rated: [true, true], endedBy: 1 });
    // Each alone stands: the resign scored at its S (the fork right past m1 stops S there), the end as the mate.
    const resignOnly = inOrders(t, [...line, resign, rival, att[0] as NostrEvent], 'cut-resign-1a', 2);
    const v = expectStood(resignOnly, R, m1.id, 1);
    expect(v).toMatchObject({ head: { id: m1.id }, resigned: [1], resignId: resign.id, forfeits: [1] });
    expect(v.outcome).toMatchObject({ places: [1, 2], reason: 'resign' });
    expect(v.outcome?.unrated).toBeUndefined();
    expect(v.audit).toEqual({ fail: [1], reason: 'resign' });
    expect(gameRecord(v)).toMatchObject({ ending: 'resign', places: [1, 2], rated: [true, true] });
    const endOnly = inOrders(t, [...line, resign, rival, att[1] as NostrEvent], 'cut-resign-1b', 2);
    expect(expectStood(endOnly, over(end.id), m1.id, 1).outcome?.places).toEqual([1, 2]);
  });

  it('V2-18, V2-21: two devices and a resign, second trace: attestations on two sides of the fork, neither stands (rule (b))', () => {
    const t = v2Table(chess as AnyModule, 2, 'cut-resign-2');
    const m1 = actionAt(t, 0, t.game.rootId, 1, mv(0, 'e2e4'));
    // Side A: Black's a6, and its Resign naming it, which device 0b counts and attests.
    const a2 = actionAt(t, 1, m1.id, 2, mv(1, 'a7a6'), NOW + 1);
    const resign = resignOf(t, 1, a2.id);
    const R: ResultId = { kind: 'resign', head: a2.id, forfeit: [1] };
    // Side B: f6, and device 0a plays it to the mate and attests.
    const sideB = lineFrom(t, m1.id, 2, NOW + 2);
    const end = sideB[sideB.length - 1] as NostrEvent;
    const all = [m1, a2, ...sideB];
    const att = [endOf(t, 0, R, all), endOf(t, 0, over(end.id), all)];
    const r = inOrders(t, [m1, a2, resign, ...sideB, ...att], 'cut-resign-2');
    expect(expectStop(r, m1.id, 1).outcome?.places).toEqual([1, 2]);
    // The Resign alone does not stand either: device 0a's moves on side B are off its line.
    const alone = inOrders(t, [m1, a2, resign, ...sideB, att[0] as NostrEvent], 'cut-resign-2a', 2);
    expectStop(alone, m1.id, 1);
  });

  it('V2-18, V2-21: two devices and a claim: the claim and the end lie on one line, both stand (rule (c)), so the fork stops', () => {
    const t = v2Table(chess as AnyModule, 2, 'cut-claim-devices');
    const m1 = actionAt(t, 0, t.game.rootId, 1, mv(0, 'e2e4'));
    // Device 0b claims Black's timeout at m1 and attests it; Black signs two moves 2; device 0a, which never saw
    // the claim, plays on one of them to the mate and attests.
    const claim = claimOf(t, 0, m1.id, 1);
    const C: ResultId = { kind: 'claim', head: m1.id, forfeit: [1] };
    const a2 = actionAt(t, 1, m1.id, 2, mv(1, 'a7a6'), NOW + 1);
    const sideB = lineFrom(t, m1.id, 2, NOW + 2);
    const end = sideB[sideB.length - 1] as NostrEvent;
    const all = [m1, a2, ...sideB];
    const att = [endOf(t, 0, C, all), endOf(t, 0, over(end.id), all)];
    const r = inOrders(t, [m1, claim, a2, ...sideB, ...att], 'cut-claim-devices');
    expect(expectStop(r, m1.id, 1).outcome?.places).toEqual([1, 2]);
  });

  it('V2-17 (partial): a claim that stands (valid with no clock or stall check): E timed out cannot void its forfeit by forking at the claimed head', () => {
    const t = v2Table(chess as AnyModule, 2, 'cut-claim-stands');
    const m1 = actionAt(t, 0, t.game.rootId, 1, mv(0, 'e2e4'));
    const claim = claimOf(t, 0, m1.id, 1);
    const C: ResultId = { kind: 'claim', head: m1.id, forfeit: [1] };
    const rivals = ['a7a6', 'h7h6'].map((u, i) => actionAt(t, 1, m1.id, 2, mv(1, u), NOW + 1 + i));
    const att = endOf(t, 0, C, [m1]);
    const r = inOrders(t, [m1, claim, ...rivals, att], 'cut-claim-stands');
    const v = expectStood(r, C, m1.id, 1);
    const scores = chess.standings(v.state as never);
    expect(v).toMatchObject({ phase: 'done', head: { id: m1.id }, forfeits: [1] });
    expect(v.outcome).toEqual({ places: [1, 2], reason: 'forfeit', scores: [...scores] });
    expect(v.audit).toEqual({ fail: [1], reason: 'timeout' });
    expect(gameRecord(v)).toMatchObject({
      ending: 'claim',
      places: [1, 2],
      rated: [true, true],
      equivocators: [1],
    });
    // A2: with no attestation the claim does not stand, and the stop overrides it.
    expectStop(inOrders(t, [m1, claim, ...rivals], 'cut-claim-unattested', 2), m1.id, 1);
    // An attestation whose result cannot be valid (a claim at the root, before any game action) counts for nothing.
    const early = claimOf(t, 0, t.game.rootId, 1);
    const atRoot = endOf(t, 0, { kind: 'claim', head: t.game.rootId, forfeit: [1] }, [m1]);
    expectStop(inOrders(t, [m1, early, ...rivals, atRoot], 'cut-claim-root', 2), m1.id, 1);
  });

  it('V2-56 (partial): an end attestation naming a non-seat counts for no result, but is held and counts for (b) by its head (T8 review)', () => {
    const t = v2Table(chess as AnyModule, 2, 'cut-nonseat');
    const m1 = actionAt(t, 0, t.game.rootId, 1, mv(0, 'e2e4'));
    const claim = claimOf(t, 0, m1.id, 1);
    const rivals = ['a7a6', 'h7h6'].map((u, i) => actionAt(t, 1, m1.id, 2, mv(1, u), NOW + 1 + i));
    const nonSeat = endOf(t, 0, { kind: 'claim', head: m1.id, forfeit: [1, 5] }, [m1]);
    // Rejected for counting, and no result: the forfeit list names seat 5.
    const r = inOrders(t, [m1, claim, ...rivals, nonSeat], 'cut-nonseat', 2);
    expect(r.spectator.receive(nonSeat, NOW)).toEqual({ status: 'rejected', reason: 'there is no seat 5' });
    expectStop(r, m1.id, 1);
    expect(r.spectator.heldSet().map((x) => x.id)).toContain(nonSeat.id);
    // With the valid attestation the claim stands; a non-seat attestation naming the rival still blocks it.
    const good = endOf(t, 0, { kind: 'claim', head: m1.id, forfeit: [1] }, [m1]);
    const r2 = inOrders(t, [m1, claim, ...rivals, nonSeat, good], 'cut-nonseat-good', 2);
    expect(expectStood(r2, { kind: 'claim', head: m1.id, forfeit: [1] }, m1.id, 1).endAttested).toEqual([0]);
    // Every held move descends from m1, so an off-line head here is one nobody holds (unresolved).
    const offSide = endOf(t, 0, { kind: 'claim', head: 'cd'.repeat(32), forfeit: [1, 7] }, [m1], {
      hash: '0'.repeat(64),
    });
    expectStop(inOrders(t, [m1, claim, ...rivals, good, offSide], 'cut-nonseat-off', 2), m1.id, 1);
  });
});

describe('claims and Resigns with 3 seats (Bank 0.2.0)', () => {
  let t: V2Table;
  const decisions: { seat: number; prev: Hex; seq: number; legal: unknown[]; action: unknown }[] = [];

  beforeAll(() => {
    t = v2Table(bank as AnyModule, 3, 'cut-bank');
    const rng = createRng('cut-bank');
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

  /** The last decision where another legal action was open, with one (`alt`). */
  const lastChoice = () => {
    const all = decisions
      .map((d) => ({ ...d, alt: d.legal.find((a) => canonicalJson(a) !== canonicalJson(d.action)) }))
      .filter((d) => d.alt !== undefined);
    return all[all.length - 1] as (typeof all)[number];
  };

  it('V2-21 (A2): a claim attested by one seat only does not stand: the fork overrides it; attested by both, it stands', () => {
    const d = lastChoice();
    const [j, l] = [0, 1, 2].filter((x) => x !== d.seat) as [number, number];
    // Seat j claims d.seat's timeout at the head where d.seat was to decide, and attests it; d.seat then forks there.
    const claim = claimOf(t, j, d.prev, d.seat);
    const C: ResultId = { kind: 'claim', head: d.prev, forfeit: [d.seat] };
    const rival = actionAt(t, d.seat, d.prev, d.seq, d.alt, NOW + 1);
    const byJ = endOf(t, j, C, t.log);
    const r = inOrders(t, [...t.log, claim, rival, byJ], 'cut-bank-a2', 2);
    expectStop(r, d.prev, d.seat);
    expect(gameRecord(r.spectator.view())).toMatchObject({
      ending: 'stop',
      rated: [0, 1, 2].map((k) => k === d.seat),
    });
    // Seat l attests it too: the claim stands; d.seat forfeits, last, the others by standings at the head; rated.
    const byL = endOf(t, l, C, t.log);
    const r2 = inOrders(t, [...t.log, claim, rival, byJ, byL], 'cut-bank-claim', 2);
    const v = expectStood(r2, C, d.prev, d.seat);
    const scores = bank.standings(v.state as BankState);
    expect(v.head.id).toBe(d.prev);
    expect(v.outcome).toMatchObject({ reason: 'forfeit', scores: [...scores] });
    expect(v.outcome?.places[d.seat]).toBe(3);
    expect(gameRecord(v)).toMatchObject({
      ending: 'claim',
      rated: [true, true, true],
      equivocators: [d.seat],
    });
  });

  it('V2-17 (partial): a Resign that stands with 3 seats, its identity at the named head: the resigner strictly last at S, unrated, endedBy', () => {
    const d = lastChoice();
    const [j, l] = [0, 1, 2].filter((x) => x !== d.seat) as [number, number];
    // d.seat resigns naming the head where it was to decide, then forks there: its own forfeit, so (a) needs only
    // the other two seats.
    const resign = resignOf(t, d.seat, d.prev);
    const R: ResultId = { kind: 'resign', head: d.prev, forfeit: [d.seat] };
    const rival = actionAt(t, d.seat, d.prev, d.seq, d.alt, NOW + 1);
    const att = [endOf(t, j, R, t.log), endOf(t, l, R, t.log)];
    const r = inOrders(t, [...t.log, resign, rival, ...att], 'cut-bank-resign', 2);
    const v = expectStood(r, R, d.prev, d.seat);
    // S: the fork right past the named head stops S there.
    expect(v.head.id).toBe(d.prev);
    const scores = bank.standings(v.state as BankState);
    expect(v.outcome).toMatchObject({
      reason: 'resign',
      scores: [...scores],
      unrated: true,
      endedBy: { type: 'resign', seat: d.seat },
    });
    expect(v.outcome?.places[d.seat]).toBe(3);
    expect(v).toMatchObject({
      resigned: [d.seat],
      resignId: resign.id,
      audit: { fail: [d.seat], reason: 'resign' },
    });
    expect(gameRecord(v)).toMatchObject({ ending: 'resign', rated: [false, false, false], endedBy: d.seat });
    // Attested by one seat only, the fork overrides it (A2).
    expectStop(
      inOrders(t, [...t.log, resign, rival, att[0] as NostrEvent], 'cut-bank-resign-1', 2),
      d.prev,
      d.seat,
    );
  });
});
