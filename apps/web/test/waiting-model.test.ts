import type { Pending } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { npubEncode, shortNpub } from '../src/bech32.ts';
import { playerNames } from '../src/screens/game.tsx';
import { listNames, type WaitingInput, waitingLine } from '../src/waiting-model.ts';

const SEATS = ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)];
const NAMES = playerNames(SEATS, ['BurrVurrLurr', null, 'Cy']);
const shuffle = (seat: number): Pending => ({ type: 'player', seat, decision: 'shuffle' });
const input = (over: Partial<WaitingInput>): WaitingInput => ({
  phase: 'shuffle',
  pending: shuffle(0),
  mySeat: null,
  waiting: [],
  names: NAMES,
  ...over,
});

describe('waiting for (D057)', () => {
  it('lists names as a sentence', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['Ann'])).toBe('Ann');
    expect(listNames(['Ann', 'Bo'])).toBe('Ann and Bo');
    expect(listNames(['Ann', 'Bo', 'Cy'])).toBe('Ann, Bo and Cy');
  });

  it('the shuffle: names the next shuffler with its short npub, to players and spectators', () => {
    const want = `Waiting for BurrVurrLurr (${shortNpub(npubEncode(SEATS[0] as string))}) to shuffle. Their app must be open on this game.`;
    expect(waitingLine(input({ waiting: [0] }))).toBe(want);
    expect(waitingLine(input({ waiting: [0], mySeat: 2 }))).toBe(want);
    // Without a profile name, the short npub alone.
    expect(waitingLine(input({ pending: shuffle(1), waiting: [1], mySeat: 0 }))).toBe(
      `Waiting for ${shortNpub(npubEncode(SEATS[1] as string))} to shuffle. Their app must be open on this game.`,
    );
    // My own step: my client is working on it, so no line.
    expect(waitingLine(input({ pending: shuffle(2), waiting: [2], mySeat: 2 }))).toBeNull();
  });

  it('the deal: every seat still missing its deal shares, but mine', () => {
    const deal = input({ phase: 'deal', pending: { type: 'over' }, waiting: [0, 2] });
    expect(waitingLine(deal)).toBe(
      `Waiting for ${NAMES[0]} and ${NAMES[2]} to send their deal shares. Their apps must be open on this game.`,
    );
    expect(waitingLine({ ...deal, mySeat: 0 })).toBe(
      `Waiting for ${NAMES[2]} to send their deal shares. Their app must be open on this game.`,
    );
    expect(waitingLine({ ...deal, waiting: [0], mySeat: 0 })).toBeNull();
    expect(waitingLine({ ...deal, waiting: [] })).toBeNull();
  });

  it("play: silent when it waits on the deciding seat (the game's status line names it), else names the sharers", () => {
    const decide: Pending = { type: 'player', seat: 1, decision: 'place' };
    expect(waitingLine(input({ phase: 'play', pending: decide, waiting: [1] }))).toBeNull();
    // Seat 1 decides, but needs a tile seat 2 has not shared yet.
    expect(waitingLine(input({ phase: 'play', pending: decide, waiting: [2], mySeat: 1 }))).toBe(
      `Waiting for ${NAMES[2]} to send their shares. Their app must be open on this game.`,
    );
    // A public reveal.
    expect(
      waitingLine(
        input({ phase: 'play', pending: { type: 'reveal', deck: 'tiles', positions: [0] }, waiting: [0, 1] }),
      ),
    ).toBe(
      `Waiting for ${NAMES[0]} and ${NAMES[1]} to send their shares. Their apps must be open on this game.`,
    );
  });

  it('play: a reshuffle names the next shuffler, before the share line', () => {
    const pending: Pending = {
      type: 'shuffle',
      deck: 'pile',
      epoch: 1,
      from: [{ deck: 'pile', pos: 3 }],
    };
    expect(waitingLine(input({ phase: 'play', pending, waiting: [1], mySeat: 0 }))).toBe(
      `Waiting for ${NAMES[1]} to shuffle. Their app must be open on this game.`,
    );
    expect(waitingLine(input({ phase: 'play', pending, waiting: [1], mySeat: 1 }))).toBeNull();
  });

  it('the end: the seats whose secret is not in; nothing once the game waits on nobody', () => {
    const end = input({ phase: 'end', pending: { type: 'over' }, waiting: [1], mySeat: 0 });
    expect(waitingLine(end)).toBe(
      `Waiting for ${NAMES[1]} to send their end-of-game secret. Their app must be open on this game.`,
    );
    expect(waitingLine({ ...end, waiting: [1, 2] })).toMatch(/end-of-game secrets\. Their apps/);
    expect(waitingLine({ ...end, phase: 'done', waiting: [] })).toBeNull();
    expect(waitingLine({ ...end, phase: 'cancelled', waiting: [1] })).toBeNull();
    // A seat with no name yet still gets one.
    expect(waitingLine({ ...end, names: [] })).toMatch(/^Waiting for Seat 2 /);
  });
});
