/*
 * The Room for Doubt board (docs/games/room-for-doubt/RULES.md, "The board"), read from the game's grid. `BOARD_ROWS`
 * is docs/games/room-for-doubt/board.txt, copied here because this package is pure and reads no files; a test proves
 * the copy exact and every table below equal to what the reviewed parser (scripts/room-for-doubt/board.ts) reads from
 * the file. Everything else is derived from the rows once, when the module loads, with the legend of the rules:
 *
 *   `.` a corridor square          `#` the Rotunda: blocked, no pawn may enter
 *   a letter: a square of a room   `^ v < >` a door: an edge square of a room, the arrow pointing at its doorstep
 *   `1`-`6` an Entrance (a corridor square)
 *
 * Squares are numbered in reading order, `y * 24 + x`, and named by column letter A-X then row 1-24 (`H1` is 7).
 * A door is no square: passing it is one step between the doorstep, the corridor square outside, and the room.
 */
import { PARTIES, SCENES, type SceneId } from './ids.ts';

export const BOARD_SIZE = 24;

/** board.txt: 24 rows of 24 characters. */
export const BOARD_ROWS: readonly string[] = [
  'HHHHHH.1CCCCCCCCC.2BBBBB',
  'HHHHHH..CCCCCCCCC..BBBBB',
  'HHHHHH..<CCCCCCCC..BBBBB',
  'HHHHH>..CCCCCCCCC..BBBBB',
  'HHHHHH..CCCCCCCCC..BBBBB',
  'HvHHHH..CCCCvCCCC..<BBBB',
  '...................BBvBB',
  '.......................3',
  '........................',
  '..JJJ^JJ.######..PPP^PPP',
  '..JJJJJJ.######..<PPPPPP',
  '..<JJJJJ.######..PPPPPPP',
  '6.JJJJJ>.######..PPPPPPP',
  '..JJJJJJ.######..<YYYYYY',
  '..JJJJJJ.######..YYYYYYY',
  '.................<YYYYYY',
  '.................YYYYYYY',
  'L^LLLL............EEEEEE',
  'LLLLLL..RR^RRRR...<EEEEE',
  'LLLLLL..RRRRRRR...EEEEEE',
  'LLLLL>..RRRRRRR...EEEEEE',
  'LLLLLL..RRRRRR>...<EEEEE',
  'LLLLLL..RRRRRRR...EEEEEE',
  'LLLLLL5.RRRRRRR4..EEEEEE',
];

/** Where a pawn stands: a corridor square by name (`'A1'` to `'X24'`) or a room by its Scene id. */
export type Place = string;

/** A rectangle of squares, both ends included. */
export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A door: the square of `room` that carries the arrow, and the doorstep it opens onto. */
export interface Door {
  readonly room: SceneId;
  readonly door: number;
  readonly step: number;
}

const SQUARES = BOARD_SIZE * BOARD_SIZE;
/** The column letters, A to X. */
const COLUMNS = 'ABCDEFGHIJKLMNOPQRSTUVWX';
const SQUARE_NAME = /^([A-X])([1-9]|1\d|2[0-4])$/;

/** The name of square `i`: its column letter, then its row. Throws `RangeError` when `i` is no square. */
export function squareName(i: number): string {
  if (!Number.isInteger(i) || i < 0 || i >= SQUARES)
    throw new RangeError(`${i} is not a square of the board`);
  return `${COLUMNS.charAt(i % BOARD_SIZE)}${Math.floor(i / BOARD_SIZE) + 1}`;
}

/** The index of the square called `name`, or null: an uppercase column letter A-X, then a row 1-24 with no leading zero. */
export function squareIndex(name: string): number | null {
  const match = SQUARE_NAME.exec(name);
  const column = match?.[1];
  const row = match?.[2];
  if (column === undefined || row === undefined) return null;
  return (Number(row) - 1) * BOARD_SIZE + COLUMNS.indexOf(column);
}

/** The room each letter of the grid stands for. */
const ROOM_OF_LETTER: ReadonlyMap<string, SceneId> = new Map<string, SceneId>([
  ['C', 'courtroom'],
  ['H', 'chambers'],
  ['J', 'jury'],
  ['R', 'robing'],
  ['Y', 'registry'],
  ['E', 'store'],
  ['L', 'cells'],
  ['B', 'belfry'],
  ['P', 'gallery'],
]);

/** The step from a door square to its doorstep, by the arrow the door carries. */
const ARROW: ReadonlyMap<string, readonly [number, number]> = new Map<string, readonly [number, number]>([
  ['^', [0, -1]],
  ['v', [0, 1]],
  ['<', [-1, 0]],
  ['>', [1, 0]],
]);

/** `r` grown to take in square (x, y); a rectangle of that one square when there is no `r` yet. */
function grow(r: Rect | undefined, x: number, y: number): Rect {
  if (r === undefined) return { x0: x, y0: y, x1: x, y1: y };
  return { x0: Math.min(r.x0, x), y0: Math.min(r.y0, y), x1: Math.max(r.x1, x), y1: Math.max(r.y1, y) };
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the board grid has no ${what}`);
  return value;
}

/** Reads the grid once, in reading order. */
function readGrid() {
  const at = (x: number, y: number): string => BOARD_ROWS[y]?.charAt(x) ?? '';
  const corridor = new Set<number>();
  const entrances: (string | undefined)[] = [];
  const rects = new Map<SceneId, Rect>();
  const doors: Door[] = [];
  let rotunda: Rect | undefined;
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const c = at(x, y);
      const i = y * BOARD_SIZE + x;
      const room = ROOM_OF_LETTER.get(c);
      const arrow = ARROW.get(c);
      if (c === '.') {
        corridor.add(i);
      } else if (c >= '1' && c <= '6') {
        corridor.add(i);
        entrances[Number(c) - 1] = squareName(i);
      } else if (c === '#') {
        rotunda = grow(rotunda, x, y);
      } else if (room !== undefined) {
        rects.set(room, grow(rects.get(room), x, y));
      } else if (arrow !== undefined) {
        // A door belongs to the room behind its arrow.
        const behind = ROOM_OF_LETTER.get(at(x - arrow[0], y - arrow[1]));
        if (behind !== undefined) {
          rects.set(behind, grow(rects.get(behind), x, y));
          doors.push({ room: behind, door: i, step: (y + arrow[1]) * BOARD_SIZE + x + arrow[0] });
        }
      }
    }
  }
  return { corridor, entrances, rects, doors, rotunda };
}

const GRID = readGrid();

/** Every corridor square, Entrances included, by index. */
export const CORRIDOR: ReadonlySet<number> = GRID.corridor;

/** The Entrance of each Party, by party index: `H1`, `S1`, `X8`, `P24`, `G24`, `A13`. */
export const ENTRANCES: readonly string[] = PARTIES.map((_, p) =>
  must(GRID.entrances[p], `Entrance ${p + 1}`),
);

/** The rectangle of squares that holds each room: its letter squares and its door squares, and nothing else. */
export const ROOM_RECTS: Readonly<Record<SceneId, Rect>> = Object.fromEntries(
  SCENES.map((room) => [room, must(GRID.rects.get(room), `room ${room}`)]),
) as Record<SceneId, Rect>;

/** The 19 doors, in reading order of their door squares. */
export const DOORS: readonly Door[] = GRID.doors;

/** The Rotunda, J10 to O15: the one block of squares no pawn may enter. */
export const ROTUNDA: Rect = must(GRID.rotunda, 'Rotunda');

const DOORSTEP_ROOM: ReadonlyMap<number, SceneId> = new Map(DOORS.map((d) => [d.step, d.room] as const));

/** The room whose doorstep square `square` is, or null: the room a pawn standing there may enter. */
export function doorRoomAt(square: number): SceneId | null {
  return DOORSTEP_ROOM.get(square) ?? null;
}

/** The Old Gaol Passages: each joins the two corner rooms that lie diagonally opposite each other. */
const PASSAGES: ReadonlyMap<SceneId, SceneId> = new Map<SceneId, SceneId>([
  ['chambers', 'store'],
  ['store', 'chambers'],
  ['belfry', 'cells'],
  ['cells', 'belfry'],
]);

/** The corner room at the other end of `room`'s passage, or null when `room` has none. */
export function passageTo(room: SceneId): SceneId | null {
  return PASSAGES.get(room) ?? null;
}
