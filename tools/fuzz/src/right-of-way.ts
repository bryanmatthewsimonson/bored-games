import type { DeckSpec } from '@bored-games/game-kit';
import { type FuzzPolicy, type Rng, range, shuffle } from '@bored-games/game-kit';
import {
  CHARTER_OFFSET,
  CHARTERS,
  colorAt,
  ENGINE,
  GROUPS,
  ownedRoutes,
  ROUTE_COLORS,
  ROUTES,
  type RowAction,
  type RowState,
  sideOpen,
} from '@bored-games/right-of-way';

type Claim = Extract<RowAction, { type: 'claim' }>;

/** Shortest paths over the routes no other seat holds, as route lists (test driver only). */
function wantedRoutes(s: RowState, seat: number): Set<number> {
  const owned = new Set(ownedRoutes(s.routes, seat));
  const usable = (ri: number): boolean =>
    owned.has(ri) || (ROUTES[ri]?.sides ?? []).some((_, side) => sideOpen(s, ri, side, seat));
  const out = new Set<number>();
  for (const c of (s.players[seat]?.charters ?? []).concat(s.players[seat]?.offered ?? [])) {
    if (c.card === null) continue;
    const t = CHARTERS[c.card - CHARTER_OFFSET];
    if (t === undefined) continue;
    // Dijkstra with owned routes free.
    const dist = new Map<number, number>([[t.a, 0]]);
    const via = new Map<number, number>();
    const todo = new Set<number>([t.a]);
    while (todo.size > 0) {
      const u = [...todo].sort((x, y) => (dist.get(x) ?? 0) - (dist.get(y) ?? 0))[0] as number;
      todo.delete(u);
      if (u === t.b) break;
      ROUTES.forEach((r, ri) => {
        const v = r.a === u ? r.b : r.b === u ? r.a : null;
        if (v === null || !usable(ri)) return;
        const d = (dist.get(u) ?? 0) + (owned.has(ri) ? 0 : r.length);
        if (d < (dist.get(v) ?? Number.POSITIVE_INFINITY)) {
          dist.set(v, d);
          via.set(v, ri);
          todo.add(v);
        }
      });
    }
    let at = t.b;
    while (via.has(at)) {
      const ri = via.get(at) as number;
      if (!owned.has(ri)) out.add(ri);
      const r = ROUTES[ri] as (typeof ROUTES)[number];
      at = r.a === at ? r.b : r.a;
    }
  }
  return out;
}

/** Test driver only: lay track toward its charters, draw the colours those routes need, keep short charters. */
const builder: FuzzPolicy<RowState> = {
  name: 'builder',
  choose(s, seat, raw, rng) {
    const legal = raw as readonly RowAction[];
    const first = legal[0];
    if (first?.type === 'sift' || first?.type === 'pass') return first;
    if (first?.type === 'keep') {
      const p = s.players[seat];
      const values = (p?.offered ?? []).map(
        (c) => CHARTERS[(c.card ?? CHARTER_OFFSET) - CHARTER_OFFSET]?.value ?? 99,
      );
      const min = Math.min(...legal.map((a) => (a.type === 'keep' ? a.keep.length : 9)));
      const order = range(values.length).sort((a, b) => (values[a] ?? 0) - (values[b] ?? 0));
      const keep = order.slice(0, min).sort((a, b) => a - b);
      return legal.find((a) => a.type === 'keep' && JSON.stringify(a.keep) === JSON.stringify(keep)) ?? first;
    }
    const wanted = wantedRoutes(s, seat);
    const claims = legal.filter((a): a is Claim => a.type === 'claim');
    const engines = (a: Claim) => a.pay.filter(([pos, card]) => colorAt(s, { pos, card }) === ENGINE).length;
    const best = (xs: Claim[]) =>
      [...xs].sort(
        (a, b) => (ROUTES[b.route]?.length ?? 0) - (ROUTES[a.route]?.length ?? 0) || engines(a) - engines(b),
      )[0];
    const goal = best(claims.filter((a) => wanted.has(a.route)));
    if (goal) return goal;
    const hand = s.players[seat]?.hand.length ?? 0;
    const track = s.players[seat]?.track ?? 0;
    if (claims.length > 0 && (wanted.size === 0 || hand > 14 || track < 12)) return best(claims);
    if (wanted.size === 0 && legal.some((a) => a.type === 'charters') && track > 20 && rng.int(3) === 0)
      return legal.find((a) => a.type === 'charters');
    const need = new Set<number>();
    for (const ri of wanted)
      for (const c of ROUTES[ri]?.sides ?? []) if (c !== 'gray') need.add(ROUTE_COLORS.indexOf(c));
    const takes = legal.filter((a): a is Extract<RowAction, { type: 'take' }> => a.type === 'take');
    const useful = takes.find((a) => {
      const y = s.yard[a.slot];
      const c = y ? colorAt(s, y) : null;
      return c !== null && (need.has(c) || (c === ENGINE && s.phase === 'turn'));
    });
    if (useful) return useful;
    const blind = legal.find((a) => a.type === 'blind');
    if (blind) return blind;
    return rng.pick(legal);
  },
};

/** Test driver only: draws charters whenever it can (keeping one), so returned charters come round again (D067). */
const charterer: FuzzPolicy<RowState> = {
  name: 'charterer',
  choose(s, seat, raw, rng) {
    const legal = raw as readonly RowAction[];
    const first = legal[0];
    if (first?.type === 'keep')
      return (
        legal.find(
          (a) =>
            a.type === 'keep' &&
            a.keep.length === Math.min(...legal.map((b) => (b.type === 'keep' ? b.keep.length : 9))),
        ) ?? first
      );
    const draw = legal.find((a) => a.type === 'charters');
    if (draw && (s.players[seat]?.track ?? 0) > 15) return draw;
    return (builder.choose(s, seat, legal, rng) as RowAction | undefined) ?? first;
  },
};

export const RIGHT_OF_WAY_EXPECTED_COVERAGE = [
  'move:take',
  'move:blind',
  'move:claim',
  'move:charters',
  'move:keep',
  'move:sift',
  'sift:skip',
  'yard:wipe',
  'charters:redealt',
  'end:line',
];

export const RIGHT_OF_WAY_POLICIES: readonly FuzzPolicy<RowState>[] = [builder, charterer];

export function rightOfWayDeckOrder(_deck: DeckSpec, rng: Rng): number[] {
  return GROUPS.flatMap((g) =>
    shuffle(
      range(g.size).map((n) => n + g.offset),
      rng,
    ),
  );
}
