/*
 * Movement (docs/games/room-for-doubt/RULES.md, "Your turn", 1. Move; catalog C10-C19 and platform rule P4): where a
 * pawn may end a walk of `roll` steps.
 *
 * A walk is a self-avoiding path: each step goes to a free, orthogonally adjacent corridor square the walk has not
 * stood on (its start included), or through a door, which is one step between a doorstep and the room itself. Entering
 * a room ends the walk, and a room the walk set out from is never entered again. A pawn on a doorstep never blocks its
 * own door, though any other pawn on one shuts it, in both directions.
 *
 * A pawn walks the whole roll or enters a room on the way. When neither is possible it takes the longest legal path
 * there is (P4), any path of that greatest length, which is no squares at all for a pawn with no free first step.
 * The search is a plain depth-first enumeration of the paths; the most any roll visits is a few tens of thousands of
 * squares, so nothing is cached.
 */
import { BOARD_SIZE, CORRIDOR, DOORS, doorRoomAt, type Place, squareIndex, squareName } from './board.ts';
import { SCENES, type SceneId } from './ids.ts';

const SQUARES = BOARD_SIZE * BOARD_SIZE;
/** The most two dice show, and so the longest walk. */
const MAX_ROLL = 12;

/** The corridor squares next to each square, by index; none for a square that is not in the corridor. */
const NEIGHBOURS: readonly (readonly number[])[] = Array.from({ length: SQUARES }, (_, i) => {
  if (!CORRIDOR.has(i)) return [];
  const next: number[] = [];
  if (i % BOARD_SIZE > 0) next.push(i - 1);
  if (i % BOARD_SIZE < BOARD_SIZE - 1) next.push(i + 1);
  if (i >= BOARD_SIZE) next.push(i - BOARD_SIZE);
  if (i < SQUARES - BOARD_SIZE) next.push(i + BOARD_SIZE);
  return next.filter((n) => CORRIDOR.has(n));
});

/** The doorsteps of each room, by Scene id: the squares a pawn leaves it onto. */
const DOORSTEPS: ReadonlyMap<string, readonly number[]> = new Map(
  SCENES.map((room): [string, number[]] => [room, DOORS.filter((d) => d.room === room).map((d) => d.step)]),
);

export interface Destinations {
  /** The squares by name, ascending by index, then the rooms in `SCENES` order. */
  places: Place[];
  /** True when P4's longest-path rule applied: no path of the full roll and no room within the roll. */
  shortfall: boolean;
}

/**
 * Where a pawn standing at `from`, a square or a room, may end a walk of `roll` steps. `occupied` holds the squares
 * of the other pawns, played or not; the pawn's own square may be in it or not. Nothing is returned for a place
 * that is no corridor square and no room, or for a roll that is not a whole number from 1 to 12.
 */
export function destinations(from: Place, roll: number, occupied: ReadonlySet<number>): Destinations {
  const start = squareIndex(from);
  const doorsteps = start === null ? DOORSTEPS.get(from) : undefined;
  const inCorridor = start !== null && CORRIDOR.has(start);
  if (!Number.isInteger(roll) || roll < 1 || roll > MAX_ROLL || (!inCorridor && doorsteps === undefined)) {
    return { places: [], shortfall: false };
  }
  // A pawn in a room never goes back into it, whichever door it comes to.
  const left = doorsteps === undefined ? null : (from as SceneId);

  const visited = new Uint8Array(SQUARES);
  /** The squares reached by each number of steps, from 1 to `roll`. */
  const reached = Array.from({ length: roll + 1 }, () => new Set<number>());
  const rooms = new Set<SceneId>();

  const walk = (square: number, steps: number): void => {
    visited[square] = 1;
    if (steps > 0) reached[steps]?.add(square);
    if (steps < roll) {
      // A doorstep reached with a step to spare leads into its room, which ends the walk.
      const room = doorRoomAt(square);
      if (room !== null && room !== left) rooms.add(room);
      for (const next of NEIGHBOURS[square] ?? [])
        if (visited[next] === 0 && !occupied.has(next)) walk(next, steps + 1);
    }
    visited[square] = 0;
  };

  if (start !== null) walk(start, 0);
  else for (const step of doorsteps ?? []) if (!occupied.has(step)) walk(step, 1);

  const named = (squares: ReadonlySet<number> | undefined): Place[] =>
    [...(squares ?? [])].sort((a, b) => a - b).map(squareName);
  const places = [...named(reached[roll]), ...SCENES.filter((room) => rooms.has(room))];
  if (places.length > 0) return { places, shortfall: false };

  // Short of the roll with no room to enter: the squares at the end of the longest paths, if there is a path at all.
  let longest = roll;
  while (longest > 0 && reached[longest]?.size === 0) longest--;
  return { places: named(reached[longest]), shortfall: longest > 0 };
}

/** Whether a pawn at `from` has a free first step: a free square next to it, a door it may use, or a free doorstep. */
export function canMove(from: Place, occupied: ReadonlySet<number>): boolean {
  const start = squareIndex(from);
  if (start !== null) {
    if (!CORRIDOR.has(start)) return false;
    return doorRoomAt(start) !== null || (NEIGHBOURS[start] ?? []).some((n) => !occupied.has(n));
  }
  return (DOORSTEPS.get(from) ?? []).some((step) => !occupied.has(step));
}
