import { describe, expect, it } from 'vitest';
import { TABLES } from '../../src/data.ts';
import { legalActions, pendingOf, placesOf, standingsOf } from '../../src/engine.ts';
import { bestPower } from '../../src/fuel.ts';
import { currentAffairs } from '../../src/module.ts';
import type { CurrentState } from '../../src/types.ts';
import {
  act,
  done,
  drawAll,
  fuelled,
  own,
  refused,
  sell,
  skipPhase,
  started,
  step,
  wired,
  withCompany,
} from '../helpers.ts';

/** Round 1's wiring with three companies: seats 0, 1, 2 own 3 (oil), 4 (coal), 5 (coal or oil); the queue 0, 1, 2. */
const buildPhase = (): CurrentState => skipPhase(sell(sell(sell(started(3), 3), 4), 5));

describe('the end', () => {
  it('C24 the game ends after the wiring in which a company reaches the end count; no income; powered, money, cities', () => {
    expect([2, 3, 4, 5, 6].map((n) => TABLES[n]?.end)).toEqual([21, 17, 17, 15, 14]);
    let s = buildPhase();
    s = withCompany(
      wired(
        s,
        0,
        Array.from({ length: 16 }, (_, c) => c),
      ),
      0,
      (c) => ({ ...c, money: 200 }),
    );
    s = fuelled(fuelled(s, 0, [0, 2, 0, 0]), 1, [2, 0, 0, 0]);
    // Seat 0 wires its seventeenth city: the wiring goes on for the others.
    s = drawAll(act(s, { type: 'build', actor: 0, city: 16 }));
    s = done(s);
    expect(s.phase).toBe('build');
    s = act(s, { type: 'build', actor: 1, city: 20 });
    s = done(s);
    const money = s.companies.map((c) => c.money);
    const r = step(s, { type: 'done', actor: 2 });
    expect(r.events.map((e) => e.type)).toEqual(['end']);
    s = r.state;
    expect(s.phase).toBe('over');
    // No payday: nobody is paid, nobody burns fuel.
    expect(s.companies.map((c) => c.money)).toEqual(money);
    expect(s.companies[0]?.fuel).toEqual([0, 2, 0, 0]);
    // Seats 0 and 1 each power one city; seat 0 has more money.
    expect(s.result).toEqual({ places: [1, 2, 3], scores: [1, 1, 0], reason: 'cities' });
    expect(currentAffairs.outcome(s)).toEqual(s.result);
    // No more buying, or anything else.
    expect(pendingOf(s)).toEqual({ type: 'over' });
    expect(legalActions(s, 0)).toEqual([]);
    expect(refused(s, { type: 'done', actor: 0 })).toMatch(/over/);

    // Places: the most cities powered, then money, then cities wired; a tie there shares the place.
    const t = (powered: number[], money: number[], cities: number[]): number[] => {
      let u = started(powered.length);
      for (let i = 0; i < powered.length; i++)
        u = wired(
          withCompany(u, i, (c) => ({ ...c, money: money[i] as number })),
          i,
          Array.from({ length: cities[i] as number }, (_, k) => k + 7 * i),
        );
      return placesOf(powered, u);
    };
    expect(t([4, 3], [0, 100], [0, 9])).toEqual([1, 2]);
    expect(t([3, 3, 3], [10, 20, 20], [5, 4, 6])).toEqual([3, 2, 1]);
    expect(t([2, 2, 1], [10, 10, 5], [3, 3, 6])).toEqual([1, 1, 3]);
    expect(t([0, 0, 0], [7, 7, 7], [1, 1, 1])).toEqual([1, 1, 1]);
  });

  it('C25 standings: the cities each company could power now, from public data, equal to the final scores', () => {
    let s = buildPhase();
    expect(standingsOf(s)).toEqual([0, 0, 0]);
    // Seat 2: coal-or-oil 5 and green 18, two cities, one coal and one oil: 1 + 2, capped at its 2 cities.
    s = fuelled(wired(own(s, 2, [18]), 2, [10, 11]), 2, [1, 1, 0, 0]);
    s = fuelled(wired(s, 1, [3, 4]), 1, [2, 0, 0, 0]);
    expect(standingsOf(s)).toEqual([0, 1, 2]);
    s = wired(s, 2, [12, 13]);
    expect(standingsOf(s)).toEqual([0, 1, 3]);
    expect(s.companies.map(bestPower)).toEqual([0, 1, 3]);
    // Every seat's view gives the same standings, and so does the module.
    for (const viewer of [0, 1, 2, null])
      expect(currentAffairs.standings(currentAffairs.view(s, viewer))).toEqual([0, 1, 3]);
    // At the end they are the final scores.
    let e = fuelled(
      wired(
        buildPhase(),
        0,
        Array.from({ length: 17 }, (_, c) => c),
      ),
      0,
      [0, 2, 0, 0],
    );
    e = skipPhase(e);
    expect(e.phase).toBe('over');
    expect(e.result?.scores).toEqual(standingsOf(e));
    expect(currentAffairs.standings(e)).toEqual([1, 0, 0]);
  });
});
