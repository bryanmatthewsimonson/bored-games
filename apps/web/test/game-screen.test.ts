import type { SessionView } from '@bored-games/client';
import { describe, expect, it } from 'vitest';
import { npubEncode, shortNpub } from '../src/bech32.ts';
import { MAX_PROFILE_NAME, profileName } from '../src/profile-model.ts';
import {
  attestLine,
  equivocatorsOf,
  forkLine,
  formatDeadline,
  placesText,
  playerNames,
  resignExplanation,
  resignedSeats,
  resignLine,
  SendAnyway,
  SyncNotes,
  setupStep,
  statusNotice,
  timedOutSeats,
  timeoutExplanation,
} from '../src/screens/game.tsx';
import { findAll, renderTree, spokenText } from './render-tree.ts';

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
    // After a resign (D052): the withheld secrets, not the resigning seat or an equivocator.
    expect(
      timedOutSeats(
        viewOf({
          phase: 'done',
          resigned: [1],
          equivocators: [3],
          audit: { fail: [0, 1, 3], reason: 'resign; withheld secret' },
        }),
      ),
    ).toEqual([0]);
    expect(
      timedOutSeats(viewOf({ phase: 'done', resigned: [1], audit: { fail: [1], reason: 'resign' } })),
    ).toEqual([]);
  });
});

describe('game chrome helpers (D045)', () => {
  it('reads the seats whose resignation ended the game', () => {
    expect(resignedSeats(null)).toEqual([]);
    expect(resignedSeats(viewOf({ resigned: [1] }))).toEqual([1]);
  });

  it('explains what resigning does: a cancel before the first action, a loss after', () => {
    expect(
      resignExplanation(viewOf({ phase: 'play', seats: 2, shuffleSteps: 0, head: { id: 'h', seq: 0 } })),
    ).toMatch(/cancels the game/);
    expect(
      resignExplanation(viewOf({ phase: 'play', seats: 2, shuffleSteps: 0, head: { id: 'h', seq: 3 } })),
    ).toMatch(/You lose the game/);
    // 3 or more players (D052): the game ends for everyone, unrated, and the resignation is recorded.
    expect(
      resignExplanation(viewOf({ phase: 'play', seats: 4, shuffleSteps: 4, head: { id: 'h', seq: 9 } })),
    ).toBe(
      "Resigning ends the game for everyone. Final places are worked out as if the game ended now; the game won't count toward ratings, and your resignation is recorded.",
    );
    expect(
      resignExplanation(viewOf({ phase: 'play', seats: 4, shuffleSteps: 4, head: { id: 'h', seq: 4 } })),
    ).toMatch(/cancels the game/);
  });

  it('says who ended the game early, unrated, and the places once they are known', () => {
    const names = ['Ann', 'Bo', 'Cy'];
    const outcome = {
      places: [1, 3, 2],
      reason: 'resign',
      scores: [9000, 6000, 7000],
      unrated: true as const,
      endedBy: { type: 'resign' as const, seat: 1 },
    };
    expect(resignLine(null, names)).toBeNull();
    expect(resignLine(viewOf({ phase: 'play', resigned: [] }), names)).toBeNull();
    expect(resignLine(viewOf({ phase: 'cancelled', resigned: [1], outcome: null }), names)).toBeNull();
    expect(resignLine(viewOf({ phase: 'end', resigned: [1], outcome: null }), names)).toBe(
      "Ended early: Bo resigned · unrated. Checking the game: waiting for every player's end-of-game secret.",
    );
    expect(resignLine(viewOf({ phase: 'done', resigned: [1], outcome }), names)).toBe(
      'Ended early: Bo resigned · unrated. Final places: 1. Ann, 2. Cy, 3. Bo.',
    );
    // Two players: a plain loss, as before.
    const two = { places: [2, 1], reason: 'resign', scores: [1, 1] };
    expect(resignLine(viewOf({ phase: 'done', seats: 2, resigned: [0], outcome: two }), names)).toBe(
      'The game is over: Ann has resigned. Final places: 1. Bo, 2. Ann.',
    );
    expect(placesText(viewOf({ outcome: null }), names)).toBe('');
  });

  it('notes an unrated end that holds only by the freeze (D056)', () => {
    const outcome = { places: [1, 2, 3], reason: 'forfeit', scores: [3, 2, 1] };
    expect(forkLine(viewOf({ phase: 'done', outcome }), ['Ann', 'Bo', 'Cy'])).toBeNull();
    const forked = { ...outcome, unrated: true as const, endedBy: { type: 'fork' as const, seat: 2 } };
    expect(forkLine(viewOf({ phase: 'done', outcome: forked }), ['Ann', 'Bo', 'Cy'])).toMatch(
      /^Unrated: Cy signed two rival moves/,
    );
  });

  it('counts the attestations once there is a result', () => {
    const outcome = { places: [1, 2], reason: 'resign', scores: [1, 1] };
    expect(attestLine(null)).toBeNull();
    expect(attestLine(viewOf({ phase: 'play', outcome: null, attested: [] }))).toBeNull();
    expect(attestLine(viewOf({ phase: 'done', seats: 2, outcome, attested: [0] }))).toBe(
      'Result signed by 1 of 2 players so far.',
    );
    expect(attestLine(viewOf({ phase: 'done', seats: 2, outcome, attested: [0, 1] }))).toBe(
      'Result confirmed: signed by both players.',
    );
    expect(attestLine(viewOf({ phase: 'done', seats: 3, outcome, attested: [0, 1, 2] }))).toBe(
      'Result confirmed: signed by all 3 players.',
    );
  });

  it('words the setup step from the game’s copy; a deckless game has none', () => {
    const copy = { shuffling: 'Shuffling the deck', dealing: 'Dealing the tiles…' };
    expect(setupStep(null, copy)).toMatch(/Looking for the game/);
    expect(setupStep(viewOf({ phase: 'shuffle', head: { id: 'h', seq: 1 } }), copy)).toBe(
      'Shuffling the deck: 1 of 3 players done.',
    );
    expect(setupStep(viewOf({ phase: 'deal' }), copy)).toBe('Dealing the tiles…');
    for (const [seq, complete] of [
      [1, 0],
      [4, 1],
      [7, 1],
      [8, 2],
      [12, 3],
    ] as const) {
      expect(setupStep(viewOf({ phase: 'shuffle', shuffleSteps: 12, head: { id: 'h', seq } }), copy)).toBe(
        `Shuffling the deck: ${complete} of 3 players done.`,
      );
    }
    expect(setupStep(viewOf({ phase: 'play' }), null)).toBe('Loading the game…');
  });

  it('offers Send anyway with a button that calls back (D056)', () => {
    let sent = 0;
    const tree = renderTree(SendAnyway({ onSend: () => sent++ }));
    const buttons = findAll(tree, (el) => el.tag === 'button');
    expect(buttons).toHaveLength(1);
    expect(spokenText(tree)).toMatch(/waiting for every relay/);
    for (const b of buttons) (b.attrs.onClick as () => void)();
    expect(sent).toBe(1);
  });

  it('shows the sync notes in a disclosure, and nothing when there are none (D056)', () => {
    expect(renderTree(SyncNotes({ lines: [] }))).toEqual([]);
    const line = 'A move saved on this device was never sent, and it was discarded: the game has moved on.';
    const tree = renderTree(SyncNotes({ lines: [line, line] }));
    expect(findAll(tree, (el) => el.tag === 'details')).toHaveLength(1);
    expect(findAll(tree, (el) => el.tag === 'li')).toHaveLength(2);
    expect(spokenText(tree)).toMatch(/Sync notes \(2\)/);
    expect(spokenText(tree)).toContain(line);
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
