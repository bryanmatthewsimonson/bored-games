import type { SessionView } from '@bored-games/client';
import { describe, expect, it } from 'vitest';
import { npubEncode, shortNpub } from '../src/bech32.ts';
import { MAX_PROFILE_NAME, profileName } from '../src/profile-model.ts';
import {
  equivocatorsOf,
  formatDeadline,
  playerNames,
  statusNotice,
  timedOutSeats,
  timeoutExplanation,
} from '../src/screens/game.tsx';

const viewOf = (v: Partial<SessionView>): SessionView =>
  ({ seats: 3, shuffleSteps: 3, head: { id: 'h', seq: 3 }, ...v }) as SessionView;

describe('game screen helpers', () => {
  it('formats the time left on the deadline', () => {
    expect(formatDeadline(2 * 86400 + 4 * 3600 + 59)).toBe('2d 4h left');
    expect(formatDeadline(3 * 3600 + 10 * 60)).toBe('3h 10m left');
    expect(formatDeadline(30)).toBe('1m left');
    expect(formatDeadline(0)).toBe('deadline passed');
  });

  it('describes the automatic phases and leaves the turn states to the board', () => {
    expect(statusNotice('syncing', null)).toMatch(/Loading/);
    expect(statusNotice('working', null)).toBe('working…');
    expect(statusNotice('stuck', null)).toMatch(/Stuck/);
    expect(statusNotice('your-turn', null)).toBeUndefined();
    expect(statusNotice('waiting', null)).toBeUndefined();
    expect(statusNotice('cancelled', null)).toMatch(/cancelled/);
  });

  it('reads the flagged equivocators when the session reports them', () => {
    expect(equivocatorsOf(null)).toEqual([]);
    expect(equivocatorsOf({ phase: 'play' } as never)).toEqual([]);
    expect(equivocatorsOf({ equivocators: [2, 'x'] } as never)).toEqual([2]);
  });

  it('explains what a timeout claim does: cancel before the first action, forfeit after', () => {
    for (const v of [
      viewOf({ phase: 'shuffle', head: { id: 'h', seq: 1 } }),
      viewOf({ phase: 'deal' }),
      viewOf({ phase: 'play', head: { id: 'h', seq: 3 } }),
    ]) {
      expect(timeoutExplanation(v, 'Bo')).toMatch(
        /Bo forfeits, and because no move .* cancelled without a result/,
      );
    }
    expect(timeoutExplanation(viewOf({ phase: 'play', head: { id: 'h', seq: 4 } }), 'Bo')).toMatch(
      /Bo forfeits: the game ends now, Bo is ranked last/,
    );
    // A deckless game (D045) has no shuffle steps: its first move is a game action.
    expect(
      timeoutExplanation(viewOf({ phase: 'play', shuffleSteps: 0, head: { id: 'h', seq: 0 } }), 'Bo'),
    ).toMatch(/cancelled without a result/);
    expect(
      timeoutExplanation(viewOf({ phase: 'play', shuffleSteps: 0, head: { id: 'h', seq: 1 } }), 'Bo'),
    ).toMatch(/Bo forfeits: the game ends now/);
    expect(timeoutExplanation(viewOf({ phase: 'end', head: { id: 'h', seq: 90 } }), 'Bo')).toMatch(
      /end-of-game secret .* Bo forfeits and is ranked last/,
    );
  });

  it('names the seats a timeout made forfeit once the game is done', () => {
    expect(timedOutSeats(null)).toEqual([]);
    expect(timedOutSeats(viewOf({ phase: 'done', audit: 'pass' }))).toEqual([]);
    expect(timedOutSeats(viewOf({ phase: 'done', audit: { fail: [1], reason: 'timeout' } }))).toEqual([1]);
    expect(
      timedOutSeats(viewOf({ phase: 'done', audit: { fail: [0, 2], reason: 'withheld secret' } })),
    ).toEqual([0, 2]);
    expect(timedOutSeats(viewOf({ phase: 'done', audit: { fail: [1], reason: 'bad shuffle' } }))).toEqual([]);
    expect(timedOutSeats(viewOf({ phase: 'play', audit: { fail: [1], reason: 'timeout' } }))).toEqual([]);
  });
});

describe('player names', () => {
  it('reads display_name, else name, from kind 0 metadata', () => {
    expect(profileName('{"display_name":"Ann Lee","name":"ann"}')).toBe('Ann Lee');
    expect(profileName('{"display_name":"  ","name":"ann"}')).toBe('ann');
    expect(profileName('{"name":42}')).toBeNull();
    expect(profileName('{}')).toBeNull();
    expect(profileName('null')).toBeNull();
    expect(profileName('not json')).toBeNull();
  });

  it('removes control and format characters, collapses whitespace and cuts to 32 characters', () => {
    expect(profileName(JSON.stringify({ name: 'An‮ne​\n\tLee\u0007' }))).toBe('Anne Lee');
    const long = profileName(JSON.stringify({ name: `${'x'.repeat(31)}😀😀` }));
    expect(long).toBe(`${'x'.repeat(31)}😀`);
    expect([...(long ?? '')]).toHaveLength(MAX_PROFILE_NAME);
  });

  it('shows the short npub, after the profile name when there is one', () => {
    const pk = 'a'.repeat(64);
    const short = shortNpub(npubEncode(pk));
    expect(short).toMatch(/^npub1.{5}….{6}$/);
    expect(playerNames([pk, pk], ['Ann', null])).toEqual([`Ann (${short})`, short]);
    expect(playerNames([pk], [])).toEqual([short]);
  });
});
