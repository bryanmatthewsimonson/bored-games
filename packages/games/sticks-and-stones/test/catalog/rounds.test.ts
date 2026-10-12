import { describe, expect, it } from 'vitest';
import { pendingOf } from '../../src/engine.ts';
import {
  act,
  huntRound,
  legal,
  orderWith,
  placeAll,
  refused,
  rollStep,
  started,
  step,
  withClan,
} from '../helpers.ts';

describe('feeding and rounds', () => {
  it('C22 each clan reaps its harvest, then eats one food a person, and keeps what is left', () => {
    const s = huntRound(withClan(started(2), 0, (c) => ({ ...c, food: 2, field: 3 })));
    expect(s.clans[0]?.food).toBe(2);
    expect(s.clans[1]?.food).toBe(9);
    expect(s.round).toBe(2);
  });

  it('C23 a hungry clan pays the whole shortfall in goods or loses 10 points, and all its food either way', () => {
    let s = huntRound(withClan(started(2), 0, (c) => ({ ...c, food: 0, goods: [2, 1, 0, 0] })));
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'feed' });
    expect(legal(s, 0)).toEqual([
      { type: 'feed', actor: 0, pay: [2, 1, 0, 0] },
      { type: 'feed', actor: 0, pay: null },
    ]);
    expect(refused(s, { type: 'feed', actor: 0, pay: [2, 0, 0, 0] })).toMatch(/exactly/);
    const paid = act(s, { type: 'feed', actor: 0, pay: [2, 1, 0, 0] });
    expect(paid.clans[0]).toMatchObject({ food: 0, goods: [0, 0, 0, 0], score: 0 });
    s = act(s, { type: 'feed', actor: 0, pay: null });
    expect(s.clans[0]).toMatchObject({ food: 0, goods: [2, 1, 0, 0], score: -10 });
    // Too few goods: no decision, the clan goes hungry by itself; a score may go below zero.
    const r = huntRound(withClan(started(2), 0, (c) => ({ ...c, food: 0, goods: [1, 0, 0, 0], score: -10 })));
    expect(r.clans[0]).toMatchObject({ food: 0, goods: [1, 0, 0, 0], score: -20 });
    // A card for two goods counts: it may be used first.
    let t = huntRound(withClan(started(2), 0, (c) => ({ ...c, food: 1, choices: 1 })));
    expect(legal(t, 0).map((a) => a.type)).toEqual(['feed', ...Array.from({ length: 10 }, () => 'choose')]);
    t = act(t, { type: 'choose', actor: 0, take: [0, 2, 0, 0] });
    t = act(t, { type: 'feed', actor: 0, pay: [0, 2, 0, 0] });
    expect(t.clans[0]).toMatchObject({ food: 0, goods: [0, 0, 0, 0], score: 0, choices: 0 });
  });

  it('C24 a new round: the display slides to the cheap end and refills, tools turn back, the first player passes left', () => {
    let s = withClan(
      placeAll(started(2, orderWith([24, 4])), [
        [0, 'card1'],
        [1, 'hunt', 5],
        [0, 'hunt', 4],
      ]),
      0,
      (c) => ({ ...c, goods: [2, 0, 0, 0], tools: [1], used: [true] }),
    );
    s = act(s, { type: 'buy', actor: 0, slot: 1, pay: [2, 0, 0, 0] });
    const r = step(huntRound(s), { type: 'reveal', actor: 'deck', deck: 'camp', pos: 4, card: 2 });
    s = r.state;
    expect(s.display.map((d) => d?.card)).toEqual([24, 0, 1, 2]);
    expect(s.next).toBe(5);
    expect(s.clans[0]?.used).toEqual([false]);
    expect([s.round, s.first, s.turn, s.stage]).toEqual([2, 1, 1, 'place']);
    expect(s.home).toEqual([5, 5]);
  });

  it('C25 when the pile cannot fill the display at the start of a round, the game ends at once', () => {
    const base = withClan(
      placeAll(started(2, orderWith([24, 4])), [
        [0, 'card1'],
        [1, 'hunt', 5],
        [0, 'hunt', 4],
      ]),
      0,
      (c) => ({ ...c, goods: [2, 0, 0, 0] }),
    );
    const bought = act(base, { type: 'buy', actor: 0, slot: 1, pay: [2, 0, 0, 0] });
    const ended = huntRound({ ...bought, next: 36 });
    expect(ended.stage).toBe('over');
    expect(ended.result?.reason).toBe('pile');
    expect(ended.clans[0]?.food).toBe(12 + 2 - 5 + 7);
    // Nothing to refill: the game goes on, even with an empty pile.
    const going = huntRound({ ...withClan(started(2), 0, (c) => c), next: 36 });
    expect(going.stage).toBe('place');
  });

  it('C26 when a stack is empty, the round is finished, feeding included, and the game ends', () => {
    let s = placeAll(started(2, orderWith([], [0, 1, 2, 3, 4, 5, 25])), [
      [0, 'stack0'],
      [1, 'hunt', 5],
      [0, 'hunt', 4],
    ]);
    s = withClan({ ...s, stacks: [{ built: 6, top: 61 }, ...s.stacks.slice(1)] }, 0, (c) => ({
      ...c,
      goods: [1, 0, 0, 1],
    }));
    expect(legal(s, 0).filter((a) => a.type === 'build')).toHaveLength(3);
    s = act(s, { type: 'build', actor: 0, stack: 0, pay: [0, 0, 0, 1] });
    expect(s.stacks[0]).toEqual({ built: 7, top: null });
    expect(pendingOf(s).type).toBe('player');
    const r = huntRound(s);
    expect(r.stage).toBe('over');
    expect(r.result?.reason).toBe('monuments');
    expect(r.clans[1]?.food).toBe(12 + 2 - 5);
    expect(r.clans[0]?.score).toBe(6);
    expect(rollStep).toBeTypeOf('function');
  });
});
