import { describe, expect, it } from 'vitest';
import { pendingOf } from '../../src/engine.ts';
import type { SticksState } from '../../src/types.ts';
import { knownTo, learnCard, viewOf } from '../../src/view.ts';
import {
  act,
  legal,
  orderWith,
  placeAll,
  refused,
  rollStep,
  rollWith,
  started,
  withClan,
} from '../helpers.ts';

/**
 * Seat 0 first (the opening card is 24 or 12, a multiple of 2, 3 and 4), on the card at slot 1 (cost 2) showing
 * `card`; everyone else hunting; seat 0 holds one of each good.
 */
function buying(card: number, seats = 2, goods = [1, 1, 1, 1]): SticksState {
  const moves: [number, 'card1' | 'hunt', number][] = [[0, 'card1', 1]];
  for (let k = 1; k < seats; k++) moves.push([k, 'hunt', 5]);
  moves.push([0, 'hunt', 4]);
  const lead = card === 24 ? 12 : 24;
  return withClan(placeAll(started(seats, orderWith([lead, card])), moves), 0, (c) => ({ ...c, goods }));
}
const buy = (s: SticksState): SticksState => act(s, { type: 'buy', actor: 0, slot: 1, pay: [1, 1, 0, 0] });

describe('discoveries', () => {
  it('C15 food, goods and points are taken at once', () => {
    expect(buy(buying(4)).clans[0]?.food).toBe(19);
    expect(buy(buying(14)).clans[0]?.goods).toEqual([0, 0, 3, 1]);
    expect(buy(buying(31)).clans[0]?.goods).toEqual([0, 0, 1, 2]);
    expect(buy(buying(30)).clans[0]?.score).toBe(3);
  });

  it('C16 a one-use tool is added to one roll of its owner, with any tools, and is then gone', () => {
    let s = buy(buying(21));
    expect(s.clans[0]?.spares).toEqual([4]);
    s = rollWith(act(s, { type: 'use', actor: 0, spot: 'hunt' }), [1, 1, 1, 2]);
    expect(s.stage).toBe('tools');
    expect(legal(s, 0)).toEqual([
      { type: 'tools', actor: 0, tools: [], spares: [] },
      { type: 'tools', actor: 0, tools: [], spares: [0] },
    ]);
    expect(refused(s, { type: 'tools', actor: 0, tools: [], spares: [1] })).toMatch(/no such/);
    s = act(s, { type: 'tools', actor: 0, tools: [], spares: [0] });
    expect(s.clans[0]?.food).toBe(16);
    expect(s.clans[0]?.spares).toEqual([]);
    expect(s.clans[0]?.cards).toEqual([21]);
  });

  it('C17 a tool step and a harvest step work as at the knapper and the furrows', () => {
    expect(buy(buying(7)).clans[0]?.tools).toEqual([1]);
    expect(buy(buying(12)).clans[0]?.field).toBe(1);
    expect(buy(buying(16)).clans[0]?.field).toBe(1);
  });

  it('C18 two goods of the buyer’s choice may be taken now or at a later decision of theirs', () => {
    let s = buy(buying(3));
    expect(s.clans[0]?.choices).toBe(1);
    expect(legal(s, 0).filter((a) => a.type === 'choose')).toHaveLength(10);
    expect(refused(s, { type: 'choose', actor: 0, take: [1, 0, 0, 0] })).toMatch(/two goods/);
    expect(refused(s, { type: 'choose', actor: 1, take: [0, 0, 0, 2] })).toMatch(/not your decision/);
    s = act(s, { type: 'choose', actor: 0, take: [0, 0, 1, 1] });
    expect(s.clans[0]?.goods).toEqual([0, 0, 2, 2]);
    expect(s.clans[0]?.choices).toBe(0);
    expect(s.turn).toBe(0);
    expect(legal(s, 0).filter((a) => a.type === 'choose')).toEqual([]);
    // Later: at any decision of its owner's, adding tools to a roll included; the roll waits for it.
    let later = withClan(buy(buying(21)), 0, (c) => ({ ...c, choices: 1 }));
    later = rollWith(act(later, { type: 'use', actor: 0, spot: 'hunt' }), [1, 1, 1, 2]);
    expect(later.stage).toBe('tools');
    expect(legal(later, 0).filter((a) => a.type === 'choose')).toHaveLength(10);
    later = act(later, { type: 'choose', actor: 0, take: [2, 0, 0, 0] });
    expect([later.stage, later.clans[0]?.choices, later.clans[0]?.goods[0]]).toEqual(['tools', 0, 2]);
  });

  it('C19 a gift of the dice rolls a die a player; from the buyer round, each takes one: a good, a tool or harvest', () => {
    let s = buy(buying(1, 4));
    expect(s.gift?.order).toEqual([0, 1, 2, 3]);
    s = rollWith(s, [6, 2, 5, 2]);
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'pick' });
    expect(legal(s, 0)).toEqual([2, 5, 6].map((face) => ({ type: 'pick', actor: 0, face })));
    expect(refused(s, { type: 'pick', actor: 0, face: 1 })).toMatch(/No die/);
    s = act(s, { type: 'pick', actor: 0, face: 6 });
    expect(s.clans[0]?.field).toBe(1);
    s = act(s, { type: 'pick', actor: 1, face: 5 });
    expect(s.clans[1]?.tools).toEqual([1]);
    const r = act(s, { type: 'pick', actor: 2, face: 2 });
    // The last die goes to the last taker by itself.
    expect(r.clans[2]?.goods).toEqual([0, 1, 0, 0]);
    expect(r.clans[3]?.goods).toEqual([0, 1, 0, 0]);
    expect(r.stage).toBe('resolve');
    expect(r.turn).toBe(0);
    // Two players: the buyer takes one, the other the last.
    let two = rollWith(buy(buying(5)), [1, 4]);
    two = act(two, { type: 'pick', actor: 0, face: 4 });
    expect(two.clans[0]?.goods).toEqual([0, 0, 1, 2]);
    expect(two.clans[1]?.goods).toEqual([1, 0, 0, 0]);
  });

  it('C20 a discovery’s roll of two dice gathers its good, and tools may be added', () => {
    let s = withClan(buy(buying(35)), 0, (c) => ({ ...c, tools: [1], used: [false] }));
    expect(pendingOf(s).type).toBe('player');
    const r = rollStep(s, [1, 1]);
    expect(r.state.stage).toBe('tools');
    s = act(r.state, { type: 'tools', actor: 0, tools: [0], spares: [] });
    expect(s.clans[0]?.goods).toEqual([1, 0, 1, 1]);
    const gold = rollStep(buy(buying(6)), [6, 6]);
    expect(gold.events).toContainEqual({
      type: 'gathered',
      seat: 0,
      spot: 'card',
      good: 3,
      dice: [6, 6],
      bonus: 0,
      amount: 2,
    });
  });

  it('C21 the extra card is drawn face down for its buyer alone and only scores; none when the pile is empty', () => {
    const s = buy(buying(0));
    expect(s.clans[0]?.hidden).toEqual([{ pos: 4, card: s.order?.[4], open: false }]);
    expect(s.next).toBe(5);
    expect(s.dealt.at(-1)).toEqual({ deck: 'camp', pos: 4, to: 0 });
    expect(knownTo(s, 0)).toEqual([{ deck: 'camp', pos: 4, card: s.order?.[4] }]);
    expect(knownTo(s, 1)).toEqual([]);
    expect(viewOf(s, 1).clans[0]?.hidden).toEqual([{ pos: 4, card: null, open: false }]);
    const mine = viewOf(
      { ...s, clans: s.clans.map((c) => ({ ...c, hidden: c.hidden.map((h) => ({ ...h, card: null })) })) },
      0,
    );
    const learned = learnCard(mine, { deck: 'camp', pos: 4, card: s.order?.[4] as number });
    expect(learned.ok && learned.state.clans[0]?.hidden[0]?.card).toBe(s.order?.[4]);
    expect(learnCard(viewOf(s, 1), { deck: 'camp', pos: 4, card: 4 }).ok).toBe(false);
    // The pile is empty: nothing is drawn.
    const empty = buy({ ...buying(0), next: 36 });
    expect(empty.clans[0]?.hidden).toEqual([]);
    expect(empty.clans[0]?.cards).toEqual([0]);
    expect(empty.next).toBe(36);
  });
});
