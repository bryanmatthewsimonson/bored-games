/** English-language tile inventory: [letter, count, face value]. Empty letters are blanks. */
export const INVENTORY: readonly (readonly [string, number, number])[] = [
  ['A', 9, 1],
  ['B', 2, 3],
  ['C', 2, 3],
  ['D', 4, 2],
  ['E', 12, 1],
  ['F', 2, 4],
  ['G', 3, 2],
  ['H', 2, 4],
  ['I', 9, 1],
  ['J', 1, 8],
  ['K', 1, 5],
  ['L', 4, 1],
  ['M', 2, 3],
  ['N', 6, 1],
  ['O', 8, 1],
  ['P', 2, 3],
  ['Q', 1, 10],
  ['R', 6, 1],
  ['S', 4, 1],
  ['T', 6, 1],
  ['U', 4, 1],
  ['V', 2, 4],
  ['W', 2, 4],
  ['X', 1, 8],
  ['Y', 2, 4],
  ['Z', 1, 10],
  ['', 2, 0],
];
export const TILES = INVENTORY.flatMap(([letter, count, value]) =>
  Array.from({ length: count }, () => ({ letter, value })),
);
export type Premium = '2L' | '3L' | '2W' | '3W' | null;
const marks = new Map<number, Premium>();
for (const [r, c] of [
  [0, 0],
  [0, 7],
  [0, 14],
  [7, 0],
  [7, 14],
  [14, 0],
  [14, 7],
  [14, 14],
])
  marks.set((r ?? 0) * 15 + (c ?? 0), '3W');
for (let i = 1; i < 5; i++)
  for (const [r, c] of [
    [i, i],
    [i, 14 - i],
    [14 - i, i],
    [14 - i, 14 - i],
  ])
    marks.set((r ?? 0) * 15 + (c ?? 0), '2W');
marks.set(112, '2W');
for (const r of [1, 5, 9, 13])
  for (const c of [1, 5, 9, 13])
    if ((r !== 1 && r !== 13) || (c !== 1 && c !== 13)) marks.set(r * 15 + c, '3L');
for (const [r, c] of [
  [0, 3],
  [0, 11],
  [2, 6],
  [2, 8],
  [3, 0],
  [3, 7],
  [3, 14],
  [6, 2],
  [6, 6],
  [6, 8],
  [6, 12],
  [7, 3],
  [7, 11],
  [8, 2],
  [8, 6],
  [8, 8],
  [8, 12],
  [11, 0],
  [11, 7],
  [11, 14],
  [12, 6],
  [12, 8],
  [14, 3],
  [14, 11],
])
  marks.set((r ?? 0) * 15 + (c ?? 0), '2L');
export const premiumAt = (cell: number): Premium => marks.get(cell) ?? null;
export const coordinate = (cell: number): string =>
  `${String.fromCharCode(65 + (cell % 15))}${Math.floor(cell / 15) + 1}`;
