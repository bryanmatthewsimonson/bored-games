import { initialDeck, jointKey, proveShuffle, shuffleDeck } from '@bored-games/deck';
import { canonicalJson, createRng, shuffle } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type Hex,
  type MoveContent,
  moveTemplate,
  type NostrEvent,
  parseMove,
  parseRoot,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClientError } from '../src/errors.ts';
import type { GameSession } from '../src/session.ts';
import type { Identity } from '../src/types.ts';
import { deliver, LATE, makeGame, NOW, newSession, statuses, T0, trust } from './helpers.ts';

const DECK = 108;
const game = makeGame(3, 'client-shuffle');
const contentOf = (ev: NostrEvent): MoveContent => parseMove(ev, DECK).content;
type Shuffle = Extract<MoveContent, { type: 'shuffle' }>;

/** `content` as move `seq` after `prevId`, signed by `seat`'s session key. */
function move(
  seat: number,
  seq: number,
  prevId: string,
  content: MoveContent,
  rootId = game.rootId,
): NostrEvent {
  const t = moveTemplate({ rootId, prevId, seq, content }, T0 + 500);
  return finalizeEvent(t, game.ids[seat]?.sessionSk as Uint8Array, game.rnd);
}

describe('shuffle phase', () => {
  let players: GameSession[];
  let spectator: GameSession;
  let steps: NostrEvent[];

  beforeAll(() => {
    players = [0, 1, 2].map((seat) => newSession(game, seat));
    spectator = newSession(game, null);
  });

  it('each seat shuffles in turn; every session and a spectator accept every step', () => {
    const all = [...players, spectator];
    for (const s of all) expect(s.view().phase).toBe('shuffle');
    expect(players.map((s) => s.duties())).toEqual([[{ kind: 'shuffle' }], [], []]);
    expect(spectator.duties()).toEqual([]);

    steps = [];
    for (const [k, s] of players.entries()) {
      expect(s.duties()).toEqual([{ kind: 'shuffle' }]);
      const ev = s.buildShuffle(game.rnd, T0 + 100 + k);
      expect(statuses(deliver(all, [ev]))).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
      steps.push(ev);
    }

    for (const s of all) {
      const v = s.view();
      expect(v.phase).toBe('deal');
      expect(v.head).toEqual({ id: steps[2]?.id, seq: 3 });
      // Every step was first seen at NOW, by this test's local clock.
      expect(v.pendingSince).toBe(NOW);
      expect(v.state).not.toBeNull();
    }
    expect(new Set(all.map((s) => s.view().logHash)).size).toBe(1);
    expect(() => players[0]?.buildShuffle(game.rnd, T0 + 200)).toThrow(ClientError);
  });

  it('steps delivered in reverse order are stored, then accepted', () => {
    const late = newSession(game, null);
    const results = deliver([late], steps, [2, 1, 0]);
    expect(statuses(results)).toEqual(['stored', 'stored', 'accepted']);
    expect(late.view().phase).toBe('deal');
    expect(late.view().head).toEqual(spectator.view().head);
    expect(statuses(deliver([late], steps))).toEqual(['duplicate', 'duplicate', 'duplicate']);
  });

  it('rejects a step signed by the wrong seat', () => {
    const fresh = newSession(game, null);
    const forged = move(1, 1, game.rootId, contentOf(steps[0] as NostrEvent));
    const r = fresh.receive(forged, NOW);
    expect(r).toEqual({ status: 'rejected', reason: 'shuffle step 1 must be signed by seat 0' });
    expect(fresh.view().head.seq).toBe(0);
  });

  it('rejects a step whose proof was made against another input deck', () => {
    const fresh = newSession(game, null);
    expect(statuses(deliver([fresh], [steps[0]]))).toEqual(['accepted']);
    // Seat 1 shuffles the initial deck instead of seat 0's output, with an honest proof of that shuffle.
    const X = jointKey(parseRoot(game.root).seats.map((s) => s.deckKey));
    const input = initialDeck('tiles', DECK);
    const { out, psi, rPrime } = shuffleDeck(input, X, game.rnd);
    const proof = proveShuffle(
      input,
      out,
      X,
      psi,
      rPrime,
      { rootId: game.rootId, seat: 1, deckId: 'tiles' },
      game.rnd,
    );
    const bad = move(1, 2, steps[0]?.id as string, { type: 'shuffle', deck: out, proof });
    const r = fresh.receive(bad, NOW);
    expect(r).toEqual({ status: 'rejected', reason: 'the shuffle proof does not verify' });
    // The honest step links and the shuffle goes on. Seat 1 signed two distinct well-formed steps on the chain's
    // prev, so it is flagged whether or not their proofs verify: only its key could sign both (D030 Ruling 12).
    expect(statuses(deliver([fresh], [steps[1], steps[2]]))).toEqual(['accepted', 'accepted']);
    expect(fresh.view().equivocators).toEqual([1]);
    expect(fresh.view().forfeits).toEqual([1]);
    expect(fresh.view().phase).toBe('deal');
    expect(fresh.view().head).toEqual(spectator.view().head);
    // The bad step again, now that its prev has a successor, changes nothing.
    expect(fresh.receive(bad, NOW).status).toBe('rejected');
    expect(fresh.view().forfeits).toEqual([1]);
  });

  it('flags a seat that publishes two valid shuffle steps on one prev; the shuffle goes on, in either order', () => {
    // Seat 1 shuffles twice from the same head: both steps verify against seat 0's deck.
    const seat1 = newSession(game, 1);
    expect(statuses(deliver([seat1], [steps[0]]))).toEqual(['accepted']);
    const a = seat1.buildShuffle(game.rnd, T0 + 300);
    const b = seat1.buildShuffle(game.rnd, T0 + 301);
    const lo = a.id < b.id ? a : b;
    let next: NostrEvent | undefined;
    const views = [
      [a, b],
      [b, a],
    ].map((pair) => {
      const s = newSession(game, 2);
      expect(statuses(deliver([s], [steps[0], ...pair]))).toEqual(['accepted', 'accepted', 'accepted']);
      const v = s.view();
      expect(v.phase).toBe('shuffle');
      expect(v.equivocators).toEqual([1]);
      expect(v.head).toEqual({ id: lo.id, seq: 2 });
      // Seat 2 shuffles on the canonical head, the lower id; built once and fed to both sessions.
      expect(s.duties()).toEqual([{ kind: 'shuffle' }]);
      next ??= s.buildShuffle(game.rnd, T0 + 302);
      expect(s.receive(next, NOW)).toEqual({ status: 'accepted' });
      expect(s.view().phase).toBe('deal');
      expect(statuses(deliver([s], pair))).toEqual(['duplicate', 'duplicate']);
      return canonicalJson(s.view());
    });
    expect(views[0]).toBe(views[1]);
  });

  it('reports a duplicate', () => {
    expect(players[0]?.receive(steps[0], T0 + 1000)).toEqual({ status: 'duplicate' });
  });

  it('answers a known event by its id before parsing it', () => {
    const s = players[0] as GameSession;
    // A copy whose body no longer parses: a known id is answered without parsing (or verifying) it again.
    expect(s.receive({ ...steps[0], content: 'not json' }, NOW)).toEqual({ status: 'duplicate' });
    // An unknown id is parsed, and fails.
    expect(s.receive({ ...steps[0], id: 'ab'.repeat(32), content: 'not json' }, NOW).status).toBe('rejected');
    // A rejected event keeps its reason.
    const forged = move(1, 1, game.rootId, contentOf(steps[0] as NostrEvent));
    const reason = 'shuffle step 1 must be signed by seat 0';
    expect(s.receive(forged, NOW)).toEqual({ status: 'rejected', reason });
    expect(s.receive({ ...forged, content: 'not json' }, NOW)).toEqual({ status: 'rejected', reason });
  });

  /** A junk rival to seat 1's step: another step's deck with seat 1's proof, so it never verifies. */
  const junk = (i: number): NostrEvent => {
    const t = moveTemplate(
      {
        rootId: game.rootId,
        prevId: steps[0]?.id as string,
        seq: 2,
        content: {
          type: 'shuffle',
          deck: (contentOf(steps[2] as NostrEvent) as Shuffle).deck,
          proof: (contentOf(steps[1] as NostrEvent) as Shuffle).proof,
        },
      },
      T0 + 600 + i,
    );
    return finalizeEvent(t, game.ids[1]?.sessionSk as Uint8Array, game.rnd);
  };
  const byId = (evs: NostrEvent[]): NostrEvent[] => [...evs].sort((a, b) => (a.id < b.id ? -1 : 1));

  /** The session's count of shuffle proofs actually verified (cache misses; `trust` pre-fills the cache). */
  const verifications = (s: GameSession): number =>
    (s as unknown as { shuffleVerifications: number }).shuffleVerifications;
  /** The session's acknowledged shuffle steps, sorted. */
  const ackedOf = (s: GameSession): Hex[] => [...(s as unknown as { acked: Set<Hex> }).acked].sort();
  const bad = 'the shuffle proof does not verify';
  const outcomes = (results: ReturnType<typeof deliver>): (string | undefined)[] =>
    results.map(([r]) => (r?.status === 'rejected' ? r.reason : r?.status));

  it('verifies a rival shuffle step only while its group holds 3 steps or fewer, in either order (Ruling 12)', () => {
    const five = byId([0, 1, 2, 3, 4].map(junk));
    const views = [five, [...five].reverse()].map((order) => {
      const fresh = newSession(game, null);
      trust([fresh], steps);
      expect(statuses(deliver([fresh], steps))).toEqual(['accepted', 'accepted', 'accepted']);
      const checked = (fresh as unknown as { shuffleChecked: Map<string, boolean> }).shuffleChecked;
      // With seat 1's own step the group holds 2, then 3 steps: those rivals are candidates, verified and rejected.
      // From the 4th step on, only acknowledged steps are candidates (seat 2 built on seat 1's own step), so the
      // later junk stays pooled and unverified. Two steps by seat 1 on the chain's prev flag it, proofs or not.
      expect(outcomes(deliver([fresh], order))).toEqual([bad, bad, 'stored', 'stored', 'stored']);
      expect(order.filter((ev) => checked.has(ev.id))).toEqual(order.slice(0, 2));
      expect(verifications(fresh)).toBe(2);
      expect(fresh.view().equivocators).toEqual([1]);
      expect(fresh.view().head).toEqual(spectator.view().head);
      return canonicalJson(fresh.view());
    });
    expect(views[0]).toBe(views[1]);
  });

  it('gives the same view whatever the arrival order when 3 lower-id junk rivals and a valid one are held (Ruling 12)', () => {
    const seat1 = newSession(game, 1);
    trust([seat1], [steps[0] as NostrEvent]);
    expect(statuses(deliver([seat1], [steps[0]]))).toEqual(['accepted']);
    // A valid rival to seat 1's step, and 3 junk rivals with lower ids.
    const valid = seat1.buildShuffle(game.rnd, T0 + 700);
    const low: NostrEvent[] = [];
    for (let i = 0; low.length < 3 && i < 5000; i++) {
      const j = junk(100 + i);
      if (j.id < valid.id) low.push(j);
    }
    expect(low).toHaveLength(3);
    const views = [
      [...low, valid],
      [valid, ...low],
    ].map((rivals) => {
      const s = newSession(game, null);
      trust([s], [...steps, valid]);
      deliver([s], [...steps, ...rivals]);
      return s.view();
    });
    // The group holds 5 steps, and only seat 1's own step, which seat 2 built on, is a candidate. Seat 1 signed
    // distinct steps on the chain's prev, so every client flags it, whatever their proofs.
    expect(views[0]?.equivocators).toEqual([1]);
    expect(views[0]?.head).toEqual(spectator.view().head);
    expect(views[1]).toEqual(views[0]);
  });

  it('Ruling 12: two valid steps and low-id junk by one seat give one view in any arrival order', () => {
    // The reproduced split: seat 1 signs valid steps a and b, and 3 junk steps with lower ids; seat 2 builds c on a.
    const [s0, a, c] = steps as [NostrEvent, NostrEvent, NostrEvent];
    const seat1 = newSession(game, 1);
    trust([seat1], [s0]);
    expect(statuses(deliver([seat1], [s0]))).toEqual(['accepted']);
    const b = seat1.buildShuffle(game.rnd, T0 + 800);
    const floor = a.id < b.id ? a.id : b.id;
    const low: NostrEvent[] = [];
    for (let i = 0; low.length < 3 && i < 5000; i++) {
      const j = junk(6000 + i);
      if (j.id < floor) low.push(j);
    }
    expect(low).toHaveLength(3);
    const rng = createRng('ruling-12-split');
    const base = [s0, ...low, b, a, c];
    const orders = [
      base,
      [s0, ...low, a, b, c],
      // Children first: c before a, a before s0.
      [c, a, b, ...low, s0],
      [c, b, a, ...[...low].reverse(), s0],
      ...[0, 1, 2].map(() => shuffle(base, rng)),
    ];
    const seen = orders.map((order) => {
      const s = newSession(game, null);
      // The valid steps are trusted, so the counter counts only real verifications: the junk's.
      trust([s], [s0, a, b, c]);
      deliver([s], order);
      const v = s.view();
      expect(v.head).toEqual({ id: c.id, seq: 3 });
      expect(v.phase).toBe('deal');
      expect(v.equivocators).toEqual([1]);
      expect(v.forfeits).toEqual([1]);
      expect(verifications(s)).toBeLessThanOrEqual(3);
      return { view: canonicalJson(v), acked: ackedOf(s) };
    });
    expect(new Set(seen.map((x) => x.view)).size).toBe(1);
    // Acknowledgements do not depend on whether a step's descendants arrived before or after it.
    expect(new Set(seen.map((x) => canonicalJson(x.acked))).size).toBe(1);
    expect(seen[0]?.acked).toContain(a.id);
    expect(seen[0]?.acked).not.toContain(b.id);
  });

  it('Ruling 12: five junk steps cost at most 3 verifications in either order; the seat is flagged and stalls', () => {
    const five = byId([0, 1, 2, 3, 4].map((i) => junk(7000 + i)));
    const sessions = [five, [...five].reverse()].map((order) => {
      const s = newSession(game, 0);
      trust([s], steps);
      // The first 3 arrivals form a group of 3 or fewer: candidates, verified and rejected. The rest are pooled.
      expect(outcomes(deliver([s], [steps[0], ...order]))).toEqual([
        'accepted',
        bad,
        bad,
        bad,
        'stored',
        'stored',
      ]);
      expect(verifications(s)).toBe(3);
      expect(s.view().equivocators).toEqual([1]);
      return s;
    });
    const [one, two] = sessions as [GameSession, GameSession];
    expect(canonicalJson(two.view())).toBe(canonicalJson(one.view()));
    // Seat 1's valid step, now a 6th unacknowledged step on the prev, is not a candidate: it does not link.
    for (const s of sessions) {
      expect(s.receive(steps[1], NOW)).toEqual({ status: 'stored' });
      expect(s.view().head).toEqual({ id: steps[0]?.id, seq: 1 });
    }
    // Seat 1 has stalled its own position: a timeout claim cancels the game, and seat 1 forfeits.
    const claim = one.buildTimeout(1, game.rnd, LATE);
    for (const s of sessions) {
      expect(s.receive(claim, LATE)).toEqual({ status: 'accepted' });
      expect(s.view().phase).toBe('cancelled');
      expect(s.view().forfeits).toEqual([1]);
    }
    expect(canonicalJson(two.view())).toBe(canonicalJson(one.view()));
  });

  it('Ruling 12: at 3 steps on a prev every step is a candidate; 2 junk and a valid step link the valid one', () => {
    const two = byId([0, 1].map((i) => junk(8000 + i)));
    const [s0, s1, s2] = steps as [NostrEvent, NostrEvent, NostrEvent];
    const views = [
      [s0, ...two, s1, s2],
      [s1, ...two, s0, s2],
      [s2, s1, ...[...two].reverse(), s0],
    ].map((order) => {
      const s = newSession(game, null);
      trust([s], steps);
      deliver([s], order);
      const v = s.view();
      // The shuffle goes on: seat 2's step links on the valid one.
      expect(v.head).toEqual({ id: s2.id, seq: 3 });
      expect(v.phase).toBe('deal');
      expect(v.equivocators).toEqual([1]);
      expect(verifications(s)).toBe(2);
      return canonicalJson(v);
    });
    expect(new Set(views).size).toBe(1);
  });

  it('Ruling 12: another seat acknowledges a step from 1 to 32 moves below it, whichever arrives first', () => {
    // Seat 2's junk steps on seat 1's step, each under a tail of seat-2 actions ending in one seat-0 action: at
    // depth 32 it acknowledges the junk, at depth 33 it does not. Seat 2's own moves never do.
    const sk = (seat: number): Uint8Array => game.ids[seat]?.sessionSk as Uint8Array;
    const step = (i: number): NostrEvent =>
      finalizeEvent(
        moveTemplate(
          {
            rootId: game.rootId,
            prevId: steps[1]?.id as string,
            seq: 3,
            content: contentOf(steps[1] as NostrEvent),
          },
          T0 + 9000 + i,
        ),
        sk(2),
        game.rnd,
      );
    const tail = (top: NostrEvent, depth: number): NostrEvent[] => {
      const out: NostrEvent[] = [];
      let prev = top;
      for (let d = 1; d <= depth; d++) {
        const t = moveTemplate(
          {
            rootId: game.rootId,
            prevId: prev.id,
            seq: 3 + d,
            content: { type: 'action', action: { type: 'junk', d }, reveals: [], shares: [] },
          },
          T0 + 9000 + d,
        );
        prev = finalizeEvent(t, sk(d === depth ? 0 : 2), game.rnd);
        out.push(prev);
      }
      return out;
    };
    const near = step(0);
    const far = step(1);
    const events = [near, ...tail(near, 32), far, ...tail(far, 33)];
    const acked = [events, [...events].reverse()].map((order) => {
      const s = newSession(game, null);
      deliver([s], order);
      const out = ackedOf(s);
      expect(out).toContain(near.id);
      expect(out).not.toContain(far.id);
      return canonicalJson(out);
    });
    expect(acked[0]).toBe(acked[1]);
  });

  it('rejects an event for another root', () => {
    const fresh = newSession(game, null);
    const other = 'ab'.repeat(32);
    const ev = move(0, 1, other, contentOf(steps[0] as NostrEvent), other);
    expect(fresh.receive(ev, T0 + 1000)).toEqual({
      status: 'rejected',
      reason: 'the event is for another game',
    });
  });

  it('rejects a bad signature', () => {
    const fresh = newSession(game, null);
    const ev = steps[0] as NostrEvent;
    const sig = (ev.sig[0] === '0' ? '1' : '0') + ev.sig.slice(1);
    const r = fresh.receive({ ...ev, sig }, T0 + 1000);
    expect(r.status).toBe('rejected');
    expect(fresh.view().head.seq).toBe(0);
  });

  it('rejects a move signed by a key that holds no seat', () => {
    const fresh = newSession(game, null);
    const t = moveTemplate(
      { rootId: game.rootId, prevId: game.rootId, seq: 1, content: contentOf(steps[0] as NostrEvent) },
      T0 + 500,
    );
    const ev = finalizeEvent(t, game.npubSks[0] as Uint8Array, game.rnd);
    expect(fresh.receive(ev, T0 + 1000)).toEqual({
      status: 'rejected',
      reason: 'not signed by a seated session key',
    });
  });
});

describe('session creation', () => {
  it('throws ClientError for a tampered root', () => {
    // Re-signed by the creator, but seat 1's session key no longer matches its Join.
    const content = JSON.parse(game.root.content) as { rules: unknown; seats: { session: string }[] };
    const seats = content.seats.map((s, i) => (i === 1 ? { ...s, session: 'cd'.repeat(32) } : s));
    const tampered = finalizeEvent(
      {
        kind: game.root.kind,
        created_at: game.root.created_at,
        tags: game.root.tags,
        content: canonicalJson({ rules: content.rules, seats }),
      },
      game.npubSks[0] as Uint8Array,
      game.rnd,
    );
    expect(() => newSession({ ...game, root: tampered }, null)).toThrow(ClientError);
    // An edit without re-signing does not parse at all.
    expect(() => newSession({ ...game, root: { ...game.root, created_at: T0 + 11 } }, null)).toThrow(
      ClientError,
    );
    expect(() => newSession(game, null)).not.toThrow();
  });

  it('throws ClientError when the identity does not hold its seat', () => {
    const seat0 = game.ids[0] as Identity;
    expect(() => newSession({ ...game, ids: [{ ...seat0, seat: 1 }] }, 0)).toThrow(ClientError);
    expect(() => newSession({ ...game, ids: [{ ...seat0, deckSecret: seat0.deckSecret + 1n }] }, 0)).toThrow(
      ClientError,
    );
    expect(() => newSession({ ...game, ids: [{ ...seat0, seat: 5 }] }, 0)).toThrow(ClientError);
  });
});
