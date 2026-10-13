import { describe, expect, it } from 'vitest';
import { STACK_STATIONS } from '../../src/data.ts';
import { buildCost, legalActions, onOffer } from '../../src/engine.ts';
import type { CurrentState, Entry, Stack } from '../../src/types.ts';
import {
  act,
  done,
  drawAll,
  foldAll,
  nextRound,
  patch,
  rollStep,
  sell,
  skipPhase,
  started,
  step,
  turnOf,
  wired,
  withCompany,
} from '../helpers.ts';

function roundOne(seats: number): CurrentState {
  let s = started(seats);
  for (let i = 0; i < seats; i++) s = sell(s, s.market[0] as number);
  return s;
}

/** Round 1's wiring with three companies: seats 0, 1, 2 own 3, 4, 5; the order is 2, 1, 0; the market 6–13. */
const buildPhase = (): CurrentState => skipPhase(roundOne(3));

/** The next draw is the Era III card; `under` (taken from the unseen stations) lies beneath it. */
function eraCardNext(s: CurrentState, under: readonly number[]): CurrentState {
  const stack: Stack = {
    ...s.stack,
    top: [],
    pool: s.stack.pool.filter((n) => !under.includes(n)),
    draws: 0,
    eraCard: true,
    under: [...s.stack.under, ...under],
  };
  return patch(s, { stack });
}

const kinds = (h: readonly Entry[]): string[] => h.map((e) => (e.kind === 'era' ? `era${e.era}` : e.kind));

describe('the eras', () => {
  it('C20 Era II follows the wiring in which a company reaches its count: the lowest leaves once, two a city, its restock', () => {
    let s = withCompany(wired(buildPhase(), 0, [0, 1, 2, 3, 4, 5]), 0, (c) => ({ ...c, money: 100 }));
    // The seventh city (Era II at 7 with three companies); 6 and 7 are small now and leave.
    s = drawAll(act(s, { type: 'build', actor: 0, city: 6 }));
    expect(s.market).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    s = done(s);
    // Still Era I while this wiring lasts: seat 1 cannot join seat 0 in a city.
    expect(s.era).toBe(1);
    expect(buildCost(s, 1, 0)).toBeNull();
    s = drawAll(skipPhase(s));
    expect(s.era).toBe(2);
    const h = kinds(s.history);
    const era = h.lastIndexOf('era2');
    expect(h.slice(era, era + 3)).toEqual(['era2', 'removed', 'drew']);
    expect(s.history[era + 1]).toEqual({ kind: 'removed', station: 8 });
    // The Era II restock (three companies: 5, 3, 2, 1; coal is full).
    expect(s.history.find((e) => e.kind === 'restock')).toEqual({ kind: 'restock', added: [0, 3, 2, 1] });
    // From now on two companies a city.
    expect(s.round).toBe(2);
    expect(buildCost(s, 1, 0)).toBe(15);
    // Once only: the next wiring removes nothing more for Era II.
    const gone = s.gone.length;
    s = nextRound(s);
    // Round 2's unsold auction took one station; nothing else left.
    expect(s.gone.length).toBe(gone + 1);
    expect(s.era).toBe(2);
  });

  it('C21 the Era III card: shuffled at once; in an auction it waits at the end; while wiring or at payday it goes at once', () => {
    // In an auction: it lies at the end of the market, cannot be bought, and replacements go on.
    let a = eraCardNext(nextRound(roundOne(3)), [50]);
    const unseen = a.stack.pool;
    expect(a.stack.under).toEqual([13, 50]);
    expect(a.market).toEqual([6, 7, 8, 9, 10, 11, 12, 14]);
    expect(turnOf(a)).toBe(2);
    a = act(act(a, { type: 'open', actor: 2, station: 6, bid: 6 }), { type: 'fold', actor: 0 });
    const sale = step(a, { type: 'fold', actor: 1 });
    expect(kinds(sale.state.history).slice(-2)).toEqual(['won', 'shuffled']);
    expect(sale.events.at(-1)).toEqual({ type: 'shuffled', kind: 'shuffled', cards: 2 });
    a = sale.state;
    expect(a.eraCardShown).toBe(true);
    expect(a.era).toBe(1);
    expect(a.market).toEqual([7, 8, 9, 10, 11, 12, 14]);
    expect(onOffer(a)).toEqual([7, 8, 9, 10]);
    expect(a.stack).toMatchObject({ pool: [13, 50], draws: 2, eraCard: false, under: [], shuffled: true });
    expect(a.stack.boxed).toEqual(unseen);
    expect(a.roll).toBeNull();
    // The next sale is replaced from the shuffled stack, by a roll of two faces.
    a = act(a, { type: 'open', actor: 1, station: 7, bid: 7 });
    a = act(a, { type: 'fold', actor: 0 });
    expect(a.roll).toMatchObject({ purpose: 'draw', sides: 2 });
    a = rollStep(a, [2]).state;
    expect(a.market).toEqual([8, 9, 10, 11, 12, 14, 50]);
    expect(a.eraCardShown).toBe(true);
    // The last one: 13, the only card left, comes without a roll. After the auction the card leaves with the lowest.
    const end = step(a, { type: 'open', actor: 0, station: 8, bid: 8 });
    expect(end.state.roll).toBeNull();
    expect(kinds(end.state.history).slice(-4)).toEqual(['won', 'drew', 'removed', 'era3']);
    a = end.state;
    expect(a.market).toEqual([10, 11, 12, 13, 14, 50]);
    expect(a.gone).toEqual([9]);
    expect([a.era, a.phase, a.eraCardShown]).toEqual([3, 'fuel', false]);

    // While wiring: a small station's replacement is the card; it leaves at once with the lowest, unreplaced.
    let w = eraCardNext(buildPhase(), [50]);
    w = withCompany(wired(w, 0, [0, 1, 2, 3, 4]), 0, (c) => ({ ...c, money: 100 }));
    const built = step(w, { type: 'build', actor: 0, city: 5 });
    expect(built.events.map((e) => e.type)).toEqual(['built', 'removed', 'removed', 'shuffled']);
    w = built.state;
    expect(w.market).toEqual([8, 9, 10, 11, 12, 13]);
    expect(w.gone).toEqual([6, 7]);
    expect([w.era, w.eraNext, w.roll]).toEqual([1, true, null]);
    // Era III begins with payday: its restock, and the lowest leaves at the end of it.
    w = skipPhase(w);
    expect(w.era).toBe(3);
    expect(w.history.find((e) => e.kind === 'restock')).toEqual({ kind: 'restock', added: [0, 4, 3, 1] });
    expect(w.gone).toEqual([6, 7, 8]);
    // 50, the only card in the shuffled stack, replaces it without a roll.
    expect(w.market).toEqual([9, 10, 11, 12, 13, 50]);
    expect([w.round, w.phase]).toEqual([2, 'auction']);

    // At payday: the highest goes under, the card comes up, and it leaves with the lowest; Era III from the next round.
    let p = eraCardNext(buildPhase(), [50]);
    const pay = step(p, { type: 'done', actor: 0 });
    p = skipPhase(pay.state);
    expect(kinds(p.history).slice(-10)).toEqual([
      'power',
      'power',
      'power',
      'restock',
      'under',
      'removed',
      'shuffled',
      'era3',
      'round',
      'order',
    ]);
    expect(p.history.find((e) => e.kind === 'restock')).toEqual({ kind: 'restock', added: [0, 2, 1, 1] });
    expect(p.market).toEqual([7, 8, 9, 10, 11, 12]);
    expect(p.stack).toMatchObject({ pool: [13, 50], draws: 2, under: [], shuffled: true });
    expect([p.era, p.round, p.phase]).toEqual([3, 2, 'auction']);
  });

  it('C22 Era III: three companies a city, six stations all on offer, payday takes the lowest, an empty stack shrinks the market', () => {
    let s = skipPhase(eraCardNext(buildPhase(), [50]));
    expect(s.era).toBe(3);
    expect(onOffer(s)).toEqual([7, 8, 9, 10, 11, 12]);
    const first = turnOf(s);
    expect(legalActions(s, first).filter((a) => a.type === 'open')).toHaveLength(6);
    s = drawAll(foldAll(act(s, { type: 'open', actor: first, station: 12, bid: 12 })));
    expect(s.market).toHaveLength(6);
    // Three a city.
    let t = wired(wired(s, 0, [0]), 1, [0]);
    expect(buildCost(t, 2, 0)).toBe(20);
    t = wired(t, 2, [0]);
    expect(t.houses[0]).toEqual([0, 1, 2]);
    // Payday: the lowest leaves and a replacement is drawn; with the stack empty, none is.
    let e = skipPhase(eraCardNext(buildPhase(), []));
    expect(e.era).toBe(3);
    expect(e.market).toEqual([7, 8, 9, 10, 11, 12]);
    // 13, laid under at this payday, is the only card left; take it out to empty the stack.
    expect(e.stack).toMatchObject({ pool: [13], draws: 1, eraCard: false, shuffled: true });
    e = patch(e, { stack: { ...e.stack, pool: [], draws: 0 }, gone: [...e.gone, 13] });
    // Each round now loses its lowest at payday (and here, unsold, at the end of the auction), unreplaced.
    e = nextRound(e);
    expect(e.market).toEqual([9, 10, 11, 12]);
    expect(e.history.filter((h) => h.kind === 'drew').slice(-2)).toEqual([
      { kind: 'drew', station: null },
      { kind: 'drew', station: null },
    ]);
    e = nextRound(nextRound(e));
    expect(e.market).toEqual([]);
    // Nothing on offer: every company passes without a decision, and the rounds go on.
    const round = e.round;
    e = nextRound(e);
    expect([e.market, e.era, e.round]).toEqual([[], 3, round + 1]);
    expect(
      e.history
        .filter((h) => h.kind === 'pass')
        .slice(-3)
        .map((h) => h.kind),
    ).toEqual(['pass', 'pass', 'pass']);
    // Era III before Era II (OPEN, the engine skips Era II): seven cities in Era III bring no Era II.
    let skip = withCompany(wired(skipPhase(roundOne(3)), 0, [0, 1, 2, 3, 4, 5, 6]), 0, (c) => ({
      ...c,
      money: 100,
    }));
    skip = patch(skip, { era: 3 });
    skip = skipPhase(skip);
    expect(skip.era).toBe(3);
    expect(skip.history.some((h) => h.kind === 'era' && h.era === 2)).toBe(false);
  });

  it('C23 an unknown station comes by a roll with one face per station unseen; known cards come without dice', () => {
    // 13 comes first, without a roll.
    let s = act(started(3), { type: 'open', actor: 0, station: 3, bid: 3 });
    s = act(act(s, { type: 'fold', actor: 1 }), { type: 'fold', actor: 2 });
    expect(s.roll).toBeNull();
    expect(s.market).toContain(13);
    // Then each draw rolls one die with a face per station still unseen (33: those taken out unseen too).
    s = act(s, { type: 'open', actor: 1, station: 4, bid: 4 });
    s = act(s, { type: 'fold', actor: 2 });
    expect(s.roll).toEqual({ id: 2, purpose: 'draw', count: 1, sides: 33 });
    const drawn = Array.from({ length: 33 }, (_, f) => rollStep(s, [f + 1]).events[0]);
    expect(drawn.map((e) => (e?.type === 'drew' ? e.station : null))).toEqual(s.stack.pool);
    expect(rollStep(s, [7]).state.stack).toMatchObject({
      draws: 24,
      pool: s.stack.pool.filter((_, i) => i !== 6),
    });
    // Every seat adds a share: the one after the last actor first, the actor last.
    expect(s.contributors).toEqual([2, 0, 1]);
    // The stations taken out unseen are never drawn: after the last draw comes the Era III card.
    let t = sell(sell(sell(started(3), 3), 4), 5);
    // Put the game at its last unknown draw: nine stations unseen, eight of them taken out at setup.
    const seen = t.stack.pool.slice(0, -9);
    t = patch(t, {
      stack: { ...t.stack, pool: t.stack.pool.slice(-9), draws: 1 },
      gone: [...t.gone, ...seen],
    });
    t = skipPhase(skipPhase(t));
    expect(t.roll).toMatchObject({ purpose: 'draw', sides: t.stack.pool.length });
    const left = t.stack.pool.length;
    t = rollStep(t, [1]).state;
    expect(t.stack.draws).toBe(0);
    expect(t.stack.pool).toHaveLength(left - 1);
    // A sale in round 2 draws the card itself, without dice; the unseen stations are boxed, never seen in play.
    const boxed = t.stack.pool;
    const r = step(t, {
      type: 'open',
      actor: turnOf(t),
      station: t.market[0] as number,
      bid: t.market[0] as number,
    });
    const u = foldAll(r.state);
    expect(u.stack.boxed).toEqual(boxed);
    expect(u.stack.boxed).toHaveLength(8);
    expect(u.eraCardShown).toBe(true);
    // With five companies no station is taken out: the last unseen one comes without dice.
    let five = started(5);
    const only = five.stack.pool.at(-1) as number;
    five = patch(five, {
      stack: { ...five.stack, top: [], pool: [only], draws: 1 },
      gone: [13, ...STACK_STATIONS.filter((n) => n !== only)],
    });
    const one = step(five, { type: 'open', actor: 0, station: 3, bid: 3 });
    const v = foldAll(one.state);
    expect(v.roll).toBeNull();
    expect(v.market).toContain(only);
  });
});
