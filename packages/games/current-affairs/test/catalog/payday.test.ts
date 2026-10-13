import { describe, expect, it } from 'vitest';
import { PAYDAY, payFor, RESTOCK } from '../../src/data.ts';
import { pendingOf } from '../../src/engine.ts';
import type { CurrentState, Entry } from '../../src/types.ts';
import {
  act,
  drawAll,
  fuelled,
  legal,
  nextRound,
  own,
  patch,
  refused,
  revealStep,
  sell,
  skipPhase,
  started,
  step,
  wired,
} from '../helpers.ts';

/** Round 1 in any seat count: each company buys the lowest station on offer. */
function roundOne(seats: number): CurrentState {
  let s = started(seats);
  for (let i = 0; i < seats; i++) s = sell(s, s.market[0] as number);
  return s;
}

/** Round 1's wiring with three companies: seats 0, 1, 2 own 3 (oil), 4 (coal), 5 (coal or oil); order 2, 1, 0. */
const buildPhase = (): CurrentState => skipPhase(roundOne(3));

const last = <K extends Entry['kind']>(s: CurrentState, kind: K): Extract<Entry, { kind: K }> | undefined =>
  s.history.filter((h): h is Extract<Entry, { kind: K }> => h.kind === kind).at(-1);

describe('payday', () => {
  it('C16 in player order each company fires any stations, burning exactly; it lights no more cities than it has', () => {
    let s = buildPhase();
    s = fuelled(wired(s, 2, [10, 11]), 2, [1, 1, 0, 0]);
    s = fuelled(wired(own(s, 1, [18]), 1, [3]), 1, [2, 0, 0, 0]);
    s = wired(s, 0, [0]);
    s = skipPhase(s);
    expect(s.phase).toBe('power');
    expect(s.queue).toEqual([2, 1, 0]);
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 2, decision: 'power' });
    expect(legal(s, 2)).toEqual([
      { type: 'power', actor: 2, stations: [], hybridCoal: 0 },
      { type: 'power', actor: 2, stations: [5], hybridCoal: 1 },
    ]);
    // Exact burns: 5 burns two, here one coal and one oil.
    expect(refused(s, { type: 'power', actor: 2, stations: [5], hybridCoal: 2 })).toMatch(/cannot fire/);
    expect(refused(s, { type: 'power', actor: 2, stations: [5], hybridCoal: 0 })).toMatch(/cannot fire/);
    expect(refused(s, { type: 'power', actor: 2, stations: [4], hybridCoal: 0 })).toMatch(/own stations/);
    expect(refused(s, { type: 'power', actor: 1, stations: [], hybridCoal: 0 })).toMatch(/not your decision/);
    // Any stations, none included: firing nothing pays $10 and keeps the fuel.
    const none = step(s, { type: 'power', actor: 2, stations: [], hybridCoal: 0 });
    expect(none.events[0]).toEqual({ type: 'power', kind: 'power', seat: 2, powered: 0, paid: 10 });
    expect(none.state.companies[2]?.fuel).toEqual([1, 1, 0, 0]);
    s = act(s, { type: 'power', actor: 2, stations: [5], hybridCoal: 1 });
    expect(s.companies[2]).toMatchObject({ money: 45 + 22, fuel: [0, 0, 0, 0] });
    // Seat 1: 4 and 18 could light 3 cities, but it has wired one.
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 1, decision: 'power' });
    const r = step(s, { type: 'power', actor: 1, stations: [4, 18], hybridCoal: 0 });
    // Seat 0 has a city but no fuel for 3: it is paid without a decision.
    expect(r.events.filter((e) => e.type === 'power')).toEqual([
      { type: 'power', kind: 'power', seat: 1, powered: 1, paid: 22 },
      { type: 'power', kind: 'power', seat: 0, powered: 0, paid: 10 },
    ]);
    s = r.state;
    expect(s.companies[1]).toMatchObject({ money: 46 + 22, fuel: [0, 0, 0, 0] });
    expect(s.companies[0]?.money).toBe(47 + 10);
    // The burnt fuel went back to the supply: the restock found it there.
    expect(last(s, 'restock')?.added).toEqual([3, 2, 1, 1]);
    // A company with no city is paid $10 without a decision, whatever its fuel.
    let t = fuelled(buildPhase(), 1, [4, 0, 0, 0]);
    t = skipPhase(t);
    expect(t.phase).toBe('power');
    expect(t.history.filter((h) => h.kind === 'power')).toEqual([
      { kind: 'power', seat: 2, powered: 0, paid: 10 },
      { kind: 'power', seat: 1, powered: 0, paid: 10 },
      { kind: 'power', seat: 0, powered: 0, paid: 10 },
    ]);
    expect(t.companies[1]?.fuel).toEqual([4, 0, 0, 0]);
  });

  it('C17 the payday table pays $10 for no city, up to $150 for 20 or more', () => {
    expect(PAYDAY).toEqual([
      10, 22, 33, 44, 54, 64, 73, 82, 90, 98, 105, 112, 118, 124, 129, 134, 138, 142, 145, 148, 150,
    ]);
    expect([0, 1, 10, 19, 20, 21, 30].map(payFor)).toEqual([10, 22, 105, 148, 150, 150, 150]);
    // Two companies: 36, 37, 44 and 50 light 22 cities, the company has wired 20.
    let s = skipPhase(roundOne(2));
    const seat = s.queue[0] as number;
    s = own(s, seat, [36, 37, 44, 50]);
    s = patch(s, {
      companies: s.companies.map((c, i) => (i === seat ? { ...c, stations: [36, 37, 44, 50] } : c)),
      gone: [...s.gone, ...(s.companies[seat]?.stations ?? []).filter((n) => ![36, 37, 44, 50].includes(n))],
      era: 2,
    });
    s = fuelled(
      wired(
        s,
        seat,
        Array.from({ length: 20 }, (_, c) => c),
      ),
      seat,
      [3, 0, 0, 0],
    );
    s = skipPhase(s);
    expect(pendingOf(s)).toEqual({ type: 'player', seat, decision: 'power' });
    const before = s.companies[seat]?.money as number;
    const r = step(s, { type: 'power', actor: seat, stations: [36, 37, 44, 50], hybridCoal: 0 });
    expect(r.events[0]).toEqual({ type: 'power', kind: 'power', seat, powered: 20, paid: 150 });
    expect(r.state.companies[seat]?.money).toBe(before + 150);
  });

  it('C18 the restock follows players and era, takes only the supply, and fills each fuel up to its spaces', () => {
    expect(RESTOCK).toEqual({
      2: [
        [3, 2, 1, 1],
        [4, 2, 2, 1],
        [3, 4, 3, 1],
      ],
      3: [
        [4, 2, 1, 1],
        [5, 3, 2, 1],
        [3, 4, 3, 1],
      ],
      4: [
        [5, 3, 2, 1],
        [6, 4, 3, 2],
        [4, 5, 4, 2],
      ],
      5: [
        [5, 4, 3, 2],
        [7, 5, 3, 3],
        [5, 6, 5, 2],
      ],
      6: [
        [7, 5, 3, 2],
        [9, 6, 5, 3],
        [6, 7, 6, 3],
      ],
    });
    // The opening yard has room for 0 coal, 6 oil, 18 waste and 10 uranium.
    for (const seats of [2, 3, 4, 5, 6])
      for (const era of [1, 2, 3] as const) {
        const s = skipPhase(skipPhase(patch(roundOne(seats), { era })));
        const k = RESTOCK[seats]?.[era - 1] as readonly number[];
        expect(last(s, 'restock')?.added).toEqual([0, Math.min(k[1] as number, 6), k[2], k[3]]);
        expect(s.yard).toEqual([
          24,
          18 + Math.min(k[1] as number, 6),
          6 + (k[2] as number),
          2 + (k[3] as number),
        ]);
      }
    // Only the supply: 20 coal on the yard and 2 on seat 1's station leave 2 to restock, not 4.
    let s = fuelled(patch(buildPhase(), { yard: [20, 18, 6, 2] }), 1, [2, 0, 0, 0]);
    s = skipPhase(s);
    expect(last(s, 'restock')?.added).toEqual([2, 2, 1, 1]);
    expect(s.yard).toEqual([22, 20, 7, 3]);
    // Up to the spaces: uranium has twelve.
    s = skipPhase(patch(buildPhase(), { yard: [24, 18, 6, 11] }));
    expect(last(s, 'restock')?.added).toEqual([0, 2, 1, 1]);
    expect(s.yard[3]).toBe(12);
  });

  it('C19 the market moves on: Eras I and II lay the highest under the stack; Era III takes the lowest away', () => {
    let s = skipPhase(buildPhase());
    expect(s.market).toEqual([6, 7, 8, 9, 10, 11, 12]);
    // 13 goes under the stack with its deck position; the replacement is the next position, turned up.
    expect(s.stack.under).toEqual([{ pos: 0, station: 13 }]);
    expect(last(s, 'under')).toEqual({ kind: 'under', station: 13 });
    expect(pendingOf(s)).toEqual({ type: 'reveal', deck: 'pile', positions: [3] });
    const r = revealStep(s);
    expect(r.events[0]).toEqual({ type: 'drew', kind: 'drew', station: 14 });
    s = r.state;
    expect(s.market).toEqual([6, 7, 8, 9, 10, 11, 12, 14]);
    // A second round lays 14 under 13.
    s = nextRound(s);
    expect(s.stack.under.map((u) => u.station)).toEqual([13, 15]);
    // Era II as well.
    const two = nextRound(patch(nextRound(roundOne(3)), { era: 2 }));
    expect(two.era).toBe(2);
    expect(two.stack.under).toEqual([
      { pos: 0, station: 13 },
      { pos: 4, station: 15 },
    ]);
    // Era III: the lowest leaves the game and a replacement is drawn.
    let t = skipPhase(patch(buildPhase(), { era: 3 }));
    expect(t.gone).toEqual([6]);
    expect(t.market).toEqual([7, 8, 9, 10, 11, 12, 13]);
    t = drawAll(t);
    expect(t.market).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
    expect(t.stack.under).toEqual([]);
  });
});
