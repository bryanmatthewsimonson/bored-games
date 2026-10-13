import { describe, expect, it } from 'vitest';
import {
  buildCost,
  installDeckOrder,
  legalActions,
  onOffer,
  pendingOf,
  shufflePlaintexts,
} from '../../src/engine.ts';
import { currentAffairs } from '../../src/module.ts';
import type { CurrentState, Entry } from '../../src/types.ts';
import {
  act,
  cardOf,
  deckOrder,
  done,
  drawAll,
  epochStep,
  eraCardNext,
  foldAll,
  layUnder,
  nextRound,
  patch,
  refused,
  revealStep,
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
    let a = eraCardNext(layUnder(nextRound(roundOne(3)), [50]));
    expect(a.stack.under).toEqual([
      { pos: 0, station: 13 },
      { pos: 33, station: 50 },
    ]);
    expect(a.market).toEqual([6, 7, 8, 9, 10, 11, 12, 14]);
    expect(turnOf(a)).toBe(2);
    a = act(act(a, { type: 'open', actor: 2, station: 6, bid: 6 }), { type: 'fold', actor: 0 });
    a = act(a, { type: 'fold', actor: 1 });
    expect(a.eraCardShown).toBe(true);
    expect(a.era).toBe(1);
    expect(a.market).toEqual([7, 8, 9, 10, 11, 12, 14]);
    // The stations under the stack are reshuffled at once: a deck epoch of their positions.
    expect(pendingOf(a)).toEqual({
      type: 'shuffle',
      deck: 'pile',
      epoch: 1,
      from: [
        { deck: 'pile', pos: 0 },
        { deck: 'pile', pos: 33 },
      ],
    });
    expect(shufflePlaintexts(a)).toEqual([cardOf(13), cardOf(50)]);
    const ep = epochStep(a, [cardOf(50), cardOf(13)]);
    expect(ep.events).toEqual([{ type: 'shuffled', kind: 'shuffled', cards: 2 }]);
    a = ep.state;
    expect(a.stack).toMatchObject({ next: [128, 129], under: [], shuffling: false, shuffled: true });
    expect(onOffer(a)).toEqual([7, 8, 9, 10]);
    expect(turnOf(a)).toBe(1);
    // The next sale is replaced from the reshuffled stack's first position.
    a = act(act(a, { type: 'open', actor: 1, station: 7, bid: 7 }), { type: 'fold', actor: 0 });
    expect(pendingOf(a)).toEqual({ type: 'reveal', deck: 'pile', positions: [128] });
    a = revealStep(a).state;
    expect(a.market).toEqual([8, 9, 10, 11, 12, 14, 50]);
    expect(a.eraCardShown).toBe(true);
    // After the auction the card leaves with the lowest station, unreplaced; Era III begins with the fuel phase.
    a = act(a, { type: 'open', actor: 0, station: 8, bid: 8 });
    const end = revealStep(a);
    expect(kinds(end.state.history).slice(-4)).toEqual(['won', 'drew', 'removed', 'era3']);
    a = end.state;
    expect(a.market).toEqual([10, 11, 12, 13, 14, 50]);
    expect(a.gone).toEqual([9]);
    expect([a.era, a.phase, a.eraCardShown]).toEqual([3, 'fuel', false]);

    // While wiring: a small station's replacement is the card; it leaves at once with the lowest, unreplaced.
    let w = eraCardNext(layUnder(buildPhase(), [50]));
    w = withCompany(wired(w, 0, [0, 1, 2, 3, 4]), 0, (c) => ({ ...c, money: 100 }));
    const built = step(w, { type: 'build', actor: 0, city: 5 });
    expect(built.events.map((e) => e.type)).toEqual(['built', 'removed', 'removed']);
    w = built.state;
    expect(pendingOf(w)).toMatchObject({ type: 'shuffle', epoch: 1, from: [{ deck: 'pile', pos: 33 }] });
    w = epochStep(w).state;
    expect(w.market).toEqual([8, 9, 10, 11, 12, 13]);
    expect(w.gone).toEqual([6, 7]);
    expect([w.era, w.eraNext, turnOf(w)]).toEqual([1, true, 0]);
    // Era III begins with payday: its restock, and the lowest leaves at the end of it, replaced from position 128.
    w = skipPhase(w);
    expect(w.era).toBe(3);
    expect(w.history.find((e) => e.kind === 'restock')).toEqual({ kind: 'restock', added: [0, 4, 3, 1] });
    expect(pendingOf(w)).toEqual({ type: 'reveal', deck: 'pile', positions: [128] });
    w = drawAll(w);
    expect(w.gone).toEqual([6, 7, 8]);
    expect(w.market).toEqual([9, 10, 11, 12, 13, 50]);
    expect([w.round, w.phase]).toEqual([2, 'auction']);

    // At payday: the highest goes under, the card comes up, and it leaves with the lowest; Era III from then.
    let p = eraCardNext(layUnder(buildPhase(), [50]));
    p = skipPhase(p);
    expect(kinds(p.history).slice(-7)).toEqual([
      'power',
      'power',
      'power',
      'restock',
      'under',
      'removed',
      'era3',
    ]);
    expect(p.history.find((e) => e.kind === 'restock')).toEqual({ kind: 'restock', added: [0, 2, 1, 1] });
    expect(pendingOf(p)).toMatchObject({
      type: 'shuffle',
      from: [
        { deck: 'pile', pos: 33 },
        { deck: 'pile', pos: 0 },
      ],
    });
    p = epochStep(p).state;
    expect(p.market).toEqual([7, 8, 9, 10, 11, 12]);
    expect(p.stack).toMatchObject({ next: [128, 129], under: [], shuffled: true });
    expect([p.era, p.round, p.phase]).toEqual([3, 2, 'auction']);

    // With nothing under the stack (round 1's wiring) there is nothing to reshuffle: no epoch.
    let n = withCompany(wired(eraCardNext(buildPhase()), 0, [0, 1, 2, 3, 4]), 0, (c) => ({
      ...c,
      money: 100,
    }));
    const none = step(n, { type: 'build', actor: 0, city: 5 });
    expect(none.events.map((e) => e.type)).toEqual(['built', 'removed', 'removed', 'shuffled']);
    expect(none.events.at(-1)).toEqual({ type: 'shuffled', kind: 'shuffled', cards: 0 });
    n = none.state;
    expect(pendingOf(n)).toEqual({ type: 'player', seat: 0, decision: 'build' });
    expect(n.stack).toMatchObject({ next: [], under: [], shuffling: false, shuffled: true });
    expect(n.eraNext).toBe(true);
  });

  it('C22 Era III: three companies a city, six stations all on offer, payday takes the lowest, an empty stack shrinks the market', () => {
    let s = epochStep(skipPhase(eraCardNext(layUnder(buildPhase(), [50])))).state;
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
    // An empty stack: Era III came in round 1's wiring with nothing under the stack.
    let e = withCompany(wired(eraCardNext(buildPhase()), 0, [0, 1, 2, 3, 4]), 0, (c) => ({
      ...c,
      money: 100,
    }));
    e = skipPhase(act(e, { type: 'build', actor: 0, city: 5 }));
    // Payday took the lowest away, and nothing replaced it.
    expect([e.era, e.round]).toEqual([3, 2]);
    expect(e.market).toEqual([9, 10, 11, 12, 13]);
    expect(e.history.filter((h) => h.kind === 'drew').at(-1)).toEqual({ kind: 'drew', station: null });
    // Each round now loses its lowest at payday (and here, unsold, at the end of the auction), unreplaced.
    e = nextRound(e);
    expect(e.market).toEqual([11, 12, 13]);
    e = nextRound(nextRound(e));
    expect(e.market).toEqual([]);
    // Nothing on offer: every company passes, and the rounds go on.
    const round = e.round;
    expect(legalActions(e, turnOf(e))).toEqual([{ type: 'pass', actor: turnOf(e) }]);
    e = nextRound(e);
    expect([e.market, e.era, e.round]).toEqual([[], 3, round + 1]);
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

  it('C23 the stack is the deck: 13 on top, then each position turned up in turn; the last positions never; then the Era III reshuffle', () => {
    // 13 is position 0, turned up first; then position 1, here 27 by the order.
    let s = started(3, null, undefined, deckOrder([27]));
    s = act(s, { type: 'open', actor: 0, station: 3, bid: 3 });
    s = act(act(s, { type: 'fold', actor: 1 }), { type: 'fold', actor: 2 });
    expect(pendingOf(s)).toEqual({ type: 'reveal', deck: 'pile', positions: [0] });
    expect(s.dealt).toEqual([{ deck: 'pile', pos: 0, to: null }]);
    expect(legalActions(s, 0)).toEqual([]);
    // Only the station at that position, and only at that position.
    expect(refused(s, { type: 'reveal', actor: 'deck', deck: 'pile', pos: 0, card: cardOf(27) })).toMatch(
      /not the station/,
    );
    expect(refused(s, { type: 'reveal', actor: 'deck', deck: 'pile', pos: 1, card: cardOf(27) })).toMatch(
      /not being turned up/,
    );
    expect(refused(s, { type: 'open', actor: 1, station: 4, bid: 4 })).toMatch(/not your decision/);
    const r = revealStep(s);
    expect(r.events).toEqual([{ type: 'drew', kind: 'drew', station: 13 }]);
    s = sell(r.state, 4);
    expect(s.market).toContain(27);
    expect(s.dealt).toEqual([
      { deck: 'pile', pos: 0, to: null },
      { deck: 'pile', pos: 1, to: null },
    ]);
    expect(refused(s, { type: 'reveal', actor: 'deck', deck: 'pile', pos: 2, card: 2 })).toMatch(/No reveal/);
    // A view does not know the order: it takes whatever the reveal shows, once.
    const v = currentAffairs.view(act(s, { type: 'open', actor: 2, station: 5, bid: 5 }), 0);
    expect(v.plain).toBeNull();
    expect(pendingOf(v)).toEqual({ type: 'reveal', deck: 'pile', positions: [2] });
    const shown = currentAffairs.apply(v, {
      type: 'reveal',
      actor: 'deck',
      deck: 'pile',
      pos: 2,
      card: cardOf(44),
    });
    expect(shown.ok && shown.state.market.includes(44)).toBe(true);
    expect(currentAffairs.apply(v, { type: 'reveal', actor: 'deck', deck: 'pile', pos: 2, card: 0 }).ok).toBe(
      false,
    );

    // The last 8 positions (three companies) are never drawn: after position 25 comes the Era III card.
    let t = nextRound(sell(s, 5));
    expect(t.stack.out).toEqual([26, 27, 28, 29, 30, 31, 32, 33]);
    const out = t.stack.out;
    t = patch(t, { stack: { ...t.stack, next: [25], out: [...t.stack.next.slice(0, -1), ...out] } });
    t = act(t, {
      type: 'open',
      actor: turnOf(t),
      station: t.market[0] as number,
      bid: t.market[0] as number,
    });
    t = revealStep(foldAll(t)).state;
    expect(t.dealt.at(-1)).toEqual({ deck: 'pile', pos: 25, to: null });
    t = act(t, {
      type: 'open',
      actor: turnOf(t),
      station: t.market[0] as number,
      bid: t.market[0] as number,
    });
    t = foldAll(t);
    expect(t.eraCardShown).toBe(true);
    expect(pendingOf(t).type).toBe('shuffle');
    expect(t.dealt.some((d) => out.includes(d.pos))).toBe(false);
    // The reshuffle: installed in full mode only, as a shuffle of exactly the stations under the stack.
    const under = shufflePlaintexts(t);
    expect(under).toEqual(t.stack.under.map((u) => cardOf(u.station)));
    expect(installDeckOrder(currentAffairs.view(t, 0), 1, under).ok).toBe(false);
    expect(installDeckOrder(t, 1, [...under, 0]).ok).toBe(false);
    expect(installDeckOrder(t, 2, under).ok).toBe(false);
    expect(refused(t, { type: 'epoch', actor: 'deck', epoch: 1, size: under.length })).toMatch(
      /not installed/,
    );
    const installed = installDeckOrder(t, 1, [...under].reverse());
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    expect(installed.events).toEqual([]);
    expect(
      refused(installed.state, { type: 'epoch', actor: 'deck', epoch: 1, size: under.length + 1 }),
    ).toMatch(/not the pending reshuffle/);
    expect(refused(installed.state, { type: 'epoch', actor: 'deck', epoch: 2, size: under.length })).toMatch(
      /not the pending reshuffle/,
    );
    t = epochStep(t, [...under].reverse()).state;
    // Its new positions are turned up in order: 128, 129, …
    expect(t.stack.next).toEqual(under.map((_, i) => 128 + i));
  });
});
