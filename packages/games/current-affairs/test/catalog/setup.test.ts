import { packetOrderFits } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { DECK_STATIONS, STACK_STATIONS, TABLES } from '../../src/data.ts';
import {
  buildCost,
  buildOptions,
  DEFAULT_RULES,
  ORDER_SIDES,
  pendingOf,
  REGION_CHOOSER,
  rankedOrder,
  regionChoices,
  STATION_DECK,
  setupGame,
} from '../../src/engine.ts';
import { citiesIn, lineCosts, regionSets } from '../../src/graph.ts';
import { CITY_COUNT, CITY_REGION } from '../../src/map.ts';
import { currentAffairs } from '../../src/module.ts';
import type { CurrentState } from '../../src/types.ts';
import {
  act,
  chosen,
  deckOrder,
  fresh,
  legal,
  nextRound,
  refused,
  revealStep,
  rollWith,
  sell,
  skipPhase,
  started,
  step,
  turnOf,
  wired,
  withCompany,
} from '../helpers.ts';

/** How the regions touch, as RULES.md "The map" lists it (0 Frostmere … 5 Emberreach). */
const TOUCH: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 3],
  [0, 5],
  [1, 2],
  [1, 4],
  [1, 5],
  [2, 4],
  [3, 5],
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
      const r = setupGame({ rules: DEFAULT_RULES, seats, mode: 'full', deckOrders: { pile: deckOrder() } });
      expect(r.ok).toBe(false);
    }
    expect(
      setupGame({
        rules: { rulesVersion: 2 } as never,
        seats: 3,
        mode: 'full',
        deckOrders: { pile: deckOrder() },
      }).ok,
    ).toBe(false);
    // Full mode needs the deck's order, and one that fits it: 13 alone on top.
    for (const deckOrders of [
      {},
      { pile: [] },
      { pile: [1, 0, ...deckOrder().slice(2)] },
      { pile: deckOrder().slice(1) },
    ])
      expect(setupGame({ rules: DEFAULT_RULES, seats: 3, mode: 'full', deckOrders }).ok).toBe(false);
    expect(packetOrderFits(STATION_DECK, deckOrder())).toBe(true);
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
      // The stack is the deck: 13 alone on top (position 0), then the 33 others shuffled.
      expect(DECK_STATIONS).toEqual([13, ...STACK_STATIONS]);
      expect(STACK_STATIONS).toHaveLength(33);
      expect(STACK_STATIONS.some((n) => n <= 10 || n === 13)).toBe(false);
      expect(currentAffairs.decks(DEFAULT_RULES)).toEqual([STATION_DECK]);
      expect(STATION_DECK).toEqual({
        id: 'pile',
        size: 34,
        partitions: [
          { id: 'top', size: 1 },
          { id: 'stack', size: 33 },
        ],
        promptShares: true,
      });
      // 25, 25, 29, 33 or 33 positions are drawn before the Era III card; the last 8, 8, 4, 0 or 0 never are.
      const drawn = drawable[seats - 2] as number;
      expect(s.stack.next).toEqual(Array.from({ length: drawn + 1 }, (_, i) => i));
      expect(s.stack.out).toEqual(Array.from({ length: 33 - drawn }, (_, i) => drawn + 1 + i));
      expect(s.stack.eraCard).toBe(true);
      expect(s.stack.under).toEqual([]);
      expect([s.stack.shuffling, s.stack.shuffled, s.reveal]).toEqual([false, false, null]);
      expect(s.dealt).toEqual([]);
      expect([s.era, s.round, s.phase, s.gone.length]).toEqual([1, 0, 'opening', 0]);
      // Nothing else happens before the first seat chooses the regions: no roll is open.
      expect(s.roll).toBeNull();
      expect(s.rolls).toEqual([]);
      expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'regions' });
    }
  });

  it('C02 the first seat chooses a block of touching regions of the right size; cities out of play take no part', () => {
    const sizes = [3, 3, 4, 5, 5];
    const counts: Record<number, number> = { 3: 12, 4: 12, 5: 6 };
    for (const seats of [2, 3, 4, 5, 6]) {
      const k = sizes[seats - 2] as number;
      expect(TABLES[seats]?.regions).toBe(k);
      const s = fresh(seats);
      expect(REGION_CHOOSER).toBe(0);
      expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'regions' });
      // The choices are exactly the sets of k regions that touch as one block, by RULES.md's list.
      const blocks = subsets(k).filter(block);
      expect(blocks).toHaveLength(counts[k] as number);
      expect(regionChoices(s).map(String).sort()).toEqual(blocks.map(String).sort());
      expect(regionSets(k).map(String).sort()).toEqual(blocks.map(String).sort());
      expect(
        legal(s, 0)
          .map((a) => (a.type === 'regions' ? a.regions.join() : ''))
          .sort(),
      ).toEqual(blocks.map(String).sort());
      for (let seat = 1; seat < seats; seat++) expect(legal(s, seat)).toEqual([]);
      // Every listed set is accepted; any other set of regions is refused.
      for (const regions of blocks) expect(chosen(s, regions).regions).toEqual(regions);
      for (const regions of subsets(k).filter((x) => !block(x)))
        expect(refused(s, { type: 'regions', actor: 0, regions })).toMatch(/touch as one block/);
      for (const size of [k - 1, k + 1])
        for (const regions of subsets(size).filter(block))
          expect(refused(s, { type: 'regions', actor: 0, regions })).toMatch(/touch as one block/);
      // Only the first seat chooses.
      expect(refused(s, { type: 'regions', actor: 1, regions: blocks[0] })).toMatch(/not your decision/);
      // Nothing else comes first.
      expect(refused(s, { type: 'open', actor: 0, station: 3, bid: 3 })).toMatch(/cannot open/);
    }
    // Not in RULES.md's list: Frostmere, Highcopper and Heartfield touch; Frostmere, Ambergate and Saltmarsh do not.
    expect(block([0, 1, 4])).toBe(true);
    expect(block([0, 2, 3])).toBe(false);
    const r = step(fresh(3), { type: 'regions', actor: 0, regions: [0, 1, 4] });
    expect(r.events).toEqual([{ type: 'regions', kind: 'regions', regions: [0, 1, 4] }]);
    // The order roll follows, and the regions cannot be chosen again.
    expect(r.state.roll).toEqual({ id: 0, purpose: 'order', count: 2, sides: 60 });
    expect(refused(r.state, { type: 'regions', actor: 0, regions: [0, 1, 2] })).toMatch(/not your decision/);
    expect(rollWith(r.state, [1, 1]).regions).toEqual([0, 1, 4]);

    // No city outside the regions in play can be wired.
    let s = skipPhase(sell(sell(sell(started(3), 3), 4), 5));
    expect(s.phase).toBe('build');
    const seat = turnOf(s);
    const inPlay = citiesIn([0, 1, 2]);
    expect(inPlay).toEqual(Array.from({ length: 21 }, (_, c) => c));
    expect(buildOptions(s, seat).map((o) => o.city)).toEqual(inPlay);
    for (let city = 21; city < CITY_COUNT; city++) expect(buildCost(s, seat, city)).toBeNull();
    expect(refused(s, { type: 'build', actor: seat, city: 30 })).toMatch(/cannot wire/);

    // No line passes through them: from city 5 the cheapest way to 12 runs through Emberreach, out of play.
    const all = Array.from({ length: CITY_COUNT }, () => true);
    const ours = Array.from({ length: CITY_COUNT }, (_, c) => [0, 1, 2].includes(CITY_REGION[c] as number));
    expect(lineCosts([5], all)[12]).toBe(11);
    expect(lineCosts([5], ours)[12]).toBe(23);
    s = withCompany(wired(s, seat, [5]), seat, (c) => ({ ...c, money: 100 }));
    expect(buildCost(s, seat, 12)).toBe(23 + 10);
    s = act(s, { type: 'build', actor: seat, city: 12 });
    expect(s.companies[seat]?.money).toBe(100 - 33);
  });

  it('C05 the opening roll, after the regions, draws the opening order evenly; then cities and the highest station rank the companies', () => {
    // 60 faces divide by 2, 3, 4, 5 and 6: each die picks evenly among the companies not yet placed.
    expect(ORDER_SIDES).toBe(60);
    const afterRegions = (seats: number): CurrentState => chosen(fresh(seats));
    for (const seats of [2, 3, 4, 5, 6]) {
      const s = afterRegions(seats);
      expect(s.roll).toEqual({ id: 0, purpose: 'order', count: seats - 1, sides: 60 });
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
    expect(started(4, null, [2, 1, 1]).order).toEqual([1, 0, 2, 3]);
    expect(started(4, null, [60, 60, 60]).order).toEqual([3, 0, 1, 2]);

    // Round 1's auction runs in the drawn order; after it, the order is worked out again by stations alone.
    let s = started(3, null, [3, 1]);
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
    expect(pendingOf(s)).toEqual({ type: 'reveal', deck: 'pile', positions: [3] });
    const r = revealStep(s);
    seen(r.state);
    expect(phases).toEqual(['auction', 'fuel', 'build', 'power', 'auction']);
    expect(r.state.round).toBe(2);
    const kinds = r.events.map((e) => e.type);
    expect(kinds.slice(-3)).toEqual(['drew', 'round', 'order']);
    // Seat 0 has a city; the others follow by their highest station.
    expect(r.state.order).toEqual([0, 2, 1]);
  });
});
