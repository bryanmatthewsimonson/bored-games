import { deepFreeze } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import type { HazardState } from '../../src/types.ts';
import {
  act,
  attacking,
  lastStand,
  legalActions,
  opened,
  pendingOf,
  refused,
  revealCash,
  takeA2,
  withHand,
} from '../helpers.ts';

/** `s` with seat 1's hand turned into cards it never learned, as in the conqueror's view before the seal opens. */
const unlearned = (s: HazardState, seat: number): HazardState =>
  deepFreeze({ ...s, hands: s.hands.map((h, i) => (i === seat ? h.map((x) => ({ ...x, card: null })) : h)) });

describe('elimination, victory and the end of a turn', () => {
  it('C24 wiping a seat off the map hands its charters to the conqueror, privately', () => {
    const s = withHand(lastStand(), 1, [10, 11]);
    const { state: t, events } = takeA2(s);
    expect(t.out).toEqual([1]);
    expect(events).toContainEqual({ type: 'eliminated', seat: 1, by: 0, charters: 2 });
    expect(t.hands[1]).toEqual([]);
    expect(t.hands[0]).toEqual([
      { pos: 10, card: 10, holders: [1, 0] },
      { pos: 11, card: 11, holders: [1, 0] },
    ]);
    expect(t.dealt.slice(-2)).toEqual([
      { deck: 'pile', pos: 10, to: 0 },
      { deck: 'pile', pos: 11, to: 0 },
    ]);
    expect(t.stage).toBe('attack');
  });

  it('C25 six or more charters after a conquest: cash at once down to four or fewer, place, attack on', () => {
    const s = withHand(withHand(lastStand(), 0, [0, 3, 6, 1]), 1, [9, 12, 15]);
    const t = takeA2(s).state;
    expect(t.hands[0]).toHaveLength(7);
    expect(t.stage).toBe('muster');
    expect(t.midTurn).toBe(true);
    const legal = legalActions(t, 0);
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((a) => a.type === 'cash')).toBe(true);
    const cashed = revealCash(act(t, { type: 'cash', actor: 0, positions: [0, 3, 6], bonus: 'a1' })).state;
    expect(cashed.hands[0]).toHaveLength(4);
    // Four left: cashing stops, though 9, 12, 15 is a set.
    expect(legalActions(cashed, 0).some((a) => a.type === 'cash')).toBe(false);
    expect(refused(cashed, { type: 'cash', actor: 0, positions: [9, 12, 15], bonus: null })).toMatch(/four/);
    expect(cashed.pool).toBe(4);
    const placed = act(cashed, { type: 'muster', actor: 0, province: 'a2', count: 4 });
    expect(placed.stage).toBe('attack');
    expect(placed.midTurn).toBe(false);
  });

  it('a conqueror whose captured charters are not yet learned is offered nothing', () => {
    const t = takeA2(withHand(withHand(lastStand(), 0, [0, 3, 6, 1]), 1, [9, 12, 15])).state;
    expect(legalActions(unlearned(t, 0), 0)).toEqual([]);
  });

  it('C26 fewer than six: the captured charters wait for the next turn', () => {
    const t = takeA2(withHand(withHand(lastStand(), 0, [0, 3, 6]), 1, [9])).state;
    expect(t.hands[0]).toHaveLength(4);
    expect(t.stage).toBe('attack');
    expect(legalActions(t, 0).some((a) => a.type === 'cash')).toBe(false);
  });

  it('a seat with no charters is wiped out without any re-deal', () => {
    const s = lastStand();
    const t = takeA2(s).state;
    expect(t.out).toEqual([1]);
    expect(t.dealt).toEqual(s.dealt);
  });

  it('C27 the march: once, between linked provinces of your own, leaving one behind; it ends the turn', () => {
    const s = act(attacking({ a1: [0, 5], a4: [0, 1], a2: [1, 3] }), { type: 'endAttack', actor: 0 });
    expect(s.stage).toBe('march');
    expect(legalActions(s, 0)).toContainEqual({ type: 'march', actor: 0, from: 'a1', to: 'a4', count: 4 });
    expect(legalActions(s, 0)).toContainEqual({ type: 'march', actor: 0, from: 'a1', to: 'a4', count: 1 });
    expect(refused(s, { type: 'march', actor: 0, from: 'a1', to: 'a4', count: 5 })).toMatch(/1 to 4/);
    expect(refused(s, { type: 'march', actor: 0, from: 'a1', to: 'a2', count: 1 })).toMatch(/your own/);
    expect(refused(s, { type: 'march', actor: 0, from: 'a1', to: 'a7', count: 1 })).toMatch(/linked/);
    const t = act(s, { type: 'march', actor: 0, from: 'a1', to: 'a4', count: 3 });
    expect(t.troops[0]).toBe(2);
    expect(t.troops[3]).toBe(4);
    expect(t.turn).toBe(1);
    expect(t.stage).toBe('muster');
  });

  it('C28 a turn may end without a march', () => {
    const s = act(attacking(), { type: 'endAttack', actor: 0 });
    expect(legalActions(s, 0)).toContainEqual({ type: 'endTurn', actor: 0 });
    const t = act(s, { type: 'endTurn', actor: 0 });
    expect(t.turn).toBe(1);
    expect(t.pool).toBeGreaterThanOrEqual(3);
  });

  it('C29 the seat that holds all 42 provinces wins; the others rank by how long they lasted', () => {
    const { state: t, events } = takeA2(lastStand(true));
    expect(t.stage).toBe('over');
    expect(events).toContainEqual({ type: 'won', seat: 0 });
    expect(t.result?.places).toEqual([1, 2, 3]);
    expect(t.result?.scores).toEqual([42, 0, 0]);
    expect(t.result?.reason).toBe('conquest');
    expect(pendingOf(t)).toEqual({ type: 'over' });
  });

  it('C30 a seat that is out takes no turns, but still adds its share to every roll', () => {
    const s = act(takeA2(lastStand()).state, { type: 'endAttack', actor: 0 });
    const t = act(s, { type: 'endTurn', actor: 0 });
    expect(t.turn).toBe(2);
    const m = act(t, { type: 'muster', actor: 2, province: 'a3', count: t.pool });
    const r = act(m, { type: 'attack', actor: 2, from: 'a3', to: 'a2', dice: 1 });
    // Seats 0, 1 and 2 all contribute (1 is out), the attacker last.
    const shares = [];
    let x = r.stage === 'defend' ? act(r, { type: 'defend', actor: 0, dice: 1 }) : r;
    for (let n = 0; n < 3; n++) {
      const p = pendingOf(x);
      if (p.type !== 'player') break;
      shares.push(p.seat);
      x = act(x, { type: 'contribute', actor: p.seat, id: x.roll as number });
    }
    expect(shares).toHaveLength(3);
    expect(shares).toContain(1);
    expect(pendingOf(x).type).toBe('beacon');
  });

  it('C31 a false set, which only a cheating client can send, pays nothing and ranks its seat last', () => {
    // Spear, horse, spear: not a set. The engine cannot know before the cards are face up, so it takes the cash.
    const s = withHand(opened(3), 0, [0, 1, 3]);
    const paid = revealCash(act(s, { type: 'cash', actor: 0, positions: [0, 1, 3], bonus: null })).state;
    expect(paid.pool).toBe(s.pool);
    expect(paid.cashes).toBe(0);
    expect(paid.fouls).toEqual([0]);
    expect(paid.discard.map((d) => d.card)).toEqual([0, 1, 3]);
    expect(paid.hands[0]).toEqual([]);
    // Seat 1, fouled, would place second as the last one out; it ranks last instead.
    const end = takeA2(deepFreeze({ ...lastStand(true), fouls: [1] }));
    expect(end.state.result?.places).toEqual([1, 3, 2]);
  });
});
