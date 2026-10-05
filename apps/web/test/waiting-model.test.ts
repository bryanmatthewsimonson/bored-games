import type { Pending } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { npubEncode, shortNpub } from '../src/bech32.ts';
import { shareWordsOf, webGame } from '../src/games/registry.ts';
import { playerNames } from '../src/screens/game.tsx';
import {
  listNames,
  NEUTRAL_SHARE,
  owedReveal,
  owedWords,
  ownRevealLine,
  ROLL_WORDS,
  type WaitingInput,
  waitingLine,
} from '../src/waiting-model.ts';

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
      `Waiting for ${NAMES[2]} to send their share. Their app must be open on this game.`,
    );
    // A public reveal.
    expect(
      waitingLine(
        input({ phase: 'play', pending: { type: 'reveal', deck: 'tiles', positions: [0] }, waiting: [0, 1] }),
      ),
    ).toBe(
      `Waiting for ${NAMES[0]} and ${NAMES[1]} to send their share. Their apps must be open on this game.`,
    );
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

  it('play: names who owes a card reveal and when they can be timed out for it (D060)', () => {
    const refill: Pending = { type: 'reveal', deck: 'glass', positions: [7] };
    const one = input({
      share: { act: 'reveal a card', owed: 'a card reveal' },
      phase: 'play',
      pending: refill,
      waiting: [0, 2],
      mySeat: 0,
      secondsLeft: 2 * 86400 + 4 * 3600,
    });
    expect(waitingLine(one)).toBe(
      `Waiting for ${NAMES[2]} to reveal a card. Their app must be open on this game. If it is not sent within 2d 4h, ${NAMES[2]} can be timed out.`,
    );
    expect(waitingLine({ ...one, mySeat: null, secondsLeft: 90 })).toBe(
      `Waiting for ${NAMES[0]} and ${NAMES[2]} to reveal a card. Their apps must be open on this game. If they are not sent within 1m, ${NAMES[0]} and ${NAMES[2]} can be timed out.`,
    );
    expect(waitingLine({ ...one, secondsLeft: 0 })).toBe(
      `Waiting for ${NAMES[2]} to reveal a card. Their app must be open on this game. The deadline has passed: ${NAMES[2]} can be timed out.`,
    );
  });
});

describe('a card reveal owed out of turn (D060)', () => {
  const base = { pendingSince: 1000, deadline: 86400 };
  it('is the seats a public reveal waits on, or the sharers a decision waits on, never the decider', () => {
    const refill: Pending = { type: 'reveal', deck: 'glass', positions: [7] };
    expect(owedReveal({ ...base, phase: 'play', pending: refill, waiting: [0, 1] })).toEqual({
      seats: [0, 1],
      until: 87400,
    });
    // Seat 1 blind-reserved a card: the others' shares are owed before seat 1 can act.
    const blind: Pending = { type: 'player', seat: 1, decision: 'turn' };
    expect(owedReveal({ ...base, phase: 'play', pending: blind, waiting: [0, 2] })).toEqual({
      seats: [0, 2],
      until: 87400,
    });
    // Waiting on the decider alone is a turn, not a reveal.
    expect(owedReveal({ ...base, phase: 'play', pending: blind, waiting: [1] })).toBeNull();
    expect(owedReveal({ ...base, phase: 'play', pending: refill, waiting: [] })).toBeNull();
    // Outside play the setup and end lines say what is owed.
    expect(owedReveal({ ...base, phase: 'deal', pending: { type: 'over' }, waiting: [0] })).toBeNull();
    expect(owedReveal({ ...base, phase: 'end', pending: { type: 'over' }, waiting: [0] })).toBeNull();
  });

  it('tells the owing player to keep the game open, with the deadline; nothing for anyone else', () => {
    const owed = { seats: [0, 2], until: 1000 + 3 * 3600 + 600 };
    expect(ownRevealLine(owed, 2, 1000)).toBe(
      'You owe a share: keep this game open until it is sent. If it is not sent within 3h 10m, you can be timed out.',
    );
    // In the game's own words (Chain Reaction's tiles).
    expect(
      ownRevealLine(owed, 2, 1000, { act: 'send their share of a tile', owed: 'a share of a tile' }),
    ).toMatch(/^You owe a share of a tile: /);
    expect(ownRevealLine(owed, 2, owed.until)).toBe(
      'You owe a share: keep this game open until it is sent. The deadline has passed: you can be timed out.',
    );
    expect(ownRevealLine(owed, 1, 1000)).toBeNull();
    expect(ownRevealLine(owed, null, 1000)).toBeNull();
    expect(ownRevealLine(null, 0, 1000)).toBeNull();
  });
});

describe('a roll contribution owed (PROTOCOL-v2 §6.4)', () => {
  const base = { pendingSince: 1000, deadline: 86400 };
  const beacon: Pending = { type: 'beacon', id: 3 };
  it('is every seat whose contribution to the pending roll is not in, roller included', () => {
    expect(owedReveal({ ...base, phase: 'play', pending: beacon, waiting: [0, 2] })).toEqual({
      seats: [0, 2],
      until: 87400,
      kind: 'roll',
    });
    expect(owedReveal({ ...base, phase: 'play', pending: beacon, waiting: [] })).toBeNull();
    // A stop or a result: the session waits on nobody, and nothing is owed.
    expect(owedReveal({ ...base, phase: 'done', pending: beacon, waiting: [1] })).toBeNull();
  });

  it('is worded as a contribution to the roll, a card reveal in the game’s own words', () => {
    const roll = owedReveal({ ...base, phase: 'play', pending: beacon, waiting: [1] });
    const refill = owedReveal({
      ...base,
      phase: 'play',
      pending: { type: 'reveal', deck: 'glass', positions: [7] },
      waiting: [1],
    });
    const luster = { act: 'reveal a card', owed: 'a card reveal' };
    expect(owedWords(roll, luster)).toEqual(ROLL_WORDS);
    expect(owedWords(refill, luster)).toEqual(luster);
    expect(owedWords(refill, undefined)).toEqual(NEUTRAL_SHARE);
    expect(owedWords(null, undefined)).toEqual(NEUTRAL_SHARE);
    // The registry: Bank names contributions; the deck games their shares; Chess none.
    expect(shareWordsOf(webGame('bank'))).toEqual(ROLL_WORDS);
    expect(shareWordsOf(webGame('luster'))).toEqual(luster);
    expect(shareWordsOf(webGame('chain-reaction'))?.owed).toBe('a share of a tile');
    expect(shareWordsOf(webGame('chess'))).toBeUndefined();
  });

  it('names who owes a contribution and when the deadline passes, for the game screen', () => {
    const owed = owedReveal({ ...base, phase: 'play', pending: beacon, waiting: [1, 2] });
    const words = owedWords(owed, undefined);
    // Another seat's line, seen by seat 1 (its own contribution is the next line).
    expect(
      waitingLine(
        input({
          phase: 'play',
          pending: beacon,
          waiting: [1, 2],
          mySeat: 1,
          secondsLeft: (owed?.until ?? 0) - 1000,
          share: words,
        }),
      ),
    ).toBe(
      `Waiting for ${NAMES[2]} to send their contribution to the roll. Their app must be open on this game. If it is not sent within 1d 0h, ${NAMES[2]} can be timed out.`,
    );
    expect(ownRevealLine(owed, 1, 1000 + 3600, words)).toBe(
      'You owe a contribution to the roll: keep this game open until it is sent. If it is not sent within 23h 0m, you can be timed out.',
    );
    expect(ownRevealLine(owed, 0, 1000, words)).toBeNull();
  });
});
