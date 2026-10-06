import { BOARD } from './board.ts';
import { apply, COSTS, eligibleVictims, legalHearths, legalLinks, total, ZERO } from './engine.ts';
import type { Action, Goods, State } from './types.ts';

/** Reference-controller choices. Negotiated offers and discard drafts are validated separately by apply. */
export function choices(s: State): Action[] {
  const actor = s.actor,
    p = s.players[actor];
  if (!p || s.stage === 'chance' || s.stage === 'over') return [];
  const candidates: Action[] = [];
  if (s.stage === 'starting-roll' || s.stage === 'roll') candidates.push({ type: 'request-roll', actor });
  if (s.stage === 'setup-hearth' || s.stage === 'construct')
    for (const site of legalHearths(s, actor, s.stage === 'setup-hearth'))
      candidates.push({ type: 'hearth', actor, site });
  if (['setup-link', 'construct', 'free-links'].includes(s.stage))
    for (const lane of legalLinks(s, actor, s.stage === 'setup-link' ? s.setupSite : null))
      candidates.push({ type: 'link', actor, lane });
  if (s.stage === 'construct') {
    s.buildings.forEach((b, site) => {
      if (b?.seat === actor && !b.hub) candidates.push({ type: 'hub', actor, site });
    });
    candidates.push({ type: 'buy-venture', actor }, { type: 'end-turn', actor });
  }
  if (s.stage === 'trade') {
    candidates.push({ type: 'finish-trade', actor });
    for (let give = 0; give < 5; give++)
      for (let receive = 0; receive < 5; receive++) candidates.push({ type: 'bank', actor, give, receive });
  }
  if (s.stage === 'trade-answer') candidates.push({ type: 'accept', actor }, { type: 'decline', actor });
  if (s.stage === 'discard') {
    // A deterministic valid default; callers can submit any other exact half-hand draft.
    let remaining = Math.floor(total(p.goods) / 2);
    const discard = p.goods.map((n) => {
      const take = Math.min(n, remaining);
      remaining -= take;
      return take;
    }) as unknown as Goods;
    candidates.push({ type: 'discard', actor, goods: discard });
  }
  if (s.stage === 'squall')
    for (let island = 0; island < 19; island++) {
      const victims = eligibleVictims(s, island);
      candidates.push({ type: 'move-squall', actor, island, victim: null });
      for (const victim of victims) candidates.push({ type: 'move-squall', actor, island, victim });
    }
  if (['roll', 'trade', 'construct'].includes(s.stage))
    for (const v of p.ventures) {
      if (v.card < 16) candidates.push({ type: 'play', actor, pos: v.pos, goods: null, resource: null });
      else if (v.card < 18)
        if (s.windfall === 'available' && total(s.bank) < 2)
          candidates.push({ type: 'play', actor, pos: v.pos, goods: s.bank, resource: null });
        else
          for (let a = 0; a < 5; a++)
            for (let b = a; b < 5; b++)
              candidates.push({
                type: 'play',
                actor,
                pos: v.pos,
                goods: ZERO.map((_, i) => (i === a ? 1 : 0) + (i === b ? 1 : 0)) as unknown as Goods,
                resource: null,
              });
      else if (v.card < 20)
        for (let resource = 0; resource < 5; resource++)
          candidates.push({ type: 'play', actor, pos: v.pos, goods: null, resource });
    }
  return candidates.filter((a) => apply(s, a).ok);
}

/** Test/reference policy only: no game uses this to substitute for a human player. */
export function chooseForTest(s: State, actions: readonly Action[]): Action {
  const get = (type: Action['type']) => actions.filter((a) => a.type === type);
  const actor = s.actor;
  for (const type of ['hearth', 'hub'] as const) {
    const builds = get(type) as Extract<Action, { type: 'hearth' | 'hub' }>[];
    if (builds.length)
      return [...builds].sort((a, b) => {
        const yieldAt = (site: number) =>
          (BOARD.sites[site]?.islands ?? []).reduce(
            (n, i) => n + (s.terrain[i] === 5 ? 0 : 6 - Math.abs(7 - (s.yields[i] ?? 7))),
            0,
          );
        return yieldAt(b.site) - yieldAt(a.site) || a.site - b.site;
      })[0] as Action;
  }
  if (s.stage === 'trade') {
    const wanted =
      s.buildings.filter((b) => b?.seat === actor && !b.hub).length >= 3 ? COSTS.hub : COSTS.hearth;
    const exchange = (get('bank') as Extract<Action, { type: 'bank' }>[]).find(
      (a) =>
        (s.players[actor]?.goods[a.receive] ?? 0) < (wanted[a.receive] ?? 0) &&
        (s.players[actor]?.goods[a.give] ?? 0) > (wanted[a.give] ?? 0),
    );
    if (exchange) return exchange;
  }
  const venture = get('play')[0];
  if (venture) return venture;
  const link = get('link')[0];
  if (link) return link;
  const buy = get('buy-venture')[0];
  if (buy) return buy;
  const action = actions.find((a) => a.type !== 'decline') ?? actions[0];
  if (!action) throw new Error('No reference choice.');
  return action;
}
