import { chess } from '@bored-games/chess';
import { canonicalJson, createRng } from '@bored-games/game-kit';
import { endAttestTemplate, finalizeEvent, type Hex, type NostrEvent } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import type { Identity } from '../../src/types.ts';
import { LineFold } from '../../src/v2/line.ts';
import type { GameSessionV2 } from '../../src/v2/session.ts';
import type { DeckCaches } from '../../src/v2/shares.ts';
import { SideLines } from '../../src/v2/sides.ts';
import type { EventStoreV2 } from '../../src/v2/store.ts';
import type { GameCtx, LinePoint } from '../../src/v2/types.ts';
import type { Walk } from '../../src/v2/walk.ts';
import { NOW } from '../helpers.ts';
import { type AnyModule, act, actionAt, type V2Table, v2Session, v2Table } from './helpers-v2.ts';

/*
 * Side lines (PROTOCOL-v2 §5.1; review of T10, L3): a side line is folded from its nearest folded ancestor, by a
 * prefix copy of a folded line, and the result must be the fold a fresh `LineFold` reaches from the root (V2-20).
 * The cost of a seat's junk is one judgement per junk move, paid once per Move or Shares event held, and nothing for
 * the other events (secrets, attestations, claims, Resigns, Device notes).
 */

interface Inside {
  ctx: GameCtx;
  store: EventStoreV2;
  caches: DeckCaches;
  current: Walk;
}
const inside = (s: GameSessionV2): Inside => s as unknown as Inside;

/** What a point holds, comparably. */
const pointKey = (p: LinePoint): string =>
  canonicalJson({
    id: p.id,
    seq: p.seq,
    phase: p.phase,
    state: p.state,
    logLength: p.logLength,
    eventsLength: p.eventsLength,
    deckKey: p.deckKey,
    learned: p.learned,
  });

/** `id`'s line folded from the root by a fresh `LineFold`, or null where a move on it is not valid. */
function freshFold(s: GameSessionV2, id: Hex): LineFold | null {
  const { ctx, store, caches } = inside(s);
  const fold = new LineFold(ctx, store, caches);
  for (const x of store.lineIds(id) ?? []) {
    const h = store.moves.get(x);
    if (h === undefined) return null;
    let j = fold.judge(h);
    if (j.kind === 'unproven') j = fold.prove(h);
    if (j.kind !== 'valid') return null;
    fold.link(h, j);
  }
  return fold;
}

const mv = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });

/** A Chess line of `plies` random moves, none of which ends the game; returns the table and the moves. */
function longChess(seed: string, plies: number): { t: V2Table; moves: NostrEvent[]; states: unknown[] } {
  const t = v2Table(chess as AnyModule, 2, seed);
  const rng = createRng(seed);
  const moves: NostrEvent[] = [];
  const states: unknown[] = [t.spectator.view().state];
  for (let i = 0; i < plies; i++) {
    const k = i % 2;
    const state = t.spectator.view().state;
    const legal = (t.players[k] as GameSessionV2).legalActions().filter((a) => {
      const r = chess.apply(state as never, a as never);
      return r.ok && chess.pending(r.state).type !== 'over';
    });
    moves.push(act(t, k, rng.pick(legal)));
    states.push(t.spectator.view().state);
  }
  return { t, moves, states };
}

/** A legal action of `seat` at `state` other than `not`, that does not end the game. */
function otherMove(state: unknown, seat: number, not: unknown): unknown {
  return chess.legalActions(state as never, seat).find((a) => {
    if (canonicalJson(a) === canonicalJson(not)) return false;
    const r = chess.apply(state as never, a as never);
    return r.ok && chess.pending(r.state).type !== 'over';
  });
}

describe('side lines (review of T10, L3)', () => {
  it('a side line folded from a prefix copy equals the fresh fold from the root, at every point', () => {
    const { t, moves, states } = longChess('sides-prefix', 24);
    // Seat 1 forks at move 2's prev: the walk stops at move 1, and the game goes on along the old line (a side line).
    const m1 = moves[0] as NostrEvent;
    const rival = actionAt(
      t,
      1,
      m1.id,
      2,
      otherMove(states[1], 1, JSON.parse((moves[1] as NostrEvent).content).action),
    );
    const s = v2Session(t.game, null);
    for (const ev of [...moves, rival]) s.receive(ev, NOW);
    expect(s.view().stop).toMatchObject({ at: m1.id, seat: 1 });
    const { store, current } = inside(s);
    const sides = new SideLines(store, current);
    // Deepest first, then every shallower point: each comes from the folds made before it.
    for (const ev of [...moves].reverse()) {
      const a = sides.fold(ev.id);
      const b = freshFold(s, ev.id);
      expect(a).not.toBeNull();
      expect((a as LineFold).points.map(pointKey)).toEqual((b as LineFold).points.map(pointKey));
      expect(canonicalJson((a as LineFold).log)).toBe(canonicalJson((b as LineFold).log));
      // A copy that is linked further leaves the shared fold unchanged.
      const before = (a as LineFold).points.length;
      sides.extend(ev.id);
      expect((a as LineFold).points.length).toBe(before);
    }
  });

  it("a seat's junk moves at depth, each with a pair under it: equivocators unchanged, cost bounded per event", () => {
    const D = 60;
    const N = 300;
    const { t, moves, states } = longChess('sides-junk', D);
    const m1 = moves[0] as NostrEvent;
    const rival = actionAt(
      t,
      1,
      m1.id,
      2,
      otherMove(states[1], 1, JSON.parse((moves[1] as NostrEvent).content).action),
    );
    // N junk moves on the side line past P (signed by the seat that is not pending there), each with a pair of moves
    // by one seat under it: never valid, so no M1 pair counts, whatever their number.
    const junk: NostrEvent[] = [];
    for (let i = 0; i < N; i++) {
      const at = D - 1 - (i % 30);
      const prev = moves[at] as NostrEvent;
      const wrong = at % 2 === 0 ? 0 : 1;
      const j = actionAt(t, wrong, prev.id, at + 2, mv(wrong, 'a2a3'), NOW + 100 + i);
      junk.push(
        j,
        ...[0, 1].map((n) => actionAt(t, 1, j.id, at + 3, mv(1, 'h7h6'), NOW + 10_000 + 2 * i + n)),
      );
    }
    const s = v2Session(t.game, null);
    for (const ev of [...moves, rival, ...junk]) s.receive(ev, NOW);
    const first = performance.now();
    expect(s.view()).toMatchObject({ stop: { at: m1.id, seat: 1, cancelled: false }, equivocators: [1] });
    const firstMs = performance.now() - first;
    // Events that cannot change a line's validity (end attestations here) keep the side lines: near free.
    const sk = (t.game.ids[0] as Identity).sessionSk;
    let quiet = 0;
    for (let i = 0; i < 20; i++) {
      const head = (moves[10 + i] as NostrEvent).id;
      const end = finalizeEvent(
        endAttestTemplate(
          {
            rootId: t.game.rootId,
            headId: head,
            end: { kind: 'over', forfeit: [], logHash: '0'.repeat(64) },
          },
          NOW + i,
        ),
        sk,
        t.game.rnd,
      );
      const a = performance.now();
      s.receive(end, NOW);
      s.view();
      quiet = Math.max(quiet, performance.now() - a);
    }
    // A Move held drops them: one refold of the side line and one judgement per junk move.
    let moved = 0;
    for (let i = 0; i < 5; i++) {
      // By the seat that is not pending there: invalid, so the five are no M1 pair.
      const more = actionAt(t, 1, (moves[D - 1] as NostrEvent).id, D + 1, mv(1, 'h7h6'), NOW + 50_000 + i);
      const a = performance.now();
      s.receive(more, NOW);
      expect(s.view().equivocators).toEqual([1]);
      moved = Math.max(moved, performance.now() - a);
    }
    // The review measured about 300 ms per event for N = 200 before (every event refolded every junk line from the
    // root); now a few ms (about 4 ms quiet, 10 ms per Move here). Generous bounds, for slow machines.
    expect(quiet, `quiet event: ${quiet.toFixed(1)} ms (first view ${firstMs.toFixed(1)} ms)`).toBeLessThan(
      60,
    );
    expect(moved, `move event: ${moved.toFixed(1)} ms (first view ${firstMs.toFixed(1)} ms)`).toBeLessThan(
      250,
    );
  }, 120_000);
});
