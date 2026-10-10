import type { FuzzPolicy } from '@bored-games/game-kit';
import { CARDS, type GiltAction, type GiltState } from '@bored-games/gilt-and-guile';
export const GILT_AND_GUILE_POLICIES: readonly FuzzPolicy<GiltState>[] = [
  {
    name: 'producer',
    choose(s, _seat, raw, rng) {
      const legal = raw as GiltAction[];
      const plays = legal.filter((a) => a.type === 'play');
      if (plays.length) return rng.pick(plays);
      const buys = legal.filter((a): a is Extract<GiltAction, { type: 'buy' | 'gain' }> => a.type === 'buy');
      if (buys.length) {
        const grandstage = buys.find((a) => a.kind === 'grandstage');
        if (grandstage) return grandstage;
        const useful = buys.filter(
          (a) => a.kind === 'banknote' || a.kind === 'endowment' || CARDS[a.kind].type === 'action',
        );
        if (useful.length) return [...useful].sort((a, b) => CARDS[b.kind].cost - CARDS[a.kind].cost)[0];
        if (s.supply.grandstage.length < 4) {
          const points = buys.filter((a) => CARDS[a.kind].points > 0);
          if (points.length) return points.at(-1);
        }
      }
      const next = legal.find((a) => a.type === 'next' || a.type === 'end' || a.type === 'done');
      return next ?? rng.pick(legal);
    },
  },
];
