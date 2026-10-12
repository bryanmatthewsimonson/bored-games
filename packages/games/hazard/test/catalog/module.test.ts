import { type FuzzPolicy, fuzzGame } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { applyAction, parseAction } from '../../src/engine.ts';
import { LINKS, neighbors, PROVINCES, type ProvinceId, REALMS } from '../../src/map.ts';
import { hazard } from '../../src/module.ts';
import type { HazardAction, HazardState } from '../../src/types.ts';
import { act, attacking, lastStand, opened, takeA2, withHand } from '../helpers.ts';

type Of<T extends HazardAction['type']> = Extract<HazardAction, { type: T }>;
const ofType = <T extends HazardAction['type']>(all: readonly HazardAction[], type: T): Of<T>[] =>
  all.filter((a): a is Of<T> => a.type === type);

/** A test driver that ends games: it masses troops on its biggest border stack and attacks with it. */
const pushy: FuzzPolicy<HazardState> = {
  name: 'pushy',
  choose(s, seat, legal, rng) {
    const all = legal as HazardAction[];
    const troops = (p: ProvinceId) => s.troops[PROVINCES.indexOf(p)] ?? 0;
    const border = (p: ProvinceId) => neighbors(p).some((n) => s.owner[PROVINCES.indexOf(n)] !== seat);
    const cash = ofType(all, 'cash')[0];
    if (cash) return cash;
    const musters = ofType(all, 'muster').filter((a) => a.count === s.pool && border(a.province));
    if (musters.length > 0)
      return musters.reduce((x, y) => (troops(y.province) > troops(x.province) ? y : x));
    const attacks = ofType(all, 'attack').filter(
      (a) => a.dice === Math.min(3, troops(a.from) - 1) && troops(a.from) > troops(a.to),
    );
    if (attacks.length > 0) return attacks.reduce((x, y) => (troops(y.from) > troops(x.from) ? y : x));
    const advance = ofType(all, 'advance');
    if (advance.length > 0) return advance.at(-1);
    const defend = ofType(all, 'defend');
    if (defend.length > 0) return defend.at(-1);
    const marches = ofType(all, 'march').filter((a) => !border(a.from) && a.count > 1);
    if (marches.length > 0) return marches.reduce((x, y) => (y.count > x.count ? y : x));
    return all.find((a) => a.type === 'endAttack' || a.type === 'endTurn') ?? rng.pick(all);
  },
};

describe('the module', () => {
  it('C32 every move has one accepted encoding, and junk is refused without throwing', () => {
    const s = withHand(opened(3), 0, [10, 11, 43]);
    const good = { type: 'cash', actor: 0, positions: [10, 11, 43], bonus: null };
    expect(parseAction(good)).toEqual(good);
    for (const bad of [
      { ...good, extra: 1 },
      { type: 'cash', actor: 0, positions: [11, 10, 43], bonus: null },
      { type: 'cash', actor: 0, positions: [10, 11, 43] },
      { type: 'cash', actor: '0', positions: [10, 11, 43], bonus: null },
      { type: 'cash', actor: -0, positions: [10, 11, 43], bonus: null },
      { type: 'cash', actor: 0, positions: [10, 11, 43], bonus: 'a10' },
      { type: 'muster', actor: 0, province: 'a1', count: 1.5 },
      { type: 'muster', actor: 0, province: 'A1', count: 1 },
      { type: 'rolled', actor: 'beacon', id: 0, dice: [7] },
      { type: 'rolled', actor: 0, id: 0, dice: [1] },
      { type: 'reveal', actor: 'deck', deck: 'other', pos: 1, card: 1 },
      null,
      [],
      'cash',
      42,
    ]) {
      expect(parseAction(bad), JSON.stringify(bad)).toBeNull();
      const r = applyAction(s, bad);
      expect(r.ok).toBe(false);
    }
    expect(hazard.validateIntent?.(s, 0, { type: 'muster', actor: 0, province: 'a2', count: 1 }).ok).toBe(
      false,
    );
    const placing = withHand(opened(3), 0, []);
    expect(
      hazard.validateIntent?.(placing, 0, { type: 'muster', actor: 0, province: 'a1', count: 2 }).ok,
    ).toBe(true);
    expect(
      hazard.validateIntent?.(placing, 1, { type: 'muster', actor: 0, province: 'a1', count: 2 }).ok,
    ).toBe(false);
  });

  it('validateIntent widens only the troop count of an offered move', () => {
    const ok = (s: HazardState, a: HazardAction) => hazard.validateIntent?.(s, a.actor as number, a).ok;
    // Two Spears and a Horse are no set; apply cannot tell (a view does not know the cards), the intent can.
    const pair = withHand(opened(3), 0, [0, 3, 1]);
    expect(ok(pair, { type: 'cash', actor: 0, positions: [0, 1, 3], bonus: null })).toBe(false);
    // A set showing a1, which seat 0 holds: the bonus must name a1.
    const set = withHand(opened(3), 0, [0, 1, 2]);
    expect(ok(set, { type: 'cash', actor: 0, positions: [0, 1, 2], bonus: null })).toBe(false);
    expect(ok(set, { type: 'cash', actor: 0, positions: [0, 1, 2], bonus: 'a2' })).toBe(false);
    // A march of any count between 1 and the most is a legal choice the list leaves out.
    const marching = act(attacking({ a1: [0, 6], a2: [0, 1] }), { type: 'endAttack', actor: 0 });
    expect(ok(marching, { type: 'march', actor: 0, from: 'a1', to: 'a2', count: 3 })).toBe(true);
    expect(ok(marching, { type: 'march', actor: 0, from: 'a1', to: 'a2', count: 6 })).toBe(false);
  });

  it('C33 a hand is hidden from the other seats, its size is not, and a conqueror and the loser both know it', () => {
    const s = withHand(withHand(lastStand(), 1, [10, 11]), 0, [5]);
    const mine = hazard.view(s, 0);
    expect(mine.hands[0]).toEqual([{ pos: 5, card: 5, holders: [0] }]);
    expect(mine.hands[1]?.map((x) => x.card)).toEqual([null, null]);
    expect(mine.plain).toBeNull();
    expect(
      hazard
        .view(s, null)
        .hands.flat()
        .every((x) => x.card === null),
    ).toBe(true);
    const t = takeA2(s).state;
    // The loser still knows the charters it held; the conqueror learns them when the sealed shares open.
    expect(hazard.view(t, 1).hands[0]?.map((x) => x.card)).toEqual([null, 10, 11]);
    expect(hazard.view(t, 2).hands[0]?.map((x) => x.card)).toEqual([null, null, null]);
    expect(hazard.knownTo(t, 0).map((l) => l.pos)).toEqual([5, 10, 11]);
    expect(hazard.knownTo(t, 1).map((l) => l.pos)).toEqual([10, 11]);
    const view0 = hazard.view(t, 0);
    const learned = hazard.learn(
      { ...view0, hands: view0.hands.map((h) => h.map((x) => (x.pos === 10 ? { ...x, card: null } : x))) },
      {
        deck: 'pile',
        pos: 10,
        card: 10,
      },
    );
    expect(learned.ok && learned.state.hands[0]?.find((x) => x.pos === 10)?.card).toBe(10);
    expect(hazard.learn(hazard.view(t, 2), { deck: 'pile', pos: 10, card: 10 }).ok).toBe(false);
    expect(hazard.invariants(t)).toEqual([]);
  });

  it('C34 the Meridian: 42 provinces in six realms, 83 links', () => {
    expect(PROVINCES).toHaveLength(42);
    expect(LINKS).toHaveLength(83);
    expect(REALMS.map((r) => [r.provinces.length, r.bonus])).toEqual([
      [9, 5],
      [4, 2],
      [7, 5],
      [6, 3],
      [12, 7],
      [4, 2],
    ]);
  });

  it('plays whole fuzzed games with sound states and views', () => {
    for (let i = 0; i < 3; i++) {
      const seats = 3;
      const r = fuzzGame(hazard, {
        seed: `smoke-${i}`,
        seats,
        rules: hazard.defaultRules(),
        policies: [pushy],
        maxSteps: 40_000,
      });
      expect(r.failure, JSON.stringify(r.failure)).toBeNull();
      expect(r.outcome?.reason).toBe('conquest');
    }
  });
});
