import { describe, expect, it } from 'vitest';
import { placeCounts } from '../../src/engine.ts';
import { legal, place, placeAll, refused, started } from '../helpers.ts';

describe('placing people', () => {
  it('C05 a turn places one or more people on one spot never used by that clan this round; turns go round', () => {
    let s = started(2);
    expect(s.turn).toBe(0);
    expect(refused(s, { type: 'place', actor: 1, spot: 'hunt', count: 1 })).toMatch(/not your/);
    expect(refused(s, { type: 'place', actor: 0, spot: 'hunt', count: 0 })).toMatch(/cannot place/);
    s = place(s, 0, 'hunt', 3);
    expect(s.turn).toBe(1);
    expect(s.home).toEqual([2, 5]);
    s = place(s, 1, 'wood', 1);
    // The hunting grounds have room, but seat 0 is already there this round.
    expect(placeCounts(s, 0, 'hunt')).toEqual([]);
    expect(refused(s, { type: 'place', actor: 0, spot: 'hunt', count: 1 })).toMatch(/cannot place/);
    s = place(s, 0, 'brick', 2);
    // Seat 0 has nobody left: seat 1 places on.
    expect(s.turn).toBe(1);
    s = place(s, 1, 'hunt', 2);
    expect(s.turn).toBe(1);
    expect(legal(s, 0)).toEqual([]);
  });

  it('C06 the hunting grounds take any number; a ground 7 in all; the knapper and the furrows one; the hearth two', () => {
    let s = started(4);
    expect(placeCounts(s, 0, 'hunt')).toEqual([1, 2, 3, 4, 5]);
    s = place(s, 0, 'wood', 5);
    expect(placeCounts(s, 1, 'wood')).toEqual([1, 2]);
    s = place(s, 1, 'wood', 2);
    expect(placeCounts(s, 2, 'wood')).toEqual([]);
    expect(placeCounts(s, 2, 'tools')).toEqual([1]);
    expect(placeCounts(s, 2, 'hut')).toEqual([2]);
    expect(placeCounts(s, 2, 'card0')).toEqual([1]);
    expect(placeCounts(s, 2, 'stack3')).toEqual([1]);
    expect(refused(s, { type: 'place', actor: 2, spot: 'hut', count: 1 })).toMatch(/cannot place/);
    s = place(s, 2, 'hut', 2);
    expect(placeCounts(s, 3, 'hut')).toEqual([]);
    s = place(s, 3, 'card0');
    expect(placeCounts(s, 0, 'card0')).toEqual([]);
    // A seat with one person left cannot take the hearth.
    s = placeAll(s, [
      [1, 'hunt', 2],
      [2, 'hunt', 2],
      [3, 'hunt', 3],
    ]);
    expect(s.home).toEqual([0, 1, 1, 1]);
    expect(placeCounts(s, 1, 'tools')).toEqual([1]);
  });

  it('C07 with two or three players, fewer clans share a ground and only two village spots are used', () => {
    let two = started(2);
    two = place(two, 0, 'stone', 1);
    expect(placeCounts(two, 1, 'stone')).toEqual([]);
    expect(placeCounts(two, 1, 'gold')).toEqual([1, 2, 3, 4, 5]);
    two = place(two, 1, 'tools');
    two = place(two, 0, 'field');
    expect(placeCounts(two, 1, 'hut')).toEqual([]);
    expect(placeCounts(two, 1, 'stack1')).toEqual([1]);
    expect(placeCounts(two, 1, 'stack2')).toEqual([]);

    let three = started(3);
    three = placeAll(three, [
      [0, 'stone', 1],
      [1, 'stone', 1],
    ]);
    expect(placeCounts(three, 2, 'stone')).toEqual([]);
    three = placeAll(three, [
      [2, 'hut', 2],
      [0, 'field'],
    ]);
    expect(placeCounts(three, 1, 'tools')).toEqual([]);

    let four = started(4);
    four = placeAll(four, [
      [0, 'hut', 2],
      [1, 'field'],
    ]);
    expect(placeCounts(four, 2, 'tools')).toEqual([1]);
  });

  it('C08 placing ends when no clan can place, and resolving starts with the first player', () => {
    let s = started(2, undefined);
    s = placeAll(s, [
      [0, 'hunt', 4],
      [1, 'hunt', 5],
      [0, 'card0'],
    ]);
    expect(s.stage).toBe('resolve');
    expect(s.turn).toBe(0);
    expect(s.home).toEqual([0, 0]);
  });
});
