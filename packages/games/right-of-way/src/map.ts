/*
 * The board of Ferrovia (docs/games/right-of-way/RULES.md, "The map"): towns, routes and charters. Generated once
 * from the same data as the RULES.md tables and art/board.svg; RULES.md is the source of truth (C01, C02).
 * Plain data, no names: display names live in theme.ts.
 */

/** Town ids, in the order of the RULES.md town table. The board coordinates are for the web board only. */
export const TOWNS: readonly { readonly id: string; readonly x: number; readonly y: number }[] = [
  { id: 'ashgrove', x: 530, y: 650 },
  { id: 'bellwether', x: 1235, y: 330 },
  { id: 'brindlefield', x: 875, y: 255 },
  { id: 'cinderpass', x: 300, y: 300 },
  { id: 'clockhaven', x: 1150, y: 345 },
  { id: 'copperhollow', x: 500, y: 440 },
  { id: 'duskwater', x: 330, y: 815 },
  { id: 'emberdune', x: 620, y: 835 },
  { id: 'fernvale', x: 1170, y: 490 },
  { id: 'frostwick', x: 590, y: 70 },
  { id: 'glimmerford', x: 260, y: 540 },
  { id: 'granitefold', x: 1060, y: 640 },
  { id: 'gullhaven', x: 95, y: 120 },
  { id: 'harrowcross', x: 925, y: 565 },
  { id: 'highspire', x: 520, y: 235 },
  { id: 'hollowmere', x: 870, y: 70 },
  { id: 'ironmoor', x: 1150, y: 205 },
  { id: 'kelpmouth', x: 115, y: 720 },
  { id: 'kettleburn', x: 700, y: 340 },
  { id: 'lanternport', x: 1268, y: 705 },
  { id: 'larchholm', x: 340, y: 95 },
  { id: 'marrowmarsh', x: 865, y: 815 },
  { id: 'millstone', x: 1130, y: 60 },
  { id: 'mosswick', x: 1190, y: 665 },
  { id: 'northwatch', x: 1300, y: 200 },
  { id: 'owlgate', x: 735, y: 170 },
  { id: 'ravensgate', x: 1010, y: 150 },
  { id: 'saltmere', x: 70, y: 420 },
  { id: 'starlingcove', x: 1310, y: 70 },
  { id: 'sunreach', x: 715, y: 525 },
  { id: 'thistledown', x: 1010, y: 330 },
  { id: 'tidewell', x: 1310, y: 470 },
  { id: 'velvetdale', x: 790, y: 690 },
  { id: 'whistlestop', x: 865, y: 420 },
  { id: 'wrenford', x: 1030, y: 465 },
  { id: 'yarrowfen', x: 1050, y: 800 },
];

/** Route colours: the eight freight colours, then gray (unmarked: any one colour). */
export const ROUTE_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'white',
  'black',
  'gray',
] as const;
export type RouteColor = (typeof ROUTE_COLORS)[number];

/** One route: two towns (indexes into TOWNS), a length 1–6 and one colour per side (two for a twin). R01 is index 0. */
export interface Route {
  readonly a: number;
  readonly b: number;
  readonly length: number;
  readonly sides: readonly RouteColor[];
}

export const ROUTES: readonly Route[] = [
  { a: 5, b: 0, length: 3, sides: ['gray'] }, // R01
  { a: 6, b: 0, length: 4, sides: ['gray'] }, // R02
  { a: 0, b: 7, length: 3, sides: ['green'] }, // R03
  { a: 10, b: 0, length: 6, sides: ['red'] }, // R04
  { a: 0, b: 29, length: 3, sides: ['blue', 'black'] }, // R05
  { a: 4, b: 1, length: 1, sides: ['gray', 'gray'] }, // R06
  { a: 24, b: 1, length: 2, sides: ['gray', 'gray'] }, // R07
  { a: 1, b: 31, length: 2, sides: ['gray', 'gray'] }, // R08
  { a: 15, b: 2, length: 3, sides: ['red'] }, // R09
  { a: 18, b: 2, length: 3, sides: ['orange', 'yellow'] }, // R10
  { a: 25, b: 2, length: 3, sides: ['blue'] }, // R11
  { a: 2, b: 26, length: 3, sides: ['gray'] }, // R12
  { a: 2, b: 30, length: 2, sides: ['purple'] }, // R13
  { a: 2, b: 33, length: 3, sides: ['green', 'white'] }, // R14
  { a: 3, b: 5, length: 4, sides: ['gray'] }, // R15
  { a: 3, b: 10, length: 4, sides: ['blue', 'black'] }, // R16
  { a: 12, b: 3, length: 5, sides: ['white'] }, // R17
  { a: 3, b: 14, length: 4, sides: ['red'] }, // R18
  { a: 20, b: 3, length: 3, sides: ['gray', 'gray'] }, // R19
  { a: 27, b: 3, length: 4, sides: ['purple'] }, // R20
  { a: 4, b: 8, length: 2, sides: ['blue'] }, // R21
  { a: 16, b: 4, length: 2, sides: ['purple', 'black'] }, // R22
  { a: 30, b: 4, length: 2, sides: ['gray', 'gray'] }, // R23
  { a: 34, b: 4, length: 3, sides: ['green'] }, // R24
  { a: 10, b: 5, length: 4, sides: ['orange'] }, // R25
  { a: 14, b: 5, length: 3, sides: ['black', 'purple'] }, // R26
  { a: 5, b: 18, length: 3, sides: ['red'] }, // R27
  { a: 5, b: 29, length: 4, sides: ['white'] }, // R28
  { a: 6, b: 7, length: 6, sides: ['gray'] }, // R29
  { a: 10, b: 6, length: 5, sides: ['purple'] }, // R30
  { a: 17, b: 6, length: 4, sides: ['blue'] }, // R31
  { a: 7, b: 21, length: 5, sides: ['blue'] }, // R32
  { a: 7, b: 32, length: 3, sides: ['orange'] }, // R33
  { a: 11, b: 8, length: 3, sides: ['gray'] }, // R34
  { a: 8, b: 23, length: 3, sides: ['gray'] }, // R35
  { a: 8, b: 31, length: 2, sides: ['gray'] }, // R36
  { a: 34, b: 8, length: 2, sides: ['white', 'black'] }, // R37
  { a: 9, b: 14, length: 3, sides: ['yellow'] }, // R38
  { a: 9, b: 15, length: 5, sides: ['gray'] }, // R39
  { a: 20, b: 9, length: 4, sides: ['black'] }, // R40
  { a: 9, b: 25, length: 3, sides: ['purple', 'green'] }, // R41
  { a: 17, b: 10, length: 4, sides: ['white'] }, // R42
  { a: 27, b: 10, length: 4, sides: ['red'] }, // R43
  { a: 13, b: 11, length: 2, sides: ['gray'] }, // R44
  { a: 21, b: 11, length: 5, sides: ['purple'] }, // R45
  { a: 11, b: 23, length: 2, sides: ['green', 'white'] }, // R46
  { a: 34, b: 11, length: 3, sides: ['orange'] }, // R47
  { a: 11, b: 35, length: 3, sides: ['blue'] }, // R48
  { a: 12, b: 20, length: 4, sides: ['yellow'] }, // R49
  { a: 12, b: 27, length: 6, sides: ['orange'] }, // R50
  { a: 13, b: 21, length: 4, sides: ['green'] }, // R51
  { a: 29, b: 13, length: 3, sides: ['gray'] }, // R52
  { a: 32, b: 13, length: 3, sides: ['white'] }, // R53
  { a: 33, b: 13, length: 2, sides: ['orange', 'yellow'] }, // R54
  { a: 13, b: 34, length: 2, sides: ['gray'] }, // R55
  { a: 14, b: 18, length: 3, sides: ['gray'] }, // R56
  { a: 20, b: 14, length: 4, sides: ['gray'] }, // R57
  { a: 14, b: 25, length: 4, sides: ['gray'] }, // R58
  { a: 15, b: 22, length: 5, sides: ['black'] }, // R59
  { a: 25, b: 15, length: 3, sides: ['orange'] }, // R60
  { a: 15, b: 26, length: 3, sides: ['gray', 'gray'] }, // R61
  { a: 22, b: 16, length: 2, sides: ['red', 'orange'] }, // R62
  { a: 16, b: 24, length: 2, sides: ['gray'] }, // R63
  { a: 26, b: 16, length: 2, sides: ['green'] }, // R64
  { a: 28, b: 16, length: 3, sides: ['yellow'] }, // R65
  { a: 30, b: 16, length: 3, sides: ['gray'] }, // R66
  { a: 27, b: 17, length: 6, sides: ['yellow', 'green'] }, // R67
  { a: 25, b: 18, length: 3, sides: ['gray'] }, // R68
  { a: 18, b: 29, length: 3, sides: ['green'] }, // R69
  { a: 18, b: 33, length: 3, sides: ['blue'] }, // R70
  { a: 23, b: 19, length: 1, sides: ['gray'] }, // R71
  { a: 31, b: 19, length: 4, sides: ['orange', 'yellow'] }, // R72
  { a: 35, b: 19, length: 4, sides: ['gray'] }, // R73
  { a: 32, b: 21, length: 2, sides: ['gray', 'gray'] }, // R74
  { a: 21, b: 35, length: 3, sides: ['white', 'black'] }, // R75
  { a: 26, b: 22, length: 2, sides: ['gray'] }, // R76
  { a: 22, b: 28, length: 3, sides: ['white'] }, // R77
  { a: 35, b: 23, length: 3, sides: ['yellow'] }, // R78
  { a: 28, b: 24, length: 2, sides: ['blue', 'purple'] }, // R79
  { a: 26, b: 30, length: 3, sides: ['red'] }, // R80
  { a: 29, b: 32, length: 3, sides: ['purple'] }, // R81
  { a: 29, b: 33, length: 3, sides: ['red'] }, // R82
  { a: 33, b: 30, length: 3, sides: ['black'] }, // R83
  { a: 30, b: 34, length: 2, sides: ['yellow'] }, // R84
  { a: 33, b: 34, length: 3, sides: ['gray'] }, // R85
];

/** The 30 charters: two towns and a value (the shortest connection in spaces). T01 is index 0. */
export const CHARTERS: readonly { readonly a: number; readonly b: number; readonly value: number }[] = [
  { a: 2, b: 34, value: 4 }, // T01
  { a: 2, b: 13, value: 5 }, // T02
  { a: 18, b: 30, value: 5 }, // T03
  { a: 1, b: 23, value: 6 }, // T04
  { a: 15, b: 33, value: 6 }, // T05
  { a: 33, b: 31, value: 7 }, // T06
  { a: 14, b: 30, value: 8 }, // T07
  { a: 29, b: 4, value: 8 }, // T08
  { a: 5, b: 34, value: 9 }, // T09
  { a: 25, b: 8, value: 9 }, // T10
  { a: 14, b: 4, value: 10 }, // T11
  { a: 18, b: 19, value: 10 }, // T12
  { a: 7, b: 2, value: 11 }, // T13
  { a: 9, b: 13, value: 11 }, // T14
  { a: 10, b: 32, value: 11 }, // T15
  { a: 0, b: 16, value: 12 }, // T16
  { a: 0, b: 26, value: 12 }, // T17
  { a: 3, b: 21, value: 13 }, // T18
  { a: 5, b: 24, value: 13 }, // T19
  { a: 9, b: 11, value: 13 }, // T20
  { a: 7, b: 15, value: 14 }, // T21
  { a: 20, b: 8, value: 15 }, // T22
  { a: 6, b: 1, value: 16 }, // T23
  { a: 3, b: 24, value: 17 }, // T24
  { a: 10, b: 31, value: 17 }, // T25
  { a: 6, b: 22, value: 18 }, // T26
  { a: 12, b: 23, value: 20 }, // T27
  { a: 27, b: 35, value: 20 }, // T28
  { a: 12, b: 19, value: 21 }, // T29
  { a: 17, b: 28, value: 22 }, // T30
];
