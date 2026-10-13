import type { FuzzPolicy, Rng } from '@bored-games/game-kit';
import {
  type Clan,
  DISCOVERIES,
  MAX_FIELD,
  MAX_PEOPLE,
  monumentOf,
  monumentPayments,
  type Spot,
  type SticksAction,
  type SticksState,
} from '@bored-games/sticks-and-stones';

/**
 * Fuzzing policies for Sticks & Stones. Test drivers only, never players. Both read only public data and their own
 * legal actions, so they play the same on the full state (`pnpm fuzz`) and on a seat's view (`pnpm sim`).
 * - chief: grows the clan and the harvest while food allows, sends people to the discoveries and monuments it can
 *   pay for, gathers with the rest, buys and builds whatever it can, adds every tool, feeds with its cheapest goods.
 *   One move in eight is a random legal one, so rarer choices (passing a card up, a small hunt, hunger) are hit.
 * - hoarder: gathers and builds, but buys discoveries only at the cheapest slots and never feeds with goods.
 * Buying and building run the pile and the stacks down, so every game ends (D015).
 */

type Of<T extends SticksAction['type']> = Extract<SticksAction, { type: T }>;
const ofType = <T extends SticksAction['type']>(all: readonly SticksAction[], type: T): Of<T>[] =>
  all.filter((a): a is Of<T> => a.type === type);
const goodsOf = (c: Clan): number => c.goods.reduce((a, b) => a + b, 0);

function placeFor(
  s: SticksState,
  seat: number,
  all: Of<'place'>[],
  hoarder: boolean,
): SticksAction | undefined {
  const c = s.clans[seat] as Clan;
  const at = (spot: Spot) => all.filter((a) => a.spot === spot);
  const one = (spot: Spot) => at(spot)[0];
  const fed = c.food + c.field >= c.people + 2;
  if (c.people < MAX_PEOPLE && fed && one('hut')) return one('hut');
  if (c.field < MAX_FIELD && one('field')) return one('field');
  if (c.tools.length < 3 || Math.min(...c.tools) < 4) if (one('tools') && !hoarder) return one('tools');
  for (let k = 0; k < s.stacks.length; k++) {
    const top = s.stacks[k]?.top ?? null;
    const m = top === null ? undefined : monumentOf(top);
    const spot = `stack${k}` as Spot;
    if (m && monumentPayments(m, c.goods).length > 0 && one(spot)) return one(spot);
  }
  for (let slot = 3; slot >= 0; slot--) {
    const spot = `card${slot}` as Spot;
    if ((hoarder ? slot <= 1 : true) && goodsOf(c) >= slot + 1 && one(spot)) return one(spot);
  }
  if (c.food < c.people * 2 && at('hunt').length > 0) {
    const hunt = at('hunt');
    return hunt[Math.min(hunt.length - 1, 2)];
  }
  const grounds = (['gold', 'stone', 'brick', 'wood'] as Spot[]).flatMap((g) => at(g));
  if (grounds.length > 0) return grounds.reduce((x, y) => (y.count > x.count ? y : x));
  return at('hunt').at(-1);
}

function play(s: SticksState, seat: number, legal: readonly unknown[], rng: Rng, hoarder: boolean): unknown {
  const all = legal as SticksAction[];
  if (all.length === 1) return all[0];
  if (rng.int(8) === 0) return rng.pick(all);
  const c = s.clans[seat] as Clan;
  const choose = ofType(all, 'choose');
  if (choose.length > 0 && s.stage !== 'place') return choose.at(-1);
  if (s.stage === 'place') return placeFor(s, seat, ofType(all, 'place'), hoarder) ?? rng.pick(all);
  if (s.stage === 'tools') return all.at(-1);
  if (s.stage === 'pick') return ofType(all, 'pick').at(-1);
  if (s.stage === 'feed') {
    const pays = ofType(all, 'feed').filter((a) => a.pay !== null);
    return !hoarder && pays.length > 0 ? pays.at(-1) : all.find((a) => a.type === 'feed' && a.pay === null);
  }
  // Resolving: build the dearest monument, buy cards (food or goods tops first), then gather.
  const builds = ofType(all, 'build');
  if (builds.length > 0)
    return builds.reduce((x, y) =>
      y.pay.reduce((a, b) => a + b, 0) > x.pay.reduce((a, b) => a + b, 0) ? y : x,
    );
  const buys = ofType(all, 'buy');
  if (buys.length > 0) {
    const card = s.display[buys[0]?.slot ?? 0]?.card ?? null;
    const top = card === null ? undefined : DISCOVERIES[card]?.top;
    if (!(hoarder && top?.type === 'dice')) return buys[0];
  }
  const uses = ofType(all, 'use');
  if (uses.length > 0) return uses[0];
  return all.find((a) => a.type === 'skip') ?? (c.goods.length > 0 ? rng.pick(all) : all[0]);
}

export const STICKS_POLICIES: readonly FuzzPolicy<SticksState>[] = [
  { name: 'chief', choose: (s, seat, legal, rng) => play(s, seat, legal, rng, false) },
  { name: 'hoarder', choose: (s, seat, legal, rng) => play(s, seat, legal, rng, true) },
];

export const STICKS_EXPECTED_COVERAGE: readonly string[] = [
  'end:pile',
  'end:monuments',
  'move:hungry',
  'move:feedGoods',
  'move:drew',
  'move:picked',
  'move:tools',
  'move:cardRoll',
  'move:chose',
];
