import { createRng, type Rng } from '@bored-games/game-kit';
import { type NostrEvent, parseShares } from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameSession } from '../src/session.ts';
import { deliver, LATE, makeGame, NOW, newSession, T0, trust } from './helpers.ts';

/*
 * Review finding F7 (D056): the last shuffler signs two rival final steps A and B, and gets seat 0 to deal on A and
 * seat 1 on B (or one seat on both). Knowing both decks' re-encryption factors, it can translate the honest shares
 * between the decks and read honest hands (`packages/deck/test/fork-translation.test.ts`). The fix:
 * - a seat deals at most once per game: one that dealt on a rival deck owes no deal on the canonical one;
 * - while dealing, a held shuffle fork stalls the shuffle equivocator, never a seat that dealt on a rival deck, so
 *   the game is cancelled with the equivocator forfeiting, before its first action.
 * The game goes on only on a deck every seat dealt on, so no honest share ever sits on a rival deck in a live game.
 */

const SEATS = 3;
const E = 2;
const game = makeGame(SEATS, 'client-shuffle-fork-deal');

/** A fresh session for `seat` (null: a spectator) that trusts the shuffle steps' proofs (they verify). */
function fresh(seat: number | null, steps: readonly NostrEvent[]): GameSession {
  const s = newSession(game, seat);
  trust([s], steps);
  return s;
}

const hasDeal = (s: GameSession): boolean => s.duties().some((d) => d.kind === 'deal');

/** The view fields every client of the game must agree on. */
function shared(s: GameSession) {
  const v = s.view();
  return {
    phase: v.phase,
    head: v.head,
    equivocators: v.equivocators,
    forfeits: v.forfeits,
    logHash: v.logHash,
    pendingSince: v.pendingSince,
  };
}

/** `xs` in a random order. */
function shuffled<T>(xs: readonly T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe('a shuffle fork during the deal (review F7, D056)', () => {
  /** Seats 0 and 1's honest steps, and seat 2's two rival final steps, the lower id first. */
  let s0: NostrEvent;
  let s1: NostrEvent;
  let lo: NostrEvent;
  let hi: NostrEvent;
  let steps: NostrEvent[];
  /** The equivocator's own deals on each rival deck. */
  let eLo: NostrEvent;
  let eHi: NostrEvent;

  beforeAll(() => {
    const h0 = newSession(game, 0);
    s0 = h0.buildShuffle(game.rnd, T0 + 100);
    const h1 = newSession(game, 1);
    trust([h1], [s0]);
    deliver([h1], [s0]);
    s1 = h1.buildShuffle(game.rnd, T0 + 101);
    const e = newSession(game, E);
    trust([e], [s0, s1]);
    deliver([e], [s0, s1]);
    const a = e.buildShuffle(game.rnd, T0 + 102);
    const b = e.buildShuffle(game.rnd, T0 + 103);
    [lo, hi] = a.id < b.id ? [a, b] : [b, a];
    steps = [s0, s1, lo, hi];
    const onLo = fresh(E, steps);
    deliver([onLo], [s0, s1, lo]);
    eLo = onLo.buildDeal(game.rnd, T0 + 104);
    const onHi = fresh(E, steps);
    deliver([onHi], [s0, s1, hi]);
    eHi = onHi.buildDeal(game.rnd, T0 + 105);
  }, 120_000);

  it('the F7 trace: seat 0 deals on one deck, seat 1 on the other; neither deals again, nor is blamed', () => {
    // Seat 0 sees only the canonical step, seat 1 only its rival, and each deals on what it holds.
    const h0 = fresh(0, steps);
    deliver([h0], [s0, s1, lo]);
    expect(h0.duties()).toEqual([{ kind: 'deal' }]);
    const d0 = h0.buildDeal(game.rnd, T0 + 200);
    const h1 = fresh(1, steps);
    deliver([h1], [s0, s1, hi]);
    expect(h1.duties()).toEqual([{ kind: 'deal' }]);
    const d1 = h1.buildDeal(game.rnd, T0 + 201);
    expect(h1.receive(d1, NOW).status).toBe('accepted');
    expect(h0.receive(d0, NOW).status).toBe('accepted');

    // Then everything reaches everyone.
    const all = [s0, s1, lo, hi, d0, d1, eLo, eHi];
    deliver([h0, h1], all);
    for (const s of [h0, h1]) {
      expect(s.view().phase).toBe('deal');
      expect(s.view().head).toEqual({ id: lo.id, seq: SEATS });
      expect(s.view().equivocators).toEqual([E]);
      // Never deal twice: seat 1's deal is on the rival deck, and it owes none on the canonical one.
      expect(hasDeal(s)).toBe(false);
    }
    expect(() => h1.buildDeal(game.rnd, T0 + 300)).toThrow(/no deal duty/);

    // The stalled seat is the equivocator alone: it is the timeout target, and its own claim is refused.
    expect(h0.timeoutTarget(LATE)).toBe(E);
    expect(h1.timeoutTarget(LATE)).toBe(E);
    const claim = h1.buildTimeout(E, game.rnd, LATE);
    const e = fresh(E, steps);
    deliver([e], all);
    expect(e.timeoutTarget(LATE)).toBeNull();
    expect(() => e.buildTimeout(0, game.rnd, LATE)).toThrow(/stalled/);
    for (const s of [h0, h1, e]) {
      expect(s.receive(claim, LATE).status).toBe('accepted');
      expect(s.view().phase).toBe('cancelled');
      expect(s.view().forfeits).toEqual([E]);
      expect(s.view().outcome).toBeNull();
    }
  });

  it('every delivery order, on every seat and a fresh device, reaches the same view and the same blame', () => {
    const h0 = fresh(0, steps);
    deliver([h0], [s0, s1, lo]);
    const d0 = h0.buildDeal(game.rnd, T0 + 200);
    const h1 = fresh(1, steps);
    deliver([h1], [s0, s1, hi]);
    const d1 = h1.buildDeal(game.rnd, T0 + 201);
    const all = [s0, s1, lo, hi, d0, d1, eLo, eHi];
    const rng = createRng('f7-orders');
    const views = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const order = shuffled(all, rng);
      for (const seat of [0, 1, E, null]) {
        const s = fresh(seat, steps);
        const own = seat === 0 ? d0 : seat === 1 ? d1 : null;
        let ownHeld = false;
        for (const ev of order) {
          s.receive(ev, NOW);
          if (ev === own) ownHeld = true;
          // Once a seat holds its own deal, a deal duty never comes back, whatever arrives next.
          if (ownHeld) expect(hasDeal(s)).toBe(false);
        }
        if (seat !== null && seat !== E) expect(hasDeal(s)).toBe(false);
        views.add(JSON.stringify(shared(s)));
        expect(s.timeoutTarget(LATE)).toBe(seat === E || seat === null ? null : E);
      }
    }
    expect(views.size).toBe(1);
    expect(JSON.parse([...views][0] as string)).toMatchObject({
      phase: 'deal',
      head: { id: lo.id, seq: SEATS },
      equivocators: [E],
      forfeits: [E],
    });
  });

  it('a lower-id rival after the deal completed, before the first action, stalls the equivocator: cancelled', () => {
    // Every seat sees only the higher-id step at first, deals on it, and the deal completes.
    const sessions = [0, 1].map((seat) => {
      const s = fresh(seat, steps);
      deliver([s], [s0, s1, hi]);
      return s;
    });
    const deals = sessions.map((s, k) => s.buildDeal(game.rnd, T0 + 200 + k));
    const spectator = fresh(null, steps);
    const before = [s0, s1, hi, ...deals, eHi];
    deliver([...sessions, spectator], before);
    for (const s of [...sessions, spectator]) expect(s.view().phase).toBe('play');
    // The equivocator now publishes its lower-id rival: fork choice takes it (equal length, lower id), nobody owes
    // a deal on it, and the equivocator is the one stalled.
    deliver([...sessions, spectator], [lo, eLo]);
    for (const s of [...sessions, spectator]) {
      expect(s.view().phase).toBe('deal');
      expect(s.view().head.id).toBe(lo.id);
      expect(s.view().equivocators).toEqual([E]);
      expect(hasDeal(s)).toBe(false);
    }
    const claim = (sessions[0] as GameSession).buildTimeout(E, game.rnd, LATE);
    for (const s of [...sessions, spectator]) {
      expect(s.receive(claim, LATE).status).toBe('accepted');
      expect(s.view().phase).toBe('cancelled');
      expect(s.view().forfeits).toEqual([E]);
    }
  });

  it('a rival step after the first action changes nothing but the flag: the game goes on (Ruling 5)', () => {
    const sessions = [0, 1].map((seat) => {
      const s = fresh(seat, steps);
      deliver([s], [s0, s1, hi]);
      return s;
    });
    const deals = sessions.map((s, k) => s.buildDeal(game.rnd, T0 + 200 + k));
    const e = fresh(E, steps);
    const spectator = fresh(null, steps);
    const everyone = [...sessions, e, spectator];
    deliver(everyone, [s0, s1, hi, ...deals, eHi]);
    const pending = (spectator.view().pending as { seat: number }).seat;
    const mover = everyone[pending] as GameSession;
    const first = mover.buildAction(mover.legalActions()[0], game.rnd, T0 + 300);
    deliver(everyone, [first]);
    const head = spectator.view().head;
    expect(head.seq).toBe(SEATS + 1);
    deliver(everyone, [lo, eLo]);
    for (const s of everyone) {
      expect(s.view().phase).toBe('play');
      expect(s.view().head).toEqual(head);
      expect(s.view().equivocators).toEqual([E]);
      expect(s.view().forfeits).toEqual([E]);
    }
  });

  it('honest clients reacting as events arrive: each deals at most once, and only the equivocator is blamed', () => {
    const rng = createRng('f7-random');
    for (let run = 0; run < 5; run++) {
      const players = [0, 1].map((seat) => fresh(seat, steps));
      const spectator = fresh(null, steps);
      const clients = [...players, spectator];
      // The equivocator shows a random rival first to each client; the rest follows in a random order.
      const inbox = clients.map(() => [] as NostrEvent[]);
      const firstOf = clients.map(() => (rng.int(2) === 0 ? lo : hi));
      for (const [i, box] of inbox.entries()) {
        const first = firstOf[i] as NostrEvent;
        const mine = first === lo ? eLo : eHi;
        box.push(s0, s1, first, mine, ...shuffled([lo, hi, eLo, eHi].filter((x) => x !== first && x !== mine), rng));
      }
      const built: NostrEvent[][] = [[], []];
      const taken = clients.map(() => 0);
      for (;;) {
        const busy = inbox.map((b, i) => (b.length > 0 ? i : -1)).filter((i) => i >= 0);
        if (busy.length === 0) break;
        const i = busy[rng.int(busy.length)] as number;
        const box = inbox[i] as NostrEvent[];
        // The first four (both honest steps, the client's first rival and the equivocator's deal on it) arrive in
        // order; the rest in a random order.
        const at = (taken[i] as number) < 4 ? 0 : rng.int(box.length);
        taken[i] = (taken[i] as number) + 1;
        const [ev] = box.splice(at, 1);
        const c = clients[i] as GameSession;
        c.receive(ev, NOW);
        const seat = i < 2 ? i : null;
        if (seat !== null && hasDeal(c)) {
          const d = c.buildDeal(game.rnd, T0 + 400 + run);
          (built[seat] as NostrEvent[]).push(d);
          c.receive(d, NOW);
          for (const [j, other] of inbox.entries()) if (j !== i) other.push(d);
        }
      }
      // Each honest seat dealt exactly once.
      expect(built.map((b) => b.length)).toEqual([1, 1]);
      const views = clients.map((c) => JSON.stringify(shared(c)));
      expect(new Set(views).size).toBe(1);
      const v = spectator.view();
      expect(v.equivocators).toEqual([E]);
      if (v.phase === 'play') {
        // The deal completed: every honest seat dealt on the canonical deck, so none has a share on a rival deck.
        expect(v.head.id).toBe(lo.id);
        const probe = fresh(null, steps);
        deliver([probe], [s0, s1, lo]);
        for (const b of built) {
          expect(parseShares(b[0] as NostrEvent).shares.length).toBeGreaterThan(0);
          expect(probe.receive(b[0], NOW).status).toBe('accepted');
        }
        expect(players.map((p) => hasDeal(p))).toEqual([false, false]);
      } else {
        expect(v.phase).toBe('deal');
        for (const c of clients) {
          if (c !== spectator) expect(c.timeoutTarget(LATE)).toBe(E);
        }
      }
      expect(v.forfeits).toEqual([E]);
    }
  }, 120_000);
});
