/*
 * The fixed numbers of Current Affairs (docs/games/current-affairs/RULES.md, "Components"): the 42 power stations, the
 * fuel yard's price ladders and supply, the payday table, the restock table and the counts that depend on the number
 * of players. Pure data.
 */

/** The four fuels, by index in every fuel vector `[coal, oil, waste, uranium]`. */
export const FUELS = ['coal', 'oil', 'waste', 'uranium'] as const;
export type Fuel = (typeof FUELS)[number];
export const COAL = 0;
export const OIL = 1;
export const WASTE = 2;
export const URANIUM = 3;

/** What a station burns. `hybrid` burns coal, oil or any mix of the two; `green` burns nothing. */
export const KINDS = ['coal', 'oil', 'hybrid', 'waste', 'uranium', 'green'] as const;
export type Kind = (typeof KINDS)[number];

export interface Station {
  /** Its number: the opening bid and its rank. */
  readonly n: number;
  readonly kind: Kind;
  /** Fuel units one firing burns (0 for green). It stores twice this. */
  readonly burn: number;
  /** Cities one firing powers. */
  readonly powers: number;
}

const st = (n: number, kind: Kind, burn: number, powers: number): Station => ({ n, kind, burn, powers });

/** All 42 stations, in number order. */
export const STATIONS: readonly Station[] = [
  st(3, 'oil', 2, 1),
  st(4, 'coal', 2, 1),
  st(5, 'hybrid', 2, 1),
  st(6, 'waste', 1, 1),
  st(7, 'oil', 3, 2),
  st(8, 'coal', 3, 2),
  st(9, 'oil', 1, 1),
  st(10, 'coal', 2, 2),
  st(11, 'uranium', 1, 2),
  st(12, 'hybrid', 2, 2),
  st(13, 'green', 0, 1),
  st(14, 'waste', 2, 2),
  st(15, 'coal', 2, 3),
  st(16, 'oil', 2, 3),
  st(17, 'uranium', 1, 2),
  st(18, 'green', 0, 2),
  st(19, 'waste', 2, 3),
  st(20, 'coal', 3, 5),
  st(21, 'hybrid', 2, 4),
  st(22, 'green', 0, 2),
  st(23, 'uranium', 1, 3),
  st(24, 'waste', 2, 4),
  st(25, 'coal', 2, 5),
  st(26, 'oil', 2, 5),
  st(27, 'green', 0, 3),
  st(28, 'uranium', 1, 4),
  st(29, 'hybrid', 1, 4),
  st(30, 'waste', 3, 6),
  st(31, 'coal', 3, 6),
  st(32, 'oil', 3, 6),
  st(33, 'green', 0, 4),
  st(34, 'uranium', 1, 5),
  st(35, 'oil', 1, 5),
  st(36, 'coal', 3, 7),
  st(37, 'green', 0, 4),
  st(38, 'waste', 3, 7),
  st(39, 'uranium', 1, 6),
  st(40, 'oil', 2, 6),
  st(42, 'coal', 2, 6),
  st(44, 'green', 0, 5),
  st(46, 'hybrid', 3, 7),
  st(50, 'green', 0, 6),
];

const BY_NUMBER: ReadonlyMap<number, Station> = new Map(STATIONS.map((s) => [s.n, s]));

/** The station with number `n`, or undefined. */
export const stationOf = (n: number): Station | undefined => BY_NUMBER.get(n);

/** The stations of the opening market (RULES.md C03). */
export const OPENING_MARKET: readonly number[] = [3, 4, 5, 6, 7, 8, 9, 10];
/** The green station laid on top of the stack. */
export const TOP_STATION = 13;
/** The stations shuffled into the stack: every station but the opening market and the top one, ascending. */
export const STACK_STATIONS: readonly number[] = STATIONS.map((s) => s.n).filter(
  (n) => !OPENING_MARKET.includes(n) && n !== TOP_STATION,
);

/** Units each fuel has in the game, and its yard spaces. */
export const FUEL_TOTAL: readonly number[] = [24, 24, 24, 12];
/** The price of each yard space of a fuel, cheapest first. */
export const YARD_PRICES: readonly (readonly number[])[] = [
  Array.from({ length: 24 }, (_, i) => Math.floor(i / 3) + 1),
  Array.from({ length: 24 }, (_, i) => Math.floor(i / 3) + 1),
  Array.from({ length: 24 }, (_, i) => Math.floor(i / 3) + 1),
  [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16],
];
/** The yard at the start: coal on 1–8, oil on 3–8, waste on 7–8, uranium on 14 and 16 (C03). */
export const OPENING_YARD: readonly number[] = [24, 18, 6, 2];

/** What a company is paid for powering 0..20 cities (C17); more than 20 pays as 20. */
export const PAYDAY: readonly number[] = [
  10, 22, 33, 44, 54, 64, 73, 82, 90, 98, 105, 112, 118, 124, 129, 134, 138, 142, 145, 148, 150,
];
export const payFor = (cities: number): number => PAYDAY[Math.min(cities, PAYDAY.length - 1)] as number;

/** The yard's restock after payday, `[coal, oil, waste, uranium]`, by players (2–6) and era (1–3) (C18). */
export const RESTOCK: Readonly<Record<number, readonly (readonly number[])[]>> = {
  2: [
    [3, 2, 1, 1],
    [4, 2, 2, 1],
    [3, 4, 3, 1],
  ],
  3: [
    [4, 2, 1, 1],
    [5, 3, 2, 1],
    [3, 4, 3, 1],
  ],
  4: [
    [5, 3, 2, 1],
    [6, 4, 3, 2],
    [4, 5, 4, 2],
  ],
  5: [
    [5, 4, 3, 2],
    [7, 5, 3, 3],
    [5, 6, 5, 2],
  ],
  6: [
    [7, 5, 3, 2],
    [9, 6, 5, 3],
    [6, 7, 6, 3],
  ],
};

/** What a substation costs in a city that already holds 0, 1 or 2 (C14). */
export const SLOT_COST: readonly number[] = [10, 15, 20];

/** The counts that depend on the number of players (C01, C02, C15, C21). */
export interface Table {
  readonly regions: number;
  /** Stations taken out of the stack, unseen, at setup. */
  readonly removed: number;
  /** The most stations a company may own. */
  readonly maxStations: number;
  /** Era II starts once a company has this many cities. */
  readonly eraTwo: number;
  /** The game ends after a wiring phase in which a company reaches this many cities. */
  readonly end: number;
}

export const TABLES: Readonly<Record<number, Table>> = {
  2: { regions: 3, removed: 8, maxStations: 4, eraTwo: 10, end: 21 },
  3: { regions: 3, removed: 8, maxStations: 3, eraTwo: 7, end: 17 },
  4: { regions: 4, removed: 4, maxStations: 3, eraTwo: 7, end: 17 },
  5: { regions: 5, removed: 0, maxStations: 3, eraTwo: 7, end: 15 },
  6: { regions: 5, removed: 0, maxStations: 3, eraTwo: 6, end: 14 },
};

export const START_MONEY = 50;
export const SUBSTATIONS = 22;
