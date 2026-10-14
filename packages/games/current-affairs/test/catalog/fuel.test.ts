import { describe, expect, it } from 'vitest';
import { STATIONS, stationOf, YARD_PRICES } from '../../src/data.ts';
import { canBuy, fuelOffers, pendingOf } from '../../src/engine.ts';
import { burnOf, capsOf, costOf, firings, fits, priceOf } from '../../src/fuel.ts';
import type { CurrentState } from '../../src/types.ts';
import {
  act,
  fuelled,
  legal,
  own,
  patch,
  refused,
  sell,
  started,
  step,
  turnOf,
  withCompany,
} from '../helpers.ts';

/** RULES.md "Components": number → [fuel, burn, cities]. */
const TABLE: Record<string, readonly (readonly [number, number, number])[]> = {
  coal: [
    [4, 2, 1],
    [8, 3, 2],
    [10, 2, 2],
    [15, 2, 3],
    [20, 3, 5],
    [25, 2, 5],
    [31, 3, 6],
    [36, 3, 7],
    [42, 2, 6],
  ],
  oil: [
    [3, 2, 1],
    [7, 3, 2],
    [9, 1, 1],
    [16, 2, 3],
    [26, 2, 5],
    [32, 3, 6],
    [35, 1, 5],
    [40, 2, 6],
  ],
  hybrid: [
    [5, 2, 1],
    [12, 2, 2],
    [21, 2, 4],
    [29, 1, 4],
    [46, 3, 7],
  ],
  waste: [
    [6, 1, 1],
    [14, 2, 2],
    [19, 2, 3],
    [24, 2, 4],
    [30, 3, 6],
    [38, 3, 7],
  ],
  uranium: [
    [11, 1, 2],
    [17, 1, 2],
    [23, 1, 3],
    [28, 1, 4],
    [34, 1, 5],
    [39, 1, 6],
  ],
  green: [
    [13, 0, 1],
    [18, 0, 2],
    [22, 0, 2],
    [27, 0, 3],
    [33, 0, 4],
    [37, 0, 4],
    [44, 0, 5],
    [50, 0, 6],
  ],
};

/** Round 1 bought 3 (seat 0), 4 (seat 1) and 5 (seat 2); the fuel phase runs 0, 1, 2. */
function fuelPhase(): CurrentState {
  return sell(sell(sell(started(3), 3), 4), 5);
}

describe('fuel', () => {
  it('C10 each station stores twice its burn; coal-or-oil stations take either; green stations need nothing', () => {
    const listed = Object.entries(TABLE).flatMap(([kind, rows]) =>
      rows.map(([n, burn, powers]) => ({ n, kind, burn, powers })),
    );
    expect(listed).toHaveLength(42);
    expect([...STATIONS]).toEqual(listed.sort((a, b) => a.n - b.n));
    for (const st of STATIONS) {
      const caps = capsOf([st.n]);
      const stored = caps.coal + caps.oil + caps.hybrid + caps.waste + caps.uranium;
      expect(stored).toBe(2 * st.burn);
      if (st.kind !== 'green') expect(caps[st.kind]).toBe(2 * st.burn);
    }
    // A coal-or-oil station stores 4 in any mix, and burns 2 in any mix.
    const five = capsOf([5]);
    for (const fuel of [
      [4, 0, 0, 0],
      [0, 4, 0, 0],
      [1, 3, 0, 0],
      [2, 2, 0, 0],
    ])
      expect(fits(fuel, five)).toBe(true);
    expect(fits([3, 2, 0, 0], five)).toBe(false);
    expect(fits([0, 0, 1, 0], five)).toBe(false);
    const c = { money: 0, cities: [0, 1], stations: [5, 13], fuel: [1, 1, 0, 0] };
    expect(firings(c)).toEqual([
      { stations: [], hybridCoal: 0 },
      { stations: [5], hybridCoal: 1 },
      { stations: [13], hybridCoal: 0 },
      { stations: [5, 13], hybridCoal: 1 },
    ]);
    // A green station fires with no fuel at all, and holds none.
    expect(capsOf([13, 18, 22, 27, 33, 37, 44, 50])).toEqual({
      coal: 0,
      oil: 0,
      hybrid: 0,
      waste: 0,
      uranium: 0,
    });
    expect(firings({ ...c, stations: [50], fuel: [0, 0, 0, 0] })).toEqual([
      { stations: [], hybridCoal: 0 },
      { stations: [50], hybridCoal: 0 },
    ]);
    expect(burnOf({ stations: [3, 4, 5, 6, 11, 13], hybridCoal: 1 })).toEqual({
      burn: [3, 3, 1, 1],
      hybrid: 2,
      powers: 7,
    });
    expect(stationOf(29)).toEqual({ n: 29, kind: 'hybrid', burn: 1, powers: 4 });
  });

  it('C12 in reverse order, one purchase a turn, cheapest first, within the yard, the stations and the money', () => {
    // The yard's ladders: coal, oil and waste on $1–$8 three to a space; uranium on twelve spaces.
    expect(YARD_PRICES.slice(0, 3)).toEqual(
      [0, 1, 2].map(() => [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8]),
    );
    expect(YARD_PRICES[3]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16]);
    let s = fuelPhase();
    expect(s.order).toEqual([2, 1, 0]);
    expect(s.queue).toEqual([0, 1, 2]);
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'fuel' });
    expect(refused(s, { type: 'fuel', actor: 1, buy: [1, 0, 0, 0] })).toMatch(/not your decision/);
    // Seat 0 owns 3 (oil, burns 2): it stores 4 oil and nothing else.
    expect(refused(s, { type: 'fuel', actor: 0, buy: [0, 5, 0, 0] })).toMatch(/cannot buy/);
    expect(refused(s, { type: 'fuel', actor: 0, buy: [1, 0, 0, 0] })).toMatch(/cannot buy/);
    expect(refused(s, { type: 'fuel', actor: 0, buy: [0, 0, 0, 0] })).toMatch(/cannot buy/);
    // Oil lies on $3–$8: the cheapest four cost 3 + 3 + 3 + 4.
    expect(costOf(s.yard, [0, 4, 0, 0])).toBe(13);
    const r = step(s, { type: 'fuel', actor: 0, buy: [0, 4, 0, 0] });
    expect(r.events).toEqual([{ type: 'fuel', kind: 'fuel', seat: 0, bought: [0, 4, 0, 0], cost: 13 }]);
    s = r.state;
    expect(s.companies[0]).toMatchObject({ money: 34, fuel: [0, 4, 0, 0] });
    expect(s.yard).toEqual([24, 14, 6, 2]);
    // One purchase a turn: the turn has passed to seat 1.
    expect(turnOf(s)).toBe(1);
    // Seat 1 owns 4 (coal): four coal cost 1 + 1 + 1 + 2 = 5, more than $4.
    s = withCompany(s, 1, (c) => ({ ...c, money: 4 }));
    expect(refused(s, { type: 'fuel', actor: 1, buy: [4, 0, 0, 0] })).toMatch(/cannot buy/);
    s = act(s, { type: 'fuel', actor: 1, buy: [3, 0, 0, 0] });
    expect(s.companies[1]).toMatchObject({ money: 1, fuel: [3, 0, 0, 0] });
    // Seat 2 (coal or oil): the next coal costs $2 each, the next oil $4.
    s = act(s, { type: 'fuel', actor: 2, buy: [2, 2, 0, 0] });
    expect(s.companies[2]).toMatchObject({ money: 45 - 4 - 8, fuel: [2, 2, 0, 0] });
    expect(s.phase).toBe('build');

    // Never more than the yard holds: two uranium lie on $14 and $16.
    let u = own(fuelPhase(), 0, [11, 17]);
    expect(canBuy(u, 0, [0, 0, 0, 3])).toBe(false);
    expect(refused(u, { type: 'fuel', actor: 0, buy: [0, 0, 0, 3] })).toMatch(/cannot buy/);
    expect(priceOf(3, 2, 2)).toBe(30);
    u = act(u, { type: 'fuel', actor: 0, buy: [0, 0, 0, 2] });
    expect(u.companies[0]?.money).toBe(17);
    expect(u.yard[3]).toBe(0);
    // The list offers a few purchases; any other that fits is accepted too.
    const offers = fuelOffers(fuelPhase(), 0);
    expect(offers).toContainEqual([0, 2, 0, 0]);
    expect(offers.every((b) => canBuy(fuelPhase(), 0, b))).toBe(true);
    expect(legal(fuelPhase(), 0).at(-1)).toEqual({ type: 'done', actor: 0 });

    // A company that only cannot pay still decides, and finishes: money is hidden, and decides nothing.
    let t = sell(sell(started(3), 3), 4);
    t = withCompany(t, 0, (c) => ({ ...c, money: 0 }));
    t = sell(t, 5);
    expect(t.phase).toBe('fuel');
    expect(t.queue).toEqual([0, 1, 2]);
    expect(legal(t, 0)).toEqual([{ type: 'done', actor: 0 }]);
    expect(refused(t, { type: 'fuel', actor: 0, buy: [0, 1, 0, 0] })).toMatch(/cannot buy/);
    // A company that could store none of the yard's fuel is passed over: here, no oil is left for 3.
    let o = patch(sell(sell(started(3), 3), 4), { yard: [24, 0, 6, 2] });
    o = sell(o, 5);
    expect(o.queue).toEqual([1, 2]);
    // Nor when its stations are full.
    let f = fuelled(sell(sell(started(3), 3), 4), 0, [0, 4, 0, 0]);
    f = sell(f, 5);
    expect(f.queue).toEqual([1, 2]);
    // So is one whose stations are green.
    let g = own(sell(sell(started(3), 3), 4), 0, [13]);
    g = patch(g, {
      companies: g.companies.map((c, i) => (i === 0 ? { ...c, stations: [13] } : c)),
      gone: [...g.gone, 3],
    });
    g = sell(g, 5);
    // 13 is its highest station, so seat 0 goes first and buys last; it is passed over.
    expect(g.order).toEqual([0, 2, 1]);
    expect(g.queue).toEqual([1, 2, 0]);
    g = act(act(g, { type: 'done', actor: 1 }), { type: 'done', actor: 2 });
    expect(g.phase).toBe('build');
  });

  it('C13 fuel moves freely: coal on a coal-or-oil station frees room for oil when a coal station can take it', () => {
    // Coal 4 (holds 4 coal) and coal-or-oil 5 (holds 4 of either).
    const caps = capsOf([4, 5]);
    expect(caps).toEqual({ coal: 4, oil: 0, hybrid: 4, waste: 0, uranium: 0 });
    expect(fits([8, 0, 0, 0], caps)).toBe(true);
    expect(fits([4, 4, 0, 0], caps)).toBe(true);
    expect(fits([5, 4, 0, 0], caps)).toBe(false);
    expect(fits([0, 5, 0, 0], caps)).toBe(false);
    expect(fits([3, 4, 0, 0], caps)).toBe(true);
    // Holding 4 coal (on either station), seat 0 can still buy 4 oil: the coal moves to 4.
    let s = own(fuelPhase(), 0, [4, 5]);
    s = patch(s, {
      companies: s.companies.map((c, i) => (i === 0 ? { ...c, stations: [4, 5] } : c)),
      gone: [3],
    });
    s = fuelled(s, 0, [4, 0, 0, 0]);
    expect(canBuy(s, 0, [0, 4, 0, 0])).toBe(true);
    expect(canBuy(s, 0, [1, 4, 0, 0])).toBe(false);
    const more = fuelled(s, 0, [5, 0, 0, 0]);
    expect(canBuy(more, 0, [0, 4, 0, 0])).toBe(false);
    expect(canBuy(more, 0, [0, 3, 0, 0])).toBe(true);
    s = act(s, { type: 'fuel', actor: 0, buy: [0, 4, 0, 0] });
    expect(s.companies[0]?.fuel).toEqual([4, 4, 0, 0]);
    // Fired, 4 burns coal and 5 burns oil.
    const c = s.companies[0];
    expect(c && firings(c).at(-1)).toEqual({ stations: [4, 5], hybridCoal: 2 });
    expect(c && firings(c).some((f) => f.stations.join() === '4,5' && f.hybridCoal === 0)).toBe(true);
  });
});
