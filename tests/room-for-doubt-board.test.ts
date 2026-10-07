import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardProblems, boardStats, formatStats, parseBoard } from '../scripts/room-for-doubt/board.ts';

const text = readFileSync(join(import.meta.dirname, '../docs/games/room-for-doubt/board.txt'), 'utf8');
/** The grid with the square at (x, y) replaced by `c`. */
const set = (t: string, x: number, y: number, c: string): string => {
  const rows = t.split('\n');
  rows[y] = (rows[y] ?? '').slice(0, x) + c + (rows[y] ?? '').slice(x + 1);
  return rows.join('\n');
};

describe('board.txt', () => {
  it('satisfies every property of spec section 5', () => expect(boardProblems(text)).toEqual([]));
  it('has the measured numbers RULES.md quotes', () => {
    const stats = boardStats(parseBoard(text));
    expect(stats).toEqual({
      doors: 19,
      corridorSquares: 197,
      median: 13.5,
      longestOffPassages: 22,
      passageTrips: [28, 29],
      atMost7: 7,
      within12: {
        courtroom: 4,
        chambers: 3,
        jury: 4,
        robing: 4,
        registry: 4,
        store: 3,
        cells: 3,
        belfry: 3,
        gallery: 4,
      },
    });
    expect(formatStats(stats)).toBe(
      '19 doors · 197 corridor squares · median trip 13.5 · longest trip off the passages 22 · passage trips 28 and 29 · 7 trips of 7 or fewer',
    );
  });
  it('reads CRLF line endings as the same board', () =>
    expect(parseBoard(text.replaceAll('\n', '\r\n'))).toEqual(parseBoard(text)));

  const mutations: [string, (t: string) => string, RegExp][] = [
    ['a missing row', (t) => t.split('\n').slice(1).join('\n'), /grid is not 24 x 24/],
    ['an illegal character', (t) => set(t, 3, 3, 'Z'), /illegal character 'Z' at 3,3/],
    ['a hole in the Rotunda', (t) => set(t, 10, 10, '.'), /the # squares are not one rectangle/],
    ['a door with no room behind it', (t) => set(t, 3, 7, '<'), /door at 3,7 has no room behind it/],
    [
      'a doorstep inside a room',
      (t) => set(t, 6, 3, 'H'),
      /doorstep 6,3 of the door at 5,3 is not a corridor square/,
    ],
    [
      'a doorstep serving two doors',
      (t) => set(set(set(t, 17, 15, 'Y'), 17, 16, 'v'), 18, 17, '<'),
      /doorstep 17,17 serves two doors/,
    ],
    ['a dead end', (t) => set(t, 18, 1, 'B'), /dead end at 18,0/],
    [
      'a room with no doors',
      (t) => set(set(t, 19, 5, 'B'), 21, 6, 'B'),
      /room belfry has 0 doors \(want 1 to 2\)/,
    ],
    [
      'entrances out of order',
      (t) => set(set(t, 7, 0, '2'), 18, 0, '1'),
      /entrances are not in clockwise order/,
    ],
    [
      'an entrance off the outer ring',
      (t) => set(set(t, 0, 12, '.'), 1, 12, '6'),
      /entrance 6 is not on the outer ring/,
    ],
    [
      'a corner room away from its corner',
      (t) => set(t, 0, 0, '.'),
      /room chambers does not touch its corner/,
    ],
    [
      'too few corridor squares',
      (t) => Array.from({ length: 17 }, (_, x) => x).reduce((a, x) => set(a, x, 8, 'C'), t),
      /corridor squares \(want 190 to 230\)/,
    ],
  ];
  for (const [name, mutate, message] of mutations)
    it(`rejects ${name}`, () => expect(boardProblems(mutate(text)).join('\n')).toMatch(message));
});
