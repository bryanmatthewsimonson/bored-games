import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRng, type Rng } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { parseBoard } from '../../../../scripts/room-for-doubt/board.ts';
import { CORRIDOR, squareIndex, squareName } from '../src/board.ts';
import { SCENES, type SceneId } from '../src/ids.ts';
import { canMove, destinations } from '../src/movement.ts';

/** The index of a square that must exist. */
const sq = (name: string): number => {
  const i = squareIndex(name);
  if (i === null) throw new Error(`${name} is not a square`);
  return i;
};
/** The set of square indices that hold pawns, from their names. */
const occ = (...names: string[]): Set<number> => new Set(names.map(sq));
const ROLLS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

describe('destinations', () => {
  it('steps orthogonally (C10)', () => {
    expect(destinations('H1', 2, occ()).places).toEqual(['G2', 'H3']);
  });

  it('enters a room through its door and stops (C13, C15)', () => {
    expect(destinations('H1', 3, occ()).places).toContain('courtroom');
    // Two steps reach the doorstep, and the door is the third.
    expect(destinations('H1', 2, occ()).places).not.toContain('courtroom');
    const { places } = destinations('H1', 12, occ());
    expect(places).toContain('courtroom');
    // Entering a room ends the move: no place is a square inside a room, a door square or the Rotunda.
    for (const p of places) {
      const i = squareIndex(p);
      if (i !== null) expect(CORRIDOR.has(i), p).toBe(true);
    }
  });

  it('never enters an occupied square (C11)', () => {
    expect(destinations('H1', 2, occ('H2')).places).toEqual(['G2']);
  });

  it('never repeats a square (C12)', () => {
    for (const roll of ROLLS)
      expect(destinations('H1', roll, occ()).places, `roll ${roll}`).not.toContain('H1');
  });

  it('cannot use a door whose doorstep is occupied (C14)', () => {
    expect(destinations('H1', 3, occ('H3')).places).not.toContain('courtroom');
    const out = destinations('courtroom', 2, occ('H3')).places;
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) expect(['L7', 'N7', 'M8'], p).toContain(p);
  });

  it('never re-enters the room it left (C16)', () => {
    for (const roll of ROLLS)
      expect(destinations('courtroom', roll, occ()).places, `roll ${roll}`).not.toContain('courtroom');
  });

  it('falls short along the longest legal path (C19, P4)', () => {
    const blockers = occ('G4', 'H3', 'G5', 'H5');
    expect(destinations('H1', 6, blockers)).toEqual({ places: ['G1', 'H2', 'G3'], shortfall: true });
    expect(destinations('H1', 3, blockers)).toEqual({ places: ['G1', 'H2', 'G3'], shortfall: false });
  });

  it('is walled in with no first step (C18)', () => {
    expect(canMove('G1', occ('H1', 'G2'))).toBe(false);
    expect(destinations('G1', 7, occ('H1', 'G2')).places).toEqual([]);
    expect(canMove('courtroom', occ('H3', 'M7'))).toBe(false);
  });
});

describe('the edge cases a player meets', () => {
  it('lists the squares ascending by index, then the rooms in Scene order', () => {
    const { places } = destinations('H1', 12, occ());
    const rooms = places.filter((p) => squareIndex(p) === null);
    const squares = places.filter((p) => squareIndex(p) !== null);
    expect(rooms.length).toBeGreaterThan(1);
    expect(places).toEqual([...squares, ...rooms]);
    expect(squares.map(sq)).toEqual(squares.map(sq).sort((a, b) => a - b));
    expect(rooms).toEqual(SCENES.filter((r) => rooms.includes(r)));
  });

  it('leaves a room by each of its doors in turn, the doorstep being the first step (C13)', () => {
    // Courtroom: H3 (door I3) and M7 (door M6). Two steps reach the squares one beyond each doorstep.
    expect(destinations('courtroom', 2, occ())).toEqual({
      places: ['H2', 'G3', 'H4', 'L7', 'N7', 'M8'],
      shortfall: false,
    });
    // Only the free door can be used.
    expect(destinations('courtroom', 2, occ('M7')).places).toEqual(['H2', 'G3', 'H4']);
  });

  it('lets a pawn on a doorstep enter by that door, though its own pawn stands on the doorstep (C14)', () => {
    const expected = ['H1', 'G2', 'G4', 'H5', 'courtroom'];
    expect(destinations('H3', 2, occ()).places).toEqual(expected);
    expect(destinations('H3', 2, occ('H3')).places).toEqual(expected);
    expect(canMove('H3', occ('H3', 'G3', 'H2', 'H4'))).toBe(true);
  });

  it('lets a pawn on a doorstep go into the room as its only free first step (C13)', () => {
    // G4 is Judge's Chambers' doorstep, shut in by pawns on G3, G5 and H4.
    const around = occ('G3', 'G5', 'H4');
    expect(canMove('G4', around)).toBe(true);
    expect(destinations('G4', 5, around)).toEqual({ places: ['chambers'], shortfall: false });
  });

  it('offers only the rooms when no path of the full roll exists but a shorter one ends in a room (P4)', () => {
    // From G3 the only free step is H3, which leads to the Courtroom, or round the dead end H2, H1, G1.
    expect(destinations('G3', 12, occ('G2', 'G4', 'H4'))).toEqual({
      places: ['courtroom'],
      shortfall: false,
    });
  });

  it('falls short from inside a room, and never re-enters it by the doorstep it came out of (C16, C19)', () => {
    // Judge's Chambers with the south door's doorstep taken: G4 is the one way out and a dead end.
    const dead = occ('B7', 'G3', 'G5', 'H4');
    expect(canMove('chambers', dead)).toBe(true);
    expect(destinations('chambers', 5, dead)).toEqual({ places: ['G4'], shortfall: true });
  });

  it('cannot leave a room whose every doorstep is occupied (C14, C18)', () => {
    expect(canMove('chambers', occ('G4', 'B7'))).toBe(false);
    expect(destinations('chambers', 7, occ('G4', 'B7'))).toEqual({ places: [], shortfall: false });
    // One free doorstep is enough to move.
    expect(canMove('chambers', occ('G4'))).toBe(true);
  });

  it('is walled in at an Entrance (C18)', () => {
    // Entrance 1 is H1: G1 and H2 are its only neighbours, and I1 is a wall of the Courtroom.
    expect(canMove('H1', occ('G1', 'H2'))).toBe(false);
    expect(destinations('H1', 6, occ('G1', 'H2'))).toEqual({ places: [], shortfall: false });
    expect(canMove('H1', occ('G1'))).toBe(true);
  });

  it('ignores a pawn on the square it starts from, and leaves its input alone', () => {
    const blockers = occ('H2', 'H1');
    const before = [...blockers];
    expect(destinations('H1', 2, blockers)).toEqual(destinations('H1', 2, occ('H2')));
    expect([...blockers]).toEqual(before);
  });

  it('keeps no state between calls', () => {
    const first = destinations('H1', 12, occ('G6'));
    destinations('A1', 3, occ());
    destinations('courtroom', 12, occ('H3'));
    expect(destinations('H1', 12, occ('G6'))).toEqual(first);
    // Every call answers with a fresh object, so a caller may keep or change what it gets.
    const a = destinations('G1', 7, occ('H1', 'G2'));
    a.places.push('Z9');
    expect(destinations('G1', 7, occ('H1', 'G2')).places).toEqual([]);
  });

  it('has no place to go from a place that is not a pawn place, or on a roll that is not a whole number', () => {
    const nowhere = { places: [], shortfall: false };
    expect(destinations('nowhere', 5, occ())).toEqual(nowhere);
    expect(destinations('A1', 5, occ())).toEqual(nowhere); // a square of Judge's Chambers
    expect(destinations('J10', 5, occ())).toEqual(nowhere); // the Rotunda
    expect(destinations('h1', 5, occ())).toEqual(nowhere);
    expect(destinations('H1', 0, occ())).toEqual(nowhere);
    expect(destinations('H1', -3, occ())).toEqual(nowhere);
    expect(destinations('H1', 2.5, occ())).toEqual(nowhere);
    expect(destinations('H1', 13, occ())).toEqual(nowhere); // more than two dice show
    expect(destinations('H1', Number.NaN, occ())).toEqual(nowhere);
    expect(canMove('nowhere', occ())).toBe(false);
    expect(canMove('A1', occ())).toBe(false);
  });

  it('works from every Entrance on an empty board, a roll of 12 reaching a room each time', () => {
    for (const from of ['H1', 'S1', 'X8', 'P24', 'G24', 'A13']) {
      const { places, shortfall } = destinations(from, 12, occ());
      expect(shortfall, from).toBe(false);
      expect(places.length, from).toBeGreaterThan(0);
      expect(
        places.some((p) => squareIndex(p) === null),
        from,
      ).toBe(true);
    }
  });
});

// ---- An independent reading of the rules ---------------------------------------------------------------------
// The oracle below lists every legal path, step by step, from the parsed board and RULES.md alone, and reads the
// answer off the list of paths. The engine's depth-first search shares none of its code.

const text = readFileSync(
  join(import.meta.dirname, '../../../../docs/games/room-for-doubt/board.txt'),
  'utf8',
);
const board = parseBoard(text);
const SIZE = 24;
const indexOf = ({ x, y }: { x: number; y: number }): number => y * SIZE + x;
const corridor = new Set(board.corridor.map(indexOf));
const doorstepRoom = new Map(board.doors.map((d) => [indexOf(d.step), d.room] as const));
const doorstepsOf = (room: SceneId): number[] =>
  board.doors.filter((d) => d.room === room).map((d) => indexOf(d.step));

type Step = { readonly square: number } | { readonly room: SceneId };

/** The corridor squares next to square `i`. */
function around(i: number): number[] {
  const x = i % SIZE;
  const y = Math.floor(i / SIZE);
  const points: [number, number][] = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
  return points
    .filter(([px, py]) => px >= 0 && px < SIZE && py >= 0 && py < SIZE)
    .map(([px, py]) => py * SIZE + px)
    .filter((n) => corridor.has(n));
}

/** Every legal path of 1 to `roll` steps from `from`; `blocked` holds the other pawns, never the mover's own. */
function legalPaths(from: string, roll: number, blocked: ReadonlySet<number>): Step[][] {
  const found: Step[][] = [];
  const start = squareIndex(from);
  const left = start === null ? (from as SceneId) : null;
  const walk = (path: Step[], visited: number[], here: number | null): void => {
    if (path.length === roll) return;
    const options: Step[] = [];
    if (here === null) {
      for (const step of doorstepsOf(left as SceneId)) if (!blocked.has(step)) options.push({ square: step });
    } else {
      for (const n of around(here)) if (!visited.includes(n) && !blocked.has(n)) options.push({ square: n });
      const room = doorstepRoom.get(here);
      if (room !== undefined && room !== left) options.push({ room });
    }
    for (const step of options) {
      const next = [...path, step];
      found.push(next);
      if ('square' in step) walk(next, [...visited, step.square], step.square);
    }
  };
  walk([], start === null ? [] : [start], start);
  return found;
}

/** What the rules say: the squares of exactly `roll` steps and every room entered, else the longest paths. */
function byTheRules(
  from: string,
  roll: number,
  blocked: ReadonlySet<number>,
): { places: string[]; shortfall: boolean } {
  const paths = legalPaths(from, roll, blocked);
  const ends = paths.map((path) => ({ length: path.length, end: path[path.length - 1] as Step }));
  const squares = new Set<number>();
  const rooms = new Set<SceneId>();
  for (const { length, end } of ends) {
    if ('room' in end) rooms.add(end.room);
    else if (length === roll) squares.add(end.square);
  }
  const named = [
    ...[...squares].sort((a, b) => a - b).map(squareName),
    ...SCENES.filter((r) => rooms.has(r)),
  ];
  if (named.length > 0) return { places: named, shortfall: false };
  // No full-roll path and no room: the longest legal path, any path of that greatest length (none: walled in).
  const longest = Math.max(0, ...ends.map((e) => e.length));
  const deepest = new Set(
    ends.flatMap(({ length, end }) => (length === longest && 'square' in end ? [end.square] : [])),
  );
  if (deepest.size === 0) return { places: [], shortfall: false };
  return { places: [...deepest].sort((a, b) => a - b).map(squareName), shortfall: true };
}

const corridorSquares = [...CORRIDOR].sort((a, b) => a - b);
const manhattan = (a: number, b: number): number =>
  Math.abs((a % SIZE) - (b % SIZE)) + Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE));

/** A random pawn place, roll and set of other pawns: sparse anywhere, or dense around the start. */
function randomPosition(rng: Rng): { from: string; roll: number; blocked: Set<number> } {
  const room = rng.int(3) === 0 ? rng.pick(SCENES) : null;
  const start = room === null ? rng.pick(corridorSquares) : null;
  const from = room ?? squareName(start as number);
  const anchors = room === null ? [start as number] : doorstepsOf(room);
  const blocked = new Set<number>();
  if (rng.int(2) === 0) {
    for (const i of corridorSquares)
      if (anchors.some((a) => manhattan(a, i) <= 3) && rng.int(2) === 0) blocked.add(i);
  } else {
    for (let n = rng.int(30); n > 0; n--) blocked.add(rng.pick(corridorSquares));
  }
  if (start !== null) blocked.delete(start);
  return { from, roll: 2 + rng.int(11), blocked };
}

describe('against an independent reading of the rules', () => {
  it('agrees with a path-by-path enumeration on 500 random positions, for squares and for rooms', () => {
    const rng = createRng('room-for-doubt/movement');
    const seen = { shortfall: 0, rooms: 0, stuck: 0, fromRoom: 0, long: 0 };
    for (let n = 0; n < 500; n++) {
      const { from, roll, blocked } = randomPosition(rng);
      const want = byTheRules(from, roll, blocked);
      const where = `${from} roll ${roll} blocked ${[...blocked].map(squareName).join(',')}`;
      expect(destinations(from, roll, blocked), where).toEqual(want);
      expect(canMove(from, blocked), where).toBe(legalPaths(from, 1, blocked).length > 0);
      expect(want.places.length > 0, where).toBe(canMove(from, blocked));
      // The mover's own pawn on its start square changes nothing.
      const start = squareIndex(from);
      if (start !== null) expect(destinations(from, roll, new Set([...blocked, start])), where).toEqual(want);
      if (want.shortfall) seen.shortfall++;
      if (want.places.some((p) => squareIndex(p) === null)) seen.rooms++;
      if (want.places.length === 0) seen.stuck++;
      if (start === null) seen.fromRoom++;
      if (roll >= 11) seen.long++;
    }
    // The samples reach every branch: the shortfall, a room entered, a walled-in pawn, a start inside a room.
    expect(seen.shortfall).toBeGreaterThan(10);
    expect(seen.rooms).toBeGreaterThan(100);
    expect(seen.stuck).toBeGreaterThan(5);
    expect(seen.fromRoom).toBeGreaterThan(100);
    expect(seen.long).toBeGreaterThan(50);
  });
});
