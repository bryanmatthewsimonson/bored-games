import { deepFreeze } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { isSet, kindOf, setValue } from '../../src/cards.ts';
import { hazard } from '../../src/module.ts';
import type { HazardState } from '../../src/types.ts';
import {
  act,
  attacking,
  contributeAndRoll,
  legalActions,
  opened,
  pendingOf,
  refused,
  revealCash,
  withHand,
} from '../helpers.ts';

/** Seat 0 attacks a2 (one troop) from a1 and takes it, then stops attacking. */
function afterCapture(s: HazardState = attacking({ a1: [0, 4], a2: [1, 1] })): HazardState {
  const t = contributeAndRoll(
    act(s, { type: 'attack', actor: 0, from: 'a1', to: 'a2', dice: 3 }),
    [6, 6, 6, 1],
  );
  return t.stage === 'advance' ? act(t, { type: 'advance', actor: 0, count: 3 }) : t;
}

const cashes = (s: HazardState, seat: number) => legalActions(s, seat).filter((a) => a.type === 'cash');

describe('charters', () => {
  it('C16 a capture earns one charter, drawn when the attacks stop, before the march', () => {
    const t = afterCapture();
    expect(t.captured).toBe(true);
    const drawn = act(t, { type: 'endAttack', actor: 0 });
    expect(drawn.stage).toBe('march');
    expect(drawn.hands[0]).toEqual([{ pos: 0, card: 0, holders: [0] }]);
    expect(drawn.pile).toHaveLength(43);
    expect(drawn.dealt.at(-1)).toEqual({ deck: 'pile', pos: 0, to: 0 });
    // A second capture in the same turn still earns only one.
    const twice = contributeAndRoll(
      act(t, { type: 'attack', actor: 0, from: 'a2', to: 'a5', dice: 2 }),
      [6, 6, 1],
    );
    expect(twice.owner[4]).toBe(0);
    expect(act(twice, { type: 'endAttack', actor: 0 }).hands[0]).toHaveLength(1);
  });

  it('C17 no capture, no charter', () => {
    const s = attacking();
    const t = act(s, { type: 'endAttack', actor: 0 });
    expect(t.stage).toBe('march');
    expect(t.hands[0]).toEqual([]);
    expect(t.pile).toHaveLength(44);
  });

  it('C18 a set is three alike, one of each kind, or two and a Crown', () => {
    expect([0, 1, 2, 42].map(kindOf)).toEqual(['spear', 'horse', 'cannon', 'crown']);
    expect(isSet([0, 3, 6])).toBe(true);
    expect(isSet([1, 4, 7])).toBe(true);
    expect(isSet([0, 1, 2])).toBe(true);
    expect(isSet([0, 3, 42])).toBe(true);
    expect(isSet([0, 1, 42])).toBe(true);
    expect(isSet([0, 42, 43])).toBe(true);
    expect(isSet([0, 3, 1])).toBe(false);
    expect(isSet([0, 0, 3])).toBe(false);
    const s = withHand(opened(3), 0, [0, 3, 1, 4]);
    // Four cards: spear, spear, horse, horse. No three of them make a set.
    expect(cashes(s, 0)).toEqual([]);
  });

  it('C19 sets pay 4, 6, 8, 10, 12, 15, then five more each, counted over every seat', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(setValue)).toEqual([4, 6, 8, 10, 12, 15, 20, 25, 30]);
    // Seat 0 holds no province on these cards (b2, b3 belong to others in this opening; 43 is a Crown).
    const s = withHand(opened(3), 0, [10, 11, 43]);
    const pool = s.pool;
    const paid = revealCash(act(s, { type: 'cash', actor: 0, positions: [10, 11, 43], bonus: null })).state;
    expect(paid.pool).toBe(pool + 4);
    expect(paid.cashes).toBe(1);
    const seventh = revealCash(
      act(deepFreeze({ ...s, cashes: 6 }), { type: 'cash', actor: 0, positions: [10, 11, 43], bonus: null }),
    ).state;
    expect(seventh.pool).toBe(pool + 20);
  });

  it('C20 a cashed charter showing a province you hold puts two troops there, once a turn', () => {
    // Cards 0, 3 and 6 show a1, a4 and a7, all held by seat 0: three spears.
    const s = withHand(opened(3), 0, [0, 3, 6, 9, 12, 15]);
    const offered = cashes(s, 0).filter((a) => (a as { positions: readonly number[] }).positions.join() === '0,3,6');
    expect(offered.map((a) => (a as { bonus: string }).bonus)).toEqual(['a1', 'a4', 'a7']);
    const before = s.troops[3] as number;
    const t = revealCash(act(s, { type: 'cash', actor: 0, positions: [0, 3, 6], bonus: 'a4' })).state;
    expect(t.troops[3]).toBe(before + 2);
    expect(t.bonusUsed).toBe(true);
    expect(t.fouls).toEqual([]);
    // The second set this turn (b1, b4, c3: also held) pays no bonus.
    const second = cashes(t, 0);
    expect(second).toEqual([{ type: 'cash', actor: 0, positions: [9, 12, 15], bonus: null }]);
  });

  it('C21 five charters at the start of a turn must be cashed first; a second set is optional', () => {
    const s = withHand(opened(3), 0, [10, 11, 13, 14, 16]);
    expect(s.hands[0]).toHaveLength(5);
    const legal = legalActions(s, 0);
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((a) => a.type === 'cash')).toBe(true);
    expect(refused(s, { type: 'muster', actor: 0, province: 'a1', count: 1 })).toMatch(/Cash/);
    const t = revealCash(act(s, legal[0] as never)).state;
    expect(t.hands[0]).toHaveLength(2);
    expect(legalActions(t, 0).some((a) => a.type === 'muster')).toBe(true);
  });

  it('C22 a cashed set is turned face up first, and pays once all three cards are showing', () => {
    const s = withHand(opened(3), 0, [10, 11, 43]);
    const c = act(s, { type: 'cash', actor: 0, positions: [10, 11, 43], bonus: null });
    expect(c.stage).toBe('reveal');
    expect(c.dealt.slice(-3)).toEqual([
      { deck: 'pile', pos: 10, to: null },
      { deck: 'pile', pos: 11, to: null },
      { deck: 'pile', pos: 43, to: null },
    ]);
    expect(pendingOf(c)).toEqual({ type: 'reveal', deck: 'pile', positions: [10, 11, 43] });
    expect(c.pool).toBe(s.pool);
    const one = act(c, { type: 'reveal', actor: 'deck', deck: 'pile', pos: 11, card: 11 });
    expect(one.pool).toBe(s.pool);
    expect(pendingOf(one)).toEqual({ type: 'reveal', deck: 'pile', positions: [10, 43] });
    const { state: done, events } = revealCash(one);
    expect(done.stage).toBe('muster');
    expect(done.pool).toBe(s.pool + 4);
    expect(done.hands[0]).toEqual([]);
    expect(done.discard.map((d) => d.card)).toEqual([10, 11, 43]);
    expect(events.at(-1)).toEqual({
      type: 'cashed',
      seat: 0,
      cards: [10, 11, 43],
      troops: 4,
      bonus: null,
      foul: false,
    });
    expect(refused(s, { type: 'cash', actor: 0, positions: [10, 11, 12], bonus: null })).toMatch(/hold/);
  });

  it('C23 an empty pile reshuffles the cashed charters; with none cashed there is no charter', () => {
    const t = afterCapture();
    const empty = deepFreeze({
      ...t,
      pile: [],
      discard: [
        { pos: 5, card: 5 },
        { pos: 9, card: 9 },
        { pos: 20, card: 20 },
      ],
    });
    const shuffling = act(empty, { type: 'endAttack', actor: 0 });
    expect(shuffling.stage).toBe('shuffle');
    expect(pendingOf(shuffling)).toEqual({
      type: 'shuffle',
      deck: 'pile',
      epoch: 1,
      from: [5, 9, 20].map((pos) => ({ deck: 'pile', pos })),
    });
    expect(hazard.shufflePlaintexts?.(shuffling)).toEqual([5, 9, 20]);
    const installed = hazard.installDeckOrder?.(shuffling, 1, [20, 5, 9]);
    expect(installed?.ok && installed.events).toEqual([]);
    const ready = installed?.ok ? installed.state : shuffling;
    const drawn = act(ready, { type: 'epoch', actor: 'deck', epoch: 1, size: 3 });
    expect(drawn.stage).toBe('march');
    expect(drawn.discard).toEqual([]);
    expect(drawn.pile).toEqual([129, 130]);
    expect(drawn.hands[0]?.at(-1)).toEqual({ pos: 128, card: 20, holders: [0] });
    expect(drawn.epoch).toBe(1);
    // Nothing to draw and nothing to reshuffle: no charter, and the turn goes on to the march.
    const nothing = act(deepFreeze({ ...t, pile: [], discard: [] }), { type: 'endAttack', actor: 0 });
    expect(nothing.stage).toBe('march');
    expect(nothing.hands[0]).toEqual([]);
  });
});
