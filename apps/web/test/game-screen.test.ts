import { describe, expect, it } from 'vitest';
import { equivocatorsOf, formatDeadline, statusNotice } from '../src/screens/game.tsx';

describe('game screen helpers', () => {
  it('formats the time left on the deadline', () => {
    expect(formatDeadline(2 * 86400 + 4 * 3600 + 59)).toBe('2d 4h left');
    expect(formatDeadline(3 * 3600 + 10 * 60)).toBe('3h 10m left');
    expect(formatDeadline(30)).toBe('1m left');
    expect(formatDeadline(0)).toBe('deadline passed');
  });

  it('describes the automatic phases and leaves the turn states to the board', () => {
    expect(statusNotice('syncing', null)).toMatch(/Loading/);
    expect(statusNotice('working', null)).toBe('Working…');
    expect(statusNotice('your-turn', null)).toBeUndefined();
    expect(statusNotice('waiting', null)).toBeUndefined();
    expect(statusNotice('cancelled', null)).toMatch(/cancelled/);
  });

  it('reads the flagged equivocators when the session reports them', () => {
    expect(equivocatorsOf(null)).toEqual([]);
    expect(equivocatorsOf({ phase: 'play' } as never)).toEqual([]);
    expect(equivocatorsOf({ equivocators: [2, 'x'] } as never)).toEqual([2]);
  });
});
