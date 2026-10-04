// biome-ignore-all lint/style/noNonNullAssertion: test fixtures use known seats, positions and deck orders.
import { fuzzGame } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { LUSTER_POLICIES, lusterDeckOrder } from '../../../../tools/fuzz/src/luster.ts';
import { luster } from '../src/index.ts';
import { ORDERS, ready } from './helpers.ts';

describe('Luster encrypted packet adapter', () => {
  for (const seats of [2, 3, 4])
    it(`${seats} players: global positions, private claims and final full audit replay`, () => {
      for (let i = 0; i < 4; i++) {
        const r = fuzzGame(luster, {
          seed: `luster-packet-${seats}-${i}`,
          seats,
          rules: luster.defaultRules(),
          policies: LUSTER_POLICIES,
          deckOrder: lusterDeckOrder,
        });
        expect(r.failure, JSON.stringify(r.failure)).toBeNull();
        expect(r.outcome?.reason).toBe('radiance');
      }
    });
  it('rejects a cross-tier reveal and a cross-tier full-mode deck', () => {
    const s = luster.setup({ rules: luster.defaultRules(), seats: 2, mode: 'view', viewer: null });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(luster.apply(s.value, { type: 'reveal', actor: 'deck', deck: 'glass', pos: 0, card: 40 }).ok).toBe(
      false,
    );
    const order = [
      ...ORDERS['tier-1']!,
      ...ORDERS['tier-2']!.map((n) => n + 40),
      ...ORDERS['tier-3']!.map((n) => n + 70),
      ...ORDERS.patrons!.map((n) => n + 90),
    ];
    [order[0], order[40]] = [order[40] as number, order[0] as number];
    expect(
      luster.setup({ rules: luster.defaultRules(), seats: 2, mode: 'full', deckOrders: { glass: order } }).ok,
    ).toBe(false);
    expect(luster.dealt(ready()).some((d) => d.deck !== 'glass')).toBe(false);
  });
});
