import { chainReaction } from '@bored-games/chain-reaction';
import { chess } from '@bored-games/chess';
import { canonicalJson, createRng } from '@bored-games/game-kit';
import {
  endAttestTemplate,
  finalizeEvent,
  type Hex,
  logHash,
  type NostrEvent,
  resignTemplate,
  secretTemplate,
  timeoutTemplate,
} from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import type { Identity, ResultId } from '../../src/types.ts';
import { MAX_CLAIMS, MAX_RESIGNS, MAX_UNKNOWN_CLAIMS } from '../../src/v2/store.ts';
import { LATE, NOW, ROOT_SEEN } from '../helpers.ts';
import {
  type AnyModule,
  actionAt,
  decider,
  quick,
  replay,
  runAuto,
  send,
  shuffleAll,
  type V2Table,
  v2Session,
  v2Table,
} from './helpers-v2.ts';

/*
 * The claim and Resign caps keep the same set in every arrival order (D069; review of T11, H1, M1, L1 and L2). A cap
 * on claims or Resigns waiting for a head this client does not hold never refuses one for good: what it lets go is
 * judged again when delivered after its head is held (the §9.1 rebroadcast). A claim or Resign on a held head is
 * kept by a rule that does not depend on order (the per-head claim cap keeps the lowest ids; Resigns are never
 * capped there), and one that waited is kept when its head arrives. The End phase of a standing result is keyed by
 * the result's identity, and it first stands no earlier than any event received before it.
 */

const mv = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });
const prevOf = (ev: NostrEvent): Hex =>
  (ev.tags.find((x) => x[0] === 'e' && x[3] === 'prev') as string[])[1] as Hex;

function hashTo(t: V2Table, events: readonly NostrEvent[], head: Hex): Hex {
  const prev = new Map(events.filter((e) => e.kind === 7452).map((e) => [e.id, prevOf(e)]));
  const ids: Hex[] = [];
  for (let at = head; at !== t.game.rootId; at = prev.get(at) as Hex) ids.push(at);
  return logHash(ids.reverse());
}

const sk = (t: V2Table, seat: number): Uint8Array => (t.game.ids[seat] as Identity).sessionSk;

const endOf = (t: V2Table, seat: number, r: ResultId, events: readonly NostrEvent[]): NostrEvent =>
  finalizeEvent(
    endAttestTemplate(
      {
        rootId: t.game.rootId,
        headId: r.head,
        end: { kind: r.kind, forfeit: r.forfeit, logHash: hashTo(t, events, r.head) },
      },
      NOW,
    ),
    sk(t, seat),
    t.game.rnd,
  );

const claimOf = (t: V2Table, by: number, head: Hex, seat: number, at = NOW): NostrEvent =>
  finalizeEvent(
    timeoutTemplate({ rootId: t.game.rootId, headId: head, seat }, at, '2'),
    sk(t, by),
    t.game.rnd,
  );

const resignOf = (t: V2Table, seat: number, head: Hex, at = NOW): NostrEvent =>
  finalizeEvent(resignTemplate({ rootId: t.game.rootId, headId: head }, at, '2'), sk(t, seat), t.game.rnd);

const randomHex = (rng: ReturnType<typeof createRng>): Hex =>
  Array.from({ length: 64 }, () => '0123456789abcdef'[rng.int(16)]).join('') as Hex;

/** `n` events from `make(at)`, for `at` counting up from `from`, whose ids `keep` accepts. */
function grind(
  n: number,
  from: number,
  make: (at: number) => NostrEvent,
  keep: (id: Hex) => boolean,
): NostrEvent[] {
  const out: NostrEvent[] = [];
  for (let at = from; out.length < n; at++) {
    const ev = make(at);
    if (keep(ev.id as Hex)) out.push(ev);
  }
  return out;
}

function play(t: V2Table, moves: [number, string][]): NostrEvent[] {
  return moves.map(([k, u]) => {
    const ev = (t.players[k] as NonNullable<V2Table['players'][number]>).buildAction(
      mv(k, u),
      t.game.rnd,
      NOW,
    );
    send(t, ev);
    return ev;
  });
}

/** A fresh spectator fed `order` (each at `NOW`, then the whole order again when `again`): its view and waits. */
function seenBy(t: V2Table, order: readonly NostrEvent[], again = false): string {
  const s = v2Session(t.game, null);
  for (const ev of order) s.receive(ev, NOW);
  if (again) for (const ev of order) s.receive(ev, NOW);
  return canonicalJson({ view: s.view(), waiting: s.waitingFor() });
}

/** Every order of `units` (each a group of events kept together), in lexicographic order of unit indices. */
function permutations<T>(units: readonly T[]): T[][] {
  if (units.length <= 1) return [[...units]];
  return units.flatMap((u, i) =>
    permutations([...units.slice(0, i), ...units.slice(i + 1)]).map((rest) => [u, ...rest]),
  );
}

/** `n` random orders of `log` (a seeded shuffle), each with three duplicates spliced in. */
function shuffles(log: readonly NostrEvent[], seed: string, n: number): NostrEvent[][] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => {
    const order = [...log];
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j] as NostrEvent, order[i] as NostrEvent];
    }
    for (let d = 0; d < 3; d++)
      order.splice(rng.int(order.length + 1), 0, log[rng.int(log.length)] as NostrEvent);
    return order;
  });
}

describe('H1: the claim cap keeps an order-independent set (Chess)', { timeout: 120_000 }, () => {
  // Seat 0 (E) claims a timeout against seat 1 at m3; seat 1 attests the claim result (it accepted its own timeout,
  // §7.1); E also signs claims naming ids nobody holds, and a rival at the root. The claim result stands.
  const setup = (seed: string) => {
    const t = v2Table(chess as AnyModule, 2, seed);
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
    ]);
    const X: ResultId = { kind: 'claim', head: m[2]?.id as Hex, forfeit: [1] };
    const att = endOf(t, 1, X, m);
    const rival = actionAt(t, 0, t.game.rootId, 1, mv(0, 'd2d4'), NOW + 20);
    return { t, m, X, att, rival };
  };

  it("V2-20: the review's trace: a claim result stands in every arrival order, whatever unknown-head claims its claimant sent first", () => {
    const { t, m, X, att, rival } = setup('rev-h1');
    const real = claimOf(t, 0, X.head, 1, NOW + 1);
    const rng = createRng('rev-h1');
    const junk = Array.from({ length: 8 }, (_, i) => claimOf(t, 0, randomHex(rng), 1, NOW + 2 + i));
    const a = replay(t, [...junk, real, ...m, att, rival]).spectator.view();
    const b = replay(t, [...m, real, ...junk, att, rival]).spectator.view();
    expect(b).toMatchObject({ stood: true, result: X });
    expect(a.result).toEqual(b.result);
    expect(a.outcome).toEqual(b.outcome);
  });

  it('V2-20: junk claims above the real one: every order of claims, moves, attestation and rival gives the same views, claims before moves included', () => {
    const { t, m, X, att, rival } = setup('caps-h1-above');
    // The real claim has a low id, every junk claim a higher one: the waiting cap never lets the real one go.
    const [real] = grind(
      1,
      NOW + 1,
      (at) => claimOf(t, 0, X.head, 1, at),
      (id) => id < '4',
    );
    const rng = createRng('caps-h1-above');
    const junk = grind(
      MAX_UNKNOWN_CLAIMS,
      NOW + 100,
      (at) => claimOf(t, 0, randomHex(rng), 1, at),
      (id) => id > (real as NostrEvent).id,
    );
    const want = seenBy(t, [...m, real as NostrEvent, att, rival]);
    expect(JSON.parse(want).view).toMatchObject({ stood: true, result: X, outcome: { reason: 'forfeit' } });
    // Every order of five units: the junk block, the real claim, moves 1–2, move 3 (the claimed head), and the
    // attestation with the rival.
    const units: NostrEvent[][] = [
      junk,
      [real as NostrEvent],
      [m[0] as NostrEvent, m[1] as NostrEvent],
      [m[2] as NostrEvent],
      [att, rival],
    ];
    let n = 0;
    for (const order of permutations(units)) {
      expect(seenBy(t, order.flat()), `units ${n}`).toBe(want);
      n++;
    }
    expect(n).toBe(120);
    // And event-level interleavings, the junk claims spread out, with duplicates.
    for (const [i, order] of shuffles(
      [...junk, real as NostrEvent, ...m, att, rival],
      'caps-h1-above',
      40,
    ).entries())
      expect(seenBy(t, order), `shuffle ${i}`).toBe(want);
  });

  it('V2-20: junk claims below the real one: a claim the waiting cap lets go is not refused for good, and after a rebroadcast every order agrees', () => {
    const { t, m, X, att, rival } = setup('caps-h1-below');
    const [real] = grind(
      1,
      NOW + 1,
      (at) => claimOf(t, 0, X.head, 1, at),
      (id) => id > 'c',
    );
    const rng = createRng('caps-h1-below');
    const junk = grind(
      MAX_UNKNOWN_CLAIMS,
      NOW + 100,
      (at) => claimOf(t, 0, randomHex(rng), 1, at),
      (id) => id < (real as NostrEvent).id,
    );
    const all = [...junk, real as NostrEvent, ...m, att, rival];
    const want = seenBy(t, [...m, real as NostrEvent, att, rival]);
    expect(JSON.parse(want).view).toMatchObject({ stood: true, result: X });

    // Claims before moves: the real claim waits behind eight lower ids, so the cap lets it go, with no record.
    const s = v2Session(t.game, null);
    for (const ev of junk) expect(s.receive(ev, NOW).status).toBe('stored');
    expect(s.receive(real, NOW)).toEqual({
      status: 'rejected',
      reason: 'claim limit: too many waiting for their head',
    });
    for (const ev of [...m, att, rival]) s.receive(ev, NOW);
    expect(s.view()).toMatchObject({ stood: false, stop: { seat: 0 } });
    // Delivered again (the §9.1 rebroadcast) once its head is held, it is kept, and the claim result stands.
    expect(s.receive(real, NOW).status).toBe('stored');
    expect(canonicalJson({ view: s.view(), waiting: s.waitingFor() })).toBe(want);

    // A waiting claim evicted by a lower id is not refused for good either.
    const s2 = v2Session(t.game, null);
    s2.receive(real, NOW);
    for (const ev of junk) s2.receive(ev, NOW);
    for (const ev of [...m, att, rival]) s2.receive(ev, NOW);
    expect(s2.view().stood).toBe(false);
    expect(s2.receive(real, NOW).status).toBe('stored');
    expect(s2.view()).toMatchObject({ stood: true, result: X });

    // Every order of the five units, then the whole order delivered again: the same views.
    const units: NostrEvent[][] = [
      junk,
      [real as NostrEvent],
      [m[0] as NostrEvent, m[1] as NostrEvent],
      [m[2] as NostrEvent],
      [att, rival],
    ];
    for (const [i, order] of permutations(units).entries())
      expect(seenBy(t, order.flat(), true), `units ${i}`).toBe(want);
    for (const [i, order] of shuffles(all, 'caps-h1-below', 40).entries())
      expect(seenBy(t, order, true), `shuffle ${i}`).toBe(want);
  });

  it('a claim on a held head beyond the per-head cap is refused for good: the lowest ids are kept in every order', () => {
    const { t, m, X, att, rival } = setup('caps-h1-head');
    const extra = Array.from({ length: MAX_CLAIMS + 2 }, (_, i) => claimOf(t, 0, X.head, 1, NOW + 1 + i));
    const sorted = [...extra].sort((a, b) => (a.id < b.id ? -1 : 1));
    const highest = sorted[sorted.length - 1] as NostrEvent;
    const want = seenBy(t, [...m, ...extra, att, rival]);
    expect(JSON.parse(want).view).toMatchObject({ stood: true, result: X });
    for (const [i, order] of shuffles([...m, ...extra, att, rival], 'caps-h1-head', 40).entries())
      expect(seenBy(t, order), `shuffle ${i}`).toBe(want);
    // Head held first: the highest id is refused (or evicted) for good.
    const s = v2Session(t.game, null);
    for (const ev of [...m, ...extra]) s.receive(ev, NOW);
    expect(s.receive(highest, NOW)).toEqual({ status: 'rejected', reason: 'claim limit' });
  });
});

describe('M1: a Resign on a held head is never evicted (Chess)', () => {
  const setup = (seed: string) => {
    const t = v2Table(chess as AnyModule, 2, seed);
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
      [1, 'b8c6'],
    ]);
    const X: ResultId = { kind: 'resign', head: m[3]?.id as Hex, forfeit: [1] };
    const rs = resignOf(t, 1, X.head, NOW + 1);
    const att = endOf(t, 0, X, m);
    const rival = actionAt(t, 1, m[0]?.id as Hex, 2, mv(1, 'd7d5'), NOW + 20);
    return { t, m, X, rs, att, rival };
  };

  it("the review's trace: a standing resign keeps standing when its resigner later floods Resigns with lower ids", () => {
    const { t, m, X, rs, att, rival } = setup('rev-m1');
    const low = grind(
      MAX_RESIGNS,
      NOW + 100,
      (at) => resignOf(t, 1, t.game.rootId, at),
      (id) => id < rs.id,
    );
    const r = replay(t, [...m, rs, att, rival]);
    expect(r.spectator.view()).toMatchObject({ stood: true, result: X });
    for (const ev of low) r.spectator.receive(ev, NOW + 50);
    expect(r.spectator.view()).toMatchObject({ stood: true, result: X });
    // Lower ids naming heads nobody holds wait, and never evict a Resign on a held head either.
    const rng = createRng('rev-m1');
    const waiting = grind(
      MAX_RESIGNS + 2,
      NOW + 1000,
      (at) => resignOf(t, 1, randomHex(rng), at),
      (id) => id < rs.id,
    );
    for (const ev of waiting) r.spectator.receive(ev, NOW + 60);
    expect(r.spectator.view()).toMatchObject({ stood: true, result: X });
    expect(r.spectator.receive(rs, NOW + 70).status).toBe('duplicate');
  });

  it('a waiting Resign is kept when its head arrives, and is then never evicted; one the waiting cap let go counts when delivered again', () => {
    const { t, m, X, rs, att, rival } = setup('caps-m1-wait');
    const rng = createRng('caps-m1-wait');
    const unknown = (n: number, from: number, keep: (id: Hex) => boolean) =>
      grind(n, from, (at) => resignOf(t, 1, randomHex(rng), at), keep);
    const want = seenBy(t, [...m, rs, att, rival]);
    expect(JSON.parse(want).view).toMatchObject({ stood: true, result: X });

    // The Resign before its head, then its head, then more waiting Resigns with lower ids: it stays.
    const s = v2Session(t.game, null);
    expect(s.receive(rs, NOW).status).toBe('stored');
    for (const ev of [...m, att, rival]) s.receive(ev, NOW);
    expect(s.view()).toMatchObject({ stood: true, result: X });
    for (const ev of unknown(MAX_RESIGNS + 2, NOW + 100, (id) => id < rs.id)) s.receive(ev, NOW);
    expect(canonicalJson({ view: s.view(), waiting: s.waitingFor() })).toBe(want);

    // Eight lower-id waiting Resigns first: the real one is let go while its head is unknown, with no record ...
    const s2 = v2Session(t.game, null);
    const flood = unknown(MAX_RESIGNS, NOW + 1000, (id) => id < rs.id);
    for (const ev of flood) expect(s2.receive(ev, NOW).status).toBe('stored');
    expect(s2.receive(rs, NOW)).toEqual({
      status: 'rejected',
      reason: 'resign limit: too many waiting for their head',
    });
    for (const ev of [...m, att, rival]) s2.receive(ev, NOW);
    expect(s2.view().stood).toBe(false);
    // ... and kept when delivered again once its head is held.
    expect(s2.receive(rs, NOW).status).toBe('stored');
    expect(s2.view()).toMatchObject({ stood: true, result: X });

    // Every order of the units, delivered twice (a rebroadcast): the same views.
    const units: NostrEvent[][] = [
      flood,
      [rs],
      [m[3] as NostrEvent],
      [att, rival],
      [m[0] as NostrEvent, m[1] as NostrEvent, m[2] as NostrEvent],
    ];
    for (const [i, order] of permutations(units).entries())
      expect(seenBy(t, order.flat(), true), `units ${i}`).toBe(want);
  });
});

describe('L1, L2: when a standing result first stood (Chess)', () => {
  it("L1: E's free fork between H and S moves a standing resign's S, but not when it first stood (the End phase is keyed by the result)", () => {
    const t = v2Table(chess as AnyModule, 2, 'caps-l1');
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
      [1, 'b8c6'],
      [0, 'f1c4'],
      [1, 'g8f6'],
    ]);
    const X: ResultId = { kind: 'resign', head: m[1]?.id as Hex, forfeit: [1] };
    const rs = resignOf(t, 1, X.head);
    // Seat 1 attests its own resign; E (seat 0) forks at m6, then again at m4, where it was pending.
    const att = endOf(t, 1, X, m);
    const r1 = actionAt(t, 0, m[5]?.id as Hex, 7, mv(0, 'd2d3'));
    const r2 = actionAt(t, 0, m[5]?.id as Hex, 7, mv(0, 'b1c3'));
    const r3 = actionAt(t, 0, m[3]?.id as Hex, 5, mv(0, 'd2d4'));
    const s = v2Session(t.game, null);
    for (const ev of [...m, rs, att, r1, r2]) s.receive(ev, ROOT_SEEN + 10);
    const before = s.view();
    expect(before).toMatchObject({ stood: true, result: X, pendingSince: ROOT_SEEN + 10 });
    expect(before.head.id).toBe(m[5]?.id);
    s.receive(r3, ROOT_SEEN + 5000);
    const after = s.view();
    expect(after).toMatchObject({ stood: true, result: X, pendingSince: ROOT_SEEN + 10, equivocators: [0] });
    // S moved back to m4 (the first held fork past H).
    expect(after.head.id).toBe(m[3]?.id);
  });

  it('L2: a refeed with saved first-seen times in another order never moves the standing deadline earlier (D068)', () => {
    const t = v2Table(chess as AnyModule, 2, 'rev-l2');
    const m = play(t, [
      [0, 'f2f3'],
      [1, 'e7e5'],
      [0, 'g2g4'],
      [1, 'd8h4'],
    ]);
    const att = endOf(t, 0, { kind: 'over', head: m[3]?.id as Hex, forfeit: [] }, m);
    const rival = actionAt(t, 1, m[0]?.id as Hex, 2, mv(1, 'd7d5'), NOW + 1);
    const seen = new Map<string, number>([
      ...m.map((e, i) => [e.id, ROOT_SEEN + 1 + i] as [string, number]),
      [rival.id, ROOT_SEEN + 5],
      [att.id, ROOT_SEEN + 1000],
    ]);
    const feed = (order: NostrEvent[]) => {
      const s = v2Session(t.game, null);
      for (const ev of order) s.receive(ev, seen.get(ev.id) as number);
      expect(s.view().stood).toBe(true);
      return s.view().pendingSince;
    };
    const arrival = feed([...m, rival, att]);
    expect(arrival).toBe(ROOT_SEEN + 1000);
    // Both refeed orders: the attestation first, and the rival last.
    expect(feed([att, ...m, rival])).toBeGreaterThanOrEqual(arrival);
    expect(feed([att, rival, ...m])).toBeGreaterThanOrEqual(arrival);
    expect(feed([...m, att, rival])).toBeGreaterThanOrEqual(arrival);
  });
});

describe('L1: an accepted End-phase claim stays final when S moves (Chain Reaction, 3 seats)', () => {
  it("k resigns, E forks after k's next turn and withholds its secret; W's claim at S is final when E's second fork moves S, and counts where S moved first", () => {
    const t = v2Table(chainReaction as AnyModule, 3, 'caps-l1-cr');
    shuffleAll(t);
    runAuto(t, ['deal', 'release']);
    const rng = createRng('caps-l1-cr');
    // Play turns by the quick policy, each decision recorded with a rival: another legal action, built, not sent.
    const played: { seat: number; ev: NostrEvent; rival: NostrEvent | null }[] = [];
    const turns = (): number => played.filter((x, i) => i === 0 || x.seat !== played[i - 1]?.seat).length;
    let rival1: NostrEvent | null = null;
    for (let guard = 0; guard < 60; guard++) {
      const seat = decider(t) as number;
      const s = t.players[seat] as NonNullable<V2Table['players'][number]>;
      const legal = s.legalActions();
      const chosen = quick(legal, seat, rng);
      const other = legal.find((a) => canonicalJson(a) !== canonicalJson(chosen));
      const rival = other === undefined ? null : s.buildAction(other, t.game.rnd, NOW + 1);
      const starts = played.length > 0 && played[played.length - 1]?.seat !== seat;
      if (starts && turns() === 4) {
        // The fifth turn (E's second): its first move is sent, its rival is fork 1.
        rival1 = rival;
        send(t, s.buildAction(chosen, t.game.rnd, NOW));
        break;
      }
      played.push({ seat, ev: s.buildAction(chosen, t.game.rnd, NOW), rival });
      send(t, played[played.length - 1]?.ev as NostrEvent);
      runAuto(t, ['release']);
    }
    const turnOf = (n: number) =>
      played.filter(
        (_, i) =>
          played.slice(0, i + 1).filter((x, j) => j === 0 || x.seat !== played[j - 1]?.seat).length === n,
      );
    const [t1, t2, , t4] = [turnOf(1), turnOf(2), turnOf(3), turnOf(4)];
    const k = t1[0]?.seat as number;
    const E = t2[0]?.seat as number;
    const W = 3 - k - E;
    expect(t4[0]?.seat).toBe(k);
    expect(t2.length).toBeGreaterThanOrEqual(2);
    expect(rival1).not.toBeNull();
    // k resigns at H, its last move of turn 1 (it played on in turn 4: "resign, then move"); k and W attest it.
    const H = t1[t1.length - 1]?.ev.id as Hex;
    const X: ResultId = { kind: 'resign', head: H, forfeit: [k] };
    const kid = t.game.ids[k] as Identity;
    const wid = t.game.ids[W] as Identity;
    const resign = finalizeEvent(
      resignTemplate({ rootId: t.game.rootId, headId: H, secret: kid.deckSecret }, NOW, '2'),
      kid.sessionSk,
      t.game.rnd,
    );
    const wSecret = finalizeEvent(
      secretTemplate({ rootId: t.game.rootId, deckSecret: wid.deckSecret }, NOW, '2'),
      wid.sessionSk,
      t.game.rnd,
    );
    const atts = [endOf(t, k, X, t.log), endOf(t, W, X, t.log)];
    // S stops at fork 1: just after k's turn 4. Fork 2, a rival at one of E's decisions in turn 2, moves S back there.
    const S1 = t4[t4.length - 1]?.ev.id as Hex;
    // (E's last decision of turn 2 that had another legal action.)
    const last2 = [...t2].reverse().find((x) => x.rival !== null) as (typeof played)[number];
    const rival2 = last2.rival as NostrEvent;
    const S2 = prevOf(last2.ev);
    // W claims at S1 against E, whose secret is missing.
    const claim = claimOf(t, W, S1, E);
    const log = [...t.log, resign, ...atts, rival1 as NostrEvent, wSecret, claim];
    const withheld = {
      phase: 'done',
      forfeits: [E, k].sort(),
      audit: { fail: [E, k].sort(), reason: 'resign; withheld secret' },
    };

    // A: the claim is accepted at S1 after the deadline; then fork 2 moves S to S2, and the claim stays final.
    const a = replay(t, log).spectator;
    expect(a.view()).toMatchObject({ stood: true, result: X, phase: 'end', head: { id: S1 } });
    a.tick(LATE);
    expect(a.view()).toMatchObject({ ...withheld, head: { id: S1 } });
    const since = a.view().pendingSince;
    a.receive(rival2, LATE + 1);
    expect(a.view()).toMatchObject({
      ...withheld,
      stood: true,
      result: X,
      head: { id: S2 },
      pendingSince: since,
    });

    // B: fork 2 arrives first, so S is S2 when the deadline passes: the claim at S1 (past H) still counts.
    const b = replay(t, [...log, rival2]).spectator;
    expect(b.view()).toMatchObject({ stood: true, result: X, phase: 'end', head: { id: S2 } });
    b.tick(LATE);
    expect(b.view()).toMatchObject({ ...withheld, head: { id: S2 } });
  }, 300_000);
});
