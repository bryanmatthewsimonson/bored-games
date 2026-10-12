/*
 * The Meridian as the engine sees it (docs/games/hazard/RULES.md, "The map"): 42 provinces in six realms and the 83
 * links between them. The graph is the reference board's twin, so play is the same; the names are in theme.ts and
 * the drawing in atlas.ts. Pure data.
 */

export const PROVINCES = [
  'a1',
  'a2',
  'a3',
  'a4',
  'a5',
  'a6',
  'a7',
  'a8',
  'a9',
  'b1',
  'b2',
  'b3',
  'b4',
  'c1',
  'c2',
  'c3',
  'c4',
  'c5',
  'c6',
  'c7',
  'd1',
  'd2',
  'd3',
  'd4',
  'd5',
  'd6',
  'e1',
  'e2',
  'e3',
  'e4',
  'e5',
  'e6',
  'e7',
  'e8',
  'e9',
  'e10',
  'e11',
  'e12',
  'f1',
  'f2',
  'f3',
  'f4',
] as const;
export type ProvinceId = (typeof PROVINCES)[number];

export type RealmId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';

export interface Realm {
  readonly id: RealmId;
  /** Troops a seat musters for holding every province of the realm at the start of its turn. */
  readonly bonus: number;
  readonly provinces: readonly ProvinceId[];
}

const realm = (id: RealmId, bonus: number): Realm => ({
  id,
  bonus,
  provinces: PROVINCES.filter((p) => p.startsWith(id)),
});

export const REALMS: readonly Realm[] = [
  realm('a', 5),
  realm('b', 2),
  realm('c', 5),
  realm('d', 3),
  realm('e', 7),
  realm('f', 2),
];

const L = (spec: string): (readonly [ProvinceId, ProvinceId])[] =>
  spec
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split('-') as [ProvinceId, ProvinceId]);

/** Every link, once. `a1-e4` runs off the west and east edges of the atlas. */
export const LINKS: readonly (readonly [ProvinceId, ProvinceId])[] = L(`
  a1-a2 a1-a4 a1-e4 a2-a4 a2-a5 a2-a3 a3-a5 a3-a6 a3-c1 a4-a5 a4-a7 a5-a7 a5-a8 a5-a6 a6-a8 a7-a8 a7-a9 a8-a9 a9-b1
  b1-b2 b1-b3 b2-b3 b2-b4 b2-d1 b3-b4
  c1-c2 c1-c3 c3-c2 c3-c4 c3-c7 c2-c4 c2-c5 c4-c7 c4-c6 c4-c5 c5-c6 c5-d1 c6-c7 c6-e10 c6-d2 c6-d1 c7-e10 c7-e8 c7-e1
  d1-d2 d1-d3 d1-d4 d2-e10 d2-d3 d3-d4 d3-d5 d3-d6 d3-e10 d4-d5 d5-d6
  e1-e2 e1-e9 e1-e8 e2-e3 e2-e5 e2-e6 e2-e9 e3-e4 e3-e5 e4-e5 e4-e6 e4-e7 e5-e6 e6-e7 e6-e9 e8-e9 e8-e11 e8-e10
  e9-e12 e9-e11 e10-e11 e11-e12 e12-f1
  f1-f2 f1-f3 f2-f3 f2-f4 f3-f4
`);

const INDEX: ReadonlyMap<string, number> = new Map(PROVINCES.map((p, i) => [p, i]));

const NEIGHBORS: ReadonlyMap<ProvinceId, readonly ProvinceId[]> = new Map(
  PROVINCES.map((p) => [
    p,
    LINKS.flatMap(([a, b]) => (a === p ? [b] : b === p ? [a] : [])).sort(
      (x, y) => (INDEX.get(x) ?? 0) - (INDEX.get(y) ?? 0),
    ),
  ]),
);

export const isProvince = (x: unknown): x is ProvinceId => typeof x === 'string' && INDEX.has(x);

/** The province's place in PROVINCES (0–41). */
export const provinceIndex = (p: ProvinceId): number => INDEX.get(p) ?? -1;

/** The provinces linked to `p`, in PROVINCES order. */
export const neighbors = (p: ProvinceId): readonly ProvinceId[] => NEIGHBORS.get(p) ?? [];

export const adjacent = (a: ProvinceId, b: ProvinceId): boolean => neighbors(a).includes(b);

export const realmOf = (p: ProvinceId): RealmId => p[0] as RealmId;
