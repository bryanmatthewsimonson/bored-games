import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  bonusPayouts,
  type ChainReactionState,
  chainReaction,
  compareCloseness,
  DEFAULT_RULES,
  legalActions,
  NEIGHBORS,
  pendingDecision,
  setupGame,
  sharePrice,
  splitUp100,
  TILE_COUNT,
  tileId,
  tileIndex,
  validateRules,
  viewFor,
} from '../src/index.ts';
import { act, dispose, endTurn, place, posOf, scenario } from './helpers.ts';

describe('tiles', () => {
  it('round-trips every tile id and rejects non-ids', () => {
    for (let i = 0; i < TILE_COUNT; i++) expect(tileIndex(tileId(i))).toBe(i);
    expect(tileId(0)).toBe('1A');
    expect(tileId(107)).toBe('12I');
    for (const bad of ['0A', '13A', '1J', 'a1', '1a', ' 1A', '01A', 7, null])
      expect(tileIndex(bad)).toBeNull();
  });

  it('has symmetric orthogonal neighbors', () => {
    for (let i = 0; i < TILE_COUNT; i++) {
      for (const n of NEIGHBORS[i] ?? []) expect(NEIGHBORS[n]).toContain(i);
    }
    expect(NEIGHBORS[tileIndex('1A') as number]?.map(tileId)).toEqual(['2A', '1B']);
    expect(NEIGHBORS[tileIndex('6E') as number]?.map(tileId)).toEqual(['6D', '5E', '7E', '6F']);
  });

  it('orders closeness to 1A row-first or column-first', () => {
    const t = (id: string) => tileIndex(id) as number;
    expect(compareCloseness('rowThenColumn', t('9A'), t('1B'))).toBeLessThan(0);
    expect(compareCloseness('rowThenColumn', t('2A'), t('2B'))).toBeLessThan(0);
    expect(compareCloseness('columnThenRow', t('1B'), t('9A'))).toBeLessThan(0);
    expect(compareCloseness('columnThenRow', t('8A'), t('8C'))).toBeLessThan(0);
  });
});

describe('pricing', () => {
  it('matches the reference price table exactly', () => {
    const sizes = [2, 3, 4, 5, 6, 10, 11, 20, 21, 30, 31, 40, 41, 60];
    const expected: Record<string, number[]> = {
      b1: [200, 300, 400, 500, 600, 600, 700, 700, 800, 800, 900, 900, 1000, 1000],
      s1: [300, 400, 500, 600, 700, 700, 800, 800, 900, 900, 1000, 1000, 1100, 1100],
      p1: [400, 500, 600, 700, 800, 800, 900, 900, 1000, 1000, 1100, 1100, 1200, 1200],
    };
    for (const [id, prices] of Object.entries(expected)) {
      const c = DEFAULT_RULES.chains.findIndex((x) => x.id === id);
      expect(sizes.map((n) => sharePrice(DEFAULT_RULES, c, n))).toEqual(prices);
    }
    expect(sharePrice(DEFAULT_RULES, 0, 0)).toBe(0);
    expect(sharePrice(DEFAULT_RULES, 0, 1)).toBe(0);
  });

  it('splits round up to $100', () => {
    expect(splitUp100(1500, 2)).toBe(800);
    expect(splitUp100(4500, 2)).toBe(2300);
    expect(splitUp100(1000, 3)).toBe(400);
    expect(splitUp100(9000, 2)).toBe(4500);
    expect(splitUp100(3000, 4)).toBe(800);
  });

  it('bonus payouts: properties', () => {
    const price = fc.constantFrom(...DEFAULT_RULES.tierPrices.premium, ...DEFAULT_RULES.tierPrices.budget);
    const holdings = fc.array(fc.integer({ min: 0, max: 25 }), { minLength: 3, maxLength: 6 });
    fc.assert(
      fc.property(holdings, price, (h, p) => {
        const out = bonusPayouts(DEFAULT_RULES, h, p);
        const total = out.reduce((s, x) => s + x.amount, 0);
        for (const x of out) {
          expect(h[x.seat]).toBeGreaterThan(0);
          expect(x.amount % 100).toBe(0);
        }
        if (h.every((v) => v === 0)) expect(out).toEqual([]);
        else {
          // Never less than both bonuses, never more than rounding can add.
          expect(total).toBeGreaterThanOrEqual(15 * p);
          expect(total).toBeLessThan(15 * p + 100 * out.length);
          const top = Math.max(...h);
          for (let s = 0; s < h.length; s++) {
            if (h[s] === top) expect(out.some((x) => x.seat === s)).toBe(true);
          }
        }
      }),
    );
  });
});

describe('rules validation', () => {
  it('accepts the defaults and rejects bad configurations', () => {
    expect(validateRules(DEFAULT_RULES).ok).toBe(true);
    expect(validateRules({ ...DEFAULT_RULES, minPlayers: 2 }).ok).toBe(false);
    expect(validateRules({ ...DEFAULT_RULES, extra: true }).ok).toBe(false);
    expect(validateRules({ ...DEFAULT_RULES, startingCash: 6050 }).ok).toBe(false);
    expect(
      validateRules({
        ...DEFAULT_RULES,
        chains: [
          { id: 'b1', tier: 'budget' },
          { id: 'b1', tier: 'budget' },
        ],
      }).ok,
    ).toBe(false);
    // There is no stall rule: games end only by declaration.
    expect(validateRules({ ...DEFAULT_RULES, stallRule: 'off' }).ok).toBe(false);
    expect(validateRules(null).ok).toBe(false);
  });
});

describe('protocol hooks', () => {
  const ORDER = Array.from({ length: TILE_COUNT }, (_, i) => (i * 37) % TILE_COUNT);

  function fresh(): ChainReactionState {
    const init = setupGame({ rules: DEFAULT_RULES, seats: 3, mode: 'full', deckOrders: { tiles: ORDER } });
    if (!init.ok) throw new Error(init.error.message);
    return init.value;
  }

  function started(): ChainReactionState {
    let s = fresh();
    for (let pos = 0; pos < 3; pos++) {
      s = act(s, { type: 'reveal', actor: 'deck', deck: 'tiles', pos, card: ORDER[pos] }).state;
    }
    return s;
  }

  it('dealt lists the setup positions as public and the hands in seat order, at setup', () => {
    const s = fresh();
    const hand = (seat: number) =>
      Array.from({ length: 6 }, (_, i) => ({ deck: 'tiles', pos: 3 + seat * 6 + i, to: seat }));
    const expected = [
      { deck: 'tiles', pos: 0, to: null },
      { deck: 'tiles', pos: 1, to: null },
      { deck: 'tiles', pos: 2, to: null },
      ...hand(0),
      ...hand(1),
      ...hand(2),
    ];
    expect(chainReaction.dealt(s)).toEqual(expected);
    expect(chainReaction.dealt(started())).toEqual(expected);
    const view = setupGame({ rules: DEFAULT_RULES, seats: 3, mode: 'view', viewer: 1 });
    expect(view.ok && chainReaction.dealt(view.value)).toEqual(expected);
  });

  it('dealt appends a drawn position to the seat that drew it, and keeps played positions', () => {
    let s = started();
    const seat = s.turn?.seat ?? -1;
    const before = chainReaction.dealt(s);
    for (let guard = 0; s.phase.kind !== 'buy' && guard < 20; guard++) {
      const p = pendingDecision(s);
      if (p.type !== 'player') throw new Error('expected a player decision');
      s = act(s, legalActions(s, p.seat)[0]).state;
    }
    const end = legalActions(s, seat).find(
      (a) => a.type === 'endTurn' && a.buy.length === 0 && !a.declareEnd,
    );
    s = act(s, end).state;
    expect(chainReaction.dealt(s)).toEqual([...before, { deck: 'tiles', pos: 21, to: seat }]);
    expect(chainReaction.dealt(viewFor(s, null))).toEqual(chainReaction.dealt(s));
  });

  it('revealsOf claims the placed tile and every discarded tile', () => {
    const s = scenario({ chains: { s1: '1A-11A', p1: '1C-11C' }, hands: ['5B 12I 1G'] });
    expect(chainReaction.revealsOf(s, place(s, 0, '12I'))).toEqual([
      { deck: 'tiles', pos: posOf(s, 0, '12I'), card: tileIndex('12I') },
    ]);
    const discard = endTurn(0, { discard: [{ pos: posOf(s, 0, '5B'), tile: '5B' }] });
    expect(chainReaction.revealsOf(s, discard)).toEqual([
      { deck: 'tiles', pos: posOf(s, 0, '5B'), card: tileIndex('5B') },
    ]);
    expect(chainReaction.revealsOf(s, endTurn(0))).toEqual([]);
    expect(chainReaction.revealsOf(s, { type: 'skipPlace', actor: 0 })).toEqual([]);
    expect(
      chainReaction.revealsOf(s, { type: 'reveal', actor: 'deck', deck: 'tiles', pos: 0, card: 0 }),
    ).toEqual([]);
  });

  it('revealsOf returns [] for anything it cannot parse, and never throws', () => {
    const s = started();
    const hostile = {
      get type(): string {
        throw new Error('boom');
      },
    };
    for (const junk of [
      { type: 'nonsense' },
      null,
      undefined,
      42,
      'place',
      [],
      { type: 'place', actor: 0, pos: 3, tile: 'Z9' },
      { type: 'place', actor: 0, pos: 3, tile: '1A', extra: true },
      { type: 'endTurn', actor: 0, buy: [], declareEnd: false, discard: [{ pos: 9, tile: 3 }] },
      hostile,
    ]) {
      expect(chainReaction.revealsOf(s, junk)).toEqual([]);
    }
  });

  it('standings on a fresh game give every seat its starting cash', () => {
    expect(chainReaction.standings(fresh())).toEqual([6000, 6000, 6000]);
    expect(chainReaction.standings(started())).toEqual([6000, 6000, 6000]);
  });

  it('standings apply final scoring to a copy, the same in every view, and equal the outcome at the end', () => {
    const s = scenario({
      chains: { s1: '1A-12A 1B-12B 1C-12C 1D-5D', b1: '1F-2F' },
      phase: 'buy',
      cash: [1000, 1000, 1000],
      shares: { s1: [10, 5, 0], b1: [0, 2, 1], p2: [0, 0, 3] },
    });
    const copy = structuredClone(s);
    expect(chainReaction.standings(s)).toEqual([23000, 14400, 2200]);
    expect(s).toEqual(copy);
    for (const viewer of [0, 1, 2, null]) {
      expect(chainReaction.standings(viewFor(s, viewer))).toEqual([23000, 14400, 2200]);
    }
    const over = applyAction(s, endTurn(0, { declareEnd: true }));
    if (!over.ok) throw new Error(over.error.message);
    expect(chainReaction.standings(over.state)).toEqual(chainReaction.outcome(over.state)?.scores);
  });

  it('standings do not repay the bonus of the defunct chain being disposed of', () => {
    // s1 (standard, 5 tiles) absorbs b1 (budget, 3 tiles): prices $600 and $300.
    const s = scenario({
      chains: { s1: '1A-5A', b1: '7A-9A' },
      hands: ['6A'],
      shares: { b1: [0, 2, 0], s1: [1, 0, 0] },
    });
    const merged = act(s, place(s, 0, '6A')).state;
    expect(merged.phase.kind === 'merger' && merged.phase.merger.holders).toEqual([1]);
    expect(merged.players.map((p) => p.cash)).toEqual([6000, 10500, 6000]); // b1 sole bonus 3000 + 1500 paid
    // Seat 0: s1 sole bonus 6000 + 3000, sells 1 x 600. Seat 1: no second b1 bonus, sells 2 x 300.
    expect(chainReaction.standings(merged)).toEqual([15600, 11100, 6000]);
    for (const viewer of [0, 1, 2, null]) {
      expect(chainReaction.standings(viewFor(merged, viewer))).toEqual([15600, 11100, 6000]);
    }
    // Merger complete: s1 has 9 tiles ($700), and b1 shares are worthless.
    const done = act(merged, dispose(1, 'b1', 0, 0)).state;
    expect(done.phase.kind).toBe('buy');
    expect(chainReaction.standings(done)).toEqual([6000 + 7000 + 3500 + 700, 10500, 6000]);
  });

  it('standings do not repay the bonus of a defunct chain already resolved in a multi-way merger', () => {
    // s1 (standard, 5 tiles, $600) absorbs p1 (premium, 4 tiles, $600) then b1 (budget, 3 tiles, $300).
    const s = scenario({
      chains: { s1: '5A-5D 6A', p1: '6E-9E', b1: '2E-4E' },
      hands: ['5E'],
      shares: { s1: [3, 0, 0], p1: [0, 2, 0], b1: [0, 0, 2] },
    });
    // Seat 0: s1 sole bonus 6000 + 3000, sells 3 x 600. Seat 1: p1 bonus 9000 already paid, sells 2 x 600.
    // Seat 2: b1 bonus 3000 + 1500 (paid now or already), sells 2 x 300.
    const expected = [6000 + 9000 + 1800, 6000 + 9000 + 1200, 6000 + 4500 + 600];
    const placed = act(s, place(s, 0, '5E')).state;
    expect(placed.players.map((p) => p.cash)).toEqual([6000, 15000, 6000]);
    expect(chainReaction.standings(placed)).toEqual(expected);
    // Seat 1 keeps its p1 shares; p1 is resolved but its cells stay until the merger completes.
    const p1Resolved = act(placed, dispose(1, 'p1', 0, 0)).state;
    const m = p1Resolved.phase.kind === 'merger' ? p1Resolved.phase.merger : null;
    expect(m?.defuncts?.map((c) => DEFAULT_RULES.chains[c]?.id)).toEqual(['b1']);
    expect(m?.holders).toEqual([2]);
    expect(p1Resolved.players.map((p) => p.cash)).toEqual([6000, 15000, 10500]);
    expect(chainReaction.standings(p1Resolved)).toEqual(expected);
  });
});
