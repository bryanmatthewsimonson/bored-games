import { describe, expect, it } from 'vitest';
import { pendingOf } from '../../src/engine.ts';
import { gainTool } from '../../src/util.ts';
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

describe('resolving', () => {
  it('C09 each player in order resolves every one of their spots, in the order they like, before the next', () => {
    let s = placeAll(started(2), [
      [0, 'hunt', 2],
      [1, 'hunt', 5],
      [0, 'wood', 3],
    ]);
    expect(s.stage).toBe('resolve');
    expect(legal(s, 0)).toEqual([
      { type: 'use', actor: 0, spot: 'hunt' },
      { type: 'use', actor: 0, spot: 'wood' },
    ]);
    expect(legal(s, 1)).toEqual([]);
    s = act(s, { type: 'use', actor: 0, spot: 'wood' });
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 1, decision: 'contribute' });
    s = rollWith(s, [1, 1, 1]);
    expect(s.turn).toBe(0);
    expect(legal(s, 0)).toEqual([{ type: 'use', actor: 0, spot: 'hunt' }]);
    s = rollWith(act(s, { type: 'use', actor: 0, spot: 'hunt' }), [1, 1]);
    expect(s.turn).toBe(1);
    expect(legal(s, 1)).toEqual([{ type: 'use', actor: 1, spot: 'hunt' }]);
  });

  it('C10 a gathering rolls a die per person and yields the sum over 2 (food), 3, 4, 5 or 6, rounded down', () => {
    let s = placeAll(started(4), [
      [0, 'hunt', 2],
      [1, 'wood', 3],
      [2, 'brick', 4],
      [3, 'gold', 2],
      [0, 'stone', 3],
      [1, 'hunt', 2],
      [2, 'hunt', 1],
      [3, 'hunt', 3],
    ]);
    const r1 = rollStep(act(s, { type: 'use', actor: 0, spot: 'hunt' }), [3, 4]);
    expect(r1.events).toContainEqual({
      type: 'gathered',
      seat: 0,
      spot: 'hunt',
      good: -1,
      dice: [3, 4],
      bonus: 0,
      amount: 3,
    });
    s = rollWith(act(r1.state, { type: 'use', actor: 0, spot: 'stone' }), [5, 5, 4]);
    expect(s.clans[0]?.food).toBe(15);
    expect(s.clans[0]?.goods).toEqual([0, 0, 2, 0]);
    s = rollWith(act(s, { type: 'use', actor: 1, spot: 'wood' }), [6, 6, 5]);
    expect(s.clans[1]?.goods).toEqual([5, 0, 0, 0]);
    s = rollWith(act(s, { type: 'use', actor: 1, spot: 'hunt' }), [1, 1]);
    s = rollWith(act(s, { type: 'use', actor: 2, spot: 'brick' }), [6, 6, 6, 1]);
    expect(s.clans[2]?.goods).toEqual([0, 4, 0, 0]);
    s = rollWith(act(s, { type: 'use', actor: 2, spot: 'hunt' }), [1]);
    s = rollWith(act(s, { type: 'use', actor: 3, spot: 'gold' }), [6, 5]);
    expect(s.clans[3]?.goods).toEqual([0, 0, 0, 1]);
  });

  it('C11 tools climb a ladder to three 4s; each is added once a round, after the dice, alone or together', () => {
    const ladder = [];
    let c = started(2).clans[0] as never as Parameters<typeof gainTool>[0];
    for (let i = 0; i < 13; i++) {
      c = gainTool(c);
      ladder.push(c.tools.join(''));
    }
    expect(ladder).toEqual([
      '1',
      '11',
      '111',
      '211',
      '221',
      '222',
      '322',
      '332',
      '333',
      '433',
      '443',
      '444',
      '444',
    ]);
    // An unused tile goes up first.
    expect(gainTool({ ...c, tools: [1, 1, 1], used: [true, false, false] }).tools).toEqual([1, 2, 1]);

    let s = withClan(
      placeAll(started(2), [
        [0, 'wood', 2],
        [1, 'hunt', 5],
        [0, 'brick', 3],
      ]),
      0,
      (k) => ({ ...k, tools: [2, 1], used: [false, false] }),
    );
    s = rollWith(act(s, { type: 'use', actor: 0, spot: 'wood' }), [2, 3]);
    expect(s.stage).toBe('tools');
    expect(legal(s, 0)).toEqual([
      { type: 'tools', actor: 0, tools: [], spares: [] },
      { type: 'tools', actor: 0, tools: [0], spares: [] },
      { type: 'tools', actor: 0, tools: [1], spares: [] },
      { type: 'tools', actor: 0, tools: [0, 1], spares: [] },
    ]);
    expect(refused(s, { type: 'tools', actor: 0, tools: [2], spares: [] })).toMatch(/not free/);
    s = act(s, { type: 'tools', actor: 0, tools: [1], spares: [] });
    expect(s.clans[0]?.goods).toEqual([2, 0, 0, 0]);
    expect(s.clans[0]?.used).toEqual([false, true]);
    // The next roll offers only the unused tool; a roll the tools cannot raise asks nothing.
    s = rollWith(act(s, { type: 'use', actor: 0, spot: 'brick' }), [1, 1, 2]);
    expect(s.stage).toBe('resolve');
    expect(s.clans[0]?.goods).toEqual([2, 1, 0, 0]);
    expect(s.turn).toBe(1);
  });

  it('C12 the hearth adds a person, the furrows a step of harvest, the knapper a tool step, up to their limits', () => {
    let s = placeAll(started(4), [
      [0, 'hut', 2],
      [1, 'field'],
      [2, 'tools'],
      [3, 'hunt', 5],
      [0, 'hunt', 3],
      [1, 'hunt', 4],
      [2, 'hunt', 4],
    ]);
    s = act(s, { type: 'use', actor: 0, spot: 'hut' });
    expect(s.clans[0]?.people).toBe(6);
    s = rollWith(act(s, { type: 'use', actor: 0, spot: 'hunt' }), [1, 1, 1]);
    s = act(s, { type: 'use', actor: 1, spot: 'field' });
    expect(s.clans[1]?.field).toBe(1);
    s = rollWith(act(s, { type: 'use', actor: 1, spot: 'hunt' }), [1, 1, 1, 1]);
    s = act(s, { type: 'use', actor: 2, spot: 'tools' });
    expect(s.clans[2]?.tools).toEqual([1]);

    let full = withClan(
      placeAll(started(4), [
        [0, 'hut', 2],
        [1, 'field'],
        [2, 'tools'],
      ]),
      0,
      (k) => ({ ...k, people: 10 }),
    );
    full = withClan(
      withClan(full, 1, (k) => ({ ...k, field: 10 })),
      2,
      (k) => ({
        ...k,
        tools: [4, 4, 4],
        used: [false, false, false],
      }),
    );
    full = placeAll(full, [
      [3, 'hunt', 5],
      [0, 'hunt', 3],
      [1, 'hunt', 4],
      [2, 'hunt', 4],
    ]);
    const r = act(full, { type: 'use', actor: 0, spot: 'hut' });
    expect(r.clans[0]?.people).toBe(10);
  });

  it('C13 a discovery costs its slot (1–4) in any goods, never food; the buyer may pass it up', () => {
    let s = withClan(
      placeAll(started(2), [
        [0, 'card2'],
        [1, 'card0'],
        [0, 'hunt', 4],
        [1, 'hunt', 4],
      ]),
      0,
      (k) => ({ ...k, goods: [1, 2, 0, 0] }),
    );
    expect(legal(s, 0).filter((a) => a.type === 'buy')).toEqual([
      { type: 'buy', actor: 0, slot: 2, pay: [1, 2, 0, 0] },
    ]);
    expect(refused(s, { type: 'buy', actor: 0, slot: 2, pay: [1, 1, 0, 0] })).toMatch(/price/);
    expect(refused(s, { type: 'buy', actor: 0, slot: 0, pay: [1, 0, 0, 0] })).toMatch(/nobody/);
    s = act(s, { type: 'buy', actor: 0, slot: 2, pay: [1, 2, 0, 0] });
    expect(s.clans[0]?.cards).toEqual([2]);
    expect(s.clans[0]?.goods).toEqual([0, 0, 0, 0]);
    expect(s.clans[0]?.food).toBe(17);
    expect(s.display[2]).toBeNull();
    s = rollWith(act(s, { type: 'use', actor: 0, spot: 'hunt' }), [1, 1, 1, 1]);
    // Seat 1 has no goods: it can only pass the card up.
    expect(legal(s, 1).filter((a) => a.type !== 'use')).toEqual([{ type: 'skip', actor: 1, spot: 'card0' }]);
    s = act(s, { type: 'skip', actor: 1, spot: 'card0' });
    expect(s.display[0]?.card).toBe(0);
    expect(s.spots.card0).toEqual([0, 0]);
  });

  it('C14 a monument costs its goods and scores their value; the next tile is turned up at once', () => {
    // Stack 0: 2 wood + 1 brick (10); stack 1: four goods of exactly two kinds.
    let s = withClan(
      placeAll(started(2, orderWith([], [0, 1, 2, 3, 4, 5, 6, 18])), [
        [0, 'stack0'],
        [1, 'hunt', 5],
        [0, 'stack1'],
        [0, 'hunt', 3],
      ]),
      0,
      (k) => ({ ...k, goods: [3, 1, 0, 1] }),
    );
    expect(s.stacks.map((st) => st.top)).toEqual([36, 54]);
    const builds = legal(s, 0).filter((a) => a.type === 'build');
    expect(builds.filter((a) => a.type === 'build' && a.stack === 0)).toEqual([
      { type: 'build', actor: 0, stack: 0, pay: [2, 1, 0, 0] },
    ]);
    expect(
      builds
        .filter((a) => a.type === 'build' && a.stack === 1)
        .map((a) => (a as { pay: readonly number[] }).pay),
    ).toEqual([
      [3, 0, 0, 1],
      [3, 1, 0, 0],
    ]);
    expect(refused(s, { type: 'build', actor: 0, stack: 1, pay: [2, 1, 0, 1] })).toMatch(/price/);
    s = act(s, { type: 'build', actor: 0, stack: 1, pay: [3, 0, 0, 1] });
    expect(s.clans[0]?.score).toBe(15);
    expect(s.clans[0]?.monuments).toEqual([18]);
    expect(s.stacks[1]).toEqual({ built: 1, top: null });
    expect(pendingOf(s)).toEqual({ type: 'reveal', deck: 'camp', positions: [44] });
    expect(s.dealt.at(-1)).toEqual({ deck: 'camp', pos: 44, to: null });
    s = act(s, { type: 'reveal', actor: 'deck', deck: 'camp', pos: 44, card: s.order?.[44] as number });
    expect(s.stacks[1]?.top).toBe(s.order?.[44]);
    expect(refused(s, { type: 'build', actor: 0, stack: 0, pay: [2, 1, 0, 0] })).toMatch(/price/);
    s = act(s, { type: 'skip', actor: 0, spot: 'stack0' });
    expect(s.stacks[0]).toEqual({ built: 0, top: 36 });
  });
});
