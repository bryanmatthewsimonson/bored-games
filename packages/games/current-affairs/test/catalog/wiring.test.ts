import { describe, expect, it } from 'vitest';
import { SLOT_COST } from '../../src/data.ts';
import { buildCost, buildOptions, pendingOf } from '../../src/engine.ts';
import { citiesIn, lineCosts } from '../../src/graph.ts';
import { CITY_COUNT } from '../../src/map.ts';
import type { CurrentState } from '../../src/types.ts';
import {
  act,
  done,
  drawAll,
  legal,
  patch,
  refused,
  sell,
  skipPhase,
  started,
  step,
  turnOf,
  wired,
  withCompany,
} from '../helpers.ts';

/** Round 1's wiring: seats 0, 1, 2 own 3, 4, 5 and hold $47, $46, $45; the order is 2, 1, 0. */
const buildPhase = (): CurrentState => skipPhase(sell(sell(sell(started(3), 3), 4), 5));

const build = (s: CurrentState, seat: number, city: number): CurrentState =>
  act(s, { type: 'build', actor: seat, city });

describe('wiring', () => {
  it('C14 a substation costs $10, $15 or $20, plus the cheapest lines from the network; the first city needs none', () => {
    expect(SLOT_COST).toEqual([10, 15, 20]);
    let s = buildPhase();
    expect(s.phase).toBe('build');
    // The first city: no line, anywhere in play.
    for (const { cost } of buildOptions(s, 0)) expect(cost).toBe(10);
    const r = step(s, { type: 'build', actor: 0, city: 1 });
    expect(r.events).toEqual([{ type: 'built', kind: 'built', seat: 0, city: 1, cost: 10 }]);
    s = r.state;
    expect(s.companies[0]).toMatchObject({ money: 37, cities: [1] });
    expect(s.houses[1]).toEqual([0]);
    // From 1: the line to 0 costs 9, to 4 costs 9; 2 is reached through 0 (9 + 3).
    expect(buildCost(s, 0, 0)).toBe(19);
    expect(buildCost(s, 0, 4)).toBe(19);
    expect(buildCost(s, 0, 2)).toBe(22);
    s = done(s);
    // Seat 1 starts in 0. Its way to 4 runs through 1, though seat 0 holds it: 9 + 9 (0→3→4 costs 36).
    s = build(
      withCompany(s, 1, (c) => ({ ...c, money: 100 })),
      1,
      0,
    );
    expect(buildCost(s, 1, 4)).toBe(18 + 10);
    // Before 4 is wired, 5 costs 0→1→4→5 (9 + 9 + 14); a city wired this turn joins the network: then 4→5 is 14.
    expect(buildCost(s, 1, 5)).toBe(32 + 10);
    s = build(s, 1, 4);
    expect(s.companies[1]).toMatchObject({ money: 100 - 10 - 28, cities: [0, 4] });
    expect(buildCost(s, 1, 5)).toBe(14 + 10);
    // A line that costs nothing: 4→6.
    expect(buildCost(s, 1, 6)).toBe(10);
    // Every cost is the cheapest route through the cities in play plus the substation.
    const inPlay = Array.from({ length: CITY_COUNT }, (_, c) => citiesIn(s.regions).includes(c));
    const lines = lineCosts([0, 4], inPlay);
    for (const { city, cost } of buildOptions(s, 1)) expect(cost).toBe((lines[city] as number) + 10);
    // In Era II a second company pays $15, in Era III a third pays $20 (here, first cities: no line).
    let t = patch(buildPhase(), { era: 2 });
    t = build(t, 0, 7);
    expect(buildCost(done(t), 1, 7)).toBe(15);
    t = patch(build(done(t), 1, 7), { era: 3 });
    expect(buildCost(done(t), 2, 7)).toBe(20);
  });

  it('C15 one, two or three companies a city by era; never twice; 22 substations; reverse order; nothing to wire, no turn', () => {
    let s = buildPhase();
    expect(s.order).toEqual([2, 1, 0]);
    expect(s.queue).toEqual([0, 1, 2]);
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'build' });
    expect(refused(s, { type: 'build', actor: 1, city: 0 })).toMatch(/not your decision/);
    s = done(build(s, 0, 1));
    // Era I: one company a city.
    expect(buildCost(s, 1, 1)).toBeNull();
    expect(refused(s, { type: 'build', actor: 1, city: 1 })).toMatch(/cannot wire/);
    expect(legal(s, 1).some((a) => a.type === 'build' && a.city === 1)).toBe(false);
    // Era II: two; never twice for one company.
    let t = patch(s, { era: 2 });
    t = build(t, 1, 1);
    expect(t.houses[1]).toEqual([0, 1]);
    expect(refused(t, { type: 'build', actor: 1, city: 1 })).toMatch(/cannot wire/);
    t = done(t);
    expect(buildCost(t, 2, 1)).toBeNull();
    // Era III: three, and no more.
    t = build(patch(t, { era: 3 }), 2, 1);
    expect(t.houses[1]).toEqual([0, 1, 2]);
    // 22 substations at most (five regions give 35 cities).
    let five = started(5);
    five = wired(five, 0, citiesIn(five.regions).slice(0, 21));
    five = withCompany(five, 0, (c) => ({ ...c, money: 1000 }));
    expect(buildOptions(five, 0).length).toBeGreaterThan(0);
    five = wired(five, 0, [citiesIn(five.regions)[21] as number]);
    expect(five.companies[0]?.cities).toHaveLength(22);
    expect(buildOptions(five, 0)).toEqual([]);
    // A company that only cannot pay still decides, and finishes: money is hidden, and decides nothing.
    let u = sell(sell(sell(started(3), 3), 4), 5);
    u = act(u, { type: 'done', actor: 0 });
    u = withCompany(u, 0, (c) => ({ ...c, money: 9 }));
    u = skipPhase(u);
    expect(u.phase).toBe('build');
    expect(u.queue).toEqual([0, 1, 2]);
    expect(legal(u, 0)).toEqual([{ type: 'done', actor: 0 }]);
    expect(buildOptions(u, 0, true).length).toBe(21);
    // Nobody has to wire: every company may finish at once.
    expect(skipPhase(u).phase).toBe('power');
    // A company that could wire no city whatever its money (here, 22 substations) is passed over.
    let four = sell(sell(sell(sell(started(4), 3), 4), 5), 6);
    four = wired(four, 0, citiesIn(four.regions).slice(0, 22));
    expect(buildOptions(four, 0, true)).toEqual([]);
    four = skipPhase(four);
    expect(four.phase).toBe('build');
    expect(four.order).toEqual([3, 2, 1, 0]);
    expect(four.queue).toEqual([1, 2, 3]);
    // A company keeps wiring until it finishes.
    let v = withCompany(buildPhase(), 0, (c) => ({ ...c, money: 23 }));
    v = build(v, 0, 0);
    expect(turnOf(v)).toBe(0);
    v = build(v, 0, 2);
    expect(v.companies[0]?.money).toBe(0);
    expect(legal(v, 0)).toEqual([{ type: 'done', actor: 0 }]);
    v = done(v);
    expect(turnOf(v)).toBe(1);
  });

  it('C11 a market station numbered no higher than a company’s city count leaves at once, replaced, again if small', () => {
    let s = buildPhase();
    expect(s.market).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
    // Seat 0 has five cities and wires a sixth: 6 leaves and 14 replaces it.
    s = withCompany(wired(s, 0, [0, 1, 2, 3, 4]), 0, (c) => ({ ...c, money: 100 }));
    s = build(s, 0, 5);
    expect(s.gone).toEqual([6]);
    expect(pendingOf(s)).toEqual({ type: 'reveal', deck: 'pile', positions: [3] });
    s = drawAll(s);
    expect(s.market).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
    expect(s.companies[0]?.stations).toEqual([3]);
    // Fourteen cities: 6–13 leave at once.
    let t = buildPhase();
    t = withCompany(
      wired(
        t,
        0,
        Array.from({ length: 13 }, (_, c) => c),
      ),
      0,
      (c) => ({ ...c, money: 100 }),
    );
    t = build(t, 0, 13);
    expect(t.gone).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
    t = drawAll(t);
    // The first replacement, 14, is small too: it leaves in turn.
    expect(t.gone).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(t.market).toEqual([15, 16, 17, 18, 19, 20, 21, 22]);
    const kinds = t.history.filter((h) => h.kind === 'drew' || h.kind === 'removed').slice(-18);
    expect(kinds.slice(8, 10)).toEqual([
      { kind: 'drew', station: 14 },
      { kind: 'removed', station: 14 },
    ]);
    // Stations a company owns are never affected.
    expect(t.companies.map((c) => c.stations)).toEqual([[3], [4], [5]]);
  });
});
