/*
 * The world of Spread Thin (docs/games/spread-thin/RULES.md, "The world"): 48 cities, twelve to a region, and the 93
 * links between them. The links are the reference board's graph (D096), joining the same pairs of places, under new
 * names and a new drawing (atlas.ts). Pure data: the engine knows cities only by index; theme.ts names them.
 */

/** The four strains, by index: each region's own strain shares its index. */
export const STRAINS = [0, 1, 2, 3] as const;
export type Strain = (typeof STRAINS)[number];
export const STRAIN_COUNT = 4;

export const CITY_COUNT = 48;
/** The cities of a region (and of its strain): twelve consecutive indices. */
export const CITIES_PER_REGION = 12;
/** The strain native to a city: its region. */
export const strainOf = (city: number): Strain => Math.floor(city / CITIES_PER_REGION) as Strain;

/** Where every pawn and the first clinic start (C02). */
export const START_CITY = 4;

/**
 * Each city's population, by index (invented numbers, ranked as the reference cards rank their places; the one
 * tie, 1 and 16, is the reference cards' tie). The most populous card in the opening hands picks the first player.
 */
export const POPULATION: readonly number[] = [
  15148000, 27742000, 3551000, 43507000, 7809000, 6722000, 23484000, 13064000, 28739000, 380000, 11977000,
  8806000, 37165000, 41333000, 14061000, 24571000, 27742000, 16145000, 33994000, 42420000, 29826000, 26655000,
  5635000, 9893000, 2554000, 36168000, 32997000, 38252000, 17232000, 10890000, 20403000, 44504000, 46588000,
  39249000, 25658000, 35081000, 40336000, 47675000, 30913000, 31910000, 18319000, 22487000, 1467000, 19316000,
  21400000, 45591000, 48762000, 4638000,
];

/** The links, each once, as `[low, high]` index pairs, ascending. Every link runs both ways. */
export const LINKS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 12],
  [0, 38],
  [0, 45],
  [1, 2],
  [1, 4],
  [1, 12],
  [1, 13],
  [2, 3],
  [2, 5],
  [3, 5],
  [3, 6],
  [3, 7],
  [4, 5],
  [4, 14],
  [5, 14],
  [6, 7],
  [6, 8],
  [6, 9],
  [7, 8],
  [7, 19],
  [7, 24],
  [8, 9],
  [8, 10],
  [8, 24],
  [9, 10],
  [9, 11],
  [10, 26],
  [11, 26],
  [11, 27],
  [12, 13],
  [12, 47],
  [13, 14],
  [13, 15],
  [13, 16],
  [14, 15],
  [15, 16],
  [15, 18],
  [15, 19],
  [16, 17],
  [18, 19],
  [19, 20],
  [20, 21],
  [20, 23],
  [21, 22],
  [21, 23],
  [22, 23],
  [23, 25],
  [24, 25],
  [24, 26],
  [25, 26],
  [25, 28],
  [25, 29],
  [26, 27],
  [26, 28],
  [27, 30],
  [28, 29],
  [28, 30],
  [28, 31],
  [29, 31],
  [30, 31],
  [30, 32],
  [31, 32],
  [31, 33],
  [32, 33],
  [32, 34],
  [32, 35],
  [33, 34],
  [34, 35],
  [34, 43],
  [34, 46],
  [35, 40],
  [35, 43],
  [36, 37],
  [36, 39],
  [37, 38],
  [37, 39],
  [38, 39],
  [38, 42],
  [39, 40],
  [39, 41],
  [40, 41],
  [40, 43],
  [40, 44],
  [40, 45],
  [41, 42],
  [41, 45],
  [43, 44],
  [43, 46],
  [44, 45],
  [44, 46],
  [45, 47],
  [46, 47],
];

/** Each city's neighbours, ascending. */
export const NEIGHBOURS: readonly (readonly number[])[] = Array.from({ length: CITY_COUNT }, (_, c) =>
  LINKS.flatMap(([a, b]) => (a === c ? [b] : b === c ? [a] : [])).sort((x, y) => x - y),
);

/** Whether two cities are linked. */
export const linked = (a: number, b: number): boolean => NEIGHBOURS[a]?.includes(b) === true;
