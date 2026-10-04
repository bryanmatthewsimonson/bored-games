// biome-ignore-all lint/style/noNonNullAssertion: constructed test fixtures use known seats and positions.
import { deepFreeze, range, stateHash } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { DECK_SIZES, PATRONS, TIER_DECKS, WORKSHOPS } from '../../src/data.ts';
import { bonuses, payments, score } from '../../src/engine.ts';
import { luster } from '../../src/module.ts';
import type { LusterAction } from '../../src/types.ts';
import { ANY, collection, holding, ORDERS, player, ready, revealAll, step } from '../helpers.ts';

describe('Luster base rules', () => {
  it('C01 exact components and setup for every player count', () => {
    expect(WORKSHOPS.map((t) => t.length)).toEqual([40, 30, 20]);
    for (const [i, tier] of WORKSHOPS.entries())
      for (let c = 0; c < 5; c++) expect(tier.filter((x) => x.bonus === c)).toHaveLength([8, 6, 4][i]!);
    expect(PATRONS).toHaveLength(10);
    expect(PATRONS.filter((p) => p.filter((n) => n === 4).length === 2)).toHaveLength(5);
    expect(PATRONS.filter((p) => p.filter((n) => n === 3).length === 3)).toHaveLength(5);
    expect(stateHash({ workshops: WORKSHOPS, patrons: PATRONS })).toBe('0145524f4bdc96');
    // Mixed-cost tier-two regression values, in ivory/azure/moss/rose/ink order.
    expect(WORKSHOPS[1]?.find((c) => c.bonus === 0 && c.points === 2 && c.cost[3] === 4)?.cost).toEqual([
      0, 0, 1, 4, 2,
    ]);
    expect(WORKSHOPS[1]?.find((c) => c.bonus === 1 && c.points === 2 && c.cost[4] === 4)?.cost).toEqual([
      2, 0, 0, 1, 4,
    ]);
    for (const seats of [2, 3, 4]) {
      const s = ready(seats);
      expect(s.supply).toEqual(
        Array(5)
          .fill(seats === 2 ? 4 : seats === 3 ? 5 : 7)
          .concat(5),
      );
      expect(s.market.map((row) => row.length)).toEqual([4, 4, 4]);
      expect(s.patrons).toHaveLength(seats + 1);
      expect(s.players.every((p) => p.bought.length === 0 && p.tokens.every((n) => n === 0))).toBe(true);
      expect(luster.invariants(s)).toEqual([]);
    }
  });
  it('C02 gathers distinct light or pairs with four in supply, then returns exactly the excess', () => {
    let s = ready();
    const a = { type: 'take', actor: 0, tokens: [1, 1, 1, 0, 0, 0] };
    expect(luster.apply(s, { ...a, tokens: [1, 1, 1, 1, 0, 0] }).ok).toBe(false);
    expect(luster.apply(s, { ...a, tokens: [0, 0, 0, 0, 0, 1] }).ok).toBe(false);
    expect(luster.apply(s, { ...a, tokens: [2, 1, 0, 0, 0, 0] }).ok).toBe(false);
    expect(luster.apply(s, { ...a, tokens: [2, 0, 0, 0, 0, 0] }).ok).toBe(true);
    expect(luster.apply(holding(s, 1, [1, 0, 0, 0, 0, 0]), { ...a, tokens: [2, 0, 0, 0, 0, 0] }).ok).toBe(
      false,
    );
    // Fewer than three colors while five are available: not under the published rule (C11), yes under `any`.
    expect(luster.apply(s, { ...a, tokens: [1, 0, 0, 0, 0, 0] }).ok).toBe(false);
    expect(luster.apply(ready(2, ANY), { ...a, tokens: [1, 0, 0, 0, 0, 0] }).ok).toBe(true);
    s = step(holding(s, 0, [2, 2, 2, 2, 1, 1]), a);
    expect(s.phase).toBe('return');
    expect(s.turn).toBe(0);
    expect(luster.apply(s, { type: 'return', actor: 0, tokens: [1, 1, 0, 0, 0, 0] }).ok).toBe(false);
    s = step(s, { type: 'return', actor: 0, tokens: [1, 1, 1, 0, 0, 0] });
    expect(s.players[0]?.tokens).toEqual([2, 2, 2, 2, 1, 1]);
    expect(s.turn).toBe(1);
    expect(luster.invariants(s)).toEqual([]);
  });
  it('C03 reserves public or blind cards up to three and grants available prisms', () => {
    let s = ready();
    const dealt = s.dealt;
    s = step(s, { type: 'reserve', actor: 0, deck: 'tier-1', pos: 0 });
    expect(s.players[0]?.tokens[5]).toBe(1);
    expect(s.players[0]?.reserved[0]?.private).toBe(false);
    expect(s.market[0]?.[0]).toMatchObject({ pos: 4, card: null });
    expect(s.dealt.slice(0, dealt.length)).toEqual(dealt);
    s = revealAll(s);
    s = step(s, { type: 'reserve', actor: 1, deck: 'tier-3', pos: 4 });
    expect(s.players[1]?.reserved[0]).toMatchObject({ card: 4, private: true });
    expect(s.decks['tier-3'].next).toBe(5);
    expect(s.market[2]?.map((h) => h?.pos)).toEqual([0, 1, 2, 3]);
    s = player(s, 0, {
      reserved: [
        s.players[0]!.reserved[0]!,
        s.players[1]!.reserved[0]!,
        { deck: 'tier-2', pos: 4, card: 4, private: true },
      ],
    });
    expect(luster.legalActions(s, 0).some((a: unknown) => (a as LusterAction).type === 'reserve')).toBe(
      false,
    );
    s = holding(ready(), 1, [0, 0, 0, 0, 0, 5]);
    expect(step(s, { type: 'reserve', actor: 0, deck: 'tier-1', pos: 0 }).players[0]?.tokens[5]).toBe(0);
  });
  it('C04 buys with permanent discounts and exact chosen prism substitution', () => {
    let s = holding(ready(), 0, [1, 0, 0, 0, 2, 2]);
    const ps = payments(s.players[0]!, 'tier-1', 1); // cost: 1 ivory + 2 ink
    expect(ps).toContainEqual([1, 0, 0, 0, 2, 0]);
    expect(ps).toContainEqual([0, 0, 0, 0, 2, 1]);
    expect(ps).toContainEqual([1, 0, 0, 0, 0, 2]);
    const a = { type: 'buy', actor: 0, deck: 'tier-1', pos: 1, card: 1, pay: [0, 0, 0, 0, 2, 1] };
    expect(luster.apply(s, { ...a, pay: [1, 0, 0, 0, 2, 1] }).ok).toBe(false);
    const old = JSON.stringify(s);
    const paid = step(deepFreeze(s), a);
    expect(JSON.stringify(s)).toBe(old);
    expect(bonuses(paid.players[0]!)).toEqual([0, 1, 0, 0, 0]);
    expect(paid.players[0]?.tokens).toEqual([1, 0, 0, 0, 0, 1]);
    expect(luster.invariants(revealAll(paid))).toEqual([]);
    s = player(ready(), 0, { bought: collection([0, 0, 0, 0, 3]) });
    expect(payments(s.players[0]!, 'tier-1', 0)).toEqual([[0, 0, 0, 0, 0, 0]]);
    s = step(s, { type: 'buy', actor: 0, deck: 'tier-1', pos: 0, card: 0, pay: [0, 0, 0, 0, 0, 0] });
    expect(s.turn).toBe(1);
    expect(bonuses(player(ready(), 0, { reserved: collection([2, 0, 0, 0, 0]) }).players[0]!)).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });
  it('C05 requires one free patron, with an explicit choice when several qualify', () => {
    let s = player(ready(2, ANY), 0, { bought: collection([4, 4, 4, 4, 4]) });
    s = step(s, { type: 'take', actor: 0, tokens: [1, 0, 0, 0, 0, 0] });
    expect(s.phase).toBe('patron');
    expect(s.turn).toBe(0);
    expect(luster.apply(s, { type: 'pass', actor: 0 }).ok).toBe(false);
    const before = score(s.players[0]!);
    const bs = bonuses(s.players[0]!);
    s = step(s, { type: 'patron', actor: 0, card: 0 });
    expect(s.turn).toBe(1);
    expect(score(s.players[0]!)).toBe(before + 3);
    expect(bonuses(s.players[0]!)).toEqual(bs);
    expect(s.patrons.some((p) => p.card === 0)).toBe(false);
    let one = player(ready(2, ANY), 0, { bought: collection([0, 0, 4, 4, 0]) });
    one = step(one, { type: 'take', actor: 0, tokens: [1, 0, 0, 0, 0, 0] });
    expect(one.players[0]?.patrons).toEqual([0]);
    expect(one.turn).toBe(1);
  });
  it('C06 finishes equal turns at fifteen and ranks by points then fewer workshops', () => {
    const valued = range(3).map((i) => ({
      deck: 'tier-3' as const,
      pos: 3 + i * 4,
      card: 3 + i * 4,
      private: false,
    }));
    let s = player(ready(2, ANY), 0, { bought: valued });
    s = player(s, 1, { bought: [...valued, ...collection([1, 0, 0, 0, 0])] });
    s = step(s, { type: 'take', actor: 0, tokens: [1, 0, 0, 0, 0, 0] });
    expect(s.finalRound).toBe(true);
    expect(s.result).toBeNull();
    expect(s.turn).toBe(1);
    s = step(s, { type: 'take', actor: 1, tokens: [1, 0, 0, 0, 0, 0] });
    expect(s.result).toEqual({ scores: [15, 15], places: [1, 2], reason: 'radiance' });
    let tie = player(player(ready(2, ANY), 0, { bought: valued }), 1, { bought: valued });
    tie = { ...tie, turn: 1 };
    tie = step(tie, { type: 'take', actor: 1, tokens: [1, 0, 0, 0, 0, 0] });
    expect(tie.result?.places).toEqual([1, 1]);
    let late = player(ready(4, ANY), 3, { bought: valued });
    late = { ...late, turn: 3 };
    late = step(late, { type: 'take', actor: 3, tokens: [1, 0, 0, 0, 0, 0] });
    expect(late.result?.places[3]).toBe(1);
  });
  it('C07 preserves private reservation ownership, redacts and audits identity claims', () => {
    let s = step(ready(), { type: 'reserve', actor: 0, deck: 'tier-1', pos: 4 });
    const mine = luster.view(s, 0);
    const other = luster.view(s, 1);
    const watching = luster.view(s, null);
    expect(mine.players[0]?.reserved[0]?.card).toBe(4);
    expect(other.players[0]?.reserved[0]?.card).toBeNull();
    expect(watching.players[0]?.reserved[0]?.card).toBeNull();
    const l = luster.knownTo(s, 0)[0]!;
    expect(l).toEqual({ deck: 'tier-1', pos: 4, card: 4 });
    expect(luster.learn(other, l).ok).toBe(false);
    expect(luster.learn(mine, { ...l, card: 5 }).ok).toBe(false);
    const fresh = luster.view(s, 0);
    const unknown = player(fresh, 0, {
      reserved: fresh.players[0]!.reserved.map((h) => ({ ...h, card: null })),
    });
    expect(luster.learn(unknown, l).ok).toBe(true);
    s = holding({ ...s, turn: 0 }, 0, [0, 1, 3, 1, 0, 1]);
    const a = { type: 'buy', actor: 0, deck: 'tier-1', pos: 4, card: 4, pay: [0, 1, 3, 1, 0, 0] };
    expect(luster.revealsOf(watching, a)).toEqual([l]);
    expect(luster.apply(s, { ...a, card: 5 }).ok).toBe(false);
    const next = step(s, a);
    expect(luster.dealt(next)).toEqual(luster.dealt(s));
    expect(luster.view(next, null).players[0]?.bought[0]?.card).toBe(4);
    const pub = step(ready(), { type: 'reserve', actor: 0, deck: 'tier-1', pos: 0 });
    expect(luster.view(pub, null).players[0]?.reserved[0]?.card).toBe(0);
    expect(luster.resignAllowed?.(s.rules, 3)).toBe(false);
  });
  it('C08 rejects malformed data and keeps all legal encodings deterministic', () => {
    const s = deepFreeze(ready());
    const before = JSON.stringify(s);
    const hostile = Object.defineProperty({}, 'type', {
      get() {
        throw new Error('hostile');
      },
    });
    for (const a of [
      null,
      [],
      {},
      5,
      hostile,
      { type: 'pass', actor: 0 },
      { type: 'take', actor: -0, tokens: [1, 0, 0, 0, 0, 0] },
      { type: 'take', actor: 0, tokens: [1, 0, 0, 0, 0, 0], extra: true },
    ]) {
      expect(luster.apply(s, a).ok).toBe(false);
      expect(luster.revealsOf(s, a)).toEqual([]);
    }
    expect(luster.validateRules({ target: 16 }).ok).toBe(false);
    expect(luster.validateRules({ target: 15, extra: true }).ok).toBe(false);
    expect(luster.validateRules({ target: 15, gems: 'some' }).ok).toBe(false);
    expect(luster.validateRules({ target: 15, gems: null }).ok).toBe(false);
    expect(luster.validateRules({ target: 15, gems: 'any', extra: true }).ok).toBe(false);
    expect(luster.setup({ rules: s.rules, seats: 5, mode: 'full', deckOrders: ORDERS }).ok).toBe(false);
    expect(
      luster.setup({
        rules: s.rules,
        seats: 2,
        mode: 'full',
        deckOrders: { ...ORDERS, 'tier-2': Array(30).fill(0) },
      }).ok,
    ).toBe(false);
    for (const a of luster.legalActions(s, 0) as LusterAction[]) {
      expect(luster.apply(s, a).ok, JSON.stringify(a)).toBe(true);
      expect(luster.apply(s, { ...a, actor: 1 }).ok).toBe(false);
    }
    const sparse = [...ORDERS['tier-1']!];
    delete sparse[3];
    expect(
      luster.setup({ rules: s.rules, seats: 2, mode: 'full', deckOrders: { ...ORDERS, 'tier-1': sparse } })
        .ok,
    ).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
    expect(luster.apply(s, { tokens: [1, 1, 1, 0, 0, 0], actor: 0, type: 'take' }).ok).toBe(true);
  });
  it('C09 exhausted tiers leave holes and buying a reservation frees capacity', () => {
    let s = ready();
    s = { ...s, decks: { ...s.decks, 'tier-1': { ...s.decks['tier-1'], next: DECK_SIZES['tier-1'] } } };
    s = step(s, { type: 'reserve', actor: 0, deck: 'tier-1', pos: 0 });
    expect(s.market[0]?.[0]).toBeNull();
    expect(s.decks['tier-1'].next).toBe(40);
    expect(luster.apply({ ...s, turn: 0 }, { type: 'reserve', actor: 0, deck: 'tier-1', pos: 40 }).ok).toBe(
      false,
    );
    s = holding({ ...s, turn: 0 }, 0, [0, 0, 0, 0, 3, 1]);
    s = step(s, { type: 'buy', actor: 0, deck: 'tier-1', pos: 0, card: 0, pay: [0, 0, 0, 0, 3, 0] });
    expect(s.players[0]?.reserved).toHaveLength(0);
    expect(TIER_DECKS).toHaveLength(3);
  });
});
