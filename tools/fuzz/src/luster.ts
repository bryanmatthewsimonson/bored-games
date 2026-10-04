import { type DeckSpec, type FuzzPolicy, type Rng, range, shuffle } from '@bored-games/game-kit';
import {
  bonuses,
  DECK_OFFSETS,
  LUSTER_DECK,
  type LusterAction,
  type LusterPlayer,
  type LusterState,
  workshop,
} from '@bored-games/luster';

/** Test driver only: prefer purchases, then gather toward a cheap visible or reserved workshop. */
export const LUSTER_POLICIES: readonly FuzzPolicy<LusterState>[] = [
  {
    name: 'glassmaker',
    choose(s, seat, raw, rng) {
      const legal = raw as readonly LusterAction[];
      const buys = legal.filter((a): a is Extract<LusterAction, { type: 'buy' }> => a.type === 'buy');
      if (buys.length)
        return [...buys].sort(
          (a, b) =>
            (workshop(b.deck, b.card)?.points ?? 0) - (workshop(a.deck, a.card)?.points ?? 0) ||
            (a.pay[5] ?? 0) - (b.pay[5] ?? 0),
        )[0];
      const p = s.players[seat] as LusterPlayer;
      const bs = bonuses(p);
      const costs = [...s.market.flat(), ...p.reserved].flatMap((h) => {
        if (h?.card === null || !h) return [];
        const c = workshop(h.deck, h.card);
        return c ? [c.cost.map((n, i) => Math.max(0, n - (bs[i] ?? 0)))] : [];
      });
      const gap = (xs: number[]) => xs.reduce((n, x, i) => n + Math.max(0, x - (p.tokens[i] ?? 0)), 0);
      const target = costs.sort(
        (a, b) => gap(a) - gap(b) || a.reduce((x, y) => x + y, 0) - b.reduce((x, y) => x + y, 0),
      )[0] ?? [1, 1, 1, 1, 1];
      const takes = legal.filter((a): a is Extract<LusterAction, { type: 'take' }> => a.type === 'take');
      const useful = (a: Extract<LusterAction, { type: 'take' }>) =>
        a.tokens.reduce((n, x, i) => n + Math.min(x, Math.max(0, (target[i] ?? 0) - (p.tokens[i] ?? 0))), 0);
      takes.sort(
        (a, b) =>
          useful(b) - useful(a) || b.tokens.reduce((x, y) => x + y, 0) - a.tokens.reduce((x, y) => x + y, 0),
      );
      if (takes[0] && useful(takes[0]) > 0) return takes[0];
      const returns = legal.filter(
        (a): a is Extract<LusterAction, { type: 'return' }> => a.type === 'return',
      );
      if (returns.length)
        return [...returns].sort((a, b) => {
          const loss = (a: Extract<LusterAction, { type: 'return' }>) =>
            a.tokens.reduce(
              (n, x, i) =>
                n + Math.max(0, x - Math.max(0, (p.tokens[i] ?? 0) - (i === 5 ? 5 : (target[i] ?? 0)))),
              0,
            );
          return loss(a) - loss(b);
        })[0];
      const reserve = legal.filter((a) => a.type === 'reserve');
      if (reserve.length && (p.tokens[5] ?? 0) < 3) return rng.pick(reserve);
      return rng.pick(legal);
    },
  },
];
export const LUSTER_EXPECTED_COVERAGE = [
  'move:take',
  'move:reserve',
  'move:buy',
  'move:return',
  'move:patron',
  'end:radiance',
];

export function lusterDeckOrder(_deck: DeckSpec, rng: Rng): number[] {
  return LUSTER_DECK.partitions.flatMap((p) =>
    shuffle(
      range(p.size).map((n) => n + DECK_OFFSETS[p.id as keyof typeof DECK_OFFSETS]),
      rng,
    ),
  );
}
