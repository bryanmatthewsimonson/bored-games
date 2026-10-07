/*
 * The Room for Doubt board (spec section 5, D074): parse `docs/games/room-for-doubt/board.txt`, prove its structural
 * properties and measure it. Pure and deterministic: text in, plain data out. The repo test and the art generator
 * both read the board through here, so the grid stays the single source.
 *
 * Legend: `.` corridor, `#` the Rotunda, a letter for each room, `^ v < >` a door on a room's edge square pointing at
 * its doorstep (the corridor square it opens onto), `1`-`6` the Entrances.
 */

export const SIZE = 24;

export type Square = { readonly x: number; readonly y: number };
export type Dir = '^' | 'v' | '<' | '>';
export type RoomId =
  | 'courtroom'
  | 'chambers'
  | 'jury'
  | 'robing'
  | 'registry'
  | 'store'
  | 'cells'
  | 'belfry'
  | 'gallery';

export const ROOM_ORDER: readonly RoomId[] = [
  'courtroom',
  'chambers',
  'jury',
  'robing',
  'registry',
  'store',
  'cells',
  'belfry',
  'gallery',
];

export const ROOM_LETTERS: Readonly<Record<string, RoomId>> = {
  C: 'courtroom',
  H: 'chambers',
  J: 'jury',
  R: 'robing',
  Y: 'registry',
  E: 'store',
  L: 'cells',
  B: 'belfry',
  P: 'gallery',
};

/** The two Old Gaol Passages: each joins the corner rooms diagonally opposite each other. */
export const PASSAGES: readonly (readonly [RoomId, RoomId])[] = [
  ['chambers', 'store'],
  ['belfry', 'cells'],
];

/** The board corner each corner room must touch. */
const CORNERS: Readonly<Partial<Record<RoomId, Square>>> = {
  chambers: { x: 0, y: 0 },
  belfry: { x: SIZE - 1, y: 0 },
  cells: { x: 0, y: SIZE - 1 },
  store: { x: SIZE - 1, y: SIZE - 1 },
};

const ARROWS: Readonly<Record<string, Square>> = {
  '^': { x: 0, y: -1 },
  v: { x: 0, y: 1 },
  '<': { x: -1, y: 0 },
  '>': { x: 1, y: 0 },
};

const NEIGHBOURS: readonly Square[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const LEGAL = new Set('.#CHJRYELBP^v<>123456');

/** Squares around the outer ring, clockwise from the north-west corner. */
const RING = 4 * (SIZE - 1);

export interface Door {
  readonly room: RoomId;
  /** The room's edge square that carries the arrow. */
  readonly door: Square;
  /** The doorstep: the corridor square the door opens onto. */
  readonly step: Square;
  readonly dir: Dir;
}

export interface Board {
  readonly rows: readonly string[];
  /** Each room's squares: its letter squares and its door squares. */
  readonly rooms: Readonly<Record<RoomId, readonly Square[]>>;
  readonly doors: readonly Door[];
  /** Every corridor square, Entrances included, in reading order. */
  readonly corridor: readonly Square[];
  /** `entrances[0]` is Entrance 1. */
  readonly entrances: readonly Square[];
  readonly rotunda: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

const isCorridor = (c: string): boolean => c === '.' || (c >= '1' && c <= '6');

/** A square's index in reading order, or -1 outside the grid. */
const sq = (x: number, y: number): number => (x < 0 || y < 0 || x >= SIZE || y >= SIZE ? -1 : y * SIZE + x);

/** Position along the outer ring, clockwise from the north-west corner, or -1 off the ring. */
function ringPosition({ x, y }: Square): number {
  if (y === 0) return x;
  if (x === SIZE - 1) return SIZE - 1 + y;
  if (y === SIZE - 1) return 2 * (SIZE - 1) + (SIZE - 1 - x);
  if (x === 0) return 3 * (SIZE - 1) + (SIZE - 1 - y);
  return -1;
}

function readGrid(text: string): { rows: string[]; problems: string[] } {
  const rows = text.replaceAll('\r\n', '\n').replace(/\n$/, '').split('\n');
  if (rows.length !== SIZE || rows.some((r) => r.length !== SIZE))
    return { rows, problems: [`grid is not ${SIZE} x ${SIZE}`] };
  const problems: string[] = [];
  for (const [y, row] of rows.entries())
    for (const [x, c] of [...row].entries())
      if (!LEGAL.has(c)) problems.push(`illegal character '${c}' at ${x},${y}`);
  return { rows, problems };
}

/** Whether `squares` form one orthogonally connected region (an empty list is not one). */
function connected(squares: readonly Square[]): boolean {
  const first = squares[0];
  if (first === undefined) return false;
  const left = new Set(squares.map((s) => sq(s.x, s.y)));
  left.delete(sq(first.x, first.y));
  const stack = [first];
  for (let top = stack.pop(); top !== undefined; top = stack.pop())
    for (const d of NEIGHBOURS) {
      const k = sq(top.x + d.x, top.y + d.y);
      if (left.delete(k)) stack.push({ x: top.x + d.x, y: top.y + d.y });
    }
  return left.size === 0;
}

/** Reads the characters into a board, with every problem of the rotunda, rooms, doors and Entrances. */
function scan(rows: readonly string[]): { board: Board; problems: string[] } {
  const problems: string[] = [];
  const at = (x: number, y: number): string => rows[y]?.[x] ?? '';
  const rooms = Object.fromEntries(ROOM_ORDER.map((r) => [r, [] as Square[]])) as Record<RoomId, Square[]>;
  const blocked: Square[] = [];
  const corridor: Square[] = [];
  const doors: Door[] = [];
  const entranceSquares = new Map<number, Square[]>();
  const stepUses = new Map<string, number>();

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = at(x, y);
      const arrow = ARROWS[c];
      const letter = ROOM_LETTERS[c];
      if (c === '#') {
        blocked.push({ x, y });
      } else if (isCorridor(c)) {
        corridor.push({ x, y });
        if (c !== '.') entranceSquares.set(Number(c), [...(entranceSquares.get(Number(c)) ?? []), { x, y }]);
      } else if (letter !== undefined) {
        rooms[letter].push({ x, y });
      } else if (arrow !== undefined) {
        const room = ROOM_LETTERS[at(x - arrow.x, y - arrow.y)];
        if (room === undefined) {
          problems.push(`door at ${x},${y} has no room behind it`);
          continue;
        }
        const step = { x: x + arrow.x, y: y + arrow.y };
        if (!isCorridor(at(step.x, step.y)))
          problems.push(`doorstep ${step.x},${step.y} of the door at ${x},${y} is not a corridor square`);
        const k = `${step.x},${step.y}`;
        stepUses.set(k, (stepUses.get(k) ?? 0) + 1);
        rooms[room].push({ x, y });
        doors.push({ room, door: { x, y }, step, dir: c as Dir });
      }
    }
  }
  for (const [k, n] of stepUses) if (n > 1) problems.push(`doorstep ${k} serves two doors`);

  // The Rotunda: one rectangle, 5 to 7 squares a side, centred within one square of the board's centre.
  const xs = blocked.map((s) => s.x);
  const ys = blocked.map((s) => s.y);
  const rotunda =
    blocked.length === 0
      ? { x0: 0, y0: 0, x1: -1, y1: -1 }
      : { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const w = rotunda.x1 - rotunda.x0 + 1;
  const h = rotunda.y1 - rotunda.y0 + 1;
  if (blocked.length !== w * h) {
    problems.push('the # squares are not one rectangle');
  } else {
    if (w < 5 || w > 7 || h < 5 || h > 7) problems.push(`the Rotunda is ${w} x ${h} (want 5 to 7 a side)`);
    const mid = (SIZE - 1) / 2;
    if (
      Math.abs((rotunda.x0 + rotunda.x1) / 2 - mid) > 1 ||
      Math.abs((rotunda.y0 + rotunda.y1) / 2 - mid) > 1
    )
      problems.push('the Rotunda is not centred');
  }

  // Rooms: one connected region each, corner rooms on their corners, one to four doors (one or two in a corner).
  for (const id of ROOM_ORDER) {
    const squares = rooms[id];
    if (!connected(squares)) problems.push(`room ${id} is not one connected region`);
    const corner = CORNERS[id];
    if (corner !== undefined && !squares.some((s) => s.x === corner.x && s.y === corner.y))
      problems.push(`room ${id} does not touch its corner`);
    const n = doors.filter((d) => d.room === id).length;
    const max = corner === undefined ? 4 : 2;
    if (n < 1 || n > max) problems.push(`room ${id} has ${n} doors (want 1 to ${max})`);
  }
  if (doors.length < 17 || doors.length > 19) problems.push(`${doors.length} doors in all (want 17 to 19)`);
  if (corridor.length < 190 || corridor.length > 230)
    problems.push(`${corridor.length} corridor squares (want 190 to 230)`);

  // Entrances: one each of 1 to 6, on the outer ring, clockwise in order, at least 6 apart.
  const entrances: Square[] = [];
  const positions: number[] = [];
  for (let n = 1; n <= 6; n++) {
    const found = entranceSquares.get(n) ?? [];
    const first = found[0];
    if (first === undefined) {
      problems.push(`entrance ${n} is missing`);
      continue;
    }
    if (found.length > 1) problems.push(`entrance ${n} appears more than once`);
    entrances.push(first);
    const p = ringPosition(first);
    if (p < 0) problems.push(`entrance ${n} is not on the outer ring`);
    positions.push(p);
  }
  if (positions.length === 6 && positions.every((p) => p >= 0)) {
    const first = positions[0] ?? 0;
    const along = positions.map((p) => (p - first + RING) % RING);
    if (along.some((p, i) => i > 0 && p <= (along[i - 1] ?? 0)))
      problems.push('entrances are not in clockwise order');
    for (const [i, p] of positions.entries()) {
      const next = positions[(i + 1) % 6] ?? 0;
      const gap = (next - p + RING) % RING;
      if (gap < 6)
        problems.push(`entrances ${i + 1} and ${((i + 1) % 6) + 1} are only ${gap} apart (want 6 or more)`);
    }
  }

  return { board: { rows, rooms, doors, corridor, entrances, rotunda }, problems };
}

/** The corridor squares as a graph: each square's index in `board.corridor`, and its neighbours' indices. */
function corridorGraph(board: Board): {
  index: ReadonlyMap<number, number>;
  adj: readonly (readonly number[])[];
} {
  const index = new Map(board.corridor.map((s, i) => [sq(s.x, s.y), i] as const));
  const adj = board.corridor.map((s) =>
    NEIGHBOURS.flatMap((d) => {
      const j = index.get(sq(s.x + d.x, s.y + d.y));
      return j === undefined ? [] : [j];
    }),
  );
  return { index, adj };
}

/** Steps from corridor square `from` to every corridor square (-1 where unreachable), breadth first. */
function distances(adj: readonly (readonly number[])[], from: number): number[] {
  const dist = new Array<number>(adj.length).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head] ?? 0;
    for (const next of adj[here] ?? [])
      if (dist[next] === -1) {
        dist[next] = (dist[here] ?? 0) + 1;
        queue.push(next);
      }
  }
  return dist;
}

const PAIRS: readonly (readonly [RoomId, RoomId])[] = ROOM_ORDER.flatMap((a, i) =>
  ROOM_ORDER.slice(i + 1).map((b) => [a, b] as const),
);

const joinedByPassage = (a: RoomId, b: RoomId): boolean =>
  PASSAGES.some(([p, q]) => (p === a && q === b) || (p === b && q === a));

/**
 * The shortest trip between each pair of rooms, in squares, keyed `a-b` with `a` before `b` in ROOM_ORDER: one step
 * out of the first room, the corridor squares between the two doorsteps, one step into the second, minimised over
 * their doors. Passages are never used. Infinity where no trip exists.
 */
export function tripLengths(board: Board): Readonly<Record<string, number>> {
  const { index, adj } = corridorGraph(board);
  const cache = new Map<number, number[]>();
  const from = (s: Square): number[] => {
    const i = index.get(sq(s.x, s.y));
    if (i === undefined) return [];
    const known = cache.get(i);
    if (known !== undefined) return known;
    const fresh = distances(adj, i);
    cache.set(i, fresh);
    return fresh;
  };
  const out: Record<string, number> = {};
  for (const [a, b] of PAIRS) {
    let best = Number.POSITIVE_INFINITY;
    for (const da of board.doors.filter((d) => d.room === a)) {
      const dist = from(da.step);
      for (const db of board.doors.filter((d) => d.room === b)) {
        const j = index.get(sq(db.step.x, db.step.y));
        const d = j === undefined ? -1 : (dist[j] ?? -1);
        if (d >= 0) best = Math.min(best, 2 + d);
      }
    }
    out[`${a}-${b}`] = best;
  }
  return out;
}

export interface BoardStats {
  readonly doors: number;
  readonly corridorSquares: number;
  /** The median trip over all 36 room pairs. */
  readonly median: number;
  /** The longest trip between rooms that no passage joins. */
  readonly longestOffPassages: number;
  /** On foot, chambers to store, then belfry to cells. */
  readonly passageTrips: readonly [number, number];
  /** How many of the 36 trips are 7 squares or fewer. */
  readonly atMost7: number;
  /** For each room, how many other rooms lie within 12 squares. */
  readonly within12: Readonly<Record<RoomId, number>>;
}

export function boardStats(board: Board): BoardStats {
  const trips = tripLengths(board);
  const trip = (a: RoomId, b: RoomId): number =>
    trips[ROOM_ORDER.indexOf(a) < ROOM_ORDER.indexOf(b) ? `${a}-${b}` : `${b}-${a}`] ??
    Number.POSITIVE_INFINITY;
  const sorted = Object.values(trips).sort((p, q) => p - q);
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2 === 1
      ? (sorted[(sorted.length - 1) / 2] ?? 0)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  const [first, second] = PASSAGES;
  return {
    doors: board.doors.length,
    corridorSquares: board.corridor.length,
    median,
    longestOffPassages: Math.max(
      ...PAIRS.filter(([a, b]) => !joinedByPassage(a, b)).map(([a, b]) => trip(a, b)),
    ),
    passageTrips: [trip(...(first ?? ['chambers', 'store'])), trip(...(second ?? ['belfry', 'cells']))],
    atMost7: sorted.filter((t) => t <= 7).length,
    within12: Object.fromEntries(
      ROOM_ORDER.map((r) => [r, ROOM_ORDER.filter((o) => o !== r && trip(r, o) <= 12).length]),
    ) as Record<RoomId, number>,
  };
}

/** The one line RULES.md quotes between its board-stats markers. */
export function formatStats(s: BoardStats): string {
  return [
    `${s.doors} doors`,
    `${s.corridorSquares} corridor squares`,
    `median trip ${s.median}`,
    `longest trip off the passages ${s.longestOffPassages}`,
    `passage trips ${s.passageTrips[0]} and ${s.passageTrips[1]}`,
    `${s.atMost7} trips of 7 or fewer`,
  ].join(' · ');
}

/** Dead ends, connectivity and the trip bands: the properties that need the corridor graph. */
function graphProblems(board: Board): string[] {
  const problems: string[] = [];
  const { adj } = corridorGraph(board);
  const doorsAt = new Map<string, number>();
  for (const d of board.doors)
    doorsAt.set(`${d.step.x},${d.step.y}`, (doorsAt.get(`${d.step.x},${d.step.y}`) ?? 0) + 1);
  for (const [i, s] of board.corridor.entries())
    if ((adj[i]?.length ?? 0) + (doorsAt.get(`${s.x},${s.y}`) ?? 0) < 2)
      problems.push(`dead end at ${s.x},${s.y}`);
  if (board.corridor.length > 0 && distances(adj, 0).some((d) => d < 0))
    problems.push('corridor squares are not all connected');

  const trips = tripLengths(board);
  const unreachable = PAIRS.filter(
    ([a, b]) => !Number.isFinite(trips[`${a}-${b}`] ?? Number.POSITIVE_INFINITY),
  );
  for (const [a, b] of unreachable) problems.push(`${a} and ${b} cannot reach each other`);
  if (unreachable.length > 0) return problems;

  const stats = boardStats(board);
  if (stats.median < 9 || stats.median > 14) problems.push(`median trip ${stats.median} (want 9 to 14)`);
  for (const [a, b] of PAIRS) {
    const t = trips[`${a}-${b}`] ?? 0;
    if (joinedByPassage(a, b)) {
      if (t < 24) problems.push(`passage from ${a} to ${b} is only ${t} on foot (want 24 or more)`);
    } else if (t > 24) {
      problems.push(`trip from ${a} to ${b} is ${t} (want 24 or less when no passage joins them)`);
    }
  }
  if (stats.atMost7 < 5) problems.push(`only ${stats.atMost7} trips of 7 or fewer (want 5 or more)`);
  for (const room of ROOM_ORDER)
    if (stats.within12[room] < 3)
      problems.push(`${room} has ${stats.within12[room]} rooms within 12 (want 3 or more)`);
  return problems;
}

/** Reads a board; throws when the text is not a 24 x 24 grid of legal characters. */
export function parseBoard(text: string): Board {
  const { rows, problems } = readGrid(text);
  if (problems.length > 0) throw new Error(problems.join('; '));
  return scan(rows).board;
}

/** Every property of spec section 5 (and the trip bands) that the grid breaks, as messages; empty when sound. */
export function boardProblems(text: string): string[] {
  const { rows, problems } = readGrid(text);
  if (problems.length > 0) return problems;
  const { board, problems: found } = scan(rows);
  return [...found, ...graphProblems(board)];
}
