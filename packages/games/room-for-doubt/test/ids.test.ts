import { describe, expect, it } from 'vitest';
import {
  EXHIBITS as ART_EXHIBITS,
  PARTIES as ART_PARTIES,
  SCENES as ART_SCENES,
  SEAT_PARTIES as ART_SEAT_PARTIES,
} from '../../../../scripts/room-for-doubt/data.ts';
import {
  cardName,
  DECK_ID,
  DECK_SIZE,
  EXHIBITS,
  HAND_POSITIONS,
  kindOf,
  PARTIES,
  ROOM_POSITIONS,
  SCENES,
  SEAT_PARTIES,
  VERDICT_POSITIONS,
} from '../src/ids.ts';
import * as pkg from '../src/index.ts';

describe('ids', () => {
  it('lists the Parties, Exhibits and Scenes in the order of RULES.md', () => {
    expect(PARTIES).toEqual(['ashdown', 'brine', 'reeve', 'crowther', 'faulk', 'quarrel']);
    expect(EXHIBITS).toEqual(['gavel', 'scales', 'reports', 'carafe', 'manacles', 'clockhand']);
    expect(SCENES).toEqual([
      'courtroom',
      'chambers',
      'jury',
      'robing',
      'registry',
      'store',
      'cells',
      'belfry',
      'gallery',
    ]);
  });

  it('agrees with the ids the art is drawn from', () => {
    expect(PARTIES).toEqual(ART_PARTIES.map((p) => p.id));
    expect(EXHIBITS).toEqual(ART_EXHIBITS.map((e) => e.id));
    expect(SCENES).toEqual(ART_SCENES.map((s) => s.id));
    for (const seats of [3, 4, 5, 6] as const)
      expect(SEAT_PARTIES[seats].map((p) => PARTIES[p])).toEqual(ART_SEAT_PARTIES[seats]);
  });

  it('numbers the cards: Parties 0-5, Exhibits 6-11, Scenes 12-20, then the nine room cards 21-29', () => {
    for (const [i, id] of PARTIES.entries()) {
      expect(cardName(i)).toBe(id);
      expect(kindOf(i)).toBe('party');
    }
    for (const [i, id] of EXHIBITS.entries()) {
      expect(cardName(6 + i)).toBe(id);
      expect(kindOf(6 + i)).toBe('exhibit');
    }
    for (const [i, id] of SCENES.entries()) {
      expect(cardName(12 + i)).toBe(id);
      expect(kindOf(12 + i)).toBe('scene');
    }
    // Room card 21 + r names SCENES[r]: the room where an Exhibit may start, not a Scene card.
    for (const [r, id] of SCENES.entries()) {
      expect(cardName(21 + r)).toBe(id);
      expect(kindOf(21 + r)).toBe('room');
    }
  });

  it('puts the kind boundaries at 6, 12 and 21', () => {
    expect([5, 6, 11, 12, 20, 21, 29].map(kindOf)).toEqual([
      'party',
      'exhibit',
      'exhibit',
      'scene',
      'scene',
      'room',
      'room',
    ]);
  });

  it('refuses a number that is not a card of the deck', () => {
    for (const n of [-1, 30, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => cardName(n), String(n)).toThrow(RangeError);
      expect(() => kindOf(n), String(n)).toThrow(RangeError);
    }
  });

  it('lays the deck out in four groups of 6, 6, 9 and 9 (D076)', () => {
    expect(DECK_ID).toBe('case');
    expect(DECK_SIZE).toBe(30);
    expect(VERDICT_POSITIONS).toEqual([0, 6, 12]);
    expect(HAND_POSITIONS).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(ROOM_POSITIONS).toEqual([21, 22, 23, 24, 25, 26]);
  });

  it('deals every case card but the Verdict once, and starts exhibit e in the room that 21 + e names', () => {
    // The Verdict is the first card of each case group: a Party, an Exhibit and a Scene.
    expect(VERDICT_POSITIONS.map(kindOf)).toEqual(['party', 'exhibit', 'scene']);
    const caseCards = Array.from({ length: 21 }, (_, i) => i);
    expect(HAND_POSITIONS).toEqual(caseCards.filter((i) => !VERDICT_POSITIONS.includes(i)));
    expect(HAND_POSITIONS).toHaveLength(18);
    expect(ROOM_POSITIONS).toHaveLength(EXHIBITS.length);
    for (const [e, pos] of ROOM_POSITIONS.entries()) {
      expect(pos).toBe(21 + e);
      expect(kindOf(pos)).toBe('room');
    }
    expect(DECK_SIZE).toBe(21 + SCENES.length);
  });

  it('spreads the Parties by seat count (P1), the Prosecutor always played', () => {
    expect(SEAT_PARTIES).toEqual({
      3: [0, 2, 4],
      4: [0, 1, 3, 4],
      5: [0, 1, 2, 3, 4],
      6: [0, 1, 2, 3, 4, 5],
    });
    for (const seats of [3, 4, 5, 6] as const) {
      expect(SEAT_PARTIES[seats]).toHaveLength(seats);
      expect(SEAT_PARTIES[seats][0]).toBe(0);
    }
  });
});

describe('the package index', () => {
  it('exports the ids, the board and the movement search', () => {
    for (const name of [
      'PARTIES',
      'EXHIBITS',
      'SCENES',
      'cardName',
      'kindOf',
      'DECK_ID',
      'DECK_SIZE',
      'VERDICT_POSITIONS',
      'HAND_POSITIONS',
      'ROOM_POSITIONS',
      'SEAT_PARTIES',
      'BOARD_ROWS',
      'squareName',
      'squareIndex',
      'ROOM_RECTS',
      'DOORS',
      'CORRIDOR',
      'ENTRANCES',
      'ROTUNDA',
      'passageTo',
      'doorRoomAt',
      'destinations',
      'canMove',
    ])
      expect(pkg, name).toHaveProperty(name);
  });
});
