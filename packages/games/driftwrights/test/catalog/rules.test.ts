import { describe, expect, it } from 'vitest';
import { BOARD, neighbors } from '../../src/board.ts';
import {
  apply,
  bankRate,
  COSTS,
  invariants,
  legalHearths,
  legalLinks,
  parseAction,
  prestige,
  setup,
  spacing,
  total,
  trailLength,
  view,
  ZERO,
} from '../../src/engine.ts';
import type { State } from '../../src/types.ts';
import { complete, fresh, hands, ready, started, step, venture } from '../helpers.ts';

describe('Driftwrights classic rules', () => {
  it('C01 validates seats, terrain counts and venture permutation', () => {
    expect(setup(2, []).ok).toBe(false);
    expect(
      setup(
        5,
        Array.from({ length: 25 }, (_, i) => i),
      ).ok,
    ).toBe(false);
    expect(setup(3, Array(25).fill(0)).ok).toBe(false);
    expect(fresh(4).seats).toBe(4);
  });
  it('C02 preserves the 19-region, 54-site, 72-lane network', () => {
    expect(BOARD.islands).toHaveLength(19);
    expect(BOARD.sites).toHaveLength(54);
    expect(BOARD.lanes).toHaveLength(72);
    expect(BOARD.moorings).toHaveLength(9);
    expect(BOARD.moorings.filter((m) => m.resource === null)).toHaveLength(4);
    expect(
      new Set(
        BOARD.moorings.flatMap((m) => {
          const l = BOARD.lanes[m.lane];
          return l ? [l.a, l.b] : [];
        }),
      ).size,
    ).toBe(18);
  });
  it('C03 highest starting roll wins and tied leaders reroll', () => {
    let s = fresh();
    for (let seat = 0; seat < 3; seat++) {
      s = step(s, { type: 'request-roll', actor: seat });
      s = step(s, { type: 'dice', actor: 'entropy', faces: seat < 2 ? [6, 6] : [1, 1] });
    }
    expect(s.opening).toEqual([0, 1]);
    s = step(s, { type: 'request-roll', actor: 0 });
    s = step(s, { type: 'dice', actor: 'entropy', faces: [2, 2] });
    s = step(s, { type: 'request-roll', actor: 1 });
    s = step(s, { type: 'dice', actor: 'entropy', faces: [3, 3] });
    expect(s.starter).toBe(1);
    expect(s.setupOrder).toEqual([1, 2, 0, 0, 2, 1]);
  });
  it('C04 setup uses forward then reverse placement without costs', () => {
    const s = started(4);
    expect(s.setupOrder).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
    const r = ready(4);
    expect(r.links.filter((n) => n !== null)).toHaveLength(8);
    expect(r.buildings.filter(Boolean)).toHaveLength(8);
    expect(r.stage).toBe('roll');
    expect(invariants(r)).toEqual([]);
  });
  it('C05 hearths require vacant neighboring sites, including own buildings', () => {
    let s = started();
    const site = legalHearths(s, 0, true)[0] as number;
    s = step(s, { type: 'hearth', actor: 0, site });
    for (const n of neighbors(site)) expect(spacing(s, n)).toBe(false);
    expect(spacing(s, site)).toBe(false);
  });
  it('C06 starting supplies come only from the second hearth', () => {
    let s = started();
    for (let i = 0; i < 6; i++) {
      const seat = s.actor,
        site = legalHearths(s, seat, true)[0] as number;
      const before = total(s.players[seat]?.goods ?? ZERO);
      s = step(s, { type: 'hearth', actor: seat, site });
      const gained = total(s.players[seat]?.goods ?? ZERO) - before;
      expect(gained).toBe(
        i < 3 ? 0 : (BOARD.sites[site]?.islands.filter((j) => s.terrain[j] !== 5).length ?? 0),
      );
      s = step(s, { type: 'link', actor: seat, lane: legalLinks(s, seat, site)[0] as number });
    }
  });
  it('C07 production pays every adjacent hearth and twice per hub', () => {
    let s = hands(ready(), [ZERO, ZERO, ZERO]);
    const site = s.buildings.findIndex((b) => b?.seat === 0);
    s = { ...s, buildings: s.buildings.map((b, i) => (i === site ? { seat: 0, hub: true } : b)) };
    const island = BOARD.sites[site]?.islands.find((i) => s.terrain[i] !== 5) as number,
      number = s.yields[island] as number;
    const resource = s.terrain[island] as number;
    s = step(s, { type: 'request-roll', actor: 0 });
    s = step(s, { type: 'dice', actor: 'entropy', faces: number <= 7 ? [1, number - 1] : [6, number - 6] });
    expect(s.players[0]?.goods[resource]).toBeGreaterThanOrEqual(2);
  });
  it('C08 the Squall blocks only its occupied island', () => {
    let s = hands(ready(), [ZERO, ZERO, ZERO]);
    const site = s.buildings.findIndex((b) => b?.seat === 0);
    const island = BOARD.sites[site]?.islands.find((i) => s.terrain[i] !== 5) as number;
    const n = s.yields[island] as number;
    s = { ...s, squall: island };
    s = step(s, { type: 'request-roll', actor: 0 });
    s = step(s, { type: 'dice', actor: 'entropy', faces: n <= 7 ? [1, n - 1] : [6, n - 6] });
    const blocked = s.terrain[island] as number;
    const other = (BOARD.sites[site]?.islands ?? []).filter(
      (i) => i !== island && s.terrain[i] === blocked && s.yields[i] === n,
    ).length;
    expect(s.players[0]?.goods[blocked]).toBe(other);
  });
  it('C09 scarce production cancels multi-player demand but partially pays a sole claimant', () => {
    let s = hands(ready(), [[19, 0, 0, 0, 0], ZERO, ZERO]);
    s = {
      ...s,
      terrain: s.terrain.map((_, i) => (i === 18 ? 5 : 0)),
      yields: s.yields.map((n) => (n === null ? null : 6)),
    };
    s = step(s, { type: 'request-roll', actor: 0 });
    s = step(s, { type: 'dice', actor: 'entropy', faces: [3, 3] });
    expect(s.players[1]?.goods[0]).toBe(0);
    let one = hands(ready(), [[18, 0, 0, 0, 0], ZERO, ZERO]);
    one = {
      ...one,
      buildings: one.buildings.map((b) => (b?.seat === 0 ? { seat: 0, hub: true } : null)),
      terrain: one.terrain.map((_, i) => (i === 18 ? 5 : 0)),
      yields: one.yields.map((n) => (n === null ? null : 6)),
    };
    one = step(one, { type: 'request-roll', actor: 0 });
    one = step(one, { type: 'dice', actor: 'entropy', faces: [3, 3] });
    expect(one.players[0]?.goods[0]).toBe(19);
  });
  it('C10 a seven discards only hands over seven, rounding down', () => {
    let s = hands(ready(), [[7, 0, 0, 0, 0], [0, 9, 0, 0, 0], ZERO]);
    s = step(s, { type: 'request-roll', actor: 0 });
    s = step(s, { type: 'dice', actor: 'entropy', faces: [3, 4] });
    expect(s.actor).toBe(1);
    expect(apply(s, { type: 'discard', actor: 1, goods: [0, 5, 0, 0, 0] }).ok).toBe(false);
    s = step(s, { type: 'discard', actor: 1, goods: [0, 4, 0, 0, 0] });
    expect(s.stage).toBe('squall');
    expect(total(s.players[0]?.goods ?? ZERO)).toBe(7);
  });
  it('C11 the Squall must move and theft targets must border its new island', () => {
    const s = { ...ready(), stage: 'squall' as const, resume: 'trade' as const };
    expect(apply(s, { type: 'move-squall', actor: 0, island: s.squall, victim: null }).ok).toBe(false);
    expect(apply(s, { type: 'move-squall', actor: 0, island: 0, victim: 0 }).ok).toBe(false);
  });
  it('C12 theft maps each uniformly selected slot to exactly one owned resource', () => {
    const s = {
      ...hands(ready(), [ZERO, [2, 0, 1, 0, 0], ZERO]),
      stage: 'chance' as const,
      chance: { kind: 'theft' as const, thief: 0, victim: 1, size: 3 },
      resume: 'trade' as const,
    };
    const got = [0, 1, 2].map(
      (index) => step(s, { type: 'theft', actor: 'entropy', index }).players[0]?.goods,
    );
    expect(got).toEqual([
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [0, 0, 1, 0, 0],
    ]);
    expect(apply(s, { type: 'theft', actor: 'entropy', index: 3 }).ok).toBe(false);
  });
  it('C13 bank trading consumes matching supplies and checks stock', () => {
    const s = { ...hands(ready(), [[4, 0, 0, 0, 0], ZERO, ZERO]), stage: 'trade' as const };
    const rate = bankRate(s, 0, 0);
    const n = step(s, { type: 'bank', actor: 0, give: 0, receive: 4 });
    expect(n.players[0]?.goods).toEqual([4 - rate, 0, 0, 0, 1]);
    expect(apply(s, { type: 'bank', actor: 0, give: 0, receive: 0 }).ok).toBe(false);
  });
  it('C14 moorings require a hearth or hub on either marked endpoint', () => {
    let s = ready();
    const m = BOARD.moorings.find((m) => m.resource === 0);
    if (!m) throw new Error('mooring');
    const l = BOARD.lanes[m.lane];
    if (!l) throw new Error('lane');
    s = { ...s, buildings: Array(54).fill(null), links: s.links.map((_, i) => (i === m.lane ? 0 : null)) };
    expect(bankRate(s, 0, 0)).toBe(4);
    for (const site of [l.a, l.b]) {
      const at = { ...s, buildings: s.buildings.map((b, i) => (i === site ? { seat: 0, hub: false } : b)) };
      expect(bankRate(at, 0, 0)).toBe(2);
      expect(bankRate(at, 0, 1)).toBe(4);
    }
  });
  it('C15 negotiated exchanges transfer only supplies after the partner accepts', () => {
    const s = { ...hands(ready(), [[1, 0, 0, 0, 0], [0, 1, 0, 0, 0], ZERO]), stage: 'trade' as const };
    const offer = {
      type: 'offer' as const,
      actor: 0,
      to: 1,
      give: [1, 0, 0, 0, 0] as const,
      receive: [0, 1, 0, 0, 0] as const,
    };
    const pending = step(s, offer);
    expect(pending.actor).toBe(1);
    const n = step(pending, { type: 'accept', actor: 1 });
    expect(n.players[0]?.goods).toEqual([0, 1, 0, 0, 0]);
    expect(n.players[1]?.goods).toEqual([1, 0, 0, 0, 0]);
    expect(step(pending, { type: 'decline', actor: 1 }).players).toEqual(s.players);
    expect(apply(s, { ...offer, to: 2, receive: [1, 0, 0, 0, 0] }).ok).toBe(false);
  });
  it('C16 construction recipes and finite piece limits are enforced', () => {
    let s: State = { ...hands(ready(), [[3, 3, 3, 3, 3], ZERO, ZERO]), stage: 'construct' as const };
    const lane = legalLinks(s, 0)[0] as number;
    s = step(s, { type: 'link', actor: 0, lane });
    expect(s.players[0]?.goods).toEqual([2, 2, 3, 3, 3]);
    expect(COSTS.hearth).toEqual([1, 1, 1, 1, 0]);
    expect(COSTS.hub).toEqual([0, 0, 0, 2, 3]);
    const full = { ...s, links: s.links.map((_, i) => (i < 15 ? 0 : null)) };
    expect(legalLinks(full, 0)).toEqual([]);
  });
  it('C17 new links connect to the owner and cannot extend through rival buildings', () => {
    const s = ready();
    const lane = BOARD.lanes.findIndex((_, i) => !legalLinks(s, 0).includes(i) && s.links[i] === null);
    expect(apply({ ...s, stage: 'construct' as const }, { type: 'link', actor: 0, lane }).ok).toBe(false);
    const own = s.links.indexOf(0),
      edge = BOARD.lanes[own];
    if (!edge) throw new Error('edge');
    const cut = {
      ...s,
      buildings: s.buildings.map((_, i) => (i === edge.a || i === edge.b ? { seat: 1, hub: false } : null)),
      links: s.links.map((_, i) => (i === own ? 0 : null)),
    };
    expect(legalLinks(cut, 0)).toEqual([]);
  });
  it('C18 a hub replaces an owned hearth and frees its piece', () => {
    let s: State = { ...hands(ready(), [[0, 0, 0, 2, 3], ZERO, ZERO]), stage: 'construct' as const };
    const site = s.buildings.findIndex((b) => b?.seat === 0);
    const before = prestige(s, 0);
    s = step(s, { type: 'hub', actor: 0, site });
    expect(s.buildings[site]?.hub).toBe(true);
    expect(prestige(s, 0)).toBe(before + 1);
    expect(total(s.players[0]?.goods ?? ZERO)).toBe(0);
  });
  it('C19 ventures draw the next shuffled card and cannot exceed 25', () => {
    let s: State = { ...hands(ready(), [[0, 0, 1, 1, 1], ZERO, ZERO]), stage: 'construct' as const };
    s = step(s, { type: 'buy-venture', actor: 0 });
    expect(s.players[0]?.ventures[0]).toEqual({ pos: 0, card: 0, bought: 0 });
    expect(apply({ ...s, ventureNext: 25 }, { type: 'buy-venture', actor: 0 }).ok).toBe(false);
  });
  it('C20 one action venture per turn and no play on its purchase turn', () => {
    const s = venture(ready(), 0, 0);
    expect(apply(s, { type: 'play', actor: 0, pos: 0, goods: null, resource: null }).ok).toBe(false);
    expect(
      apply(
        { ...s, turnNo: 1, actionPlayed: true },
        { type: 'play', actor: 0, pos: 0, goods: null, resource: null },
      ).ok,
    ).toBe(false);
  });
  it('C21 Gale Guides move the Squall without forcing discards and can precede the roll', () => {
    const s = venture(hands(ready(), [[9, 0, 0, 0, 0], ZERO, ZERO]), 0);
    const n = step(s, { type: 'play', actor: 0, pos: 0, goods: null, resource: null });
    expect(n.stage).toBe('squall');
    expect(n.resume).toBe('roll');
    expect(n.players[0]?.guides).toBe(1);
    expect(total(n.players[0]?.goods ?? ZERO)).toBe(9);
  });
  it('C22 Twin Links places two free connected links or one when only one remains', () => {
    let s = venture(ready(), 14);
    s = step(s, { type: 'play', actor: 0, pos: 0, goods: null, resource: null });
    const before = s.players[0]?.goods;
    s = step(s, { type: 'link', actor: 0, lane: legalLinks(s, 0)[0] as number });
    expect(s.stage).toBe('free-links');
    s = step(s, { type: 'link', actor: 0, lane: legalLinks(s, 0)[0] as number });
    expect(s.stage).toBe('roll');
    expect(s.players[0]?.goods).toEqual(before);
    let last = venture(ready(), 14);
    const remaining = legalLinks(last, 0)[0] as number;
    const own = last.links.flatMap((owner, i) => (owner === 0 ? [i] : []));
    const fourteen = [
      ...own,
      ...last.links.flatMap((owner, i) => (owner === null && i !== remaining ? [i] : [])),
    ].slice(0, 14);
    last = { ...last, links: last.links.map((owner, i) => (fourteen.includes(i) ? 0 : owner)) };
    last = step(last, { type: 'play', actor: 0, pos: 0, goods: null, resource: null });
    last = step(last, { type: 'link', actor: 0, lane: remaining });
    expect(last.links.filter((owner) => owner === 0)).toHaveLength(15);
    expect(last.stage).toBe('roll');
    expect(last.freeLinks).toBe(0);
  });
  it('C23 Supply Windfall takes exactly two available cards of either type', () => {
    const s = venture(hands(ready(), [ZERO, ZERO, ZERO]), 16);
    const n = step(s, { type: 'play', actor: 0, pos: 0, goods: [0, 0, 0, 2, 0], resource: null });
    expect(n.players[0]?.goods[3]).toBe(2);
    expect(apply(s, { type: 'play', actor: 0, pos: 0, goods: [0, 0, 0, 1, 0], resource: null }).ok).toBe(
      false,
    );
  });
  it('C24 Guild Requisition collects every rival card of its named resource', () => {
    const s = venture(
      hands(ready(), [
        [1, 0, 0, 0, 0],
        [2, 1, 0, 0, 0],
        [3, 0, 0, 0, 0],
      ]),
      18,
    );
    const n = step(s, { type: 'play', actor: 0, pos: 0, goods: null, resource: 0 });
    expect(n.players.map((p) => p.goods[0])).toEqual([6, 0, 0]);
    expect(n.bank).toEqual(s.bank);
  });
  it('C33 a table chooses how Supply Windfall handles fewer than two supplies in the bank', () => {
    const scarce = venture(hands(ready(), [ZERO, [18, 19, 19, 19, 19], ZERO]), 16);
    const one = { type: 'play', actor: 0, pos: 0, goods: [1, 0, 0, 0, 0], resource: null } as const;
    expect(apply({ ...scarce, windfall: 'two' }, one).ok).toBe(false);
    const took = step({ ...scarce, windfall: 'available' }, one);
    expect(took.bank).toEqual(ZERO);
    expect(took.players[0]?.goods).toEqual([1, 0, 0, 0, 0]);
    const empty = venture(hands(ready(), [ZERO, [19, 19, 19, 19, 19], ZERO]), 16);
    expect(step({ ...empty, windfall: 'available' }, { ...one, goods: ZERO }).players[0]?.goods).toEqual(
      ZERO,
    );
    expect(apply({ ...scarce, windfall: 'available' }, { ...one, goods: ZERO }).ok).toBe(false);
  });
  it('C25 landmarks count immediately but have no playable action', () => {
    const s = venture(ready(), 20, 0);
    expect(prestige(s, 0)).toBe(3);
    expect(apply(s, { type: 'play', actor: 0, pos: 0, goods: null, resource: null }).ok).toBe(false);
    expect(prestige(s, 0, false)).toBe(2);
  });
  it('C26 Grand Span requires five links and incumbent ties retain it', () => {
    const base = ready();
    const path: number[] = [];
    let at = 0,
      used = new Set<number>();
    while (path.length < 6) {
      const i = BOARD.lanes.findIndex((e, i) => !used.has(i) && (e.a === at || e.b === at));
      if (i < 0) throw new Error('path');
      const e = BOARD.lanes[i];
      if (!e) throw new Error('edge');
      path.push(i);
      used.add(i);
      at = e.a === at ? e.b : e.a;
    }
    const s = {
      ...base,
      buildings: Array(54).fill(null),
      links: base.links.map((_, i) => (path.slice(0, 5).includes(i) ? 0 : null)),
      stage: 'trade' as const,
    };
    const n = step(s, { type: 'finish-trade', actor: 0 });
    expect(n.span).toBe(0);
    expect(trailLength(n, 0)).toBe(5);
    const routes = [0, 4, 8].map((island) => {
      const sites = BOARD.islands[island]?.sites ?? [];
      return BOARD.lanes
        .flatMap((e, i) => (sites.includes(e.a) && sites.includes(e.b) ? [i] : []))
        .slice(0, 5);
    });
    const tied: State = {
      ...s,
      span: 0,
      links: s.links.map((_, i) => {
        const owner = routes.findIndex((route) => route.includes(i));
        return owner < 0 ? null : owner;
      }),
    };
    expect(tied.players.map((_, i) => trailLength(tied, i))).toEqual([5, 5, 5]);
    expect(step(tied, { type: 'finish-trade', actor: 0 }).span).toBe(0);
    const lost: State = {
      ...tied,
      links: tied.links.map((owner, i) => (i === routes[0]?.[0] ? null : owner)),
    };
    expect(step(lost, { type: 'finish-trade', actor: 0 }).span).toBe(null);
    const unique: State = {
      ...lost,
      links: lost.links.map((owner, i) => (i === routes[2]?.[0] ? null : owner)),
    };
    expect(step(unique, { type: 'finish-trade', actor: 0 }).span).toBe(1);
  });
  it('C27 trail counting handles loops and stops at rival sites', () => {
    const s = ready();
    const island = BOARD.islands[0];
    if (!island) throw new Error('island');
    const loop = BOARD.lanes.flatMap((e, i) =>
      island.sites.includes(e.a) && island.sites.includes(e.b) ? [i] : [],
    );
    let n = {
      ...s,
      buildings: Array(54).fill(null),
      links: s.links.map((_, i) => (loop.includes(i) ? 0 : null)),
    };
    expect(trailLength(n, 0)).toBe(6);
    const site = island.sites[0] as number;
    n = { ...n, buildings: n.buildings.map((b, i) => (i === site ? { seat: 1, hub: false } : b)) };
    expect(trailLength(n, 0)).toBe(6);
    const opposite = island.sites[3] as number;
    n = { ...n, buildings: n.buildings.map((b, i) => (i === opposite ? { seat: 1, hub: false } : b)) };
    expect(trailLength(n, 0)).toBe(3);
  });
  it('C28 Stormwatch requires three played Guides and changes only to a larger count', () => {
    const s = {
      ...ready(),
      stage: 'trade' as const,
      watch: 0,
      players: ready().players.map((p, i) => ({ ...p, guides: i < 2 ? 3 : 0 })),
    };
    expect(step(s, { type: 'finish-trade', actor: 0 }).watch).toBe(0);
    const more = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, guides: 4 } : p)) };
    expect(step(more, { type: 'finish-trade', actor: 0 }).watch).toBe(1);
  });
  it('C29 ten points end only on the owner turn, including a newly bought landmark', () => {
    let s = ready();
    const first = s.buildings.findIndex((b) => b?.seat === 0);
    s = { ...s, buildings: s.buildings.map((b, i) => (i === first ? { seat: 0, hub: true } : b)) };
    while (s.buildings.filter((b) => b?.seat === 0).length < 5) {
      const site = BOARD.sites.findIndex((_, i) => spacing(s, i));
      s = { ...s, buildings: s.buildings.map((b, i) => (i === site ? { seat: 0, hub: true } : b)) };
    }
    s = {
      ...hands(s, [[0, 0, 1, 1, 1], ZERO, ZERO]),
      stage: 'construct',
      ventureOrder: [20, ...s.ventureOrder.filter((c) => c !== 20)],
    };
    expect(prestige(s, 0)).toBe(9);
    const n = step(s, { type: 'buy-venture', actor: 0 });
    expect(n.result?.places[0]).toBe(1);
    let waiting: State = { ...n, result: null, stage: 'trade', actor: 1, turn: 1 };
    waiting = step(waiting, { type: 'finish-trade', actor: 1 });
    expect(waiting.result).toBe(null);
    waiting = step(waiting, { type: 'end-turn', actor: 1 });
    expect(waiting.result).toBe(null);
    waiting = step(waiting, { type: 'request-roll', actor: 2 });
    waiting = step(waiting, { type: 'dice', actor: 'entropy', faces: [1, 1] });
    waiting = step(waiting, { type: 'finish-trade', actor: 2 });
    waiting = step(waiting, { type: 'end-turn', actor: 2 });
    expect(waiting.result?.places[0]).toBe(1);
  });
  it('C30 apply rejects noncanonical encodings and never mutates its input', () => {
    const s = ready(),
      copy = JSON.stringify(s);
    expect(parseAction({ type: 'request-roll', actor: 0, extra: 1 })).toBe(null);
    expect(apply(s, null).ok).toBe(false);
    expect(apply(s, { type: 'request-roll', actor: 2 }).ok).toBe(false);
    step(s, { type: 'request-roll', actor: 0 });
    expect(JSON.stringify(s)).toBe(copy);
  });
  it('C31 owner views hide all other hands and the future venture order', () => {
    const s = venture(ready(), 20);
    const own = view(s, 0),
      spectator = view(s, null);
    expect(own.ventureOrder).toBe(null);
    expect(own.players[0]?.ventures[0]?.card).toBe(20);
    expect(spectator.players[0]?.ventures[0]?.card).toBe(null);
    expect(spectator.players.every((p) => p.goods === null)).toBe(true);
    expect(own.players[1]?.goods).toBe(null);
  });
  it('C32 complete three and four player games conserve resources and replay exactly', () => {
    for (const seats of [3, 4]) {
      for (let seed = 0; seed < 10; seed++) {
        const run = complete(`coverage-${seats}-${seed}`, seats);
        expect(run.state.result).not.toBe(null);
        expect(invariants(run.state)).toEqual([]);
      }

      const result = complete(`full-${seats}`, seats);
      expect(result.state.result).not.toBe(null);
      expect(result.state.result?.scores[result.state.turn]).toBeGreaterThanOrEqual(10);
      expect(invariants(result.state)).toEqual([]);
      const s = setup(seats, result.state.ventureOrder);
      if (!s.ok) throw new Error('setup');
      let replay: State = s.value;
      for (const a of result.log) replay = step(replay, a);
      expect(replay).toEqual(result.state);
      expect(result.tags.has('theft')).toBe(true);
    }
  });
});
