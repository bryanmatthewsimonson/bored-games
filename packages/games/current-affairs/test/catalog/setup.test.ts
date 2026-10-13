import { describe, expect, it } from 'vitest';
import { STACK_STATIONS, TABLES } from '../../src/data.ts';
import {
  buildCost,
  buildOptions,
  DEFAULT_RULES,
  ORDER_SIDES,
  pendingOf,
  rankedOrder,
  setupGame,
} from '../../src/engine.ts';
import { citiesIn, lineCosts, regionSets } from '../../src/graph.ts';
import { CITY_COUNT, CITY_REGION } from '../../src/map.ts';
import type { CurrentState } from '../../src/types.ts';
import {
  act,
  fresh,
  nextRound,
  refused,
  rollStep,
  rollWith,
  sell,
  skipPhase,
  started,
  turnOf,
  wired,
  withCompany,
} from '../helpers.ts';

/** How the regions touch, as RULES.md "The map" lists it (0 Frostmere … 5 Emberreach). */
const TOUCH: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 3],
  [0, 4],
  [1, 2],
  [1, 4],
  [2, 5],
  [3, 4],
  [4, 5],
];

/** Whether `set` touches as one block, by RULES.md's list. */
function block(set: readonly number[]): boolean {
  const reached = new Set([set[0]]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [a, b] of TOUCH)
      if (set.includes(a) && set.includes(b) && reached.has(a) !== reached.has(b)) {
        reached.add(a);
        reached.add(b);
        grew = true;
      }
  }
  return reached.size === set.length;
}

/** Every k-subset of the six regions, ascending. */
const subsets = (k: number): number[][] =>
  Array.from({ length: 64 }, (_, m) => [0, 1, 2, 3, 4, 5].filter((r) => (m >> r) & 1)).filter(
    (x) => x.length === k,
  );

describe('setup', () => {
  it('C01 two to six companies with $50 and nothing else; the yard, the market and the stack', () => {
    for (const seats of [0, 1, 7, 2.5, -2]) {
      const r = setupGame({ rules: DEFAULT_RULES, seats, mode: 'full', deckOrders: {} });
      expect(r.ok).toBe(false);
    }
    expect(
      setupGame({ rules: { rulesVersion: 2 } as never, seats: 3, mode: 'full', deckOrders: {} }).ok,
    ).toBe(false);
    const drawable = [25, 25, 29, 33, 33];
    for (const seats of [2, 3, 4, 5, 6]) {
      const s = fresh(seats);
      expect(s.companies).toHaveLength(seats);
      for (const c of s.companies)
        expect(c).toEqual({ money: 50, cities: [], stations: [], fuel: [0, 0, 0, 0] });
      expect(s.houses).toHaveLength(42);
      expect(s.houses.every((h) => h.length === 0)).toBe(true);
      expect(s.yard).toEqual([24, 18, 6, 2]);
      expect(s.market).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
      expect(s.stack.top).toEqual([13]);
      expect(s.stack.pool).toHaveLength(33);
      expect(s.stack.pool).toEqual(STACK_STATIONS);
      expect(s.stack.pool).not.toContain(13);
      expect(s.stack.pool.some((n) => n <= 10)).toBe(false);
      expect(s.stack.draws).toBe(drawable[seats - 2]);
      expect(s.stack.eraCard).toBe(true);
      expect(s.stack.under).toEqual([]);
      expect([s.era, s.round, s.phase, s.gone.length]).toEqual([1, 0, 'opening', 0]);
      // Nothing to decide before the regions are drawn: the first roll is open.
      expect(s.roll?.purpose).toBe('regions');
    }
  });

  it('C02 the first roll picks one block of touching regions, evenly; cities out of play take no part', () => {
    const sizes = [3, 3, 4, 5, 5];
    const counts: Record<number, number> = { 3: 11, 4: 11, 5: 6 };
    for (const seats of [2, 3, 4, 5, 6]) {
      const k = sizes[seats - 2] as number;
      expect(TABLES[seats]?.regions).toBe(k);
      const s = fresh(seats);
      // One face per set: each set of k touching regions is drawn with the same chance.
      const blocks = subsets(k).filter(block);
      expect(blocks).toHaveLength(counts[k] as number);
      expect(s.roll).toEqual({ id: 0, purpose: 'regions', count: 1, sides: blocks.length });
      const drawn = blocks.map((_, f) => rollWith(s, [f + 1]).regions);
      expect(drawn.map(String).sort()).toEqual(blocks.map(String).sort());
      expect(new Set(drawn.map((x) => x.join())).size).toBe(blocks.length);
      expect(regionSets(k).map(String).sort()).toEqual(blocks.map(String).sort());
      // A face outside the die is refused.
      let t = s;
      for (const seat of s.contributors) t = act(t, { type: 'contribute', actor: seat, id: 0 });
      expect(refused(t, { type: 'rolled', actor: 'beacon', id: 0, dice: [blocks.length + 1] })).toMatch(
        /dice/,
      );
      expect(refused(t, { type: 'rolled', actor: 'beacon', id: 0, dice: [0] })).toMatch(/dice/);
    }
    const r = rollStep(fresh(3), [1]);
    expect(r.state.regions).toEqual([0, 1, 2]);
    expect(r.events).toContainEqual({ type: 'regions', kind: 'regions', regions: [0, 1, 2] });

    // No city outside the regions in play can be wired.
    let s = skipPhase(sell(sell(sell(started(3), 3), 4), 5));
    expect(s.phase).toBe('build');
    const seat = turnOf(s);
    const inPlay = citiesIn([0, 1, 2]);
    expect(inPlay).toEqual(Array.from({ length: 21 }, (_, c) => c));
    expect(buildOptions(s, seat).map((o) => o.city)).toEqual(inPlay);
    for (let city = 21; city < CITY_COUNT; city++) expect(buildCost(s, seat, city)).toBeNull();
    expect(refused(s, { type: 'build', actor: seat, city: 30 })).toMatch(/cannot wire/);

    // No line passes through them: from city 6 the cheapest way to 19 runs through Saltmarsh, out of play.
    const all = Array.from({ length: CITY_COUNT }, () => true);
    const ours = Array.from({ length: CITY_COUNT }, (_, c) => [0, 1, 2].includes(CITY_REGION[c] as number));
    expect(lineCosts([6], all)[19]).toBe(47);
    expect(lineCosts([6], ours)[19]).toBe(48);
    s = withCompany(wired(s, seat, [6]), seat, (c) => ({ ...c, money: 100 }));
    expect(buildCost(s, seat, 19)).toBe(48 + 10);
    s = act(s, { type: 'build', actor: seat, city: 19 });
    expect(s.companies[seat]?.money).toBe(100 - 58);
  });

  it('C05 the second roll draws the opening order evenly; then cities and the highest station rank the companies', () => {
    // 60 faces divide by 2, 3, 4, 5 and 6: each die picks evenly among the companies not yet placed.
    expect(ORDER_SIDES).toBe(60);
    const afterRegions = (seats: number): CurrentState => rollWith(fresh(seats), [1]);
    for (const seats of [2, 3, 4, 5, 6]) {
      const s = afterRegions(seats);
      expect(s.roll).toEqual({ id: 1, purpose: 'order', count: seats - 1, sides: 60 });
    }
    const tally = (seats: number, faces: readonly number[]): Map<string, number> => {
      const s = afterRegions(seats);
      const out = new Map<string, number>();
      const dice = (i: number): number[][] =>
        i === 0 ? [[]] : dice(i - 1).flatMap((d) => faces.map((f) => [...d, f]));
      for (const d of dice(seats - 1)) {
        const key = rollWith(s, d).order.join('');
        out.set(key, (out.get(key) ?? 0) + 1);
      }
      return out;
    };
    const two = tally(
      2,
      Array.from({ length: 60 }, (_, i) => i + 1),
    );
    expect([...two.entries()].sort()).toEqual([
      ['01', 30],
      ['10', 30],
    ]);
    const three = tally(
      3,
      Array.from({ length: 60 }, (_, i) => i + 1),
    );
    expect(three.size).toBe(6);
    expect([...three.values()].every((n) => n === 600)).toBe(true);
    // Faces 1–12 cover every residue of 4, 3 and 2 equally often: 24 orders, 72 each.
    const four = tally(
      4,
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(four.size).toBe(24);
    expect([...four.values()].every((n) => n === 72)).toBe(true);
    expect(started(4, 1, [2, 1, 1]).order).toEqual([1, 0, 2, 3]);
    expect(started(4, 1, [60, 60, 60]).order).toEqual([3, 0, 1, 2]);

    // Round 1's auction runs in the drawn order; after it, the order is worked out again by stations alone.
    let s = started(3, 1, [3, 1]);
    expect(s.order).toEqual([2, 1, 0]);
    expect(turnOf(s)).toBe(2);
    s = sell(s, 3);
    expect(turnOf(s)).toBe(1);
    s = sell(s, 6);
    s = sell(s, 4);
    expect(s.companies.map((c) => c.stations)).toEqual([[4], [6], [3]]);
    expect(s.order).toEqual([1, 0, 2]);
    expect(s.history.filter((h) => h.kind === 'order').at(-1)).toEqual({ kind: 'order', order: [1, 0, 2] });

    // From round 2: the most cities first, then the highest station.
    s = skipPhase(s);
    s = wired(s, 2, [0, 1]);
    s = wired(s, 0, [3, 4]);
    s = wired(s, 1, [9]);
    expect(rankedOrder(s)).toEqual([0, 2, 1]);
    s = nextRound(skipPhase(s));
    expect(s.round).toBe(2);
    expect(s.order).toEqual([0, 2, 1]);
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'open' });
  });

  it('C04 a round runs Auction, Fuel, Wiring and Payday, and the next round ranks the order again', () => {
    let s = started(3);
    expect([s.round, s.phase]).toEqual([1, 'auction']);
    const phases: string[] = [s.phase];
    const seen = (t: CurrentState) => {
      if (phases.at(-1) !== t.phase) phases.push(t.phase);
    };
    s = sell(s, 3);
    s = sell(s, 4);
    s = sell(s, 5);
    seen(s);
    // Seat 0 fires: it needs fuel and a city.
    s = act(s, { type: 'fuel', actor: 0, buy: [0, 2, 0, 0] });
    s = skipPhase(s);
    seen(s);
    s = skipPhase(act(s, { type: 'build', actor: 0, city: 0 }));
    seen(s);
    expect(s.phase).toBe('power');
    s = act(s, { type: 'power', actor: 0, stations: [3], hybridCoal: 0 });
    seen(s);
    expect(s.phase).toBe('power');
    expect(s.roll?.purpose).toBe('draw');
    const r = rollStep(s, [1]);
    seen(r.state);
    expect(phases).toEqual(['auction', 'fuel', 'build', 'power', 'auction']);
    expect(r.state.round).toBe(2);
    const kinds = r.events.map((e) => e.type);
    expect(kinds.slice(-3)).toEqual(['drew', 'round', 'order']);
    // Seat 0 has a city; the others follow by their highest station.
    expect(r.state.order).toEqual([0, 2, 1]);
  });
});
