import { describe, expect, it } from 'vitest';
import { hazard } from '../../src/module.ts';
import { act, attacking, contributeAndRoll, legalActions, pendingOf, refused, rollStep } from '../helpers.ts';

const AUTO = { defense: 'auto' } as const;

describe('battles', () => {
  it('C10 attack a linked enemy province, over land or a sea lane, from one with two or more troops', () => {
    const s = attacking({ a1: [0, 5], e4: [1, 2], a2: [1, 1], a5: [1, 3], a4: [0, 1], a7: [0, 2] });
    expect(s.stage).toBe('attack');
    // The lane off the edge of the map.
    expect(act(s, { type: 'attack', actor: 0, from: 'a1', to: 'e4', dice: 3 }).stage).toBe('defend');
    expect(refused(s, { type: 'attack', actor: 0, from: 'a1', to: 'a5', dice: 1 })).toMatch(/linked/);
    expect(refused(s, { type: 'attack', actor: 0, from: 'a4', to: 'a5', dice: 1 })).toMatch(/two troops/);
    expect(refused(s, { type: 'attack', actor: 0, from: 'a1', to: 'a4', dice: 1 })).toMatch(/enemy/);
    expect(refused(s, { type: 'attack', actor: 0, from: 'a2', to: 'a1', dice: 1 })).toMatch(/your own/);
    expect(refused(s, { type: 'attack', actor: 1, from: 'a2', to: 'a1', dice: 1 })).toMatch(/turn/);
    const legal = legalActions(s, 0);
    expect(legal).toContainEqual({ type: 'attack', actor: 0, from: 'a1', to: 'e4', dice: 3 });
    expect(legal).toContainEqual({ type: 'endAttack', actor: 0 });
    expect(legal.some((a) => a.type === 'attack' && a.from === 'a4')).toBe(false);
  });

  it('C11 the attacker rolls one to three dice, always one fewer than the troops in the province', () => {
    const s = attacking({ a1: [0, 3], a2: [1, 2] });
    expect(refused(s, { type: 'attack', actor: 0, from: 'a1', to: 'a2', dice: 3 })).toMatch(/1 to 2/);
    expect(refused(s, { type: 'attack', actor: 0, from: 'a1', to: 'a2', dice: 0 })).toMatch(/1 to 2/);
    const dice = legalActions(s, 0)
      .filter((a) => a.type === 'attack' && a.from === 'a1' && a.to === 'a2')
      .map((a) => (a as { dice: number }).dice);
    expect(dice).toEqual([1, 2]);
  });

  it('C12 the defender chooses one or two dice; with one troop there is nothing to choose', () => {
    const s = attacking({ a1: [0, 6], a2: [1, 2], e4: [2, 1] });
    const d = act(s, { type: 'attack', actor: 0, from: 'a1', to: 'a2', dice: 3 });
    expect(d.stage).toBe('defend');
    expect(pendingOf(d)).toEqual({ type: 'player', seat: 1, decision: 'defend' });
    expect(legalActions(d, 1)).toEqual([
      { type: 'defend', actor: 1, dice: 1 },
      { type: 'defend', actor: 1, dice: 2 },
    ]);
    expect(refused(d, { type: 'defend', actor: 1, dice: 3 })).toMatch(/1 or 2/);
    const r = act(d, { type: 'defend', actor: 1, dice: 1 });
    expect(r.stage).toBe('roll');
    expect(hazard.rollShape?.(r)).toEqual({ count: 4, sides: 6 });
    // The defender opened the roll: it adds its share last.
    expect(r.rolls.at(-1)?.last).toBe(1);
    const lone = act(s, { type: 'attack', actor: 0, from: 'a1', to: 'e4', dice: 2 });
    expect(lone.stage).toBe('roll');
    expect(lone.battle?.defend).toBe(1);
    expect(lone.rolls.at(-1)?.last).toBe(0);
  });

  it('C13 with automatic defence the defender always rolls the most dice allowed', () => {
    const s = attacking({ a1: [0, 6], a2: [1, 5] }, AUTO);
    const r = act(s, { type: 'attack', actor: 0, from: 'a1', to: 'a2', dice: 2 });
    expect(r.stage).toBe('roll');
    expect(r.battle?.defend).toBe(2);
    expect(hazard.rollShape?.(r)).toEqual({ count: 4, sides: 6 });
  });

  it('C14 highest die against highest, then the next pair; ties go to the defender', () => {
    const s = attacking({ a1: [0, 6], a2: [1, 5] }, AUTO);
    const r = act(s, { type: 'attack', actor: 0, from: 'a1', to: 'a2', dice: 3 });
    // The attacker's faces come first: [1, 6, 3], then the defender's [3, 3].
    const t = contributeAndRoll(r, [1, 6, 3, 3, 3]);
    expect(t.troops[0]).toBe(5);
    expect(t.troops[1]).toBe(4);
    expect(t.stage).toBe('attack');
    expect(t.dice).toEqual({ attack: [6, 3, 1], defend: [3, 3] });
    const one = act(attacking({ a1: [0, 6], a2: [1, 1] }), {
      type: 'attack',
      actor: 0,
      from: 'a1',
      to: 'a2',
      dice: 1,
    });
    const u = contributeAndRoll(one, [2, 2]);
    expect(u.troops[0]).toBe(5);
    expect(u.troops[1]).toBe(1);
  });

  it('C15 a captured province takes at least the dice just rolled, and one troop always stays behind', () => {
    const s = attacking({ a1: [0, 6], a2: [1, 1] });
    const r = act(s, { type: 'attack', actor: 0, from: 'a1', to: 'a2', dice: 3 });
    const { state: t, events } = rollStep(r, [6, 5, 4, 1]);
    expect(events.map((e) => e.type)).toEqual(['battle', 'captured']);
    expect(t.owner[1]).toBe(0);
    expect(t.stage).toBe('advance');
    expect(t.captured).toBe(true);
    expect(legalActions(t, 0).map((a) => (a as { count: number }).count)).toEqual([3, 4, 5]);
    expect(refused(t, { type: 'advance', actor: 0, count: 2 })).toMatch(/3 to 5/);
    const moved = act(t, { type: 'advance', actor: 0, count: 4 });
    expect(moved.troops[1]).toBe(4);
    expect(moved.troops[0]).toBe(2);
    expect(moved.stage).toBe('attack');
    // One way to move in: it happens at once.
    const only = act(attacking({ a1: [0, 3], a2: [1, 1] }), {
      type: 'attack',
      actor: 0,
      from: 'a1',
      to: 'a2',
      dice: 2,
    });
    const done = contributeAndRoll(only, [5, 5, 1]);
    expect(done.stage).toBe('attack');
    expect(done.troops[1]).toBe(2);
    expect(done.troops[0]).toBe(1);
  });
});
