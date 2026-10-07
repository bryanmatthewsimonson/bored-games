import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBoard } from '../../../../scripts/room-for-doubt/board.ts';
import {
  BOARD_ROWS,
  CORRIDOR,
  DOORS,
  doorRoomAt,
  ENTRANCES,
  passageTo,
  ROOM_RECTS,
  ROTUNDA,
  squareIndex,
  squareName,
} from '../src/board.ts';
import { SCENES } from '../src/ids.ts';

const text = readFileSync(
  join(import.meta.dirname, '../../../../docs/games/room-for-doubt/board.txt'),
  'utf8',
);
const parsed = parseBoard(text);

/** A square's index in reading order, as the engine numbers them. */
const at = ({ x, y }: { x: number; y: number }): number => y * 24 + x;
const ascending = (a: number, b: number): number => a - b;
/** The index of a square that must exist. */
const sq = (name: string): number => {
  const i = squareIndex(name);
  if (i === null) throw new Error(`${name} is not a square`);
  return i;
};

describe('the board constant', () => {
  it('holds board.txt exactly', () => {
    expect(BOARD_ROWS).toHaveLength(24);
    expect(`${BOARD_ROWS.join('\n')}\n`).toBe(text);
  });

  it('agrees with the reviewed parser', () => {
    // The corridor squares and the Entrances.
    expect([...CORRIDOR].sort(ascending)).toEqual(parsed.corridor.map(at));
    expect(ENTRANCES).toEqual(parsed.entrances.map((s) => squareName(at(s))));
    expect(ENTRANCES).toEqual(['H1', 'S1', 'X8', 'P24', 'G24', 'A13']);
    // Each door's room and doorstep.
    expect(DOORS).toEqual(parsed.doors.map((d) => ({ room: d.room, door: at(d.door), step: at(d.step) })));
    // Each room's rect covers exactly its letter and door squares.
    for (const room of SCENES) {
      const { x0, y0, x1, y1 } = ROOM_RECTS[room];
      const inside: number[] = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) inside.push(at({ x, y }));
      expect(inside, room).toEqual(parsed.rooms[room].map(at).sort(ascending));
    }
    // The Rotunda, J10 to O15.
    expect(ROTUNDA).toEqual(parsed.rotunda);
    expect(ROTUNDA).toEqual({ x0: 9, y0: 9, x1: 14, y1: 14 });
  });

  it('keeps the corridor, the rooms and the Rotunda apart', () => {
    const inRect = (i: number, r: { x0: number; y0: number; x1: number; y1: number }): boolean =>
      i % 24 >= r.x0 && i % 24 <= r.x1 && Math.floor(i / 24) >= r.y0 && Math.floor(i / 24) <= r.y1;
    for (const i of CORRIDOR) {
      expect(inRect(i, ROTUNDA), squareName(i)).toBe(false);
      for (const room of SCENES)
        expect(inRect(i, ROOM_RECTS[room]), `${squareName(i)} in ${room}`).toBe(false);
    }
    // Every door square lies in its own room's rect, and its doorstep is a corridor square.
    for (const d of DOORS) {
      expect(inRect(d.door, ROOM_RECTS[d.room]), `${squareName(d.door)} door of ${d.room}`).toBe(true);
      expect(CORRIDOR.has(d.step), squareName(d.step)).toBe(true);
    }
  });
});

describe('square names', () => {
  it('names squares as the rules do', () => {
    expect(squareName(0)).toBe('A1');
    expect(squareName(575)).toBe('X24');
    expect(squareName(7)).toBe('H1');
    expect(squareIndex('H1')).toBe(7);
    expect(squareIndex('h1')).toBeNull();
    expect(squareIndex('H01')).toBeNull();
    expect(squareIndex('Y1')).toBeNull();
  });

  it('numbers a square y * 24 + x, columns A to X and rows 1 to 24, and round-trips every square', () => {
    expect(squareIndex('A1')).toBe(0);
    expect(squareIndex('X1')).toBe(23);
    expect(squareIndex('A2')).toBe(24);
    expect(squareIndex('X24')).toBe(575);
    for (let i = 0; i < 576; i++) expect(squareIndex(squareName(i)), String(i)).toBe(i);
  });

  it('accepts exactly one spelling of a square', () => {
    for (const bad of [
      '',
      'H',
      '1',
      'H0',
      'H00',
      'H25',
      'H024',
      'H-1',
      'H1.5',
      'H 1',
      ' H1',
      'H1 ',
      'H1\n',
      '\nH1',
      'HH1',
      'H1H',
      '+H1',
      '\uFF281',
      'courtroom',
      'Courtroom',
    ])
      expect(squareIndex(bad), JSON.stringify(bad)).toBeNull();
  });

  it('refuses an index that is not a square', () => {
    for (const i of [-1, 576, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => squareName(i), String(i)).toThrow(RangeError);
  });
});

describe('doors and passages', () => {
  it('joins the opposite corners', () => {
    expect(passageTo('chambers')).toBe('store');
    expect(passageTo('store')).toBe('chambers');
    expect(passageTo('cells')).toBe('belfry');
    expect(passageTo('belfry')).toBe('cells');
    expect(passageTo('courtroom')).toBeNull();
    expect(doorRoomAt(sq('H3'))).toBe('courtroom');
  });

  it('has a passage only from the four corner rooms', () => {
    expect(SCENES.filter((r) => passageTo(r) !== null)).toEqual(['chambers', 'store', 'cells', 'belfry']);
    for (const r of SCENES) {
      const other = passageTo(r);
      if (other !== null) expect(passageTo(other), r).toBe(r);
    }
  });

  it('names the room of a doorstep, and only of a doorstep', () => {
    for (const d of DOORS) expect(doorRoomAt(d.step), squareName(d.step)).toBe(d.room);
    expect(new Set(DOORS.map((d) => d.step)).size).toBe(DOORS.length);
    const steps = new Set(DOORS.map((d) => d.step));
    for (let i = 0; i < 576; i++) if (!steps.has(i)) expect(doorRoomAt(i), squareName(i)).toBeNull();
    // A door square belongs to its room, so it is not a doorstep; neither is a square off the board.
    expect(doorRoomAt(sq('I3'))).toBeNull();
    expect(doorRoomAt(-1)).toBeNull();
    expect(doorRoomAt(576)).toBeNull();
  });

  it('puts the doors where RULES.md puts them', () => {
    const byRoom = (room: string): [string, string][] =>
      DOORS.filter((d) => d.room === room).map((d) => [squareName(d.door), squareName(d.step)]);
    expect(byRoom('courtroom')).toEqual([
      ['I3', 'H3'],
      ['M6', 'M7'],
    ]);
    expect(byRoom('chambers')).toEqual([
      ['F4', 'G4'],
      ['B6', 'B7'],
    ]);
    expect(byRoom('jury')).toEqual([
      ['F10', 'F9'],
      ['C12', 'B12'],
      ['H13', 'I13'],
    ]);
    expect(DOORS).toHaveLength(19);
    expect(CORRIDOR.size).toBe(197);
  });
});
