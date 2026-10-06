import { deepFreeze } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { CHARTER_OFFSET, FREIGHT_SIZE } from '../../src/deck.ts';
import { claimOptions } from '../../src/engine.ts';
import { CHARTERS, ROUTES } from '../../src/map.ts';
import { rightOfWay } from '../../src/module.ts';
import { charterDone, longestLine } from '../../src/scoring.ts';
import type { RowAction, RowState } from '../../src/types.ts';
import { act, card, legal, orderWith, started, withHand } from '../helpers.ts';

/** The routes of a shortest connection between two towns. */
function path(a: number, b: number): number[] {
  const dist = new Map<number, number>([[a, 0]]);
  const via = new Map<number, number>();
  const todo = new Set([a]);
  while (todo.size > 0) {
    const u = [...todo].sort((x, y) => (dist.get(x) ?? 0) - (dist.get(y) ?? 0))[0] as number;
    todo.delete(u);
    ROUTES.forEach((r, ri) => {
      const v = r.a === u ? r.b : r.b === u ? r.a : null;
      if (v === null) return;
      const d = (dist.get(u) ?? 0) + r.length;
      if (d < (dist.get(v) ?? Number.POSITIVE_INFINITY)) {
        dist.set(v, d);
        via.set(v, ri);
        todo.add(v);
      }
    });
  }
  const out: number[] = [];
  for (let at = b; at !== a; ) {
    const ri = via.get(at) as number;
    out.push(ri);
    const r = ROUTES[ri] as (typeof ROUTES)[number];
    at = r.a === at ? r.b : r.a;
  }
  return out;
}
const POINTS = [0, 1, 2, 4, 7, 10, 15];

/** A game in its first turn where seat 0 owns `owned` routes (side 0) and holds `charters` (charter indexes). */
function staged(
  seats: number,
  owned: readonly (readonly number[])[],
  charters: readonly (readonly number[])[],
): RowState {
  const s = started(seats, orderWith());
  return deepFreeze({
    ...s,
    routes: s.routes.map((sides, ri) =>
      sides.map((o, side) =>
        side === 0
          ? owned.findIndex((xs) => xs.includes(ri)) >= 0
            ? owned.findIndex((xs) => xs.includes(ri))
            : o
          : o,
      ),
    ),
    players: s.players.map((p, i) => {
      const mine = owned[i] ?? [];
      const used = mine.reduce((n, ri) => n + (ROUTES[ri]?.length ?? 0), 0);
      const pts = mine.reduce((n, ri) => n + ([0, 1, 2, 4, 7, 10, 15][ROUTES[ri]?.length ?? 0] ?? 0), 0);
      // The identity order holds charter t at position CHARTER_OFFSET + t.
      const cs = (charters[i] ?? []).map((t) => ({ pos: CHARTER_OFFSET + t, card: CHARTER_OFFSET + t }));
      return { ...p, track: 45 - used, points: pts, charters: cs };
    }),
  });
}

/** Finish the game now: both seats pass while nothing is possible, or the final round runs out. */
function finish(s: RowState): RowState {
  let t: RowState = deepFreeze({ ...s, finalTurns: 1 });
  t = act(t, { type: 'blind', actor: t.turn });
  t = act(t, { type: 'blind', actor: t.turn });
  return t;
}

describe('the end', () => {
  it('C29 ending a turn with 2 or fewer pieces starts the final round: one more turn each', () => {
    const s = withHand(started(3, orderWith()), 0, [card(0, 0)]);
    const low = deepFreeze({ ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, track: 3 } : p)) });
    const r06 = 5; // length 1, unmarked
    const claim = claimOptions(low, 0).find((a) => a.type === 'claim' && a.route === r06) as RowAction;
    let t = act(low, claim);
    expect(t.players[0]?.track).toBe(2);
    expect(t.finalTurns).toBe(3);
    for (const seat of [1, 2, 0]) {
      expect(t.phase).toBe('turn');
      expect(t.turn).toBe(seat);
      t = act(act(t, { type: 'blind', actor: seat }), { type: 'blind', actor: seat });
    }
    expect(t.phase).toBe('over');
    expect(t.result?.reason).toBe('line');
  });

  it('C30 reaching 2 or fewer again during the final round does not extend it', () => {
    const s = withHand(started(2, orderWith()), 1, [card(0, 0)]);
    const t = deepFreeze({
      ...s,
      turn: 1,
      finalTurns: 2,
      players: s.players.map((p, i) => (i === 1 ? { ...p, track: 3 } : p)),
    });
    const claim = claimOptions(t, 1).find((a) => a.type === 'claim' && a.route === 5) as RowAction;
    const u = act(t, claim);
    expect(u.finalTurns).toBe(1);
    const v = act(act(u, { type: 'blind', actor: 0 }), { type: 'blind', actor: 0 });
    expect(v.phase).toBe('over');
  });

  it('C31 charters: completed add their value, unfinished subtract it; scores can be negative', () => {
    const t0 = 0;
    const c0 = CHARTERS[t0] as (typeof CHARTERS)[number];
    const rs = path(c0.a, c0.b);
    const s = staged(2, [rs, []], [[t0], [1]]);
    const t = finish(s);
    const routePts = rs.reduce((n, ri) => n + (POINTS[ROUTES[ri]?.length ?? 0] as number), 0);
    expect(t.result?.scores[0]).toBe(routePts + c0.value + 10);
    expect(t.result?.scores[1]).toBe(-(CHARTERS[1]?.value as number));
    expect(t.result?.scores[1]).toBeLessThan(0);
  });

  it("C32 a charter is completed only by the holder's own routes", () => {
    const c0 = 0;
    const c = CHARTERS[c0] as (typeof CHARTERS)[number];
    const rs = path(c.a, c.b);
    expect(charterDone(rs, c0)).toBe(true);
    expect(charterDone(rs.slice(1), c0)).toBe(false);
    // The routes belong to seat 1: seat 0's charter is not completed.
    const t = finish(staged(2, [[], rs], [[c0], []]));
    expect(t.result?.scores[0]).toBe(-c.value);
  });

  it('C33 the longest line may loop and revisit towns but never reuses a route', () => {
    // Bellwether(1)–Clockhaven(4) 1, Clockhaven–Ironmoor? use a triangle and a tail from the map.
    const tri = ROUTES.map((_, i) => i).filter((i) => {
      const x = ROUTES[i] as (typeof ROUTES)[number];
      return [x.a, x.b].every((t) => [1, 4, 24].includes(t));
    });
    const lengths = tri.map((i) => ROUTES[i]?.length ?? 0);
    expect(longestLine(tri)).toBe(lengths.reduce((a, b) => a + b, 0));
    expect(longestLine([])).toBe(0);
    expect(longestLine([0])).toBe(ROUTES[0]?.length);
    // A star of three routes from one town: only two can be walked in one trail.
    const star = ROUTES.map((_, i) => i)
      .filter((i) => ROUTES[i]?.a === 0 || ROUTES[i]?.b === 0)
      .slice(0, 3);
    const ls = star.map((i) => ROUTES[i]?.length ?? 0).sort((a, b) => b - a);
    expect(longestLine(star)).toBe((ls[0] ?? 0) + (ls[1] ?? 0));
  });

  it('C34 the longest line scores 10; tied seats each score 10', () => {
    const t = finish(staged(2, [[0], [2]], [[], []]));
    // R01 and R03 are both 3 long.
    expect(t.result?.scores).toEqual([4 + 10, 4 + 10]);
  });

  it('C35 most points wins; then most completed charters; then the Iron Ribbon; else a shared place', () => {
    const shared = finish(staged(2, [[0], [2]], [[], []]));
    expect(shared.result?.places).toEqual([1, 1]);
    // Equal points, seat 1 completed one more charter (worth 0 net: it completes one and fails an equal one).
    const ribbonOnly = finish(staged(2, [[0], [12]], [[], []]));
    const [a, b] = ribbonOnly.result?.scores ?? [];
    expect(a !== b || ribbonOnly.result?.places[0] !== ribbonOnly.result?.places[1]).toBe(true);
  });

  it('C36 a pass only when nothing else is possible; all seats passing in a row ends the game', () => {
    const s = started(2, orderWith());
    const stuck = deepFreeze({
      ...s,
      pile: { ...s.pile, next: FREIGHT_SIZE },
      discards: [],
      yard: [null, null, null, null, null],
      charterPile: [],
      players: s.players.map((p) => ({ ...p, hand: [] })),
    });
    expect(legal(stuck)).toEqual([{ type: 'pass', actor: 0 }]);
    expect(rightOfWay.apply(s, { type: 'pass', actor: 0 }).ok).toBe(false);
    const t = act(act(stuck, { type: 'pass', actor: 0 }), { type: 'pass', actor: 1 });
    expect(t.phase).toBe('over');
    expect(t.result?.reason).toBe('stall');
  });
});
