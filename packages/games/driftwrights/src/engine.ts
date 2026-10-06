import type { ApplyResult, Result } from '@bored-games/game-kit';
import { BOARD, neighbors, SAMPLE_TERRAIN, touches, YIELDS } from './board.ts';
import type { Action, DecisionStage, EntropyAction, Goods, State, View } from './types.ts';

export const ZERO: Goods = [0, 0, 0, 0, 0];
export const COSTS = {
  link: [1, 1, 0, 0, 0],
  hearth: [1, 1, 1, 1, 0],
  hub: [0, 0, 0, 2, 3],
  venture: [0, 0, 1, 1, 1],
} as const;
export interface Event {
  readonly type: 'action';
  readonly action: Action | EntropyAction;
}
const fail = (message: string): { ok: false; error: { code: string; message: string } } => ({
  ok: false,
  error: { code: 'illegal', message },
});
export const total = (xs: readonly number[]): number => xs.reduce((n, x) => n + x, 0);
const goods = (raw: unknown): raw is Goods =>
  Array.isArray(raw) && raw.length === 5 && raw.every((n) => Number.isSafeInteger(n) && n >= 0);
const index = (n: unknown, size: number): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n < size;
const has = (xs: Goods, cost: Goods): boolean => cost.every((n, i) => n <= (xs[i] ?? 0));
const add = (a: Goods, b: Goods, sign = 1): Goods =>
  a.map((n, i) => n + sign * (b[i] ?? 0)) as unknown as Goods;
function unit(resource: number, n = 1): Goods {
  return ZERO.map((_, i) => (i === resource ? n : 0)) as unknown as Goods;
}
export function setup(
  seats: number,
  ventureOrder: readonly number[],
  terrain: readonly number[] = SAMPLE_TERRAIN,
): Result<State> {
  if (![3, 4].includes(seats)) return fail('Three or four players are required.');
  if (
    !Array.isArray(ventureOrder) ||
    ventureOrder.length !== 25 ||
    new Set(ventureOrder).size !== 25 ||
    ventureOrder.some((n) => !index(n, 25))
  )
    return fail('Ventures require a permutation of all 25 identities.');
  const counts = [4, 3, 4, 4, 3, 1];
  if (
    !Array.isArray(terrain) ||
    terrain.length !== 19 ||
    terrain.some((n) => !index(n, 6)) ||
    counts.some((n, i) => terrain.filter((t) => t === i).length !== n)
  )
    return fail('Invalid island distribution.');
  let next = 0;
  return {
    ok: true,
    value: {
      seats,
      players: Array.from({ length: seats }, () => ({ goods: ZERO, ventures: [], guides: 0 })),
      bank: [19, 19, 19, 19, 19],
      terrain: [...terrain],
      yields: terrain.map((t) => (t === 5 ? null : (YIELDS[next++] ?? null))),
      buildings: Array(54).fill(null),
      links: Array(72).fill(null),
      squall: terrain.indexOf(5),
      ventureOrder: [...ventureOrder],
      ventureNext: 0,
      usedVentures: [],
      starter: null,
      turn: 0,
      turnNo: 0,
      stage: 'starting-roll',
      opening: Array.from({ length: seats }, (_, i) => i),
      openingRolls: [],
      setupOrder: [],
      setupStep: 0,
      setupSite: null,
      actor: 0,
      resume: 'roll',
      chance: null,
      discards: [],
      freeLinks: 0,
      actionPlayed: false,
      offer: null,
      span: null,
      watch: null,
      dice: null,
      result: null,
    },
  };
}
export function spacing(s: State, site: number): boolean {
  return (
    index(site, 54) && s.buildings[site] === null && neighbors(site).every((n) => s.buildings[n] === null)
  );
}
export function legalHearths(s: State, seat: number, starting = false): number[] {
  if (s.buildings.filter((b) => b?.seat === seat && !b.hub).length >= 5) return [];
  return BOARD.sites.flatMap((_, i) =>
    spacing(s, i) && (starting || s.links.some((p, e) => p === seat && touches(e, i))) ? [i] : [],
  );
}
export function legalLinks(s: State, seat: number, startingSite: number | null = null): number[] {
  if (s.links.filter((p) => p === seat).length >= 15) return [];
  return BOARD.lanes.flatMap((e, i) => {
    if (s.links[i] !== null) return [];
    if (startingSite !== null) return touches(i, startingSite) ? [i] : [];
    const joins = [e.a, e.b].some((site) => {
      const b = s.buildings[site];
      return b !== null && b !== undefined
        ? b.seat === seat
        : s.links.some((p, j) => p === seat && touches(j, site));
    });
    return joins ? [i] : [];
  });
}
/** Longest edge-simple trail; own sites may be revisited, rival buildings terminate the trail. */
export function trailLength(s: State, seat: number): number {
  const owned = s.links.flatMap((p, i) => (p === seat ? [i] : []));
  let best = 0;
  function walk(site: number, used: Set<number>, first: boolean): void {
    best = Math.max(best, used.size);
    const b = s.buildings[site];
    if (!first && b !== null && b !== undefined && b.seat !== seat) return;
    for (const i of owned) {
      if (used.has(i) || !touches(i, site)) continue;
      const e = BOARD.lanes[i];
      if (!e) continue;
      used.add(i);
      walk(e.a === site ? e.b : e.a, used, false);
      used.delete(i);
    }
  }
  const endpoints = new Set(
    owned.flatMap((i) => {
      const e = BOARD.lanes[i];
      return e ? [e.a, e.b] : [];
    }),
  );
  for (const site of endpoints) walk(site, new Set(), true);
  return best;
}
export function prestige(s: State, seat: number, hidden = true): number {
  return (
    s.buildings.reduce((n, b) => n + (b?.seat === seat ? (b.hub ? 2 : 1) : 0), 0) +
    (s.span === seat ? 2 : 0) +
    (s.watch === seat ? 2 : 0) +
    (hidden ? (s.players[seat]?.ventures.filter((v) => v.card >= 20).length ?? 0) : 0)
  );
}
function settle(s: State): State {
  const lengths = s.players.map((_, i) => trailLength(s, i));
  const max = Math.max(...lengths);
  const leaders = lengths.flatMap((n, i) => (n === max && n >= 5 ? [i] : []));
  const span =
    s.span !== null && leaders.includes(s.span) ? s.span : leaders.length === 1 ? (leaders[0] ?? null) : null;
  const guides = s.players.map((p) => p.guides);
  const gmax = Math.max(...guides);
  const gl = guides.flatMap((n, i) => (n === gmax && n >= 3 ? [i] : []));
  const watch = s.watch !== null && gl.includes(s.watch) ? s.watch : gl.length === 1 ? (gl[0] ?? null) : null;
  const next = { ...s, span, watch };
  if (s.starter !== null && !s.stage.startsWith('setup') && prestige(next, s.turn) >= 10) {
    const scores = s.players.map((_, i) => prestige(next, i));
    const places = scores.map((score, i) =>
      i === s.turn ? 1 : 2 + scores.filter((n, j) => j !== s.turn && n > score).length,
    );
    return { ...next, stage: 'over', chance: null, result: { scores, places, reason: 'prestige' } };
  }
  return next;
}
function pay(s: State, seat: number, cost: Goods): State {
  return {
    ...s,
    bank: add(s.bank, cost),
    players: s.players.map((p, i) => (i === seat ? { ...p, goods: add(p.goods, cost, -1) } : p)),
  };
}
function collect(s: State, seat: number, cost: Goods): State {
  return {
    ...s,
    bank: add(s.bank, cost, -1),
    players: s.players.map((p, i) => (i === seat ? { ...p, goods: add(p.goods, cost) } : p)),
  };
}
function production(s: State, sum: number): State {
  let next = s;
  for (let resource = 0; resource < 5; resource++) {
    const demand = s.players.map((_, seat) =>
      s.buildings.reduce((n, b, site) => {
        if (b?.seat !== seat) return n;
        return (
          n +
          (BOARD.sites[site]?.islands.reduce(
            (p, i) =>
              p + (s.terrain[i] === resource && s.yields[i] === sum && s.squall !== i ? (b.hub ? 2 : 1) : 0),
            0,
          ) ?? 0)
        );
      }, 0),
    );
    if (total(demand) > (s.bank[resource] ?? 0) && demand.filter((n) => n > 0).length > 1) continue;
    demand.forEach((n, seat) => {
      if (n) next = collect(next, seat, unit(resource, Math.min(n, next.bank[resource] ?? 0)));
    });
  }
  return next;
}
function askSquall(s: State, resume: DecisionStage): State {
  return { ...s, stage: 'squall', actor: s.turn, resume };
}
function dice(s: State, faces: readonly [number, number]): State {
  const request = s.chance;
  if (request?.kind !== 'dice') return s;
  const sum = faces[0] + faces[1];
  if (request.purpose === 'starter') {
    const openingRolls = [...s.openingRolls, { seat: request.roller, total: sum }];
    if (openingRolls.length < s.opening.length)
      return {
        ...s,
        dice: faces,
        chance: null,
        openingRolls,
        stage: 'starting-roll',
        actor: s.opening[openingRolls.length] as number,
      };
    const max = Math.max(...openingRolls.map((r) => r.total));
    const winners = openingRolls.filter((r) => r.total === max).map((r) => r.seat);
    if (winners.length > 1)
      return {
        ...s,
        dice: faces,
        chance: null,
        opening: winners,
        openingRolls: [],
        stage: 'starting-roll',
        actor: winners[0] as number,
      };
    const starter = winners[0] as number;
    const forward = Array.from({ length: s.seats }, (_, i) => (starter + i) % s.seats);
    return {
      ...s,
      dice: faces,
      chance: null,
      starter,
      turn: starter,
      actor: starter,
      setupOrder: [...forward, ...forward.toReversed()],
      stage: 'setup-hearth',
    };
  }
  let next = { ...s, dice: faces, chance: null, actor: s.turn };
  if (sum !== 7) return { ...production(next, sum), stage: 'trade' };
  const discards = s.players.flatMap((p, i) => (total(p.goods) > 7 ? [i] : []));
  next = { ...next, discards };
  return discards.length
    ? { ...next, stage: 'discard', actor: discards[0] as number }
    : askSquall(next, 'trade');
}
export function bankRate(s: State, seat: number, resource: number): number {
  let rate = 4;
  for (const m of BOARD.moorings) {
    const lane = BOARD.lanes[m.lane];
    if (!lane) continue;
    if ([lane.a, lane.b].some((site) => s.buildings[site]?.seat === seat))
      rate = Math.min(rate, m.resource === null ? 3 : m.resource === resource ? 2 : 4);
  }
  return rate;
}
export function eligibleVictims(s: State, island: number): number[] {
  return [
    ...new Set(
      (BOARD.islands[island]?.sites ?? []).flatMap((site) => {
        const b = s.buildings[site];
        return b && b.seat !== s.turn ? [b.seat] : [];
      }),
    ),
  ];
}
/** Accept only one exact JSON representation of each action. */
export function parseAction(raw: unknown): Action | EntropyAction | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  const t = a.type;
  const keys: Record<string, readonly string[]> = {
    'request-roll': ['type', 'actor'],
    hearth: ['type', 'actor', 'site'],
    hub: ['type', 'actor', 'site'],
    link: ['type', 'actor', 'lane'],
    'finish-trade': ['type', 'actor'],
    'end-turn': ['type', 'actor'],
    'buy-venture': ['type', 'actor'],
    accept: ['type', 'actor'],
    decline: ['type', 'actor'],
    bank: ['type', 'actor', 'give', 'receive'],
    offer: ['type', 'actor', 'to', 'give', 'receive'],
    discard: ['type', 'actor', 'goods'],
    'move-squall': ['type', 'actor', 'island', 'victim'],
    play: ['type', 'actor', 'pos', 'goods', 'resource'],
    dice: ['type', 'actor', 'faces'],
    theft: ['type', 'actor', 'index'],
  };
  if (
    typeof t !== 'string' ||
    !keys[t] ||
    Object.keys(a).length !== keys[t]?.length ||
    keys[t]?.some((k) => !(k in a))
  )
    return null;
  if (t === 'dice')
    return a.actor === 'entropy' &&
      Array.isArray(a.faces) &&
      a.faces.length === 2 &&
      a.faces.every((n) => index(n, 7) && n > 0)
      ? (raw as EntropyAction)
      : null;
  if (t === 'theft') return a.actor === 'entropy' && index(a.index, 96) ? (raw as EntropyAction) : null;
  if (!index(a.actor, 4)) return null;
  if (((t === 'hearth' || t === 'hub') && !index(a.site, 54)) || (t === 'link' && !index(a.lane, 72)))
    return null;
  if (t === 'bank' && (!index(a.give, 5) || !index(a.receive, 5))) return null;
  if (t === 'offer' && (!index(a.to, 4) || !goods(a.give) || !goods(a.receive))) return null;
  if (t === 'discard' && !goods(a.goods)) return null;
  if (t === 'move-squall' && (!index(a.island, 19) || (a.victim !== null && !index(a.victim, 4))))
    return null;
  if (
    t === 'play' &&
    (!index(a.pos, 25) ||
      (a.goods !== null && !goods(a.goods)) ||
      (a.resource !== null && !index(a.resource, 5)))
  )
    return null;
  return raw as Action;
}
export function apply(s: State, raw: unknown): ApplyResult<State, Event> {
  try {
    const a = parseAction(raw);
    if (!a) return fail('Malformed action.');
    if (s.stage === 'over') return fail('The game is over.');
    let n = s;
    if (a.actor === 'entropy') {
      if (s.stage !== 'chance' || !s.chance) return fail('No chance result is pending.');
      if (a.type === 'dice') {
        if (s.chance.kind !== 'dice') return fail('A theft result is pending.');
        n = dice(s, a.faces);
      } else {
        const c = s.chance;
        if (c.kind !== 'theft' || a.index >= c.size) return fail('Invalid theft selection.');
        const hand = s.players[c.victim]?.goods;
        if (!hand) return fail('Missing hand.');
        let at = a.index,
          resource = -1;
        for (let i = 0; i < 5; i++) {
          if (at < (hand[i] ?? 0)) {
            resource = i;
            break;
          }
          at -= hand[i] ?? 0;
        }
        if (resource < 0) return fail('The selected card is missing.');
        const card = unit(resource);
        n = {
          ...s,
          chance: null,
          stage: s.resume,
          actor: s.turn,
          players: s.players.map((p, i) =>
            i === c.thief
              ? { ...p, goods: add(p.goods, card) }
              : i === c.victim
                ? { ...p, goods: add(p.goods, card, -1) }
                : p,
          ),
        };
      }
    } else {
      if (a.actor !== s.actor || a.actor >= s.seats) return fail('Another player must act.');
      const p = s.players[a.actor];
      if (!p) return fail('Missing player.');
      switch (a.type) {
        case 'request-roll':
          if (s.stage !== 'roll' && s.stage !== 'starting-roll') return fail('A roll is not available.');
          n = {
            ...s,
            stage: 'chance',
            chance: { kind: 'dice', purpose: s.stage === 'roll' ? 'production' : 'starter', roller: a.actor },
          };
          break;
        case 'hearth': {
          const start = s.stage === 'setup-hearth';
          if (
            (!start && s.stage !== 'construct') ||
            !legalHearths(s, a.actor, start).includes(a.site) ||
            (!start && !has(p.goods, COSTS.hearth))
          )
            return fail('That hearth cannot be built.');
          n = start ? s : pay(s, a.actor, COSTS.hearth);
          n = {
            ...n,
            buildings: n.buildings.map((b, i) => (i === a.site ? { seat: a.actor, hub: false } : b)),
          };
          if (start) {
            if (s.setupStep >= s.seats) {
              for (const island of BOARD.sites[a.site]?.islands ?? []) {
                const r = s.terrain[island] ?? 5;
                if (r < 5) n = collect(n, a.actor, unit(r));
              }
            }
            n = { ...n, stage: 'setup-link', setupSite: a.site };
          }
          break;
        }
        case 'hub':
          if (
            s.stage !== 'construct' ||
            s.buildings[a.site]?.seat !== a.actor ||
            s.buildings[a.site]?.hub ||
            s.buildings.filter((b) => b?.seat === a.actor && b.hub).length >= 4 ||
            !has(p.goods, COSTS.hub)
          )
            return fail('That hub cannot be built.');
          n = pay(s, a.actor, COSTS.hub);
          n = {
            ...n,
            buildings: n.buildings.map((b, i) => (i === a.site ? { seat: a.actor, hub: true } : b)),
          };
          break;
        case 'link': {
          const start = s.stage === 'setup-link',
            free = s.stage === 'free-links';
          if (
            (!start && !free && s.stage !== 'construct') ||
            !legalLinks(s, a.actor, start ? s.setupSite : null).includes(a.lane) ||
            (!start && !free && !has(p.goods, COSTS.link))
          )
            return fail('That link cannot be built.');
          n = start || free ? s : pay(s, a.actor, COSTS.link);
          n = { ...n, links: n.links.map((v, i) => (i === a.lane ? a.actor : v)) };
          if (start) {
            const step = s.setupStep + 1;
            const done = step === s.setupOrder.length;
            n = {
              ...n,
              setupStep: step,
              setupSite: null,
              stage: done ? 'roll' : 'setup-hearth',
              actor: done ? s.turn : (s.setupOrder[step] as number),
            };
          }
          if (free) {
            const count = s.freeLinks - 1;
            n = { ...n, freeLinks: count };
            if (!count || !legalLinks(n, a.actor).length) n = { ...n, stage: s.resume, freeLinks: 0 };
          }
          break;
        }
        case 'finish-trade':
          if (s.stage !== 'trade') return fail('Trading is not open.');
          n = { ...s, stage: 'construct' };
          break;
        case 'end-turn':
          if (s.stage !== 'construct') return fail('Finish this decision first.');
          {
            const turn = (s.turn + 1) % s.seats;
            n = { ...s, turn, turnNo: s.turnNo + 1, actor: turn, stage: 'roll', actionPlayed: false };
          }
          break;
        case 'bank': {
          const cost = unit(a.give, bankRate(s, a.actor, a.give));
          if (
            s.stage !== 'trade' ||
            a.give === a.receive ||
            !has(p.goods, cost) ||
            (s.bank[a.receive] ?? 0) < 1
          )
            return fail('That bank exchange is unavailable.');
          n = collect(pay(s, a.actor, cost), a.actor, unit(a.receive));
          break;
        }
        case 'offer':
          if (
            s.stage !== 'trade' ||
            a.to === a.actor ||
            a.to >= s.seats ||
            !total(a.give) ||
            !total(a.receive) ||
            a.give.some((v, i) => v > 0 && (a.receive[i] ?? 0) > 0) ||
            !has(p.goods, a.give)
          )
            return fail('That exchange is invalid.');
          n = {
            ...s,
            stage: 'trade-answer',
            actor: a.to,
            offer: { from: a.actor, to: a.to, give: a.give, receive: a.receive },
          };
          break;
        case 'accept':
        case 'decline': {
          const offer = s.offer;
          if (s.stage !== 'trade-answer' || !offer) return fail('No offer is waiting.');
          if (a.type === 'accept') {
            if (!has(p.goods, offer.receive) || !has(s.players[offer.from]?.goods ?? ZERO, offer.give))
              return fail('The offered supplies are unavailable.');
            n = {
              ...s,
              players: s.players.map((p, i) =>
                i === offer.from
                  ? { ...p, goods: add(add(p.goods, offer.give, -1), offer.receive) }
                  : i === offer.to
                    ? { ...p, goods: add(add(p.goods, offer.receive, -1), offer.give) }
                    : p,
              ),
            };
          }
          n = { ...n, offer: null, stage: 'trade', actor: s.turn };
          break;
        }
        case 'discard': {
          if (
            s.stage !== 'discard' ||
            total(a.goods) !== Math.floor(total(p.goods) / 2) ||
            !has(p.goods, a.goods)
          )
            return fail('Discard exactly half, rounded down.');
          n = pay(s, a.actor, a.goods);
          const rest = s.discards.slice(1);
          n = { ...n, discards: rest };
          n = rest.length ? { ...n, actor: rest[0] as number } : askSquall(n, 'trade');
          break;
        }
        case 'move-squall': {
          if (s.stage !== 'squall' || a.island === s.squall)
            return fail('Move the Squall to a different island.');
          const adjacent = eligibleVictims(s, a.island);
          if (
            (a.victim === null && adjacent.some((i) => total(s.players[i]?.goods ?? ZERO) > 0)) ||
            (a.victim !== null && !adjacent.includes(a.victim))
          )
            return fail('Choose a rival at the destination.');
          const size = a.victim === null ? 0 : total(s.players[a.victim]?.goods ?? ZERO);
          n = { ...s, squall: a.island, actor: s.turn };
          n =
            size && a.victim !== null
              ? { ...n, stage: 'chance', chance: { kind: 'theft', thief: s.turn, victim: a.victim, size } }
              : { ...n, stage: s.resume };
          break;
        }
        case 'buy-venture':
          if (s.stage !== 'construct' || s.ventureNext === 25 || !has(p.goods, COSTS.venture))
            return fail('A venture cannot be bought.');
          n = pay(s, a.actor, COSTS.venture);
          n = {
            ...n,
            ventureNext: s.ventureNext + 1,
            players: n.players.map((p, i) =>
              i === a.actor
                ? {
                    ...p,
                    ventures: [
                      ...p.ventures,
                      { pos: s.ventureNext, card: s.ventureOrder[s.ventureNext] as number, bought: s.turnNo },
                    ],
                  }
                : p,
            ),
          };
          break;
        case 'play': {
          const v = p.ventures.find((v) => v.pos === a.pos);
          if (
            !['roll', 'trade', 'construct'].includes(s.stage) ||
            s.actionPlayed ||
            !v ||
            v.card >= 20 ||
            v.bought === s.turnNo
          )
            return fail('That action venture is not eligible.');
          const kind = v.card < 14 ? 0 : v.card < 16 ? 1 : v.card < 18 ? 2 : 3;
          if (
            kind === 2
              ? a.resource !== null || a.goods === null || total(a.goods) !== 2 || !has(s.bank, a.goods)
              : kind === 3
                ? a.goods !== null || a.resource === null
                : a.goods !== null || a.resource !== null
          )
            return fail('Invalid venture choices.');
          if (kind === 1 && !legalLinks(s, a.actor).length) return fail('No link can be placed.');
          n = {
            ...s,
            actionPlayed: true,
            usedVentures: [...s.usedVentures, { seat: a.actor, pos: v.pos, card: v.card }],
            players: s.players.map((p, i) =>
              i === a.actor
                ? {
                    ...p,
                    ventures: p.ventures.filter((h) => h.pos !== v.pos),
                    guides: p.guides + (kind === 0 ? 1 : 0),
                  }
                : p,
            ),
          };
          if (kind === 0) n = askSquall(n, s.stage as DecisionStage);
          if (kind === 1) n = { ...n, stage: 'free-links', resume: s.stage as DecisionStage, freeLinks: 2 };
          if (kind === 2) n = collect(n, a.actor, a.goods as Goods);
          if (kind === 3) {
            const r = a.resource as number;
            let taken = 0;
            n = {
              ...n,
              players: n.players.map((p, i) => {
                if (i === a.actor) return p;
                taken += p.goods[r] ?? 0;
                return { ...p, goods: p.goods.map((v, j) => (j === r ? 0 : v)) as unknown as Goods };
              }),
            };
            n = {
              ...n,
              players: n.players.map((p, i) =>
                i === a.actor ? { ...p, goods: add(p.goods, unit(r, taken)) } : p,
              ),
            };
          }
          break;
        }
      }
    }
    return { ok: true, state: settle(n), events: [{ type: 'action', action: a }] };
  } catch {
    return fail('Unreadable action.');
  }
}
export function view(s: State, viewer: number | null): View {
  const { ventureOrder: _, players, ...rest } = s;
  return {
    ...rest,
    ventureOrder: null,
    players: players.map((p, i) => ({
      count: total(p.goods),
      goods: i === viewer ? p.goods : null,
      guides: p.guides,
      ventures: p.ventures.map((v) => ({ ...v, card: i === viewer || s.result !== null ? v.card : null })),
    })),
  };
}
export function invariants(s: State): string[] {
  const errors: string[] = [];
  if (s.buildings.length !== 54 || s.links.length !== 72) errors.push('board dimensions');
  if (!goods(s.bank) || s.players.some((p) => !goods(p.goods))) errors.push('negative or malformed supplies');
  for (let i = 0; i < 5; i++)
    if ((s.bank[i] ?? 0) + s.players.reduce((n, p) => n + (p.goods[i] ?? 0), 0) !== 19)
      errors.push(`supply conservation ${i}`);
  for (let seat = 0; seat < s.seats; seat++) {
    if (s.links.filter((p) => p === seat).length > 15) errors.push('link limit');
    if (s.buildings.filter((b) => b?.seat === seat && !b.hub).length > 5) errors.push('hearth limit');
    if (s.buildings.filter((b) => b?.seat === seat && b.hub).length > 4) errors.push('hub limit');
  }
  s.buildings.forEach((b, i) => {
    if (b && neighbors(i).some((n) => s.buildings[n] !== null)) errors.push('spacing');
  });
  const positions = [
    ...s.players.flatMap((p) => p.ventures.map((v) => v.pos)),
    ...s.usedVentures.map((v) => v.pos),
  ];
  if (
    new Set(positions).size !== positions.length ||
    positions.some((p) => p >= s.ventureNext) ||
    positions.length !== s.ventureNext
  )
    errors.push('venture positions');
  for (let i = 0; i < s.seats; i++)
    if (s.players[i]?.guides !== s.usedVentures.filter((v) => v.seat === i && v.card < 14).length)
      errors.push('guide count');
  if ((s.stage === 'chance' && s.chance === null) || (s.stage !== 'chance' && s.chance !== null))
    errors.push('chance phase');
  if (s.ventureNext > 25) errors.push('venture limit');
  return errors;
}
