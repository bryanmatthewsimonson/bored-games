import { describe, expect, it } from 'vitest';
import { onOffer, pendingOf } from '../../src/engine.ts';
import { capsOf, keepOptions } from '../../src/fuel.ts';
import type { CurrentState } from '../../src/types.ts';
import {
  act,
  deckOrder,
  drawAll,
  foldAll,
  fuelled,
  legal,
  nextRound,
  own,
  patch,
  refused,
  sell,
  started,
  step,
  turnOf,
  withCompany,
} from '../helpers.ts';

/** Round 1: each company in turn buys the lowest station at its number; draws take the lowest unseen. */
function roundOne(seats: number): CurrentState {
  let s = started(seats);
  for (let i = 0; i < seats; i++) s = sell(s, s.market[0] as number);
  return s;
}

const open = (s: CurrentState, station: number, bid = station): CurrentState =>
  act(s, { type: 'open', actor: turnOf(s), station, bid });

describe('the auction', () => {
  it('C03 the four lowest stations are on offer in Eras I and II, and the market stays in number order', () => {
    // The deck: 13 on top, then 11 and 27.
    let s = started(3, null, undefined, deckOrder([11, 27]));
    expect(onOffer(s)).toEqual([3, 4, 5, 6]);
    expect(legal(s, 0)).toEqual([3, 4, 5, 6].map((n) => ({ type: 'open', actor: 0, station: n, bid: n })));
    expect(refused(s, { type: 'open', actor: 0, station: 7, bid: 7 })).toMatch(/not on offer/);
    // 13 is turned up first and joins the market at its place.
    s = sell(s, 3);
    expect(s.market).toEqual([4, 5, 6, 7, 8, 9, 10, 13]);
    expect(onOffer(s)).toEqual([4, 5, 6, 7]);
    // Each station sorts in where it belongs.
    s = sell(s, 4);
    expect(s.market).toEqual([5, 6, 7, 8, 9, 10, 11, 13]);
    s = sell(s, 7);
    expect(s.market).toEqual([5, 6, 8, 9, 10, 11, 13, 27]);
    expect(s.history.filter((h) => h.kind === 'drew')).toEqual([
      { kind: 'drew', station: 13 },
      { kind: 'drew', station: 11 },
      { kind: 'drew', station: 27 },
    ]);
    expect(onOffer(patch(s, { era: 2 }))).toEqual([5, 6, 8, 9]);
    expect(onOffer(patch(s, { era: 3 }))).toEqual(s.market);
  });

  it('C06 openings go in player order, only on offer, at least the number and at most the money; no pass in round 1', () => {
    let s = started(3, null, [2, 1]);
    expect(s.order).toEqual([1, 0, 2]);
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 1, decision: 'open' });
    expect(refused(s, { type: 'open', actor: 0, station: 3, bid: 3 })).toMatch(/not your decision/);
    expect(refused(s, { type: 'pass', actor: 1 })).toMatch(/must buy/);
    expect(legal(s, 1).some((a) => a.type === 'pass')).toBe(false);
    expect(refused(s, { type: 'open', actor: 1, station: 5, bid: 4 })).toMatch(/at least 5/);
    expect(refused(s, { type: 'open', actor: 1, station: 5, bid: 51 })).toMatch(/more than you have/);
    // All its money: nobody can beat it, but each of the others still decides, and can only fold.
    s = open(s, 5, 50);
    expect(s.lot?.turn).toBe(2);
    expect(legal(s, 2)).toEqual([{ type: 'fold', actor: 2 }]);
    s = drawAll(foldAll(s));
    expect(s.companies[1]).toMatchObject({ money: 0, stations: [5] });
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'open' });
    s = sell(sell(s, 3), 4);
    expect(s.phase).toBe('fuel');

    // Round 2: a pass ends the company's auction; it takes no part in the others' lots.
    s = nextRound(s);
    expect(s.order).toEqual([1, 2, 0]);
    expect(legal(s, 1).at(-1)).toEqual({ type: 'pass', actor: 1 });
    s = act(s, { type: 'pass', actor: 1 });
    expect(s.auctionDone).toEqual([false, true, false]);
    expect(turnOf(s)).toBe(2);
    s = open(s, s.market[0] as number);
    expect(s.lot?.active).toEqual([2, 0]);
    s = drawAll(foldAll(s));
    expect(s.lot).toBeNull();
    expect(turnOf(s)).toBe(0);
    s = drawAll(foldAll(open(s, s.market[0] as number)));
    expect(s.phase).toBe('fuel');

    // A company that can afford no station on offer still decides: it passes.
    let t = nextRound(s);
    const [first, second] = t.order as [number, number, number];
    t = withCompany(t, second, (c) => ({ ...c, money: 2 }));
    expect(turnOf(t)).toBe(first);
    t = drawAll(foldAll(open(t, onOffer(t)[0] as number)));
    expect(pendingOf(t)).toEqual({ type: 'player', seat: second, decision: 'open' });
    expect(legal(t, second)).toEqual([{ type: 'pass', actor: second }]);
    expect(refused(t, { type: 'open', actor: second, station: onOffer(t)[0] as number, bid: 2 })).toMatch(
      /at least/,
    );
    t = act(t, { type: 'pass', actor: second });
    expect(t.auctionDone[second]).toBe(true);
    // In round 1 too, where nobody else may pass.
    let u = withCompany(started(3), 0, (c) => ({ ...c, money: 2 }));
    expect(legal(u, 0)).toEqual([{ type: 'pass', actor: 0 }]);
    u = act(u, { type: 'pass', actor: 0 });
    expect(u.auctionDone).toEqual([true, false, false]);
    expect(refused(u, { type: 'pass', actor: 1 })).toMatch(/must buy/);
  });

  it('C07 bids go clockwise from the opener, each beating the last; a fold leaves that lot; the last one in pays', () => {
    let s = nextRound(roundOne(4));
    expect(s.round).toBe(2);
    expect(s.order).toEqual([3, 2, 1, 0]);
    expect(s.companies.map((c) => c.money)).toEqual([57, 56, 55, 54]);
    expect(onOffer(s)).toEqual([7, 8, 9, 10]);
    s = open(s, 7);
    // Clockwise round the table from seat 3: seats 0, 1 and 2, not the player order.
    expect(s.lot).toEqual({ station: 7, bid: 7, leader: 3, opener: 3, active: [3, 0, 1, 2], turn: 0 });
    expect(refused(s, { type: 'bid', actor: 1, amount: 9 })).toMatch(/not your decision/);
    expect(refused(s, { type: 'bid', actor: 0, amount: 7 })).toMatch(/beat 7/);
    expect(refused(s, { type: 'bid', actor: 0, amount: 58 })).toMatch(/more than you have/);
    expect(legal(s, 0)).toEqual([
      { type: 'bid', actor: 0, amount: 8 },
      { type: 'bid', actor: 0, amount: 12 },
      { type: 'bid', actor: 0, amount: 17 },
      { type: 'fold', actor: 0 },
    ]);
    s = act(s, { type: 'bid', actor: 0, amount: 8 });
    expect(s.lot?.turn).toBe(1);
    s = act(s, { type: 'fold', actor: 1 });
    expect(s.lot).toMatchObject({ active: [3, 0, 2], turn: 2 });
    s = act(s, { type: 'bid', actor: 2, amount: 9 });
    expect(s.lot).toMatchObject({ leader: 2, turn: 3 });
    s = act(s, { type: 'bid', actor: 3, amount: 10 });
    s = act(s, { type: 'bid', actor: 0, amount: 12 });
    // Seat 1 folded out of this lot only: seat 2 is next.
    expect(s.lot?.turn).toBe(2);
    s = act(s, { type: 'fold', actor: 2 });
    const r = step(s, { type: 'fold', actor: 3 });
    expect(r.events[0]).toEqual({ type: 'won', kind: 'won', seat: 0, station: 7, price: 12 });
    s = drawAll(r.state);
    expect(s.companies[0]).toMatchObject({ money: 45, stations: [3, 7] });

    // A bidder who cannot beat the bid still decides, and can only fold.
    s = drawAll(foldAll(open(s, 8)));
    expect(s.companies[3]?.stations).toEqual([6, 8]);
    expect(turnOf(s)).toBe(2);
    s = withCompany(s, 1, (c) => ({ ...c, money: 30 }));
    s = open(s, 9, 30);
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 1, decision: 'bid' });
    expect(legal(s, 1)).toEqual([{ type: 'fold', actor: 1 }]);
    expect(refused(s, { type: 'bid', actor: 1, amount: 31 })).toMatch(/more than you have/);
    const broke = step(s, { type: 'fold', actor: 1 });
    expect(broke.events[0]).toEqual({ type: 'won', kind: 'won', seat: 2, station: 9, price: 30 });
    s = drawAll(broke.state);
    // The last company to put a station up takes it at its opening bid.
    expect(turnOf(s)).toBe(1);
    const last = step(s, { type: 'open', actor: 1, station: 10, bid: 10 });
    expect(last.events[0]).toEqual({ type: 'won', kind: 'won', seat: 1, station: 10, price: 10 });
    expect(drawAll(last.state).phase).toBe('fuel');
  });

  it('C08 a buyer is done, an outbid opener opens again, a sale is replaced, an unsold round loses its lowest', () => {
    let s = nextRound(roundOne(4));
    s = open(s, 7);
    s = act(s, { type: 'bid', actor: 0, amount: 8 });
    s = foldAll(s);
    // The replacement is the stack's next position, turned up in public.
    const pos = s.stack.next[0];
    expect(pendingOf(s)).toEqual({ type: 'reveal', deck: 'pile', positions: [s.reveal] });
    expect(s.dealt.at(-1)).toEqual({ deck: 'pile', pos: s.reveal, to: null });
    expect(s.reveal).toBe(5);
    expect(pos).toBe(6);
    s = drawAll(s);
    expect(s.market).toEqual([8, 9, 10, 11, 12, 13, 15, 16]);
    expect(s.auctionDone).toEqual([true, false, false, false]);
    // Seat 3 was outbid: it opens again. Seat 0 bought and is out of every later lot.
    expect(turnOf(s)).toBe(3);
    s = open(s, 8);
    expect(s.lot?.active).toEqual([3, 1, 2]);
    s = drawAll(foldAll(s));
    expect(s.sold).toBe(2);
    expect(turnOf(s)).toBe(2);

    // Round 2 on, a round with no sale loses its lowest station at the end of the auction, and it is replaced.
    let u = nextRound(roundOne(3));
    expect(u.market).toEqual([6, 7, 8, 9, 10, 11, 12, 14]);
    for (const seat of u.order) u = act(u, { type: 'pass', actor: seat });
    expect(pendingOf(u).type).toBe('reveal');
    expect(u.market).toEqual([7, 8, 9, 10, 11, 12, 14]);
    expect(u.gone).toEqual([6]);
    u = drawAll(u);
    expect(u.market).toEqual([7, 8, 9, 10, 11, 12, 14, 15]);
    expect(u.phase).toBe('fuel');
    // With a sale, nothing else leaves.
    let w = nextRound(roundOne(3));
    w = drawAll(foldAll(open(w, 9)));
    for (const seat of w.order.filter((x) => !w.auctionDone[x])) w = act(w, { type: 'pass', actor: seat });
    expect(w.phase).toBe('fuel');
    expect(w.gone).toEqual([]);
  });

  it('C09 over the limit, the buyer scraps one of its other stations; kept fuel must fit, and it may drop more', () => {
    // Seat 2 owns 5 (coal or oil), 13 (green) and 19 (waste), with 2 coal, 2 oil and 3 waste.
    let s = nextRound(roundOne(3));
    expect(s.order[0]).toBe(2);
    s = own(s, 2, [13, 19]);
    s = fuelled(s, 2, [2, 2, 3, 0]);
    expect(s.companies[2]?.stations).toEqual([5, 13, 19]);
    // It buys 8 (coal, stores 6): a fourth station.
    s = foldAll(open(s, 8));
    expect(s.scrapping).toEqual({ seat: 2, bought: 8 });
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 2, decision: 'scrap' });
    expect(s.companies[2]?.stations).toEqual([5, 8, 13, 19]);
    // Never the new one; the kept fuel must be held and fit the stations left.
    expect(refused(s, { type: 'scrap', actor: 2, station: 8, keep: [2, 2, 3, 0] })).toMatch(/other stations/);
    expect(refused(s, { type: 'scrap', actor: 2, station: 9, keep: [2, 2, 3, 0] })).toMatch(/other stations/);
    expect(refused(s, { type: 'scrap', actor: 2, station: 5, keep: [2, 2, 3, 0] })).toMatch(/can hold/);
    expect(refused(s, { type: 'scrap', actor: 2, station: 5, keep: [3, 0, 3, 0] })).toMatch(/can hold/);
    expect(refused(s, { type: 'scrap', actor: 2, station: 19, keep: [2, 2, 1, 0] })).toMatch(/can hold/);
    // The list offers the fullest keep for each station: the coal moves to 8, the oil has nowhere to go.
    expect(legal(s, 2)).toEqual([
      { type: 'scrap', actor: 2, station: 5, keep: [2, 0, 3, 0] },
      { type: 'scrap', actor: 2, station: 13, keep: [2, 2, 3, 0] },
      { type: 'scrap', actor: 2, station: 19, keep: [2, 2, 0, 0] },
    ]);
    // Where coal and oil share a coal-or-oil station, each fullest split is offered.
    expect(keepOptions([3, 3, 0, 0], capsOf([5]))).toEqual([
      [1, 3, 0, 0],
      [2, 2, 0, 0],
      [3, 1, 0, 0],
    ]);
    // It may drop more than it must.
    const r = step(s, { type: 'scrap', actor: 2, station: 5, keep: [1, 0, 3, 0] });
    expect(r.events[0]).toEqual({ type: 'scrap', kind: 'scrap', seat: 2, station: 5, lost: [1, 2, 0, 0] });
    s = r.state;
    expect(s.companies[2]).toMatchObject({ stations: [8, 13, 19], fuel: [1, 0, 3, 0] });
    expect(s.gone).toContain(5);
    expect(s.scrapping).toBeNull();
    s = drawAll(s);
    expect(s.market).toHaveLength(8);
    expect(turnOf(s)).toBe(1);

    // With two players the limit is four: a fourth station is kept, a fifth makes its buyer scrap.
    let t = nextRound(roundOne(2));
    const first = t.order[0] as number;
    t = own(t, first, [13, 19]);
    t = drawAll(foldAll(open(t, onOffer(t)[0] as number)));
    expect(t.companies[first]?.stations).toHaveLength(4);
    expect(t.scrapping).toBeNull();
    t = nextRound(drawAll(foldAll(open(t, onOffer(t)[0] as number))));
    const buyer = t.order.find((x) => t.companies[x]?.stations.length === 4) as number;
    while (turnOf(t) !== buyer) t = act(t, { type: 'pass', actor: turnOf(t) });
    t = foldAll(open(t, onOffer(t)[0] as number));
    expect(t.scrapping?.seat).toBe(buyer);
  });
});
