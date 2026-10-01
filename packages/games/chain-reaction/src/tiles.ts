/**
 * Board geometry. Tiles are numbered in reading order: index = row * 12 +
 * (column - 1), so 1A = 0, 12A = 11, 1B = 12, 12I = 107. Tile ids in actions
 * and docs use the printed form, e.g. "7C".
 */
export const COLS = 12;
export const ROWS = 9;
export const TILE_COUNT = COLS * ROWS;
export const ROW_LETTERS = 'ABCDEFGHI';

export type TileId = string;

export function tileColumn(index: number): number {
  return (index % COLS) + 1;
}

export function tileRow(index: number): number {
  return Math.floor(index / COLS);
}

export function tileId(index: number): TileId {
  return `${tileColumn(index)}${ROW_LETTERS[tileRow(index)]}`;
}

const ID_PATTERN = /^(1[0-2]|[1-9])([A-I])$/;

/** Parses "7C" into a tile index; null for anything that is not a tile id. */
export function tileIndex(id: unknown): number | null {
  if (typeof id !== 'string') return null;
  const m = ID_PATTERN.exec(id);
  if (!m) return null;
  const col = Number(m[1]);
  const row = ROW_LETTERS.indexOf(m[2] as string);
  return row * COLS + (col - 1);
}

function computeNeighbors(): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    const r = tileRow(i);
    const c = tileColumn(i) - 1;
    const n: number[] = [];
    if (r > 0) n.push(i - COLS);
    if (c > 0) n.push(i - 1);
    if (c < COLS - 1) n.push(i + 1);
    if (r < ROWS - 1) n.push(i + COLS);
    out.push(n);
  }
  return out;
}

/** Orthogonal neighbors of each tile, ascending. */
export const NEIGHBORS: readonly (readonly number[])[] = computeNeighbors();

export type FirstPlayerOrder = 'rowThenColumn' | 'columnThenRow';

/**
 * Negative when tile `a` is closer to 1A than tile `b`.
 * rowThenColumn (reference rules): 9A beats 1B, 2A beats 2B.
 * columnThenRow (original kickoff convention): 1B beats 9A.
 */
export function compareCloseness(order: FirstPlayerOrder, a: number, b: number): number {
  if (order === 'rowThenColumn') return a - b;
  const dc = tileColumn(a) - tileColumn(b);
  return dc !== 0 ? dc : tileRow(a) - tileRow(b);
}
